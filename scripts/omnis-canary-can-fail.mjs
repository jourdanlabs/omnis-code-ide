#!/usr/bin/env node
/**
 * §3 load-bearing check: prove the canary can fail.
 *
 * 1. Snapshot interceptor host file
 * 2. Remove live registration (the attachment that makes the gate take)
 * 3. Run canary → MUST exit nonzero
 * 4. Restore snapshot
 * 5. Run canary → MUST exit zero
 *
 * If step 3 passes, the canary is decoration and the merge agent is dangerous.
 *
 * Exit 0 = canary-can-fail PASS (canary failed when it should, passed when restored)
 * Exit 1 = canary is broken / fake-green
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hostPath = join(root, 'src/vs/workbench/api/node/extHostExtensionService.ts');
const canary = join(root, 'scripts/omnis-interceptor-canary.mjs');
const bak = join(root, '.omnis-canary-can-fail.bak');

function runCanary() {
	const r = spawnSync(process.execPath, [canary], { encoding: 'utf8', cwd: root });
	return {
		code: r.status === null ? 99 : r.status,
		stdout: r.stdout || '',
		stderr: r.stderr || '',
	};
}

function die(msg) {
	console.error('CANARY-CAN-FAIL FAIL:', msg);
	// Always try restore
	try {
		if (existsSync(bak)) {
			copyFileSync(bak, hostPath);
			unlinkSync(bak);
		}
	} catch (e) {
		console.error('restore error:', e.message);
	}
	process.exit(1);
}

if (!existsSync(hostPath)) {
	die(`missing ${hostPath}`);
}
if (!existsSync(canary)) {
	die(`missing ${canary}`);
}

copyFileSync(hostPath, bak);
const original = readFileSync(hostPath, 'utf8');

// Mutation: strip live registration calls (leave class so other markers may remain —
// canary must still fail on the register() call specifically).
let mutated = original
	.replace(
		/requireInterceptor\.register\(\s*new\s+OmnisFsModuleFactory\s*\(\s*\)\s*\)\s*;/g,
		'/* OMNIS_CANARY_CAN_FAIL: registration removed */',
	)
	.replace(
		/requireInterceptor\.register\(\s*new\s+OmnisFsPromisesModuleFactory\s*\(\s*\)\s*\)\s*;/g,
		'/* OMNIS_CANARY_CAN_FAIL: promises registration removed */',
	);

if (mutated === original) {
	die('could not locate registration call to remove — canary mutation ineffective');
}

writeFileSync(hostPath, mutated);

const afterRemove = runCanary();
if (afterRemove.code === 0) {
	die(
		'canary PASSED after interceptor registration removed — decoration, not a canary. ' +
			`stdout=${afterRemove.stdout.trim()} stderr=${afterRemove.stderr.trim()}`,
	);
}
console.log('OK  canary failed after patch removal (exit', afterRemove.code + ')');
console.log('    ', (afterRemove.stderr || afterRemove.stdout).trim().split('\n')[0]);

// Restore
copyFileSync(bak, hostPath);
unlinkSync(bak);

const afterRestore = runCanary();
if (afterRestore.code !== 0) {
	die(
		'canary failed after restore — tree dirty or canary broken. ' +
			`stderr=${afterRestore.stderr.trim()}`,
	);
}
console.log('OK  canary passed after restore');

console.log('CANARY-CAN-FAIL PASS — canary fails when patch is removed, passes when restored.');
process.exit(0);
