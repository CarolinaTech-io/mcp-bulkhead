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

  it('lists both tools', async () => {
    const result = await client.listTools();
    expect(result.tools).toHaveLength(2);
    const names = result.tools.map(t => t.name);
    expect(names).toContain('run_command');
    expect(names).toContain('read_file');
  });

  it('returns run_command tool annotations', async () => {
    const result = await client.listTools();
    const tool = result.tools.find(t => t.name === 'run_command')!;
    expect(tool.annotations).toEqual({
      title: 'Execute Shell Command',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it('returns read_file tool annotations', async () => {
    const result = await client.listTools();
    const tool = result.tools.find(t => t.name === 'read_file')!;
    expect(tool.annotations).toEqual({
      title: 'Read File or Directory',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
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

  // --- read_file tests ---

  it('read_file reads a file and returns contents', async () => {
    // Test-Path exists check
    mockExeca.mockResolvedValueOnce({ stdout: 'True', stderr: '', exitCode: 0 } as never);
    // Test-Path -PathType Container
    mockExeca.mockResolvedValueOnce({ stdout: 'False', stderr: '', exitCode: 0 } as never);
    // Get-Content -Raw
    mockExeca.mockResolvedValueOnce({ stdout: 'file contents here', stderr: '', exitCode: 0 } as never);

    const result = await client.callTool({ name: 'read_file', arguments: { path: 'C:\\test\\file.txt' } });
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: 'text', text: 'file contents here' }]);
  });

  it('read_file lists a directory', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: 'True', stderr: '', exitCode: 0 } as never);
    mockExeca.mockResolvedValueOnce({ stdout: 'True', stderr: '', exitCode: 0 } as never);
    mockExeca.mockResolvedValueOnce({ stdout: 'file1.txt\nfile2.txt', stderr: '', exitCode: 0 } as never);

    const result = await client.callTool({ name: 'read_file', arguments: { path: 'C:\\test' } });
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: 'text', text: 'file1.txt\nfile2.txt' }]);
  });

  it('read_file lists a directory recursively', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: 'True', stderr: '', exitCode: 0 } as never);
    mockExeca.mockResolvedValueOnce({ stdout: 'True', stderr: '', exitCode: 0 } as never);
    mockExeca.mockResolvedValueOnce({ stdout: 'dir\\file1.txt\ndir\\sub\\file2.txt', stderr: '', exitCode: 0 } as never);

    const result = await client.callTool({ name: 'read_file', arguments: { path: 'C:\\test', recurse: true } });
    expect(result.isError).toBe(false);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('file1.txt');
    expect(text).toContain('file2.txt');
  });

  it('read_file returns error for nonexistent path', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: 'False', stderr: '', exitCode: 0 } as never);

    const result = await client.callTool({ name: 'read_file', arguments: { path: 'C:\\nonexistent' } });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('Path not found');
  });

  it('read_file escapes single quotes in path', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: 'True', stderr: '', exitCode: 0 } as never);
    mockExeca.mockResolvedValueOnce({ stdout: 'False', stderr: '', exitCode: 0 } as never);
    mockExeca.mockResolvedValueOnce({ stdout: 'quoted content', stderr: '', exitCode: 0 } as never);

    const result = await client.callTool({ name: 'read_file', arguments: { path: "C:\\test\\it's a file.txt" } });
    expect(result.isError).toBe(false);

    // Verify the path was escaped in the PowerShell command
    const firstCall = mockExeca.mock.calls[mockExeca.mock.calls.length - 3];
    const cmdArg = firstCall[1]![3] as string;
    expect(cmdArg).toContain("it''s a file.txt");
  });

  it('read_file returns timeout error', async () => {
    const error = Object.assign(new Error('timed out'), {
      stdout: '', stderr: '', exitCode: undefined, timedOut: true,
    });
    mockExeca.mockRejectedValueOnce(error);

    const result = await client.callTool({ name: 'read_file', arguments: { path: 'C:\\test\\big.bin' } });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('timed out');
  });

  it('read_file rejects empty path with protocol error', async () => {
    await expect(
      client.callTool({ name: 'read_file', arguments: { path: '' } }),
    ).rejects.toThrow();
  });

  it('read_file rejects missing path with protocol error', async () => {
    await expect(
      client.callTool({ name: 'read_file', arguments: {} }),
    ).rejects.toThrow();
  });

  it('read_file returns error on non-zero exit', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: 'True', stderr: '', exitCode: 0 } as never);
    mockExeca.mockResolvedValueOnce({ stdout: 'False', stderr: '', exitCode: 0 } as never);
    const error = Object.assign(new Error('access denied'), {
      stdout: '', stderr: 'Access to the path is denied.', exitCode: 1, timedOut: false,
    });
    mockExeca.mockRejectedValueOnce(error);

    const result = await client.callTool({ name: 'read_file', arguments: { path: 'C:\\protected\\file.txt' } });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('Access to the path is denied');
  });
});
