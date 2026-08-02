# Building OMNIS CODE IDE

Stranger-clone path. If these steps fail on your machine, the build is not ready — fix the docs or the tree, do not paper over it.

## Prerequisites

| Tool | Version | Notes |
|------|---------|--------|
| **Node.js** | **v24.18.0** (major 24, ≥ patch in `.nvmrc`) | `preinstall` **refuses** older minors. Install from [nodejs.org](https://nodejs.org/) or your version manager. |
| **npm** | &lt; 12 | Ships with Node 24.18; npm 12+ is rejected. |
| **Python 3** | 3.x | Native module builds |
| **Xcode CLT** (macOS) | current | `xcode-select --install` |
| **omnis-key** | on `PATH` or known path | Required for the **write gate** (W2). IDE launches without it; gated extension writes **fail closed**. |

Verified on this pin: macOS arm64, Node v24.18.0, Electron **42.7.1**, shallow clone ~325 MB source / ~1.7 GB `node_modules`.

## Clone

```bash
git clone https://github.com/jourdanlabs/omnis-code-ide.git   # when published
# OR from a local path / mirror of this tree
cd omnis-code-ide
git rev-parse HEAD   # must match UPSTREAM.md until a merge moves the pin
```

Upstream history is Microsoft's. Our commits sit on top (or on a release branch — see `docs/UPSTREAM_MERGE.md`).

## Install & compile

```bash
# Use the Node version in .nvmrc
node -v   # v24.18.0 or newer within major 24

npm install
npm run compile
```

First `npm install` downloads Electron and rebuilds native modules. Budget **tens of minutes** on a cold machine; that is normal, not failure.

## Launch

```bash
./scripts/code.sh
```

Or with an isolated profile (recommended while developing the gate):

```bash
UDD=$(mktemp -d)
EXT=$(mktemp -d)
./scripts/code.sh --user-data-dir "$UDD" --extensions-dir "$EXT" --disable-updates --use-mock-keychain
```

You should get a **Code - OSS** window (branding is W4 — still upstream names until product.json is patched).

### Launch evidence (builder machine)

See `docs/evidence/w1-launch.txt`. Cold gate for Pan: clone, `npm install`, `npm run compile`, `./scripts/code.sh`, get a window.

## Write-gate probe (no UI)

With `omnis-key` installed and sources compiled:

```bash
node scripts/omnis-write-gate-probe.mjs
```

Expect: healthy write + receipt, tampered ledger refuses with **file unchanged**, missing engine refuses.

## Common friction

| Symptom | Cause | Fix |
|---------|--------|-----|
| `Please use Node.js v24.18.0 or newer` | Wrong Node | Install 24.18.0+ major 24; do **not** rely on `VSCODE_SKIP_NODE_VERSION_CHECK` for ship builds |
| Native module / node-gyp errors | Missing CLT / Python | Install Xcode CLT; ensure `python3` on PATH |
| Electron download hang | Network | Retry; check `node_modules/electron` |
| Window opens then dies | Shared storage clash | Pass unique `--user-data-dir` and `--shared-data-dir` |
| Gated writes always refuse | No `omnis-key` | Install engine; or `OMNIS_WRITE_GATE=off` for emergency (disables gate — not for demos) |

## What this is not

- Not a Microsoft-supported product.
- Not Visual Studio Code (trademark). MIT license and Microsoft copyright remain — see `LICENSE.txt` and `docs/HONEST_LIMITS.md`.
