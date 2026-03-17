import { describe, it, expect } from 'vitest';
import { executeCommand, detectShell } from '../src/executor.js';

// Live tests — only run on Windows with PowerShell available
describe.skipIf(process.platform !== 'win32')('live execution', () => {
  it('detects a real PowerShell installation', async () => {
    const shell = await detectShell();
    expect(shell).toMatch(/^(pwsh|powershell)\.exe$/);
  });

  it('executes a real PowerShell command', async () => {
    const shell = await detectShell();
    const result = await executeCommand('Write-Output "hello from powershell"', shell, process.cwd(), 10000);
    expect(result.stdout).toContain('hello from powershell');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('captures stderr on error', async () => {
    const shell = await detectShell();
    const result = await executeCommand('Write-Error "test error"', shell, process.cwd(), 10000);
    expect(result.stderr).toContain('test error');
  });
});
