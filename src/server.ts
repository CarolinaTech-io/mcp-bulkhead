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
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== 'run_command') {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
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
        config.audit.enabled,
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
        config.audit.enabled,
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
        config.audit.enabled,
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
      config.audit.enabled,
    );

    return {
      content: [{ type: 'text', text: result.stdout }],
      isError: false,
    };
  });

  return server;
}
