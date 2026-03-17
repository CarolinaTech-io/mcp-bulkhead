import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectShell, executeCommand } from '../src/executor.js';

// Mock execa for unit tests
vi.mock('execa', () => {
  const mockExeca = vi.fn();
  return { execa: mockExeca };
});

import { execa } from 'execa';
const mockExeca = vi.mocked(execa);

describe('detectShell', () => {
  beforeEach(() => {
    mockExeca.mockReset();
  });

  it('returns pwsh.exe when available', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: 'PowerShell 7.4.0', stderr: '', exitCode: 0 } as never);
    const shell = await detectShell();
    expect(shell).toBe('pwsh.exe');
    expect(mockExeca).toHaveBeenCalledWith('pwsh.exe', ['--version'], { timeout: 5000 });
  });

  it('falls back to powershell.exe when pwsh is not available', async () => {
    mockExeca.mockRejectedValueOnce(new Error('not found'));
    mockExeca.mockResolvedValueOnce({ stdout: 'ok', stderr: '', exitCode: 0 } as never);
    const shell = await detectShell();
    expect(shell).toBe('powershell.exe');
  });

  it('throws when neither shell is available', async () => {
    mockExeca.mockRejectedValueOnce(new Error('not found'));
    mockExeca.mockRejectedValueOnce(new Error('not found'));
    await expect(detectShell()).rejects.toThrow(/No PowerShell installation found/);
  });
});

describe('executeCommand', () => {
  beforeEach(() => {
    mockExeca.mockReset();
  });

  it('returns stdout and exit code on success', async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: 'hello',
      stderr: '',
      exitCode: 0,
    } as never);

    const result = await executeCommand('echo hello', 'pwsh.exe', 'C:\\dev', 30000);
    expect(result.stdout).toBe('hello');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('passes correct args to execa', async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: '', stderr: '', exitCode: 0,
    } as never);

    await executeCommand('Get-Date', 'powershell.exe', 'C:\\Users', 15000);
    expect(mockExeca).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Get-Date'],
      { cwd: 'C:\\Users', timeout: 15000, windowsHide: true },
    );
  });

  it('captures non-zero exit code without throwing', async () => {
    const error = Object.assign(new Error('command failed'), {
      stdout: '',
      stderr: 'error output',
      exitCode: 2,
      timedOut: false,
    });
    mockExeca.mockRejectedValueOnce(error);

    const result = await executeCommand('bad-command', 'pwsh.exe', 'C:\\dev', 30000);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe('error output');
    expect(result.timedOut).toBe(false);
  });

  it('detects timeout', async () => {
    const error = Object.assign(new Error('timed out'), {
      stdout: 'partial',
      stderr: '',
      exitCode: undefined,
      timedOut: true,
    });
    mockExeca.mockRejectedValueOnce(error);

    const result = await executeCommand('Start-Sleep 60', 'pwsh.exe', 'C:\\dev', 5000);
    expect(result.timedOut).toBe(true);
    expect(result.stdout).toBe('partial');
    expect(result.exitCode).toBe(1); // defaults to 1 when undefined
  });

  it('handles missing stdout/stderr on error', async () => {
    const error = new Error('process killed');
    mockExeca.mockRejectedValueOnce(error);

    const result = await executeCommand('broken', 'pwsh.exe', 'C:\\dev', 30000);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(1);
  });
});

// Live tests are in a separate file (executor.live.test.ts) to avoid mock conflicts
