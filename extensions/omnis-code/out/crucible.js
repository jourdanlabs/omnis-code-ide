"use strict";
/**
 * CRUCIBLE scan results. Pure — no `vscode`, no I/O beyond what callers pass in.
 *
 * ── CRUCIBLE is a report, not a linter ──────────────────────────────────────
 * A scan takes 30–150s and analyses a whole repository. Nothing here runs on
 * save or on keystroke. Findings are read from a STORED scan and always carry
 * the timestamp of the scan they came from — stale results presented as current
 * are the fabricated-verdict failure wearing a different costume.
 *
 * ── Exit codes are not a signal here ────────────────────────────────────────
 * Verified 2026-08-01: `crucible-scan --help` prints "✗ not a directory: --help"
 * and still exits 0. We therefore never infer success from the exit code; we
 * require a parseable pipeline.json on disk.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STALE_AFTER_MS = void 0;
exports.parseScanTimestamp = parseScanTimestamp;
exports.parsePipeline = parsePipeline;
exports.ageLabel = ageLabel;
exports.isStale = isStale;
exports.newestScanDir = newestScanDir;
const SEVERITIES = new Set(['CRIT', 'HIGH', 'MED', 'LOW']);
/** Reject absolute paths and traversal — a finding path becomes a file link. */
function safeRelPath(v) {
    if (typeof v !== 'string' || !v || v.length > 512) {
        return null;
    }
    if (v.startsWith('/') || v.startsWith('~') || v.includes('..')) {
        return null;
    }
    return v;
}
function safeText(v, max = 500) {
    if (typeof v !== 'string') {
        return '';
    }
    const t = v.slice(0, max);
    return /sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|Bearer\s+\S+/i.test(t) ? '[redacted]' : t;
}
/**
 * Scan directories are named `<repo>-<YYYYMMDD>-<HHMMSS>`.
 * Returns null rather than guessing when the name does not match — an unknown
 * scan time must read as unknown, never as "now".
 */
function parseScanTimestamp(dirName) {
    const m = /-(\d{8})-(\d{6})$/.exec(dirName);
    if (!m) {
        return null;
    }
    const [, d, t] = m;
    const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function parsePipeline(scanId, contents) {
    let raw;
    try {
        raw = JSON.parse(contents);
    }
    catch {
        return null;
    }
    const target = (raw.target ?? {});
    const leg1 = (raw.leg1_vantage ?? {});
    if (typeof leg1.verdict !== 'string') {
        return null;
    }
    const issues = Array.isArray(leg1.issues) ? leg1.issues : [];
    const findings = [];
    for (const i of issues) {
        const o = i;
        const file = safeRelPath(o.file);
        if (!file) {
            continue;
        }
        const sev = typeof o.severity === 'string' ? o.severity.toUpperCase() : '';
        findings.push({
            severity: (SEVERITIES.has(sev) ? sev : 'UNKNOWN'),
            file,
            line: typeof o.line === 'number' && o.line > 0 ? o.line : 1,
            description: safeText(o.description),
            ...(typeof o.fix === 'string' ? { fix: safeText(o.fix) } : {}),
        });
    }
    return {
        scanId,
        scannedAt: parseScanTimestamp(scanId),
        // NOTE: target.root_path is an absolute path. Deliberately not read.
        targetName: safeText(target.name, 128) || scanId,
        verdict: safeText(leg1.verdict, 40),
        score: typeof leg1.score === 'number' ? leg1.score : null,
        summary: safeText(leg1.summary, 1000),
        filesAnalyzed: typeof leg1.files_analyzed === 'number' ? leg1.files_analyzed : null,
        findings,
        ...(typeof raw.pipeline_receipt_sha256 === 'string'
            ? { receiptSha256: raw.pipeline_receipt_sha256 }
            : {}),
    };
}
/** Human age string. Always shown next to findings so nothing reads as live. */
function ageLabel(scannedAt, now) {
    if (!scannedAt) {
        return 'scan time unknown';
    }
    const mins = Math.floor((now.getTime() - scannedAt.getTime()) / 60000);
    if (mins < 1) {
        return 'scanned just now';
    }
    if (mins < 60) {
        return `scanned ${mins}m ago`;
    }
    const hours = Math.floor(mins / 60);
    if (hours < 24) {
        return `scanned ${hours}h ago`;
    }
    return `scanned ${Math.floor(hours / 24)}d ago`;
}
/**
 * A scan older than this is called out explicitly rather than shown plainly.
 * Findings do not expire, but the user must never mistake them for current.
 */
exports.STALE_AFTER_MS = 24 * 60 * 60 * 1000;
function isStale(scannedAt, now) {
    return !scannedAt || now.getTime() - scannedAt.getTime() > exports.STALE_AFTER_MS;
}
/** Newest scan directory for a repo name, by the timestamp in the directory name. */
function newestScanDir(dirNames, repoName) {
    const mine = dirNames
        .filter((d) => d.startsWith(`${repoName}-`))
        .map((d) => ({ d, t: parseScanTimestamp(d) }))
        .filter((x) => x.t)
        .sort((a, b) => b.t.getTime() - a.t.getTime());
    return mine[0]?.d ?? null;
}
//# sourceMappingURL=crucible.js.map