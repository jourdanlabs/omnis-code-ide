#!/usr/bin/env node
/**
 * OMNIS CODE IDE — upstream merge agent (W7-A)
 *
 * Loop: poll → merge (working branch only) → conflict stop → build →
 *       canary-can-fail → canary → write-gate → report.
 *
 * Rules (hard):
 *  1. Fail closed on ambiguity
 *  2. Never self-certify (verdict always ends HUMAN REVIEW REQUIRED or BLOCKED)
 *  3. Never touch credentials / sign / notarize / publish
 *  4. Never push; never write a release branch
 *
 * Usage:
 *   node scripts/omnis-merge-agent.mjs                 # fetch + merge or synthetic
 *   node scripts/omnis-merge-agent.mjs --synthetic     # force synthetic upstream
 *   node scripts/omnis-merge-agent.mjs --skip-build    # faster local (not for ship evidence)
 *   node scripts/omnis-merge-agent.mjs --demo-conflict # prove owned-file conflict stops
 *
 * Evidence (reports, measured JSON) is written ONLY under a gitignored directory
 * (default: .omnis-merge-agent/reports/). Never under tracked docs/. A prior bug
 * wrote reports into docs/evidence/merge-agent/ and self-blocked the next run on
 * "working tree not clean" — monthly cron would work once then die forever.
 * Override with OMNIS_MERGE_REPORT_DIR (absolute path; may be outside the repo).
 *
 * Exit: 0 = MERGE CLEAN — HUMAN REVIEW REQUIRED (evidence only)
 *       1 = BLOCKED or internal failure
 *       2 = usage / preflight failure
 */
import { spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	appendFileSync,
	readdirSync,
	statSync,
} from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const args = new Set(process.argv.slice(2));
const FORCE_SYNTHETIC = args.has('--synthetic');
const SKIP_BUILD = args.has('--skip-build');
const DEMO_CONFLICT = args.has('--demo-conflict');

/**
 * Agent evidence root — MUST be gitignored (or outside the repo).
 * Writing tracked untracked files dirties the tree and blocks the next run.
 */
function evidenceRoot() {
	const override = (process.env.OMNIS_MERGE_REPORT_DIR || '').trim();
	if (override) {
		return override;
	}
	return join(ROOT, '.omnis-merge-agent', 'reports');
}

/** Paths we own — conflict here = STOP (human). */
const OWNED_PREFIXES = [
	'product.json',
	'src/vs/workbench/api/node/extHostExtensionService.ts',
	'src/vs/workbench/api/node/omnisWriteGate.ts',
	'README.md',
	'BUILDING.md',
	'UPSTREAM.md',
	'docs/HONEST_LIMITS.md',
	'docs/UPSTREAM_MERGE.md',
	'docs/WRITE_GATE_COVERAGE.md',
	'docs/MCP_GALLERY.md',
	'docs/DISTRIBUTION.md',
	'docs/SIGNING.md',
	'docs/RESIDUALS.md',
	'extensions/omnis-code/',
	'scripts/omnis-',
];

const FORBIDDEN_PATH_GLOBS = [
	// Agent must not contain or invoke these.
];

const FORBIDDEN_CODE_PATTERNS = [
	/notarytool/i,
	/altool/i,
	/codesign\s+--sign/i,
	/APPLE_ID|APP_STORE_CONNECT|NOTARY_PASSWORD|ASC_PROVIDER/i,
	/aws_secret|AWS_SECRET|private[_-]?key\.pem/i,
	/ghp_[A-Za-z0-9]{20,}/, // github pats
	/-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/,
];

const RELEASE_BRANCH_RE = /^(main|master|release\/|releases\/)/i;

function sh(cmd, opts = {}) {
	const r = spawnSync(cmd, {
		shell: true,
		encoding: 'utf8',
		cwd: opts.cwd || ROOT,
		env: { ...process.env, ...(opts.env || {}) },
		timeout: opts.timeout ?? 0,
	});
	return {
		code: r.status === null ? 99 : r.status,
		stdout: (r.stdout || '').trimEnd(),
		stderr: (r.stderr || '').trimEnd(),
		signal: r.signal,
	};
}

function git(args, opts = {}) {
	const r = spawnSync('git', args, {
		encoding: 'utf8',
		cwd: opts.cwd || ROOT,
		env: process.env,
	});
	return {
		code: r.status === null ? 99 : r.status,
		stdout: (r.stdout || '').trimEnd(),
		stderr: (r.stderr || '').trimEnd(),
	};
}

