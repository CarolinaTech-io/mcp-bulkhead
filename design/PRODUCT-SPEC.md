# mcp-bulkhead — Product Specification v1.4

## 1. Purpose

mcp-bulkhead is an MCP server that provides secure shell command execution for AI assistants operating on Windows through Claude Desktop. It enables an LLM to run PowerShell commands on the local system through a controlled execution environment with configurable security boundaries.

The name references the engineering concept of a bulkhead — a sealed compartment that contains failures and prevents them from propagating.

**Repository:** [CarolinaTech-io/mcp-bulkhead](https://github.com/CarolinaTech-io/mcp-bulkhead)
**License:** MIT
**Language:** TypeScript
**Runtime:** Node.js
**MCP Protocol Version:** 2025-11-25
**Target Platform:** Claude Desktop on Windows

## 2. Target Platform

This server is built for Claude Desktop running on Windows. The execution shell is PowerShell, hardcoded. This is a deliberate design choice:

- PowerShell is present on every Windows 10/11 machine (5.1 ships with the OS, 7.x is widely installed).
- PowerShell cmdlets are real discoverable commands. Built-in operations like `Get-ChildItem`, `Get-Content`, `Set-Content`, and `Copy-Item` resolve and execute without shell-specific workarounds.
- Common aliases (`dir`, `cat`, `ls`, `cp`, `mv`, `echo`) work natively in PowerShell as aliases to cmdlets.
- PowerShell provides object pipelines, native JSON handling (`ConvertTo-Json`, `ConvertFrom-Json`), proper error handling (`try`/`catch`), and encoding control on file writes — capabilities an LLM benefits from directly.
- The LLM does not need to know what shell is running. It sends a command, the server executes it through PowerShell. No `cmd /c` prefix, no platform-specific wrapping, no guessing.

## 3. Design Principles

1. **Spec-compliant.** Built to the MCP 2025-11-25 specification. Every MUST and SHOULD is implemented.
2. **Minimal.** One tool. One config file. One purpose.
3. **Defense in depth.** Command blacklist, working directory restriction, execution timeout, and audit logging — layered with the MCP client's operator approval prompt as the primary security gate.
4. **Production-grade.** Proper validation, proper error handling, proper logging. Not a demo.

## 4. Tool: `run_command`

The server exposes a single tool.

### 4.1 Tool Definition

Returned by the server in response to `tools/list`:

```json
{
  "name": "run_command",
  "title": "Execute Shell Command",
  "description": "Execute a PowerShell command within the configured working directory. Commands are validated against a blacklist of dangerous operations. Returns stdout on success, error details on failure.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "command": {
        "type": "string",
        "description": "The PowerShell command to execute"
      }
    },
    "required": ["command"]
  },
  "annotations": {
    "title": "Execute Shell Command",
    "readOnlyHint": false,
    "destructiveHint": true,
    "idempotentHint": false,
    "openWorldHint": true
  }
}
```

### 4.2 Execution Flow

1. Validate `command` is present and is a non-empty string. If not, return a protocol error.
2. Reject command chaining. If the command contains chain operators (`;`, `&&`, `||`), return a tool error instructing the LLM to send one command per call. Pipes (`|`) are allowed — they are a single logical operation, not separate commands.
3. Split the command on pipe operators (`|`) into segments.
4. For each segment, resolve the base command (first token after whitespace split) and check it against the blacklist. Match the bare name, any PowerShell alias it resolves to, and the final segment of any absolute path. If any segment is blocked, return a tool error.
5. Execute through PowerShell with the configured working directory, timeout, and inherited environment.
6. Return the result.

### 4.3 PowerShell Execution

Commands are executed through `pwsh.exe` (PowerShell 7) if available, falling back to `powershell.exe` (Windows PowerShell 5.1). The server detects which is available at startup and uses it for all subsequent executions.

The LLM does not need to know which version is running. It sends commands using standard PowerShell syntax and the server handles execution.

### 4.4 Response Format

**Success:**

```json
{
  "content": [{ "type": "text", "text": "<stdout>" }],
  "isError": false
}
```

**Tool execution error** (command failed, timed out, or was blocked):

```json
{
  "content": [{ "type": "text", "text": "<error description>" }],
  "isError": true
}
```

**Protocol error** (unknown tool, malformed request):

Standard JSON-RPC error response per the MCP specification.

## 5. Configuration

A single JSON file controls all server behavior. The config file is the single source of truth — the server ships with a default config containing recommended settings, and the operator owns the full contents. The file path is set via the `MCP_BULKHEAD_CONFIG` environment variable. If not set, the server starts with built-in defaults. See the README for configuration guidance.

### 5.1 Schema

```json
{
  "workingDirectory": "C:\\dev",
  "blacklist": [
    "Remove-Item", "rm", "rmdir", "del", "rd",
    "Format-Volume", "format",
    "Clear-Disk",
    "Set-Acl", "chmod", "chown", "icacls",
    "Start-Process", "sudo", "su", "runas",
    "Stop-Computer", "Restart-Computer", "shutdown", "reboot",
    "reg", "regedit"
  ],
  "timeoutSeconds": 30,
  "audit": {
    "enabled": true,
    "file": "C:\\logs\\bulkhead.log"
  }
}
```

### 5.2 Fields


| Field              | Type     | Default     | Description                                                   |
| ------------------ | -------- | ----------- | ------------------------------------------------------------- |
| `workingDirectory` | string   | Process cwd | Absolute path used as `cwd` for all command execution.        |
| `blacklist`        | string[] | See 6.1     | Command and cmdlet names blocked from execution. Fully operator-controlled. |
| `timeoutSeconds`   | number   | 30          | Max execution time per command. Exceeded commands are killed. |
| `audit.enabled`    | boolean  | true        | Log every command execution to stderr.                        |
| `audit.file`       | string   | `bulkhead.log` next to config file | File path to append audit logs to. Set to `""` to disable.    |


All fields are optional. Omitted fields use defaults.

## 6. Security

### 6.1 Command Blacklist

The blacklist blocks commands that are categorically destructive, enable privilege escalation, or disrupt system state. Both PowerShell cmdlets and their common aliases are included to prevent bypass through either name. The blacklist is fully operator-controlled via the config file — entries can be added or removed to match the environment.

**Recommended default blacklist:**


| Category                | Cmdlets / Commands                                        | Rationale                                       |
| ----------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| Filesystem destruction  | `Remove-Item`, `rm`, `rmdir`, `del`, `rd`                 | Irreversible file/directory deletion            |
| Disk operations         | `Format-Volume`, `format`, `Clear-Disk`                   | Partition formatting, disk wiping               |
| Privilege escalation    | `Start-Process` (as runas proxy), `sudo`, `su`, `runas`   | Elevated execution bypasses all other controls  |
| Permission modification | `Set-Acl`, `chmod`, `chown`, `icacls`                     | Alters access controls on files and directories |
| System control          | `Stop-Computer`, `Restart-Computer`, `shutdown`, `reboot` | System state disruption                         |
| Registry manipulation   | `reg`, `regedit`                                          | Direct Windows registry modification            |


Blacklist matching checks the base command name of each pipe segment against the list. Because the server executes through PowerShell, aliases like `rm` (which resolves to `Remove-Item`) are included explicitly — both the alias and the cmdlet name are listed.

### 6.2 Security Layers

1. **MCP client approval** (external to this server) — The MCP client presents every tool call to the operator for approval before execution. This is the primary security gate.
2. **Blacklist** — Prevents dangerous commands from executing. Configurable, can be disabled.
3. **Working directory** — Sets the default execution context. Configurable.
4. **Execution timeout** — Kills commands that exceed the configured duration. Configurable.
5. **Audit log** — Records every execution for forensic review. Can be disabled.

The server is designed to enable execution, not restrict it. Layers 2–5 are optional guardrails that assist the operator — they are not a substitute for operator approval.

### 6.3 What This Server Does Not Do

The server does not parse or validate file path arguments within commands. It does not sandbox filesystem access. It does not implement a whitelist/allowlist. These are deliberate design choices — the operator's approval of each command is the control for what the LLM is allowed to do with the tools available to it.

## 7. Audit Logging

When enabled, every command execution writes a structured JSON line to stderr (captured by the MCP client) and, if `audit.file` is configured, appends the same line to the specified file for direct operator access.

**Format (JSON lines — one JSON object per line):**

```json
{"timestamp":"2026-03-16T19:30:00.000Z","status":"ALLOWED","command":"git status","cwd":"C:\\dev","exitCode":0,"durationMs":245}
{"timestamp":"2026-03-16T19:30:05.000Z","status":"BLOCKED","command":"Remove-Item -Recurse -Force /","reason":"blacklisted: Remove-Item"}
{"timestamp":"2026-03-16T19:30:10.000Z","status":"ERROR","command":"git push","cwd":"C:\\dev","exitCode":1,"durationMs":3200}
{"timestamp":"2026-03-16T19:30:15.000Z","status":"TIMEOUT","command":"Get-ChildItem -Recurse C:\\","cwd":"C:\\dev","timeoutMs":30000}
```

## 8. Server Initialization

### 8.1 Instructions

The server returns an `instructions` field in its initialization response. This is read by the LLM at connection time before any tools are discovered or called. It tells the LLM exactly what environment it's working in.

```
"instructions": "This server executes commands through PowerShell on Windows. Use PowerShell syntax for all commands. Send one command per call — do not chain commands with ; or && or ||. Pipes (|) are allowed."
```

### 8.2 Capabilities

The server declares only what it implements:

```json
{
  "capabilities": {
    "tools": {}
  }
}
```

No `resources`. No `prompts`. No `listChanged`.

## 9. Dependencies

**Production:**

- `@modelcontextprotocol/sdk` — MCP protocol implementation (current version)
- `execa` — Command execution with timeout and signal handling

**Development:**

- `typescript`
- `@types/node`

No other dependencies.

## 10. Deployment

### Claude Desktop (Windows)

```json
{
  "mcpServers": {
    "mcp-bulkhead": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "mcp-bulkhead"],
      "env": {
        "MCP_BULKHEAD_CONFIG": "C:\\path\\to\\bulkhead.json"
      }
    }
  }
}
```

The `cmd /c` wrapper is required for Claude Desktop to launch npx-based MCP servers on Windows via stdio transport.

### Local Development

```json
{
  "mcpServers": {
    "mcp-bulkhead": {
      "command": "node",
      "args": ["C:\\dev\\mcp-bulkhead\\build\\index.js"],
      "env": {
        "MCP_BULKHEAD_CONFIG": "C:\\dev\\mcp-bulkhead\\config.json"
      }
    }
  }
}
```

## 11. Out of Scope

- Whitelist/allowlist mode
- Path argument validation or filesystem sandboxing
- Multiple tools
- Resource or prompt capabilities
- HTTP/SSE transport
- Auto-configuration CLI
- Telemetry or analytics
- Cross-platform support (Linux/macOS) — this version targets Windows only
- Long-term solution — this is a short-term tool for Claude Desktop on Windows; broader cross-platform or future-proof features are deliberately out of scope

