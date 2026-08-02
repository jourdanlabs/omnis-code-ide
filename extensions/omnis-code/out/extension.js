"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const receiptsView_1 = require("./receiptsView");
const claimsView_1 = require("./claimsView");
const crucibleView_1 = require("./crucibleView");
const engine_1 = require("./engine");
const protocol_1 = require("./protocol");
const turn_1 = require("./turn");
function activate(context) {
    (0, engine_1.setConfiguredEnginePath)(vscode.workspace.getConfiguration('omnisCode').get('enginePath'));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('omnisCode.enginePath')) {
            (0, engine_1.setConfiguredEnginePath)(vscode.workspace.getConfiguration('omnisCode').get('enginePath'));
        }
    }));
    const provider = new receiptsView_1.ReceiptsProvider();
    const claims = new claimsView_1.ClaimsProvider();
    const view = vscode.window.createTreeView('omnisCode.receipts', {
        treeDataProvider: provider,
    });
    const claimsView = vscode.window.createTreeView('omnisCode.claims', {
        treeDataProvider: claims,
    });
    const output = vscode.window.createOutputChannel('OMNIS CODE');
    context.subscriptions.push(view, claimsView, output, vscode.commands.registerCommand('omnisCode.claims.refresh', () => claims.refresh()), 
    /**
     * "Show me a refusal" — the pitch surface. The engine really refuses, and
     * really records that refusal. This is a successful outcome, so it is not
     * reported as an error anywhere in this flow.
     */
    vscode.commands.registerCommand('omnisCode.claims.showRefusal', async () => {
        await claims.showRefusal();
        output.appendLine('$ omnis-key claims verify --refuse-demo --json');
        output.appendLine(claims.lastOutput.trim() || '(no stdout)');
        output.appendLine('');
        output.show(true);
    }), vscode.commands.registerCommand('omnisCode.receipts.refresh', () => provider.refresh()), 
    /**
     * Verify writes its result to the panel and to a persistent output channel.
     * Rule §4.1: results on the glass. A failing verify must not evaporate into
     * a toast the user can miss.
     */
    vscode.commands.registerCommand('omnisCode.receipts.verify', async () => {
        const enginePath = (0, engine_1.resolveEnginePath)(vscode.workspace.getConfiguration('omnisCode').get('enginePath'));
        const reading = await (0, engine_1.verifyChain)(enginePath);
        output.appendLine(`$ omnis-key receipts verify --json`);
        output.appendLine(reading.raw.trim() || '(no stdout)');
        output.appendLine(`exit ${reading.exitCode ?? '—'}`);
        output.appendLine('');
        output.show(true);
        await provider.refresh();
    }), 
    /**
     * Run one OMNIS CODE turn.
     *
     * Provider selection is explicit and required. There is no auto-detect
     * path here, and no "we found a key in your environment" shortcut — that
     * is the product's stated position, so the UI must not quietly violate it.
     */
    vscode.commands.registerCommand('omnisCode.run', async () => {
        const auth = await (0, engine_1.runAgent)(['auth', 'status']);
        const providers = (0, turn_1.availableProviders)(auth.stdout);
        if (providers.length === 0) {
            output.appendLine('No provider is configured. Run `omnis-code login <provider>` and try again.');
            output.show(true);
            return;
        }
        const picked = await vscode.window.showQuickPick(providers.map((p) => ({ label: p.id, description: p.method })), { title: 'OMNIS CODE — choose a provider', placeHolder: 'Provider (required)' });
        if (!picked) {
            return;
        }
        const message = await vscode.window.showInputBox({
            title: 'OMNIS CODE — run a turn',
            prompt: 'What should the agent do?',
        });
        if (!message?.trim()) {
            return;
        }
        let args;
        try {
            args = (0, turn_1.buildTurnArgs)({
                message,
                provider: picked.label,
                cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
            });
        }
        catch (e) {
            output.appendLine(e.message);
            output.show(true);
            return;
        }
        output.appendLine(`$ omnis-code ${args.slice(0, 4).join(' ')} …`);
        output.show(true);
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `OMNIS CODE turn (${picked.label})`,
            cancellable: true,
        }, async (_progress, token) => {
            const run = (0, engine_1.streamAgent)(args, (chunk) => {
                for (const ev of (0, turn_1.parseNdjsonChunk)(chunk)) {
                    output.appendLine(ev.text ? `${ev.type}: ${ev.text}` : ev.type);
                }
            }, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
            token.onCancellationRequested(() => run.cancel());
            const code = await run.done;
            output.appendLine(`\nturn exited ${code ?? '—'}`);
            // The watcher normally catches this; refresh anyway so the panel is
            // current the instant the turn ends.
            await provider.refresh();
        });
    }), vscode.commands.registerCommand('omnisCode.receipts.copyHead', async () => {
        const s = provider.current?.state;
        if (s?.kind === 'valid') {
            await vscode.env.clipboard.writeText(s.headSha256);
            vscode.window.setStatusBarMessage('Head hash copied', 2000);
        }
    }), vscode.commands.registerCommand('omnisCode.receipts.copyRemedy', async () => {
        await vscode.env.clipboard.writeText((0, protocol_1.unsafeRemedy)((0, engine_1.jcodeHome)()).command);
        vscode.window.setStatusBarMessage('Remedy command copied', 2000);
    }));
    /**
     * CAIRN, natively.
     *
     * VS Code speaks MCP, so we hand it CAIRN's server definition rather than
     * shelling out and re-implementing a client. We deliberately do NOT build an
     * ask/answer panel: VS Code gives extensions no MCP *client* API (only the
     * ability to publish server definitions), so a panel would have to
     * re-implement the transport — and any answer it displayed while the engine
     * was down would be a fabricated one. The chat surface owns the asking.
     *
     * Registration does not require CAIRN to be running; if the server script is
     * absent we contribute nothing rather than register a definition that cannot
     * start.
     */
    if (vscode.lm?.registerMcpServerDefinitionProvider) {
        context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider('omnisCode.cairn', {
            provideMcpServerDefinitions: async () => {
                const script = cairnServerScript();
                if (!script) {
                    return [];
                }
                return [
                    new vscode.McpStdioServerDefinition('CAIRN', 'node', [script], { CAIRN_URL: cairnUrl() }),
                ];
            },
        }));
    }
    const crucible = new crucibleView_1.CrucibleProvider();
    const crucibleView = vscode.window.createTreeView('omnisCode.crucible', {
        treeDataProvider: crucible,
    });
    context.subscriptions.push(crucibleView, vscode.commands.registerCommand('omnisCode.crucible.load', () => loadCrucible(crucible)), 
    /**
     * An explicit, long-running command. Never on save, never on keystroke,
     * always cancellable, never blocking the editor.
     */
    vscode.commands.registerCommand('omnisCode.crucible.scan', async () => {
        const root = vscode.workspace.workspaceFolders?.[0];
        if (!root) {
            void vscode.window.showInformationMessage('Open a folder to scan.');
            return;
        }
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'CRUCIBLE scanning this repository (30–150s)',
            cancellable: true,
        }, async (_p, token) => {
            output.appendLine(`$ crucible-scan ${root.uri.fsPath}`);
            output.show(true);
            const run = (0, engine_1.streamScan)(root.uri.fsPath, (c) => output.append(c));
            token.onCancellationRequested(() => run.cancel());
            const code = await run.done;
            // crucible-scan exits 0 even on a bad argument, so the exit code is
            // reported but never treated as proof the scan succeeded.
            output.appendLine(`\nscan exited ${code ?? '—'}`);
            await loadCrucible(crucible);
        });
    }));
    void loadCrucible(crucible);
    /**
     * Live refresh. The receipts panel must reflect a new receipt without the
     * user reloading anything, so we watch the ledger file itself rather than
     * assuming our own commands are the only writer — a turn run in a terminal
     * outside the editor must move the panel too.
     */
    const watcher = (0, engine_1.watchLedger)(() => void provider.refresh());
    context.subscriptions.push({ dispose: () => watcher.close() });
    void provider.refresh();
    void claims.refresh();
    return { provider, claims };
}
function loadCrucible(crucible) {
    const root = vscode.workspace.workspaceFolders?.[0];
    return crucible.loadLatest(root ? (0, node_path_1.basename)(root.uri.fsPath) : '');
}
/** CAIRN's MCP entry point, if it is installed. */
function cairnServerScript() {
    const configured = vscode.workspace
        .getConfiguration('omnisCode')
        .get('cairnServerScript');
    const candidate = configured?.trim() || (0, node_path_1.join)((0, node_os_1.homedir)(), 'projects', 'cairn', 'mcp', 'server.mjs');
    return (0, node_fs_1.existsSync)(candidate) ? candidate : null;
}
function cairnUrl() {
    return (vscode.workspace.getConfiguration('omnisCode').get('cairnUrl')?.trim() ||
        'http://127.0.0.1:4611');
}
function deactivate() {
    /* no-op */
}
//# sourceMappingURL=extension.js.map