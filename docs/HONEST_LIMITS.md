# Honest limits — read this before you sell it

**Date:** 2026-08-01 · **Product:** OMNIS CODE IDE (Code-OSS fork)

## What we may say

| Claim | Allowed |
|-------|---------|
| "Agent file writes in this IDE go through a receipt gate" | ✅ once W2 is proven on the ordinary path |
| "This IDE blocks writes" — unqualified | ⚠️ only with the escapes in the same breath |
| "Sandboxed" · "cannot escape" · "enforced" · "secure" | 🔴 **never** |

## What the gate actually is

The gate lives in the **extension host module loader** (`NodeModuleRequireInterceptor` + `omnisWriteGate`).

When a **third-party / user extension** does `require('fs')` / `import 'fs'` (and `fs/promises`), mutating calls consult **omnis-key** first:

| Ledger state | Write | Receipt |
|--------------|-------|---------|
| `RECEIPT_CHAIN_VALID` | lands | recorded via `omnis-key receipts record` |
| `EMPTY_NOT_YET_EVIDENCED` | lands (bootstrap) | recorded |
| `RECEIPT_CHAIN_INVALID` | **refused** | — |
| `RECEIPT_STATE_UNSAFE` | **refused** | — |
| Engine unreachable | **refused — fail closed** | — |

Built-in product code and built-in extensions are **not** gated (so a missing engine does not brick the workbench). The ordinary **agent / third-party** write path is.

## Documented escapes (not bugs — out of scope)

These succeed today. They are **named** so a bank CTO does not buy a sandbox we do not have:

1. **`child_process`** — spawn `sh -c 'echo pwned > file'` bypasses the gate.
2. **Native addons** — any `.node` binary with its own I/O.
3. **`process.binding` / internal FS** — low-level Node surfaces not wrapped.
4. **`vscode.workspace.fs`** — goes to the **main process** file service, not extension-host `fs`.
5. **Main process / shared process** — not the extension host; not wrapped.
6. **Terminal / tasks** — user or agent-run shell is not `require('fs')`.
7. **Kill-switch** — `OMNIS_WRITE_GATE=off` disables the gate (recovery only).

Pan's honesty criterion: an extension that bypasses via `child_process` must succeed, and this document must already say so.

## What we re-use

- **omnis-key** for all receipt hash-chain logic. The fork implements **no** second ledger.
- Fail closed: engine down → write does not happen on the gated path.

## Attribution

- MIT license from Microsoft Code - OSS remains.
- Copyright (c) Microsoft Corporation remains on upstream files.
- We do **not** use Visual Studio Code marks or Microsoft product logos in the branded app (W4).
- `licenseUrl` pointing at Microsoft's LICENSE.txt is **correct** — that is the licence text.
- `builtInExtensions` naming `ms-vscode` as publisher is **correct** — Microsoft is the publisher of those extensions.

## Webviews and Microsoft CDN (Pan finding 2026-08-02)

**What was wrong:** `product.json` shipped  
`webviewContentExternalBaseUrlTemplate` → `https://{{uuid}}.vscode-cdn.net/insider/<sha>/…`  
with an **Insiders commit SHA that is not our pin** (`1b2f25580`). That is not a licensing issue; it is a **live dependency on infrastructure we do not control**, serving (or failing to serve) content that does not match this tree.

**What we did:** **removed** the key from `product.json`. We do not host a substitute CDN, so we do not invent a fake JourdanLabs URL.

**What desktop actually uses:** Electron builds resolve  
`webviewExternalEndpoint` to the **local** scheme `vscode-webview://{{uuid}}`  
(`src/vs/workbench/services/environment/electron-browser/environmentService.ts`).  
The product.json CDN template is **not** on the ordinary desktop webview path, and it is **not** on the write-gate path.

**What still remains in upstream source (residual):** the **browser** workbench environment still hardcodes a `vscode-cdn.net` fallback and the same Insiders-shaped default commit if you run a pure browser build of the workbench. That is unpatched Code-OSS surface. Shipping a **web** build without revisiting that is a separate honesty problem. This product’s current ship path is **desktop**.

Silence on the product.json field was the fail; removal + this section is the honest close.

## Who this is for

Cooperating agents and honest tooling that already use Node `fs` in the extension host.

It is **not** an adversarial sandbox. John Lynch will find the hole if you claim otherwise.
