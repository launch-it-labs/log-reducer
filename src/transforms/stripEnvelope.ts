import { Transform } from '../types';

/**
 * Strip redundant log envelope/wrapper prefixes.
 *
 * Many log aggregators (Fly.io, Docker, systemd, Kubernetes, cloud logging)
 * prepend an envelope to each line that duplicates information already in the
 * inner log (timestamp, level, source).  This transform detects such envelopes
 * by looking for **duplicate timestamps** — the same HH:MM:SS value appearing
 * twice in a line — and strips the outer prefix.
 *
 * Lines that match the detected envelope pattern but lack a second timestamp
 * (e.g., bare `INFO:` lines from uvicorn) are also stripped.
 */

const TS_RE = /\d{1,2}:\d{2}:\d{2}/g;

export const stripEnvelope: Transform = {
  name: 'Strip Envelope',
  settingKey: 'stripEnvelope',
  apply(input: string): string {
    const lines = input.split('\n');
    if (lines.length < 4) return input;

    // ── Phase 1: find lines with duplicate timestamps ──────────────────
    interface SplitInfo {
      lineIdx: number;
      splitPos: number;   // start of second (inner) timestamp
      envelope: string;   // text before the inner timestamp
    }

    const splits: SplitInfo[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') continue;

      TS_RE.lastIndex = 0;
      const tsMatches: Array<{ val: string; pos: number }> = [];
      let m: RegExpExecArray | null;
      while ((m = TS_RE.exec(line)) !== null) {
        tsMatches.push({ val: m[0], pos: m.index });
      }

      // Need 2+ timestamps with the same value, second at least 10 chars in
      for (let j = 1; j < tsMatches.length; j++) {
        if (tsMatches[j].val === tsMatches[0].val && tsMatches[j].pos >= 10) {
          // Look back from the second timestamp to include any date prefix
          // e.g., "2026-03-04 " or "2026-03-04T" before the HH:MM:SS
          let splitPos = tsMatches[j].pos;
          const before = line.substring(0, splitPos);
          const datePrefix = before.match(/\d{4}-\d{2}-\d{2}[T ]?$/);
          if (datePrefix) {
            splitPos -= datePrefix[0].length;
          }
          splits.push({
            lineIdx: i,
            splitPos,
            envelope: line.substring(0, splitPos),
          });
          break;
        }
      }
    }

    const nonEmptyCount = lines.filter(l => l.trim().length > 0).length;
    // Need a meaningful fraction of lines to exhibit the pattern
    if (splits.length < nonEmptyCount * 0.3) return input;

    // ── Phase 2: find the dominant envelope skeleton ────────────────────
    function skeletonize(s: string): string {
      return s
        .replace(/\d{1,2}:\d{2}:\d{2}/g, 'TS')
        .replace(/\$\d+/g, '$X')
        .replace(/\b[a-f0-9]{12,}\b/gi, 'HEX')
        .replace(/\b\d+\b/g, 'N');
    }

    const skelCounts = new Map<string, number>();
    for (const s of splits) {
      const skel = skeletonize(s.envelope);
      skelCounts.set(skel, (skelCounts.get(skel) || 0) + 1);
    }

    let dominantSkel = '';
    let dominantCount = 0;
    for (const [skel, count] of skelCounts) {
      if (count > dominantCount) {
        dominantCount = count;
        dominantSkel = skel;
      }
    }

    if (dominantCount < splits.length * 0.5) return input;

    // ── Phase 3: build a regex from the detected envelope ──────────────
    const sample = splits.find(s => skeletonize(s.envelope) === dominantSkel)!;
    const sampleEnv = sample.envelope;

    // Escape for regex, then punch holes for variable parts
    let re = sampleEnv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Timestamps → \d{1,2}:\d{2}:\d{2}
    re = re.replace(/\d{1,2}:\d{2}:\d{2}/g, '\\d{1,2}:\\d{2}:\\d{2}');
    // Shortened IDs ($1, $12, …)
    re = re.replace(/\\\$\d+/g, '\\$\\d+');
    // Hex IDs (12+ hex chars)
    re = re.replace(/[a-f0-9]{12,}/gi, '[a-f0-9]+');
    // Log level in brackets: [info] → [info|error|warn|…]
    re = re.replace(
      /\\\[(?:info|error|warn(?:ing)?|debug|notice|critical)\\\]/gi,
      '\\[(?:info|error|warn(?:ing)?|debug|notice|critical)\\]',
    );

    const envelopeRe = new RegExp('^' + re);

    // ── Phase 4: strip the envelope from every matching line ───────────
    const result: string[] = [];
    for (const line of lines) {
      if (line.trim() === '') {
        result.push(line);
        continue;
      }
      const match = line.match(envelopeRe);
      if (match) {
        const body = line.substring(match[0].length);
        // Don't strip if it would leave the line empty
        result.push(body.trim() === '' ? line : body);
      } else {
        result.push(line);
      }
    }

    return result.join('\n');
  },
};
