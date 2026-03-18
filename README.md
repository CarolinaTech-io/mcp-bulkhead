# mcp-bulkhead

⚠️ **WARNING: Do not run this on anything you care about. Development testing only.** ⚠️

An MCP server that gives Claude Desktop the ability to run PowerShell commands on your local Windows machine. It includes a configurable command blacklist — a simple safety you can adjust or removed (if you like running with knives).

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
| `audit.enabled` | boolean | true | Log every command execution as JSON lines |
| `audit.file` | string | `bulkhead.log` next to config file | File path to append audit logs to. Set to `""` to disable file logging. |

All fields are optional. Omitted fields use defaults. The blacklist is fully yours to control — add, remove, or empty it.

### Command rules

- **One command per call.** Chain operators (`;`, `&&`, `||`) are rejected.
- **Pipes are allowed.** Each pipe segment is checked against the blacklist.

```
Get-Process | Select-Object Name     # allowed — pipe
Get-Process; Stop-Service foo        # blocked — chain operator
Get-Process | Remove-Item            # blocked — Remove-Item in second segment
```

## Features (configurable in JSON)

1. **Blacklist** — blocks dangerous commands. Can be emptied.
2. **Working directory** — sets the default execution context. Does not restrict access to other paths.
3. **Timeout** — kills long-running commands.
4. **Audit log** — JSON lines to stderr and/or a file. Can be disabled.

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
