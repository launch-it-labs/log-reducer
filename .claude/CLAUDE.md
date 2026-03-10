# Log Reducer — Claude Code Instructions

## PR workflow

When asked to merge a PR, always use `gh pr merge --merge --admin` without asking for confirmation. Branch protection requires admin override on this repo.

This project includes a **reduce_log** MCP tool that reduces log text for AI consumption (50-90% token reduction).

## Log handling

Use `reduce_log` instead of Read/cat/head/tail for any log file. Always include `tail` (200-2000) to cap input size. Redirect verbose command output to a file first, then reduce it. Never ask users to paste logs — tell them to type `/logdump` or give a file path.

The tool has a token threshold (default 1000). If output exceeds it, you'll receive guidance on how to narrow — follow the guidance. See [filter reference](docs/agent-integration.md#filter-parameters).

## Integration guide for consuming projects

### Setup

Add the MCP server to the consuming project's `.claude/settings.json`:

```json
{ "mcpServers": { "logreducer": { "command": "node", "args": ["/absolute/path/to/logcompressor/out/src/mcp-server.js"] } } }
```

### How to provide logs (for you, the human user)

**The #1 rule: never paste raw logs into the chat.** If you paste a log into the chat
window, it enters the AI's context as raw text — the MCP cannot un-do that. The whole
point of the `file` parameter is that only the reduced output enters context.

**Instead, give the AI a file path:**

- **Log is already a file on disk** — just say:
  *"check the errors in C:\logs\app.log"* or *"what failed in /var/log/myapp.log"*

- **Log is command output** — redirect it to a file, then reference the file:
  ```
  npm test 2>&1 > /tmp/test.log
  ```
  Then tell the AI: *"check the errors in /tmp/test.log"*

- **Log is on your clipboard** — type `/logdump` in the chat.
  This dumps your clipboard to a file and runs `reduce_log` on it automatically.
  The raw log never enters the conversation.

  (Or manually: `powershell -command "Get-Clipboard | Set-Content C:\tmp\log.txt"`
  then tell the AI: *"check errors in C:\tmp\log.txt"*)

The AI is instructed to call `reduce_log({ file: "...", tail: 200, level: "error" })`
on the path you give it. Only the reduced, filtered output enters the conversation.

### Slash command for clipboard logs

Copy `.claude/commands/logdump.md` into the consuming project. This gives users a
`/logdump` command that dumps their clipboard to a temp file and runs
`reduce_log` on it — the raw log never enters the conversation.

For Mac/Linux projects, edit the command file to use `pbpaste` or `xclip` instead
of the PowerShell command.

### Instructions for the AI (add to consuming project's CLAUDE.md)

