#!/usr/bin/env node

/**
 * MCP (Model Context Protocol) server for Log Reducer.
 * Exposes a "reduce_log" tool over stdio so Claude Code (and other MCP clients)
 * can reduce log text before inserting it into a conversation.
 *
 * Usage in .claude/settings.json:
 *   { "mcpServers": { "logreducer": { "command": "node", "args": ["out/src/mcp-server.js"] } } }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { minify } from './pipeline';

const server = new Server(
  { name: 'logreducer', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reduce_log',
      description:
        'Reduces log text for AI consumption — strips noise, deduplicates, shortens IDs/URLs, ' +
        'folds stack traces. Typically achieves 50-90% token reduction while preserving semantic value.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          log_text: {
            type: 'string',
            description: 'The raw log text to reduce',
          },
        },
        required: ['log_text'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'reduce_log') {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const args = request.params.arguments as { log_text: string } | undefined;
  if (!args?.log_text) {
    throw new Error('Missing required argument: log_text');
  }

  const reduced = minify(args.log_text);
  return {
    content: [{ type: 'text' as const, text: reduced }],
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
