# Log Reducer

A VS Code extension that reduces log files for AI consumption. Copy a noisy log, hit a shortcut, and get back a clean version that preserves the signal while cutting the token count — typically by 70-90%.

## Before & After

**Input** (198 lines, 1440 tokens):
```
2025-07-10T09:14:01.847293Z DEBUG [app.db] Acquiring connection from pool (active=3, idle=12)
2025-07-10T09:14:01.848104Z DEBUG [app.db] Connection acquired in 0.8ms
2025-07-10T09:14:01.901002Z DEBUG [app.cache] Redis connection established to 10.0.1.42:6379
2025-07-10T09:14:01.901445Z DEBUG [app.cache] Cache warmer starting — 24 keys to refresh
2025-07-10T09:14:02.103882Z DEBUG [app.cache] Refreshed key user_prefs:550e8400-e29b-41d4-a716-446655440000
2025-07-10T09:14:02.204910Z DEBUG [app.cache] Refreshed key user_prefs:7c9e6679-7425-40de-944b-e07fc1f90ae7
2025-07-10T09:14:02.305123Z DEBUG [app.cache] Refreshed key user_prefs:a1b2c3d4-e5f6-7890-abcd-ef1234567890
2025-07-10T09:14:02.401928Z DEBUG [app.cache] Refreshed key user_prefs:deadbeef-1234-5678-9abc-def012345678
2025-07-10T09:14:02.503771Z DEBUG [app.cache] Refreshed key session:82f7e3a1b9c04d5e
2025-07-10T09:14:02.604229Z DEBUG [app.cache] Refreshed key session:9a3bc7d2e1f845a6
2025-07-10T09:14:02.704882Z DEBUG [app.cache] Cache warmer complete: 24/24 keys refreshed in 803ms
2025-07-10T09:14:02.801234Z DEBUG [app.db] Running migration check...
2025-07-10T09:14:02.892341Z DEBUG [app.db] Schema version: 47, no migrations needed
2025-07-10T09:14:02.901002Z DEBUG [app.db] Connection pool initialized: min=2, max=20
2025-07-10T09:14:02.950112Z DEBUG [app.auth] Loading JWT signing keys from vault
2025-07-10T09:14:03.001234Z DEBUG [app.auth] JWT keys loaded: RS256, kid=a8b7c6d5e4f3
2025-07-10T09:14:03.050012Z DEBUG [app.middleware] CORS policy loaded: 3 allowed origins
2025-07-10T09:14:03.100234Z DEBUG [app.middleware] Rate limiter initialized: 100 req/min per IP
2025-07-10T09:14:03.200445Z INFO [app.server] Application startup complete
INFO:     127.0.0.1:52340 - "GET /healthz HTTP/1.1" 200 OK
INFO:     127.0.0.1:52341 - "GET /healthz HTTP/1.1" 200 OK
INFO:     127.0.0.1:52342 - "GET /healthz HTTP/1.1" 200 OK
INFO:     127.0.0.1:52343 - "GET /healthz HTTP/1.1" 200 OK
INFO:     127.0.0.1:52344 - "GET /healthz HTTP/1.1" 200 OK
INFO:     127.0.0.1:52345 - "GET /healthz HTTP/1.1" 200 OK
INFO:     127.0.0.1:52346 - "GET /healthz HTTP/1.1" 200 OK
INFO:     127.0.0.1:52347 - "GET /healthz HTTP/1.1" 200 OK
2025-07-10T09:14:12.003881Z DEBUG [app.db] heartbeat check: connection pool healthy
2025-07-10T09:14:17.003881Z DEBUG [app.db] heartbeat check: connection pool healthy
2025-07-10T09:14:22.003881Z DEBUG [app.db] heartbeat check: connection pool healthy
2025-07-10T09:14:27.003881Z DEBUG [app.db] heartbeat check: connection pool healthy
2025-07-10T09:14:32.003881Z DEBUG [app.db] heartbeat check: connection pool healthy
2025-07-10T09:14:37.003881Z DEBUG [app.db] heartbeat check: connection pool healthy
2025-07-10T09:14:42.003881Z DEBUG [app.db] heartbeat check: connection pool healthy
INFO:     connection open
INFO:     connection closed
INFO:     connection open
INFO:     connection closed
INFO:     connection open
INFO:     connection closed
2025-07-10 09:14:30 - app.orders - INFO - ================================================================
2025-07-10 09:14:30 - app.orders - INFO - Processing batch: 8 orders
2025-07-10 09:14:30 - app.orders - INFO - ================================================================
2025-07-10 09:14:30 - app.orders - INFO - Order f8c3d2e1-b4a5-4f6e-8d9c-1a2b3c4d5e6f: validating
2025-07-10 09:14:30 - app.orders - INFO - Order f8c3d2e1-b4a5-4f6e-8d9c-1a2b3c4d5e6f: payment confirmed
2025-07-10 09:14:30 - app.orders - INFO - Order f8c3d2e1-b4a5-4f6e-8d9c-1a2b3c4d5e6f: shipped
2025-07-10 09:14:30 - app.orders - INFO - Order b7e4f2a9-c8d1-4b3e-a5f6-7890abcdef12: validating
2025-07-10 09:14:30 - app.orders - INFO - Order b7e4f2a9-c8d1-4b3e-a5f6-7890abcdef12: payment confirmed
2025-07-10 09:14:30 - app.orders - INFO - Order b7e4f2a9-c8d1-4b3e-a5f6-7890abcdef12: shipped
2025-07-10 09:14:30 - app.orders - INFO - Order c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f: validating
2025-07-10 09:14:30 - app.orders - INFO - Order c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f: payment confirmed
2025-07-10 09:14:30 - app.orders - INFO - Order c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f: shipped
2025-07-10 09:14:30 - app.orders - INFO - Order d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a: validating
2025-07-10 09:14:30 - app.orders - INFO - Order d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a: payment confirmed
2025-07-10 09:14:30 - app.orders - INFO - Order d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a: shipped
2025-07-10 09:14:30 - app.orders - INFO - Order e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b: validating
2025-07-10 09:14:30 - app.orders - INFO - Order e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b: payment confirmed
2025-07-10 09:14:30 - app.orders - INFO - Order e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b: shipped
2025-07-10 09:14:30 - app.orders - INFO - ================================================================
2025-07-10 09:14:30 - app.orders - INFO - Batch complete: 5/8 orders processed, 3 pending payment
2025-07-10 09:14:30 - app.orders - INFO - ================================================================
INFO:     127.0.0.1:52401 - "GET /healthz HTTP/1.1" 200 OK
INFO:     127.0.0.1:52402 - "GET /healthz HTTP/1.1" 200 OK
INFO:     127.0.0.1:52403 - "GET /healthz HTTP/1.1" 200 OK
INFO:     127.0.0.1:52404 - "GET /healthz HTTP/1.1" 200 OK
INFO:     127.0.0.1:52405 - "GET /healthz HTTP/1.1" 200 OK
INFO:     127.0.0.1:52406 - "GET /healthz HTTP/1.1" 200 OK
INFO:     127.0.0.1:52407 - "GET /healthz HTTP/1.1" 200 OK
INFO:     127.0.0.1:52408 - "GET /healthz HTTP/1.1" 200 OK
2025-07-10T09:14:35.003112Z DEBUG [app.db] heartbeat check: connection pool healthy
2025-07-10T09:14:40.003112Z DEBUG [app.db] heartbeat check: connection pool healthy
2025-07-10T09:14:45.003112Z DEBUG [app.db] heartbeat check: connection pool healthy
2025-07-10T09:14:50.003112Z DEBUG [app.db] heartbeat check: connection pool healthy
2025-07-10T09:14:55.003112Z DEBUG [app.db] heartbeat check: connection pool healthy
2025-07-10 09:14:35 - app.webhooks - INFO - Dispatching webhook for event order.shipped to https://partner-api.example.com/hooks/9f8e7d6c5b4a3210
2025-07-10 09:14:35 - app.webhooks - INFO - Dispatching webhook for event order.shipped to https://partner-api.example.com/hooks/9f8e7d6c5b4a3210
2025-07-10 09:14:35 - app.webhooks - INFO - Dispatching webhook for event order.shipped to https://partner-api.example.com/hooks/9f8e7d6c5b4a3210
2025-07-10 09:14:35 - app.webhooks - INFO - Dispatching webhook for event order.shipped to https://partner-api.example.com/hooks/9f8e7d6c5b4a3210
2025-07-10 09:14:35 - app.webhooks - INFO - Dispatching webhook for event order.shipped to https://partner-api.example.com/hooks/9f8e7d6c5b4a3210
INFO:     127.0.0.1:52410 - "GET /healthz HTTP/1.1" 200 OK
INFO:     127.0.0.1:52411 - "GET /healthz HTTP/1.1" 200 OK
INFO:     127.0.0.1:52412 - "GET /healthz HTTP/1.1" 200 OK
INFO:     127.0.0.1:52413 - "GET /healthz HTTP/1.1" 200 OK
2025-07-10T09:14:42.003124Z DEBUG [app.db] heartbeat check: connection pool healthy
2025-07-10T09:14:47.003441Z DEBUG [app.db] heartbeat check: connection pool healthy
2025-07-10 09:14:44 - app.payments - INFO - Processing refund for order f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f8a9b0c
2025-07-10 09:14:44 - app.payments - INFO - Refund initiated: $127.50 to card ending 4242
2025-07-10 09:14:45 - app.payments - ERROR - Refund failed for order f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f8a9b0c: insufficient funds in merchant account
Traceback (most recent call last):
  File "/home/deploy/app/.venv/lib/python3.12/site-packages/uvicorn/protocols/http/httptools_impl.py", line 426, in run_asgi
    result = await app(  # type: ignore[func-returns-value]
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/deploy/app/.venv/lib/python3.12/site-packages/uvicorn/middleware/proxy_headers.py", line 84, in __call__
    return await self.app(scope, receive, send)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/deploy/app/.venv/lib/python3.12/site-packages/fastapi/applications.py", line 1135, in __call__
    await super().__call__(scope, receive, send)
  File "/home/deploy/app/.venv/lib/python3.12/site-packages/starlette/applications.py", line 107, in __call__
    await self.middleware_stack(scope, receive, send)
  File "/home/deploy/app/.venv/lib/python3.12/site-packages/starlette/middleware/errors.py", line 186, in __call__
    raise exc
  File "/home/deploy/app/.venv/lib/python3.12/site-packages/starlette/middleware/errors.py", line 164, in __call__
    await self.app(scope, receive, _send)
  ...19 more framework frames...
  File "/home/deploy/app/src/routers/payments.py", line 89, in process_refund
    result = await stripe_client.refund(amount=order.total, charge_id=order.charge_id)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/deploy/app/src/services/stripe.py", line 234, in refund
    raise PaymentError(f"Refund failed: {response.error.message}")
PaymentError: Refund failed: insufficient funds in merchant account
INFO:     127.0.0.1:52420 - "POST /api/orders/f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f8a9b0c/refund HTTP/1.1" 500 Internal Server Error
INFO:     127.0.0.1:52421 - "GET /healthz HTTP/1.1" 200 OK
INFO:     127.0.0.1:52422 - "GET /healthz HTTP/1.1" 200 OK
INFO:     127.0.0.1:52423 - "GET /healthz HTTP/1.1" 200 OK
INFO:     127.0.0.1:52424 - "GET /healthz HTTP/1.1" 200 OK
INFO:     127.0.0.1:52425 - "GET /healthz HTTP/1.1" 200 OK
2025-07-10T09:14:47.003441Z DEBUG [app.db] heartbeat check: connection pool healthy
2025-07-10T09:14:52.003991Z DEBUG [app.db] heartbeat check: connection pool healthy
2025-07-10T09:14:57.003112Z DEBUG [app.db] heartbeat check: connection pool healthy
2025-07-10 09:14:50 - app.metrics - INFO - ================================================================
2025-07-10 09:14:50 - app.metrics - INFO - requests_total: 847
2025-07-10 09:14:50 - app.metrics - INFO - requests_failed: 12
2025-07-10 09:14:50 - app.metrics - INFO - avg_response_ms: 142
2025-07-10 09:14:50 - app.metrics - INFO - active_connections: 23
2025-07-10 09:14:50 - app.metrics - INFO - cache_hit_rate: 0.94
2025-07-10 09:14:50 - app.metrics - INFO - uptime_seconds: 86400
2025-07-10 09:14:50 - app.metrics - INFO - ================================================================
...50 more lines of health checks, heartbeats, and connection noise...
```

