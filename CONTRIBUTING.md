# Contributing to Log Reducer

There are two ways to contribute — and the easiest one requires zero code knowledge.

## Option 1: Paste a log (no code required)

The single most valuable thing you can do is **give us a log file we haven't seen before**. Every new log format helps the pipeline handle more real-world cases.

### How it works

1. Clone the repo and open it in Claude Code (or any AI editor with MCP support)
2. Paste your log into the chat
3. The AI automatically:
   - Runs the pipeline and shows you the compressed output
   - Compares actual output against an ideal reduction
   - Identifies gaps — patterns the pipeline misses or over-reduces
   - Implements **high-generality** fixes (patterns that help many log formats, not just yours)
   - Runs tests to verify nothing regressed
   - Creates a PR with the improvements and a new test fixture from your log

That's it. You paste a log, the AI does the engineering work. Your log becomes a permanent test fixture that prevents future regressions.

### What makes a good log sample?

- **Diverse formats**: Python tracebacks, Java stack traces, Docker builds, CI/CD output, Kubernetes logs, browser console output, Nginx access logs — anything the pipeline hasn't seen
- **Real-world messiness**: Interleaved output, ANSI color codes, progress bars, mixed log levels, retry loops
- **100-500 lines** is the sweet spot — enough to show patterns, not so much that it's unwieldy
- **Scrub secrets first**: Remove API keys, passwords, tokens, and personal data before pasting. The log will become a public test fixture.

### What the AI won't do

- **Low-generality fixes** are flagged but skipped — patterns specific to one application risk hurting other logs
- **Semantic loss** is never acceptable — if a fix would remove meaningful information, the AI rejects it
- Changes that break existing tests are caught and reverted

### Without Claude Code

If you don't use Claude Code, you can still contribute logs:

