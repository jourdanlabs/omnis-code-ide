# Preinstalled from Lucca's packaged VSIX

- **Source artifact:** `omnis-code-0.1.0.vsix` (Lucca · jourdanlabs)
- **Not vendored source** — packaged extension only; Lucca's git repo is never touched from this fork
- **Do not edit here to change product behaviour** — request changes from Lucca's extension repo

## Fork packaging adaptations (documented)

| Change | Why |
|--------|-----|
| `activationEvents`: `[]` → `["onStartupFinished"]` | Explicit empty array disables VS Code's generated `onView:*` events; first-launch panels would not appear. Request Lucca ship this in the next VSIX so the fork delta goes away. |

This directory exists so a fresh OMNIS CODE IDE install already has identity surfaces (receipts · claims · crucible).
