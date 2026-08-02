# Upstream pin

| Field | Value |
|-------|--------|
| **Upstream** | `microsoft/vscode` |
| **SHA** | `1b2f25580d1eaaeea7d18a3968565c818177d8e1` |
| **Short** | `1b2f25580` |
| **Version** | `1.132.0` |
| **License** | MIT |
| **Pinned** | 2026-08-01 (clone day) |

This file **must** match `git rev-parse HEAD` on the integration branch until the next deliberate upstream merge (see `docs/UPSTREAM_MERGE.md`).

```bash
git rev-parse HEAD
# expected: 1b2f25580d1eaaeea7d18a3968565c818177d8e1
```

Remote layout after fork setup:

| remote | URL |
|--------|-----|
| `upstream` | `https://github.com/microsoft/vscode.git` |
| `origin` | JourdanLabs fork (set when published) |
