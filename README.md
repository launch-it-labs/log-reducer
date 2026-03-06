# Log Reducer

Your AI coding agent is spending thousands of tokens reading raw logs — DEBUG spam, health checks, duplicate lines, framework stack frames, UUIDs. Those tokens are gone for the rest of the session. The agent has less room to think, generates worse code, and hits its context limit faster.

Log Reducer sits between the log and the AI. It compresses the file down to just the signal — errors, warnings, state changes, unique events — typically cutting 70-90% of tokens. The raw log never enters the AI's context.

It runs as an **MCP server** (the AI calls `reduce_log` with a file path) or as a **CLI** (pipe any log through it). No API keys, no network calls — deterministic text transforms that run instantly.

## Example

A 198-line application log with startup noise, health checks, order processing, and an error buried in an 80-line stack trace:

```
198 lines, 1440 tokens → 40 lines, 193 tokens (87% reduction)
```

The stack trace goes from 80 frames to 4 — every framework frame collapsed, only your code preserved:

```
Traceback (most recent call last):
  [... 19 framework frames (uvicorn, fastapi, starlette) omitted ...]
  File "routers/payments.py", line 89, in process_refund
    result = await stripe_client.refund(amount=order.total, charge_id=order.charge_id)
  File "services/stripe.py", line 234, in refund
    raise PaymentError(f"Refund failed: {response.error.message}")
PaymentError: Refund failed: insufficient funds in merchant account
```

Every error, warning, and meaningful event is preserved. Everything a reader would skip is gone.

<details>
<summary>Full before/after comparison</summary>

**Input** (198 lines, 1440 tokens):
```
2025-07-10T09:14:01.847293Z DEBUG [app.db] Acquiring connection from pool (active=3, idle=12)
2025-07-10T09:14:01.848104Z DEBUG [app.db] Connection acquired in 0.8ms
2025-07-10T09:14:01.901002Z DEBUG [app.cache] Redis connection established to 10.0.1.42:6379
2025-07-10T09:14:01.901445Z DEBUG [app.cache] Cache warmer starting — 24 keys to refresh
2025-07-10T09:14:02.103882Z DEBUG [app.cache] Refreshed key user_prefs:550e8400-e29b-41d4-a716-446655440000
...14 more DEBUG lines (cache, DB, auth, middleware)...
2025-07-10T09:14:03.200445Z INFO [app.server] Application startup complete
INFO:     127.0.0.1:52340 - "GET /healthz HTTP/1.1" 200 OK
...8 more health checks...
2025-07-10 09:14:30 - app.orders - INFO - Processing batch: 8 orders
2025-07-10 09:14:30 - app.orders - INFO - Order f8c3d2e1-b4a5-4f6e-8d9c-1a2b3c4d5e6f: validating
...many more order lines, webhooks, heartbeats...
2025-07-10 09:14:45 - app.payments - ERROR - Refund failed for order f6a7b8c9-d0e1-4f2a-3b4c-5d6e7f8a9b0c
Traceback (most recent call last):
  ...80 lines of stack trace...
PaymentError: Refund failed: insufficient funds in merchant account
...50 more lines of noise...
```

**Output** (40 lines, 193 tokens):
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
</details>

## Setup

### Step 1 — Build Log Reducer

```bash
git clone https://github.com/launch-it-labs/log-reducer.git
cd log-reducer
npm install && npm run compile
```

### Step 2 — Integrate with your project

Open your project in Claude Code and say:

> Integrate log-reducer as an MCP tool. The server is at `/path/to/log-reducer/out/src/mcp-server.js`. Follow the integration guide at `/path/to/log-reducer/docs/agent-integration.md`.

Claude Code will register the MCP server, add the right instructions to your CLAUDE.md, and set up the `/logdump` slash command. You can verify it worked by asking: *"What MCP tools do you have?"* — it should list `reduce_log`.

That's it. Your AI agent now compresses logs automatically instead of reading them raw.

<details>
<summary>Manual setup (if you prefer)</summary>

Add to your project's `.claude/settings.json`:

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

