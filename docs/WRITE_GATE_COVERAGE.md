# Write gate coverage

**Source:** `src/vs/workbench/api/node/omnisWriteGate.ts`  
**Attachment:** `NodeModuleRequireInterceptor` in `extHostExtensionService.ts`

## Covered (gated)

### `fs` / `node:fs`

| Method | Notes |
|--------|--------|
| `writeFile` / `writeFileSync` | |
| `appendFile` / `appendFileSync` | |
| `rm` / `rmSync` | |
| `unlink` / `unlinkSync` | |
| `rename` / `renameSync` | |
| `mkdir` / `mkdirSync` | |
| `createWriteStream` | Gated at open; records intent |
| `copyFile` / `copyFileSync` | Beyond Pan minimum |
| `cp` / `cpSync` | Beyond Pan minimum |

### `fs/promises` / `node:fs/promises`

| Method |
|--------|
| `writeFile`, `appendFile`, `rm`, `unlink`, `rename`, `mkdir`, `copyFile`, `cp` |

Also: `fs.promises.*` when obtained via `require('fs').promises`.

## Explicitly not covered (scope notes, not surprises)

| Surface | Why |
|---------|-----|
| `open` / `write` / `writeSync` (fd-level) | Partial writes via raw fds |
| `truncate` / `ftruncate` | |
| `chmod` / `chown` / `symlink` / `link` | Metadata / link ops |
| `fs.FileHandle` write methods | |
| `vscode.workspace.fs` | Main process — see HONEST_LIMITS |
| `child_process`, native addons, `process.binding` | Escapes |
| Built-in extension + product `out/` requires | Intentionally not gated |

An unlisted gap found at gate without being on this list is a **fail**. A listed gap is a **scope note**.

## Who is gated

`shouldGateParent(parent, appRoot)`:

- **Not gated:** `{appRoot}/out/**`, `{appRoot}/extensions/**`, `{appRoot}/node_modules/**`, `{appRoot}/.build/**`
- **Gated:** everything else (user extensions, workspace extensions, third-party)
- **Kill-switch:** `OMNIS_WRITE_GATE=off`
- **Force all:** `OMNIS_WRITE_GATE=all` (including builtins — demo / stress only)

## Engine contract (reused, not reimplemented)

```text
omnis-key receipts status --json   # before mutate
omnis-key receipts record --event-id … --evidence-sha256 … ide.fs.<method> <subject> --json
```

Branch on envelope `code`, never on `ok` alone (`EMPTY_NOT_YET_EVIDENCED` is ok:false but allow).
