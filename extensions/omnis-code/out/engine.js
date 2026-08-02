"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.candidateEnginePaths = candidateEnginePaths;
exports.resolveEnginePath = resolveEnginePath;
exports.jcodeHome = jcodeHome;
exports.ledgerPath = ledgerPath;
exports.setConfiguredEnginePath = setConfiguredEnginePath;
exports.runEngine = runEngine;
exports.resolveAgentPath = resolveAgentPath;
exports.runAgent = runAgent;
exports.streamAgent = streamAgent;
exports.resolveScannerPath = resolveScannerPath;
exports.streamScan = streamScan;
exports.readChain = readChain;
exports.verifyChain = verifyChain;
exports.readEntries = readEntries;
exports.watchLedger = watchLedger;
/**
 * Adapter over the omnis-key CLI. No `vscode` import — keeps it unit-testable
 * and portable into a Code-OSS fork unchanged.
 *
 * Rule: engine unreachable → say `unreachable`. Never a cached, defaulted, or
 * guessed state.
 */
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const protocol_1 = require("./protocol");
const ledger_1 = require("./ledger");
const TIMEOUT_MS = 10_000;
/**
 * GUI-launched editors on macOS do not inherit the login shell's PATH, so a
 * user-local install at ~/.local/bin is invisible even though it works in a
 * terminal. Probe the known locations rather than reporting a false
 * "engine not installed".
 */
function candidateEnginePaths(env = process.env) {
    const home = (0, node_os_1.homedir)();
    const out = [];
    if (env.OMNIS_CODE_ENGINE_PATH) {
        out.push(env.OMNIS_CODE_ENGINE_PATH);
    }
    out.push((0, node_path_1.join)(home, '.local', 'bin', 'omnis-key'), (0, node_path_1.join)(home, '.cargo', 'bin', 'omnis-key'), '/usr/local/bin/omnis-key', '/opt/homebrew/bin/omnis-key');
    return out;
}
function resolveEnginePath(configured) {
    if (configured && configured.trim()) {
        return (0, node_fs_1.existsSync)(configured) ? configured : null;
    }
    for (const p of candidateEnginePaths()) {
        if ((0, node_fs_1.existsSync)(p)) {
            return p;
        }
    }
    return null;
}
function jcodeHome(env = process.env) {
    return env.JCODE_HOME || (0, node_path_1.join)((0, node_os_1.homedir)(), '.jcode');
}
function ledgerPath(env = process.env) {
    return (0, node_path_1.join)(jcodeHome(env), 'state', 'omnis-key', 'receipts.jsonl');
}
function run(bin, args) {
    return new Promise((resolve) => {
        (0, node_child_process_1.execFile)(bin, args, { timeout: TIMEOUT_MS, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
            // A non-zero exit is product surface here, not a failure: exit 3 carries
            // RECEIPT_CHAIN_INVALID. Resolve with the code rather than throwing.
            const code = err && typeof err.code === 'number'
                ? (err.code)
                : err
                    ? null
                    : 0;
            resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code });
        });
    });
}
/**
 * The configured engine path, pushed in from the view layer so this module
 * stays free of any `vscode` import (and therefore unit-testable and portable
 * into a Code-OSS fork).
 */
let configuredEnginePath;
function setConfiguredEnginePath(p) {
    configuredEnginePath = p;
}
/** Generic invocation. Non-zero exits are returned, never thrown or swallowed. */
async function runEngine(args) {
    const bin = resolveEnginePath(configuredEnginePath);
    if (!bin) {
        return {
            stdout: '',
            stderr: '',
            exitCode: null,
            detail: 'omnis-key not found. Set "omnisCode.enginePath" (VS Code does not inherit your shell PATH on macOS).',
        };
    }
    const res = await run(bin, args);
    return {
        stdout: res.stdout,
        stderr: res.stderr,
        exitCode: res.code,
        detail: res.stdout.trim() ? undefined : firstLine(res.stderr.trim() || 'engine produced no output'),
    };
}
function resolveAgentPath() {
    for (const p of candidateEnginePaths()) {
        const agent = p.replace(/omnis-key$/, 'omnis-code');
        if ((0, node_fs_1.existsSync)(agent)) {
            return agent;
        }
    }
    return null;
}
/** Streams a long-running agent process, surfacing output as it arrives. */
/** One-shot agent invocation (e.g. `auth status`). */
async function runAgent(args) {
    const bin = resolveAgentPath();
    if (!bin) {
        return { stdout: '', stderr: '', exitCode: null, detail: 'omnis-code not found.' };
    }
    const res = await run(bin, args);
    return { stdout: res.stdout, stderr: res.stderr, exitCode: res.code };
}
function streamAgent(args, onData, cwd) {
    const bin = resolveAgentPath();
    if (!bin) {
        onData('omnis-code not found. Set "omnisCode.enginePath" to its directory.\n');
        return { done: Promise.resolve(null), cancel: () => undefined };
    }
    const child = (0, node_child_process_1.spawn)(bin, args, { cwd });
    child.stdout.on('data', (d) => onData(d.toString()));
    child.stderr.on('data', (d) => onData(d.toString()));
    const done = new Promise((resolve) => {
        child.on('close', (code) => resolve(code));
        child.on('error', (e) => {
            onData(`\n${e.message}\n`);
            resolve(null);
        });
    });
    return { done, cancel: () => child.kill() };
}
function resolveScannerPath() {
    for (const p of candidateEnginePaths()) {
        const s = p.replace(/omnis-key$/, 'crucible-scan');
        if ((0, node_fs_1.existsSync)(s)) {
            return s;
        }
    }
    return null;
}
/**
 * Long-running CRUCIBLE scan (30–150s). Streams progress, cancellable, and
 * never blocks. The exit code is reported but is NOT proof of success:
 * crucible-scan exits 0 even when given a bad argument.
 */
