# Log Reducer — Claude Code Instructions

This project includes a **reduce_log** MCP tool that reduces log text for AI consumption (50-90% token reduction).

## When to use reduce_log

- Before pasting large log files (>50 lines) into the conversation
- When asked to analyze logs, errors, or stack traces from files
- When reading log output from commands that produce verbose output

## How to use

**Preferred — file path (keeps raw logs out of LLM context):**

```
reduce_log({ file: "/path/to/logfile.log" })
```

**Alternative — inline text (for small snippets only):**

```
reduce_log({ log_text: "<raw log content>" })
```

The tool strips ANSI codes, deduplicates repeated lines, shortens UUIDs/tokens/URLs, folds stack traces, and removes noise — preserving all semantic meaning.

### Investigation strategy — the funnel pattern

Use a multi-step approach. Each call should fetch NEW information informed by the previous result.

**Step 1: SURVEY** — get the lay of the land (~50 tokens)
```
reduce_log({ file: "app.log", tail: 2000, summary: true })
```
Returns: total lines, time span, error/warn/info/debug counts with timestamps, components found, and timestamps of each error. Use this to plan your next query.

**Step 2: SCAN** — see the first few errors (~200 tokens)
```
reduce_log({ file: "app.log", tail: 2000, level: "error", limit: 5 })
```
Returns: first 5 errors with 3 lines of context each. The output header tells you how many total matches exist (e.g., "[showing matches 1-5 of 23 total]").

**Step 3: ZOOM** — get deep context around a specific error (~500 tokens)
```
reduce_log({ file: "app.log", tail: 2000, time_range: "13:02:30-13:02:45", before: 50, after: 5 })
```
Use a timestamp from Step 2's output. `before: 50` gives you the 50 lines leading up to the error — the causal chain. `after: 5` shows immediate consequences.

**Step 4: TRACE** — follow a specific thread (~300 tokens)
```
reduce_log({ file: "app.log", tail: 2000, grep: "pool|connection", time_range: "13:00-13:05", limit: 15, context: 0 })
```
Combine grep with time_range to trace a concept through a time window. Use `limit` to cap matches and `context: 0` to avoid pulling in noise between matches.

Total cost: ~1000 tokens instead of 5000+ from a blind dump.

### Focus filter reference

Always include `tail` to cap input size (default recommendation: 200).

```
// Inclusion filters (combine via OR — any match is shown with context)
reduce_log({ file: "app.log", tail: 200, level: "error" })                        // Errors only
reduce_log({ file: "app.log", tail: 200, level: "warning" })                      // Warnings and above
reduce_log({ file: "app.log", tail: 200, grep: "timeout|connection" })            // Regex search
reduce_log({ file: "app.log", tail: 200, contains: "export_123" })                // Literal string search
reduce_log({ file: "app.log", tail: 200, component: "database" })                 // Filter by logger/module
reduce_log({ file: "app.log", tail: 500, time_range: "13:02-13:05" })             // Time window

// Context control
reduce_log({ file: "app.log", tail: 200, level: "error", context: 10 })           // 10 lines before AND after
reduce_log({ file: "app.log", tail: 200, level: "error", before: 50, after: 5 })  // Asymmetric: 50 before, 5 after

// Pagination
reduce_log({ file: "app.log", tail: 200, level: "error", limit: 5 })              // First 5 errors
reduce_log({ file: "app.log", tail: 200, level: "error", limit: 5, skip: 5 })     // Errors 6-10

// Exclusion
reduce_log({ file: "app.log", tail: 200, level: "error", not_grep: "health.check" })  // Errors, excluding health checks

// Structural overview
reduce_log({ file: "app.log", tail: 2000, summary: true })                        // Counts, timestamps, components

// Unreduced output (when you need exact original text)
reduce_log({ file: "app.log", tail: 200, level: "error", reduce: false })         // Raw lines, focus filters still applied

// Line capping
reduce_log({ file: "app.log", head: 100 })                                        // First 100 lines (startup/config)
reduce_log({ file: "app.log", tail: 500, head: 200 })                             // Last 500 lines, then first 200 of those
```

Every response includes a token count header like `[150 tokens (raw input: 2000 tokens)]`.
Use this to judge whether the reduced output is sufficient. If you need exact original
wording (to reproduce a command, read a config value, or see exact error messages), re-query
the same filters with `reduce: false`.

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

Copy the block below into your project's `.claude/CLAUDE.md`. This is the text the AI
reads — it explains *why* using `reduce_log` is in the AI's own self-interest (not just
a rule to follow), which dramatically increases compliance.

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

### How to use reduce_log — the funnel pattern

**Do NOT dump the whole log. Investigate step by step.** Each call's output enters your
context permanently, so every query should fetch NEW information informed by the last.