Copy the block from [section 3 above](#3-add-ai-instructions-to-your-claudemd) in `docs/agent-integration.md` into your project's `.claude/CLAUDE.md`.

## Evaluating pasted log files

**CRITICAL — Output first, analyze later.** When the user pastes a log file, your absolute #1 priority is getting the reduced output displayed to the user **immediately**. The user is waiting for this output to continue their own work.

**Procedure:**
1. Save the log to `test/fixtures/tmp-eval/input.log` using the Write tool (read it first if needed).
2. Run the pipeline in a single Bash call: `node out/src/cli.js < test/fixtures/tmp-eval/input.log > test/fixtures/tmp-eval/actual.log`
3. Read and display `test/fixtures/tmp-eval/actual.log` to the user immediately. Always include a link to the output file so the user can open it directly: `test/fixtures/tmp-eval/actual.log`.
4. **STOP HERE** and let the user see the output. Do NOT do any analysis, evaluation, ideal-output generation, or thinking before showing the output. The output display must be the very first thing the user sees.

Skip `npm run compile` unless you just edited source files — the compiled JS is usually already up to date.

Only **after** the user has received the output file, continue with the evaluation workflow below.

When the user pastes a log file into the conversation, run the full evaluation workflow below. The pasted log is treated as **raw input** — it may or may not have been processed already.

### Step 1 — Determine the ideal output

Read the pasted log and produce the **ideal** reduced version by hand (as text in the conversation). The ideal output:

- **Preserves every piece of semantic information**: errors, warnings, state changes, unique events, config values, version numbers, meaningful status messages.
- **Eliminates all redundancy**: duplicate lines, repeated blocks, boilerplate, noise, unnecessary verbosity.
- **Uses minimal tokens**: collapse where possible, abbreviate where meaning is retained, remove anything a reader would skip.

Count tokens in the original and in the ideal using whitespace-split: `text.split(/\s+/).filter(t => t.length > 0).length`. Report both counts.

### Step 2 — Run the actual pipeline with the eval tool

1. Save the pasted log to `test/fixtures/tmp-eval/input.log`.
2. Compile: `npm run compile`.
3. Run the eval tool: `node out/src/eval.js test/fixtures/tmp-eval/input.log > test/fixtures/tmp-eval/actual.log`.
4. The eval tool prints a **per-transform metrics table** to stderr showing token/line/char counts at each pipeline step and which transforms had no effect.
5. Read `test/fixtures/tmp-eval/actual.log` to get the actual pipeline output.

### Step 3 — Compare actual vs ideal

Diff the actual pipeline output against the ideal output. For every meaningful difference, determine:

- Where the pipeline output is **more verbose** than ideal (missed reduction opportunity).
- Where the pipeline **removed something it shouldn't have** (semantic loss).

### Step 4 — Report findings

Present a table of all gaps between actual and ideal:

| # | Actual (pipeline output) | Ideal (target) | Transform | Token savings | Generality |
|---|--------------------------|-----------------|-----------|---------------|------------|
| 1 | exact lines from actual  | what ideal looks like | existing transform name or "new transform" | est. tokens saved | High / Med / Low |

**Sort by token savings** (largest first).

**Generality scoring** (how broadly useful is this fix?):
- **High**: pattern appears across many log formats (generic timestamps, common framework boilerplate, standard HTTP headers). Safe to implement.
- **Medium**: pattern appears in a category of logs (Python tracebacks, Docker builds, npm output). Worth implementing with care.
- **Low**: pattern is specific to this particular application/log. Flag as **bias risk** — implementing it may not help (or may hurt) other logs.

### Step 5 — Summary stats

Report:
- **Original**: token count
- **Actual** (pipeline output): token count and % reduction
- **Ideal**: token count and % reduction
- **Gap**: tokens that could still be saved (actual − ideal)
- **Gap breakdown**: how much of the gap is High-generality vs Med vs Low

### Verification loop (REQUIRED)

After implementing code changes based on findings, you **must** re-run the full pipeline and verify the changes worked. Follow this process:

1. **Compile** (`npm run compile`).
2. **Run the eval tool** on the saved log: `node out/src/eval.js test/fixtures/tmp-eval/input.log > test/fixtures/tmp-eval/actual.log`.
3. **Compare the new actual output** against the ideal. For each finding:
   - Confirm the target lines are now reduced/removed as expected.
   - If a finding was **not** addressed, investigate why (regex miss, transform ordering, edge case) and fix.
4. **Re-run tests** (`npm test`) to make sure nothing regressed.
5. **Repeat steps 1-4** until all high/medium-generality findings are addressed or you can explain why a specific finding cannot be fixed without losing semantic information.
6. **Clean up**: remove `test/fixtures/tmp-eval/` when done.

Do not consider the task complete until this verification loop passes. Low-generality findings may be skipped with the user's approval.

### Step 6 — Create a PR (if improvements were made)

If you implemented any code changes from the evaluation:

1. **Create a test fixture** from the log sample:
   - Pick the next available fixture number (e.g., `16-description/`)
   - Copy `test/fixtures/tmp-eval/input.log` to `test/fixtures/NN-description/input.log`
   - Run the pipeline to generate `expected.log` for the new fixture
   - Register it in `test/runFixtures.ts`
   - Verify with `npm test`

2. **Create a branch and commit**:
   - Branch name: `improve/short-description` (e.g., `improve/nginx-access-logs`)
   - Commit message should summarize what patterns were added/improved
   - Include the new test fixture in the commit

3. **Push and create a PR** with:
   - Summary of the log source and patterns found
   - The eval stats (original tokens → actual tokens → ideal tokens)
   - Which findings were addressed (High/Medium) and which were skipped (Low) with reasons

This workflow means anyone can contribute by simply pasting a log — the AI handles the engineering, and the log becomes a permanent test fixture preventing regressions.

### Current transform pipeline (in order)

1. `stripAnsi` — ANSI escape codes
2. `normalizeWhitespace` — collapse blank lines, trim trailing spaces
3. `shortenIds` — UUIDs, hex strings, JWTs, generated IDs -> `$1`, `$2`, ...
4. `shortenUrls` — strip query params, collapse long path segments
5. `simplifyTimestamps` — shorten verbose timestamp formats
6. `filterNoise` — remove health checks, heartbeats, devtools noise, progress bars, Docker boilerplate, pip upgrade notices (DEBUG/TRACE kept — AI uses `level` filter to exclude)
7. `stripSourceLocations` — browser console `file.js:line` prefixes
8. `collapsePipOutput` — summarize pip Collecting/Downloading runs into compact package lists, strip elapsed-time prefixes
9. `collapseDockerLayers` — collapse runs of Docker layer push/export lines into a count with time range
10. `compressPrefix` — factor out repeated log prefixes, strip separators
11. `deduplicate` — collapse consecutive identical/near-identical lines
12. `detectCycles` — collapse repeating multi-line blocks
13. `foldStackTraces` — collapse framework frames, shorten file paths
14. `collapseRetries` — collapse near-duplicate retry blocks (e.g. Docker rebuild attempts) showing only diffs

## Project structure

- `src/pipeline.ts` — Main `minify()` function, ordered transform list
- `src/transforms/` — Individual transform modules (14 transforms)
- `src/cli.ts` — CLI wrapper (stdin/stdout)
- `src/eval.ts` — Evaluation CLI: per-transform metrics table (`npm run eval -- <file>`)
- `src/mcp-server.ts` — MCP server exposing `reduce_log`
- `test/fixtures/` — Test fixture directories (input.log + expected.log)

## Running tests

```
npm test
```

## Running the eval tool

```
node out/src/eval.js <file.log>          # metrics table to stderr, output to stdout
node out/src/eval.js <file.log> --score  # also run LLM semantic preservation check (needs ANTHROPIC_API_KEY)
```