function streamScan(repoPath, onData) {
    const bin = resolveScannerPath();
    if (!bin) {
        onData('crucible-scan not found on this machine.\n');
        return { done: Promise.resolve(null), cancel: () => undefined };
    }
    const child = (0, node_child_process_1.spawn)(bin, [repoPath]);
    child.stdout.on('data', (d) => onData(d.toString()));
    child.stderr.on('data', (d) => onData(d.toString()));
    const done = new Promise((resolve) => {
        child.on('close', (code) => resolve(code));
        child.on('error', (e) => {
            onData(`\n${e.message}\n`);
            resolve(null);
        });
    });
    return { done, cancel: () => child.kill() };
}
async function readChain(enginePath) {
    if (!enginePath) {
        return {
            state: {
                kind: 'unreachable',
                detail: 'omnis-key not found. Set "omnisCode.enginePath" to its full path (VS Code does not inherit your shell PATH on macOS).',
            },
            exitCode: null,
            raw: '',
        };
    }
    const res = await run(enginePath, ['receipts', 'status', '--json']);
    const env = (0, protocol_1.parseEnvelope)(res.stdout);
    if (!env) {
        const detail = res.stderr.trim() || res.stdout.trim() || 'engine produced no output';
        return {
            state: { kind: 'unreachable', detail: firstLine(detail) },
            exitCode: res.code,
            raw: res.stdout,
        };
    }
    return { state: (0, protocol_1.classify)(env), exitCode: res.code, raw: res.stdout };
}
async function verifyChain(enginePath) {
    if (!enginePath) {
        return {
            state: { kind: 'unreachable', detail: 'omnis-key not found.' },
            exitCode: null,
            raw: '',
        };
    }
    const res = await run(enginePath, ['receipts', 'verify', '--json']);
    const env = (0, protocol_1.parseEnvelope)(res.stdout);
    if (!env) {
        return {
            state: {
                kind: 'unreachable',
                detail: firstLine(res.stderr.trim() || 'engine produced no output'),
            },
            exitCode: res.code,
            raw: res.stdout,
        };
    }
    return { state: (0, protocol_1.classify)(env), exitCode: res.code, raw: res.stdout };
}
/**
 * Entries for display. Returns [] on any read problem — the caller only ever
 * renders these under an engine-issued VALID verdict, so an empty list can
 * never masquerade as a healthy chain.
 */
async function readEntries(env = process.env) {
    try {
        return (0, ledger_1.parseLedger)(await (0, promises_1.readFile)(ledgerPath(env), 'utf8'));
    }
    catch {
        return [];
    }
}
function firstLine(s) {
    return s.split('\n')[0].slice(0, 300);
}
/**
 * Watch the receipt ledger and fire when it changes.
 *
 * We watch the containing directory rather than the file: the ledger may not
 * exist yet on a fresh install, and an atomic rewrite would break a watch bound
 * to the original inode. Debounced, because one append can emit several events.
 */
function watchLedger(onChange, env = process.env, debounceMs = 150) {
    const dir = (0, node_path_1.join)(jcodeHome(env), 'state', 'omnis-key');
    let timer;
    let watcher;
    const fire = () => {
        if (timer) {
            clearTimeout(timer);
        }
        timer = setTimeout(onChange, debounceMs);
    };
    try {
        watcher = (0, node_fs_1.watch)(dir, (_event, filename) => {
            if (!filename || filename.toString().startsWith('receipts.jsonl')) {
                fire();
            }
        });
    }
    catch {
        // No state directory yet. The panel still works; it just will not
        // auto-refresh until something creates one. We do not pretend otherwise.
    }
    return {
        close: () => {
            if (timer) {
                clearTimeout(timer);
            }
            watcher?.close();
        },
    };
}
//# sourceMappingURL=engine.js.map