/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JourdanLabs. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *
 *  OMNIS CODE IDE — extension-host write gate.
 *
 *  Reuses omnis-key for all receipt logic. This module only:
 *    1. consults `omnis-key receipts status --json` before mutating fs calls
 *    2. appends `omnis-key receipts record` after a successful write
 *    3. refuses (fail closed) when the engine is unreachable or the chain is bad
 *
 *  This is NOT a security sandbox. Escapes are documented in docs/HONEST_LIMITS.md.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { URI } from '../../../base/common/uri.js';

const STATUS_TIMEOUT_MS = 8_000;
const RECORD_TIMEOUT_MS = 8_000;

/** Error code thrown into the extension host when a write is refused. */
export const OMNIS_WRITE_REFUSED = 'OMNIS_WRITE_REFUSED';

export type GateVerdict =
	| { allow: true; code: 'RECEIPT_CHAIN_VALID' | 'EMPTY_NOT_YET_EVIDENCED' }
	| { allow: false; code: string; detail: string };

interface Envelope {
	schemaVersion?: number;
	command?: string;
	ok?: boolean;
	code?: string;
	data?: unknown;
}

/**
 * Methods on `fs` / `fs/promises` that this gate wraps.
 * Anything not listed is intentionally ungated — see docs/WRITE_GATE_COVERAGE.md.
 */
export const GATED_FS_METHODS = [
	'writeFile',
	'writeFileSync',
	'appendFile',
	'appendFileSync',
	'rm',
	'rmSync',
	'unlink',
	'unlinkSync',
	'rename',
	'renameSync',
	'mkdir',
	'mkdirSync',
	'createWriteStream',
	'copyFile',
	'copyFileSync',
	'cp',
	'cpSync',
] as const;

export const GATED_FS_PROMISES_METHODS = [
	'writeFile',
	'appendFile',
	'rm',
	'unlink',
	'rename',
	'mkdir',
	'copyFile',
	'cp',
] as const;

export function candidateEnginePaths(env: NodeJS.ProcessEnv = process.env): string[] {
	// Prefer env HOME so probes can isolate without seeing the real user install.
	const home = env.HOME || env.USERPROFILE || homedir();
	const out: string[] = [];
	if (env.OMNIS_CODE_ENGINE_PATH) {
		out.push(env.OMNIS_CODE_ENGINE_PATH);
	}
	if (env.OMNIS_KEY_PATH) {
		out.push(env.OMNIS_KEY_PATH);
	}
	out.push(
		join(home, '.local', 'bin', 'omnis-key'),
		join(home, '.cargo', 'bin', 'omnis-key'),
		'/usr/local/bin/omnis-key',
		'/opt/homebrew/bin/omnis-key',
	);
	return out;
}

/**
 * Resolve omnis-key. If the caller **explicitly** set OMNIS_CODE_ENGINE_PATH or
 * OMNIS_KEY_PATH and that path is missing, return null (fail closed) — do not
 * silently fall through to another binary.
 */
export function resolveEnginePath(env: NodeJS.ProcessEnv = process.env): string | null {
	const explicit = (env.OMNIS_CODE_ENGINE_PATH || env.OMNIS_KEY_PATH || '').trim();
	if (explicit) {
		return existsSync(explicit) ? explicit : null;
	}
	for (const p of candidateEnginePaths(env)) {
		if (p && existsSync(p)) {
			return p;
		}
	}
	return null;
}

function parseEnvelope(stdout: string): Envelope | null {
	const text = stdout.trim();
	if (!text) {
		return null;
	}
	try {
		return JSON.parse(text) as Envelope;
	} catch {
		// Tolerated legacy: `TOKEN {json}`
		const space = text.indexOf(' ');
		if (space > 0) {
			try {
				return JSON.parse(text.slice(space + 1)) as Envelope;
			} catch {
				return null;
			}
		}
		return null;
	}
}

/**
 * Fail-closed chain check. Branch on `code`, never on `ok` alone
 * (EMPTY_NOT_YET_EVIDENCED is ok:false / exit 3 but is a healthy fresh ledger).
 */
