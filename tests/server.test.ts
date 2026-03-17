import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import type { ResolvedConfig } from '../src/config.js';

// Mock execa so tests don't require PowerShell
vi.mock('execa', () => {
  const mockExeca = vi.fn();
  return { execa: mockExeca };
});

import { execa } from 'execa';
const mockExeca = vi.mocked(execa);

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  const blacklist = overrides.blacklist ?? ['Remove-Item', 'rm', 'format'];
  return {
    workingDirectory: overrides.workingDirectory ?? 'C:\\dev',
    blacklist,
    timeoutSeconds: overrides.timeoutSeconds ?? 30,
    audit: overrides.audit ?? { enabled: false },
    blacklistSet: overrides.blacklistSet ?? new Set(blacklist.map(s => s.toLowerCase())),
  };
}

describe('MCP server integration', () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const config = makeConfig();
    const server = createServer(config, 'pwsh.exe');

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);

    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);

    cleanup = async () => {
      await client.close();
      await server.close();
    };
  });

  afterAll(async () => {
    await cleanup();
  });

  it('lists the run_command tool', async () => {
    const result = await client.listTools();
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe('run_command');
    expect(result.tools[0].description).toContain('PowerShell');
    expect(result.tools[0].inputSchema.required).toContain('command');
  });

  it('returns tool annotations', async () => {
    const result = await client.listTools();
    const tool = result.tools[0];
    expect(tool.annotations).toEqual({
      title: 'Execute Shell Command',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it('executes a valid command and returns stdout', async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: 'hello world',
      stderr: '',
      exitCode: 0,
    } as never);

    const result = await client.callTool({ name: 'run_command', arguments: { command: 'echo hello world' } });
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('blocks a blacklisted command', async () => {
    const result = await client.callTool({ name: 'run_command', arguments: { command: 'Remove-Item foo.txt' } });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('Remove-Item');
  });

  it('blocks a blacklisted command in a pipe segment', async () => {
    const result = await client.callTool({
      name: 'run_command',
      arguments: { command: 'Get-Process | rm' },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toMatch(/rm/i);
  });

  it('blocks chain operators', async () => {
    const result = await client.callTool({
      name: 'run_command',
      arguments: { command: 'echo a; echo b' },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain(';');
  });

  it('returns isError true on non-zero exit code', async () => {
    const error = Object.assign(new Error('failed'), {
      stdout: '',
      stderr: 'error happened',
      exitCode: 1,
      timedOut: false,
    });
    mockExeca.mockRejectedValueOnce(error);

    const result = await client.callTool({ name: 'run_command', arguments: { command: 'failing-command' } });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('error happened');
  });

  it('returns timeout error', async () => {
    const error = Object.assign(new Error('timed out'), {
      stdout: '',
      stderr: '',
      exitCode: undefined,
      timedOut: true,
    });
    mockExeca.mockRejectedValueOnce(error);

    const result = await client.callTool({ name: 'run_command', arguments: { command: 'Start-Sleep 120' } });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('timed out');
  });

  it('rejects empty command with protocol error', async () => {
    await expect(
      client.callTool({ name: 'run_command', arguments: { command: '' } }),
    ).rejects.toThrow();
  });

  it('rejects missing command argument with protocol error', async () => {
    await expect(
      client.callTool({ name: 'run_command', arguments: {} }),
    ).rejects.toThrow();
  });

  it('rejects unknown tool with protocol error', async () => {
    await expect(
      client.callTool({ name: 'nonexistent_tool', arguments: {} }),
    ).rejects.toThrow();
  });
});
