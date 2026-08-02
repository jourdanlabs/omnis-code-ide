#!/usr/bin/env node
/**
 * Prove the write-gate probe can fail (not decoration).
 *
 * Mutates the *compiled* gate to always allow writes, runs the probe, expects
 * non-zero exit, restores compiled file.
 *
 * Exit 0 = probe-can-fail PASS
 * Exit 1 = probe is fake-green or restore failed
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outGate = join(root, 'out/vs/workbench/api/node/omnisWriteGate.js');
const probe = join(root, 'scripts/omnis-write-gate-probe.mjs');
const bak = join(root, '.omnis-write-gate-can-fail.bak');

function die(msg) {
	console.error('WRITE-GATE-CAN-FAIL FAIL:', msg);
	try {
		if (existsSync(bak)) {
			copyFileSync(bak, outGate);
			unlinkSync(bak);
		}
	} catch (e) {
		console.error('restore error:', e.message);
	}
	process.exit(1);
}

if (!existsSync(outGate)) {
	die(`compiled gate missing: ${outGate} — run npm run compile first`);
}
if (!existsSync(probe)) {
	die(`missing ${probe}`);
}

copyFileSync(outGate, bak);
const original = readFileSync(outGate, 'utf8');

// Gut fail-closed: force checkChainSync to always allow.
// Match export function checkChainSync ... and replace body start.
const marker = 'function checkChainSync';
const idx = original.indexOf(marker);
if (idx < 0) {
	die('could not find checkChainSync in compiled gate');
}
// Inject early return allow after function opening brace of checkChainSync export
// Compiled form may be: function checkChainSync(env = process.env) {
const re = /function checkChainSync\s*\([^)]*\)\s*\{/;
if (!re.test(original)) {
	die('checkChainSync shape not recognized in compiled output');
}
const mutated = original.replace(
	re,
	(m) =>
		`${m}\n\treturn { allow: true, code: 'RECEIPT_CHAIN_VALID' }; // OMNIS_WRITE_GATE_CAN_FAIL mutation\n`,
);

if (mutated === original) {
	die('mutation did not change compiled gate');
}
writeFileSync(outGate, mutated);

const r = spawnSync(process.execPath, [probe], { encoding: 'utf8', cwd: root, env: process.env });
const code = r.status === null ? 99 : r.status;

// Restore before interpreting
copyFileSync(bak, outGate);
unlinkSync(bak);

if (code === 0) {
	die(
		'write-gate probe PASSED after checkChainSync was gutted to always-allow — probe is decoration. ' +
			`stdout=${(r.stdout || '').slice(0, 500)}`,
	);
}

console.log('OK  probe failed after always-allow mutation (exit', code + ')');
console.log('    first fail line:', (r.stdout || r.stderr || '').split('\n').find((l) => l.includes('FAIL')) || '(see full output)');

// Sanity: probe passes again on restored build
const r2 = spawnSync(process.execPath, [probe], { encoding: 'utf8', cwd: root, env: process.env });
if (r2.status !== 0) {
	die(`probe still failing after restore (exit ${r2.status}): ${(r2.stdout || r2.stderr || '').slice(0, 400)}`);
}
console.log('OK  probe passed after restore');
console.log('WRITE-GATE-CAN-FAIL PASS — probe fails when gate is gutted, passes when restored.');
process.exit(0);
