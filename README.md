# Log Reducer

Your AI coding agent is spending thousands of tokens reading raw logs — DEBUG spam, health checks, duplicate lines, framework stack frames, UUIDs. Those tokens are gone for the rest of the session. The agent has less room to think, generates worse code, and hits its context limit faster.

Log Reducer sits between the log and the AI. It reduces the file down to just the signal — errors, warnings, state changes, unique events — typically cutting 70-90% of tokens. The raw log never enters the AI's context.

It runs as an **MCP server** (the AI calls `reduce_log` with a file path) or as a **CLI** (pipe any log through it). No API keys, no network calls — deterministic text transforms that run instantly.

## Example: finding a bug in 2,604 lines

A batch job is leaking database connections. The pool fills up, every API request
starts failing with 503s. The root cause is one line buried among 2,604.

The AI doesn't read the log. It interrogates it:

```
STEP 1 — SURVEY (96 tokens)
reduce_log({ file: "app.log", summary: true })

  SUMMARY (2,604 lines)
  Time: 09:00:00 — 09:49:39
  ERROR: 152 (09:47:30 — 09:48:59)       <-- all errors in a 90-second window
  WARN:    3 (09:47:00 — 09:47:20)       <-- warnings right before
  Components: app.api, app.batch, app.db

STEP 2 — SCAN (551 tokens)
reduce_log({ file: "app.log", level: "error", limit: 5, context: 3 })

  WARN [app.db] pool near capacity (active=45, 48, 49)
  ERROR [app.db] pool exhausted (active=50, idle=0)
  ERROR [app.api] GET /api/users failed: ConnectionPoolExhausted
  ERROR [app.api] GET /api/orders failed: ConnectionPoolExhausted
  ...81 total errors, showing first 5

STEP 3 — ZOOM (1,350 tokens)
reduce_log({ file: "app.log", time_range: "09:47:25-09:48:10", before: 30 })

  Acquiring connection (active=26, idle=24)     ← pool filling up
  [app.batch] Processing record 17/2000
  Acquiring connection (active=27, idle=23)
  [app.batch] Processing record 18/2000
  ...
  Acquiring connection (active=39, idle=11)
  [app.batch] Processing record 30/2000
  WARN pool near capacity (active=45)
  ERROR pool exhausted (active=50, idle=0)
  ...cascade of 503s...
  INFO [app.batch] Export batch still running    ← THE CLUE
    (processed 45/2000, connections held: 30)

STEP 4 — TRACE (186 tokens)
reduce_log({ file: "app.log", grep: "active=|idle=|batch|held",
             time_range: "09:45-09:48:30", limit: 15, context: 0 })

  Acquiring connection (active=11, idle=39)     ← staircase pattern
  Acquiring connection (active=12, idle=38)        one connection per record
  ...                                              never released
  Acquiring connection (active=25, idle=25)
```

**Four calls. 2,183 tokens. Root cause found.** The batch job is eating one connection
per record and never giving it back. The raw log never entered the conversation.

([Full walkthrough with sequence diagram](docs/how-it-works.md))

### Token cost comparison

```
                        Tokens    Context used
                     ─────────────────────────
Read raw log          25,600        100%        ← noise fills the context window
reduce_log (one-shot) 16,500         64%        ← reduced, but untargeted
Funnel (4 calls)       2,183          9%        ← only what the AI needed
                     ─────────────────────────
Tokens saved:         23,417                    ← free for reasoning & code
```

