import { Transform } from '../types';
import { skeleton } from '../skeleton';

/**
 * Collapse near-duplicate retry blocks.
 *
 * Many CI/CD systems (Docker builds, deploy pipelines, test runners) retry
 * failed operations. The retried block is structurally almost identical to the
 * original — differing only in timing values, transfer sizes, or cache status.
 *
 * This transform detects when a large block of lines (delimited by known
 * section markers) is repeated with >80% skeleton-similarity, and replaces
 * the duplicate with a compact summary showing only the lines that differ.
 */

// Markers that start a new logical section (Docker build, deploy step, etc.)
// Also matches crash/restart boundaries like reboot/VM restart lines.
// Some patterns anchor to ^, others can appear mid-line (after log prefixes).
const SECTION_START = /^(?:==>|-->|---|\*\*\*|Step \d|Building |Deploying |Waiting )|Traceback \(most recent call last\)|reboot:\s+Restarting system/;

// Words that commonly appear in retries but not originals (or vice versa)
// and should be stripped before comparing skeletons for similarity.
const RETRY_NOISE = /\bCACHED\b/g;

/**
 * Normalize a skeleton further for retry comparison.
 * Strips retry-specific noise words so that "=> CACHED [1/6] RUN ..."
 * matches "=> [1/6] RUN ..." from the original attempt.
 */
function retrySkeleton(skel: string): string {
  return skel.replace(RETRY_NOISE, '').replace(/\s{2,}/g, ' ').trim();
}

interface Section {
  startIndex: number;
  lines: string[];
  skeletons: string[];
}

function splitIntoSections(lines: string[]): Section[] {
  const sections: Section[] = [];
  let current: string[] = [];
  let startIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    if (SECTION_START.test(lines[i]) && current.length > 0) {
      sections.push({
        startIndex,
        lines: current,
        skeletons: current.map(l => skeleton(l)),
      });
      current = [];
      startIndex = i;
    }
    current.push(lines[i]);
  }

  if (current.length > 0) {
    sections.push({
      startIndex,
      lines: current,
      skeletons: current.map(l => skeleton(l)),
    });
  }

  return sections;
}

function similarity(a: Section, b: Section): number {
  const skelsA = a.skeletons.map(retrySkeleton).filter(s => s !== '');
  const skelsB = b.skeletons.map(retrySkeleton).filter(s => s !== '');
  const setA = new Set(skelsA);
  const setB = new Set(skelsB);
  let overlap = 0;
  for (const s of setA) {
    if (setB.has(s)) overlap++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : overlap / union;
}

/**
 * Given two similar sections, return only the lines from `retry` whose
 * skeletons don't appear anywhere in `original`.
 */
function diffLines(original: Section, retry: Section): string[] {
  const origSkeletons = new Set(original.skeletons);
  const diff: string[] = [];
  for (let i = 0; i < retry.lines.length; i++) {
    if (!origSkeletons.has(retry.skeletons[i])) {
      diff.push(retry.lines[i]);
    }
  }
  return diff;
}

const MIN_SECTION_LINES = 5;
const SIMILARITY_THRESHOLD = 0.5;

export const collapseRetries: Transform = {
  name: 'Collapse Retries',
  settingKey: 'collapseRetries',
  apply(input: string): string {
    const lines = input.split('\n');
    const sections = splitIntoSections(lines);

    if (sections.length < 2) return input;

    const result: string[] = [];
    const consumed = new Set<number>();

    for (let i = 0; i < sections.length; i++) {
      if (consumed.has(i)) continue;

      const base = sections[i];

      // Only try to match sections that are large enough to matter
      if (base.lines.length < MIN_SECTION_LINES) {
        result.push(...base.lines);
        continue;
      }

      // Look ahead for similar sections (retries)
      let retryCount = 0;
      let lastRetryDiff: string[] = [];

      for (let j = i + 1; j < sections.length; j++) {
        if (consumed.has(j)) continue;
        if (sections[j].lines.length < MIN_SECTION_LINES) continue;

        const sim = similarity(base, sections[j]);
        if (sim >= SIMILARITY_THRESHOLD) {
          retryCount++;
          lastRetryDiff = diffLines(base, sections[j]);
          consumed.add(j);
        }
      }

      // Emit the base section
      result.push(...base.lines);

      if (retryCount > 0) {
        const label = retryCount === 1 ? 'retry' : 'retries';
        result.push(`[... ${retryCount} similar ${label} omitted ...]`);
        // Show lines that are unique to the last retry (e.g. different error, cache status)
        if (lastRetryDiff.length > 0 && lastRetryDiff.length <= 5) {
          result.push(...lastRetryDiff);
        }
      }
    }

    return result.join('\n');
  },
};
