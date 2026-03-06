# Log Reducer

An MCP tool and CLI that reduces log files for AI consumption. Pass a file path, get back a clean version that preserves the signal while cutting the token count — typically by 70-90%. Raw logs never enter the AI's context.

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
...8 more health checks...
2025-07-10 09:14:30 - app.orders - INFO - Processing batch: 8 orders
2025-07-10 09:14:30 - app.orders - INFO - Order f8c3d2e1-b4a5-4f6e-8d9c-1a2b3c4d5e6f: validating
...many more order lines, webhooks, heartbeats, health checks...
2025-07-10 09:14:45 - app.payments - ERROR - Refund failed for order f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f8a9b0c: insufficient funds in merchant account
Traceback (most recent call last):
  ...80 lines of stack trace...
PaymentError: Refund failed: insufficient funds in merchant account
...50 more lines of noise...
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

### MCP tool (recommended for AI workflows)

The MCP server exposes a `reduce_log` tool that AI agents call with a file path. The agent never sees the raw log — only the compressed output enters the conversation.

```bash
npm install
npm run compile
```

The AI calls:
```
reduce_log({ file: "/path/to/app.log", tail: 200, level: "error" })
```

### CLI (for scripts and piping)

```bash
# Reduce a log file
node out/src/cli.js < app.log > reduced.log

# Pipe from another command
kubectl logs my-pod | node out/src/cli.js

# Filter to errors with context
node out/src/cli.js --level error --context 10 < app.log

# After npm link or global install
cat app.log | logreducer
```

## Integrate with Your Project

Add Log Reducer to any project so the AI automatically compresses logs instead of reading them raw.

**Step 1** — Register the MCP server in your project's `.claude/settings.json`:

```json
{
  "mcpServers": {
    "logreducer": {
      "command": "node",
      "args": ["/absolute/path/to/log-reducer/out/src/mcp-server.js"]
    }
  }
}
```

**Step 2** — Add instructions to your project's `.claude/CLAUDE.md` telling the AI to use `reduce_log` instead of reading raw log files.

**Step 3** — (Optional) Copy `.claude/commands/logdump.md` into your project for a `/logdump` slash command that dumps clipboard contents to a file and compresses automatically.

See [docs/agent-integration.md](docs/agent-integration.md) for the full integration guide, including CLAUDE.md instructions to copy, filter parameters, and setup for other AI agents (Codex, Copilot).

## What It Does

Log Reducer runs transforms in sequence, each reducing a different type of noise:

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
```
becomes:
```
20:11:07 - app.video_encoder - INFO:
  Total input frames: 450
  input_frame_count (PNG files): 450
  original_fps (from source): 29.97
```

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

```bash
git clone https://github.com/launch-it-labs/log-reducer.git
cd log-reducer
npm install
npm run compile
```

## Contributing

**The easiest way to contribute is to paste a log file.** Open this project in Claude Code, paste a log into the chat, and the AI will analyze it, implement improvements for patterns it finds, and create a PR. No code knowledge required — your log becomes a test fixture that makes the pipeline better for everyone. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

You can also [submit a log via GitHub issue](https://github.com/launch-it-labs/log-reducer/issues/new?template=log-sample.yml) if you don't use Claude Code.

For code contributions (new transforms, bug fixes), see [CONTRIBUTING.md](CONTRIBUTING.md).

## Design Decisions

- **Token reduction over line reduction**: Stats are reported in tokens (whitespace-split), not lines, since that's what matters for AI context windows.
- **No ID legend**: Replaced IDs get `$1`, `$2` placeholders with no mapping. The original IDs are almost never relevant when debugging with an AI.
- **File-path workflow**: The MCP tool accepts file paths so raw logs never enter the AI's context. Only compressed output crosses into the conversation.
- **Transform order matters**: IDs and timestamps are shortened before dedup so lines differing only by ID/time become identical. Noise is filtered before prefix compression so separator lines don't break grouping.
- **Rule-based, no AI**: Zero API calls, works offline, deterministic output, no API keys needed.
- **Minimal dependencies**: Pure TypeScript with `@modelcontextprotocol/sdk` as the only runtime dependency.

## License

MIT