export function checkChainSync(env: NodeJS.ProcessEnv = process.env): GateVerdict {
	const engine = resolveEnginePath(env);
	if (!engine) {
		return {
			allow: false,
			code: 'ENGINE_UNREACHABLE',
			detail: 'omnis-key not found on PATH or known install locations (fail closed)',
		};
	}

	const result = spawnSync(engine, ['receipts', 'status', '--json'], {
		encoding: 'utf8',
		timeout: STATUS_TIMEOUT_MS,
		env,
	});

	if (result.error) {
		return {
			allow: false,
			code: 'ENGINE_UNREACHABLE',
			detail: `omnis-key spawn failed: ${result.error.message}`,
		};
	}

	const envelope = parseEnvelope(String(result.stdout ?? ''));
	if (!envelope || typeof envelope.code !== 'string') {
		const detail = String(result.stderr || result.stdout || 'engine produced no parseable output').split('\n')[0]!.slice(0, 300);
		return { allow: false, code: 'ENGINE_UNREACHABLE', detail };
	}

	switch (envelope.code) {
		case 'RECEIPT_CHAIN_VALID':
			return { allow: true, code: 'RECEIPT_CHAIN_VALID' };
		case 'EMPTY_NOT_YET_EVIDENCED':
			// Fresh install: allow so the first write can bootstrap the chain.
			return { allow: true, code: 'EMPTY_NOT_YET_EVIDENCED' };
		case 'RECEIPT_CHAIN_INVALID':
		case 'RECEIPT_STATE_UNSAFE':
			return {
				allow: false,
				code: envelope.code,
				detail: `write refused: ledger state ${envelope.code}`,
			};
		default:
			return {
				allow: false,
				code: envelope.code,
				detail: `write refused: unrecognized engine code ${envelope.code}`,
			};
	}
}

export function recordWriteSync(
	kind: string,
	subject: string,
	evidenceMaterial: string,
	env: NodeJS.ProcessEnv = process.env,
): { ok: true; receiptSha256?: string } | { ok: false; detail: string } {
	const engine = resolveEnginePath(env);
	if (!engine) {
		return { ok: false, detail: 'omnis-key not found after write (cannot record receipt)' };
	}

	const evidenceSha256 = createHash('sha256').update(evidenceMaterial).digest('hex');
	const eventId = `ide.fs:${kind}:${randomUUID()}`;

	const result = spawnSync(
		engine,
		[
			'receipts', 'record',
			'--event-id', eventId,
			'--evidence-sha256', evidenceSha256,
			`ide.fs.${kind}`,
			subject.slice(0, 500),
			'--json',
		],
		{ encoding: 'utf8', timeout: RECORD_TIMEOUT_MS, env },
	);

	if (result.error) {
		return { ok: false, detail: result.error.message };
	}

	const envelope = parseEnvelope(String(result.stdout ?? ''));
	if (!envelope || envelope.ok !== true) {
		const detail = String(result.stderr || result.stdout || 'record failed').split('\n')[0]!.slice(0, 300);
		return { ok: false, detail };
	}

	const data = envelope.data as { receiptSha256?: string } | null;
	return { ok: true, receiptSha256: data?.receiptSha256 };
}

function refuseError(verdict: Extract<GateVerdict, { allow: false }>): Error {
	const err = new Error(`[${OMNIS_WRITE_REFUSED}] ${verdict.detail}`) as Error & { code: string };
	err.code = OMNIS_WRITE_REFUSED;
	return err;
}

function pathArg(args: unknown[]): string {
	const a = args[0];
	if (typeof a === 'string') {
		return a;
	}
	if (a && typeof a === 'object' && 'toString' in a) {
		return String(a);
	}
	return '<unknown-path>';
}

/**
 * Whether this requiring module should receive a gated `fs`.
 * Built-in product code and built-in extensions get the real module so a
 * missing engine does not brick the workbench. User / third-party extensions
 * are gated — that is the ordinary agent write path.
 */
export function shouldGateParent(parent: URI, appRoot: string | undefined): boolean {
	// Kill-switch for emergency recovery / local debugging.
	if (process.env.OMNIS_WRITE_GATE === '0' || process.env.OMNIS_WRITE_GATE === 'off') {
		return false;
	}

	const p = parent.fsPath;
	if (!p) {
		return true;
	}

	// Always gate when forced (probe / demo mode).
	if (process.env.OMNIS_WRITE_GATE === 'all') {
		return true;
	}

	if (appRoot) {
		const root = appRoot.replace(/\\/g, '/');
		const norm = p.replace(/\\/g, '/');
		if (norm.startsWith(root + '/out/') || norm.startsWith(root + '/out')) {
			return false;
		}
		if (norm.includes(root + '/extensions/')) {
			return false;
		}
		if (norm.includes(root + '/node_modules/')) {
			return false;
		}
		if (norm.includes(root + '/.build/')) {
			return false;
		}
	}

	return true;
}

