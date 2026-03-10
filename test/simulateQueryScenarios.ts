/**
 * Simulated driving AI test for the threshold gate + query extraction feature.
 *
 * Mimics how a driving AI naturally encounters and responds to the threshold gate:
 *   1. Blind call (no filters) → gate fires, suggests filters
 *   2. With filters → gate fires, suggests query
 *   3. With query → LLM extraction (or fallback)
 *   4. With break_threshold → bypasses gate
 *
 * Usage:
 *   node out/test/simulateQueryScenarios.js [path-to-log]
 *
 * If no log path is given, uses a built-in synthetic log.
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';

const SERVER_PATH = path.join(__dirname, '..', 'src', 'mcp-server.js');

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

function sendRpc(
  proc: ChildProcess,
  rl: readline.Interface,
  message: object,
  timeoutMs = 15000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for response to id=${(message as any).id}`));
    }, timeoutMs);

    const onLine = (line: string): void => {
      if (!line.trim()) return;
      try {
        const parsed = JSON.parse(line);
        if ('id' in parsed || 'error' in parsed) {
          clearTimeout(timer);
          rl.removeListener('line', onLine);
          resolve(parsed);
        }
      } catch { /* ignore non-JSON lines */ }
    };

    rl.on('line', onLine);
    proc.stdin!.write(JSON.stringify(message) + '\n');
  });
}

function sendNotification(proc: ChildProcess, message: object): void {
  proc.stdin!.write(JSON.stringify(message) + '\n');
}

// ---------------------------------------------------------------------------
// Synthetic log generator (produces ~3000+ tokens post-reduction)
// ---------------------------------------------------------------------------

