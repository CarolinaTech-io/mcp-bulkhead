import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const originalEnv = process.env['MCP_BULKHEAD_CONFIG'];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['MCP_BULKHEAD_CONFIG'];
    } else {
      process.env['MCP_BULKHEAD_CONFIG'] = originalEnv;
    }
    vi.restoreAllMocks();
  });

  it('returns defaults when no env var is set', () => {
    delete process.env['MCP_BULKHEAD_CONFIG'];

    const config = loadConfig();

    expect(config.workingDirectory).toBe(process.cwd());
    expect(config.blacklist).toContain('Remove-Item');
    expect(config.blacklist).toContain('rm');
    expect(config.timeoutSeconds).toBe(30);
    expect(config.audit.enabled).toBe(true);
    expect(config.blacklistSet.has('remove-item')).toBe(true);
  });

  it('loads and merges a partial config file', () => {
    const tmpDir = fs.mkdtempSync(path.join(import.meta.dirname ?? '.', 'test-config-'));
    const configFile = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({ timeoutSeconds: 60 }));
    process.env['MCP_BULKHEAD_CONFIG'] = configFile;

    try {
      const config = loadConfig();
      expect(config.timeoutSeconds).toBe(60);
      // Other fields use defaults
      expect(config.blacklist).toContain('Remove-Item');
      expect(config.audit.enabled).toBe(true);
    } finally {
      fs.unlinkSync(configFile);
      fs.rmdirSync(tmpDir);
    }
  });

  it('uses config blacklist instead of defaults when provided', () => {
    const tmpDir = fs.mkdtempSync(path.join(import.meta.dirname ?? '.', 'test-config-'));
    const configFile = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({ blacklist: ['CustomCmd'] }));
    process.env['MCP_BULKHEAD_CONFIG'] = configFile;

    try {
      const config = loadConfig();
      expect(config.blacklist).toEqual(['CustomCmd']);
      expect(config.blacklistSet.has('customcmd')).toBe(true);
      expect(config.blacklistSet.has('remove-item')).toBe(false);
    } finally {
      fs.unlinkSync(configFile);
      fs.rmdirSync(tmpDir);
    }
  });

  it('accepts an empty blacklist', () => {
    const tmpDir = fs.mkdtempSync(path.join(import.meta.dirname ?? '.', 'test-config-'));
    const configFile = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({ blacklist: [] }));
    process.env['MCP_BULKHEAD_CONFIG'] = configFile;

    try {
      const config = loadConfig();
      expect(config.blacklist).toEqual([]);
      expect(config.blacklistSet.size).toBe(0);
    } finally {
      fs.unlinkSync(configFile);
      fs.rmdirSync(tmpDir);
    }
  });

  it('normalizes blacklist to lowercase in the set', () => {
    delete process.env['MCP_BULKHEAD_CONFIG'];
    const config = loadConfig();
    expect(config.blacklistSet.has('remove-item')).toBe(true);
    expect(config.blacklistSet.has('REMOVE-ITEM')).toBe(false); // Set stores lowercase
    expect(config.blacklistSet.has('format-volume')).toBe(true);
  });

  it('throws on non-existent config file', () => {
    process.env['MCP_BULKHEAD_CONFIG'] = 'C:\\nonexistent\\config.json';

    expect(() => loadConfig()).toThrow(/Failed to read config file/);
  });

  it('throws on invalid JSON in config file', () => {
    const tmpDir = fs.mkdtempSync(path.join(import.meta.dirname ?? '.', 'test-config-'));
    const configFile = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configFile, '{ invalid json }');
    process.env['MCP_BULKHEAD_CONFIG'] = configFile;

    try {
      expect(() => loadConfig()).toThrow(/Invalid JSON/);
    } finally {
      fs.unlinkSync(configFile);
      fs.rmdirSync(tmpDir);
    }
  });

  it('throws on relative workingDirectory', () => {
    const tmpDir = fs.mkdtempSync(path.join(import.meta.dirname ?? '.', 'test-config-'));
    const configFile = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({ workingDirectory: 'relative/path' }));
    process.env['MCP_BULKHEAD_CONFIG'] = configFile;

    try {
      expect(() => loadConfig()).toThrow(/absolute path/);
    } finally {
      fs.unlinkSync(configFile);
      fs.rmdirSync(tmpDir);
    }
  });

  it('throws on non-existent workingDirectory', () => {
    const tmpDir = fs.mkdtempSync(path.join(import.meta.dirname ?? '.', 'test-config-'));
    const configFile = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({ workingDirectory: 'C:\\nonexistent\\dir' }));
    process.env['MCP_BULKHEAD_CONFIG'] = configFile;

    try {
      expect(() => loadConfig()).toThrow(/does not exist/);
    } finally {
      fs.unlinkSync(configFile);
      fs.rmdirSync(tmpDir);
    }
  });

  it('throws on negative timeoutSeconds', () => {
    const tmpDir = fs.mkdtempSync(path.join(import.meta.dirname ?? '.', 'test-config-'));
    const configFile = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({ timeoutSeconds: -5 }));
    process.env['MCP_BULKHEAD_CONFIG'] = configFile;

    try {
      expect(() => loadConfig()).toThrow(/positive number/);
    } finally {
      fs.unlinkSync(configFile);
      fs.rmdirSync(tmpDir);
    }
  });

  it('throws on zero timeoutSeconds', () => {
    const tmpDir = fs.mkdtempSync(path.join(import.meta.dirname ?? '.', 'test-config-'));
    const configFile = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({ timeoutSeconds: 0 }));
    process.env['MCP_BULKHEAD_CONFIG'] = configFile;

    try {
      expect(() => loadConfig()).toThrow(/positive number/);
    } finally {
      fs.unlinkSync(configFile);
      fs.rmdirSync(tmpDir);
    }
  });

  it('throws on non-array blacklist', () => {
    const tmpDir = fs.mkdtempSync(path.join(import.meta.dirname ?? '.', 'test-config-'));
    const configFile = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({ blacklist: 'not-an-array' }));
    process.env['MCP_BULKHEAD_CONFIG'] = configFile;

    try {
      expect(() => loadConfig()).toThrow(/array of strings/);
    } finally {
      fs.unlinkSync(configFile);
      fs.rmdirSync(tmpDir);
    }
  });
});
