import * as fs from 'fs';
import * as path from 'path';
import { minify, ALL_TRANSFORMS } from '../src/pipeline';

// __dirname at runtime is out/test/, so go up two levels to project root
const FIXTURES_DIR = path.join(__dirname, '..', '..', 'test', 'fixtures');

// Look up a transform by its settingKey (the programmatic ID used in
// PipelineOptions and package.json — less fragile than display names).
function findTransform(settingKey: string): (input: string) => string {
  const t = ALL_TRANSFORMS.find(t => t.settingKey === settingKey);
  if (!t) throw new Error(`Unknown transform settingKey: ${settingKey}`);
  return (s) => t.apply(s);
}

interface TestCase {
  name: string;
  transform: ((input: string) => string) | null; // null = full pipeline
}

const TEST_CASES: TestCase[] = [
  // Individual transforms
  { name: '01-strip-ansi', transform: findTransform('stripAnsi') },
  { name: '02-normalize-whitespace', transform: findTransform('normalizeWhitespace') },
  { name: '03-shorten-ids', transform: findTransform('shortenIds') },
  { name: '04-simplify-timestamps', transform: findTransform('simplifyTimestamps') },
  { name: '05-deduplicate', transform: findTransform('deduplicateLines') },
  { name: '06-detect-cycles', transform: findTransform('detectCycles') },
  { name: '07-filter-noise', transform: findTransform('filterNoise') },
  { name: '08-fold-stack-traces', transform: findTransform('foldStackTraces') },
  // Full pipeline
  { name: '09-full-pipeline', transform: null },
  { name: '10-real-world-python', transform: null },
  { name: '11-real-world-export', transform: null },
];

let passed = 0;
let failed = 0;

for (const tc of TEST_CASES) {
  const fixtureDir = path.join(FIXTURES_DIR, tc.name);
  const inputPath = path.join(fixtureDir, 'input.log');
  const expectedPath = path.join(fixtureDir, 'expected.log');
  const actualPath = path.join(fixtureDir, 'actual.log');

  const input = fs.readFileSync(inputPath, 'utf-8');
  const expected = fs.readFileSync(expectedPath, 'utf-8');

  const actual = tc.transform ? tc.transform(input) : minify(input);

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
