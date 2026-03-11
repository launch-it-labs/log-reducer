# Integrating Log Reducer into Your Project

Log Reducer is an MCP (Model Context Protocol) tool and CLI that reduces log files before they enter an AI's context window. A 2000-line log can burn 20,000+ tokens — Log Reducer cuts that by 50–90% while preserving every error, warning, and meaningful event.

This guide covers setup, usage for humans, and integration instructions for AI agents.

---

## Why This Exists

Raw logs are the #1 source of wasted context in AI-assisted debugging. When a 500-line log enters the conversation:

- **20,000+ tokens consumed** — that's context the AI can't use for reasoning
- **Signal drowned in noise** — the 3 errors that matter are buried in 497 lines of health checks, heartbeats, and debug output
- **The AI loses track** — long context degrades response quality

Log Reducer reads the file server-side. Only the reduced output enters the AI's context — typically 50–200 tokens for an initial summary, or 100–500 tokens for filtered results. The raw log never touches the conversation.

---

## Quick Start

### 1. Install Log Reducer

```bash
git clone https://github.com/launch-it-labs/log-reducer.git
cd log-reducer
npm install
npm run compile
```

Note the absolute path to `out/src/mcp-server.js` — you'll need it in step 2.

### 2. Register the MCP server

Add the following to your project's `.claude/settings.json` (create the file if it doesn't exist):

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

Replace the path with the actual location on your machine, e.g.:
- macOS/Linux: `"/home/you/tools/log-reducer/out/src/mcp-server.js"`
- Windows: `"C:/Users/you/tools/log-reducer/out/src/mcp-server.js"`

### 3. Add AI instructions to your CLAUDE.md

Add the following to your project's `.claude/CLAUDE.md` so the AI knows how and when to use the tool:

```markdown
## Log handling

**NEVER ingest raw logs.** A 2000-line log burns 20,000+ tokens of context and drowns out
everything else. `reduce_log` reads the file server-side — only the reduced output enters
your context. This is the single most important rule for effective log debugging.

Use `reduce_log` instead of Read/cat/head/tail for any log file. Always include `tail`
(200-2000) to cap input size. Use `grep` or `level` to filter — don't load the whole log
when you only need errors.

reduce_log({ file: "app.log", tail: 2000 })                                     // just call it — auto-summary if large
reduce_log({ file: "app.log", tail: 200, level: "error" })                      // errors only
reduce_log({ file: "app.log", tail: 200, level: "error", before: 30, context_level: "warning" })  // errors + relevant context
reduce_log({ file: "app.log", tail: 200, grep: "timeout|connection" })           // regex search
reduce_log({ file: "app.log", tail: 2000, summary: true })                      // force structural overview

**How the threshold gate works:**
- **No filters + over threshold** → you get an enhanced summary: unique errors/warnings with
  counts, timestamps, and components. Use this to plan your next call.
- **Filters + over threshold** → you get the actual output with a TIP on how to narrow further.
- **Under threshold** → you get the full reduced output directly.

Redirect verbose command output to a file first, then reduce it.

**When the user needs to provide logs:** never ask them to paste logs. Tell them to type
`/logdump` (dumps clipboard to file + auto-reduces) or give a file path. If YOU need a log
from the user, say: *"Copy the log to your clipboard and type `/logdump`"*.
```

### 4. Add the `/logdump` slash command

Copy the file `.claude/commands/logdump.md` from the log-reducer repo into your project's `.claude/commands/` directory. This gives users a `/logdump` command that:

1. Dumps the clipboard contents to a temp file
2. Runs `reduce_log` on it automatically
3. The raw log never enters the conversation

The default command uses PowerShell (Windows). For macOS, replace the clipboard command with `pbpaste`; for Linux, use `xclip -selection clipboard -o`.

**This is the recommended workflow for most users.** When the AI needs a log from the user, it should say: *"Copy the log to your clipboard and type `/logdump`"*.