Across [5 simulated production bugs](docs/how-it-works.md#across-5-simulated-bugs)
(pool exhaustion, auth cascade, memory leak, deploy crash, race condition), the funnel
pattern used **4% of raw tokens** while finding every root cause.

## Setup

### Step 1 — Build Log Reducer

```bash
git clone https://github.com/launch-it-labs/log-reducer.git
cd log-reducer
npm install && npm run compile
```

### Step 2 — Integrate with your project

Open your project in Claude Code and say:

> Integrate log-reducer as an MCP tool. The server is at `/path/to/log-reducer/out/src/mcp-server.js`. Follow the integration guide at `/path/to/log-reducer/docs/agent-integration.md`.

Claude Code will register the MCP server, add the right instructions to your CLAUDE.md, and set up the `/logdump` slash command. You can verify it worked by asking: *"What MCP tools do you have?"* — it should list `reduce_log`.

That's it. Your AI agent now reduces logs automatically instead of reading them raw.

<details>
<summary>Manual setup (if you prefer)</summary>

Add to your project's `.claude/settings.json`:

```json
{
  "mcpServers": {
    "logreducer": {
      "command": "node",
      "args": ["/absolute/path/to/log-reducer/out/src/mcp-server.js"]
    }
  }
}
```

Copy the [AI instructions block](docs/agent-integration.md#3-add-ai-instructions-to-your-claudemd) into your project's `.claude/CLAUDE.md`.

Optionally copy `.claude/commands/logdump.md` into your project for a `/logdump` slash command.

See [docs/agent-integration.md](docs/agent-integration.md) for the full guide — filter reference, chaining with other MCPs, and setup for Codex/Copilot.
</details>

### CLI (for scripts and piping)

```bash
node out/src/cli.js < app.log > reduced.log
kubectl logs my-pod | node out/src/cli.js
node out/src/cli.js --level error --context 10 < app.log
```

After `npm link`, the `logreducer` command is available globally.

## Multi-turn investigation

The tool isn't just a one-shot reducer. It supports a **funnel pattern** that lets an AI agent investigate a large log file in multiple targeted passes — spending ~1,000 tokens total instead of 5,000+ from a blind dump.

### The problem with one-shot log reading

When an AI reads a 2,000-line log file, two bad things happen:
1. **Most of the tokens are noise.** Even after reduction, a full dump includes context the agent doesn't need yet.
2. **The tokens are permanent.** Once in context, they can't be reclaimed. If the agent later realizes it needed different information, those tokens are wasted.

### The funnel: survey, scan, zoom, trace

Each step is informed by the previous one. The agent only loads what it needs.

```
Step 1: SURVEY → summary: true                              ~50 tokens
  "8 errors between 13:02-13:15, components: db, auth, api"

Step 2: SCAN   → level: "error", limit: 3                   ~200 tokens
  See first 3 errors with context. Note timestamps.

Step 3: ZOOM   → time_range: "13:02:28-13:02:35", before: 50  ~500 tokens
  50 lines leading up to the first error — the causal chain.

Step 4: TRACE  → grep: "pool|conn", time_range: "13:00-13:05",  ~300 tokens
                  limit: 15, context: 0
  Follow the connection pool thread. limit caps matches,
  context: 0 avoids pulling in noise between them.
```

Total: ~1,050 tokens. The agent found the root cause (connection pool exhaustion from a batch job) without ever loading the full log.

### Key parameters for investigation

| Parameter | What it does | When to use it |
|-----------|-------------|----------------|
| `summary` | Structural overview: line count, time span, error counts, components | **Always first** for logs >100 lines |
| `limit` / `skip` | Pagination — `limit: 5` returns first 5 matches, `skip: 5, limit: 5` returns matches 6-10 | Scanning errors without loading all of them |
| `before` / `after` | Asymmetric context — `before: 50, after: 5` shows 50 lines *before* a match | Finding what *caused* an error |
| `time_range` | Filter to a time window using timestamps from a prior query | Zooming into a specific incident |
| `not_grep` | Exclude lines matching a pattern, even if they match an inclusion filter | Removing known noise (health checks, heartbeats) |
| `head` | First N lines only | Startup/config logs at the top of a file |
| `reduce: false` | Skip reduction, return raw lines (filters still applied) | When you need exact original text (commands, config values, error messages) |

Every response includes a token count header — e.g., `[150 tokens (raw input: 2000 tokens)]` — so the agent can judge whether the reduced output is sufficient or worth re-querying unreduced.

These compose with the existing filters (`level`, `grep`, `contains`, `component`, `context`, `tail`). Inclusion filters (`level`, `grep`, `contains`, `component`) combine via OR. `time_range` is an AND scope — it restricts the window, then inclusion filters select within it. `not_grep` is applied as a post-filter exclusion.

## What it does to your logs

Biggest impact first:

- **Noise filtered** — health checks, heartbeats, progress bars removed (DEBUG/TRACE lines kept — the AI chooses when to exclude them via `level` filter)
- **Stack traces folded** — 80 frames → your code frames + `[... N framework frames omitted ...]`
- **Repeated lines collapsed** — 6 similar lines → one template with varying values listed
- **Log prefixes factored** — 8 lines sharing `timestamp - module - LEVEL` → 1 header + indented messages
- **Repeating blocks detected** — 5 identical 3-line blocks → 1 block + count
- **IDs shortened** — UUIDs, hex strings, JWTs, tokens → `$1`, `$2`, ...
- **Timestamps simplified** — `2024-01-15T14:32:01.123Z` → `14:32:01`
- **Domain-specific** — pip installs, Docker layers, HTTP access logs, retry blocks, log envelopes each have dedicated collapsers

18 transforms, applied in sequence. Rule-based, deterministic, runs offline. One dependency (`@modelcontextprotocol/sdk`).

<details>
<summary>Stack trace folding in detail</summary>

This is where most of the reduction comes from on error logs:

- **Keeps all your code frames**, collapses consecutive framework frames: `[... 10 framework frames (uvicorn, fastapi, starlette) omitted ...]`
- **Shortens paths**: `C:\Users\me\project\.venv\Lib\site-packages\starlette\routing.py` → `starlette/routing.py`
- **Removes caret lines** (`^^^^^^`)
- **Deduplicates chained tracebacks**: `[... duplicate traceback omitted ...]`
- **Handles Python exception groups** (`|` prefixed traces)
- **Supports**: Java, Python, Node.js, .NET, Go

</details>

<details>
<summary>Deduplication in detail</summary>

When consecutive lines share the same structure but differ in specific values, the output shows a template with the varying values:

```
[x7] [CacheWarming] Warmed tail of large video ({N}MB) | N = 2574, 3139, 2897, 3063, 2490, 2996, 3043
```

</details>

## Contributing

**The easiest way to contribute is to paste a log file.** Open this project in Claude Code, paste a log into the chat, and the AI will analyze it, identify patterns the pipeline misses, implement high-generality fixes, and create a PR. No code knowledge required — your log becomes a test fixture that makes the tool better for everyone.

You can also [submit a log via GitHub issue](https://github.com/launch-it-labs/log-reducer/issues/new?template=log-sample.yml) if you don't use Claude Code.

For code contributions, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Design Decisions

- **Rule-based, no AI** — zero API calls, works offline, deterministic. You get the same output every time, and it runs in milliseconds.
- **File-path workflow** — the MCP tool accepts file paths so raw logs never enter the AI's context. Only reduced output crosses into the conversation.
- **Token reduction over line reduction** — stats reported in tokens, not lines, since that's what matters for AI context windows.
- **Generality over coverage** — new transforms are scored by how broadly they apply. A pattern that only helps one application's logs gets flagged as bias risk and skipped, even if it would improve that specific case.
- **Transform order matters** — IDs and timestamps are shortened before dedup so lines differing only by those values become identical. Noise is filtered before prefix factoring so separator lines don't break grouping.
- **Each transform is independent** — pure function in, string out. Easy to add, test, and reorder without touching the rest of the pipeline.
- **No ID legend** — replaced IDs get `$1`, `$2` placeholders with no mapping back. The original UUIDs are almost never what you're debugging.
- **Minimal dependencies** — pure TypeScript, one runtime dependency (`@modelcontextprotocol/sdk`).

## License

MIT
