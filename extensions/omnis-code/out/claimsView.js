"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaimsProvider = void 0;
const vscode = require("vscode");
const claims_1 = require("./claims");
const engine_1 = require("./engine");
const protocol_1 = require("./protocol");
/**
 * Icon per verdict weight.
 *
 * A refusal gets `circle-slash` in a neutral/informational colour — a distinct
 * mark of its own, deliberately NOT `error` or `warning`. Refusing to assert an
 * ungroundable claim is the product succeeding.
 */
function iconFor(weight) {
    switch (weight) {
        case 'grounded':
            return new vscode.ThemeIcon('verified-filled', new vscode.ThemeColor('testing.iconPassed'));
        case 'failure':
            return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
        case 'refusal':
            return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('charts.blue'));
        case 'ungrounded':
            return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('descriptionForeground'));
    }
}
class ClaimsProvider {
    _onDidChange = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChange.event;
    chain = null;
    summary = null;
    lastRaw = '';
    get lastSummary() {
        return this.summary;
    }
    get lastOutput() {
        return this.lastRaw;
    }
    async refresh() {
        const res = await (0, engine_1.runEngine)(['claims', 'status', '--json']);
        this.chain = res.stdout ? (0, claims_1.parseClaimsStatus)(res.stdout) : null;
        if (!this.chain) {
            this.chain = {
                kind: 'unreachable',
                code: 'ENGINE_UNREACHABLE',
                detail: res.detail ?? 'engine produced no output',
            };
        }
        this._onDidChange.fire();
    }
    /** Runs the demo refusal and renders the verdicts it produces. */
    async showRefusal() {
        const res = await (0, engine_1.runEngine)(['claims', 'verify', '--refuse-demo', '--json']);
        this.lastRaw = res.stdout;
        this.summary = res.stdout ? (0, claims_1.parseClaimsVerify)(res.stdout) : null;
        await this.refresh();
    }
    getTreeItem(node) {
        if (node.t === 'chain') {
            return chainItem(node.state);
        }
        if (node.t === 'note') {
            const i = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
            i.description = node.detail;
            i.tooltip = node.detail;
            i.iconPath = node.icon;
            return i;
        }
        const o = node.outcome;
        const p = (0, claims_1.present)(o.verdict);
        const i = new vscode.TreeItem(o.verdict, vscode.TreeItemCollapsibleState.None);
        i.description = o.surface;
        i.iconPath = iconFor(p.weight);
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${o.verdict}** — ${p.gloss}\n\n`);
        md.appendMarkdown(`> ${o.surface}\n\n`);
        if (o.reason) {
            md.appendMarkdown(`${o.reason}\n\n`);
        }
        if (o.verifier) {
            md.appendMarkdown(`verifier: \`${o.verifier}\``);
            if (typeof o.exitCode === 'number') {
                md.appendMarkdown(` · exit ${o.exitCode}`);
            }
            md.appendMarkdown('\n\n');
        }
        if (o.bound) {
            md.appendMarkdown(`_scope: ${o.bound}_\n\n`);
        }
        if (o.entryHash) {
            md.appendMarkdown(`receipt: \`${(0, protocol_1.truncateHash)(o.entryHash)}\``);
        }
        i.tooltip = md;
        i.contextValue = `verdict-${p.weight}`;
        return i;
    }
    getChildren() {
        if (!this.chain) {
            return [{ t: 'note', label: 'Reading claim ledger…' }];
        }
        const nodes = [{ t: 'chain', state: this.chain }];
        if (this.summary) {
            const s = this.summary;
            nodes.push({
                t: 'note',
                label: 'Last run',
                detail: `${s.certified} certified · ${s.refused} refused · ${s.ungrounded} ungrounded`,
                icon: new vscode.ThemeIcon('history'),
            });
            for (const outcome of s.outcomes) {
                nodes.push({ t: 'outcome', outcome });
            }
        }
        else if (this.chain.kind === 'valid') {
            nodes.push({
                t: 'note',
                label: 'No claims verified in this session',
                detail: 'Run "Show me a refusal" to see the ledger refuse an ungroundable claim.',
                icon: new vscode.ThemeIcon('info'),
            });
        }
        return nodes;
    }
}
exports.ClaimsProvider = ClaimsProvider;
function chainItem(state) {
    const i = new vscode.TreeItem(state.code, vscode.TreeItemCollapsibleState.None);
    switch (state.kind) {
        case 'valid':
            i.description = `${state.entryCount} entries  ·  ${(0, protocol_1.truncateHash)(state.headSha256 ?? '')}`;
            i.tooltip = `head sha256: ${state.headSha256 ?? '—'}`;
            i.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
            break;
        case 'empty':
            i.description = 'no claims yet';
            i.tooltip =
                'A healthy new install with no claims recorded yet. This is not a broken chain.';
            i.iconPath = new vscode.ThemeIcon('circle-large-outline');
            break;
        case 'unsafe':
            i.description = 'state directory permissions';
            i.tooltip = 'The engine refused to trust the ledger directory.';
            i.iconPath = new vscode.ThemeIcon('shield', new vscode.ThemeColor('testing.iconQueued'));
            break;
        case 'unreachable':
            i.label = 'ENGINE UNREACHABLE';
            i.description = 'no verdict';
            i.tooltip = state.detail;
            i.iconPath = new vscode.ThemeIcon('debug-disconnect');
            break;
        case 'invalid':
            i.description = 'claim chain failed verification';
            i.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
            break;
    }
    i.contextValue = `claimchain-${state.kind}`;
    return i;
}
//# sourceMappingURL=claimsView.js.map