---

## How to Provide Logs (for Humans)

**The #1 rule: never paste raw logs into the chat.** If you paste a log into the chat window, it enters the AI's context as raw text — the MCP tool cannot un-do that. The whole point of the `file` parameter is that only the reduced output enters context.

### Option 1: `/logdump` (recommended)

Copy the log to your clipboard, then type `/logdump` in the chat. The AI saves your clipboard to a temp file and runs `reduce_log` on it automatically. The raw log never enters the conversation.

### Option 2: File path

If the log is already a file on disk, just tell the AI:
- *"check the errors in C:\logs\app.log"*
- *"what failed in /var/log/myapp.log"*

### Option 3: Redirect command output

Redirect verbose command output to a file, then reference the file:

```bash
npm test 2>&1 > /tmp/test.log
```

Then tell the AI: *"check the errors in /tmp/test.log"*

### What happens next

The AI calls `reduce_log({ file: "...", tail: 2000 })` on the path you give it. If the reduced output is small enough (under the token threshold), you get it directly. If it's too large, you get an enhanced summary showing every unique error and warning with counts and timestamps — then the AI filters down to what matters.

---

## How It Works

### MCP server

The MCP server (`src/mcp-server.ts`) exposes a single tool over stdio using JSON-RPC:

| Tool | Parameters | Output |
|------|-----------|--------|
| `reduce_log` | `file` (path) or `log_text` (string), plus optional filters | Reduced log text |

The AI agent calls the tool, the server reads the file, runs the reduction pipeline, and returns the reduced text. The raw log never enters the AI's context — only the reduced output does.

### CLI

The CLI reads from stdin and writes to stdout. Any agent that can run shell commands can use it:

```bash
node /path/to/log-reducer/out/src/cli.js < app.log > reduced.log
kubectl logs my-pod | node /path/to/log-reducer/out/src/cli.js
```

After `npm link` in the log-reducer directory, the `logreducer` command is available globally:

```bash
cat app.log | logreducer
logreducer --level error --context 10 < app.log
```

### What the pipeline does

The tool applies 14 transforms in sequence:

1. **Strip ANSI** — remove color codes and escape sequences
2. **Normalize whitespace** — collapse blank lines, trim trailing spaces
3. **Shorten IDs** — UUIDs, hex strings, JWTs, tokens → `$1`, `$2`, ...
4. **Shorten URLs** — strip query params, collapse long paths
5. **Simplify timestamps** — `2024-01-15T14:32:01.123Z` → `14:32:01`
6. **Filter noise** — remove health checks, heartbeats, devtools artifacts (DEBUG/TRACE kept for causal-chain analysis)
7. **Strip source locations** — browser console `file.js:line` prefixes
8. **Collapse pip output** — summarize pip install runs
9. **Collapse Docker layers** — summarize Docker layer push/export lines
10. **Factor prefix** — factor out repeated `timestamp - module - LEVEL` prefixes
11. **Deduplicate** — collapse consecutive similar lines with value templates
12. **Detect cycles** — collapse repeating multi-line blocks
13. **Fold stack traces** — collapse framework frames, shorten paths
14. **Collapse retries** — collapse near-duplicate retry blocks

---

## The Threshold Gate

The threshold gate is the key mechanism that prevents large outputs from flooding the AI's context. When reduced output exceeds the token threshold (default 1000 tokens), the tool's behavior depends on what filters were used:

### No filters → Enhanced summary

When you call `reduce_log` with no filters (just `file` and `tail`) and the output is too large, instead of dumping everything into context, the tool returns an **enhanced summary**:

