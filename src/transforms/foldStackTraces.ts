import { Transform } from '../types';
import { FRAME_PATTERNS, isFrameworkFrame, getFrameworkName } from './stackTrace/frameworkPatterns';
import { shortenFilePaths } from './stackTrace/pathShortener';

/**
 * Fold stack traces: collapse consecutive framework frames and shorten file paths.
 *
 * Detects stack frames by looking for common patterns:
 * - Java: "at com.example.Class.method(File.java:123)"
 * - Python: '  File "/path/to/file.py", line 123, in function'
 * - Node.js: "    at Object.<anonymous> (/path/to/file.js:123:45)"
 * - .NET: "   at Namespace.Class.Method() in /path/file.cs:line 123"
 * - Go: "\t/path/to/file.go:123 +0x1a2"
 *
 * Handles Python exception group formatting (| prefix).
 * Shortens absolute file paths to package-relative paths.
 * Removes caret indicator lines (^^^).
 *
 * Folding strategy: keep all user-code frames, collapse consecutive runs of
 * framework frames into a summary showing count and framework names.
 */

// Strip Python exception group prefix ("|" with surrounding whitespace)
function stripExcGroupPrefix(line: string): string {
  return line.replace(/^(\s*\|\s*)+/, '');
}

// Get the indentation/prefix from a frame line (preserves | for exc groups)
function getIndent(line: string): string {
  const match = line.match(/^(\s*(?:\|\s*)*)/);
  return match ? match[1] : '    ';
}

function isFrameLine(line: string): boolean {
  const stripped = stripExcGroupPrefix(line);
  return FRAME_PATTERNS.some((p) => p.test(stripped));
}

function isCaretLine(line: string): boolean {
  const stripped = stripExcGroupPrefix(line).trim();
  return /^\^+$/.test(stripped);
}

// Check if a line is a code line belonging to the preceding frame.
// Code lines are indented or have a | prefix. Lines starting at column 0
// (after stripping \r) are never part of a frame.
function isCodeLine(line: string, stripped: string): boolean {
  const trimmedLine = line.replace(/\r$/, '');
  if (trimmedLine.length > 0 && !/^\s/.test(trimmedLine) && !/^\|/.test(trimmedLine)) return false;
  if (stripped === '') return false;
  if (/^[A-Za-z_][\w.]*(?:Error|Exception|Warning):/.test(stripped)) return false;
  if (/^ExceptionGroup:/.test(stripped)) return false;
  if (/^[-+]+\s/.test(stripped) || /^[-+]+$/.test(stripped)) return false;
  if (/^Traceback\s/.test(stripped)) return false;
  if (/^The above exception/.test(stripped)) return false;
  if (/^During handling/.test(stripped)) return false;
  return true;
}

interface FrameUnit {
  lines: string[];
  isFramework: boolean;
}

// Patterns that introduce a chained traceback
const CHAIN_PATTERNS = [
  /^The above exception was the direct cause of the following exception:$/,
  /^During handling of the above exception, another exception occurred:$/,
];

function isChainIntro(line: string): boolean {
  const stripped = stripExcGroupPrefix(line).trim();
  return CHAIN_PATTERNS.some(p => p.test(stripped));
}

// Determines whether a line ends the trailing-exception-message collection.
// These lines belong to a new log entry or a new traceback, not the current trace.
function isTraceTerminator(line: string, stripped: string): boolean {
  if (stripped === '') return true;
  if (isFrameLine(line)) return true;
  if (isChainIntro(line)) return true;
  if (/^Traceback\s/.test(stripped)) return true;
  if (/^\+\s*Exception Group/.test(stripped)) return true;
  if (/^(INFO|ERROR|WARN|DEBUG|TRACE|FATAL)\b/.test(stripped)) return true;
  if (/^\d{4}-\d{2}-\d{2}[\sT]/.test(stripped)) return true;
  return false;
}

function foldFrameUnits(units: FrameUnit[]): string[] {
  const folded: string[] = [];
  let j = 0;
  while (j < units.length) {
    if (!units[j].isFramework) {
      folded.push(...units[j].lines);
      j++;
    } else {
      const fwStart = j;
      const frameworkNames = new Set<string>();
      while (j < units.length && units[j].isFramework) {
        const name = getFrameworkName(units[j].lines[0]);
        if (name) frameworkNames.add(name);
        j++;
      }
      const count = j - fwStart;
      const indent = getIndent(units[fwStart].lines[0]);
      const names = Array.from(frameworkNames).join(', ');
      if (names) {
        folded.push(`${indent}[... ${count} framework frames (${names}) omitted ...]`);
      } else {
        folded.push(`${indent}[... ${count} frames omitted ...]`);
      }
    }
  }
  return folded;
}

// Separator line: lines like "+----", "+-+---", etc.
function isSeparatorLine(line: string): boolean {
  const stripped = stripExcGroupPrefix(line).trim();
  return /^[+\-]+$/.test(stripped);
}

// Normalize a folded traceback block for comparison: strip | prefixes, separators, whitespace
function traceSignature(lines: string[]): string {
  return lines
    .filter(l => !isSeparatorLine(l))
    .map(l => stripExcGroupPrefix(l).trim())
    .join('\n');
}

export const foldStackTraces: Transform = {
  name: 'Fold Stack Traces',
  settingKey: 'foldStackTraces',
  apply(input: string): string {
    const rawLines = input.split('\n');

    // Preprocess: shorten file paths and remove caret lines
    const lines: string[] = [];
    for (const line of rawLines) {
      if (isCaretLine(line)) continue;
      lines.push(shortenFilePaths(line));
    }

    const result: string[] = [];
    const seenTraces: string[] = [];
    let i = 0;

    while (i < lines.length) {
      if (isFrameLine(lines[i])) {
        // Collect frame units (frame line + optional following code lines)
        const units: FrameUnit[] = [];

        while (i < lines.length && isFrameLine(lines[i])) {
          const frameLine = lines[i];
          const unitLines = [frameLine];
          i++;

          // Consume following non-frame lines as code lines of this frame
          while (i < lines.length && !isFrameLine(lines[i])) {
            const stripped = stripExcGroupPrefix(lines[i]).trim();
            if (!isCodeLine(lines[i], stripped)) break;
            unitLines.push(lines[i]);
            i++;
          }

          units.push({
            lines: unitLines,
            isFramework: isFrameworkFrame(frameLine),
          });
        }

        // Fold framework frames
        const folded = foldFrameUnits(units);

        // Collect trailing exception message lines
        const traceBlock = [...folded];
        while (i < lines.length) {
          const stripped = stripExcGroupPrefix(lines[i]).trim();
          if (isTraceTerminator(lines[i], stripped)) break;
          traceBlock.push(lines[i]);
          i++;
        }

        // Check if this trace is a duplicate of a previous one
        const sig = traceSignature(traceBlock);
        const dupIndex = seenTraces.indexOf(sig);
        if (dupIndex !== -1) {
          result.push(`  [... duplicate traceback omitted ...]`);
        } else {
          seenTraces.push(sig);
          result.push(...traceBlock);
        }
      } else {
        result.push(lines[i]);
        i++;
      }
    }

    return result.join('\n');
  },
};