type AnyFn = (...args: any[]) => any;

function wrapSyncMethod(real: AnyFn, method: string): AnyFn {
	return function gatedSync(this: unknown, ...args: unknown[]) {
		const verdict = checkChainSync();
		if (!verdict.allow) {
			throw refuseError(verdict);
		}
		const result = real.apply(this, args);
		const subject = pathArg(args);
		const material = `${method}\0${subject}\0${Date.now()}`;
		const rec = recordWriteSync(method, subject, material);
		if (!rec.ok) {
			// Write already landed; surface the receipt failure without inventing success.
			const err = new Error(`[OMNIS_RECEIPT_RECORD_FAILED] write completed but receipt was not recorded: ${rec.detail}`) as Error & { code: string };
			err.code = 'OMNIS_RECEIPT_RECORD_FAILED';
			throw err;
		}
		return result;
	};
}

function wrapAsyncCallbackMethod(real: AnyFn, method: string): AnyFn {
	return function gatedAsync(this: unknown, ...args: unknown[]) {
		const cb = typeof args[args.length - 1] === 'function' ? args[args.length - 1] as AnyFn : undefined;
		const callArgs = cb ? args.slice(0, -1) : args;

		const verdict = checkChainSync();
		if (!verdict.allow) {
			const err = refuseError(verdict);
			if (cb) {
				process.nextTick(() => cb(err));
				return;
			}
			return Promise.reject(err);
		}

		if (cb) {
			return real.apply(this, [
				...callArgs,
				(error: Error | null, ...rest: unknown[]) => {
					if (error) {
						cb(error, ...rest);
						return;
					}
					const subject = pathArg(callArgs);
					const material = `${method}\0${subject}\0${Date.now()}`;
					const rec = recordWriteSync(method, subject, material);
					if (!rec.ok) {
						const err = new Error(`[OMNIS_RECEIPT_RECORD_FAILED] write completed but receipt was not recorded: ${rec.detail}`) as Error & { code: string };
						err.code = 'OMNIS_RECEIPT_RECORD_FAILED';
						cb(err);
						return;
					}
					cb(null, ...rest);
				},
			]);
		}

		// Promise form (Node fs promises-style on some methods when no callback).
		return Promise.resolve(real.apply(this, callArgs)).then((result: unknown) => {
			const subject = pathArg(callArgs);
			const material = `${method}\0${subject}\0${Date.now()}`;
			const rec = recordWriteSync(method, subject, material);
			if (!rec.ok) {
				const err = new Error(`[OMNIS_RECEIPT_RECORD_FAILED] write completed but receipt was not recorded: ${rec.detail}`) as Error & { code: string };
				err.code = 'OMNIS_RECEIPT_RECORD_FAILED';
				throw err;
			}
			return result;
		});
	};
}

function wrapPromiseMethod(real: AnyFn, method: string): AnyFn {
	return async function gatedPromise(this: unknown, ...args: unknown[]) {
		const verdict = checkChainSync();
		if (!verdict.allow) {
			throw refuseError(verdict);
		}
		const result = await real.apply(this, args);
		const subject = pathArg(args);
		const material = `${method}\0${subject}\0${Date.now()}`;
		const rec = recordWriteSync(method, subject, material);
		if (!rec.ok) {
			const err = new Error(`[OMNIS_RECEIPT_RECORD_FAILED] write completed but receipt was not recorded: ${rec.detail}`) as Error & { code: string };
			err.code = 'OMNIS_RECEIPT_RECORD_FAILED';
			throw err;
		}
		return result;
	};
}

