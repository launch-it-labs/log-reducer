# Integrating Log Reducer into Your Project

Log Reducer is an MCP (Model Context Protocol) tool and CLI that compresses log files before they enter an AI's context window. This guide shows how to add it to your own project so your AI agent automatically reduces logs instead of reading them raw.

## Quick Start

### 1. Install Log Reducer

```bash
git clone https://github.com/imankha/log-reducer.git
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

You have access to the `reduce_log` MCP tool which compresses logs up to 95% while
preserving semantic value.

### Why this matters

Your context window is a finite, non-renewable resource within a session. Every raw log
token that enters context is permanently spent — it cannot be reclaimed. A 500-line log
costs 5,000+ tokens raw but only 250-500 after reduction. Raw logs are the single most
wasteful thing that can enter your context.

### Mandatory rules

1. **NEVER ask users to paste, copy, or type log output into chat.** Instead direct them
   to save logs to a file and give you the path, or use the `/logdump` slash command.

2. **NEVER read raw log files** — use `reduce_log` with a `file` parameter instead of
   the Read tool, cat, head, or tail.

3. **Redirect verbose command output to a temp file first**, then use `reduce_log`:

       npm test 2>&1 > /tmp/test-output.log
       reduce_log({ file: "/tmp/test-output.log", tail: 200, level: "error" })

4. **Always include `tail`** (default 200) to cap input size.

5. **Choose the right filter on the FIRST call** — each call loads output into context
   permanently. Don't call broadly then re-filter.

6. **Chain with other tools that produce logs** — when running shell commands, test
   runners, or other MCP tools (Playwright, Docker, etc.) that produce verbose output,
   **always redirect to a temp file first**, then compress. The goal is to never let
   raw log text enter your context from any source:

       npx playwright test 2>&1 > /tmp/playwright.log
       reduce_log({ file: "/tmp/playwright.log", tail: 200, level: "error" })

       docker build . 2>&1 > /tmp/docker-build.log
       reduce_log({ file: "/tmp/docker-build.log", tail: 300 })

   This applies to ANY verbose output — if it's more than ~20 lines, compress it first.
   A 500-line test failure log costs ~5,000 tokens raw but ~500 after reduction.

### Quick filter reference

- `reduce_log({ file: "app.log", tail: 200, level: "error" })` — errors only (default)
- `reduce_log({ file: "app.log", tail: 200, level: "error", context: 10 })` — errors + surrounding lines
- `reduce_log({ file: "app.log", tail: 200, level: "warning" })` — warnings and above
- `reduce_log({ file: "app.log", tail: 200, grep: "timeout|connection" })` — regex search
- `reduce_log({ file: "app.log", tail: 200, contains: "export_123" })` — literal string search
- `reduce_log({ file: "app.log", tail: 200, component: "database" })` — filter by module
- `reduce_log({ file: "app.log", tail: 500, time_range: "13:02-13:05" })` — time window
- `reduce_log({ file: "app.log", tail: 200 })` — full compressed output (only when needed)

### If the user pastes a log directly into chat

The raw text is already in your context — `reduce_log` cannot undo that. Remind the user:

    "Tip: next time use /logdump or save the log to a file and give me the path —
     that way the log gets compressed before it enters our conversation."
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
| `reduce_log` | `file` (path) or `log_text` (string), plus optional filters | Compressed log text |

The AI agent calls the tool, the server reads the file, runs the compression pipeline, and returns the reduced text. The raw log never enters the AI's context — only the compressed output does.

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
7. **Filter noise** — remove DEBUG/TRACE, health checks, heartbeats, devtools artifacts
8. **Strip source locations** — browser console `file.js:line` prefixes
9. **Collapse pip output** — summarize pip install runs
10. **Collapse Docker layers** — summarize Docker layer push/export lines
11. **Compact access logs** — compact HTTP access logs
12. **Compress prefix** — factor out repeated `timestamp - module - LEVEL` prefixes
13. **Deduplicate** — collapse consecutive similar lines with value templates
14. **Detect cycles** — collapse repeating multi-line blocks
15. **Merge scattered** — merge non-consecutive duplicate lines
16. **Fold repeated prefix** — fold repeated prefixes among consecutive lines
17. **Fold stack traces** — collapse framework frames, shorten paths
18. **Collapse retries** — collapse near-duplicate retry blocks

## Filter Parameters

All filters are optional. When multiple filters are specified, they combine via OR — any line matching any active filter is included.

| Parameter | Type | Description |
|-----------|------|-------------|
| `file` | string | Path to log file (preferred — keeps raw log out of context) |
| `log_text` | string | Raw log text (use only for small snippets) |
| `tail` | number | Only process the last N lines of input |
| `level` | string | Minimum log level: `"error"`, `"warning"`, `"info"` |
| `grep` | string | Regex pattern to match lines |
| `contains` | string | Literal substring to match lines |
| `component` | string | Filter by logger/module name |
| `time_range` | string | Time window, e.g. `"13:02-13:05"` |
| `context` | number | Lines to show before/after each matched line (default 3) |

## Chaining with Other MCP Tools

If your project uses other MCPs that produce log output (Playwright, Docker, Kubernetes, etc.), the AI can chain them with Log Reducer so raw logs never enter context. The key is redirecting the output to a file first.

### The pattern

```
1. Other MCP produces output → AI redirects to a temp file (never reads it)
2. AI calls reduce_log({ file: "/tmp/output.log", tail: 200, level: "error" })
3. Only compressed output enters context
```

### Example: Playwright MCP

Add this to your CLAUDE.md instructions:

```markdown
### Chaining with other tools

When running commands or tools that produce log output (Playwright, Docker, test runners,
build tools), **always redirect output to a temp file** before reading it:

    # Playwright test output
    npx playwright test 2>&1 > /tmp/playwright.log
    reduce_log({ file: "/tmp/playwright.log", tail: 200, level: "error" })

    # Docker build output
    docker build . 2>&1 > /tmp/docker-build.log
    reduce_log({ file: "/tmp/docker-build.log", tail: 200, level: "error" })

    # Any MCP tool that returns verbose text — save to file, then reduce
    # NEVER read the raw output into context first

This applies to ANY source of verbose output — shell commands, MCP tool results, or
files on disk. The rule is simple: if it's more than ~20 lines, compress it first.
```

### Why this works

The `reduce_log` tool reads the file server-side and returns only the compressed text. The AI never sees the raw content. This means:

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

This compresses logs by 70-90% while preserving all errors, warnings, and meaningful events.
```

## Verifying the Integration

After setup, restart Claude Code in your project directory. You can verify the tool is registered:

1. Start a conversation and ask: "What MCP tools do you have access to?"
2. The AI should list `reduce_log` among its available tools
3. Test it: create a sample log file and ask the AI to "check the errors in test.log"
4. The AI should call `reduce_log({ file: "test.log", tail: 200, level: "error" })` instead of reading the file directly

## Testing

The log-reducer project includes integration tests that verify the full MCP protocol:

```bash
cd /path/to/log-reducer
npm test
```

This runs fixture tests (verifying transform output) and MCP server tests (spawning the server, performing the JSON-RPC handshake, and verifying tool listing + log reduction).