Copy the [AI instructions block](docs/agent-integration.md#3-add-ai-instructions-to-your-claudemd) into your project's `.claude/CLAUDE.md`.

Optionally copy `.claude/commands/logdump.md` into your project for a `/logdump` slash command.

See [docs/agent-integration.md](docs/agent-integration.md) for the full guide — filter reference, chaining with other MCPs, and setup for Codex/Copilot.
</details>

### CLI (for scripts and piping)

```bash
node out/src/cli.js < app.log > reduced.log
kubectl logs my-pod | node out/src/cli.js
node out/src/cli.js --level error --context 10 < app.log
```

After `npm link`, the `logreducer` command is available globally.

## What it does to your logs

Biggest impact first:

- **Noise filtered** — DEBUG/TRACE lines, health checks, heartbeats, progress bars removed entirely
- **Stack traces folded** — 80 frames → your code frames + `[... N framework frames omitted ...]`
- **Repeated lines collapsed** — 6 similar lines → one template with varying values listed
- **Log prefixes compressed** — 8 lines sharing `timestamp - module - LEVEL` → 1 header + indented messages
- **Repeating blocks detected** — 5 identical 3-line blocks → 1 block + count
- **IDs shortened** — UUIDs, hex strings, JWTs, tokens → `$1`, `$2`, ...
- **Timestamps simplified** — `2024-01-15T14:32:01.123Z` → `14:32:01`
- **Domain-specific** — pip installs, Docker layers, HTTP access logs, retry blocks, log envelopes each have dedicated collapsers

18 transforms, applied in sequence. Rule-based, deterministic, runs offline. One dependency (`@modelcontextprotocol/sdk`).

<details>
<summary>Stack trace folding in detail</summary>

This is where most of the reduction comes from on error logs:

- **Keeps all your code frames**, collapses consecutive framework frames: `[... 10 framework frames (uvicorn, fastapi, starlette) omitted ...]`
- **Shortens paths**: `C:\Users\me\project\.venv\Lib\site-packages\starlette\routing.py` → `starlette/routing.py`
- **Removes caret lines** (`^^^^^^`)
- **Deduplicates chained tracebacks**: `[... duplicate traceback omitted ...]`
- **Handles Python exception groups** (`|` prefixed traces)
- **Supports**: Java, Python, Node.js, .NET, Go

</details>

<details>
<summary>Deduplication in detail</summary>

When consecutive lines share the same structure but differ in specific values, the output shows a template with the varying values:

```
[x7] [CacheWarming] Warmed tail of large video ({N}MB) | N = 2574, 3139, 2897, 3063, 2490, 2996, 3043
```

</details>

## Contributing

**The easiest way to contribute is to paste a log file.** Open this project in Claude Code, paste a log into the chat, and the AI will analyze it, identify patterns the pipeline misses, implement high-generality fixes, and create a PR. No code knowledge required — your log becomes a test fixture that makes the tool better for everyone.

You can also [submit a log via GitHub issue](https://github.com/launch-it-labs/log-reducer/issues/new?template=log-sample.yml) if you don't use Claude Code.

For code contributions, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Design Decisions

- **Rule-based, no AI** — zero API calls, works offline, deterministic. You get the same output every time, and it runs in milliseconds.
- **File-path workflow** — the MCP tool accepts file paths so raw logs never enter the AI's context. Only compressed output crosses into the conversation.
- **Token reduction over line reduction** — stats reported in tokens, not lines, since that's what matters for AI context windows.
- **Generality over coverage** — new transforms are scored by how broadly they apply. A pattern that only helps one application's logs gets flagged as bias risk and skipped, even if it would improve that specific case.
- **Transform order matters** — IDs and timestamps are shortened before dedup so lines differing only by those values become identical. Noise is filtered before prefix compression so separator lines don't break grouping.
- **Each transform is independent** — pure function in, string out. Easy to add, test, and reorder without touching the rest of the pipeline.
- **No ID legend** — replaced IDs get `$1`, `$2` placeholders with no mapping back. The original UUIDs are almost never what you're debugging.
- **Minimal dependencies** — pure TypeScript, one runtime dependency (`@modelcontextprotocol/sdk`).

## License

MIT
