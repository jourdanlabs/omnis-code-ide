"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReceiptsProvider = void 0;
const vscode = require("vscode");
const protocol_1 = require("./protocol");
const engine_1 = require("./engine");
class ReceiptsProvider {
    _onDidChange = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChange.event;
    reading = null;
    entries = [];
    /** Last engine reading, for commands that report state. */
    get current() {
        return this.reading;
    }
    async refresh() {
        const configured = vscode.workspace
            .getConfiguration('omnisCode')
            .get('enginePath');
        const enginePath = (0, engine_1.resolveEnginePath)(configured);
        this.reading = await (0, engine_1.readChain)(enginePath);
        // Entries are display-only and are read ONLY under an engine-issued VALID.
        // Under any other state we hold nothing out as trustworthy.
        this.entries = (0, protocol_1.mayRenderEntries)(this.reading.state) ? await (0, engine_1.readEntries)() : [];
        this._onDidChange.fire();
    }
    getTreeItem(node) {
        if (node.t === 'status') {
            return statusItem(node.reading);
        }
        if (node.t === 'note') {
            const i = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
            i.description = node.detail;
            i.tooltip = node.detail;
            i.iconPath = node.icon;
            i.command = node.command;
            return i;
        }
        const { row } = node;
        const i = new vscode.TreeItem(`${row.sequence}  ${row.kind}`, vscode.TreeItemCollapsibleState.None);
        i.description = `${row.label}   ${row.detail}`.trim();
        i.tooltip = new vscode.MarkdownString(`**${row.kind}** · \`${row.label}\`\n\n${row.detail || '—'}`);
        i.iconPath = new vscode.ThemeIcon(row.kind.includes('edit') ? 'diff-modified' : 'terminal');
        return i;
    }
    getChildren() {
        if (!this.reading) {
            return [{ t: 'note', label: 'Reading chain…' }];
        }
        const nodes = [{ t: 'status', reading: this.reading }];
        const s = this.reading.state;
        if (s.kind === 'unsafe') {
            const remedy = (0, protocol_1.unsafeRemedy)((0, engine_1.jcodeHome)());
            nodes.push({
                t: 'note',
                label: 'Why',
                detail: remedy.explanation,
                icon: new vscode.ThemeIcon('info'),
            });
            nodes.push({
                t: 'note',
                label: 'Fix',
                detail: remedy.command,
                icon: new vscode.ThemeIcon('wrench'),
                command: {
                    command: 'omnisCode.receipts.copyRemedy',
                    title: 'Copy remedy command',
                },
            });
        }
        if (s.kind === 'empty') {
            nodes.push({
                t: 'note',
                label: 'No receipts yet',
                detail: 'Run an OMNIS CODE turn and the first receipt will appear here.',
                icon: new vscode.ThemeIcon('info'),
            });
        }
        if (s.kind === 'invalid') {
            nodes.push({
                t: 'note',
                label: 'The ledger does not match its own hash chain',
                detail: 'An entry was altered after it was written. Entries are withheld — under a broken chain the engine cannot vouch for any of them.',
                icon: new vscode.ThemeIcon('error'),
            });
        }
        if (s.kind === 'unreachable' || s.kind === 'unparseable') {
            nodes.push({
                t: 'note',
                label: 'No verdict available',
                detail: s.detail,
                icon: new vscode.ThemeIcon('debug-disconnect'),
            });
        }
        for (const row of this.entries) {
            nodes.push({ t: 'entry', row });
        }
        return nodes;
    }
}
exports.ReceiptsProvider = ReceiptsProvider;
function statusItem(reading) {
    const s = reading.state;
    const exit = reading.exitCode === null ? '' : `  ·  exit ${reading.exitCode}`;
    let label;
    let icon;
    let description;
    let tooltip;
    switch (s.kind) {
        case 'valid':
            label = 'RECEIPT_CHAIN_VALID';
            icon = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
            description = `${s.entryCount} entries  ·  ${(0, protocol_1.truncateHash)(s.headSha256)}${exit}`;
            tooltip = `head sha256: ${s.headSha256}`;
            break;
        case 'invalid':
            label = 'RECEIPT_CHAIN_INVALID';
            icon = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
            description = `chain broken${exit}`;
            tooltip = 'The receipt chain failed verification.';
            break;
        case 'unsafe':
            label = 'RECEIPT_STATE_UNSAFE';
            icon = new vscode.ThemeIcon('shield', new vscode.ThemeColor('testing.iconQueued'));
            description = `state directory permissions${exit}`;
            tooltip = 'The engine refused to trust the ledger directory.';
            break;
        case 'empty':
            label = 'EMPTY_NOT_YET_EVIDENCED';
            icon = new vscode.ThemeIcon('circle-large-outline');
            description = `no entries yet${exit}`;
            tooltip = 'A healthy new install with nothing recorded yet. This is not a broken chain.';
            break;
        case 'unreachable':
            label = 'ENGINE UNREACHABLE';
            icon = new vscode.ThemeIcon('debug-disconnect');
            description = 'no verdict';
            tooltip = s.detail;
            break;
        case 'unparseable':
            label = 'UNRECOGNIZED ENGINE OUTPUT';
            icon = new vscode.ThemeIcon('question');
            description = 'no verdict';
            tooltip = s.detail;
            break;
    }
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = description;
    item.tooltip = tooltip;
    item.iconPath = icon;
    item.contextValue = `chain-${s.kind}`;
    return item;
}
//# sourceMappingURL=receiptsView.js.map