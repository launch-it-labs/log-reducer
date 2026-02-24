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

    if (reduceTool?.inputSchema?.properties?.log_text?.type === 'string') {
      pass('mcp-tool-schema');
    } else {
      fail('mcp-tool-schema', `Missing or wrong log_text in inputSchema: ${JSON.stringify(reduceTool?.inputSchema)}`);
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

    // ── Test 10: large input (verify no crash) ──────────────────────
    const bigLog = Array.from({ length: 200 }, (_, i) =>
      `2024-01-15T10:${String(i % 60).padStart(2, '0')}:00.000Z [INFO] Line ${i} data=abc12345-def6-7890-abcd-ef1234567890`
    ).join('\n');

    const bigResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: 10,
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
