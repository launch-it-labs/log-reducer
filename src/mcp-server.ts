#!/usr/bin/env node

/**
 * MCP (Model Context Protocol) server for Log Reducer.
 * Exposes a "reduce_log" tool over stdio so Claude Code (and other MCP clients)
 * can reduce log text before inserting it into a conversation.
 *
 * Key design: accepts a `file` parameter so the driving AI can pass a file path
 * instead of raw log text. This keeps raw logs out of the LLM context entirely —
 * only the reduced output enters the conversation.
 *
 * Usage in .claude/settings.json:
 *   { "mcpServers": { "logreducer": { "command": "node", "args": ["out/src/mcp-server.js"] } } }
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { minify, buildSummary, applyFocus } from './pipeline';
import { FocusOptions } from './types';

const server = new Server(
  { name: 'logreducer', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reduce_log',
      description:
        'Reduces log text for AI consumption (50-90% token reduction) while preserving all semantic value. ' +
        'Strips noise, deduplicates, shortens IDs/URLs, folds stack traces, compacts access logs.\n\n' +
        'WHY THIS TOOL EXISTS: Your context window is a finite, non-renewable resource within a session. ' +
        'Every raw log token that enters context is permanently spent — it cannot be reclaimed. A 500-line ' +
        'log costs 5,000+ tokens raw but only 250-500 after reduction. That difference is thousands of tokens ' +
        'of capacity you keep for reasoning, code generation, and helping the user. Protecting context length ' +
        'directly determines how much useful work you can do before the session degrades.\n\n' +
        'MANDATORY RULES:\n' +
        '1. NEVER ask users to paste, copy, or type log output into chat — direct them to save to a file or use /logdump.\n' +
        '2. NEVER read raw log files with cat/head/tail/Read — use this tool with a `file` parameter.\n' +
        '3. Redirect verbose command output to a temp file, then call this tool on that file.\n' +
        '4. Always include `tail` (default 200) to cap input size.\n\n' +
        'INVESTIGATION STRATEGY — use the funnel pattern for multi-turn debugging:\n' +
        '  Step 1: SURVEY → summary: true (~50 tokens — get error counts, timestamps, components)\n' +
        '  Step 2: SCAN → level: "error", limit: 5 (~200 tokens — see the first few errors)\n' +
        '  Step 3: ZOOM → time_range: "HH:MM:SS-HH:MM:SS", before: 50 (~500 tokens — what caused a specific error)\n' +
        '  Step 4: TRACE → grep: "pattern", time_range: "..." (~300 tokens — follow a specific thread)\n' +
        'Each step is informed by the previous one. Total cost: ~1000 tokens instead of 5000+ from a blind dump.\n\n' +
        'KEY PRINCIPLE: Once data enters your context, it is paid for permanently. Never re-request data you already have. ' +
        'Each follow-up query should fetch NEW information that narrows your hypothesis, not overlap with prior results.\n\n' +
        'PAGINATION: Use limit/skip to control how many matches you see. If you asked for limit: 5 and the header says ' +
        '"showing matches 1-5 of 23 total", you can get the next batch with skip: 5, limit: 5. But usually the ' +
        'funnel strategy (zoom by timestamp) is more effective than paginating through all matches.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          file: {
            type: 'string',
            description:
              'Path to a log file on disk. PREFERRED over log_text — keeps raw logs out of LLM context. ' +
              'The tool reads the file directly and returns reduced output.',
          },
          log_text: {
            type: 'string',
            description:
              'Raw log text to reduce. Use `file` instead when possible to avoid context bloat.',
          },
          tail: {
            type: 'number',
            description:
              'Only process the last N lines of input. Useful for large log files where recent ' +
              'activity is most relevant. Applied before all other transforms.',
          },
          head: {
            type: 'number',
            description:
              'Only process the first N lines of input. Useful for startup/config logs at the ' +
              'beginning of a file. Can combine with tail (tail applied first).',
          },
          summary: {
            type: 'boolean',
            description:
              'RECOMMENDED FIRST CALL. Returns a structural overview instead of log content: ' +
              'total lines, time span, error/warn/info/debug counts with timestamps, components found, ' +
              'and timestamps of each error. Costs ~50 tokens. Use this to plan targeted follow-up queries ' +
              'using the timestamps and components in the summary. Example workflow:\n' +
              '  1. summary: true → see 8 errors between 13:02-13:15, components: [db, auth, api]\n' +
              '  2. level: "error", limit: 3 → see the first 3 errors with context\n' +
              '  3. time_range: "13:02:30-13:02:45", before: 50 → zoom into what caused error #1',
          },
          level: {
            type: 'string',
            enum: ['error', 'warning', 'info', 'debug'],
            description:
              'Minimum log level to keep. Lines at this level or above are shown with surrounding context.',
          },
          grep: {
            type: 'string',
            description:
              'Regex pattern to match. Only matching lines (+ context) are kept. Case-insensitive.',
          },
          contains: {
            type: 'string',
            description:
              'Literal string filter. Only lines containing this text (+ context) are kept.',
          },
          component: {
            type: 'string',
            description:
              'Filter to a specific logger/module name (case-insensitive substring match). ' +
              'E.g., "database", "auth", "export". Shows matching lines + context.',
          },
          time_range: {
            type: 'string',
            description:
              'Filter to a time window: "HH:MM-HH:MM" or "HH:MM:SS-HH:MM:SS". ' +
              'E.g., "13:02-13:05". Shows lines with timestamps in this range + context. ' +
              'Use timestamps from a prior summary call to zoom into specific periods.',
          },
          context: {
            type: 'number',
            description:
              'Symmetric context: lines shown before AND after each match (default 3). ' +
              'Overridden by before/after if those are set.',
          },
          before: {
            type: 'number',
            description:
              'Lines of context BEFORE each match. Use large values (50-100) to see what led up to ' +
              'an error. Overrides context for the before-direction only.',
          },
          after: {
            type: 'number',
            description:
              'Lines of context AFTER each match. Use large values to see consequences/cascading effects. ' +
              'Overrides context for the after-direction only.',
          },
          not_grep: {
            type: 'string',
            description:
              'Regex exclusion filter. Lines matching this pattern are removed from results even if they ' +
              'match an inclusion filter. Useful to suppress known noise. E.g., "health.check|heartbeat".',
          },
          limit: {
            type: 'number',
            description:
              'Max number of matched lines to return. E.g., level: "error", limit: 5 → first 5 errors. ' +
              'Output includes a "[showing matches 1-5 of 23 total]" header so you know there are more.',
          },
          skip: {
            type: 'number',
            description:
              'Skip the first N matches before applying limit. For pagination: skip: 5, limit: 5 → ' +
              'errors 6-10. Use after a prior limited query to see the next batch.',
          },
          reduce: {
            type: 'boolean',
            description:
              'Default true. Set to false to skip reduction and get raw log lines (with focus filters ' +
              'still applied). Every response includes a token count header like "[150 tokens (raw input: ' +
              '2000 tokens)]" so you can judge whether the reduced output is sufficient or if you need ' +
              'the original text. Only use reduce: false when you need exact original wording (e.g., to ' +
              'reproduce a command, read a config value, or see exact error messages that reduction may ' +
              'have parameterized).',
          },
        },
        required: [],
      },
    },
  ],
}));

interface ReduceArgs {
  file?: string;
  log_text?: string;
  tail?: number;
  head?: number;
  level?: 'error' | 'warning' | 'info' | 'debug';
  grep?: string;
  contains?: string;
  component?: string;
  time_range?: string;
  context?: number;
  before?: number;
  after?: number;
  not_grep?: string;
  limit?: number;
  skip?: number;
  summary?: boolean;
  reduce?: boolean;
}

/** Approximate token count using whitespace split. */
function countTokens(text: string): number {
  return text.split(/\s+/).filter(t => t.length > 0).length;
}