**Output** (40 lines, 193 tokens — 87% reduction):
```
[... 18 lines omitted ...]
09:14:03 INFO [app.server] Application startup complete
[... 21 lines omitted ...]
[2025-07-10]
app.orders - INFO:
  09:14:30:
    Processing batch: 8 orders
    Order $5: validating
    Order $5: payment confirmed
    Order $5: shipped
[... above 3-line block repeated 4 more times ...]
    Batch complete: 5/8 orders processed, 3 pending payment
[... 13 lines omitted ...]
app.webhooks - INFO:
  09:14:35:
    Dispatching webhook for event order.shipped to https://partner-api.example.com/hooks/$13
[... 4 identical lines omitted ...]
[... 6 lines omitted ...]
app.payments:
  09:14:44 - INFO - Processing refund for order $10
  09:14:44 - INFO - Refund initiated: $127.50 to card ending 4242
  09:14:45 - ERROR - Refund failed for order $10: insufficient funds in merchant account
Traceback (most recent call last):
  [... 19 framework frames (uvicorn, fastapi, starlette) omitted ...]
  File "routers/payments.py", line 89, in process_refund
    result = await stripe_client.refund(amount=order.total, charge_id=order.charge_id)
  File "services/stripe.py", line 234, in refund
    raise PaymentError(f"Refund failed: {response.error.message}")
PaymentError: Refund failed: insufficient funds in merchant account
INFO:     127.0.0.1:52420 - "POST /api/orders/$10/refund HTTP/1.1" 500 Internal Server Error
[... 8 lines omitted ...]
app.metrics - INFO:
  09:14:50:
    requests_total: 847
    requests_failed: 12
    avg_response_ms: 142
    active_connections: 23
    cache_hit_rate: 0.94
    uptime_seconds: 86400
[... 43 lines omitted ...]
```

