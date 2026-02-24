import * as fs from 'fs';
import * as path from 'path';
import { stripAnsi } from '../src/transforms/stripAnsi';
import { normalizeWhitespace } from '../src/transforms/normalizeWhitespace';
import { shortenIds } from '../src/transforms/shortenIds';
import { simplifyTimestamps } from '../src/transforms/simplifyTimestamps';
import { deduplicate } from '../src/transforms/deduplicate';
import { detectCycles } from '../src/transforms/detectCycles';
import { filterNoise } from '../src/transforms/filterNoise';
import { foldStackTraces } from '../src/transforms/foldStackTraces';
import { minify } from '../src/pipeline';
import { Transform } from '../src/types';

// __dirname at runtime is out/test/, so go up two levels to project root
const FIXTURES_DIR = path.join(__dirname, '..', '..', 'test', 'fixtures');

interface TestCase {
  name: string;
  dir: string;
  transform: ((input: string) => string) | null; // null = full pipeline
}

const TEST_CASES: TestCase[] = [
  { name: '01-strip-ansi', dir: '01-strip-ansi', transform: (s) => stripAnsi.apply(s) },
  { name: '02-normalize-whitespace', dir: '02-normalize-whitespace', transform: (s) => normalizeWhitespace.apply(s) },
  { name: '03-shorten-ids', dir: '03-shorten-ids', transform: (s) => shortenIds.apply(s) },
  { name: '04-simplify-timestamps', dir: '04-simplify-timestamps', transform: (s) => simplifyTimestamps.apply(s) },
  { name: '05-deduplicate', dir: '05-deduplicate', transform: (s) => deduplicate.apply(s) },
  { name: '06-detect-cycles', dir: '06-detect-cycles', transform: (s) => detectCycles.apply(s) },
  { name: '07-filter-noise', dir: '07-filter-noise', transform: (s) => filterNoise.apply(s) },
  { name: '08-fold-stack-traces', dir: '08-fold-stack-traces', transform: (s) => foldStackTraces.apply(s) },
  { name: '09-full-pipeline', dir: '09-full-pipeline', transform: null },
  { name: '10-real-world-python', dir: '10-real-world-python', transform: null },
  { name: '11-real-world-export', dir: '11-real-world-export', transform: null },
];

let passed = 0;
let failed = 0;

for (const tc of TEST_CASES) {
  const fixtureDir = path.join(FIXTURES_DIR, tc.dir);
  const inputPath = path.join(fixtureDir, 'input.log');
  const expectedPath = path.join(fixtureDir, 'expected.log');
  const actualPath = path.join(fixtureDir, 'actual.log');

  const input = fs.readFileSync(inputPath, 'utf-8');
  const expected = fs.readFileSync(expectedPath, 'utf-8');

  let actual: string;
  if (tc.transform) {
    actual = tc.transform(input);
  } else {
    actual = minify(input);
  }

  // Write actual output for inspection
  fs.writeFileSync(actualPath, actual, 'utf-8');

  // Normalize line endings for comparison
  const expectedNorm = expected.replace(/\r\n/g, '\n').trimEnd();
  const actualNorm = actual.replace(/\r\n/g, '\n').trimEnd();

  if (actualNorm === expectedNorm) {
    console.log(`  PASS  ${tc.name}`);
    passed++;
  } else {
    console.log(`  FAIL  ${tc.name}`);
    failed++;

    // Show diff details
    const expectedLines = expectedNorm.split('\n');
    const actualLines = actualNorm.split('\n');
    const maxLines = Math.max(expectedLines.length, actualLines.length);

    for (let i = 0; i < maxLines; i++) {
      const exp = expectedLines[i] ?? '<missing>';
      const act = actualLines[i] ?? '<missing>';
      if (exp !== act) {
        console.log(`    Line ${i + 1}:`);
        console.log(`      expected: ${JSON.stringify(exp)}`);
        console.log(`      actual:   ${JSON.stringify(act)}`);
      }
    }
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