/** Read log text from file or argument, applying tail if requested. */
function resolveLogText(args: ReduceArgs): string {
  let text: string;

  if (args.file) {
    // Resolve /tmp/ to the OS temp directory on Windows (where /tmp doesn't exist)
    let filePath = args.file;
    if (process.platform === 'win32' && /^\/tmp(\/|\\)/.test(filePath)) {
      filePath = path.join(os.tmpdir(), filePath.slice(4));
    }
    try {
      text = fs.readFileSync(filePath, 'utf-8');
    } catch (err: any) {
      throw new Error(`Cannot read file "${filePath}": ${err.message}`);
    }
  } else if (args.log_text) {
    text = args.log_text;
  } else {
    throw new Error('Either "file" or "log_text" is required');
  }

  // Apply tail: keep only the last N lines
  if (args.tail && args.tail > 0) {
    const lines = text.split('\n');
    if (lines.length > args.tail) {
      text = lines.slice(-args.tail).join('\n');
    }
  }

  // Apply head: keep only the first N lines
  if (args.head && args.head > 0) {
    const lines = text.split('\n');
    if (lines.length > args.head) {
      text = lines.slice(0, args.head).join('\n');
    }
  }

  return text;
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'reduce_log') {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const args = (request.params.arguments ?? {}) as ReduceArgs;
  const logText = resolveLogText(args);

  // Summary mode: run on raw input (after tail/head), skip the reduction pipeline.
  // This gives the AI true counts — e.g., 500 raw ERROR lines, not 50 after dedup.
  if (args.summary) {
    const summaryText = buildSummary(logText.split('\n'));
    return {
      content: [{ type: 'text' as const, text: summaryText }],
    };
  }

  const focus: FocusOptions = {};
  if (args.level) focus.level = args.level;
  if (args.grep) focus.grep = args.grep;
  if (args.contains) focus.contains = args.contains;
  if (args.component) focus.component = args.component;
  if (args.time_range) focus.time_range = args.time_range;
  if (args.context !== undefined) focus.context = args.context;
  if (args.before !== undefined) focus.before = args.before;
  if (args.after !== undefined) focus.after = args.after;
  if (args.not_grep) focus.not_grep = args.not_grep;
  if (args.limit !== undefined) focus.limit = args.limit;
  if (args.skip !== undefined) focus.skip = args.skip;

  const hasFocus = !!(focus.level || focus.grep || focus.contains || focus.component || focus.time_range);
  const shouldReduce = args.reduce !== false;

  if (shouldReduce) {
    // Normal path: reduce then optionally filter
    const reduced = minify(logText, undefined, hasFocus ? focus : undefined);
    const reducedTokens = countTokens(reduced);
    const rawTokens = countTokens(logText);

    const preamble =
      `[${reducedTokens} tokens (raw input: ${rawTokens} tokens). ` +
      'Re-query with reduce: false to get unreduced output if needed.]\n' +
      'NOTE: {N}, {N1}, $1, $2 etc. are parameterized values — the legend after "|" shows ' +
      'originals. [x8] = 8 collapsed lines. "[... N lines omitted ...]" = focus-filter gaps.\n\n';

    return {
      content: [{ type: 'text' as const, text: preamble + reduced }],
    };
  } else {
    // reduce: false — skip reduction pipeline, only apply focus filters on raw input
    let output: string;

    if (hasFocus) {
      output = applyFocus(logText, focus);
    } else {
      output = logText;
    }

    const tokens = countTokens(output);
    const header = `[${tokens} tokens (unreduced)]\n\n`;
    return {
      content: [{ type: 'text' as const, text: header + output }],
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: Error) => {
  process.stderr.write(`MCP server error: ${err.message}\n`);
  process.exit(1);
});
