#!/usr/bin/env node
/**
 * Quick E2E test — runs the server as a child process via stdio,
 * sends MCP requests, and prints responses + stderr audit logs.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['build/index.js'],
  env: { ...process.env, MCP_BULKHEAD_CONFIG: 'tests/config.json' },
  stderr: 'pipe',
});

// Collect stderr (audit logs)
const stderrChunks = [];
transport.stderr?.on?.('data', (chunk) => stderrChunks.push(chunk.toString()));

const client = new Client({ name: 'e2e-test', version: '1.0.0' });
await client.connect(transport);

console.log('=== Connected to mcp-bulkhead ===\n');

// List tools
const tools = await client.listTools();
console.log('Tools:', JSON.stringify(tools.tools.map(t => t.name)));
console.log();

// Test 1: Valid command
console.log('--- Test 1: echo hello ---');
const r1 = await client.callTool({ name: 'run_command', arguments: { command: 'echo hello' } });
console.log('isError:', r1.isError);
console.log('output:', r1.content[0].text);
console.log();

// Test 2: Blocked command
console.log('--- Test 2: Remove-Item (blocked) ---');
const r2 = await client.callTool({ name: 'run_command', arguments: { command: 'Remove-Item foo.txt' } });
console.log('isError:', r2.isError);
console.log('output:', r2.content[0].text);
console.log();

// Test 3: Chain operator
console.log('--- Test 3: chain operator (blocked) ---');
const r3 = await client.callTool({ name: 'run_command', arguments: { command: 'echo a; echo b' } });
console.log('isError:', r3.isError);
console.log('output:', r3.content[0].text);
console.log();

// Test 4: Pipe (allowed)
console.log('--- Test 4: pipe (allowed) ---');
const r4 = await client.callTool({ name: 'run_command', arguments: { command: 'Get-ChildItem | Select-Object -First 3 -ExpandProperty Name' } });
console.log('isError:', r4.isError);
console.log('output:', r4.content[0].text);
console.log();

// Test 5: Blacklisted in second pipe segment
console.log('--- Test 5: blacklisted in pipe segment ---');
const r5 = await client.callTool({ name: 'run_command', arguments: { command: 'Get-Process | rm' } });
console.log('isError:', r5.isError);
console.log('output:', r5.content[0].text);
console.log();

await client.close();

// Print audit logs
console.log('=== Audit Logs (stderr) ===');
const logs = stderrChunks.join('').trim().split('\n').filter(l => l.startsWith('{'));
for (const line of logs) {
  try {
    const entry = JSON.parse(line);
    console.log(`  [${entry.status}] ${entry.command}${entry.reason ? ' — ' + entry.reason : ''}${entry.durationMs !== undefined ? ' (' + entry.durationMs + 'ms)' : ''}`);
  } catch {
    console.log('  (raw)', line);
  }
}
