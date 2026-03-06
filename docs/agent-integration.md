# Integrating Log Reducer into Your Project

Log Reducer is an MCP (Model Context Protocol) tool and CLI that compresses log files before they enter an AI's context window. This guide shows how to add it to your own project so your AI agent automatically reduces logs instead of reading them raw.

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
## Log handling — IMPORTANT: read this before touching any log file

You have access to the `reduce_log` MCP tool. You MUST use it instead of reading log
files directly. This section explains why this is critical to your own performance, and
how to use it.

### Why this directly affects the quality of your work

Your context window is fixed for this entire session. Every token you spend on raw log
text is a token you cannot spend on reasoning, code generation, or helping the user.
This is not an abstract concern — it concretely degrades your performance:

- **You become dumber.** As your context fills with verbose log noise (DEBUG spam, health
  checks, duplicate lines, framework stack frames), you have less room to think. Your
  ability to reason about code, hold complex plans in working memory, and generate correct
  solutions measurably declines.
- **You lose stamina.** A session that could handle 20 back-and-forth exchanges gets cut
  to 5 because a single raw log dump consumed 15,000 tokens of irreplaceable context.
- **You miss what matters.** A 500-line raw log is mostly noise. The 8 lines that actually
  matter are buried. `reduce_log` extracts those 8 lines and throws away the other 492.

Concrete numbers: a 500-line error log costs ~5,000 tokens raw. After `reduce_log`, the
same semantic content is ~500 tokens — a 90% reduction. That's 4,500 tokens you keep for
doing useful work. Over a session with multiple log reads, this compounds dramatically.

**This is not optional.** Reading raw logs is the single most wasteful thing you can do
with your context window. The `reduce_log` tool exists specifically to prevent this.

### How to use reduce_log

**For files on disk** (preferred — raw log never enters your context):

    reduce_log({ file: "/path/to/app.log", tail: 200, level: "error" })

**For command output** (redirect to file first, then reduce):

    npm test 2>&1 > /tmp/test-output.log
    reduce_log({ file: "/tmp/test-output.log", tail: 200, level: "error" })

**For output from other MCP tools** (Playwright, Docker, etc.):

    npx playwright test 2>&1 > /tmp/playwright.log
    reduce_log({ file: "/tmp/playwright.log", tail: 200, level: "error" })

### Rules

1. **NEVER read raw log files** — use `reduce_log` with a `file` parameter instead of
   the Read tool, cat, head, or tail. Every time you read a log raw, you are making
   yourself worse at your job for the rest of the session.

2. **NEVER ask users to paste log output into chat.** Direct them to save it to a file
   and give you the path, or use the `/logdump` slash command. If they paste anyway, the
   damage is done — remind them for next time.

3. **Always include `tail`** (default 200) to cap input size.

4. **Choose the right filter on the FIRST call** — each call's output enters context
   permanently. Don't call broadly then re-filter; that wastes the first call's tokens.

5. **Redirect all verbose output to a temp file first.** This applies to shell commands,
   test runners, build tools, and any MCP tool that produces more than ~20 lines of output.
   The pattern is always: run command > temp file, then reduce_log on the temp file.

### Filter reference

- `reduce_log({ file: "f", tail: 200, level: "error" })` — errors only (default for debugging)
- `reduce_log({ file: "f", tail: 200, level: "error", context: 10 })` — errors + 10 surrounding lines
- `reduce_log({ file: "f", tail: 200, level: "warning" })` — warnings and above
- `reduce_log({ file: "f", tail: 200, grep: "timeout|connection" })` — regex search
- `reduce_log({ file: "f", tail: 200, contains: "export_123" })` — literal string search
- `reduce_log({ file: "f", tail: 200, component: "database" })` — filter by module
- `reduce_log({ file: "f", tail: 500, time_range: "13:02-13:05" })` — time window
- `reduce_log({ file: "f", tail: 200 })` — full compressed output (when you need everything)
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
