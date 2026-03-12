import { Transform } from '../types';

/**
 * Collapse runs of test-runner PASS lines into a count summary.
 *
 * Consecutive PASS/ok lines from test runners (Jest, Go test, pytest) where
 * each line is a distinct test file are collapsed to "PASS [N suites]".
 * FAIL lines are always kept verbatim — they are signal.
 *
 * The transform is intentionally conservative: it only triggers on lines that
 * match well-known test runner formats, to avoid collapsing non-test output.
 */

const PASS_PATTERNS: RegExp[] = [
  // Jest/Vitest: "PASS src/foo.test.ts (2.341s)"
  /^PASS\s+\S+(?:\s+\([\d.]+s\))?\s*$/,
  // Go test: "ok  	github.com/foo/bar	0.123s"
  /^ok\s+\S+\s+[\d.]+s\s*$/,
  // pytest: "PASSED tests/test_foo.py::test_bar"
  /^PASSED\s+\S+/,
];

const FAIL_PATTERNS: RegExp[] = [
  // Jest/Vitest: "FAIL src/foo.test.ts (8.234s)"
  /^FAIL\s+\S+/,
  // pytest: "FAILED tests/test_foo.py::test_bar"
  /^FAILED\s+\S+/,
];

function isPass(line: string): boolean {
  return PASS_PATTERNS.some(re => re.test(line));
}

function isFail(line: string): boolean {
  return FAIL_PATTERNS.some(re => re.test(line));
}

export const collapseTestStatus: Transform = {
  name: 'Collapse Test Status',
  settingKey: 'collapseTestStatus',
  apply(input: string): string {
    const lines = input.split('\n');
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
      if (!isPass(lines[i])) {
        result.push(lines[i]);
        i++;
        continue;
      }

      // Accumulate consecutive PASS lines
      const runStart = i;
      while (i < lines.length && isPass(lines[i])) {
        i++;
      }
      const runLength = i - runStart;

      if (runLength >= 3) {
        result.push(`PASS [${runLength} suites]`);
      } else {
        // Emit verbatim
        for (let j = runStart; j < i; j++) {
          result.push(lines[j]);
        }
      }
    }

    return result.join('\n');
  },
};
