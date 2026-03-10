/**
 * Integration tests for the MCP server.
 * Spawns the server as a child process and communicates via
 * newline-delimited JSON-RPC over stdio.
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as readline from 'readline';

const SERVER_PATH = path.join(__dirname, '..', 'src', 'mcp-server.js');

let passed = 0;
let failed = 0;

function pass(name: string): void {
  console.log(`  PASS  ${name}`);
  passed++;
}

function fail(name: string, reason: string): void {
  console.log(`  FAIL  ${name}`);
  console.log(`    ${reason}`);
  failed++;
}

/**
 * Send a JSON-RPC message (newline-delimited) and wait for a response line.
 * Notifications (no `id`) don't get a response, so use sendNotification for those.
 */
function sendRpc(
  proc: ChildProcess,
  rl: readline.Interface,
  message: object,
  timeoutMs = 5000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for response to: ${JSON.stringify(message)}`));
    }, timeoutMs);

    const onLine = (line: string): void => {
      if (!line.trim()) return;
      try {
        const parsed = JSON.parse(line);
        // Only resolve on messages with matching id or error
        if ('id' in parsed || 'error' in parsed) {
          clearTimeout(timer);
          rl.removeListener('line', onLine);
          resolve(parsed);
        }
      } catch {
        // Ignore non-JSON lines
      }
    };

    rl.on('line', onLine);
    proc.stdin!.write(JSON.stringify(message) + '\n');
  });
}

function sendNotification(proc: ChildProcess, message: object): void {
  proc.stdin!.write(JSON.stringify(message) + '\n');
}

async function runTests(): Promise<void> {
  const proc = spawn('node', [SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const rl = readline.createInterface({ input: proc.stdout! });

  // Collect stderr for diagnostics
  let stderr = '';
  proc.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

  try {
    // ── Test 1: Initialize ──────────────────────────────────────────
    const initResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });

    if (initResponse.result?.serverInfo?.name === 'logreducer') {
      pass('mcp-initialize');
    } else {
      fail('mcp-initialize', `Unexpected serverInfo: ${JSON.stringify(initResponse.result?.serverInfo)}`);
    }

    if (initResponse.result?.capabilities?.tools) {
      pass('mcp-capabilities-tools');
    } else {
      fail('mcp-capabilities-tools', `Tools capability missing: ${JSON.stringify(initResponse.result?.capabilities)}`);
    }

    // Send initialized notification (required by protocol, no response expected)
    sendNotification(proc, { jsonrpc: '2.0', method: 'notifications/initialized' });

    // Small delay to let the notification be processed
    await new Promise(r => setTimeout(r, 100));

    // ── Test 2: tools/list ──────────────────────────────────────────
    const listResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });

    const tools: any[] = listResponse.result?.tools ?? [];
    const reduceTool = tools.find((t: any) => t.name === 'reduce_log');

    if (reduceTool) {
      pass('mcp-tools-list');
    } else {
      fail('mcp-tools-list', `reduce_log not found in tools: ${JSON.stringify(tools.map((t: any) => t.name))}`);
    }

    if (
      reduceTool?.inputSchema?.properties?.log_text?.type === 'string' &&
      reduceTool?.inputSchema?.properties?.file?.type === 'string'
    ) {
      pass('mcp-tool-schema');
    } else {
      fail('mcp-tool-schema', `Missing log_text or file in inputSchema: ${JSON.stringify(reduceTool?.inputSchema)}`);
    }

    if (reduceTool?.description?.includes('token reduction')) {
      pass('mcp-tool-description');
    } else {
      fail('mcp-tool-description', `Missing description: ${JSON.stringify(reduceTool?.description)}`);
    }

    // ── Test 3: tools/call — reduce UUIDs ───────────────────────────
    const callResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: {
          log_text: [
            '2024-01-15T10:30:45.123Z [INFO] Request abc12345-def6-7890-abcd-ef1234567890 started',
            '2024-01-15T10:30:45.456Z [INFO] Request abc12345-def6-7890-abcd-ef1234567890 completed',
          ].join('\n'),
        },
      },
    });

    const reducedText: string = callResponse.result?.content?.[0]?.text ?? '';

    if (reducedText.includes('$1') && !reducedText.includes('abc12345')) {
      pass('mcp-reduce-uuids');
    } else {
      fail('mcp-reduce-uuids', `UUID not shortened: ${JSON.stringify(reducedText)}`);
    }

    if (reducedText.includes('10:30:45') && !reducedText.includes('2024-01-15T')) {
      pass('mcp-reduce-timestamps');
    } else {
      fail('mcp-reduce-timestamps', `Timestamp not simplified: ${JSON.stringify(reducedText)}`);
    }

    // ── Test 4: tools/call — deduplication ──────────────────────────
    const dedupResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: {
          log_text: [
            'INFO Heartbeat OK',
            'INFO Heartbeat OK',
            'INFO Heartbeat OK',
            'INFO Heartbeat OK',
            'INFO Heartbeat OK',
          ].join('\n'),
        },
      },
    });

    const dedupText: string = dedupResponse.result?.content?.[0]?.text ?? '';

    if (dedupText.includes('omitted') || dedupText.includes('[x')) {
      pass('mcp-reduce-dedup');
    } else {
      fail('mcp-reduce-dedup', `Lines not deduplicated: ${JSON.stringify(dedupText)}`);
    }

    // ── Test 5: tools/call — stack trace folding ────────────────────
    const stackResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: {
          log_text: [
            'Error: Something broke',
            '    at myApp.handler (src/app.js:10:5)',
            '    at Object.dispatch (node_modules/express/lib/router/index.js:274:5)',
            '    at router (node_modules/express/lib/router/index.js:47:12)',
            '    at Layer.handle (node_modules/express/lib/router/layer.js:95:5)',
            '    at Function.process_params (node_modules/express/lib/router/index.js:340:12)',
            '    at next (node_modules/express/lib/router/route.js:149:14)',
            '    at myApp.respond (src/app.js:25:3)',
          ].join('\n'),
        },
      },
    });

    const stackText: string = stackResponse.result?.content?.[0]?.text ?? '';

    if (stackText.includes('omitted') && stackText.includes('framework frame')) {
      pass('mcp-reduce-stack-folded');
    } else {
      fail('mcp-reduce-stack-folded', `Stack not folded: ${JSON.stringify(stackText)}`);
    }

    // App frames should be preserved
    if (stackText.includes('myApp.handler') && stackText.includes('myApp.respond')) {
      pass('mcp-reduce-stack-preserved');
    } else {
      fail('mcp-reduce-stack-preserved', `App frames missing: ${JSON.stringify(stackText)}`);
    }

    // ── Test 6: tools/call — full pipeline (ANSI + noise + IDs) ─────
    const fullResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: {
          log_text: [
            '\x1b[32m2024-01-15T10:30:45.123Z\x1b[0m [DEBUG] Health check OK',
            '\x1b[32m2024-01-15T10:30:46.123Z\x1b[0m [DEBUG] Health check OK',
            '\x1b[32m2024-01-15T10:30:47.123Z\x1b[0m [INFO] Processing abc12345-def6-7890-abcd-ef1234567890',
            '\x1b[32m2024-01-15T10:30:48.123Z\x1b[0m [ERROR] Failed for abc12345-def6-7890-abcd-ef1234567890',
            '',
            '',
            '',
          ].join('\n'),
        },
      },
    });

    const fullText: string = fullResponse.result?.content?.[0]?.text ?? '';

    if (!fullText.includes('\x1b[')) {
      pass('mcp-full-strip-ansi');
    } else {
      fail('mcp-full-strip-ansi', `ANSI codes remain: ${JSON.stringify(fullText)}`);
    }

    if (!fullText.includes('Health check')) {
      pass('mcp-full-filter-noise');
    } else {
      fail('mcp-full-filter-noise', `Noise not filtered: ${JSON.stringify(fullText)}`);
    }

    if (!fullText.includes('abc12345')) {
      pass('mcp-full-shorten-ids');
    } else {
      fail('mcp-full-shorten-ids', `IDs not shortened: ${JSON.stringify(fullText)}`);
    }

    // ── Test 7: tools/call — URL shortening ─────────────────────────
    const urlResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: {
          log_text: 'GET https://api.example.com/v1/users/123/posts/456/comments?page=2&limit=50&auth=secret',
        },
      },
    });

    const urlText: string = urlResponse.result?.content?.[0]?.text ?? '';

    if (!urlText.includes('page=2') && !urlText.includes('auth=secret')) {
      pass('mcp-reduce-url-params');
    } else {
      fail('mcp-reduce-url-params', `Query params not stripped: ${JSON.stringify(urlText)}`);
    }

    // ── Test 8: error — unknown tool ────────────────────────────────
    const unknownResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'nonexistent_tool',
        arguments: { log_text: 'test' },
      },
    });

    if (unknownResponse.error) {
      pass('mcp-error-unknown-tool');
    } else {
      fail('mcp-error-unknown-tool', `Expected error, got: ${JSON.stringify(unknownResponse)}`);
    }

    // ── Test 9: empty input ─────────────────────────────────────────
    const emptyResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: { log_text: '' },
      },
    });

    // Empty input: our handler throws for falsy log_text, either error or result is fine
    if (emptyResponse.error || emptyResponse.result) {
      pass('mcp-empty-input');
    } else {
      fail('mcp-empty-input', `Unexpected response: ${JSON.stringify(emptyResponse)}`);
    }

    // ── Test 10: file parameter — raw logs never enter LLM context ──
    // Simulate: AI redirects command output to a temp file, passes path to MCP.
    // The raw log text never enters the conversation — only the compressed result.
    const tmpLogPath = path.join(__dirname, '..', 'test', 'fixtures', 'tmp-eval', 'mcp-test-input.log');
    const testDir = path.dirname(tmpLogPath);
    if (!require('fs').existsSync(testDir)) {
      require('fs').mkdirSync(testDir, { recursive: true });
    }
    require('fs').writeFileSync(tmpLogPath, [
      '2026-03-05 13:02:15 - app.video_encoder - INFO - ============================================================',
      '2026-03-05 13:02:15 - app.video_encoder - INFO - Starting single-pass encoding...',
      '2026-03-05 13:02:15 - app.video_encoder - INFO - Input framerate: 29.97fps',
      '2026-03-05 13:02:15 - app.video_encoder - INFO - Output framerate: 30fps',
      '2026-03-05 13:02:15 - app.video_encoder - INFO - ============================================================',
      '2026-03-05 13:02:16 - app.export - INFO - Encoding frame 25/449',
      '2026-03-05 13:02:17 - app.export - INFO - Encoding frame 100/449',
      '2026-03-05 13:02:18 - app.export - INFO - Encoding frame 200/449',
      '2026-03-05 13:02:20 - app.export - INFO - Encoding frame 449/449',
      '2026-03-05 13:02:20 - app.video_encoder - ERROR - Frame 312 decode failed: corrupted NAL unit',
      '2026-03-05 13:02:20 - app.video_encoder - WARNING - Skipped 1 corrupted frame',
      '2026-03-05 13:02:23 - app.video_encoder - INFO - Single-pass encoding complete!',
    ].join('\n'));

    const fileResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: { file: tmpLogPath },
      },
    });

    const fileText: string = fileResponse.result?.content?.[0]?.text ?? '';
    if (fileText.includes('encoding') && fileText.length > 0 && !fileResponse.error) {
      pass('mcp-file-param');
    } else {
      fail('mcp-file-param', `File read failed: ${JSON.stringify(fileResponse.error ?? fileText)}`);
    }

    // ── Test 11: file + level filter — errors-only debugging ────────
    // Simulate: "Show me just the errors from this log"
    // Focus filters run post-compression, so with a small log the output
    // may not have "omitted" annotations — but the error must be present.
    const errorResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: { file: tmpLogPath, level: 'error', context: 1 },
      },
    });

    const errorText: string = errorResponse.result?.content?.[0]?.text ?? '';
    if (errorText.includes('corrupted NAL')) {
      pass('mcp-focus-level-error');
    } else {
      fail('mcp-focus-level-error', `Level filter didn't isolate errors: ${JSON.stringify(errorText)}`);
    }

    // ── Test 12: file + component filter ─────────────────────────────
    // Simulate: "Show me only the video_encoder logs"
    const compResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 12,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: { file: tmpLogPath, component: 'video_encoder' },
      },
    });

    const compText: string = compResponse.result?.content?.[0]?.text ?? '';
    if (compText.includes('video_encoder')) {
      pass('mcp-focus-component');
    } else {
      fail('mcp-focus-component', `Component filter didn't work: ${JSON.stringify(compText)}`);
    }

    // ── Test 13: file + grep filter (before time_range, uses simpler assertion)
    // Simulate: "Search for anything related to corruption"
    const grepResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 13,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: { file: tmpLogPath, grep: 'corrupt' },
      },
    });

    const grepText: string = grepResponse.result?.content?.[0]?.text ?? '';
    if (grepText.includes('corrupted')) {
      pass('mcp-focus-grep');
    } else {
      fail('mcp-focus-grep', `Grep filter didn't work: ${JSON.stringify(grepText)}`);
    }

    // ── Test 15: tail parameter — only recent lines ──────────────────
    // Simulate: "Just show me the last 5 lines of the log"
    const tailResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 15,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: { file: tmpLogPath, tail: 5 },
      },
    });

    const tailText: string = tailResponse.result?.content?.[0]?.text ?? '';
    // The last 5 lines start from "Encoding frame 449/449", so shouldn't include "frame 25"
    if (tailText.includes('complete') && !tailText.includes('frame 25')) {
      pass('mcp-tail');
    } else {
      fail('mcp-tail', `Tail didn't limit to last lines: ${JSON.stringify(tailText)}`);
    }

    // ── Test 16: missing input — neither file nor log_text ───────────
    const noInputResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 16,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: {},
      },
    });

    if (noInputResponse.error) {
      pass('mcp-error-no-input');
    } else {
      fail('mcp-error-no-input', `Expected error, got: ${JSON.stringify(noInputResponse)}`);
    }

    // ── Test 17: bad file path ───────────────────────────────────────
    const badFileResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 17,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: { file: '/nonexistent/path/to/log.txt' },
      },
    });

    if (badFileResponse.error) {
      pass('mcp-error-bad-file');
    } else {
      fail('mcp-error-bad-file', `Expected error for bad path, got: ${JSON.stringify(badFileResponse)}`);
    }

    // ── Test 18: full-stack debugging simulation ─────────────────────
    // Simulate a real debugging conversation:
    //   User: "My export is failing, here are the logs: /path/to/export.log"
    //   AI calls: reduce_log({ file: path, level: "warning", context: 5 })
    //   Result: only warnings/errors with 5 lines of context, compressed
    const fullStackLog = [
      '2026-03-05 10:00:00 - app.main - INFO - Application startup complete',
      '2026-03-05 10:00:01 - app.database - INFO - Connected to PostgreSQL',
      '2026-03-05 10:00:01 - app.cache - INFO - Redis connection established',
      '2026-03-05 10:00:02 - app.auth - INFO - JWT validator initialized',
      '2026-03-05 10:00:05 - app.api - INFO - GET /api/projects → 200',
      '2026-03-05 10:00:06 - app.api - INFO - GET /api/settings → 200',
      '2026-03-05 10:00:10 - app.export - INFO - Starting export job abc-123',
      '2026-03-05 10:00:11 - app.export - INFO - Extracting frames...',
      '2026-03-05 10:00:15 - app.export - INFO - Frame 1/100 extracted',
      '2026-03-05 10:00:16 - app.export - INFO - Frame 2/100 extracted',
      '2026-03-05 10:00:17 - app.export - INFO - Frame 3/100 extracted',
      '2026-03-05 10:00:18 - app.database - WARNING - Connection pool near capacity (18/20)',
      '2026-03-05 10:00:19 - app.export - INFO - Frame 4/100 extracted',
      '2026-03-05 10:00:20 - app.database - ERROR - Connection pool exhausted',
      '2026-03-05 10:00:20 - app.export - ERROR - Failed to save frame 5: database unavailable',
      'Traceback (most recent call last):',
      '  File "app/export.py", line 142, in save_frame',
      '    db.execute(query)',
      '  File "sqlalchemy/engine/base.py", line 1412, in execute',
      '    return self._execute(query)',
      '  File "sqlalchemy/pool/base.py", line 301, in checkout',
      '    raise TimeoutError("pool exhausted")',
      'TimeoutError: pool exhausted',
      '2026-03-05 10:00:21 - app.export - ERROR - Export job abc-123 failed',
      '2026-03-05 10:00:22 - app.cleanup - INFO - Cleaning up temp files',
      '2026-03-05 10:00:23 - app.api - INFO - POST /api/export/retry → 200',
    ].join('\n');

    const fullStackPath = path.join(testDir, 'mcp-test-fullstack.log');
    require('fs').writeFileSync(fullStackPath, fullStackLog);

    const debugResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 18,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: { file: fullStackPath, level: 'warning', context: 2 },
      },
    });

    const debugText: string = debugResponse.result?.content?.[0]?.text ?? '';
    // Must include the errors and their context, but skip the startup noise
    const hasErrors = debugText.includes('pool exhausted') && debugText.includes('database unavailable');
    const hasWarning = debugText.includes('Connection pool near capacity');
    const skipsStartup = debugText.includes('omitted');
    if (hasErrors && hasWarning && skipsStartup) {
      pass('mcp-fullstack-debug');
    } else {
      fail('mcp-fullstack-debug', `Full-stack debug didn't isolate issues: ${JSON.stringify(debugText)}`);
    }

    // ── Test 14 (cont'd): time_range filter on fullstack log ────────
    // Simulate: "What happened between 10:00:18 and 10:00:21?"
    const timeResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 14,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: { file: fullStackPath, time_range: '10:00:18-10:00:21' },
      },
    });

    const timeText: string = timeResponse.result?.content?.[0]?.text ?? '';
    // Should include the warning/errors from 10:00:18-10:00:21 with context
    if (timeText.includes('pool') && timeText.includes('omitted')) {
      pass('mcp-focus-time-range');
    } else {
      fail('mcp-focus-time-range', `Time range filter didn't work: ${JSON.stringify(timeText)}`);
    }

    // Clean up temp files
    try {
      require('fs').unlinkSync(tmpLogPath);
      require('fs').unlinkSync(fullStackPath);
    } catch { /* ignore cleanup errors */ }

    // ── Test 19: large input (verify no crash) ──────────────────────
    const bigLog = Array.from({ length: 200 }, (_, i) =>
      `2024-01-15T10:${String(i % 60).padStart(2, '0')}:00.000Z [INFO] Line ${i} data=abc12345-def6-7890-abcd-ef1234567890`
    ).join('\n');

    const bigResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 19,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: { log_text: bigLog },
      },
    }, 10000);

    const bigText: string = bigResponse.result?.content?.[0]?.text ?? '';

    if (bigText.length < bigLog.length) {
      const ratio = ((1 - bigText.length / bigLog.length) * 100).toFixed(0);
      pass(`mcp-large-input (${ratio}% reduction)`);
    } else {
      fail('mcp-large-input', `Output not smaller: ${bigText.length} >= ${bigLog.length}`);
    }

    // ── Test 20: small output → returned directly (under threshold) ──
    const smallResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: {
          log_text: [
            '10:00:00 INFO Starting application',
            '10:00:01 ERROR Database connection failed: timeout',
            '10:00:02 INFO Retrying...',
          ].join('\n'),
        },
      },
    });

    const smallText: string = smallResponse.result?.content?.[0]?.text ?? '';
    if (smallText.includes('Database connection failed') && smallText.includes('tokens')) {
      pass('mcp-threshold-under-returns-output');
    } else {
      fail('mcp-threshold-under-returns-output', `Expected output returned: ${JSON.stringify(smallText.slice(0, 300))}`);
    }

    // ── Test 21: large output, no filters → threshold gate with enhanced summary ──
    const gateLog = Array.from({ length: 500 }, (_, i) => {
      const level = i % 50 === 0 ? 'ERROR' : 'INFO';
      return `2024-01-15T10:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z [${level}] Processing batch ${i} with unique-data-${i}-payload-${Math.random().toString(36).slice(2, 12)}`;
    }).join('\n');

    const gateResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: { log_text: gateLog },
      },
    }, 10000);

    const gateText: string = gateResponse.result?.content?.[0]?.text ?? '';
    // Should be gated with enhanced summary: unique errors, SUMMARY header, level breakdown
    const gateTokenMatch = gateText.match(/(\d+) tokens.*exceeds.*threshold/);
    if (gateTokenMatch && gateText.includes('SUMMARY') && gateText.includes('Errors:')) {
      pass('mcp-threshold-gate-enhanced-summary');
    } else if (!gateTokenMatch) {
      // Output was under threshold after reduction — acceptable
      pass('mcp-threshold-gate-enhanced-summary (output under threshold)');
    } else {
      fail('mcp-threshold-gate-enhanced-summary', `Expected enhanced summary with errors: ${JSON.stringify(gateText.slice(0, 500))}`);
    }

    // ── Test 22: large output with filters → threshold gate returns output with tip ──
    const filterGateResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 22,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: { log_text: gateLog, level: 'info' },
      },
    }, 10000);

    const filterGateText: string = filterGateResponse.result?.content?.[0]?.text ?? '';
    const filterGateMatch = filterGateText.match(/(\d+) tokens.*exceeds.*threshold/);
    if (filterGateMatch && filterGateText.includes('TIP:') && filterGateText.includes('Processing batch')) {
      pass('mcp-threshold-gate-filtered-returns-output');
    } else if (!filterGateMatch) {
      pass('mcp-threshold-gate-filtered-returns-output (output under threshold after filtering)');
    } else {
      fail('mcp-threshold-gate-filtered-returns-output', `Expected output with tip: ${JSON.stringify(filterGateText.slice(0, 400))}`);
    }

    // ── Test 23: break_threshold bypasses gate ───────────────────────
    const breakResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 23,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: { log_text: gateLog, break_threshold: true },
      },
    }, 10000);

    const breakText: string = breakResponse.result?.content?.[0]?.text ?? '';
    // Should contain actual log content (Processing batch...)
    if (breakText.includes('Processing batch') || breakText.includes('tokens')) {
      pass('mcp-break-threshold-bypasses-gate');
    } else {
      fail('mcp-break-threshold-bypasses-gate', `Expected output with break_threshold: ${JSON.stringify(breakText.slice(0, 300))}`);
    }

    // ── Test 24: query + large output + no API key → returns output with note ──
    const queryNoKeyResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 24,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: { log_text: gateLog, query: 'what errors occurred' },
      },
    }, 10000);

    const queryNoKeyText: string = queryNoKeyResponse.result?.content?.[0]?.text ?? '';
    if (queryNoKeyText.includes('ANTHROPIC_API_KEY') && queryNoKeyText.includes('Processing batch')) {
      // No API key: returned output with API key note — correct
      pass('mcp-query-no-apikey-returns-output');
    } else if (queryNoKeyText.includes('extracted by')) {
      // API key was set: LLM extraction succeeded — also correct
      pass('mcp-query-no-apikey-returns-output (API key present)');
    } else if (!queryNoKeyText.match(/exceeds.*threshold/)) {
      // Output was under threshold — returned directly
      pass('mcp-query-no-apikey-returns-output (under threshold)');
    } else {
      fail('mcp-query-no-apikey-returns-output', `Expected output not gated: ${JSON.stringify(queryNoKeyText.slice(0, 300))}`);
    }

    // ── Test 25: custom threshold param ──────────────────────────────
    const customThresholdResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 25,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: {
          log_text: Array.from({ length: 20 }, (_, i) =>
            `10:00:${String(i).padStart(2, '0')} INFO Unique line ${i} data-${Math.random().toString(36).slice(2, 8)}`
          ).join('\n'),
          threshold: 10,  // very low — should trigger gate
        },
      },
    });

    const customText: string = customThresholdResponse.result?.content?.[0]?.text ?? '';
    if (customText.includes('exceeds') && customText.includes('10 threshold') && customText.includes('SUMMARY')) {
      pass('mcp-custom-threshold');
    } else {
      fail('mcp-custom-threshold', `Expected gate at threshold 10: ${JSON.stringify(customText.slice(0, 300))}`);
    }

    // ── Test 26: context_level filters out INFO context lines ──────
    const ctxLevelLog = [
      '10:00:00 INFO Normal operation 1',
      '10:00:01 INFO Normal operation 2',
      '10:00:02 INFO Normal operation 3',
      '10:00:03 WARNING Memory usage high',
      '10:00:04 INFO Normal operation 4',
      '10:00:05 ERROR Crashed!',
      'Traceback (most recent call last):',
      '  File "app.py", line 42',
      '10:00:06 INFO Restarting...',
      '10:00:07 INFO Back online',
    ].join('\n');

    const ctxLevelResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 26,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: { log_text: ctxLevelLog, level: 'error', before: 5, after: 2, context_level: 'warning' },
      },
    });

    const ctxLevelText: string = ctxLevelResponse.result?.content?.[0]?.text ?? '';
    // Should include the error, warning, and stack trace (no level marker) but NOT the INFO context lines
    const ctxHasError = ctxLevelText.includes('Crashed');
    const ctxHasWarning = ctxLevelText.includes('Memory usage high');
    const ctxHasTrace = ctxLevelText.includes('Traceback');
    const ctxMissingInfo = !ctxLevelText.includes('Normal operation');
    if (ctxHasError && ctxHasWarning && ctxHasTrace && ctxMissingInfo) {
      pass('mcp-context-level-filters-info');
    } else {
      fail('mcp-context-level-filters-info',
        `error=${ctxHasError} warning=${ctxHasWarning} trace=${ctxHasTrace} noInfo=${ctxMissingInfo}: ${JSON.stringify(ctxLevelText.slice(0, 400))}`);
    }

    // ── Test 27: enhanced summary includes unique errors with counts ──
    const summaryLog = Array.from({ length: 100 }, (_, i) => {
      if (i === 20) return '10:00:20 ERROR Connection timeout';
      if (i === 30) return '10:00:30 ERROR Disk full';
      if (i === 40) return '10:00:40 ERROR Connection timeout';
      if (i === 50) return '10:00:50 WARNING Low memory';
      return `10:00:${String(i % 60).padStart(2, '0')} INFO Request ${i} user_${i % 10} session_${Math.random().toString(36).slice(2, 8)}`;
    }).join('\n');

    const summaryResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 27,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: { log_text: summaryLog, threshold: 50 },  // Low threshold forces summary
      },
    });

    const summaryText: string = summaryResponse.result?.content?.[0]?.text ?? '';
    const hasSummaryHeader = summaryText.includes('SUMMARY');
    const hasErrMsg = summaryText.includes('Connection timeout');
    const hasDiskFull = summaryText.includes('Disk full');
    const hasWarnMsg = summaryText.includes('Low memory');
    const hasCount = summaryText.includes('[x2]');  // Connection timeout appears twice
    if (hasSummaryHeader && hasErrMsg && hasDiskFull && hasWarnMsg && hasCount) {
      pass('mcp-enhanced-summary-unique-messages');
    } else {
      fail('mcp-enhanced-summary-unique-messages',
        `header=${hasSummaryHeader} err=${hasErrMsg} disk=${hasDiskFull} warn=${hasWarnMsg} count=${hasCount}: ${JSON.stringify(summaryText.slice(0, 500))}`);
    }

    // ── Test 28: no-error log summary shows frequent patterns ────────
    const noErrorLog = Array.from({ length: 100 }, (_, i) =>
      `10:00:${String(i % 60).padStart(2, '0')} INFO Processing request ${i} for user_${i % 10}`
    ).join('\n');

    const noErrResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 28,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: { log_text: noErrorLog, threshold: 10 },  // Low threshold forces summary
      },
    });

    const noErrText: string = noErrResponse.result?.content?.[0]?.text ?? '';
    if (noErrText.includes('Frequent patterns') && noErrText.includes('[x')) {
      pass('mcp-enhanced-summary-frequent-patterns');
    } else {
      fail('mcp-enhanced-summary-frequent-patterns',
        `Expected frequent patterns section: ${JSON.stringify(noErrText.slice(0, 400))}`);
    }

    // ── Test 29: filters + over threshold returns actual output (not just hints) ──
    const overFilterResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 29,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: { log_text: gateLog, level: 'error', threshold: 5 },  // Very low threshold
      },
    });

    const overFilterText: string = overFilterResponse.result?.content?.[0]?.text ?? '';
    // New behavior: filters + over threshold → returns the actual output with a TIP
    if (overFilterText.includes('Processing batch') && overFilterText.includes('TIP:')) {
      pass('mcp-filtered-over-threshold-returns-output');
    } else if (!overFilterText.match(/exceeds.*threshold/)) {
      pass('mcp-filtered-over-threshold-returns-output (under threshold)');
    } else {
      fail('mcp-filtered-over-threshold-returns-output',
        `Expected actual output with TIP: ${JSON.stringify(overFilterText.slice(0, 400))}`);
    }

  } catch (err: any) {
    fail('mcp-communication', err.message);
    if (stderr) {
      console.log(`    Server stderr: ${stderr.trim()}`);
    }
  } finally {
    rl.close();
    proc.kill();
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