1. [Open an issue](https://github.com/launch-it-labs/log-reducer/issues/new?template=log-sample.yml) with the `log-sample` template
2. Paste your log (scrub secrets first)
3. A maintainer will run it through the eval workflow

## Option 2: Code contributions

### Prerequisites

- [Node.js](https://nodejs.org/) v18+

### Setup

```bash
git clone https://github.com/launch-it-labs/log-reducer.git
cd log-reducer
npm install
```

### Build

```bash
npm run compile    # one-time build
npm run watch      # rebuild on file save (useful during development)
```

### Test

```bash
npm test           # compiles then runs all fixture tests + MCP tests
```

Tests use fixture files under `test/fixtures/`. Each fixture folder contains:

- `input.log` — the raw log input
- `expected.log` — the expected pipeline output
- `actual.log` — generated at test time for inspection (gitignored)

The test runner compares `actual` against `expected` line by line and reports diffs for any mismatches.

### Project Structure

```
src/
  pipeline.ts           Runs transforms in order, exports minify()
  types.ts              Shared types (Transform, SettingKey, PipelineOptions)
  skeleton.ts           Line skeleton utility for deduplication
  cli.ts                CLI wrapper (stdin/stdout)
  mcp-server.ts         MCP server exposing reduce_log tool
  eval.ts               Evaluation CLI with per-transform metrics
  transforms/
    index.ts            Re-exports all transforms
    stripAnsi.ts        Remove ANSI escape codes
    normalizeWhitespace.ts  Collapse blank lines, trim trailing spaces
    shortenIds.ts       Replace UUIDs/hashes/tokens/underscore IDs with $1, $2...
    shortenUrls.ts      Strip query params, collapse long URL paths
    simplifyTimestamps.ts   Shorten verbose timestamps
    filterNoise.ts      Remove health checks, heartbeats, devtools noise
    stripSourceLocations.ts  Strip browser console file.js:line prefixes
    compressPrefix.ts   Factor out repeated log prefixes, strip separators
    deduplicate.ts      Collapse consecutive similar lines
    detectCycles.ts     Find repeating multi-line blocks
    foldStackTraces.ts  Collapse framework frames, shorten paths
    collapsePipOutput.ts    Summarize pip install output
    collapseDockerLayers.ts Collapse Docker layer push/export lines
    collapseRetries.ts  Collapse near-duplicate retry blocks
    stripEnvelope.ts    Strip redundant log envelope prefixes
    mergeScattered.ts   Merge non-consecutive duplicate lines
    compactAccessLogs.ts    Compact HTTP access logs
    foldRepeatedPrefix.ts   Fold repeated prefixes among consecutive lines
    stackTrace/
      frameworkPatterns.ts  Framework detection arrays and helpers
      pathShortener.ts      Path shortening utilities
test/
  runFixtures.ts        Fixture test runner
  testMcpServer.ts      MCP server integration tests
  fixtures/             Test cases (01-strip-ansi through 18-collapse-test-status)
```

### Pipeline Order

Transforms run in this order (defined in `pipeline.ts`):

1. **stripAnsi** — remove escape codes so later patterns match clean text
2. **normalizeWhitespace** — consistent spacing before all other transforms
3. **shortenIds** — replace IDs so lines differing only by ID become identical for dedup
4. **shortenUrls** — strip query params and collapse long paths before dedup
5. **simplifyTimestamps** — shorten timestamps so lines differing only by time become identical
6. **stripEnvelope** — strip redundant log envelope prefixes
7. **filterNoise** — remove low-signal lines before grouping/dedup
8. **stripSourceLocations** — remove browser console `file.js:line` prefixes
9. **collapseTestStatus** — collapse runs of 3+ PASS lines (Jest, Go test, pytest) into count; FAIL preserved
10. **collapsePipOutput** — summarize pip install output
11. **collapseDockerLayers** — collapse Docker layer lines
12. **compactAccessLogs** — compact HTTP access logs
13. **compressPrefix** — factor out repeated prefixes
14. **deduplicate** — collapse consecutive similar lines
15. **detectCycles** — collapse repeating multi-line blocks
16. **mergeScattered** — merge non-consecutive duplicate lines
17. **foldRepeatedPrefix** — fold repeated prefixes among consecutive lines
18. **foldStackTraces** — collapse framework frames and native hex-address crash frames, runs late so it sees deduplicated output
19. **collapseRetries** — collapse near-duplicate retry blocks

Order matters. For example, filterNoise must run before compressPrefix so that separator lines don't break prefix groups, and shortenIds must run before deduplicate so lines differing only by ID are recognized as duplicates.

### Adding a New Transform

1. Create `src/transforms/yourTransform.ts` implementing the `Transform` interface:
   ```typescript
   import { Transform } from '../types';

   export const yourTransform: Transform = {
     name: 'Your Transform',
     settingKey: 'yourTransform',
     apply(input: string): string {
       // transform the input string and return the result
       return input;
     },
   };
   ```

2. Export it from `src/transforms/index.ts`

3. Add the `settingKey` to the `SettingKey` union type in `src/types.ts`

4. Add it to the `ALL_TRANSFORMS` array in `src/pipeline.ts` (order matters — see above). `DEFAULT_OPTIONS` is derived automatically from this array.

5. Add a test fixture:
   - Create `test/fixtures/NN-your-transform/input.log` and `expected.log`
   - Register it in `test/runFixtures.ts`

6. Run `npm test` to verify

### Adding a Test Fixture

1. Create a new folder under `test/fixtures/` (e.g., `16-my-scenario/`)
2. Add `input.log` with the raw log content
3. Register the test in `test/runFixtures.ts`:
   ```typescript
   { name: '16-my-scenario', transform: null },
   ```
   Use `transform: null` for full-pipeline tests, or `transform: findTransform('yourSettingKey')` to test a single transform.
4. Run `npm test` — the test will fail and write `actual.log`
5. Inspect `actual.log`, and if it looks correct, copy it to `expected.log`
6. Run `npm test` again to confirm it passes
