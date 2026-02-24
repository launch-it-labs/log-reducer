#!/usr/bin/env node

/**
 * CLI wrapper: reads log text from stdin, writes reduced output to stdout.
 * Usage: cat app.log | npx logreducer
 *    or: npx logreducer < app.log > reduced.log
 */

import { minify } from './pipeline';

function main(): void {
  const chunks: Buffer[] = [];

  process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));

  process.stdin.on('end', () => {
    const input = Buffer.concat(chunks).toString('utf-8');
    const output = minify(input);
    process.stdout.write(output);
  });

  process.stdin.on('error', (err: Error) => {
    process.stderr.write(`Error reading stdin: ${err.message}\n`);
    process.exit(1);
  });
}

main();
