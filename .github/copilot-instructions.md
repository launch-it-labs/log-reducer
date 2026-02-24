# Log Reducer — Copilot Instructions

This repository contains a log reduction CLI tool. When working with log files in this project, you can reduce them using:

```bash
node out/src/cli.js < input.log
```

This compresses logs by 50-90% (strips noise, deduplicates, shortens IDs/URLs, folds stack traces) while preserving semantic meaning. Use it before pasting large logs (>50 lines) into conversations.

The main API is `minify(input: string): string` exported from `src/pipeline.ts`.