function wrapCreateWriteStream(real: AnyFn): AnyFn {
	return function gatedCreateWriteStream(this: unknown, ...args: unknown[]) {
		const verdict = checkChainSync();
		if (!verdict.allow) {
			throw refuseError(verdict);
		}
		const stream = real.apply(this, args);
		const subject = pathArg(args);
		const material = `createWriteStream\0${subject}\0${Date.now()}`;
		// Record intent-to-write at stream open. Stream errors after this are not rolled back.
		const rec = recordWriteSync('createWriteStream', subject, material);
		if (!rec.ok) {
			try {
				stream.destroy?.();
			} catch {
				// ignore
			}
			const err = new Error(`[OMNIS_RECEIPT_RECORD_FAILED] stream opened but receipt was not recorded: ${rec.detail}`) as Error & { code: string };
			err.code = 'OMNIS_RECEIPT_RECORD_FAILED';
			throw err;
		}
		return stream;
	};
}

/**
 * Build a gated view of the real `fs` module exports.
 * Read methods pass through untouched.
 */
/** Live gated instances for the ESM shim (same isolate as the extension host). */
const GATED_FS_GLOBAL = Symbol.for('omnis.code.gated.fs');
const GATED_FSP_GLOBAL = Symbol.for('omnis.code.gated.fs.promises');

export function publishGatedGlobals(gatedFs: any, gatedPromises: any): void {
	(globalThis as any)[GATED_FS_GLOBAL] = gatedFs;
	(globalThis as any)[GATED_FSP_GLOBAL] = gatedPromises;
}

export function gatedFsGlobalKey(): symbol {
	return GATED_FS_GLOBAL;
}

export function gatedFsPromisesGlobalKey(): symbol {
	return GATED_FSP_GLOBAL;
}

function defineDataProperty(target: any, key: string, value: unknown): void {
	try {
		Object.defineProperty(target, key, {
			value,
			writable: true,
			enumerable: true,
			configurable: true,
		});
	} catch {
		try {
			target[key] = value;
		} catch {
			// non-configurable — leave prototype fallback
		}
	}
}

export function createGatedFs(realFs: any): any {
	// Plain object (not Object.create) so we can redefine getter-only props like `promises`.
	const gated: any = {};

	for (const key of Object.getOwnPropertyNames(realFs)) {
		if (key === 'promises') {
			continue;
		}
		try {
			const desc = Object.getOwnPropertyDescriptor(realFs, key);
			if (desc && 'value' in desc) {
				defineDataProperty(gated, key, typeof desc.value === 'function' ? desc.value.bind(realFs) : desc.value);
			} else if (desc?.get) {
				Object.defineProperty(gated, key, {
					get: () => realFs[key],
					enumerable: desc.enumerable,
					configurable: true,
				});
			}
		} catch {
			// ignore
		}
	}

	const syncNames = ['writeFileSync', 'appendFileSync', 'rmSync', 'unlinkSync', 'renameSync', 'mkdirSync', 'copyFileSync', 'cpSync'] as const;
	const asyncNames = ['writeFile', 'appendFile', 'rm', 'unlink', 'rename', 'mkdir', 'copyFile', 'cp'] as const;

	for (const name of syncNames) {
		if (typeof realFs[name] === 'function') {
			defineDataProperty(gated, name, wrapSyncMethod(realFs[name].bind(realFs), name));
		}
	}
	for (const name of asyncNames) {
		if (typeof realFs[name] === 'function') {
			defineDataProperty(gated, name, wrapAsyncCallbackMethod(realFs[name].bind(realFs), name));
		}
	}
	if (typeof realFs.createWriteStream === 'function') {
		defineDataProperty(gated, 'createWriteStream', wrapCreateWriteStream(realFs.createWriteStream.bind(realFs)));
	}

	if (realFs.promises) {
		defineDataProperty(gated, 'promises', createGatedFsPromises(realFs.promises));
	}

	return gated;
}

export function createGatedFsPromises(realPromises: any): any {
	const gated: any = {};
	for (const key of Object.getOwnPropertyNames(realPromises)) {
		try {
			const desc = Object.getOwnPropertyDescriptor(realPromises, key);
			if (desc && 'value' in desc) {
				defineDataProperty(gated, key, typeof desc.value === 'function' ? desc.value.bind(realPromises) : desc.value);
			}
		} catch {
			// ignore
		}
	}
	for (const name of GATED_FS_PROMISES_METHODS) {
		if (typeof realPromises[name] === 'function') {
			defineDataProperty(gated, name, wrapPromiseMethod(realPromises[name].bind(realPromises), `promises.${name}`));
		}
	}
	return gated;
}
