# Log Reducer

A VS Code extension that reduces log files for AI consumption. Copy a noisy log, hit a shortcut, and get back a clean version that preserves the signal while cutting the token count — typically by 50-70%.

## Before & After

**Input** (164 lines, 1185 tokens):
```
INFO:     127.0.0.1:58756 - "GET /api/settings HTTP/1.1" 200 OK
INFO:     127.0.0.1:58761 - "GET /api/games/pending-uploads HTTP/1.1" 200 OK
...
ERROR:    Exception in ASGI application
  + Exception Group Traceback (most recent call last):
  |   File "C:\Users\me\project\src\backend\.venv\Lib\site-packages\starlette\_utils.py", line 79, in collapse_excgroups
  |     yield
  |   File "C:\Users\me\project\src\backend\.venv\Lib\site-packages\uvicorn\protocols\http\httptools_impl.py", line 426, in run_asgi
  |     result = await app(  # type: ignore[func-returns-value]
  |              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  ...80 more framework frames...
  |   File "C:\Users\me\project\src\backend\app\routers\exports.py", line 745, in list_unacknowledged_exports
  |     exports=[

The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  ...entire traceback repeated again...
```

**Output** (53 lines, 396 tokens — 67% reduction):
```
INFO:     127.0.0.1:58756 - "GET /api/settings HTTP/1.1" 200 OK
INFO:     127.0.0.1:58761 - "GET /api/games/pending-uploads HTTP/1.1" 200 OK
...
ERROR:    Exception in ASGI application
  + Exception Group Traceback (most recent call last):
  |   [... 3 framework frames (starlette, anyio) omitted ...]
  | ExceptionGroup: unhandled errors in a TaskGroup (1 sub-exception)
  +-+---------------- 1 ----------------
    | Traceback (most recent call last):
    |   [... 10 framework frames (uvicorn, fastapi, starlette, contextlib) omitted ...]
    |   File "app/middleware/db_sync.py", line 107, in dispatch
    |     response = await call_next(request)
    |   [... 6 framework frames (starlette, contextlib) omitted ...]
    |   File "app/main.py", line 97, in dispatch
    |     response = await call_next(request)
    |   [... 16 framework frames (starlette, fastapi) omitted ...]
    |   File "app/routers/exports.py", line 745, in list_unacknowledged_exports
    |     exports=[
    |   File "app/routers/exports.py", line 746, in <listcomp>
    |     ExportJobResponse(
    |   File "pydantic/main.py", line 250, in __init__
    |     validated_self = self.__pydantic_validator__.validate_python(data, self_instance=self)
    | pydantic_core._pydantic_core.ValidationError: 1 validation error for ExportJobResponse
    | project_id
    |   Input should be a valid integer [type=int_type, input_value=None, input_type=NoneType]
    +------------------------------------

The above exception was the direct cause of the following exception:

Traceback (most recent call last):
  [... duplicate traceback omitted ...]
```

All user code frames, error messages, and file/line references are preserved. Framework boilerplate and duplicate tracebacks are collapsed.

## Usage

1. Copy a log to your clipboard
2. Press `Ctrl+Alt+R` (`Cmd+Alt+R` on Mac)
3. Two tabs open side-by-side: original on the left, compressed on the right
4. The compressed output is also written back to your clipboard, ready to paste into an AI chat

You can also open it from the command palette: `Ctrl+Shift+P` -> **"Reduce Log in Clipboard"**

## What It Does

Log Reducer runs 8 transforms in sequence. Each can be toggled on/off in VS Code settings under `logreducer.*`.

