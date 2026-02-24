# Log Reducer — Claude Code Instructions

This project includes a **reduce_log** MCP tool that compresses log text for AI consumption (50-90% token reduction).

## When to use reduce_log

- Before pasting large log files (>50 lines) into the conversation
- When asked to analyze logs, errors, or stack traces from files
- When reading log output from commands that produce verbose output

## How to use

Call the `reduce_log` MCP tool with the raw log text:

```
reduce_log({ log_text: "<raw log content>" })
```

The tool strips ANSI codes, deduplicates repeated lines, shortens UUIDs/tokens/URLs, folds stack traces, and removes noise — preserving all semantic meaning.

## Project structure

- `src/pipeline.ts` — Main `minify()` function, ordered transform list
- `src/transforms/` — Individual transform modules (11 transforms)
- `src/cli.ts` — CLI wrapper (stdin/stdout)
- `src/mcp-server.ts` — MCP server exposing `reduce_log`
- `test/fixtures/` — Test fixture directories (input.log + expected.log)

## Running tests

```
npm test
```