Every error, warning, and meaningful event is preserved. The noise — ANSI codes, DEBUG spam, health checks, heartbeats, connection chatter, duplicate webhooks, separator lines, framework stack frames, verbose timestamps, and long UUIDs — is gone.

## Usage

1. Copy a log to your clipboard
2. Press `Ctrl+Alt+R` (`Cmd+Alt+R` on Mac)
3. Two tabs open side-by-side: original on the left, compressed on the right
4. The compressed output is also written back to your clipboard, ready to paste into an AI chat

You can also open it from the command palette: `Ctrl+Shift+P` -> **"Reduce Log in Clipboard"**

## What It Does

Log Reducer runs 11 transforms in sequence. Each can be toggled on/off in VS Code settings under `logreducer.*`.

| Transform | What it removes | Example |
|-----------|----------------|---------|
| **Strip ANSI** | Color codes, control characters | `\x1b[31mERROR\x1b[0m` -> `ERROR` |
| **Normalize Whitespace** | Trailing spaces, excessive blank lines | 5 blank lines -> 1 |
| **Shorten IDs** | UUIDs, hex strings (7+), JWTs, long tokens, underscore IDs | `af8c3d2e-1a2b-...` -> `$1` |
| **Shorten URLs** | Query parameters, long URL paths | `https://host/a/b/c/d/e?key=val` -> `https://host/.../d/e` |
| **Simplify Timestamps** | Date portions of timestamps | `2024-01-15T14:32:01.123Z` -> `14:32:01` |
| **Filter Noise** | DEBUG/TRACE, health checks, heartbeats, devtools artifacts | Collapsed to `[... N lines omitted ...]` |
| **Strip Source Locations** | Browser console `file.js:line` prefixes | `useHook.js:59 [Tag] msg` -> `[Tag] msg` |
| **Compress Prefix** | Repeated log prefixes, separator lines | 8 lines with same prefix -> 1 header + indented suffixes |
| **Deduplicate Lines** | Consecutive similar lines | 6 request lines -> `[x6] template \| N = 1,2,3,4,5,6` |
| **Detect Cycles** | Repeating multi-line blocks | 5 identical 3-line blocks -> 1 block + `[... repeated 4 more times ...]` |
| **Fold Stack Traces** | Framework frames, absolute paths, duplicate traces | 80 frames -> 8 user frames + summaries |

