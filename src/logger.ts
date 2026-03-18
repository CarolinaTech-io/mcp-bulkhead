import fs from 'node:fs';
import type { AuditConfig } from './config.js';

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

export function logAudit(entry: AuditEntry, audit: AuditConfig): void {
  if (!audit.enabled) return;

  const line = JSON.stringify(entry) + '\n';

  try {
    process.stderr.write(line);
  } catch {
    // Never crash the server over a log write failure
  }

  if (audit.file) {
    try {
      fs.appendFileSync(audit.file, line);
    } catch {
      // Never crash the server over a log write failure
    }
  }
}
