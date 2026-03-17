export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate a command string against chain operators and the blacklist.
 * Returns { valid: true } if the command is allowed, or { valid: false, reason } if blocked.
 */
export function validateCommand(command: string, blacklistSet: Set<string>): ValidationResult {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: 'Command is empty' };
  }

  // Step 1: Reject chain operators outside quotes
  const chainOp = findChainOperator(trimmed);
  if (chainOp) {
    return {
      valid: false,
      reason: `Chain operator "${chainOp}" is not allowed. Send one command per call. Pipes (|) are allowed.`,
    };
  }

  // Step 2: Split on unquoted pipes
  const segments = splitOnPipes(trimmed);

  // Step 3: Check each segment against the blacklist
  for (const segment of segments) {
    const seg = segment.trim();
    if (seg.length === 0) {
      return { valid: false, reason: 'Malformed pipe syntax: empty segment' };
    }

    const baseCommand = extractBaseCommand(seg);
    if (blacklistSet.has(baseCommand.toLowerCase())) {
      return { valid: false, reason: `Blocked command: ${baseCommand}` };
    }
  }

  return { valid: true };
}

/**
 * Walk the command char-by-char with quote-state tracking.
 * Returns the chain operator found in unquoted context, or null if clean.
 *
 * PowerShell quoting rules:
 * - Single quotes: literal strings, no escaping ('' is escape for literal ')
 * - Double quotes: backtick (`) is escape character
 */
function findChainOperator(command: string): string | null {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }

    if (inDouble) {
      if (ch === '`') { i++; continue; } // backtick escape — skip next char
      if (ch === '"') inDouble = false;
      continue;
    }

    // Unquoted context
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '"') { inDouble = true; continue; }

    if (ch === ';') return ';';
    if (ch === '&' && i + 1 < command.length && command[i + 1] === '&') return '&&';
    if (ch === '|' && i + 1 < command.length && command[i + 1] === '|') return '||';
  }

  return null;
}

/**
 * Split command on unquoted single pipe characters.
 * Assumes chain operators (||) have already been rejected.
 */
function splitOnPipes(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (inSingle) {
      current += ch;
      if (ch === "'") inSingle = false;
      continue;
    }

    if (inDouble) {
      current += ch;
      if (ch === '`' && i + 1 < command.length) {
        i++;
        current += command[i];
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }

    // Unquoted context
    if (ch === "'") { inSingle = true; current += ch; continue; }
    if (ch === '"') { inDouble = true; current += ch; continue; }

    if (ch === '|') {
      segments.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  segments.push(current);
  return segments;
}

/**
 * Extract the base command name from a pipe segment.
 * Takes the first whitespace-delimited token, resolves path basenames,
 * and strips common executable extensions.
 */
function extractBaseCommand(segment: string): string {
  const trimmed = segment.trim();
  const firstToken = trimmed.split(/\s+/)[0];

  // Handle paths: take the last segment after / or \
  const basename = firstToken.split(/[/\\]/).pop() || firstToken;

  // Strip common executable extensions
  return basename.replace(/\.(exe|com|ps1|cmd|bat)$/i, '');
}