```
SUMMARY (1523 lines, 14:02:01–14:15:33)

Errors: 8
  [14:02:15] Connection refused to database at $1:5432 [x3]
  [14:05:01] Timeout waiting for response from auth service
  [14:12:44] OutOfMemoryError: Java heap space [x2]
  [14:15:30] Failed to write to disk: No space left on device
  [14:15:33] Shutting down due to unrecoverable error

Warnings: 12
  [14:02:01] Connection pool exhausted, waiting for available connection [x5]
  [14:05:00] Auth service response time > 5000ms [x4]
  [14:12:30] GC pause > 500ms [x3]

Components: database, auth, api, gc

Next steps — filter to what you need:
  level: "error"                    — see all 8 errors with context
  time_range: "14:12-14:16"         — zoom into the OOM + shutdown
  component: "database"             — see all database activity
  grep: "OutOfMemory|heap"          — search for specific patterns
```

This costs ~100–200 tokens instead of 1500+, and gives the AI everything it needs to make a targeted follow-up call. Errors are shown **first-N by time** (early errors are more valuable — they're often the root cause).

### Filters used → Output with tip

When you use filters (`level`, `grep`, `component`, `time_range`) but the output still exceeds the threshold, the tool returns the **actual output** along with a tip on how to narrow further:

```
[1200 tokens (raw: 8500) exceeds 1000 threshold after filtering.]
NOTE: $1, $2 etc. are parameterized values. [x8] = collapsed lines.
TIP: Narrow further with: time_range, grep, limit, context_level
  Or break_threshold: true to bypass.

[actual reduced output follows...]
```

The AI gets the data it requested — it's just informed that it's over threshold with suggestions for narrowing.

### Under threshold → Direct output

When output is small enough (under the threshold), it's returned directly with a token count header. No gates, no hints — just the output.

### Bypass

Set `break_threshold: true` to bypass the gate entirely and get full output regardless of size.

---

## Filter Parameters

All filters are optional. Inclusion filters (`level`, `grep`, `contains`, `component`) combine via OR — any line matching any active filter is included. `time_range` is an AND scope — it restricts the window, then inclusion filters select within it. `not_grep` is applied as a post-filter exclusion.

### Input control

| Parameter | Type | Description |
|-----------|------|-------------|
| `file` | string | Path to log file (preferred — keeps raw log out of context) |
| `log_text` | string | Raw log text (use only for small snippets) |
| `tail` | number | Only process the last N lines of input |
| `head` | number | Only process the first N lines (startup/config). Can combine with `tail` (tail applied first) |

### Investigation mode

| Parameter | Type | Description |
|-----------|------|-------------|
| `summary` | boolean | Returns structural overview: line count, time span, level counts with timestamps, components, error locations. Costs ~50 tokens. Use to plan targeted follow-up queries. Also fires automatically when output exceeds threshold with no filters |

### Inclusion filters (combine via OR)

| Parameter | Type | Description |
|-----------|------|-------------|
| `level` | string | Minimum log level: `"error"`, `"warning"`, `"info"`, `"debug"` |
| `grep` | string | Regex pattern to match lines (case-insensitive) |
| `contains` | string | Literal substring to match lines |
| `component` | string | Filter by logger/module name (case-insensitive substring) |

### Scoping filter (AND with inclusion filters)

| Parameter | Type | Description |
|-----------|------|-------------|
| `time_range` | string | Time window, e.g. `"13:02-13:05"` or `"13:02:30-13:02:45"`. Restricts to lines within the window. When combined with inclusion filters, only lines matching both the time window AND an inclusion filter are shown. When used alone, all lines in the window are included. Use timestamps from a prior `summary` call |

### Exclusion filter

| Parameter | Type | Description |
|-----------|------|-------------|
| `not_grep` | string | Regex pattern — exclude matching lines even if they match an inclusion filter. E.g., `"health.check\|heartbeat"` |

### Context control

| Parameter | Type | Description |
|-----------|------|-------------|
| `context` | number | Symmetric context: lines shown before AND after each match (default 3). Overridden by `before`/`after` |
| `before` | number | Lines of context BEFORE each match. Use large values (50-100) to see what caused an error |
| `after` | number | Lines of context AFTER each match. Use large values to see consequences/cascading effects |
| `context_level` | string | Minimum severity for context lines (not match lines). Filters out low-severity noise in the before/after window while keeping matched lines and lines without a level marker (stack traces, continuation lines). E.g., `level: "error", before: 30, context_level: "warning"` → errors with 30 lines of preceding context, but only WARNING+ context lines. Massive token savings when context windows are large |

### Pagination

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | number | Max matched lines to return. Output includes `[showing matches 1-5 of 23 total]` header |
| `skip` | number | Skip first N matches. For pagination: `skip: 5, limit: 5` → matches 6-10 |

### Reduction control

| Parameter | Type | Description |
|-----------|------|-------------|
| `reduce` | boolean | Default `true`. Set to `false` to skip reduction and get raw log lines (focus filters still applied). Use when you need exact original text. Every response includes a token count header so you can judge whether to re-query unreduced |

### Threshold control

| Parameter | Type | Description |
|-----------|------|-------------|
| `threshold` | number | Token threshold (default 1000). Output exceeding this triggers the threshold gate |
| `break_threshold` | boolean | Set `true` to bypass the gate and retrieve full output |

### LLM-powered extraction

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Natural language question. An LLM extracts only lines relevant to your query. Only activates when output exceeds the threshold — small outputs are returned directly |
| `query_budget` | number | Max tokens for extraction output (default 400). A single stack trace with context typically needs 300-500 tokens |

**Requirements**: `ANTHROPIC_API_KEY` must be injected via the `env` block in your MCP config — it is **not** picked up from the shell environment, since the MCP server runs as a subprocess:

```json
{
  "mcpServers": {
    "logreducer": {
      "command": "node",
      "args": ["/path/to/log-reducer/out/src/mcp-server.js"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

Restart Claude Code after editing the MCP config for env changes to take effect. Model defaults to `claude-haiku-4-20250414`, configurable via `LOG_REDUCER_MODEL` in the same `env` block.

**Important**: LLM extraction is a premium feature that requires an API key. The tool is fully functional without it — the enhanced summary and mechanical filters handle most use cases. If the key is missing and `query` is used, the output is returned with a note about the missing key. The AI is never blocked.

---

## The Funnel Pattern

For large logs (500+ lines), use this multi-call pattern to efficiently drill down to what matters:

### Step 1: Survey

```
reduce_log({ file: "app.log", tail: 2000 })
```

Just call it with no filters. If the output is small enough, you get it directly. If it's large, you automatically get an enhanced summary listing unique errors, warnings, timestamps, and components. This tells you what's in the log without reading it.

### Step 2: Scan

```
reduce_log({ file: "app.log", tail: 2000, level: "error", limit: 5 })
```

Target the errors (or warnings, or a component) identified in the summary. Use `limit` to keep output focused.

### Step 3: Zoom

```
reduce_log({ file: "app.log", tail: 2000, time_range: "14:02-14:03", before: 50 })
```

Use timestamps from the summary or previous calls to zoom into a specific time window. Use `before` to see what led up to the error.

### Step 4: Focus context

```
reduce_log({ file: "app.log", tail: 2000, level: "error", before: 30, context_level: "warning" })
```

When you need broad context around errors but the context window is full of noise, use `context_level` to keep only WARNING+ lines in the context window. This can cut context tokens by 80–90% while preserving all the important surrounding events.

### Step 5: Trace (optional)

```
reduce_log({ file: "app.log", tail: 2000, grep: "connection|timeout", time_range: "14:02-14:03" })
```

Combine regex search with time range for surgical extraction.

### Step 6: LLM extraction (optional, requires API key)

```
reduce_log({ file: "app.log", tail: 2000, query: "what caused the OOM" })
```

If mechanical filters aren't enough, use a natural language query. The LLM reads the reduced output and extracts only the relevant lines. Requires `ANTHROPIC_API_KEY` in the MCP `env` block — see [Requirements](#requirements) above.

**Most investigations complete in 2 calls** (survey → scan). The funnel pattern ensures you never waste tokens loading content you don't need.

---

## Chaining with Other MCP Tools

If your project uses other MCPs that produce log output (Playwright, Docker, Kubernetes, etc.), the AI can chain them with Log Reducer so raw logs never enter context. The key is redirecting the output to a file first.

### The pattern

```
1. Other MCP produces output → AI redirects to a temp file (never reads it)
2. AI calls reduce_log({ file: "/tmp/output.log", tail: 2000 })
3. Auto-summary shows: 3 errors at 14:02, 14:05, 14:12 — AI zooms in with level/time_range
4. Only the targeted, reduced output enters context
```

### Example: Playwright MCP

Add this to your CLAUDE.md instructions:

```markdown
### Chaining with other tools

When running commands or tools that produce log output (Playwright, Docker, test runners,
build tools), **always redirect output to a temp file** before reading it:

    # Playwright test output
    npx playwright test 2>&1 > /tmp/playwright.log
    reduce_log({ file: "/tmp/playwright.log", tail: 2000 })
    # auto-summary if large, or direct output if small

    # Docker build output
    docker build . 2>&1 > /tmp/docker-build.log
    reduce_log({ file: "/tmp/docker-build.log", tail: 2000 })

    # Any MCP tool that returns verbose text — save to file, then reduce
    # NEVER read the raw output into context first

This applies to ANY source of verbose output — shell commands, MCP tool results, or
files on disk. The rule is simple: if it's more than ~20 lines, reduce it first.
```

### Why this works

The `reduce_log` tool reads the file server-side and returns only the reduced text. The AI never sees the raw content. This means:

- A 500-line Playwright failure log costs ~250 tokens instead of ~5,000
- Docker build output with repeated layer messages collapses to a summary
- Stack traces keep only your code frames, not framework internals
- Repeated retry/polling output collapses to a count

### When the other MCP returns text directly

If another MCP tool returns log text as its result (rather than writing to a file), the raw text is already in context — there's nothing `reduce_log` can do retroactively. In this case, instruct the AI in your CLAUDE.md to prefer the file-based workflow:

```markdown
When a tool returns verbose output directly, save it to a temp file for future reference
rather than re-reading it. If you need to analyze it further, use reduce_log on the
saved file.
```

---

## Integration with Other AI Agents

### OpenAI Codex / Other CLI-based agents

Add instructions to `AGENTS.md` (or your agent's instruction file) to use the CLI:

```markdown
## Log handling

Before reading log files, reduce them through the log reducer CLI:

    node /path/to/log-reducer/out/src/cli.js < logfile.log > /tmp/reduced.log

Then read /tmp/reduced.log instead of the raw file. This typically reduces token count by 70-90%.
```

### GitHub Copilot

Add instructions to `.github/copilot-instructions.md`:

```markdown
## Log handling

When analyzing log files, pipe them through the log reducer CLI first:

    node /path/to/log-reducer/out/src/cli.js < logfile.log

This reduces logs by 70-90% while preserving all errors, warnings, and meaningful events.
```

---

## Verifying the Integration

After setup, restart Claude Code in your project directory. You can verify the tool is registered:

1. Start a conversation and ask: "What MCP tools do you have access to?"
2. The AI should list `reduce_log` among its available tools
3. Test it: create a sample log file and ask the AI to "check the errors in test.log"
4. The AI should call `reduce_log({ file: "test.log", tail: 2000 })` — which will auto-summarize if large, or return directly if small — instead of reading the file directly

---

## Testing

The log-reducer project includes integration tests that verify the full MCP protocol:

```bash
cd /path/to/log-reducer
npm test
```

This runs fixture tests (verifying transform output) and MCP server tests (spawning the server, performing the JSON-RPC handshake, and verifying tool listing + log reduction).
