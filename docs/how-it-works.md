# How it works

## Sharing logs with your AI

**Want to share a log? Type `/logdump` in the chat.**

Copy the log to your clipboard, then type `/logdump`. This dumps the clipboard
to a temp file and runs `reduce_log` on it automatically — the raw log never
enters the conversation. It's the fastest way to get a log analyzed.

Don't paste logs directly into the chat. Once raw text enters the AI's context,
the tokens are spent — the tool can't reclaim them. `/logdump` keeps the raw
log out and only sends the reduced version.

## A real example

You're running a FastAPI server locally,
click around your app, hit a 500 error. You copy your terminal output into
a file and ask your AI to debug it.

## The problem

The terminal output is 218 lines. Most of it is a Python exception group
with two copies of the full traceback — 95 lines of framework stack frames
each, with paths like:

```
C:\Users\imank\projects\video-editor\src\backend\.venv\Lib\site-packages\
  starlette\middleware\base.py
```

Your AI reads all 218 lines. That's 1,185 tokens of context gone — and
the bug is in 3 lines buried at the bottom of the trace.

## What reduce_log does to it

**218 lines, 1,185 tokens  →  51 lines, 310 tokens  (74% reduction)**

Here's what happens, transform by transform:

### Stack traces: 95 lines → 12 lines

The exception has 95 lines of stack frames. Most are framework middleware
(uvicorn, starlette, fastapi, contextlib). The tool:

- **Folds consecutive framework frames** into a single summary
- **Shortens paths** from `C:\Users\...\site-packages\starlette\routing.py` → `starlette/routing.py`
- **Removes caret lines** (`^^^^^^`)
- **Keeps your code** — the frames in `app/routers/exports.py`, `app/main.py`, `app/middleware/db_sync.py`

Before:
```
    |   File "C:\Users\imank\projects\video-editor\src\backend\.venv\Lib\
             site-packages\uvicorn\protocols\http\httptools_impl.py", line 426, in run_asgi
    |     result = await app(  # type: ignore[func-returns-value]
    |              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    |   File "C:\Users\imank\projects\video-editor\src\backend\.venv\Lib\
             site-packages\uvicorn\middleware\proxy_headers.py", line 84, in __call__
    |     return await self.app(scope, receive, send)
    |            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    |   File "C:\Users\imank\projects\video-editor\src\backend\.venv\Lib\
             site-packages\fastapi\applications.py", line 1135, in __call__
    |     await super().__call__(scope, receive, send)
    ... 30 more framework frames with full paths ...
    |   File "C:\Users\imank\projects\video-editor\src\backend\app\routers\
             exports.py", line 745, in list_unacknowledged_exports
```

After:
```
    |   [... 10 framework frames (uvicorn, fastapi, starlette, contextlib) omitted ...]
    |   File "app/middleware/db_sync.py", line 107, in dispatch
    |     response = await call_next(request)
    |   [... 6 framework frames (starlette, contextlib) omitted ...]
    |   File "app/main.py", line 97, in dispatch
    |     response = await call_next(request)
    |   [... 16 framework frames (starlette, fastapi) omitted ...]
    |   File "app/routers/exports.py", line 745, in list_unacknowledged_exports
```

### Duplicate traceback: gone

Python exception groups often produce the same traceback twice (the
original + "The above exception was the direct cause..."). The second
copy becomes one line:

```
Traceback (most recent call last):
  [... duplicate traceback omitted ...]
```

### HTTP access log lines: cleaned up

```
INFO:     127.0.0.1:58756 - "GET /api/settings HTTP/1.1" 200 OK
```
becomes:
```
GET /api/settings → 200
```

### Repeated API calls: collapsed

When the same endpoint appears multiple times with different ports:
```
INFO:     127.0.0.1:58764 - "GET /api/projects HTTP/1.1" 200 OK
INFO:     127.0.0.1:56487 - "GET /api/projects HTTP/1.1" 200 OK
INFO:     127.0.0.1:55169 - "GET /api/projects HTTP/1.1" 200 OK
```
becomes:
```
GET /api/projects → 200
[... above line repeated 3 more times ...]
```

### Log prefixes: factored

Lines sharing the same timestamp get factored:
```
2026-02-23 18:35:54 - app.main - INFO - Default user 'a' session initialized
2026-02-23 18:35:54 - app.main - INFO - Orphaned export jobs recovery complete
2026-02-23 18:35:54 - app.services.modal_queue - INFO - [ModalQueue] Processing queue with local FFmpeg
2026-02-23 18:35:54 - app.main - INFO - Modal queue: no pending tasks found
```
becomes:
```
18:35:54 - app.main - INFO - Default user 'a' session initialized
  app.main - INFO - Orphaned export jobs recovery complete
  app.services.modal_queue - INFO - [ModalQueue] Processing queue with local FFmpeg
  app.main - INFO - Modal queue: no pending tasks found
```

## The token math

```
                     Tokens
                   ─────────
Raw log              1,185     ← what the AI reads without the tool
After reduce_log       310     ← what the AI reads with the tool
                   ─────────
Saved                  875     ← free for reasoning and code
```

875 tokens doesn't sound dramatic — but this was a short session (30 seconds
of clicking). In a real debugging session, logs grow fast. A few minutes of
debug-level logging from a Next.js or Django dev server easily produces
500+ lines. Test suite output can be thousands of lines. Docker Compose
starting 5 services? A CI build log? These scale up quickly — and the
reduction % stays the same or gets better (more repetition = more dedup).

## For larger logs

When a log file grows past a few hundred lines, you don't want to load
even the *reduced* version all at once. The tool supports a **funnel
pattern** — multiple targeted calls that let the AI drill in:

```
Step 1: SURVEY  → summary: true                               ~50 tokens
  "8 errors between 13:02-13:15, components: db, auth, api"

Step 2: SCAN    → level: "error", limit: 3, context: 3       ~200 tokens
  See first 3 errors with surrounding context.

Step 3: ZOOM    → time_range: "13:02:28-13:02:35", before: 50 ~500 tokens
  50 lines leading up to the first error — the causal chain.

Step 4: TRACE   → grep: "pool|conn", time_range: "13:00-13:05" ~300 tokens
  Follow a specific thread through the log.
```

Total: ~1,050 tokens for a 2,600-line log. The AI finds the root cause
without ever loading the full file.

We [simulated this](../test/simulation/sim.ts) against 5 different bug
scenarios (pool exhaustion, auth cascade, memory leak, deploy crash,
race condition) with logs of 2,000-3,000 lines each:

```
                       Tokens     vs. raw
                    ──────────────────────
Raw (no tool)        116,821     baseline
Naive reduce_log      69,287     -41%
Funnel pattern         5,038     -96%
```

The funnel pattern found every root cause while using 4% of raw tokens.

---

*Stack trace example from `test/fixtures/10-real-world-python/`.
Simulation numbers from `test/simulation/sim.ts` — run
`node out/test/simulation/sim.js` to reproduce.*
