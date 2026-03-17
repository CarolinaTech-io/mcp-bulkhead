#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { detectShell } from './executor.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const shell = await detectShell();
  const server = createServer(config, shell);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`mcp-bulkhead: fatal error: ${message}\n`);
  process.exit(1);
});
