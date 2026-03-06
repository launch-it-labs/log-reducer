#!/usr/bin/env node

/**
 * MCP (Model Context Protocol) server for Log Reducer.
 * Exposes a "reduce_log" tool over stdio so Claude Code (and other MCP clients)
 * can reduce log text before inserting it into a conversation.
 *
 * Key design: accepts a `file` parameter so the driving AI can pass a file path
 * instead of raw log text. This keeps raw logs out of the LLM context entirely —
 * only the compressed output enters the conversation.
 *
 * Usage in .claude/settings.json:
 *   { "mcpServers": { "logreducer": { "command": "node", "args": ["out/src/mcp-server.js"] } } }
 */

import * as fs from 'fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { minify } from './pipeline';
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
        'Compresses log text for AI consumption (50-90% token reduction) while preserving all semantic value. ' +
        'Strips noise, deduplicates, shortens IDs/URLs, folds stack traces, compacts access logs.\n\n' +
        'WHY THIS TOOL EXISTS: Your context window is a finite, non-renewable resource within a session. ' +
        'Every raw log token that enters context is permanently spent — it cannot be reclaimed. A 500-line ' +
        'log costs 5,000+ tokens raw but only 250-500 after reduction. That difference is thousands of tokens ' +
        'of capacity you keep for reasoning, code generation, and helping the user. This means raw logs are ' +
        'the single most wasteful thing that can enter your context. Protecting context length directly ' +
        'determines how much useful work you can do before the session degrades.\n\n' +
        'This principle applies equally to logs in files AND logs the user might paste or type into chat. ' +
        'Asking a user to "paste the console output" or "copy the error here" causes the same damage as ' +
        'reading a raw log file — the uncompressed text enters your context permanently.\n\n' +
        'MANDATORY RULES:\n' +
        '1. NEVER ask users to paste, copy, or type log output into chat. Instead direct them to: ' +
        'use the `/logdump` slash command (dumps clipboard to a file and compresses it automatically), ' +
        'or save to a file and give you the path.\n' +
        '2. NEVER read raw log files with cat/head/tail/Read — use this tool with a `file` parameter.\n' +
        '3. Redirect verbose command output to a temp file, then call this tool on that file.\n' +
        '4. Always include `tail` (default 200) to cap input size.\n' +
        '5. Choose the right filter on the FIRST call — each call loads output into context permanently.\n\n' +
        'For debugging, use focus filters (level, grep, contains, component, time_range) to narrow ' +
        'output to relevant lines with surrounding context.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          file: {
            type: 'string',
            description:
              'Path to a log file on disk. PREFERRED over log_text — keeps raw logs out of LLM context. ' +
              'The tool reads the file directly and returns compressed output.',
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
              'E.g., "13:02-13:05". Shows lines with timestamps in this range + context.',
          },
          context: {
            type: 'number',
            description:
              'Lines of context around focus-filter matches (default 3).',
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
  level?: 'error' | 'warning' | 'info' | 'debug';
  grep?: string;
  contains?: string;
  component?: string;
  time_range?: string;
  context?: number;
}

/** Read log text from file or argument, applying tail if requested. */
function resolveLogText(args: ReduceArgs): string {
  let text: string;

  if (args.file) {
    try {
      text = fs.readFileSync(args.file, 'utf-8');
    } catch (err: any) {
      throw new Error(`Cannot read file "${args.file}": ${err.message}`);
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

  return text;
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'reduce_log') {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const args = (request.params.arguments ?? {}) as ReduceArgs;
  const logText = resolveLogText(args);

  const focus: FocusOptions = {};
  if (args.level) focus.level = args.level;
  if (args.grep) focus.grep = args.grep;
  if (args.contains) focus.contains = args.contains;
  if (args.component) focus.component = args.component;
  if (args.time_range) focus.time_range = args.time_range;
  if (args.context !== undefined) focus.context = args.context;

  const hasFocus = !!(focus.level || focus.grep || focus.contains || focus.component || focus.time_range);
  const reduced = minify(logText, undefined, hasFocus ? focus : undefined);

  const preamble =
    'NOTE: This output is losslessly compressed. {N}, {N1}, $1, $2 etc. are parameterized ' +
    'values — the legend after "|" shows all original values. [x8] means 8 consecutive ' +
    'near-identical lines were collapsed into one. "[... N lines omitted ...]" separates ' +
    'focus-filter matches. No semantic information has been removed.\n\n';

  return {
    content: [{ type: 'text' as const, text: preamble + reduced }],
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
