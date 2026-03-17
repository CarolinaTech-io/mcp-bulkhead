export interface AuditEntry {
  timestamp: string;
  status: 'ALLOWED' | 'BLOCKED' | 'ERROR' | 'TIMEOUT';
  command: string;
  cwd?: string;
  exitCode?: number;
  durationMs?: number;
  timeoutMs?: number;
  reason?: string;
}

export function logAudit(entry: AuditEntry, enabled: boolean): void {
  if (!enabled) return;

  try {
    process.stderr.write(JSON.stringify(entry) + '\n');
  } catch {
    // Never crash the server over a log write failure
  }
}