function generateSyntheticLog(): string {
  const lines: string[] = [];
  const components = ['app.database', 'app.auth', 'app.export', 'app.api', 'app.storage'];

  for (let i = 0; i < 300; i++) {
    const min = String(Math.floor(i / 60) % 60).padStart(2, '0');
    const sec = String(i % 60).padStart(2, '0');
    const comp = components[i % components.length];
    const ts = `2024-01-15 10:${min}:${sec}`;

    if (i === 120) {
      lines.push(`${ts} - ${comp} - WARNING - Connection pool near capacity (18/20)`);
    } else if (i === 122) {
      lines.push(`${ts} - ${comp} - ERROR - Connection pool exhausted`);
      lines.push(`${ts} - ${comp} - ERROR - Failed to acquire database connection`);
      lines.push(`Traceback (most recent call last):`);
      lines.push(`  File "/app/database/pool.py", line 45, in acquire`);
      lines.push(`    raise TimeoutError("pool exhausted")`);
      lines.push(`TimeoutError: pool exhausted`);
    } else if (i === 125) {
      lines.push(`${ts} - app.export - ERROR - Export job failed: database unavailable`);
    } else if (i === 130) {
      lines.push(`${ts} - app.export - ERROR - Retry 1/3 failed for export job`);
    } else if (i === 140) {
      lines.push(`${ts} - app.export - ERROR - Retry 2/3 failed for export job`);
    } else if (i === 150) {
      lines.push(`${ts} - app.export - ERROR - Retry 3/3 failed for export job — giving up`);
    } else {
      lines.push(`${ts} - ${comp} - INFO - Processing request ${i} for user_${i % 20} with session_${Math.random().toString(36).slice(2, 10)}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main simulation
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const logPath = process.argv[2];
  let logText: string;

  if (logPath) {
    logText = fs.readFileSync(logPath, 'utf-8');
    console.log(`Using log file: ${logPath}`);
  } else {
    logText = generateSyntheticLog();
    console.log('Using synthetic log (no file path given)');
  }

  const rawTokens = logText.split(/\s+/).filter(t => t.length > 0).length;
  console.log(`Raw log: ${rawTokens} tokens, ${logText.split('\n').length} lines\n`);

  // Spawn MCP server
  const proc = spawn('node', [SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const rl = readline.createInterface({ input: proc.stdout! });
  let stderr = '';
  proc.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  console.log(`ANTHROPIC_API_KEY: ${hasApiKey ? 'set' : 'NOT set (will test fallback path)'}\n`);
  console.log('='.repeat(70));

  let rpcId = 1;

  try {
    // Initialize
    await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: rpcId++,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'simulated-driving-ai', version: '1.0.0' },
      },
    });
    sendNotification(proc, { jsonrpc: '2.0', method: 'notifications/initialized' });
    await new Promise(r => setTimeout(r, 100));

    // ── Step 1: Blind call (no filters) → expect threshold gate ─────
    console.log('\n[Driving AI] Step 1: Blind call — no filters');
    console.log('  → Simulates: "check the log at app.log"');
    console.log('-'.repeat(70));

    const blindResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: rpcId++,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: { log_text: logText },
      },
    }, 10000);

    const blindText: string = blindResponse.result?.content?.[0]?.text ?? '';
    console.log(blindText);

    if (blindText.includes('exceeds') && blindText.includes('threshold')) {
      console.log('\n  ✓ Gate fired — AI sees token count + filter guidance');
      console.log('  ✓ No log content entered context');
    } else {
      console.log('\n  → Output was under threshold, returned directly');
    }

    // ── Step 2: SURVEY (always under threshold) ─────────────────────
    console.log('\n[Driving AI] Step 2: Follow gate guidance — summary: true');
    console.log('-'.repeat(70));

    const surveyResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: rpcId++,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: { log_text: logText, summary: true },
      },
    }, 10000);

    const surveyText: string = surveyResponse.result?.content?.[0]?.text ?? '';
    const surveyTokens = surveyText.split(/\s+/).filter((t: string) => t.length > 0).length;
    console.log(`Response (${surveyTokens} tokens):`);
    console.log(surveyText);

    // ── Step 3: SCAN with filter → might still hit gate ─────────────
    console.log('\n[Driving AI] Step 3: level: "error", limit: 5');
    console.log('-'.repeat(70));

    const scanResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: rpcId++,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: { log_text: logText, level: 'error', limit: 5 },
      },
    }, 10000);

    const scanText: string = scanResponse.result?.content?.[0]?.text ?? '';
    const scanMatch = scanText.match(/\[(\d+) tokens/);
    const scanTokens = scanMatch ? parseInt(scanMatch[1]) : -1;
    console.log(`Response (${scanTokens} tokens):`);
    console.log(scanText);

    // ── Step 4: With filters but still over → gate suggests query ───
    console.log('\n[Driving AI] Step 4: level: "info" (broad filter, likely over threshold)');
    console.log('-'.repeat(70));

    const broadResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: rpcId++,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: { log_text: logText, level: 'info' },
      },
    }, 10000);

    const broadText: string = broadResponse.result?.content?.[0]?.text ?? '';
    console.log(broadText.split('\n').slice(0, 6).join('\n'));

    if (broadText.includes('query:')) {
      console.log('\n  ✓ Gate fired with query hint — AI learns about LLM extraction');
    }

    // ── Step 5: QUERY extraction ────────────────────────────────────
    console.log('\n[Driving AI] Step 5: query: "what caused the database failure"');
    console.log('-'.repeat(70));

    const queryResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: rpcId++,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: {
          log_text: logText,
          query: 'what caused the database connection failure',
          query_budget: 300,
        },
      },
    }, 30000);

    const queryText: string = queryResponse.result?.content?.[0]?.text ?? '';
    const queryMatch = queryText.match(/\[(\d+) tokens/);
    const queryTokens = queryMatch ? parseInt(queryMatch[1]) : -1;
    console.log(`Response (${queryTokens} tokens):`);
    // Show first 20 lines
    console.log(queryText.split('\n').slice(0, 20).join('\n'));
    if (queryText.split('\n').length > 20) console.log('  ...');

    // ── Step 6: break_threshold bypass ──────────────────────────────
    console.log('\n[Driving AI] Step 6: break_threshold: true (bypass gate)');
    console.log('-'.repeat(70));

    const breakResponse = await sendRpc(proc, rl, {
      jsonrpc: '2.0',
      id: rpcId++,
      method: 'tools/call',
      params: {
        name: 'reduce_log',
        arguments: { log_text: logText, break_threshold: true },
      },
    }, 10000);

    const breakText: string = breakResponse.result?.content?.[0]?.text ?? '';
    const breakMatch = breakText.match(/\[(\d+) tokens/);
    const breakTokens = breakMatch ? parseInt(breakMatch[1]) : -1;
    const breakLines = breakText.split('\n');
    console.log(`Response (${breakTokens} tokens, ${breakLines.length} lines):`);
    console.log(breakLines.slice(0, 5).join('\n'));
    console.log(`  ... (${breakLines.length - 5} more lines)`);

    // ── Summary ─────────────────────────────────────────────────────
    console.log('\n' + '='.repeat(70));
    console.log('SIMULATION SUMMARY');
    console.log('='.repeat(70));
    console.log(`  Raw input:              ${rawTokens} tokens`);
    console.log(`  Step 1 (blind):         GATED (0 tokens entered context)`);
    console.log(`  Step 2 (survey):        ${surveyTokens} tokens`);
    console.log(`  Step 3 (errors):        ${scanTokens} tokens`);
    console.log(`  Step 5 (query):         ${queryTokens} tokens`);
    console.log(`  Step 6 (break):         ${breakTokens} tokens (full output)`);
    console.log();

    if (queryText.includes('extracted by')) {
      console.log('  Query extraction:       SUCCEEDED');
      if (queryTokens > 0 && breakTokens > 0) {
        const savings = ((1 - queryTokens / breakTokens) * 100).toFixed(0);
        console.log(`  Extraction savings:     ${breakTokens - queryTokens} tokens (${savings}% less than full)`);
      }
    } else if (queryText.includes('ANTHROPIC_API_KEY')) {
      console.log('  Query extraction:       FALLBACK (no API key — output returned with note)');
      console.log('  Set ANTHROPIC_API_KEY to test actual LLM extraction.');
    } else if (queryText.includes('exceeds') && queryText.includes('threshold')) {
      console.log('  Query extraction:       Not triggered (output gated — would need break_threshold)');
    }

    console.log();

  } catch (err: any) {
    console.error(`\nSimulation failed: ${err.message}`);
    if (stderr) console.error(`Server stderr: ${stderr.trim()}`);
    process.exit(1);
  } finally {
    rl.close();
    proc.kill();
  }
}

main();
