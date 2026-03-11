#!/usr/bin/env node

/**
 * CLI wrapper: reads log text from stdin, writes reduced output to stdout.
 *
 * Usage:
 *   cat app.log | npx logreducer
 *   npx logreducer < app.log > reduced.log
 *   npx logreducer --level error < app.log
 *   npx logreducer --grep "exception|timeout" --context 5 < app.log
 *   npx logreducer --contains "user_id=42" < app.log
 */

import { minify } from './pipeline';
import { FocusOptions } from './types';

function parseArgs(argv: string[]): FocusOptions {
  const focus: FocusOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--level':
        if (next && ['error', 'warning', 'info', 'debug'].includes(next)) {
          focus.level = next as FocusOptions['level'];
          i++;
        }
        break;
      case '--grep':
        if (next) { focus.grep = next; i++; }
        break;
      case '--contains':
        if (next) { focus.contains = next; i++; }
        break;
      case '--context':
        if (next) { focus.context = parseInt(next, 10); i++; }
        break;
    }
  }
  return focus;
}

function main(): void {
  if (process.argv.includes('--mcp')) {
    require('./mcp-server');
    return;
  }

  const focus = parseArgs(process.argv.slice(2));
  const hasFocus = !!(focus.level || focus.grep || focus.contains);
  const chunks: Buffer[] = [];

  process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));

  process.stdin.on('end', () => {
    const input = Buffer.concat(chunks).toString('utf-8');
    const output = minify(input, undefined, hasFocus ? focus : undefined);
    process.stdout.write(output);
  });

  process.stdin.on('error', (err: Error) => {
    process.stderr.write(`Error reading stdin: ${err.message}\n`);
    process.exit(1);
  });
}

main();
