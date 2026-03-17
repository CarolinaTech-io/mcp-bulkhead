import { describe, it, expect } from 'vitest';
import { validateCommand } from '../src/validator.js';

// Default blacklist from the spec, lowercased
const blacklistSet = new Set([
  'remove-item', 'rm', 'rmdir', 'del', 'rd',
  'format-volume', 'format', 'clear-disk',
  'set-acl', 'chmod', 'chown', 'icacls',
  'start-process', 'sudo', 'su', 'runas',
  'stop-computer', 'restart-computer', 'shutdown', 'reboot',
  'reg', 'regedit',
]);

describe('validateCommand', () => {
  describe('empty/whitespace commands', () => {
    it('rejects an empty string', () => {
      const result = validateCommand('', blacklistSet);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/empty/i);
    });

    it('rejects a whitespace-only string', () => {
      const result = validateCommand('   ', blacklistSet);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/empty/i);
    });
  });

  describe('chain operator detection', () => {
    it('rejects semicolon', () => {
      const result = validateCommand('Get-Process; Stop-Process', blacklistSet);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/;/);
    });

    it('rejects &&', () => {
      const result = validateCommand('Get-Process && Stop-Process', blacklistSet);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/&&/);
    });

    it('rejects ||', () => {
      const result = validateCommand('Get-Process || Stop-Process', blacklistSet);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/\|\|/);
    });

    it('allows semicolon inside single quotes', () => {
      const result = validateCommand("echo 'hello; world'", blacklistSet);
      expect(result.valid).toBe(true);
    });

    it('allows semicolon inside double quotes', () => {
      const result = validateCommand('echo "hello; world"', blacklistSet);
      expect(result.valid).toBe(true);
    });

    it('allows && inside double quotes', () => {
      const result = validateCommand('echo "hello && world"', blacklistSet);
      expect(result.valid).toBe(true);
    });

    it('allows || inside single quotes', () => {
      const result = validateCommand("echo 'test || value'", blacklistSet);
      expect(result.valid).toBe(true);
    });

    it('handles backtick escapes in double quotes', () => {
      // `" inside double quotes does NOT end the string
      const result = validateCommand('echo "he`"llo; world"', blacklistSet);
      // The backtick escapes the inner quote, so the ; is still inside the string
      // Actually: "he`"llo; world" — the `" escapes the quote, so we're still in the string
      // Then llo; world" — the ; is inside the string
      expect(result.valid).toBe(true);
    });

    it('detects semicolon after a quoted string ends', () => {
      const result = validateCommand('echo "hello"; echo "world"', blacklistSet);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/;/);
    });
  });

  describe('pipe handling', () => {
    it('allows simple pipe', () => {
      const result = validateCommand('Get-Process | Where-Object Name -eq code', blacklistSet);
      expect(result.valid).toBe(true);
    });

    it('allows multi-pipe', () => {
      const result = validateCommand('Get-Process | Sort-Object | Select-Object -First 5', blacklistSet);
      expect(result.valid).toBe(true);
    });

    it('does not split on pipe inside single quotes', () => {
      // 'a|b' is a single string argument, not a pipe
      const result = validateCommand("echo 'a|b'", blacklistSet);
      expect(result.valid).toBe(true);
    });

    it('does not split on pipe inside double quotes', () => {
      const result = validateCommand('echo "a|b"', blacklistSet);
      expect(result.valid).toBe(true);
    });

    it('rejects empty leading pipe segment', () => {
      const result = validateCommand('| Get-Process', blacklistSet);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/empty segment/i);
    });

    it('rejects empty trailing pipe segment', () => {
      const result = validateCommand('Get-Process |', blacklistSet);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/empty segment/i);
    });
  });

  describe('blacklist matching', () => {
    it('blocks Remove-Item (exact case)', () => {
      const result = validateCommand('Remove-Item foo.txt', blacklistSet);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/Remove-Item/);
    });

    it('blocks remove-item (lowercase)', () => {
      const result = validateCommand('remove-item foo.txt', blacklistSet);
      expect(result.valid).toBe(false);
    });

    it('blocks REMOVE-ITEM (uppercase)', () => {
      const result = validateCommand('REMOVE-ITEM foo.txt', blacklistSet);
      expect(result.valid).toBe(false);
    });

    it('blocks rm alias', () => {
      const result = validateCommand('rm foo.txt', blacklistSet);
      expect(result.valid).toBe(false);
    });

    it('blocks blacklisted command in second pipe segment', () => {
      const result = validateCommand('Get-Process | Remove-Item', blacklistSet);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/Remove-Item/);
    });

    it('blocks blacklisted command in third pipe segment', () => {
      const result = validateCommand('Get-Process | Select-Object | rm', blacklistSet);
      expect(result.valid).toBe(false);
    });

    it('blocks command invoked via absolute path', () => {
      const result = validateCommand('C:\\Windows\\System32\\format.com D:', blacklistSet);
      expect(result.valid).toBe(false);
    });

    it('blocks command invoked via forward-slash path', () => {
      const result = validateCommand('/usr/bin/rm -rf /', blacklistSet);
      expect(result.valid).toBe(false);
    });

    it('blocks command with .exe extension', () => {
      const result = validateCommand('regedit.exe', blacklistSet);
      expect(result.valid).toBe(false);
    });

    it('allows Get-ChildItem (not blacklisted)', () => {
      const result = validateCommand('Get-ChildItem', blacklistSet);
      expect(result.valid).toBe(true);
    });

    it('allows echo (not blacklisted)', () => {
      const result = validateCommand('echo hello', blacklistSet);
      expect(result.valid).toBe(true);
    });

    it('allows git status', () => {
      const result = validateCommand('git status', blacklistSet);
      expect(result.valid).toBe(true);
    });

    it('allows with empty blacklist', () => {
      const empty = new Set<string>();
      const result = validateCommand('Remove-Item foo.txt', empty);
      expect(result.valid).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles command with leading/trailing whitespace', () => {
      const result = validateCommand('  git status  ', blacklistSet);
      expect(result.valid).toBe(true);
    });

    it('handles complex realistic command', () => {
      const result = validateCommand(
        'Get-ChildItem -Path . -Recurse -Filter "*.ts" | Select-Object Name, Length',
        blacklistSet,
      );
      expect(result.valid).toBe(true);
    });

    it('handles single-word command', () => {
      const result = validateCommand('hostname', blacklistSet);
      expect(result.valid).toBe(true);
    });
  });
});
