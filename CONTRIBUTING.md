# Contributing to Log Reducer

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [VS Code](https://code.visualstudio.com/) (for running and debugging the extension)

## Setup

```bash
git clone https://github.com/imankha/log-reducer.git
cd log-reducer
npm install
```

## Build

```bash
npm run compile    # one-time build
npm run watch      # rebuild on file save (useful during development)
```

## Test

```bash
npm test           # compiles then runs all fixture tests
```

Tests use fixture files under `test/fixtures/`. Each fixture folder contains:

- `input.log` — the raw log input
- `expected.log` — the expected pipeline output
- `actual.log` — generated at test time for inspection (gitignored)

The test runner compares `actual` against `expected` line by line and reports diffs for any mismatches.

## Run in VS Code

1. Open the project folder in VS Code
2. Press **F5** to launch an Extension Development Host
3. In the new window, copy a log to your clipboard and press `Ctrl+Alt+R`

The Output panel ("Log Reducer" channel) shows token counts and reduction percentages.

## Project Structure

```
src/
  extension.ts          VS Code entry point (clipboard, commands, UI)
  pipeline.ts           Runs transforms in order
  types.ts              Shared types and default options
  transforms/
    index.ts            Re-exports all transforms
    stripAnsi.ts        Remove ANSI escape codes
    normalizeWhitespace.ts  Collapse blank lines, trim trailing spaces
    shortenIds.ts       Replace UUIDs/hashes/tokens with $1, $2...
    simplifyTimestamps.ts   Shorten verbose timestamps
    filterNoise.ts      Remove DEBUG, health checks, heartbeats
    compressPrefix.ts   Factor out repeated log prefixes, strip separators
    deduplicate.ts      Collapse consecutive similar lines
    detectCycles.ts     Find repeating multi-line blocks
    foldStackTraces.ts  Collapse framework frames, shorten paths
test/
  runFixtures.ts        Test runner
  fixtures/             Test cases (01-strip-ansi, 02-normalize-whitespace, ...)
```

## Pipeline Order

Transforms run in this order (defined in `pipeline.ts`):

1. **stripAnsi** — remove escape codes so later patterns match clean text
2. **normalizeWhitespace** — consistent spacing before all other transforms
3. **shortenIds** — replace IDs so lines differing only by ID become identical for dedup
4. **simplifyTimestamps** — shorten timestamps so lines differing only by time become identical
5. **filterNoise** — remove low-signal lines before grouping/dedup
6. **compressPrefix** — factor out repeated prefixes (also strips separator lines)
7. **deduplicate** — collapse consecutive similar lines
8. **detectCycles** — collapse repeating multi-line blocks
9. **foldStackTraces** — collapse framework frames, runs last so it sees deduplicated output

Order matters. For example, filterNoise must run before compressPrefix so that separator lines don't break prefix groups, and shortenIds must run before deduplicate so lines differing only by ID are recognized as duplicates.

## Adding a New Transform

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

3. Add the setting to `PipelineOptions` in `src/types.ts` and to `DEFAULT_OPTIONS`

4. Add it to the `ALL_TRANSFORMS` array in `src/pipeline.ts` (order matters — see above)

5. Add `logreducer.yourTransform` to the `contributes.configuration.properties` in `package.json`

6. Add `yourTransform: config.get('yourTransform', true)` in `src/extension.ts`

7. Add a test fixture:
   - Create `test/fixtures/NN-your-transform/input.log` and `expected.log`
   - Register it in `test/runFixtures.ts`

8. Run `npm test` to verify

## Adding a Test Fixture

1. Create a new folder under `test/fixtures/` (e.g., `12-my-scenario/`)
2. Add `input.log` with the raw log content
3. Register the test in `test/runFixtures.ts`:
   ```typescript
   { name: '12-my-scenario', dir: '12-my-scenario', transform: null },
   ```
   Use `transform: null` for full-pipeline tests, or `transform: (s) => yourTransform.apply(s)` to test a single transform.
4. Run `npm test` — the test will fail and write `actual.log`
5. Inspect `actual.log`, and if it looks correct, copy it to `expected.log`
6. Run `npm test` again to confirm it passes