| Transform | What it removes | Example |
|-----------|----------------|---------|
| **Strip ANSI** | Color codes, control characters | `\x1b[31mERROR\x1b[0m` -> `ERROR` |
| **Normalize Whitespace** | Trailing spaces, excessive blank lines | 5 blank lines -> 1 |
| **Shorten IDs** | UUIDs, hex hashes, JWTs, long tokens | `a]f8c3d2e-1a2b-...` -> `$1` |
| **Simplify Timestamps** | Date portions of timestamps | `2024-01-15T14:32:01.123Z` -> `14:32:01` |
| **Deduplicate Lines** | Consecutive similar lines | 6 request lines -> `[x6] template \| N = 1,2,3,4,5,6` |
| **Detect Cycles** | Repeating multi-line blocks | 5 identical 3-line blocks -> 1 block + `[... repeated 4 more times ...]` |
| **Filter Noise** | DEBUG/TRACE, health checks, heartbeats | Collapsed to `[... N lines omitted ...]` |
| **Fold Stack Traces** | Framework frames, absolute paths, duplicate traces | 80 frames -> 8 user frames + summaries |

### Fold Stack Traces in detail

This is where most of the reduction comes from on error logs:

- **Keeps all your code frames**, collapses consecutive framework frames with a count and names: `[... 10 framework frames (uvicorn, fastapi, starlette) omitted ...]`
- **Shortens paths**: `C:\Users\me\project\src\backend\.venv\Lib\site-packages\starlette\routing.py` -> `starlette/routing.py`
- **Removes caret lines** (`^^^^^^`) that just underline the previous line
- **Deduplicates chained tracebacks**: Python's "The above exception was the direct cause..." pattern repeats the entire trace — the duplicate is collapsed to `[... duplicate traceback omitted ...]`
- **Handles Python exception groups** (`|` prefixed traces)
- **Supports**: Java, Python, Node.js, .NET, Go stack trace formats

### Deduplicate Lines in detail

When consecutive lines share the same structure but differ in specific values, instead of just showing a count, the output shows a template with the varying values:

```
[x7] cacheWarming.js:148 [CacheWarming] Warmed tail of large video ({N}MB) | N = 2574, 3139, 2897, 3063, 2490, 2996, 3043
```

## Installation

Not yet published to the VS Code Marketplace. To install from source:

```bash
git clone <repo-url>
cd log-reducer
npm install
npm run compile
```

Then open the folder in VS Code and press F5 to launch an Extension Development Host with the extension loaded.

## Configuration

All settings under `logreducer.*` in VS Code settings. Every transform defaults to `true`:

| Setting | Description |
|---------|-------------|
| `logreducer.stripAnsi` | Remove ANSI color codes and control characters |
| `logreducer.normalizeWhitespace` | Collapse excessive blank lines, trim trailing spaces |
| `logreducer.shortenIds` | Replace UUIDs, hex strings, tokens with `$1`, `$2`... |
| `logreducer.simplifyTimestamps` | Shorten verbose timestamp formats |
| `logreducer.deduplicateLines` | Collapse consecutive identical/similar lines |
| `logreducer.detectCycles` | Find repeating multi-line blocks, show once + count |
| `logreducer.filterNoise` | Remove DEBUG, health checks, heartbeats |
| `logreducer.foldStackTraces` | Collapse framework stack frames, shorten paths |

## Development

```bash
npm install
npm run compile    # one-time build
npm run watch      # rebuild on save
npm test           # run fixture tests
```

Tests use fixture files under `test/fixtures/`. Each fixture has `input.log` and `expected.log`. To add a test, create a new folder and register it in `test/runFixtures.ts`.

## Design Decisions

- **Token reduction over line reduction**: Stats are reported in tokens (whitespace-split), not lines, since that's what matters for AI context windows.
- **No ID legend**: Replaced IDs get `$1`, `$2` placeholders with no mapping. The original IDs are almost never relevant when debugging with an AI.
- **Clipboard workflow**: Copy -> shortcut -> review -> paste. No file picker or selection mode.
- **Transform order matters**: IDs and timestamps are shortened before dedup so lines differing only by ID/time become identical.
- **Rule-based, no AI**: Zero API calls, works offline, deterministic output, no API keys needed.
- **Zero runtime dependencies**: Pure TypeScript, nothing beyond the VS Code API.

## License

MIT
