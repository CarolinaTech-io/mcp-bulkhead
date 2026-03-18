import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import type { ResolvedConfig } from './config.js';
import { validateCommand } from './validator.js';
import { executeCommand } from './executor.js';
import { logAudit } from './logger.js';

const INSTRUCTIONS =
  'This server executes commands through PowerShell on Windows. ' +
  'Use PowerShell syntax for all commands. ' +
  'Send one command per call \u2014 do not chain commands with ; or && or ||. ' +
  'Pipes (|) are allowed.';

export function createServer(config: ResolvedConfig, shell: string): Server {
  const server = new Server(
    { name: 'mcp-bulkhead', version: '1.0.0' },
    {
      capabilities: { tools: {} },
      instructions: INSTRUCTIONS,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'run_command',
        description:
          'Execute a PowerShell command within the configured working directory. ' +
          'Commands are validated against a blacklist of dangerous operations. ' +
          'Returns stdout on success, error details on failure.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            command: {
              type: 'string',
              description: 'The PowerShell command to execute',
            },
          },
          required: ['command'],
        },
        annotations: {
          title: 'Execute Shell Command',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      {
        name: 'read_file',
        description:
          'Read a file or list a directory within the configured working directory. ' +
          'For files, returns the full contents. For directories, returns a listing ' +
          '(optionally recursive). This is a read-only operation.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            path: {
              type: 'string',
              description: 'Absolute or relative path to a file or directory',
            },
            recurse: {
              type: 'boolean',
              description: 'For directories only: list contents recursively (default false)',
            },
          },
          required: ['path'],
        },
        annotations: {
          title: 'Read File or Directory',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;

    if (toolName === 'read_file') {
      return handleReadFile(request.params.arguments, config, shell);
    }

    if (toolName !== 'run_command') {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
    }

    const command = request.params.arguments?.command;
    if (typeof command !== 'string' || command.trim() === '') {
      throw new McpError(ErrorCode.InvalidParams, 'command must be a non-empty string');
    }

    // Validate
    const validation = validateCommand(command, config.blacklistSet);
    if (!validation.valid) {
      logAudit(
        {
          timestamp: new Date().toISOString(),
          status: 'BLOCKED',
          command,
          reason: validation.reason!,
        },
        config.audit,
      );

      return {
        content: [{ type: 'text', text: validation.reason! }],
        isError: true,
      };
    }

    // Execute
    const timeoutMs = config.timeoutSeconds * 1000;
    const result = await executeCommand(command, shell, config.workingDirectory, timeoutMs);

    // Timeout
    if (result.timedOut) {
      logAudit(
        {
          timestamp: new Date().toISOString(),
          status: 'TIMEOUT',
          command,
          cwd: config.workingDirectory,
          timeoutMs,
        },
        config.audit,
      );

      return {
        content: [{ type: 'text', text: `Command timed out after ${config.timeoutSeconds} seconds` }],
        isError: true,
      };
    }

    // Error (non-zero exit)
    if (result.exitCode !== 0) {
      logAudit(
        {
          timestamp: new Date().toISOString(),
          status: 'ERROR',
          command,
          cwd: config.workingDirectory,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        },
        config.audit,
      );

      const errorText = result.stderr || result.stdout || `Command failed with exit code ${result.exitCode}`;
      return {
        content: [{ type: 'text', text: errorText }],
        isError: true,
      };
    }

    // Success
    logAudit(
      {
        timestamp: new Date().toISOString(),
        status: 'ALLOWED',
        command,
        cwd: config.workingDirectory,
        exitCode: 0,
        durationMs: result.durationMs,
      },
      config.audit,
    );

    return {
      content: [{ type: 'text', text: result.stdout }],
      isError: false,
    };
  });

  return server;
}

/**
 * Sanitize a path for use inside a PowerShell single-quoted string.
 * The only escape in single-quoted PS strings is '' for a literal '.
 */
function sanitizePath(path: string): string {
  return path.replace(/'/g, "''");
}

async function handleReadFile(
  args: Record<string, unknown> | undefined,
  config: ResolvedConfig,
  shell: string,
) {
  const path = args?.path;
  if (typeof path !== 'string' || path.trim() === '') {
    throw new McpError(ErrorCode.InvalidParams, 'path must be a non-empty string');
  }

  const recurse = args?.recurse === true;
  const safePath = sanitizePath(path);
  const timeoutMs = config.timeoutSeconds * 1000;

  // Check if path exists and determine type
  const testCmd = `Test-Path -LiteralPath '${safePath}'`;
  const testResult = await executeCommand(testCmd, shell, config.workingDirectory, timeoutMs);

  if (testResult.timedOut) {
    logAudit(
      {
        timestamp: new Date().toISOString(),
        status: 'TIMEOUT',
        command: testCmd,
        cwd: config.workingDirectory,
        timeoutMs,
      },
      config.audit,
    );
    return {
      content: [{ type: 'text', text: `Command timed out after ${config.timeoutSeconds} seconds` }],
      isError: true,
    };
  }

  if (testResult.stdout.trim() !== 'True') {
    const errorMsg = `Path not found: ${path}`;
    logAudit(
      {
        timestamp: new Date().toISOString(),
        status: 'ERROR',
        command: `read_file: ${path}`,
        reason: errorMsg,
      },
      config.audit,
    );
    return {
      content: [{ type: 'text', text: errorMsg }],
      isError: true,
    };
  }

  // Determine if file or directory
  const isContainerCmd = `Test-Path -LiteralPath '${safePath}' -PathType Container`;
  const isContainerResult = await executeCommand(isContainerCmd, shell, config.workingDirectory, timeoutMs);
  const isDirectory = isContainerResult.stdout.trim() === 'True';

  // Build the read command
  let command: string;
  if (isDirectory) {
    command = recurse
      ? `Get-ChildItem -LiteralPath '${safePath}' -Recurse`
      : `Get-ChildItem -LiteralPath '${safePath}'`;
  } else {
    command = `Get-Content -Raw -LiteralPath '${safePath}'`;
  }

  const result = await executeCommand(command, shell, config.workingDirectory, timeoutMs);

  // Timeout
  if (result.timedOut) {
    logAudit(
      {
        timestamp: new Date().toISOString(),
        status: 'TIMEOUT',
        command: `read_file: ${path}`,
        cwd: config.workingDirectory,
        timeoutMs,
      },
      config.audit,
    );
    return {
      content: [{ type: 'text', text: `Command timed out after ${config.timeoutSeconds} seconds` }],
      isError: true,
    };
  }

  // Error
  if (result.exitCode !== 0) {
    logAudit(
      {
        timestamp: new Date().toISOString(),
        status: 'ERROR',
        command: `read_file: ${path}`,
        cwd: config.workingDirectory,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
      },
      config.audit,
    );
    const errorText = result.stderr || result.stdout || `Command failed with exit code ${result.exitCode}`;
    return {
      content: [{ type: 'text', text: errorText }],
      isError: true,
    };
  }

  // Success
  logAudit(
    {
      timestamp: new Date().toISOString(),
      status: 'ALLOWED',
      command: `read_file: ${path}`,
      cwd: config.workingDirectory,
      exitCode: 0,
      durationMs: result.durationMs,
    },
    config.audit,
  );

  return {
    content: [{ type: 'text', text: result.stdout }],
    isError: false,
  };
}
