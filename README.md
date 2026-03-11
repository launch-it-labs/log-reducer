# Log Reducer

[![npm version](https://img.shields.io/npm/v/logreducer)](https://www.npmjs.com/package/logreducer)
[![CI](https://github.com/launch-it-labs/log-reducer/actions/workflows/ci.yml/badge.svg)](https://github.com/launch-it-labs/log-reducer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Your AI coding agent is spending thousands of tokens reading raw logs — DEBUG spam, health checks, duplicate lines, framework stack frames, UUIDs. Those tokens are gone for the rest of the session. The agent has less room to think, generates worse code, and hits its context limit faster.

Log Reducer sits between the log and the AI. It reduces the file down to just the signal — errors, warnings, state changes, unique events — typically cutting 70-90% of tokens. The raw log never enters the AI's context.

It runs as an **MCP server** (the AI calls `reduce_log` with a file path) or as a **CLI** (pipe any log through it). No API keys, no network calls — deterministic text transforms that run instantly.

## Example

You're running your FastAPI dev server. You click around, hit a 500 error, and copy
the terminal output into a file. It's 218 lines — mostly a wall of framework stack traces:

```
218 lines, 1185 tokens  →  51 lines, 310 tokens  (74% reduction)
```

Here's what the tool does to the stack trace. This is a real Python exception group
with uvicorn, starlette, and FastAPI frames:

**Before** — 95 lines of stack trace, full `C:\Users\...\.venv\Lib\site-packages\` paths:
```
    |   File "C:\Users\imank\projects\video-editor\src\backend\.venv\Lib\site-packages\
             uvicorn\protocols\http\httptools_impl.py", line 426, in run_asgi
    |     result = await app(  # type: ignore[func-returns-value]
    |              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    |   File "C:\Users\imank\projects\video-editor\src\backend\.venv\Lib\site-packages\
             uvicorn\middleware\proxy_headers.py", line 84, in __call__
    |     return await self.app(scope, receive, send)
    |            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    ... 85 more framework lines ...
    |   File "C:\Users\imank\projects\video-editor\src\backend\app\routers\exports.py",
             line 745, in list_unacknowledged_exports
```

**After** — your code preserved, framework collapsed, duplicate traceback gone:
```
    |   [... 10 framework frames (uvicorn, fastapi, starlette, contextlib) omitted ...]
    |   File "app/middleware/db_sync.py", line 107, in dispatch
    |     response = await call_next(request)
    |   [... 6 framework frames (starlette, contextlib) omitted ...]
    |   File "app/main.py", line 97, in dispatch
    |     response = await call_next(request)
    |   [... 16 framework frames (starlette, fastapi) omitted ...]
    |   File "app/routers/exports.py", line 745, in list_unacknowledged_exports
    |     exports=[
    |   File "app/routers/exports.py", line 746, in <listcomp>
    |     ExportJobResponse(
    | pydantic_core._pydantic_core.ValidationError: 1 validation error for ExportJobResponse
    | project_id
    |   Input should be a valid integer [type=int_type, input_value=None, input_type=NoneType]

Traceback (most recent call last):
  [... duplicate traceback omitted ...]
```

The bug is clear: `exports.py:745` passes `project_id=None` to a Pydantic model that
expects an int. Three framework frames, not 95. No `C:\Users\...\.venv\` paths.

([Full before/after](docs/how-it-works.md)  |  [How the funnel pattern works for larger logs](docs/how-it-works.md#for-larger-logs))

## Setup

### Step 1 — Install

```bash
npm install -g logreducer
```

<details>
<summary>Or build from source</summary>

```bash
git clone https://github.com/launch-it-labs/log-reducer.git
cd log-reducer
npm install && npm run compile
```

</details>

### Step 2 — Add MCP server to your project

Add to your project's `.claude/settings.json`:

```json
{
  "mcpServers": {
    "logreducer": {
      "command": "npx",
      "args": ["-y", "logreducer", "--mcp"]
    }
  }
}
```

Then tell Claude Code: *"Follow the integration guide at https://github.com/launch-it-labs/log-reducer/blob/master/docs/agent-integration.md"* — it will add the right instructions to your CLAUDE.md and set up the `/logdump` slash command. You can verify it worked by asking: *"What MCP tools do you have?"* — it should list `reduce_log`.

That's it. Your AI agent now reduces logs automatically instead of reading them raw.

See [docs/agent-integration.md](docs/agent-integration.md) for the full guide — filter reference, chaining with other MCPs, and setup for Codex/Copilot.

### Sharing logs

Copy a log to your clipboard, then type `/logdump` in the chat. The raw log is saved to a temp file and reduced automatically — it never enters the AI's context. This is the recommended way to share logs.

### CLI (for scripts and piping)

```bash
logreducer < app.log > reduced.log
kubectl logs my-pod | logreducer
logreducer --level error --context 10 < app.log
```

## Multi-turn investigation

The tool isn't just a one-shot reducer. It supports a **funnel pattern** that lets an AI agent investigate a large log file in multiple targeted passes — spending ~1,000 tokens total instead of 5,000+ from a blind dump.

### The problem with one-shot log reading

When an AI reads a 2,000-line log file, two bad things happen:
1. **Most of the tokens are noise.** Even after reduction, a full dump includes context the agent doesn't need yet.
2. **The tokens are permanent.** Once in context, they can't be reclaimed. If the agent later realizes it needed different information, those tokens are wasted.

### The funnel: survey, scan, zoom, trace

Each step is informed by the previous one. The agent only loads what it needs.

```
Step 1: SURVEY → reduce_log({ file, tail: 2000 })           ~50 tokens
  If the reduced output exceeds the threshold (default: 1000 tokens),
  the tool automatically returns an enhanced summary instead of the full
  output: unique errors/warnings with counts, time span, and components.
  Use summary: true to force a survey on any size log.

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
| `summary` | Structural overview: line count, time span, error counts, components | Force a survey on any size log; fires automatically when a no-filter call exceeds the threshold |
| `limit` / `skip` | Pagination — `limit: 5` returns first 5 matches, `skip: 5, limit: 5` returns matches 6-10 | Scanning errors without loading all of them |
| `before` / `after` | Asymmetric context — `before: 50, after: 5` shows 50 lines *before* a match | Finding what *caused* an error |
| `time_range` | Filter to a time window using timestamps from a prior query | Zooming into a specific incident |
| `not_grep` | Exclude lines matching a pattern, even if they match an inclusion filter | Removing known noise (health checks, heartbeats) |
| `context_level` | Minimum severity for context lines — e.g., `context_level: "warning"` keeps only WARNING+ lines in the before/after window | Cutting noise from context without losing matched lines |
| `head` | First N lines only | Startup/config logs at the top of a file |
| `reduce: false` | Skip reduction, return raw lines (filters still applied) | When you need exact original text (commands, config values, error messages) |
| `query` | Natural language question — Claude extracts only relevant lines (requires `ANTHROPIC_API_KEY`) | When filters aren't enough and you know what you're looking for |

Every response includes a token count header — e.g., `[150 tokens (raw input: 2000 tokens)]`. When a `level` filter is active, a footer also shows filtered-out line counts by level — e.g., `[filtered: 847 debug, 123 info]` — so the agent can judge whether it's over-filtering.

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

18 transforms, applied in sequence. Rule-based, deterministic, no API calls required. One dependency (`@modelcontextprotocol/sdk`). Optional `query` param uses Claude for targeted extraction (requires `ANTHROPIC_API_KEY`).

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

- **File-path workflow** — the MCP tool accepts file paths so raw logs never enter the AI's context. Only reduced output crosses into the conversation.
- **Token reduction over line reduction** — stats reported in tokens, not lines, since that's what matters for AI context windows.
- **Generality over coverage** — new transforms are scored by how broadly they apply. A pattern that only helps one application's logs gets flagged as bias risk and skipped, even if it would improve that specific case.
- **Transform order matters** — IDs and timestamps are shortened before dedup so lines differing only by those values become identical. Noise is filtered before prefix factoring so separator lines don't break grouping.
- **Each transform is independent** — pure function in, string out. Easy to add, test, and reorder without touching the rest of the pipeline.
- **No ID legend** — replaced IDs get `$1`, `$2` placeholders with no mapping back. The original UUIDs are almost never what you're debugging.
- **Minimal dependencies** — pure TypeScript, one runtime dependency (`@modelcontextprotocol/sdk`).

## License

MIT
