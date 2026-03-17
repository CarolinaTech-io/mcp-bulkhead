import { execa } from 'execa';

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

/**
 * Detect the available PowerShell binary.
 * Prefers pwsh.exe (PowerShell 7+), falls back to powershell.exe (5.1).
 * Throws if neither is available.
 */
export async function detectShell(): Promise<string> {
  try {
    await execa('pwsh.exe', ['--version'], { timeout: 5000 });
    return 'pwsh.exe';
  } catch {
    // pwsh not available, try powershell
  }

  try {
    await execa('powershell.exe', ['-NoProfile', '-Command', 'echo ok'], { timeout: 5000 });
    return 'powershell.exe';
  } catch {
    throw new Error('No PowerShell installation found (tried pwsh.exe and powershell.exe)');
  }
}

/**
 * Execute a command string through PowerShell.
 * Returns a result object — never throws. Errors and timeouts are captured in the result.
 */
export async function executeCommand(
  command: string,
  shell: string,
  cwd: string,
  timeoutMs: number,
): Promise<ExecutionResult> {
  const start = Date.now();

  try {
    const result = await execa(shell, ['-NoProfile', '-NonInteractive', '-Command', command], {
      cwd,
      timeout: timeoutMs,
      windowsHide: true,
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? 0,
      durationMs: Date.now() - start,
      timedOut: false,
    };
  } catch (error: unknown) {
    const err = error as {
      stdout?: string;
      stderr?: string;
      exitCode?: number;
      timedOut?: boolean;
    };

    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      exitCode: err.exitCode ?? 1,
      durationMs: Date.now() - start,
      timedOut: err.timedOut ?? false,
    };
  }
}
