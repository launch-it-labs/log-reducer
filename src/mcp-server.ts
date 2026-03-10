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
        'Reduces log text for AI consumption (50-90% token reduction). ' +
        'Strips noise, deduplicates, shortens IDs/URLs, folds stack traces.\n\n' +
        'RULES:\n' +
        '1. NEVER ask users to paste logs — direct them to save to a file or use /logdump.\n' +
        '2. NEVER read raw log files with cat/head/tail/Read — use this tool with a `file` param.\n' +
        '3. Redirect verbose command output to a temp file, then call this tool on it.\n' +
        '4. Always include `tail` (200-2000) to cap input size.\n\n' +
        'THRESHOLD: Output exceeding the token threshold (default 1000) is gated — you will receive ' +
        'the token count and specific guidance on how to narrow further. Follow the guidance. ' +
        'Use break_threshold: true only after reviewing the token cost.',
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
          query: {
            type: 'string',
            description:
              'Natural language question. An LLM extracts only lines relevant to your query ' +
              '(returned verbatim, prefixed with >>). Requires ANTHROPIC_API_KEY on the server.',
          },
          query_budget: {
            type: 'number',
            description:
              'Max tokens for query extraction output (default 200).',
          },
          threshold: {
            type: 'number',
            description:
              'Token threshold (default 1000). Output exceeding this is gated — you receive the token count ' +
              'and guidance on narrowing. Set break_threshold: true to bypass.',
          },
          break_threshold: {
            type: 'boolean',
            description:
              'Set true to bypass the token threshold and retrieve full output.',
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
  query?: string;
  query_budget?: number;
  threshold?: number;
  break_threshold?: boolean;
}

/** Approximate token count using whitespace split. */
function countTokens(text: string): number {
  return text.split(/\s+/).filter(t => t.length > 0).length;
}

// ---------------------------------------------------------------------------
// LLM query extraction
// ---------------------------------------------------------------------------

const DEFAULT_THRESHOLD = 1000;
const DEFAULT_QUERY_BUDGET = 200;
const DEFAULT_QUERY_MODEL = 'claude-haiku-4-20250414';

interface QueryResult {
  extraction: string;
  model: string;
  mechanicalTokens: number;
  extractedTokens: number;
}

async function extractWithLLM(
  mechanicalOutput: string,
  query: string,
  budget: number,
): Promise<QueryResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.LOG_REDUCER_MODEL || DEFAULT_QUERY_MODEL;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY required for query extraction');
  }

  const mechanicalTokens = countTokens(mechanicalOutput);

  const systemPrompt =
    'You extract log lines relevant to a query. Return ONLY actual log lines from the input, ' +
    'prefixed with ">> ". Add a one-line annotation (no prefix) before each group explaining relevance. ' +
    'If nothing matches, return the 5 most anomalous entries. ' +
    'Err on inclusion — when uncertain, include the line. ' +
    `Budget: ~${budget} tokens.`;

  const userPrompt = `Query: ${query}\n\nLog:\n${mechanicalOutput}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: Math.max(budget * 4, 1024),
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM API error (${response.status}): ${body}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };

    const extraction = data.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    return {
      extraction,
      model,
      mechanicalTokens,
      extractedTokens: countTokens(extraction),
    };
  } finally {
    clearTimeout(timeout);
  }
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
  const threshold = args.threshold ?? DEFAULT_THRESHOLD;
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

  // ── Stage 1: Compute output ──────────────────────────────────────

  let output: string;
  const rawTokens = countTokens(logText);

  if (shouldReduce) {
    output = minify(logText, undefined, hasFocus ? focus : undefined);
  } else {
    output = hasFocus ? applyFocus(logText, focus) : logText;
  }

  let outputTokens = countTokens(output);

  // ── Stage 2: Query extraction (if requested and output is large) ─

  let queryFailed = false;
  if (args.query && outputTokens > threshold) {
    if (hasApiKey) {
      try {
        const budget = args.query_budget ?? DEFAULT_QUERY_BUDGET;
        const result = await extractWithLLM(output, args.query, budget);

        const preamble =
          `[${result.extractedTokens} tokens extracted by ${result.model} ` +
          `(mechanical: ${outputTokens} tokens, raw: ${rawTokens} tokens). ` +
          `Query: "${args.query}".]\n\n`;

        return {
          content: [{ type: 'text' as const, text: preamble + result.extraction }],
        };
      } catch {
        queryFailed = true;
        // Fall through to threshold gate with mechanical output
      }
    } else {
      queryFailed = true;
    }
  }

  // ── Stage 3: Threshold gate ──────────────────────────────────────

  if (outputTokens > threshold && !args.break_threshold) {
    let hint: string;

    if (queryFailed) {
      // Query was attempted but failed (no API key or API error).
      // Return the output anyway — don't block the AI for our infra issue.
      // But include a note about the key.
      const preamble = shouldReduce
        ? `[${outputTokens} tokens (raw: ${rawTokens}). query was requested but ANTHROPIC_API_KEY is not configured for this MCP server.]\n` +
          'NOTE: $1, $2 etc. are parameterized values. [x8] = collapsed lines.\n\n'
        : `[${outputTokens} tokens (unreduced). query was requested but ANTHROPIC_API_KEY is not configured for this MCP server.]\n\n`;

      return {
        content: [{ type: 'text' as const, text: preamble + output }],
      };
    }

    if (!hasFocus && !args.query) {
      // No filters used — teach about filters
      hint =
        `[${outputTokens} tokens (raw: ${rawTokens}) exceeds ${threshold} threshold. Narrow with filters:]\n` +
        '  summary: true                  — structural overview (~50 tokens), start here\n' +
        '  level: "error"                 — filter by severity\n' +
        '  grep: "pattern"                — regex search\n' +
        '  component: "module"            — filter by module name\n' +
        '  time_range: "HH:MM-HH:MM"     — filter by time window\n' +
        '  limit: 5                       — cap matched lines\n' +
        '  break_threshold: true          — bypass and retrieve full output';
    } else if (!args.query) {
      // Filters used but still over — teach about query
      hint =
        `[${outputTokens} tokens (raw: ${rawTokens}) exceeds ${threshold} threshold after filtering.]\n` +
        '  query: "your question here"    — LLM extracts only relevant lines (~200 tokens)\n' +
        '  Add more filters (time_range, grep, limit) to narrow further\n' +
        '  break_threshold: true          — bypass and retrieve full output';
      if (!hasApiKey) {
        hint += '\n  (query requires ANTHROPIC_API_KEY on the MCP server)';
      }
    } else {
      // Query + filters used, still over — only escape hatch left
      hint =
        `[${outputTokens} tokens (raw: ${rawTokens}) exceeds ${threshold} threshold.]\n` +
        '  Try narrower filters or a more specific query\n' +
        '  break_threshold: true          — bypass and retrieve full output';
    }

    return {
      content: [{ type: 'text' as const, text: hint }],
    };
  }

  // ── Stage 4: Return output (under threshold or break_threshold) ──

  const preamble = shouldReduce
    ? `[${outputTokens} tokens (raw: ${rawTokens}).]\n` +
      'NOTE: $1, $2 etc. are parameterized values. [x8] = collapsed lines.\n\n'
    : `[${outputTokens} tokens (unreduced).]\n\n`;

  return {
    content: [{ type: 'text' as const, text: preamble + output }],
  };
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: Error) => {
  process.stderr.write(`MCP server error: ${err.message}\n`);
  process.exit(1);
});