**Step 1: SURVEY** — get the structural overview (~50 tokens)

    reduce_log({ file: "/path/to/app.log", tail: 2000, summary: true })

Returns: total lines, time span, error/warn/info/debug counts with first/last timestamps,
error locations as timestamps, and components found. Use this to plan your next query.

**Step 2: SCAN** — see the first few errors (~200 tokens)

    reduce_log({ file: "/path/to/app.log", tail: 2000, level: "error", limit: 5 })

Returns first 5 errors with context. Output header says "[showing matches 1-5 of 23 total]"
so you know how many remain. Note the timestamps of interesting errors for Step 3.

**Step 3: ZOOM** — deep context around a specific error (~500 tokens)

    reduce_log({ file: "/path/to/app.log", tail: 2000, time_range: "13:02:30-13:02:45", before: 50, after: 5 })

Use a timestamp from Step 2. `before: 50` shows the 50 lines leading up to the error —
the causal chain. This is where you find root causes.

**Step 4: TRACE** — follow a specific thread (~300 tokens)

    reduce_log({ file: "/path/to/app.log", tail: 2000, grep: "pool|connection", time_range: "13:00-13:05", limit: 15, context: 0 })

Combine grep with time_range to trace a concept through a time window. Use `limit` to
cap matches and `context: 0` to avoid pulling in noise between matches. Confirms your
hypothesis.

**For command output** — redirect to file first, then use the funnel:

    npm test 2>&1 > /tmp/test-output.log
    reduce_log({ file: "/tmp/test-output.log", tail: 2000, summary: true })

### Rules

1. **NEVER read raw log files** — use `reduce_log` with a `file` parameter instead of
   the Read tool, cat, head, or tail. Every time you read a log raw, you are making
   yourself worse at your job for the rest of the session.

2. **NEVER ask users to paste log output into chat.** Direct them to save it to a file
   and give you the path, or use the `/logdump` slash command. If they paste anyway, the
   damage is done — remind them for next time.

3. **Always include `tail`** (default 200-2000 depending on file size) to cap input size.

4. **Start with `summary: true`** for any log >100 lines. It costs ~50 tokens and tells
   you exactly where to look. Skipping the survey and guessing wastes tokens.

5. **Always use `limit`** on SCAN and TRACE queries (5-15 matches). Without a limit,
   cascading errors can flood your context. You can always paginate with `skip` if you
   need more. For TRACE, also use `context: 0` to avoid pulling in noise between matches.

6. **Each follow-up should fetch NEW data.** Once data enters context, it's paid for.
   Don't re-request overlapping time ranges or re-filter what you already have. Narrow
   your queries using timestamps from previous results.

7. **Redirect all verbose output to a temp file first.** This applies to shell commands,
   test runners, build tools, and any MCP tool that produces more than ~20 lines of output.

### Filter reference

    // Structural overview (ALWAYS start here for large logs)
    reduce_log({ file: "f", tail: 2000, summary: true })

    // Inclusion filters (combine via OR)
    reduce_log({ file: "f", tail: 200, level: "error" })                        // errors only
    reduce_log({ file: "f", tail: 200, level: "warning" })                      // warnings and above
    reduce_log({ file: "f", tail: 200, grep: "timeout|connection" })            // regex search
    reduce_log({ file: "f", tail: 200, contains: "export_123" })                // literal string
    reduce_log({ file: "f", tail: 200, component: "database" })                 // filter by module
    reduce_log({ file: "f", tail: 500, time_range: "13:02-13:05" })             // time window

    // Context control
    reduce_log({ file: "f", tail: 200, level: "error", context: 10 })           // 10 lines each side
    reduce_log({ file: "f", tail: 200, level: "error", before: 50, after: 5 })  // asymmetric context

    // Pagination (navigate through matches without loading them all)
    reduce_log({ file: "f", tail: 200, level: "error", limit: 5 })              // first 5 errors
    reduce_log({ file: "f", tail: 200, level: "error", limit: 5, skip: 5 })     // errors 6-10

    // Exclusion (remove known noise from results)
    reduce_log({ file: "f", tail: 200, level: "error", not_grep: "health.check|heartbeat" })

    // Unreduced output (when you need exact original text)
    reduce_log({ file: "f", tail: 200, level: "error", reduce: false })         // raw lines, filters still applied

    // Line capping
    reduce_log({ file: "f", head: 100 })                                        // first 100 lines (startup)
    reduce_log({ file: "f", tail: 200 })                                        // full reduced output

Every response includes a token count header: `[150 tokens (raw input: 2000 tokens)]`.
Use this to judge if reduction is sufficient. Re-query with `reduce: false` only when
you need exact original wording (commands, config values, unparam­eterized error messages).
```

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
6. `filterNoise` — remove DEBUG lines, health checks, heartbeats, devtools noise, progress bars, Docker boilerplate, pip upgrade notices
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
