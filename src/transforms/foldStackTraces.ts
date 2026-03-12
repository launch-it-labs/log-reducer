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

// Log prefix pattern: starts with a timestamp (HH:MM:SS or ISO date), then
// optionally contains service/level info in brackets, up to the last "]".
const LOG_PREFIX_RE = /^\d[\d:T. -]+\S*.*\]\s*/;

// Bracket-prefixed log lines without a timestamp (e.g., after compressPrefix
// strips timestamps): "  [ERROR] worker:  1: 0xb7c3e0..."
const BRACKET_PREFIX_RE = /^\s*\[(?:ERROR|WARN|INFO|DEBUG|TRACE|FATAL)\]\s+\S+:\s*/;

function stripLogPrefix(line: string): string {
  const m = line.match(LOG_PREFIX_RE);
  if (m && m[0].length < line.length) {
    return line.substring(m[0].length);
  }
  const m2 = line.match(BRACKET_PREFIX_RE);
  if (m2 && m2[0].length < line.length) {
    return line.substring(m2[0].length);
  }
  return line;
}

function isFrameLine(line: string): boolean {
  const stripped = stripExcGroupPrefix(line);
  if (FRAME_PATTERNS.some((p) => p.test(stripped))) return true;
  // Try after stripping log prefix (handles lines like "23:13:38 app[x] [info]  File ...")
  const withoutPrefix = stripLogPrefix(stripped);
  if (withoutPrefix !== stripped) {
    return FRAME_PATTERNS.some((p) => p.test(withoutPrefix));
  }
  return false;
}

function isCaretLine(line: string): boolean {
  const stripped = stripExcGroupPrefix(line).trim();
  // Pure caret line, or a line whose only meaningful content is carets
  // (handles log prefixes like "23:13:38 app[x] lax [info]   ^^^^")
  return /^\^+$/.test(stripped) || /\s\^{3,}\s*$/.test(line);
}

// Extract the log prefix from a frame line (the part before the frame content).
// For example: "23:13:38 app[$1] lax [info]  File ..." → "23:13:38 app[$1] lax [info]"
// Uses specific frame-start markers rather than the generic FRAME_PATTERNS to
// avoid false matches on timestamps (the Go pattern /\S+:\d+/ matches "23:13:38").
const FRAME_START_RE = /\s(?:File\s+"|at\s+\S)/;
function extractLogPrefix(frameLine: string): string {
  const m = frameLine.match(FRAME_START_RE);
  if (m && m.index !== undefined && m.index > 0) {
    // Return everything up to (but not including) the whitespace before "File"/"at"
    return frameLine.substring(0, m.index);
  }
  return '';
}

// Check if a line is a code line belonging to the preceding frame.
// Code lines are indented or have a | prefix. Lines starting at column 0
// (after stripping \r) are never part of a frame — unless they share a log
// prefix with the preceding frame line (e.g., Fly.io prefixed output).
function isCodeLine(line: string, stripped: string, logPrefix?: string): boolean {
  let effectiveLine = line.replace(/\r$/, '');
  // If the line shares the same log prefix as the frame, strip it before
  // checking indentation (the actual code content is indented after the prefix).
  if (logPrefix && effectiveLine.startsWith(logPrefix)) {
    effectiveLine = effectiveLine.substring(logPrefix.length);
  }
  if (effectiveLine.length > 0 && !/^\s/.test(effectiveLine) && !/^\|/.test(effectiveLine)) return false;
  if (stripped === '') return false;
  // Indented log entries with bracket level prefixes are separate log lines, not code
  if (BRACKET_PREFIX_RE.test(stripped)) return false;
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
  if (/^\d{2}:\d{2}:\d{2}/.test(stripped)) return true;   // simplified HH:MM:SS from simplifyTimestamps
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
        const fwLine = units[j].lines[0];
        const name = getFrameworkName(fwLine) || getFrameworkName(stripLogPrefix(stripExcGroupPrefix(fwLine)));
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

// Normalize a line for signature comparison: strip exc-group prefix, log prefix, and whitespace.
function normalizeSigLine(line: string): string {
  let s = stripExcGroupPrefix(line);
  // Strip log prefix (e.g., "23:13:38 app[$1] lax [info]") for comparison
  const withoutPrefix = stripLogPrefix(s);
  if (withoutPrefix !== s) s = withoutPrefix;
  return s.trim();
}

// Build a signature from only user-code frames and the trailing error message.
// Framework frames (and their code lines) are excluded so that two traces
// sharing the same app frames + error but differing in framework preamble
// (e.g., one starts from uvicorn, the other from importlib) match as duplicates.
// Log prefixes and timestamps are stripped so timestamps don't prevent matching.
function userFrameSignature(units: FrameUnit[], traceBlock: string[]): string {
  const parts: string[] = [];
  for (const unit of units) {
    if (!unit.isFramework) {
      for (const line of unit.lines) {
        parts.push(normalizeSigLine(line));
      }
    }
  }
  // Append trailing lines from traceBlock that aren't frame/annotation lines
  // (i.e., the error message like "ModuleNotFoundError: No module named 'torch'")
  for (const line of traceBlock) {
    const stripped = normalizeSigLine(line);
    if (stripped === '') continue;
    if (isFrameLine(line)) continue;
    if (/\[\.{3}\s+\d+\s+(?:framework\s+)?frames?\s/.test(line)) continue;
    if (isSeparatorLine(line)) continue;
    if (/^[A-Za-z_][\w.]*(?:Error|Exception|Warning):/.test(stripped) ||
        /^ExceptionGroup:/.test(stripped)) {
      parts.push(stripped);
    }
  }
  return parts.filter(p => p !== '').join('\n');
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
          const prefix = extractLogPrefix(frameLine);
          i++;

          // Consume following non-frame lines as code lines of this frame
          while (i < lines.length && !isFrameLine(lines[i])) {
            const stripped = stripExcGroupPrefix(lines[i]).trim();
            if (!isCodeLine(lines[i], stripped, prefix)) break;
            unitLines.push(lines[i]);
            i++;
          }

          // Check framework status on both the raw line and prefix-stripped version
          const strippedFrame = stripLogPrefix(stripExcGroupPrefix(frameLine));
          units.push({
            lines: unitLines,
            isFramework: isFrameworkFrame(frameLine) || isFrameworkFrame(strippedFrame),
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

        // Check if this trace is a duplicate of a previous one.
        // Use the user-frame signature (excluding framework frames) so that
        // traces differing only in framework preamble match. Use suffix matching
        // so a fragment (e.g., mid-trace start in a crash loop) matches the full trace.
        const userSig = userFrameSignature(units, traceBlock);
        const isDuplicate = userSig !== '' && seenTraces.some(
          prev => prev.endsWith(userSig) || userSig.endsWith(prev)
        );
        if (isDuplicate) {
          result.push(`  [... duplicate traceback omitted ...]`);
        } else {
          seenTraces.push(userSig);
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
