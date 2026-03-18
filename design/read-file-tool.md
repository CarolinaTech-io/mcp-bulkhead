## mcp-bulkhead: `read_file` Tool — Design Spec

**Version:** 0.1 draft
**Scope:** Add a single read-only tool to the existing mcp-bulkhead MCP server.

---

### Purpose

Provide a read-only filesystem tool that Claude Desktop can auto-approve, complementing the existing `run_command` tool which requires per-call human approval. Together they form a two-tier permission model: read freely, write with consent.

---

### Tool Definition

**Name:** `read_file`

**Input schema:**
- `path` (string, required) — Absolute or relative path to a file or directory.
- `recurse` (boolean, optional, default `false`) — For directories only: list contents recursively.

**MCP annotations:**
- `title: 'Read File or Directory'`
- `readOnlyHint: true`
- `destructiveHint: false`
- `idempotentHint: true`
- `openWorldHint: false`

---

### Behavior

1. Receive `path` from caller.
2. Sanitize `path` for PowerShell single-quote injection (replace `'` with `''`).
3. Use `Test-Path -LiteralPath '<path>'` via existing `executeCommand` to determine if path exists and whether it is a file or directory.
4. If path does not exist → return error: "Path not found: \<path\>"
5. If file → execute `Get-Content -Raw -LiteralPath '<path>'`
6. If directory and `recurse` is false → execute `Get-ChildItem -LiteralPath '<path>'`
7. If directory and `recurse` is true → execute `Get-ChildItem -LiteralPath '<path>' -Recurse`
8. Return stdout as text content. On non-zero exit, return stderr as error.
9. On timeout, return timeout error using existing timeout handling.

All commands are constructed internally. The caller-supplied `path` string is never passed as a command — it is only interpolated as a quoted literal argument.

`-Raw` is used with `Get-Content` for better performance and to preserve exact file content (avoids trailing newline edge cases from line-by-line mode).

---

### Files Changed

**`server.ts`** — Two changes:
- Add `read_file` to the `ListToolsRequestSchema` handler's tools array.
- Add a branch in the `CallToolRequestSchema` handler: if `request.params.name === 'read_file'`, extract and sanitize path, construct the appropriate PowerShell command, call `executeCommand`, return result.

**No changes to:** `validator.ts`, `config.ts`, `executor.ts`, `logger.ts`, `index.ts`.

---

### Audit Logging

Log all `read_file` calls through the existing `logAudit` function using the same structure. Status values:
- `ALLOWED` — successful read
- `ERROR` — non-zero exit or path not found
- `TIMEOUT` — command exceeded configured `timeoutSeconds`

No `BLOCKED` status is needed — there is no validation to fail. The tool constructs its own commands.

---

### Security Model

**Injection surface:** None. The only caller-supplied input is `path`, which is embedded as a PowerShell single-quoted literal argument to `-LiteralPath`. Single-quoted strings in PowerShell have no escape sequences except `''` for a literal quote, which the sanitization handles.

**Information disclosure:** The tool can read any file the mcp-bulkhead process user has OS-level read access to. This is intentional and accepted. Users who need to restrict this should run mcp-bulkhead under a limited user account (out of scope for this change).

**No command chaining:** No user-supplied string is ever evaluated as a command. The tool runs exactly one of three hardcoded commands (`Test-Path`, `Get-Content`, `Get-ChildItem`).

---

### Config

No new config fields. The tool respects existing `workingDirectory` (for relative path resolution), `timeoutSeconds`, and `audit` settings.

---

### Known Limitations

**Large files:** `Get-Content -Raw` will read an entire file into memory via `execa`. A multi-GB file could cause memory exhaustion. This is accepted for v1. A future enhancement could add a `-TotalCount` or size-check guard.

---

### Testing Scope

- Read a known file → returns contents
- Read a known directory → returns listing
- Read a directory with `recurse: true` → returns recursive listing
- Read a nonexistent path → returns error
- Path containing single quotes → correctly escaped, works
- Relative path → resolves against `workingDirectory`
- Binary file → returns whatever `Get-Content -Raw` outputs (acceptable, not a goal to handle gracefully)
- Timeout → existing timeout behavior applies, logged as `TIMEOUT`
