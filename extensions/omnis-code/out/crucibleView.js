"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CrucibleProvider = void 0;
exports.scansRoot = scansRoot;
const vscode = require("vscode");
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const crucible_1 = require("./crucible");
function scansRoot() {
    return (0, node_path_1.join)((0, node_os_1.homedir)(), 'crucible-scans');
}
class CrucibleProvider {
    _onDidChange = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChange.event;
    scan = null;
    note = 'No scan loaded.';
    get current() {
        return this.scan;
    }
    /**
     * Loads the newest STORED scan for the workspace. Never triggers a scan —
     * a 30–150s job does not run because a view became visible.
     */
    async loadLatest(repoName) {
        try {
            const dirs = await (0, promises_1.readdir)(scansRoot());
            const newest = (0, crucible_1.newestScanDir)(dirs, repoName);
            if (!newest) {
                this.scan = null;
                this.note = `No stored scan for "${repoName}". Run "CRUCIBLE: scan this repository".`;
            }
            else {
                const raw = await (0, promises_1.readFile)((0, node_path_1.join)(scansRoot(), newest, 'pipeline.json'), 'utf8');
                const parsed = (0, crucible_1.parsePipeline)(newest, raw);
                this.scan = parsed;
                this.note = parsed ? null : `Scan ${newest} could not be parsed.`;
            }
        }
        catch {
            this.scan = null;
            this.note = 'No scans directory yet. Run a scan to create one.';
        }
        this._onDidChange.fire();
    }
    getTreeItem(node) {
        if (node.t === 'note') {
            const i = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
            i.description = node.detail;
            i.iconPath = node.icon;
            return i;
        }
        if (node.t === 'header') {
            const s = node.scan;
            const age = (0, crucible_1.ageLabel)(s.scannedAt, new Date());
            const i = new vscode.TreeItem(s.verdict, vscode.TreeItemCollapsibleState.None);
            i.description = `${s.findings.length} findings  ·  ${age}`;
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**${s.targetName}** — ${s.verdict}\n\n${s.summary}\n\n`);
            md.appendMarkdown(`_${age}_`);
            i.tooltip = md;
            i.iconPath = (0, crucible_1.isStale)(s.scannedAt, new Date())
                ? new vscode.ThemeIcon('history', new vscode.ThemeColor('descriptionForeground'))
                : new vscode.ThemeIcon('checklist');
            return i;
        }
        const f = this.scan.findings[node.index];
        const i = new vscode.TreeItem(f.description, vscode.TreeItemCollapsibleState.None);
        i.description = `${f.file}:${f.line}`;
        i.iconPath = new vscode.ThemeIcon(f.severity === 'CRIT' || f.severity === 'HIGH' ? 'warning' : 'info');
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${f.severity}** — ${f.description}\n\n`);
        if (f.fix) {
            md.appendMarkdown(`_fix:_ ${f.fix}\n\n`);
        }
        md.appendMarkdown(`_${(0, crucible_1.ageLabel)(this.scan.scannedAt, new Date())} — not a live result_`);
        i.tooltip = md;
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (root) {
            const target = vscode.Uri.joinPath(root, f.file);
            i.command = {
                command: 'vscode.open',
                title: 'Open',
                arguments: [target, { selection: new vscode.Range(f.line - 1, 0, f.line - 1, 0) }],
            };
        }
        return i;
    }
    getChildren() {
        if (!this.scan) {
            return [
                {
                    t: 'note',
                    label: this.note ?? 'No scan loaded.',
                    icon: new vscode.ThemeIcon('info'),
                },
            ];
        }
        const nodes = [{ t: 'header', scan: this.scan }];
        if ((0, crucible_1.isStale)(this.scan.scannedAt, new Date())) {
            nodes.push({
                t: 'note',
                label: 'These findings are from an earlier scan',
                detail: 'Re-run the scan to see current results.',
                icon: new vscode.ThemeIcon('history'),
            });
        }
        this.scan.findings.forEach((_, index) => nodes.push({ t: 'finding', index }));
        return nodes;
    }
}
exports.CrucibleProvider = CrucibleProvider;
//# sourceMappingURL=crucibleView.js.map