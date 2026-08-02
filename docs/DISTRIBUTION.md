# Distribution (W8)

## Stranger path (target)

1. Download a release build from the JourdanLabs download page (URL TBD at first public ship).
2. Verify **SHA-256** against the published checksums file.
3. Read **[HONEST_LIMITS.md](HONEST_LIMITS.md)** — first-class, not a footnote.
4. Install / open past Gatekeeper (W6 signed + notarised macOS build).

## Update channel

| Decision | **None for v0** |
|----------|------------------|
| Why | No update server stood up; silent auto-update to a Microsoft endpoint would be wrong |
| Revisit | When a JourdanLabs update feed exists |

## Release notes

Ship notes must include:

- Upstream pin SHA
- Write-gate coverage summary + link to HONEST_LIMITS
- Known escapes (child_process, etc.)
- omnis-key version compatibility

## Checksums

Publish `SHA256SUMS` next to every artifact. Never ship without a hash.

## Status

| Item | State |
|------|--------|
| Download page | pending first signed build |
| SHA-256 publish path | documented; not live until W6 artifact |
| Honest-limits page | **live in-repo** (`docs/HONEST_LIMITS.md`) |
| Update channel | **explicit none** |