### Compress Prefix in detail

When 3+ consecutive lines share the same `timestamp - module - LEVEL -` prefix, the prefix is stated once as a header and the message suffixes are indented:

```
20:11:07 - app.video_encoder - INFO - Total input frames: 450
20:11:07 - app.video_encoder - INFO - input_frame_count (PNG files): 450
20:11:07 - app.video_encoder - INFO - original_fps (from source): 29.97
20:11:07 - app.video_encoder - INFO - target_fps (requested): 30
20:11:07 - app.video_encoder - INFO - expected input duration: 15.015000s
```
becomes:
```
20:11:07 - app.video_encoder - INFO:
  Total input frames: 450
  input_frame_count (PNG files): 450
  original_fps (from source): 29.97
  target_fps (requested): 30
  expected input duration: 15.015000s
```

Decorative separator lines (`====`, `----`, `****`) are also silently stripped since they carry no semantic information.

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
git clone https://github.com/imankha/log-reducer.git
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
| `logreducer.shortenIds` | Replace UUIDs, hex strings (7+), JWTs, tokens, underscore IDs with `$1`, `$2`... |
| `logreducer.shortenUrls` | Strip query parameters and collapse long URL paths |
| `logreducer.simplifyTimestamps` | Shorten verbose timestamp formats |
| `logreducer.filterNoise` | Remove DEBUG, health checks, heartbeats, devtools artifacts |
| `logreducer.stripSourceLocations` | Strip browser console `file.js:line` prefixes when a `[Tag]` follows |
| `logreducer.compressPrefix` | Factor out repeated log prefixes, strip separator lines |
| `logreducer.deduplicateLines` | Collapse consecutive identical/similar lines |
| `logreducer.detectCycles` | Find repeating multi-line blocks, show once + count |
| `logreducer.foldStackTraces` | Collapse framework stack frames, shorten paths |

