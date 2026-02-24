# Log Reducer — Agent Instructions

This repository contains a log reduction tool that compresses verbose log output for AI consumption, achieving 50-90% token reduction while preserving semantic value.

## Available tool

**CLI** (works with any agent that can execute shell commands):

```bash
node out/src/cli.js < input.log
```

Or pipe from another command:

```bash
some-command 2>&1 | node out/src/cli.js
```

The CLI reads log text from stdin and writes the reduced version to stdout.

## When to reduce logs

Use the log reducer before inserting log content into a conversation whenever:

- The log is longer than ~50 lines
- The log contains UUIDs, tokens, or long hex strings
- The log has repeated/duplicated lines
- The log contains stack traces with framework internals

## What it does

The pipeline applies 11 transforms in order:

1. Strip ANSI escape codes
2. Normalize whitespace (collapse blank lines, trim trailing spaces)
3. Shorten IDs (UUIDs, hex strings, JWT tokens, generated IDs → `$1`, `$2`, ...)
4. Shorten URLs (strip query params, collapse long paths)
5. Simplify timestamps
6. Filter noise (DEBUG lines, health checks, heartbeats, devtools artifacts)
7. Strip source locations (browser console `file.js:line` prefixes)
8. Compress shared prefixes (factor out repeated date/module/time prefixes)
9. Deduplicate consecutive identical/near-identical lines
10. Detect repeating multi-line cycles
11. Fold stack traces (collapse framework internals, shorten file paths)

## Project structure

- `src/pipeline.ts` — `minify(input: string): string` — the main entry point
- `src/transforms/` — Individual transform modules
- `src/cli.ts` — CLI stdin/stdout wrapper
- `src/mcp-server.ts` — MCP server for Claude Code
- `test/fixtures/` — Test fixtures (input.log + expected.log pairs)

## Building

```bash
npm install
npx tsc -p ./
```

## Testing

```bash
npm test
```

## For Claude Code users

This project includes an MCP server configuration in `.claude/settings.json` that automatically exposes a `reduce_log` tool. See `.claude/CLAUDE.md` for details.
