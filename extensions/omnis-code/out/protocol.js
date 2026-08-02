"use strict";
/**
 * OMNIS KEY CLI protocol — pure parsing. No `vscode` import, no I/O.
 *
 * Every verdict rendered by this extension originates here, from real engine
 * output. Nothing in this file may invent, cache, or default a chain state.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.classify = classify;
exports.parseEnvelope = parseEnvelope;
exports.mayRenderEntries = mayRenderEntries;
exports.truncateHash = truncateHash;
exports.unsafeRemedy = unsafeRemedy;
/**
 * Codes that all exit 3 with ok:false but mean entirely different things.
 *
 * This mapping is the single most safety-critical table in the extension.
 * `EMPTY_NOT_YET_EVIDENCED` is a healthy fresh install; rendering it as
 * INVALID would tell every new user their chain was tampered with.
 * Branch on `code` — never on `ok` or the exit status alone.
 */
function classify(env) {
    switch (env.code) {
        case 'RECEIPT_CHAIN_VALID': {
            const d = env.data;
            if (!d || typeof d.entryCount !== 'number' || !d.headSha256) {
                return {
                    kind: 'unparseable',
                    detail: `engine reported ${env.code} without a usable payload`,
                };
            }
            return {
                kind: 'valid',
                code: env.code,
                entryCount: d.entryCount,
                headSha256: d.headSha256,
            };
        }
        case 'RECEIPT_CHAIN_INVALID':
            return { kind: 'invalid', code: env.code };
        case 'RECEIPT_STATE_UNSAFE':
            return { kind: 'unsafe', code: env.code };
        case 'EMPTY_NOT_YET_EVIDENCED':
            return { kind: 'empty', code: env.code };
        default:
            // An unknown code is not a verdict. Say what we got; claim nothing.
            return {
                kind: 'unparseable',
                detail: `unrecognized engine code ${JSON.stringify(env.code)}`,
            };
    }
}
/**
 * Parse one `--json` stdout payload.
 *
 * The engine's no-flag output is `CODE {json}` (a status token, a space, then
 * JSON). We always pass `--json`, which emits pure JSON — but we accept the
 * token-prefixed form too so a version drift degrades into a correct read
 * rather than a fabricated one.
 */
function parseEnvelope(stdout) {
    const text = stdout.trim();
    if (!text) {
        return null;
    }
    const direct = tryParse(text);
    if (direct) {
        return direct;
    }
    // Tolerated legacy shape: `RECEIPT_CHAIN_VALID {"state":"VALID",...}`
    const space = text.indexOf(' ');
    if (space > 0) {
        const token = text.slice(0, space);
        const rest = tryParse(text.slice(space + 1));
        if (rest) {
            return rest;
        }
        const bare = tryParseRaw(text.slice(space + 1));
        if (bare && typeof bare === 'object') {
            const d = bare;
            return {
                schemaVersion: 0,
                command: 'unknown',
                ok: token === 'RECEIPT_CHAIN_VALID',
                code: token,
                data: {
                    state: String(d.state ?? ''),
                    entryCount: Number(d.entryCount ?? 0),
                    headSha256: d.headSha256 ?? null,
                },
            };
        }
    }
    return null;
}
function tryParse(text) {
    const raw = tryParseRaw(text);
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const o = raw;
    if (typeof o.code !== 'string' || typeof o.ok !== 'boolean') {
        return null;
    }
    return {
        schemaVersion: Number(o.schemaVersion ?? 0),
        command: String(o.command ?? 'unknown'),
        ok: o.ok,
        code: o.code,
        data: o.data ?? null,
    };
}
function tryParseRaw(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
/**
 * May the panel render ledger entries under this state?
 *
 * Only under an engine-issued RECEIPT_CHAIN_VALID. Entries are read from disk
 * for display and carry no verdict of their own; showing them beside a broken,
 * unsafe, empty, or unavailable verdict would let the rows imply a soundness
 * the engine has not granted.
 *
 * This lives here, in a `vscode`-free module, specifically so it is testable.
 */
function mayRenderEntries(state) {
    return state.kind === 'valid';
}
/** Short, copyable hash for display. Full value always available on hover. */
function truncateHash(sha, head = 8) {
    const bare = sha.startsWith('sha256:') ? sha.slice(7) : sha;
    return bare.length <= head ? bare : `${bare.slice(0, head)}…`;
}
/**
 * The remedy for RECEIPT_STATE_UNSAFE.
 *
 * Verified 2026-08-01: the engine refuses when the *directory chain* is group-
 * or world-accessible. The ledger file itself was already 0600; chmod 700 on
 * the enclosing directories flipped UNSAFE → VALID. Installs predating the
 * creation-path fix still hit this, so the panel must state the fix, not just
 * show a red state.
 */
function unsafeRemedy(jcodeHome) {
    return {
        explanation: 'OMNIS KEY refuses to trust a receipt ledger whose directories are readable by other users on this machine. ' +
            'This is the engine working correctly. Restrict the directory chain, then refresh.',
        command: `chmod 700 "${jcodeHome}" "${jcodeHome}/state" "${jcodeHome}/state/omnis-key"`,
    };
}
//# sourceMappingURL=protocol.js.map