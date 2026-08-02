# Residuals — honest unfinished surface

**Pan gate W1–W8:** ACCEPTED 2026-08-02 (packet `PAN-GATE-OMNIS-IDE-W1-W8-2026-08-02.md`).  
One finding (webview CDN) — addressed below / in `HONEST_LIMITS.md`.

| Item | Workstream | State |
|------|------------|--------|
| Custom app icons (still upstream `code.icns` / Code OSS artwork) | W4 | **Open** |
| Crash reporter `_companyName=Microsoft` in Electron helper | W4 | **Open** |
| Welcome / walkthrough de-Microsoft | W4 | **Open** |
| Copilot / defaultChatAgent surfaces still in tree | W4 | Softened identity only |
| Open VSX install through running app UI | W5 | Key present; cold UI install not proven |
| MCP gallery endpoint | W5 | **Deferred** — `MCP_GALLERY.md` |
| Signed + notarised macOS | W6 | **Captain credentials** |
| Windows package | W6 | **Open** |
| Real upstream tip merge (Microsoft moved) | W7 | Synthetic + agent proven; tip still at pin |
| Public download page + SHA | W8 | In-repo docs; no public artifact |
| Clean-checkout build from zero (empty `out/`) | W1 | Pan: launch verified; cold zero-cache build elsewhere **unverified** |
| Extension-host e2e refuse in UI | W2 | Standalone + Pan independent probe PASS; UI residual |
| Browser workbench `vscode-cdn.net` hardcoded fallback | W4/web | Source residual if web ship is ever claimed |
| `createWriteStream` / fd-level gaps | W2 | `WRITE_GATE_COVERAGE.md` |

## Closed this gate cycle

| Item | Disposition |
|------|-------------|
| `product.json` `webviewContentExternalBaseUrlTemplate` → vscode-cdn.net Insiders SHA | **Removed** + documented in `HONEST_LIMITS.md` |
| W7 agent self-block on dirty evidence tree | **Fixed** — `.omnis-merge-agent/reports/` gitignored |
| Write gate on disk (Pan independent probe) | **CLEARED** — not only Toph’s probe |

## Proven (do not re-litigate without new evidence)

| Item | Evidence |
|------|----------|
| W2 refuse holds on disk | Pan independent `readFileSync` of file after tamper |
| Canary can fail (incl. comment-fake) | Pan four probes + stripComments |
| Merge agent loop | Synthetic merge + conflict stop + consecutive runs |
| Branding AppIds / MS licence attribution | Pan cold read of product.json |
