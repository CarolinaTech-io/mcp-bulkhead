import fs from 'node:fs';
import path from 'node:path';

export interface AuditConfig {
  enabled: boolean;
  file?: string;
}

export interface BulkheadConfig {
  workingDirectory: string;
  blacklist: string[];
  timeoutSeconds: number;
  audit: AuditConfig;
}

export interface ResolvedConfig extends BulkheadConfig {
  blacklistSet: Set<string>;
}

const DEFAULT_BLACKLIST = [
  'Remove-Item', 'rm', 'rmdir', 'del', 'rd',
  'Format-Volume', 'format', 'Clear-Disk',
  'Set-Acl', 'chmod', 'chown', 'icacls',
  'Start-Process', 'sudo', 'su', 'runas',
  'Stop-Computer', 'Restart-Computer', 'shutdown', 'reboot',
  'reg', 'regedit',
];

const DEFAULT_CONFIG: BulkheadConfig = {
  workingDirectory: process.cwd(),
  blacklist: DEFAULT_BLACKLIST,
  timeoutSeconds: 30,
  audit: { enabled: true },
};

export function loadConfig(): ResolvedConfig {
  const configPath = process.env['MCP_BULKHEAD_CONFIG'];

  let raw: Partial<BulkheadConfig> = {};

  if (configPath) {
    let content: string;
    try {
      content = fs.readFileSync(configPath, 'utf-8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read config file "${configPath}": ${msg}`);
    }

    try {
      raw = JSON.parse(content) as Partial<BulkheadConfig>;
    } catch {
      throw new Error(`Invalid JSON in config file "${configPath}"`);
    }
  }

  const workingDirectory = raw.workingDirectory ?? DEFAULT_CONFIG.workingDirectory;
  const blacklist = raw.blacklist ?? DEFAULT_CONFIG.blacklist;
  const timeoutSeconds = raw.timeoutSeconds ?? DEFAULT_CONFIG.timeoutSeconds;
  const auditEnabled = raw.audit?.enabled ?? DEFAULT_CONFIG.audit.enabled;
  const defaultAuditFile = configPath ? path.join(path.dirname(configPath), 'bulkhead.log') : undefined;
  const auditFile = raw.audit?.file ?? defaultAuditFile;

  // Validate workingDirectory
  if (!path.isAbsolute(workingDirectory)) {
    throw new Error(`workingDirectory must be an absolute path, got: "${workingDirectory}"`);
  }
  if (!fs.existsSync(workingDirectory)) {
    throw new Error(`workingDirectory does not exist: "${workingDirectory}"`);
  }

  // Validate blacklist
  if (!Array.isArray(blacklist)) {
    throw new Error('blacklist must be an array of strings');
  }
  for (const entry of blacklist) {
    if (typeof entry !== 'string') {
      throw new Error(`blacklist entries must be strings, got: ${typeof entry}`);
    }
  }

  // Validate timeoutSeconds
  if (typeof timeoutSeconds !== 'number' || timeoutSeconds <= 0 || !Number.isFinite(timeoutSeconds)) {
    throw new Error(`timeoutSeconds must be a positive number, got: ${timeoutSeconds}`);
  }

  // Validate audit.enabled
  if (typeof auditEnabled !== 'boolean') {
    throw new Error(`audit.enabled must be a boolean, got: ${typeof auditEnabled}`);
  }

  // Validate audit.file
  if (auditFile !== undefined && typeof auditFile !== 'string') {
    throw new Error(`audit.file must be a string, got: ${typeof auditFile}`);
  }

  const blacklistSet = new Set(blacklist.map(s => s.toLowerCase()));

  return {
    workingDirectory,
    blacklist,
    timeoutSeconds,
    audit: { enabled: auditEnabled, file: auditFile },
    blacklistSet,
  };
}
