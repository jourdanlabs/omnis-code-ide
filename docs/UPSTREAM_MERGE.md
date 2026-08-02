# Upstream merge strategy (W7 / W7-A)

## Pin

| Field | Value |
|-------|--------|
| **Upstream remote** | `upstream` → `https://github.com/microsoft/vscode.git` |
| **Pinned base** | `1b2f25580d1eaaeea7d18a3968565c818177d8e1` (v1.132.0) — see `UPSTREAM.md` |
| **When we move** | After a **merge-work** branch passes the agent loop **and a human releases** |

Automation does **not** rewrite `UPSTREAM.md`. Pin promotion is a release decision.

## The loop (agent)

```
1. poll upstream for movement (or synthesise if tip unchanged)
2. merge onto omnis/merge-work/<stamp>   — never a release branch
3. any conflict?                        → STOP · report · human resolves
4. build (npm run compile)
5. canary-can-fail                       → prove canary is not decoration
6. canary                                → patch still takes as live code
7. write-gate-can-fail                   → prove probe is not decoration
8. write-gate probe                      → healthy · tampered · engine-gone
9. report                                → HUMAN REVIEW REQUIRED | BLOCKED
```

**Driver:**

```bash
node scripts/omnis-merge-agent.mjs              # fetch + merge, or synthetic if tip quiet
node scripts/omnis-merge-agent.mjs --synthetic  # force synthetic upstream commits
node scripts/omnis-merge-agent.mjs --demo-conflict  # prove owned conflict stops the loop
```

**Reports land in `.omnis-merge-agent/reports/` (gitignored)** — or `OMNIS_MERGE_REPORT_DIR`.  
They must **not** be written into tracked paths. A W7-A gate finding: writing
`docs/evidence/merge-agent/merge-report-*.md` dirtied the tree and made the next
run block forever on "working tree not clean." Monthly cron would work once, then die.

## Files we own (conflict → human)

| Path | Why |
|------|-----|
| `product.json` | Branding, galleries, app IDs |
| `src/vs/workbench/api/node/extHostExtensionService.ts` | Interceptor + ESM hooks + factory registration |
| `src/vs/workbench/api/node/omnisWriteGate.ts` | Gate (ours entirely) |
| `README.md`, `BUILDING.md`, `UPSTREAM.md`, `docs/HONEST_LIMITS.md`, … | Product story |
| `extensions/omnis-code/**` | Preinstalled Lucca VSIX payload |
| `scripts/omnis-*` | Probes, canary, merge agent |

Everything else: prefer upstream. **The agent still stops on unowned conflicts** (fail closed — no silent auto-resolve).

## The four rules

1. **Fail closed.** Ambiguity → stop and report. Never “probably fine.”
2. **Never self-certify.** Verdict is always `MERGE CLEAN — HUMAN REVIEW REQUIRED` or `BLOCKED: …`. Evidence, not a stamp.
3. **Never touch credentials.** No signing, notarization, publishing, marketplace tokens.
4. **Never push to a release branch.** Work branches only (`omnis/merge-work/*`). Promotion is human.

## Canary (load-bearing)

| Script | Role |
|--------|------|
| `scripts/omnis-interceptor-canary.mjs` | Attachment still present as **live code** (comments stripped) |
| `scripts/omnis-canary-can-fail.mjs` | Removes registration → canary **must** fail → restore → must pass |
| `scripts/omnis-write-gate-probe.mjs` | healthy / tampered / engine-gone |
| `scripts/omnis-write-gate-can-fail.mjs` | Guts compiled gate → probe **must** fail → restore |

**A canary that cannot fail is decoration.** If `canary-can-fail` reports PASS while the patch is removed, **discard the entire automation run.**

```bash
node scripts/omnis-canary-can-fail.mjs
node scripts/omnis-write-gate-can-fail.mjs   # needs compiled out/
node scripts/omnis-interceptor-canary.mjs
node scripts/omnis-write-gate-probe.mjs
```

## Standing caution — green months are not forever

Upstream may refactor `NodeModuleRequireInterceptor` such that:

- our patch **applies cleanly**, and
- the canary still sees its markers, but
- **behaviour underneath changed** (e.g. factories no longer wrap third-party requires).

The canary catches that **only if the canary is good.** Deciding *“our approach no longer works and needs rethinking”* is a **gate call**, not a merge call. No streak of green reports substitutes for a human reading an upstream interceptor refactor.

Do not mistake automated merge hygiene for proof that the **design** remains sound.

## Cadence

| | |
|--|--|
| **Agent** | Poll / merge-work / evidence (cheap) |
| **Human** | Review report + release (the remaining cost) |
| **Abort** | Canary red, canary-can-fail red, probe red, owned conflict, credential surface, release-branch write |

Cheap treadmill ≠ product demand. §15 of the fork packet still stands.

## Measured merges

Agent JSON + markdown reports: **`.omnis-merge-agent/reports/`** (local, gitignored).  
Historical copies may exist under `docs/evidence/merge-agent/` from early runs; those patterns are gitignored so leftovers cannot self-block.

| Field | Value |
|-------|--------|
| From SHA | see latest measured-*.json |
| To SHA | see latest measured-*.json |
| Mode | real \| synthetic |
| Wall time | see report timestamps |
| Conflicts | none \| list |
| Human release | pending until Captain promotes |
