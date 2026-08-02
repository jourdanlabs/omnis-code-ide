# OMNIS CODE IDE

**Code-OSS fork with a receipt-gated extension write path.**  
Built by JourdanLabs · gated by Pan · engine = **omnis-key** (not reimplemented here).

> **Read [docs/HONEST_LIMITS.md](docs/HONEST_LIMITS.md) first.**  
> We gate cooperating agents on the ordinary `fs` path. We do **not** ship a sandbox.  
> Words we never use for this product: *sandboxed*, *cannot escape*, *enforced*, *secure*.

| Claim | Status |
|-------|--------|
| Agent file writes via extension-host `fs` go through omnis-key | ✅ W2 (see probe) |
| Blocks all writes / adversarial containment | 🔴 no — escapes named in HONEST_LIMITS |

## Upstream

| | |
|--|--|
| Base | [`microsoft/vscode`](https://github.com/microsoft/vscode) @ **`1b2f25580`** · v1.132.0 · MIT |
| Pin file | [`UPSTREAM.md`](UPSTREAM.md) |
| Upstream README | [`docs/UPSTREAM_README.md`](docs/UPSTREAM_README.md) |

Microsoft copyright and the MIT license remain. This is **not** Visual Studio Code.

## Build & launch

See **[BUILDING.md](BUILDING.md)** — stranger path:

```bash
# Node v24.18.0+ (major 24)
npm install
npm run compile
./scripts/code.sh
```

## Write gate (the thesis)

Attachment point: `NodeModuleRequireInterceptor` (CJS `_load` + ESM `registerHooks`).  
Implementation: `src/vs/workbench/api/node/omnisWriteGate.ts`  
Coverage: [`docs/WRITE_GATE_COVERAGE.md`](docs/WRITE_GATE_COVERAGE.md)

```bash
node scripts/omnis-write-gate-probe.mjs
```

## Workstreams

| ID | Topic | Doc / status |
|----|--------|----------------|
| W1 | Build + launch | BUILDING.md · evidence in docs/evidence/ |
| W2 | Write gate | omnisWriteGate.ts · probe script |
| W3 | Preinstall Lucca OMNIS CODE extension | consume `.vsix` only — do not touch her repo |
| W4 | Branding | product.json · icons · attribution |
| W5 | Open VSX + mcpGallery | product.json galleries |
| W6 | Sign / notarise | docs TBD |
| W7 | Upstream merge strategy | docs/UPSTREAM_MERGE.md |
| W8 | Distribution + honest-limits page | this README + HONEST_LIMITS |

## Parallel lane

**Lucca** owns the OMNIS CODE VS Code *extension*. This fork **consumes** her packaged `.vsix`. Do not vendor or patch her source here.

## License

MIT — see `LICENSE.txt`. Copyright (c) Microsoft Corporation and JourdanLabs contributions as marked.