## CLI Usage

Log Reducer also ships as a CLI tool that reads from stdin and writes to stdout. This works with any tool or script that can pipe text:

```bash
# Reduce a log file
node out/src/cli.js < app.log > reduced.log

# Pipe from another command
kubectl logs my-pod | node out/src/cli.js

# After npm link or global install
cat app.log | logreducer
```

## AI Agent Integration

Log Reducer includes an MCP server and portable instruction files so AI agents (Claude Code, Codex, Copilot) can reduce logs automatically. Clone the repo, build, and the integrations work out of the box.

See [docs/agent-integration.md](docs/agent-integration.md) for full setup details, MCP server configuration, and cross-agent support.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to build, test, and add new transforms.

## Design Decisions

- **Token reduction over line reduction**: Stats are reported in tokens (whitespace-split), not lines, since that's what matters for AI context windows.
- **No ID legend**: Replaced IDs get `$1`, `$2` placeholders with no mapping. The original IDs are almost never relevant when debugging with an AI.
- **Clipboard workflow**: Copy -> shortcut -> review -> paste. No file picker or selection mode.
- **Transform order matters**: IDs and timestamps are shortened before dedup so lines differing only by ID/time become identical. Noise is filtered before prefix compression so separator lines don't break grouping.
- **Rule-based, no AI**: Zero API calls, works offline, deterministic output, no API keys needed.
- **Minimal dependencies**: The VS Code extension itself is pure TypeScript with no runtime dependencies. The MCP server adds `@modelcontextprotocol/sdk` for Claude Code integration.

## License

MIT
