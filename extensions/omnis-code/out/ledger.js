"use strict";
/**
 * Display-only reader for the local receipt ledger. No `vscode` import.
 *
 * ── Honesty boundary ────────────────────────────────────────────────────────
 * This module reads `receipts.jsonl` directly because omnis-key 0.1.0 exposes
 * no `receipts list` command. That read is for DISPLAY ONLY.
 *
 * It must never produce a chain verdict. Verdicts come from the engine, via
 * protocol.classify(). The view layer renders these rows only when the engine
 * has independently reported RECEIPT_CHAIN_VALID. If we parsed a hash chain
 * ourselves and called it valid, that would be exactly the fabricated verdict
 * the product exists to prevent.
 *
 * ── Redaction ───────────────────────────────────────────────────────────────
 * The ledger redacts by design: `argv_program` + `argv_sha256`, never
 * `argv_full`. This module preserves that with a strict ALLOWLIST. A denylist
 * would silently leak the first field a future engine version adds.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVIDENCE_ALLOWLIST = void 0;
exports.toSafeRow = toSafeRow;
exports.parseLedger = parseLedger;
/**
 * Fields we are willing to read out of `evidence`. Verified against
 * omnis-key 0.1.0 receipt protocol `jourdanlabs.omnis-receipt.v1`.
 *
 * Deliberately excluded: anything not on this list, including any future
 * `argv_full`, `stdout`, `stderr`, `content`, `env`, or `token` field.
 */
exports.EVIDENCE_ALLOWLIST = new Set([
    'argv_program',
    'tool',
    'target',
    'exit_code',
    'content_before_sha256',
    'content_after_sha256',
]);
/** Values matching a bare hash are safe to abbreviate and show. */
function shortHash(v) {
    if (typeof v !== 'string') {
        return null;
    }
    const bare = v.startsWith('sha256:') ? v.slice(7) : v;
    return /^[0-9a-f]{64}$/i.test(bare) ? `${bare.slice(0, 4)}…` : null;
}
/**
 * `argv_program` is a bare program name by engine contract (`ls`, `node`).
 * We still refuse anything that looks like it carries arguments or a path,
 * so a contract violation upstream cannot become a leak downstream.
 */
function safeProgram(v) {
    if (typeof v !== 'string') {
        return null;
    }
    return /^[A-Za-z0-9_.-]{1,64}$/.test(v) ? v : null;
}
/** Basenames only — never a full path, which can carry user identity. */
function safeTarget(v) {
    if (typeof v !== 'string' || v.length > 128) {
        return null;
    }
    const base = v.split('/').pop() ?? '';
    return /^[A-Za-z0-9_.\- ]{1,128}$/.test(base) ? base : null;
}
function toSafeRow(raw) {
    const ev = {};
    for (const [k, v] of Object.entries(raw.evidence ?? {})) {
        if (exports.EVIDENCE_ALLOWLIST.has(k)) {
            ev[k] = v;
        }
    }
    const program = safeProgram(ev.argv_program);
    const target = safeTarget(ev.target);
    const label = program ?? target ?? safeProgram(ev.tool) ?? '—';
    let detail = '';
    const before = shortHash(ev.content_before_sha256);
    const after = shortHash(ev.content_after_sha256);
    if (before && after) {
        detail = `${before} → ${after}`;
    }
    else if (typeof ev.exit_code === 'number') {
        detail = `exit ${ev.exit_code}`;
    }
    return {
        sequence: raw.sequence,
        kind: typeof raw.kind === 'string' ? raw.kind : 'unknown',
        label,
        detail,
        exitCode: typeof ev.exit_code === 'number' ? ev.exit_code : undefined,
    };
}
/** Parse JSONL into safe rows, newest first. Malformed lines are skipped, not guessed at. */
function parseLedger(contents) {
    const rows = [];
    for (const line of contents.split('\n')) {
        const t = line.trim();
        if (!t) {
            continue;
        }
        try {
            const raw = JSON.parse(t);
            if (typeof raw.sequence === 'number') {
                rows.push(toSafeRow(raw));
            }
        }
        catch {
            // A malformed line is not a receipt. The engine's verdict already
            // reflects any corruption; we simply do not render this row.
        }
    }
    return rows.sort((a, b) => b.sequence - a.sequence);
}
//# sourceMappingURL=ledger.js.map