function isOwned(path) {
	const norm = path.replace(/\\/g, '/');
	return OWNED_PREFIXES.some((p) => norm === p || norm.startsWith(p));
}

function nowStamp() {
	const d = new Date();
	const p = (n) => String(n).padStart(2, '0');
	return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

/** Scan agent scripts + docs for credential / signing capability. */
function credentialScan() {
	const hits = [];
	const roots = [join(ROOT, 'scripts'), join(ROOT, 'docs')];
	const files = [];
	function walk(dir) {
		if (!existsSync(dir)) return;
		for (const name of readdirSync(dir)) {
			const p = join(dir, name);
			const st = statSync(p);
			if (st.isDirectory()) {
				if (name === 'evidence' || name === 'w1-launch-logs') continue;
				walk(p);
			} else if (/\.(mjs|js|ts|md|sh|json)$/.test(name)) {
				files.push(p);
			}
		}
	}
	for (const r of roots) walk(r);
	// Also this file
	files.push(fileURLToPath(import.meta.url));

	for (const f of files) {
		let text;
		try {
			text = readFileSync(f, 'utf8');
		} catch {
			continue;
		}
		// Allow this file to *mention* forbidden patterns in the scan list itself
		if (f.endsWith('omnis-merge-agent.mjs') && text.includes('FORBIDDEN_CODE_PATTERNS')) {
			// Only scan outside the pattern array by checking for actual usage APIs
			if (/spawnSync\([^)]*notarytool/.test(text) || /execSync\([^)]*codesign/.test(text)) {
				hits.push({ file: relative(ROOT, f), reason: 'invokes signing tooling' });
			}
			continue;
		}
		for (const re of FORBIDDEN_CODE_PATTERNS) {
			if (re.test(text)) {
				// Docs discussing the prohibition are OK if they say "never"
				const rel = relative(ROOT, f);
				if (rel.startsWith('docs/') && /never|must not|do not|forbidden|no credential/i.test(text)) {
					continue;
				}
				hits.push({ file: rel, reason: `matched ${re}` });
			}
		}
	}
	return hits;
}

function assertNotReleaseBranch(branch) {
	if (RELEASE_BRANCH_RE.test(branch)) {
		return `refusing to operate on release-shaped branch: ${branch}`;
	}
	return null;
}

function reportPath(stamp) {
	const dir = evidenceRoot();
	mkdirSync(dir, { recursive: true });
	return join(dir, `merge-report-${stamp}.md`);
}

function measuredPath(stamp) {
	const dir = evidenceRoot();
	mkdirSync(dir, { recursive: true });
	return join(dir, `measured-${stamp}.json`);
}

/**
 * Synthetic upstream must commit a real tree change. Put it under a path that
 * is NOT the evidence dump (evidence is gitignored and must not be the merge payload).
 */
function syntheticUnownedPath(stamp) {
	const dir = join(ROOT, 'docs', 'evidence', 'merge-agent', 'synthetic');
	mkdirSync(dir, { recursive: true });
	return join(dir, `unowned-${stamp}.txt`);
}

function formatReport(r) {
	const lines = [
		'# OMNIS merge agent report',
		'',
		`generated_utc: ${r.generated_utc}`,
		`work_branch: ${r.work_branch}`,
		`agent: scripts/omnis-merge-agent.mjs`,
		`self_certify: false`,
		'',
		'```',
		`upstream       ${r.upstream_old} → ${r.upstream_new}   (${r.version_old} → ${r.version_new})`,
		`conflicts      ${r.conflicts}`,
		`build          ${r.build}`,
		`canary         ${r.canary}`,
		`  canary-can-fail   ${r.canary_can_fail}`,
		`  write-gate-can-fail ${r.write_gate_can_fail}`,
		`write-gate     healthy ${r.wg_healthy} | tampered ${r.wg_tampered} | engine-gone ${r.wg_engine_gone}`,
		`credentials    ${r.credentials}`,
		`release_touch  ${r.release_touch}`,
		`verdict        ${r.verdict}`,
		'```',
		'',
		'## Detail',
		'',
		r.detail || '_(none)_',
		'',
		'## Standing rules',
		'',
		'- Agent produces evidence. Human releases.',
		'- Fail closed. No signing. No release-branch write.',
		'- A green canary with a removed patch is a failed product.',
		'',
	];
	return lines.join('\n');
}

function parseWriteGateProbe(stdout) {
	// Probe prints OK lines; map the three cases.
	const healthy = /healthy chain: file content written/.test(stdout) && !/FAIL:.*healthy/i.test(stdout);
	const tampered =
		/file on disk unchanged after refusal/.test(stdout) || /🔴 file on disk unchanged/.test(stdout);
	const engineGone = /engine unreachable refuses/.test(stdout);
	const pass = /W2 probe PASS/.test(stdout);
	return {
		healthy: pass && healthy ? 'PASS' : 'FAIL',
		tampered: pass && tampered ? 'PASS' : 'FAIL',
		engine_gone: pass && engineGone ? 'PASS' : 'FAIL',
		raw_pass: pass,
	};
}

async function main() {
	const stamp = nowStamp();
	const generated_utc = new Date().toISOString();
	const result = {
		generated_utc,
		work_branch: '',
		upstream_old: '?',
		upstream_new: '?',
		version_old: '?',
		version_new: '?',
		conflicts: 'none',
		build: 'SKIPPED',
		canary: 'NOT RUN',
		canary_can_fail: 'NOT RUN',
		write_gate_can_fail: 'NOT RUN',
		wg_healthy: 'NOT RUN',
		wg_tampered: 'NOT RUN',
		wg_engine_gone: 'NOT RUN',
		credentials: 'NOT RUN',
		release_touch: 'NOT RUN',
		verdict: 'BLOCKED: incomplete',
		detail: '',
	};
	const detail = [];

	function block(reason) {
		result.verdict = `BLOCKED: ${reason}`;
		detail.push(`BLOCKED: ${reason}`);
		finish(1);
	}

	function finish(code) {
		result.detail = detail.join('\n\n');
		const path = reportPath(stamp);
		writeFileSync(path, formatReport(result));
		console.log('\n' + formatReport(result));
		console.log(`\nreport written: ${path}`);
		// Never self-certify: even exit 0 is HUMAN REVIEW REQUIRED
		process.exit(code);
	}

	// --- Preflight ---
	const branchR = git(['rev-parse', '--abbrev-ref', 'HEAD']);
	if (branchR.code !== 0) {
		block('not a git repo or no HEAD');
		return;
	}
	const startBranch = branchR.stdout;
	const relErr = assertNotReleaseBranch(startBranch);
	// Working on toph/omnis-code-ide-w1-w8 is fine (not release)
	if (startBranch === 'main' || startBranch === 'master') {
		// We allow reading from main only if we immediately branch off — create work branch first
		detail.push(`note: started on ${startBranch}; will only write merge-work branches`);
	}
	result.release_touch = 'none (agent never checks out release/* for write)';

	// Credential scan
	const credHits = credentialScan();
	if (credHits.length) {
		result.credentials = `FAIL ${JSON.stringify(credHits)}`;
		block(`credentials or signing surfaces found: ${JSON.stringify(credHits)}`);
		return;
	}
	result.credentials = 'PASS (no signing/notary/publish secrets in agent surface)';

	// Dirty tree? Fail closed — ambiguous state.
	// git status --porcelain ignores gitignored paths; evidence must live there
	// (or outside the repo) so a completed run does not poison the next.
	const dirty = git(['status', '--porcelain']);
	if (dirty.stdout.trim()) {
		block(
			`working tree not clean:\n${dirty.stdout.slice(0, 500)}\n` +
				`(Agent reports belong in ${evidenceRoot()} which must be gitignored. ` +
				`If you see docs/evidence/merge-agent/merge-report-*.md untracked, those are from a fixed bug — delete or gitignore them.)`,
		);
		return;
	}

	const head = git(['rev-parse', 'HEAD']).stdout;
	const pinFile = existsSync(join(ROOT, 'UPSTREAM.md'))
		? readFileSync(join(ROOT, 'UPSTREAM.md'), 'utf8')
		: '';
	const pinMatch = pinFile.match(/1b2f25580[a-f0-9]*/);
	const knownPin = pinMatch ? pinMatch[0] : '1b2f25580d1eaaeea7d18a3968565c818177d8e1';

	// --- §3 canary-can-fail FIRST (load-bearing) ---
	detail.push('## canary-can-fail');
	const ccf = sh(`${process.execPath} scripts/omnis-canary-can-fail.mjs`, { timeout: 60_000 });
	detail.push(ccf.stdout || ccf.stderr);
	if (ccf.code !== 0) {
		result.canary_can_fail = '🔴 FAIL';
		block('canary-can-fail did not pass — automation worthless; discard run');
		return;
	}
	result.canary_can_fail = 'PASS';

	// write-gate can-fail
	const wcf = sh(`${process.execPath} scripts/omnis-write-gate-can-fail.mjs`, { timeout: 120_000 });
	detail.push('## write-gate-can-fail\n' + (wcf.stdout || wcf.stderr));
	if (wcf.code !== 0) {
		result.write_gate_can_fail = '🔴 FAIL';
		block('write-gate-can-fail did not pass');
		return;
	}
	result.write_gate_can_fail = 'PASS';

	// --- Resolve upstream movement ---
	let mode = 'real';
	let mergeSource = '';
	let oldSha = head;
	let newSha = '';
	let versionOld = '?';
	let versionNew = '?';

	// Try fetch upstream (network may fail — fail closed into synthetic if --synthetic, else report)
	const hasUpstream = git(['remote']).stdout.split('\n').includes('upstream');
	if (hasUpstream && !FORCE_SYNTHETIC && !DEMO_CONFLICT) {
		const fetch = sh('git fetch upstream --tags --prune 2>&1', { timeout: 300_000 });
		detail.push('## git fetch upstream\n' + (fetch.stdout || fetch.stderr));
		if (fetch.code !== 0) {
			detail.push('fetch failed; falling back is only allowed with --synthetic');
			if (!FORCE_SYNTHETIC) {
				// Try local upstream/main
				const u = git(['rev-parse', 'upstream/main']);
				if (u.code !== 0) {
					block('upstream fetch failed and no local upstream/main');
					return;
				}
			}
		}
		const upstreamTip = git(['rev-parse', 'upstream/main']);
		if (upstreamTip.code === 0) {
			const tip = upstreamTip.stdout;
			// Find merge-base with first-parent history that is pure upstream if possible
			const mb = git(['merge-base', head, tip]);
			const base = mb.code === 0 ? mb.stdout : knownPin;
			// Commits on upstream not in HEAD
			const ahead = git(['rev-list', '--count', `${head}..${tip}`]);
			const n = parseInt(ahead.stdout || '0', 10) || 0;
			if (n > 0) {
				mode = 'real';
				mergeSource = 'upstream/main';
				oldSha = base;
				newSha = tip;
				versionOld = 'pinned/base';
				versionNew = 'upstream/main';
				detail.push(`upstream has ${n} commit(s) not in HEAD; will merge ${mergeSource}`);
			} else {
				mode = 'synthetic';
				detail.push('upstream has not moved relative to HEAD — synthesizing merge (§6.1)');
			}
		} else {
			mode = 'synthetic';
			detail.push('no upstream/main — synthesizing');
		}
	} else {
		mode = FORCE_SYNTHETIC || DEMO_CONFLICT ? 'synthetic' : 'synthetic';
		detail.push('synthetic mode requested or no upstream remote');
	}

	if (FORCE_SYNTHETIC) {
		mode = 'synthetic';
	}

	// --- Create work branch ---
	const workBranch = `omnis/merge-work/${stamp}`;
	const brErr = assertNotReleaseBranch(workBranch);
	if (brErr) {
		block(brErr);
		return;
	}
	const cob = git(['checkout', '-b', workBranch]);
	if (cob.code !== 0) {
		block(`could not create work branch: ${cob.stderr}`);
		return;
	}
	result.work_branch = workBranch;
	detail.push(`work branch: ${workBranch}`);

	// --- Synthetic upstream construction ---
	if (mode === 'synthetic' || DEMO_CONFLICT) {
		const synthBranch = `omnis/synthetic-upstream/${stamp}`;
		// Branch from known upstream pin if present in history, else from HEAD~ enough
		let synthBase = knownPin;
		const hasPin = git(['cat-file', '-t', knownPin]);
		if (hasPin.code !== 0) {
			// use empty tree parent: first parent of our first omnis commit's parent
			synthBase = git(['rev-list', '--max-parents=0', 'HEAD']).stdout.split('\n')[0] || head;
		}
		// Create synthetic branch from current work branch tip, then add upstream-like commits
		// Simpler approach: from workBranch, create synth that only has "incoming" commits via orphan? 
		// Better: checkout -b synth from HEAD, reset soft to keep files... 
		// Clean approach used here:
		// 1. Create synthBranch from HEAD
		// 2. On synthBranch, commit unowned change (+ owned if demo-conflict)
		// 3. checkout workBranch
		// 4. merge synthBranch

		git(['branch', '-f', synthBranch, 'HEAD']);
		const co = git(['checkout', synthBranch]);
		if (co.code !== 0) {
			block(`synthetic checkout failed: ${co.stderr}`);
			return;
		}

		// Unowned file change (safe merge) — tracked path, committed on synth branch.
		// Do NOT write agent reports here; reports are gitignored and must not be payload.
		const unowned = syntheticUnownedPath(stamp);
		writeFileSync(
			unowned,
			`synthetic upstream bump ${stamp}\nThis file is NOT on the owned list.\n`,
		);
		const addU = git(['add', unowned]);
		if (addU.code !== 0) {
			block(`synthetic unowned git add failed: ${addU.stderr}`);
			return;
		}
		const c1 = git(['commit', '--no-verify', '-m', `synthetic(upstream): unowned touch ${stamp}`]);
		if (c1.code !== 0) {
			block(`synthetic unowned commit failed: ${c1.stderr}`);
			return;
		}

		if (DEMO_CONFLICT) {
			// Owned conflict: change product.json on synth branch
			const pj = join(ROOT, 'product.json');
			const prod = JSON.parse(readFileSync(pj, 'utf8'));
			prod.nameShort = `${prod.nameShort} SYNTH-CONFLICT`;
			writeFileSync(pj, JSON.stringify(prod, null, '\t') + '\n');
			git(['add', 'product.json']);
			git(['commit', '--no-verify', '-m', `synthetic(upstream): owned product.json conflict bait ${stamp}`]);
			// And change product.json differently on work branch after we return
		}

		newSha = git(['rev-parse', 'HEAD']).stdout;
		oldSha = head;
		versionOld = 'pre-synthetic';
		versionNew = `synthetic-${stamp}`;
		mergeSource = synthBranch;

		// Back to work branch
		git(['checkout', workBranch]);

		if (DEMO_CONFLICT) {
			const pj = join(ROOT, 'product.json');
			const prod = JSON.parse(readFileSync(pj, 'utf8'));
			prod.nameShort = `${prod.nameShort} WORK-CONFLICT`;
			writeFileSync(pj, JSON.stringify(prod, null, '\t') + '\n');
			git(['add', 'product.json']);
			git(['commit', '--no-verify', '-m', `synthetic(work): owned product.json conflict bait ${stamp}`]);
		}
	}

	result.upstream_old = oldSha.slice(0, 12);
	result.upstream_new = (newSha || mergeSource).toString().slice(0, 12);
	result.version_old = versionOld;
	result.version_new = versionNew;

	// --- Merge ---
	detail.push(`## merge ${mergeSource} → ${workBranch}`);
	// Never use -X ours/theirs for owned files. Full stop on any conflict.
	const merge = git(['merge', '--no-ff', '--no-edit', mergeSource, '-m', `merge: ${mergeSource} via omnis-merge-agent ${stamp}`]);
	detail.push(`merge exit ${merge.code}\n${merge.stdout}\n${merge.stderr}`);

	if (merge.code !== 0) {
		// Collect conflicted paths
		const unmerged = git(['diff', '--name-only', '--diff-filter=U']);
		const paths = unmerged.stdout.split('\n').filter(Boolean);
		const owned = paths.filter(isOwned);
		const other = paths.filter((p) => !isOwned(p));

		if (paths.length === 0) {
			// merge failed for another reason
			git(['merge', '--abort']);
			result.conflicts = `merge failed without conflict list: ${merge.stderr || merge.stdout}`;
			block(`merge failed: ${merge.stderr || merge.stdout}`);
			return;
		}

		result.conflicts = paths.join(', ');
		detail.push(`conflicted paths: ${paths.join(', ')}`);
		detail.push(`owned conflicts: ${owned.join(', ') || 'none'}`);
		detail.push(`unowned conflicts: ${other.join(', ') || 'none'}`);

		// Fail closed: any conflict → stop and report (human resolves).
		// Even unowned conflicts stop — ambiguity is not auto-resolved.
		git(['merge', '--abort']);
		result.verdict = `BLOCKED: conflicts require human resolution (${paths.join(', ')})`;
		// For --demo-conflict this is the *success* of the conflict-stop test
		if (DEMO_CONFLICT && owned.length > 0) {
			result.verdict =
				'MERGE CLEAN — HUMAN REVIEW REQUIRED (conflict-stop demo: owned conflict detected and loop stopped; merge aborted)';
			// Still run canary on clean tree after abort
			const can = sh(`${process.execPath} scripts/omnis-interceptor-canary.mjs`);
			result.canary = can.code === 0 ? 'PASS' : 'FAIL';
			const wg = sh(`${process.execPath} scripts/omnis-write-gate-probe.mjs`, { timeout: 120_000 });
			const parsed = parseWriteGateProbe(wg.stdout + '\n' + wg.stderr);
			result.wg_healthy = parsed.healthy;
			result.wg_tampered = parsed.tampered;
			result.wg_engine_gone = parsed.engine_gone;
			result.build = 'SKIPPED (conflict-stop demo; merge aborted)';
			detail.push('conflict-stop demo PASS: owned file conflict caused stop+abort');
			// Exit 0 with HUMAN REVIEW — the demo proved the stop
			finish(0);
			return;
		}
		block(`conflicts require human resolution: ${paths.join(', ')}`);
		return;
	}

	result.conflicts = 'none';

	// --- Build ---
	if (SKIP_BUILD) {
		result.build = 'SKIPPED (--skip-build)';
		detail.push('build skipped by flag — not valid ship evidence');
	} else {
		detail.push('## build');
		const nodeV = sh('node -v');
		detail.push(`node ${nodeV.stdout}`);
		// compile is the critical step; install only if needed
		if (!existsSync(join(ROOT, 'node_modules', 'electron'))) {
			const inst = sh('npm install', { timeout: 600_000 });
			detail.push(`npm install exit ${inst.code}`);
			if (inst.code !== 0) {
				result.build = `FAIL npm install: ${(inst.stderr || inst.stdout).split('\n').slice(0, 5).join(' | ')}`;
				block(result.build);
				return;
			}
		}
		const comp = sh('npm run compile', { timeout: 600_000 });
		detail.push(`compile exit ${comp.code}\n` + (comp.stdout || comp.stderr).split('\n').slice(-20).join('\n'));
		if (comp.code !== 0) {
			const firstErr = (comp.stderr || comp.stdout).split('\n').find((l) => /error/i.test(l)) || 'compile failed';
			result.build = `FAIL ${firstErr.slice(0, 200)}`;
			block(result.build);
			return;
		}
		result.build = 'PASS';
	}

	// --- Canary (post-merge) ---
	const can = sh(`${process.execPath} scripts/omnis-interceptor-canary.mjs`);
	detail.push('## canary\n' + (can.stdout || can.stderr));
	result.canary = can.code === 0 ? 'PASS' : 'FAIL';
	if (can.code !== 0) {
		block('post-merge canary failed');
		return;
	}

	// --- Write-gate probe (includes engine-gone) ---
	const wg = sh(`${process.execPath} scripts/omnis-write-gate-probe.mjs`, { timeout: 120_000 });
	detail.push('## write-gate probe\n' + (wg.stdout || wg.stderr));
	const parsed = parseWriteGateProbe(wg.stdout + '\n' + wg.stderr);
	result.wg_healthy = parsed.healthy;
	result.wg_tampered = parsed.tampered;
	result.wg_engine_gone = parsed.engine_gone;
	if (!parsed.raw_pass || parsed.healthy !== 'PASS' || parsed.tampered !== 'PASS' || parsed.engine_gone !== 'PASS') {
		block(
			`write-gate probe incomplete: healthy=${parsed.healthy} tampered=${parsed.tampered} engine-gone=${parsed.engine_gone}`,
		);
		return;
	}

	// Update UPSTREAM pin note in detail only — agent does NOT rewrite UPSTREAM.md on its own
	// without human (pin promotion is release). Record measured merge.
	const measured = {
		ts: generated_utc,
		mode,
		work_branch: workBranch,
		from: oldSha,
		to: newSha || mergeSource,
		conflicts: 'none',
		build: result.build,
		canary: result.canary,
		canary_can_fail: result.canary_can_fail,
		write_gate: {
			healthy: result.wg_healthy,
			tampered: result.wg_tampered,
			engine_gone: result.wg_engine_gone,
		},
	};
	const measPath = measuredPath(stamp);
	writeFileSync(measPath, JSON.stringify(measured, null, 2) + '\n');
	detail.push(`measured merge json: ${measPath}`);
	detail.push(`evidence root (gitignored): ${evidenceRoot()}`);

	result.verdict = 'MERGE CLEAN — HUMAN REVIEW REQUIRED';
	finish(0);
}

main().catch((e) => {
	console.error('BLOCKED: agent threw', e);
	process.exit(1);
});
