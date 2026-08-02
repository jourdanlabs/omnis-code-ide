# Packaging, signing, notarisation (W6)

## Starting points (upstream)

- `build/gulpfile.vscode.ts`
- `build/darwin/`
- Electron **42.7.1** (this pin)

## Chamber precedent

OMNIS and GAVEL ship signed and notarised. **Captain holds notary credentials.** Reuse that path; do not invent a parallel one without cause.

## Unresearched on this pin (named, not guessed)

| Item | Status |
|------|--------|
| Electron 42 hardened-runtime entitlements | **Untouched** — must be verified against current chamber signing lib |
| Whether existing chamber signing scripts apply unchanged | **Unchecked** |
| Windows Authenticode | After macOS |
| Universal macOS (arm64 + x64) | Required for ship; not built this session |

## Done when

A downloaded build launches on a machine that never had it, past Gatekeeper, with a publishable SHA-256.

## This session

Dev launch via `./scripts/code.sh` works. **No signed artifact produced.** W6 remains open for Captain + signing credentials.
