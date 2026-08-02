"use strict";
/**
 * OMNIS CODE turn construction. Pure — no `vscode`, no I/O.
 *
 * ── Three flags this extension must never emit ──────────────────────────────
 * Verified against `omnis-code run --help`, omnis-key 0.1.0:
 *
 *  --provider auto        `auto` is ambient provider discovery. The product's
 *                         stated position is explicit provider selection, and
 *                         the flag DEFAULTS to auto — so omitting it is just as
 *                         wrong as passing it. We always pass an explicit one.
 *  --receipt-full-argv    The engine calls this DANGEROUS: it writes raw bash
 *                         argv into the plaintext ledger. It is off by default
 *                         and this extension never turns it on.
 *  --no-receipts          Opts out of receipting the very thing we exist to show.
 *
 * buildTurnArgs is the single place a turn command line is constructed, so these
 * rules are enforceable by one test rather than by vigilance.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AmbientProviderError = exports.FORBIDDEN_PROVIDER = exports.FORBIDDEN_FLAGS = void 0;
exports.buildTurnArgs = buildTurnArgs;
exports.parseAuthStatus = parseAuthStatus;
exports.availableProviders = availableProviders;
exports.parseNdjsonChunk = parseNdjsonChunk;
exports.FORBIDDEN_FLAGS = ['--receipt-full-argv', '--no-receipts'];
/** `auto` means "discover a provider ambiently" and is never acceptable. */
exports.FORBIDDEN_PROVIDER = 'auto';
class AmbientProviderError extends Error {
    constructor() {
        super('Provider must be chosen explicitly. OMNIS CODE does not auto-detect credentials.');
        this.name = 'AmbientProviderError';
    }
}
exports.AmbientProviderError = AmbientProviderError;
function buildTurnArgs(opts) {
    const provider = opts.provider?.trim();
    if (!provider || provider === exports.FORBIDDEN_PROVIDER) {
        throw new AmbientProviderError();
    }
    const args = ['run', '--ndjson', '--provider', provider];
    if (opts.model?.trim()) {
        args.push('--model', opts.model.trim());
    }
    if (opts.cwd?.trim()) {
        args.push('--cwd', opts.cwd.trim());
    }
    // Message last: it is a positional argument.
    args.push(opts.message);
    return args;
}
/**
 * Parse `omnis-code auth status` (tab-separated). We surface only providers the
 * user has already configured — the picker never implies we found a credential
 * they did not deliberately set up.
 */
function parseAuthStatus(stdout) {
    const rows = [];
    for (const line of stdout.split('\n')) {
        const cols = line.split('\t');
        if (cols.length < 3) {
            continue;
        }
        const id = (cols[0] ?? '').trim();
        const state = (cols[1] ?? '').trim();
        if (!/^[a-z0-9-]+$/.test(id)) {
            continue;
        }
        rows.push({ id, available: state === 'available', method: (cols[2] ?? '').trim() });
    }
    return rows;
}
function availableProviders(stdout) {
    return parseAuthStatus(stdout).filter((p) => p.available);
}
/**
 * Parse NDJSON stream chunks. Unparseable lines are dropped rather than shown
 * raw — a malformed frame could contain anything.
 */
function parseNdjsonChunk(chunk) {
    const events = [];
    for (const line of chunk.split('\n')) {
        const t = line.trim();
        if (!t) {
            continue;
        }
        try {
            const o = JSON.parse(t);
            const type = typeof o.type === 'string' ? o.type : 'unknown';
            const text = typeof o.text === 'string'
                ? o.text
                : typeof o.content === 'string'
                    ? o.content
                    : undefined;
            events.push({ type, ...(text !== undefined ? { text } : {}) });
        }
        catch {
            // Not a complete JSON frame yet, or not one at all. Skip it.
        }
    }
    return events;
}
//# sourceMappingURL=turn.js.map