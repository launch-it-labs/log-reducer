# Integrating Log Reducer into Your Project

Log Reducer is an MCP (Model Context Protocol) tool and CLI that reduces log files before they enter an AI's context window. This guide shows how to add it to your own project so your AI agent automatically reduces logs instead of reading them raw.

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

Use `reduce_log` instead of Read/cat/head/tail for any log file. Always include `tail` (200-2000).
Redirect verbose command output to a file first, then reduce it. Never ask users to paste logs
— tell them to type `/logdump` or give a file path.

The tool has a token threshold (default 1000). If output exceeds it, you'll receive specific
guidance on how to narrow — follow the guidance.
```

### 4. (Optional) Add the `/logdump` slash command

Copy the file `.claude/commands/logdump.md` from the log-reducer repo into your project's `.claude/commands/` directory. This gives users a `/logdump` command that:

1. Dumps the clipboard contents to a temp file
2. Runs `reduce_log` on it automatically
3. The raw log never enters the conversation

The default command uses PowerShell (Windows). For macOS, replace the clipboard command with `pbpaste`; for Linux, use `xclip -selection clipboard -o`.

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

The tool applies 18 transforms in sequence:

1. **Strip ANSI** — remove color codes and escape sequences
2. **Normalize whitespace** — collapse blank lines, trim trailing spaces
3. **Shorten IDs** — UUIDs, hex strings, JWTs, tokens → `$1`, `$2`, ...
4. **Shorten URLs** — strip query params, collapse long paths
5. **Simplify timestamps** — `2024-01-15T14:32:01.123Z` → `14:32:01`
6. **Strip envelope** — remove redundant log envelope prefixes
7. **Filter noise** — remove health checks, heartbeats, devtools artifacts (DEBUG/TRACE kept for causal-chain analysis)
8. **Strip source locations** — browser console `file.js:line` prefixes
9. **Collapse pip output** — summarize pip install runs
10. **Collapse Docker layers** — summarize Docker layer push/export lines
11. **Compact access logs** — compact HTTP access logs
12. **Factor prefix** — factor out repeated `timestamp - module - LEVEL` prefixes
13. **Deduplicate** — collapse consecutive similar lines with value templates
14. **Detect cycles** — collapse repeating multi-line blocks
15. **Merge scattered** — merge non-consecutive duplicate lines
16. **Fold repeated prefix** — fold repeated prefixes among consecutive lines
17. **Fold stack traces** — collapse framework frames, shorten paths
18. **Collapse retries** — collapse near-duplicate retry blocks

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
| `summary` | boolean | **Recommended first call.** Returns structural overview: line count, time span, level counts with timestamps, components, error locations. Costs ~50 tokens. Use this to plan targeted follow-up queries |

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

### Pagination

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | number | Max matched lines to return. Output includes `[showing matches 1-5 of 23 total]` header |
| `skip` | number | Skip first N matches. For pagination: `skip: 5, limit: 5` → matches 6-10 |

### Reduction control

| Parameter | Type | Description |
|-----------|------|-------------|
| `reduce` | boolean | Default `true`. Set to `false` to skip reduction and get raw log lines (focus filters still applied). Use when you need exact original text. Every response includes a token count header so you can judge whether to re-query unreduced |

### Threshold gate

Output exceeding the token threshold (default 1000) is gated — instead of returning the full output, the tool returns the token count and guidance on how to narrow. The driving AI must follow the guidance or explicitly bypass with `break_threshold: true`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `threshold` | number | Token threshold (default 1000). Output exceeding this is gated with guidance |
| `break_threshold` | boolean | Set `true` to bypass the gate and retrieve full output |

**Behavior when output exceeds threshold**:
- No filters used → guidance suggests `summary`, `level`, `grep`, `component`, `time_range`, `limit`
- Filters used but no query → guidance suggests `query` for LLM extraction
- All options tried → guidance suggests `break_threshold: true`

This design means the tool teaches the driving AI how to reduce tokens at the exact moment it matters, eliminating the need for extensive pre-loaded instructions in CLAUDE.md.

### LLM-powered extraction

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Natural language question. An LLM extracts only lines relevant to the query. Returns actual log lines (prefixed with `>>`) with brief annotations |
| `query_budget` | number | Max tokens for extraction output (default 200). Increase for complex investigations |

**Requirements**: Requires `ANTHROPIC_API_KEY` environment variable set for the MCP server process. Model defaults to `claude-haiku-4-20250414`, configurable via `LOG_REDUCER_MODEL` env var. If the key is missing, the output is returned with a note about the missing key (the driving AI is never blocked).

## Chaining with Other MCP Tools

If your project uses other MCPs that produce log output (Playwright, Docker, Kubernetes, etc.), the AI can chain them with Log Reducer so raw logs never enter context. The key is redirecting the output to a file first.

### The pattern

```
1. Other MCP produces output → AI redirects to a temp file (never reads it)
2. AI calls reduce_log({ file: "/tmp/output.log", tail: 2000, summary: true })
3. AI sees: 3 errors at 14:02, 14:05, 14:12 — zooms in with time_range + before: 50
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
    reduce_log({ file: "/tmp/playwright.log", tail: 2000, summary: true })
    # then zoom into specific errors using timestamps from the summary

    # Docker build output
    docker build . 2>&1 > /tmp/docker-build.log
    reduce_log({ file: "/tmp/docker-build.log", tail: 2000, summary: true })

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

## Verifying the Integration

After setup, restart Claude Code in your project directory. You can verify the tool is registered:

1. Start a conversation and ask: "What MCP tools do you have access to?"
2. The AI should list `reduce_log` among its available tools
3. Test it: create a sample log file and ask the AI to "check the errors in test.log"
4. The AI should call `reduce_log({ file: "test.log", tail: 200, summary: true })` or `reduce_log({ file: "test.log", tail: 200, level: "error" })` instead of reading the file directly

## Testing

The log-reducer project includes integration tests that verify the full MCP protocol:

```bash
cd /path/to/log-reducer
npm test
```

This runs fixture tests (verifying transform output) and MCP server tests (spawning the server, performing the JSON-RPC handshake, and verifying tool listing + log reduction).
