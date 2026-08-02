# OMNIS CODE — AI agent receipts

**Proves what it did, or refuses to say.**

Your coding agent edits files and runs commands. This extension shows you the
tamper-evident receipt chain those actions leave behind, inside the editor.

---

## What this extension does

**Receipts** — the live chain state (`RECEIPT_CHAIN_VALID`, `RECEIPT_CHAIN_INVALID`,
`RECEIPT_STATE_UNSAFE`, `EMPTY_NOT_YET_EVIDENCED`) with entry count and head hash;
the recorded receipts themselves; on-demand verification showing the engine's real
output and exit code; and a stated remedy for an unsafe state directory rather than
a bare red dot.

**Claims** — verdicts in the engine's own vocabulary: `CERTIFIED`, `REFUTED`,
`REFUSED_NO_VERIFIER`, `REFUSED_UNRESOLVED`, `UNGROUNDED`.

> A refusal is a **successful** outcome. When the ledger answers
> `REFUSED_NO_VERIFIER` to *"this is faster"*, it is declining to assert something
> it cannot ground. That renders as a verdict with its own mark — never an error
> icon, never a warning triangle. Only `REFUTED` — a claim the codebase actually
> disproved — reads as a failure.

**Turns** — run one OMNIS CODE turn from the editor and watch the receipt appear.
The panel follows the ledger, so a turn run in a terminal outside the editor moves
it too.

**CRUCIBLE** — an explicit, cancellable repository scan, and a results view over
the stored scan.

**CAIRN** — contributed to VS Code natively over MCP.

## What this extension does not do

**An extension can observe. It cannot gate.**

This extension does not block writes, does not intercept your agent, and does not
stop anything from touching your disk. The VS Code extension API gives no extension
that power — not this one, not any other. It reads the receipt chain and shows you
what it says.

If the chain is broken, you will see that it is broken. Nothing was prevented.
That distinction is the honest one, and we would rather state it plainly than let
the panel imply otherwise.

**There is no CAIRN ask/answer panel.** VS Code lets an extension publish MCP
*server definitions*, not call MCP tools itself. A panel would have to
re-implement the transport, and anything it displayed while CAIRN Studio was down
would be invented. So the extension registers CAIRN and lets the chat surface do
the asking.

**CRUCIBLE is a report, not a linter.** A scan reads a whole repository and takes
30–150 seconds, so nothing runs on save or on keystroke. Results come from the last
stored scan and always carry its age. A scan whose timestamp cannot be read says
so, rather than appearing current.

## The four states

Three of these exit non-zero, and they do not mean the same thing:

| State | Meaning |
|---|---|
| `RECEIPT_CHAIN_VALID` | Every entry hashes to its successor. |
| `RECEIPT_CHAIN_INVALID` | An entry was altered after it was written. |
| `RECEIPT_STATE_UNSAFE` | The ledger directory is readable by other users; the engine declines to trust it. The panel shows the exact fix. |
| `EMPTY_NOT_YET_EVIDENCED` | Nothing recorded yet. **A new install, not a broken chain.** |

Receipt entries are shown only under `RECEIPT_CHAIN_VALID`. Under any other state
they are withheld, because they carry no verdict of their own.

## Requirements

The `omnis-key` engine must be installed.

VS Code launched from the Dock or Finder on macOS does not inherit your shell
`PATH`, so a user-local install at `~/.local/bin` may be invisible to it. If the
panel reports the engine unreachable, set:

```jsonc
"omnisCode.enginePath": "/Users/you/.local/bin/omnis-key"
```

## Privacy

Receipts are local and redacted at the source: the ledger records a program name
and a hash of its arguments, never the full command line. This extension applies a
second allowlist on top of that and never renders, logs, or caches raw commands,
file contents, or paths. Nothing is transmitted anywhere.

## License

MIT, © 2026 JourdanLabs. See the `LICENSE` and `NOTICE.md` files.

This extension contains no jcode or OMNIS KEY source; it invokes the `omnis-key`
binary as a separate process.
