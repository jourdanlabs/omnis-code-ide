/*---------------------------------------------------------------------------------------------
 *  Copyright (c) JourdanLabs. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URI } from '../../src/vs/base/common/uri.js';
import {
	checkChainSync,
	createGatedFs,
	resolveEnginePath,
	shouldGateParent,
	OMNIS_WRITE_REFUSED,
} from '../../src/vs/workbench/api/node/omnisWriteGate.js';

suite('OMNIS write gate', () => {

	test('resolveEnginePath finds omnis-key on this machine or null', () => {
		const p = resolveEnginePath();
		// Soft: if present it must exist on disk.
		if (p) {
			assert.ok(existsSync(p), p);
		}
	});

	test('shouldGateParent skips product out/ and built-in extensions', () => {
		const appRoot = '/Users/me/projects/omnis-code-ide';
		assert.strictEqual(shouldGateParent(URI.file(`${appRoot}/out/vs/workbench/api/node/x.js`), appRoot), false);
		assert.strictEqual(shouldGateParent(URI.file(`${appRoot}/extensions/git/out/main.js`), appRoot), false);
		assert.strictEqual(shouldGateParent(URI.file(`${appRoot}/node_modules/foo/index.js`), appRoot), false);
		assert.strictEqual(shouldGateParent(URI.file('/tmp/ext-dir/publisher.agent/extension.js'), appRoot), true);
	});

	test('shouldGateParent respects OMNIS_WRITE_GATE=off', () => {
		const prev = process.env.OMNIS_WRITE_GATE;
		process.env.OMNIS_WRITE_GATE = 'off';
		try {
			assert.strictEqual(shouldGateParent(URI.file('/tmp/user-ext/ext.js'), '/app'), false);
		} finally {
			if (prev === undefined) {
				delete process.env.OMNIS_WRITE_GATE;
			} else {
				process.env.OMNIS_WRITE_GATE = prev;
			}
		}
	});

	test('fail closed when engine path is nonsense', () => {
		const verdict = checkChainSync({
			...process.env,
			OMNIS_CODE_ENGINE_PATH: '/no/such/omnis-key-binary',
			OMNIS_KEY_PATH: '/no/such/omnis-key-binary',
			// clear PATH locations by pointing HOME at empty
			HOME: mkdtempSync(join(tmpdir(), 'omnis-empty-home-')),
		});
		assert.strictEqual(verdict.allow, false);
		assert.ok(verdict.code === 'ENGINE_UNREACHABLE' || !verdict.allow);
	});

	test('gated writeFileSync refuses when chain invalid (live engine)', function () {
		const engine = resolveEnginePath();
		if (!engine) {
			this.skip();
			return;
		}

		const home = mkdtempSync(join(tmpdir(), 'omnis-gate-invalid-'));
		const stateDir = join(home, 'state', 'omnis-key');
		mkdirSync(stateDir, { recursive: true, mode: 0o700 });
		// Bootstrap a valid chain, then corrupt the ledger.
		const ev = createHash('sha256').update('seed').digest('hex');
		const rec = spawnSync(engine, [
			'receipts', 'record',
			'--event-id', 'ide.test:seed',
			'--evidence-sha256', ev,
			'ide.test', 'seed',
			'--json',
		], { encoding: 'utf8', env: { ...process.env, JCODE_HOME: home } });
		assert.strictEqual(rec.status, 0, rec.stderr || rec.stdout);

		const ledger = join(stateDir, 'receipts.jsonl');
		assert.ok(existsSync(ledger));
		writeFileSync(ledger, readFileSync(ledger, 'utf8') + '\n{"tampered":true}\n');

		const realFs = require('fs');
		const gated = createGatedFs(realFs);
		const target = join(home, 'must-not-change.txt');
		writeFileSync(target, 'original');

		let threw = false;
		try {
			gated.writeFileSync(target, 'ATTACK');
		} catch (e: any) {
			threw = true;
			assert.ok(String(e.message).includes(OMNIS_WRITE_REFUSED) || e.code === OMNIS_WRITE_REFUSED, String(e));
		}
		assert.ok(threw, 'expected write to be refused');
		assert.strictEqual(readFileSync(target, 'utf8'), 'original', 'file on disk must be unchanged');
		rmSync(home, { recursive: true, force: true });
	});

	test('gated writeFileSync allows + records on healthy chain (live engine)', function () {
		const engine = resolveEnginePath();
		if (!engine) {
			this.skip();
			return;
		}

		const home = mkdtempSync(join(tmpdir(), 'omnis-gate-valid-'));
		mkdirSync(join(home, 'state', 'omnis-key'), { recursive: true, mode: 0o700 });
		// chmod private dirs — engine requires 0700 chain
		spawnSync('chmod', ['700', home, join(home, 'state'), join(home, 'state', 'omnis-key')]);

		const env = { ...process.env, JCODE_HOME: home };
		const realFs = require('fs');
		// Bind env into check by temporarily setting process.env
		const prevHome = process.env.JCODE_HOME;
		process.env.JCODE_HOME = home;
		try {
			const gated = createGatedFs(realFs);
			const target = join(home, 'allowed.txt');
			const body = `hello-${randomBytes(4).toString('hex')}`;
			gated.writeFileSync(target, body);
			assert.strictEqual(readFileSync(target, 'utf8'), body);

			const status = spawnSync(engine, ['receipts', 'status', '--json'], { encoding: 'utf8', env });
			assert.strictEqual(status.status, 0, status.stderr || status.stdout);
			assert.ok(status.stdout.includes('RECEIPT_CHAIN_VALID') || status.stdout.includes('VALID'), status.stdout);
		} finally {
			if (prevHome === undefined) {
				delete process.env.JCODE_HOME;
			} else {
				process.env.JCODE_HOME = prevHome;
			}
			rmSync(home, { recursive: true, force: true });
		}
	});
});
