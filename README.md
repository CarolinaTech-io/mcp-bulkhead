# mcp-bulkhead

An MCP server that gives AI assistants controlled PowerShell command execution on Windows. One tool (`run_command`), configurable security guardrails, audit logging.

## Quick Start (Claude Desktop)

Add to `%APPDATA%\Claude\claude_desktop_config.json`:

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

The `cmd /c` wrapper is required for Claude Desktop to launch npx-based MCP servers on Windows.

`MCP_BULKHEAD_CONFIG` is optional — if omitted, the server uses built-in defaults.

## Configuration

Create a JSON config file and point `MCP_BULKHEAD_CONFIG` to it:

```json
{
  "workingDirectory": "C:\\dev",
  "blacklist": [
    "Remove-Item", "rm", "rmdir", "del", "rd",
    "Format-Volume", "format", "Clear-Disk",
    "Set-Acl", "chmod", "chown", "icacls",
    "Start-Process", "sudo", "su", "runas",
    "Stop-Computer", "Restart-Computer", "shutdown", "reboot",
    "reg", "regedit"
  ],
  "timeoutSeconds": 30,
  "audit": { "enabled": true }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `workingDirectory` | string | process cwd | Absolute path used as cwd for execution |
| `blacklist` | string[] | see above | Commands blocked from execution |
| `timeoutSeconds` | number | 30 | Max seconds per command before kill |
| `audit.enabled` | boolean | true | Log every command to stderr as JSON lines |

All fields are optional. Omitted fields use defaults. The blacklist is fully yours to control — add, remove, or empty it.

### Command rules

- **One command per call.** Chain operators (`;`, `&&`, `||`) are rejected.
- **Pipes are allowed.** Each pipe segment is checked against the blacklist.

```
Get-Process | Select-Object Name     # allowed — pipe
Get-Process; Stop-Service foo        # blocked — chain operator
Get-Process | Remove-Item            # blocked — Remove-Item in second segment
```

## Security

1. **MCP client approval** — the operator approves every tool call. This is the primary gate.
2. **Blacklist** — blocks dangerous commands. Configurable, can be emptied.
3. **Working directory** — sets execution context. Configurable.
4. **Timeout** — kills long-running commands. Configurable.
5. **Audit log** — JSON lines to stderr. Can be disabled.

The server enables execution. These guardrails assist — they don't replace operator judgment.

## Development

```bash
git clone https://github.com/CarolinaTech-io/mcp-bulkhead.git
cd mcp-bulkhead
npm install
npm run build
npm test
```

Test with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node build/index.js
```

## License

MIT
