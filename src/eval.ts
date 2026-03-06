#!/usr/bin/env node

/**
 * Evaluation CLI: runs the log compressor pipeline step-by-step,
 * records metrics after each transform, and prints a diagnostic table.
 *
 * Usage:
 *   node out/src/eval.js <file>           -- read from file
 *   cat app.log | node out/src/eval.js    -- read from stdin
 *   node out/src/eval.js <file> --score   -- also run LLM semantic check
 *
 * Metrics table goes to stderr; final compressed output goes to stdout.
 */

import * as fs from 'fs';
import { ALL_TRANSFORMS } from './pipeline';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function countTokens(text: string): number {
  return text.split(/\s+/).filter(t => t.length > 0).length;
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split('\n').length;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  filePath: string | null; // null → stdin
  score: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let filePath: string | null = null;
  let score = false;

  for (const arg of args) {
    if (arg === '--score') {
      score = true;
    } else if (arg.startsWith('-')) {
      process.stderr.write(`Unknown flag: ${arg}\n`);
      process.exit(1);
    } else {
      filePath = arg;
    }
  }

  return { filePath, score };
}

function readInput(filePath: string | null): Promise<string> {
  if (filePath) {
    return Promise.resolve(fs.readFileSync(filePath, 'utf-8'));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    process.stdin.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Per-step metrics
// ---------------------------------------------------------------------------

interface StepMetrics {
  name: string;
  tokensBefore: number;
  tokensAfter: number;
  linesBefore: number;
  linesAfter: number;
  charsBefore: number;
  charsAfter: number;
}

function runPipeline(input: string): { steps: StepMetrics[]; output: string } {
  const steps: StepMetrics[] = [];
  let current = input;

  for (const transform of ALL_TRANSFORMS) {
    const before = current;
    const after = transform.apply(current);

    steps.push({
      name: transform.name,
      tokensBefore: countTokens(before),
      tokensAfter: countTokens(after),
      linesBefore: countLines(before),
      linesAfter: countLines(after),
      charsBefore: before.length,
      charsAfter: after.length,
    });

    current = after;
  }

  return { steps, output: current };
}

// ---------------------------------------------------------------------------
// Table formatting
// ---------------------------------------------------------------------------

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function pad(s: string, w: number): string {
  return s.padStart(w);
}

function fmtRange(before: number, after: number, w: number): string {
  return `${pad(fmt(before), w)} -> ${pad(fmt(after), w)}`;
}

function fmtReduction(before: number, after: number): string {
  if (before === 0) return '    N/A';
  const pct = ((before - after) / before) * 100;
  if (pct === 0) return '  0.0% (no change)';
  return `${pad(pct.toFixed(1), 5)}%`;
}

function printTable(steps: StepMetrics[]): void {
  if (steps.length === 0) return;

  // Determine column widths from data
  const allTok = steps.flatMap(s => [s.tokensBefore, s.tokensAfter]);
  const allLin = steps.flatMap(s => [s.linesBefore, s.linesAfter]);
  const allChr = steps.flatMap(s => [s.charsBefore, s.charsAfter]);

  const nameW = Math.max(22, ...steps.map(s => s.name.length)) + 1;
  const tokW = Math.max(...allTok.map(n => fmt(n).length));
  const linW = Math.max(...allLin.map(n => fmt(n).length));
  const chrW = Math.max(...allChr.map(n => fmt(n).length));

  const tokColW = tokW * 2 + 4; // "NNN -> NNN"
  const linColW = linW * 2 + 4;
  const chrColW = chrW * 2 + 4;

  const header = [
    ' ' + 'Transform'.padEnd(nameW),
    'Tokens'.padStart(tokColW),
    'Lines'.padStart(linColW),
    'Chars'.padStart(chrColW),
    'Reduction',
  ].join(' | ');

  const sep = '-'.repeat(header.length);

  process.stderr.write('\n' + header + '\n');
  process.stderr.write(sep + '\n');

  for (const step of steps) {
    const row = [
      ' ' + step.name.padEnd(nameW),
      fmtRange(step.tokensBefore, step.tokensAfter, tokW),
      fmtRange(step.linesBefore, step.linesAfter, linW),
      fmtRange(step.charsBefore, step.charsAfter, chrW),
      fmtReduction(step.tokensBefore, step.tokensAfter),
    ].join(' | ');
    process.stderr.write(row + '\n');
  }

  // Total row
  const first = steps[0];
  const last = steps[steps.length - 1];
  process.stderr.write(sep + '\n');
  const totalRow = [
    ' ' + 'TOTAL'.padEnd(nameW),
    fmtRange(first.tokensBefore, last.tokensAfter, tokW),
    fmtRange(first.linesBefore, last.linesAfter, linW),
    fmtRange(first.charsBefore, last.charsAfter, chrW),
    fmtReduction(first.tokensBefore, last.tokensAfter),
  ].join(' | ');
  process.stderr.write(totalRow + '\n\n');
}

// ---------------------------------------------------------------------------
// LLM semantic scoring (--score)
// ---------------------------------------------------------------------------

const SCORE_MODEL = 'claude-sonnet-4-20250514';
const MAX_SAMPLE_LINES = 250;

function sampleInput(input: string): string {
  const lines = input.split('\n');
  if (lines.length <= MAX_SAMPLE_LINES) return input;
  const head = lines.slice(0, 200);
  const tail = lines.slice(-50);
  return [...head, `\n[... ${lines.length - 250} lines omitted ...]\n`, ...tail].join('\n');
}

async function scorePreservation(originalInput: string, compressedOutput: string): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    process.stderr.write('--score requires ANTHROPIC_API_KEY env var. Skipping.\n');
    return;
  }

  const sampledInput = sampleInput(originalInput);

  const prompt = `You are evaluating a log compression tool. Below is the ORIGINAL log (possibly sampled) and the COMPRESSED output. The tool reduces verbosity for AI consumption while preserving semantic meaning.

Rate semantic preservation 0-100:
- 100 = all meaningful information preserved
- 75 = minor details lost, all errors/warnings/key events preserved
- 50 = significant information loss
- 25 = most information lost
- 0 = output is meaningless

Also identify any specific information LOST in compression.

Respond in this exact format:
SCORE: <number>
FINDINGS:
- <finding 1>
- <finding 2>

If nothing was lost:
SCORE: <number>
FINDINGS:
- No meaningful information lost

<ORIGINAL>
${sampledInput}
</ORIGINAL>

<COMPRESSED>
${compressedOutput}
</COMPRESSED>`;

  process.stderr.write('Scoring semantic preservation with LLM...\n');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: SCORE_MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      process.stderr.write(`LLM API error (${response.status}): ${body}\n`);
      return;
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };

    const text = data.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    process.stderr.write('\n--- Semantic Preservation Score ---\n');
    process.stderr.write(text + '\n');
    process.stderr.write('-----------------------------------\n\n');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`LLM scoring failed: ${msg}\n`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { filePath, score } = parseArgs();

  let input: string;
  try {
    input = await readInput(filePath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error reading input: ${msg}\n`);
    process.exit(1);
  }

  if (input.trim().length === 0) {
    process.stderr.write('Input is empty. Nothing to evaluate.\n');
    process.stdout.write('');
    process.exit(0);
  }

  const { steps, output } = runPipeline(input);

  printTable(steps);

  process.stdout.write(output);

  if (score) {
    await scorePreservation(input, output);
  }
}

main().catch((err: Error) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
