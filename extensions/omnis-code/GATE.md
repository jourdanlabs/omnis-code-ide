# LUCCA → PAN · Gate packet, OMNIS CODE for VS Code

**Date:** 2026-08-01 · **Builder:** Lucca 🔧🔑 · **Gate:** Pan 🐦‍⬛🔑
**Commit:** `52b79c7` · **Artifact:** `omnis-code-0.1.0.vsix` (17 files, 28.43 KB)

---

## 0 — Validate cold

Everything below is a **claim to check**, not a result to accept. I built this,
so my passing tests are not the gate — they are the thing being gated.

Run your own probes before reading my test output. `git log -p` and my commit
messages contain my conclusions; if you read them first, leg two collapses into
leg one.

Two suites exist and you should treat both as suspect until you have broken them:

```bash
npm test          # 65 unit tests
npm run test:host # 12 tests inside a real extension host
```

🔴 **`code --extensionTestsPath` detaches on macOS and exits 0 having run
nothing.** Drive `Contents/MacOS/Electron` directly — `npm run test:host` does.
An exit 0 from the `code` shim proves nothing. This nearly fooled me.

---

## 1 — Deltas from your brief

These are corrections I made against verified engine behaviour. **Verify each
independently — if any is wrong, the code built on it is wrong.**

**1 · The parser trap is inverted.** `receipts status --json` emits pure JSON:
`{schemaVersion, command, ok, code, data}`. The `TOKEN {json}` shape you found
is the **no-flag** form. `receipts verify` also accepts `--json` (undocumented
in the brief). I always pass `--json` and parse the envelope, with a tolerant
fallback for the legacy shape.

**2 · There are four chain states, not three.** `EMPTY_NOT_YET_EVIDENCED`
returns `ok:false` and **exit 3**, identical to INVALID and UNSAFE.

```
RECEIPT_CHAIN_VALID       ok:true   exit 0
RECEIPT_CHAIN_INVALID     ok:false  exit 3   ← tampered
RECEIPT_STATE_UNSAFE      ok:false  exit 3   ← permissions
EMPTY_NOT_YET_EVIDENCED   ok:false  exit 3   ← fresh install
```

Branching on `ok` or the exit code alone tells every new user their chain was
tampered with. I branch on `code`. **Probe this on a fresh `JCODE_HOME`.**

**3 · The UNSAFE remedy is the directory chain, not the file.** The ledger file
was already `0600`; `chmod 700` on `$JCODE_HOME`, `state/`, `state/omnis-key/`
flipped UNSAFE → VALID.

**4 · 🔴 The CLAIM ledger does not redact the way the RECEIPT ledger does.**
`verification.evidence` carries the full `command` argv, `stdout_excerpt`,
`stderr_excerpt`, and an absolute `cwd`. The receipt ledger redacts at the
source; the claim ledger does not. I read exactly two scalars out of it
(`verifier`, `exit_code`) and drop everything else. **This is the highest-risk
finding in the build — probe it hard.**

**5 · Three flags a turn must never emit.** `--provider` **defaults to `auto`**,
which is ambient discovery — so omitting it violates the stated position as
surely as passing it. Also `--receipt-full-argv` (engine-documented DANGEROUS:
raw argv into the plaintext ledger) and `--no-receipts`. All three are enforced
in one place, `buildTurnArgs`.

**6 · `crucible-scan` exits 0 on a bad argument.** `crucible-scan --help` prints
`✗ not a directory: --help` and still exits 0. Success is never inferred from
its exit code.

---

## 2 — Where I refused to build what the brief asked for

**§3.3 CAIRN ask/answer panel — not built. Deliberate.**

VS Code lets an extension publish MCP *server definitions*
(`lm.registerMcpServerDefinitionProvider`). It gives extensions **no MCP client
API**. A panel would have to re-implement the transport, and any answer it
rendered while CAIRN Studio was down would be fabricated — the exact failure
your §4.2 forbids. CAIRN Studio was not running when I checked
(`127.0.0.1:4611` refused every probe), so I could not have verified a panel
against it either.

I registered CAIRN natively over MCP and let the chat surface own the asking.
This is stated as a limit in the README rather than hidden.

**If you disagree, this is the decision to overturn.** It is the one place I
substituted my judgment for your spec.

---

## 3 — Your gate criteria, and where to aim

| # | Criterion | Where to aim |
|---|---|---|
| 1 | Live chain, real repo | Run a turn yourself. Do not reuse mine. |
| 2 | 🔴 Tamper probe | Flip a byte in a ledger **copy** under an isolated `JCODE_HOME`. Panel must show INVALID + exit 3 and **withhold entries**. |
| 3 | Engine-down probe | Point `omnisCode.enginePath` at a nonexistent file. |
| 4 | Secret probe | Run a turn containing a credential, then `grep -r` the **packaged vsix**, not just the source. |
| 5 | Refusal render | `claims verify --refuse-demo`. Check the **icon id**, not the wording. |
| 6 | Overclaim sweep | There is an automated sweep in `overclaim.test.ts` — **it is mine, so distrust it.** Read the README yourself. |
| 7 | Fake-green + mutation | See below. |

### On criterion 7 — I already caught myself once

My first redaction test passed while `argv_full` was added to the allowlist. The
row builder is a *second* allowlist that masked it, so the test was green for
the wrong reason. Fixed by asserting the exported constant directly.

Separately, I broke `receiptsView.ts` mid-mutation and the suite still passed
24/24 — the entries-gating invariant had **no coverage at all** because it lived
in a `vscode`-importing file no unit test can load. Extracted to
`mayRenderEntries()` and covered.

**Assume there are more of these.** Mutations I ran and confirmed fail:

```
empty→invalid · allowlist widened · argv guard removed · basename removed
unknown-code→valid · entries-gate removed · README overclaim · tagline drift
```

Try ones I did not think of.

---

## 4 — Honest status

- P1–P5 built. 65 unit + 12 in-host passing **on my machine, by my tests**.
- Packaged and installed locally as `jourdanlabs.omnis-code@0.1.0`.
- **Not published** to Open VSX or MS Marketplace. Needs publisher tokens.
- **No git remote.** Nothing has left this laptop.
- Criterion 5 of your §5 — "installs clean on a machine that isn't Captain's" —
  **is unproven.** I only have this machine.

Extension observes. Fork gates. I did not write the second sentence anywhere in
the product.

— Lucca 🔧🔑
