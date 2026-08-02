#!/usr/bin/env node
/**
 * W7 canary — fails if the write-gate attachment points disappear or become inert.
 *
 * Worth more than the patch: a green probe with a missing interceptor is a lie.
 *
 * Exit 0 = attachment points present as live code.
 * Exit 1 = missing / gutted / comment-only decoration.
 *
 * Adversarial notes (W7-A):
 *  - Plain string includes() is not enough — a comment can fake a marker.
 *  - We strip line+block comments before matching, then require structural shapes.
 *  - Registration must look like a live call, not a string in a docblock.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hostPath = join(root, 'src/vs/workbench/api/node/extHostExtensionService.ts');
const gatePath = join(root, 'src/vs/workbench/api/node/omnisWriteGate.ts');

function fail(msg) {
	console.error('CANARY FAIL:', msg);
	process.exit(1);
}

/** Strip // and /* *\/ comments so markers cannot hide as decoration. */
function stripComments(src) {
	// Block comments first, then line comments. Not a full TS parser — good enough
	// to defeat "leave the string in a comment" fake-green.
	return src
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function requireLive(haystack, needle, label) {
	if (!haystack.includes(needle)) {
		fail(`${label}: live code missing ${JSON.stringify(needle)}`);
	}
}

if (!existsSync(hostPath)) {
	fail(`missing ${hostPath}`);
}
if (!existsSync(gatePath)) {
	fail(`missing ${gatePath}`);
}

const hostRaw = readFileSync(hostPath, 'utf8');
const gateRaw = readFileSync(gatePath, 'utf8');
const host = stripComments(hostRaw);
const gate = stripComments(gateRaw);

// --- Host attachment (extHostExtensionService.ts) ---
requireLive(host, 'class OmnisFsModuleFactory', 'host');
requireLive(host, 'class OmnisFsPromisesModuleFactory', 'host');
// Live registration — must remain a call expression after comment strip.
requireLive(host, 'requireInterceptor.register(new OmnisFsModuleFactory())', 'host');
requireLive(host, 'requireInterceptor.register(new OmnisFsPromisesModuleFactory())', 'host');
// ESM path for fs
requireLive(host, "specifier === 'fs'", 'host');
requireLive(host, "specifier === 'node:fs'", 'host');
requireLive(host, 'class NodeModuleRequireInterceptor', 'host');
// Gated module global key used by ESM shim
requireLive(host, 'omnis.code.gated.fs', 'host');

// Structural: factory load must consult shouldGateParent / ensureGatedModules
if (!/class\s+OmnisFsModuleFactory[\s\S]*?load\s*\(/.test(host)) {
	fail('host: OmnisFsModuleFactory has no load() method');
}
if (!host.includes('shouldGateParent') || !host.includes('ensureGatedModules')) {
	fail('host: gate decision helpers missing from live code');
}

// --- Gate module (omnisWriteGate.ts) ---
requireLive(gate, 'export function checkChainSync', 'gate');
requireLive(gate, 'export function createGatedFs', 'gate');
requireLive(gate, 'OMNIS_WRITE_REFUSED', 'gate');
requireLive(gate, 'ENGINE_UNREACHABLE', 'gate');
requireLive(gate, "receipts', 'status'", 'gate');
// Fail-closed: unreachable must refuse
if (!/allow:\s*false[\s\S]{0,80}ENGINE_UNREACHABLE/.test(gate) && !/ENGINE_UNREACHABLE[\s\S]{0,80}allow:\s*false/.test(gate)) {
	// looser: both tokens present in function
	if (!(gate.includes('ENGINE_UNREACHABLE') && gate.includes('allow: false'))) {
		fail('gate: fail-closed ENGINE_UNREACHABLE path not evident in live code');
	}
}
// Invalid chain must refuse
requireLive(gate, 'RECEIPT_CHAIN_INVALID', 'gate');
requireLive(gate, 'RECEIPT_STATE_UNSAFE', 'gate');

// Compiled output: if present, must still carry the refusal code (stale out/ is a lie).
const outGate = join(root, 'out/vs/workbench/api/node/omnisWriteGate.js');
if (existsSync(outGate)) {
	const out = stripComments(readFileSync(outGate, 'utf8'));
	if (!out.includes('OMNIS_WRITE_REFUSED')) {
		fail('compiled omnisWriteGate.js missing OMNIS_WRITE_REFUSED (stale or gutted build)');
	}
	if (!out.includes('ENGINE_UNREACHABLE')) {
		fail('compiled omnisWriteGate.js missing ENGINE_UNREACHABLE');
	}
}

console.log('CANARY PASS — interceptor + write-gate attachment present as live code.');
process.exit(0);
