import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logAudit, type AuditEntry } from '../src/logger.js';

describe('logAudit', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('writes a JSON line to stderr when enabled', () => {
    const entry: AuditEntry = {
      timestamp: '2026-03-16T19:30:00.000Z',
      status: 'ALLOWED',
      command: 'git status',
      cwd: 'C:\\dev',
      exitCode: 0,
      durationMs: 245,
    };

    logAudit(entry, true);

    expect(writeSpy).toHaveBeenCalledOnce();
    const written = writeSpy.mock.calls[0][0] as string;
    expect(written.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(written.trim());
    expect(parsed.status).toBe('ALLOWED');
    expect(parsed.command).toBe('git status');
    expect(parsed.exitCode).toBe(0);
  });

  it('writes nothing when disabled', () => {
    logAudit({
      timestamp: '2026-03-16T19:30:00.000Z',
      status: 'BLOCKED',
      command: 'rm -rf /',
      reason: 'blacklisted: rm',
    }, false);

    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('includes all provided fields in output', () => {
    const entry: AuditEntry = {
      timestamp: '2026-03-16T19:30:00.000Z',
      status: 'TIMEOUT',
      command: 'Get-ChildItem -Recurse C:\\',
      cwd: 'C:\\dev',
      timeoutMs: 30000,
    };

    logAudit(entry, true);

    const parsed = JSON.parse((writeSpy.mock.calls[0][0] as string).trim());
    expect(parsed.status).toBe('TIMEOUT');
    expect(parsed.timeoutMs).toBe(30000);
    expect(parsed.exitCode).toBeUndefined();
  });

  it('handles commands with newlines without breaking JSON lines format', () => {
    logAudit({
      timestamp: '2026-03-16T19:30:00.000Z',
      status: 'ALLOWED',
      command: 'echo "line1\nline2"',
      cwd: 'C:\\dev',
      exitCode: 0,
      durationMs: 100,
    }, true);

    const written = writeSpy.mock.calls[0][0] as string;
    // JSON.stringify escapes newlines, so the output is a single line
    const lines = written.split('\n').filter(l => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });

  it('does not throw when stderr.write fails', () => {
    writeSpy.mockImplementation(() => { throw new Error('stderr closed'); });

    expect(() => {
      logAudit({
        timestamp: '2026-03-16T19:30:00.000Z',
        status: 'ALLOWED',
        command: 'echo hello',
        cwd: 'C:\\dev',
        exitCode: 0,
        durationMs: 50,
      }, true);
    }).not.toThrow();
  });
});
