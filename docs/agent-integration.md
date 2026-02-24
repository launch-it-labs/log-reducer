# AI Agent Integration

Log Reducer can be used by AI agents to automatically reduce log text before inserting it into conversations. This saves tokens and keeps context windows focused on the signal.

## Overview

There are two integration paths:

| Path | Protocol | Best for |
|------|----------|----------|
| **MCP server** | Model Context Protocol (stdio) | Claude Code — auto-registered, zero setup |
| **CLI** | stdin/stdout | Any agent that can run shell commands (Codex, Copilot, custom agents) |

Both call the same `minify()` function and produce identical output.

## MCP Server (Claude Code)

### How it works

The project includes an MCP server at `src/mcp-server.ts` that exposes a single tool:

| Tool | Input | Output |
|------|-------|--------|
| `reduce_log` | `log_text` (string) — raw log content | Reduced log text (50-90% fewer tokens) |

The server communicates over stdio using JSON-RPC, following the [Model Context Protocol](https://modelcontextprotocol.io/) specification.

### Auto-registration

When Claude Code opens the project, it reads `.claude/settings.json`:

```json
{
  "mcpServers": {
    "logreducer": {
      "command": "node",
      "args": ["out/src/mcp-server.js"]
    }
  }
}
```

This automatically registers the `reduce_log` tool — no manual configuration needed. Claude Code also reads `.claude/CLAUDE.md` for instructions on when to use the tool (large logs, error analysis, verbose command output).

### Setup

After cloning the repo:

```bash
npm install
npm run compile
```

The MCP server is ready. Restart Claude Code in the project directory and the `reduce_log` tool will appear.

### Manual registration

To use the MCP server from a different project or globally, add it to your Claude Code settings:

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

### Running standalone

You can start the MCP server directly for testing or use with other MCP clients:

```bash
npm run mcp
```

## CLI (Universal)

The CLI reads log text from stdin and writes the reduced version to stdout:

```bash
# Reduce a file
node out/src/cli.js < app.log > reduced.log

# Pipe from another command
kubectl logs my-pod | node out/src/cli.js
docker logs container-id 2>&1 | node out/src/cli.js

# After npm link
cat app.log | logreducer
```

Any AI agent that can execute shell commands can use this. The CLI exits with code 0 on success and 1 on error.

## Agent instruction files

The project includes instruction files that agents read automatically when they open the project:

| File | Read by | Purpose |
|------|---------|---------|
| `.claude/CLAUDE.md` | Claude Code | When and how to call `reduce_log` |
| `.claude/settings.json` | Claude Code | MCP server registration |
| `AGENTS.md` | OpenAI Codex, other agents | CLI usage instructions |
| `.github/copilot-instructions.md` | GitHub Copilot | CLI usage instructions |

These files travel with the repo — anyone who clones it gets the agent integration for free.

## What the tool does

The `reduce_log` tool / CLI applies the full Log Reducer pipeline:

1. Strip ANSI escape codes
2. Normalize whitespace
3. Shorten IDs (UUIDs, hex strings, JWTs, tokens, underscore IDs)
4. Shorten URLs (strip query params, collapse long paths)
5. Simplify timestamps
6. Filter noise (DEBUG lines, health checks, heartbeats, devtools artifacts)
7. Strip source locations (browser console `file.js:line` prefixes)
8. Compress shared prefixes
9. Deduplicate consecutive similar lines
10. Detect repeating multi-line cycles
11. Fold stack traces (collapse framework frames, shorten paths)

All transforms run with default settings (all enabled). The VS Code extension allows toggling individual transforms, but the CLI and MCP server always run the full pipeline.

## Testing the integration

The project includes 17 MCP integration tests that verify the full protocol:

```bash
npm test
```

This runs both the fixture tests (12) and the MCP server tests (17). The MCP tests spawn the server as a child process, perform the JSON-RPC handshake, and verify tool listing, log reduction, and error handling.

You can also test manually:

```bash
# CLI
echo "2024-01-15T10:30:45.123Z [INFO] Request abc12345-def6-7890-abcd-ef1234567890 started" | node out/src/cli.js
# Output: 10:30:45 [INFO] Request $1 started
```
