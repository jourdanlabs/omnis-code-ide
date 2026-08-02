#!/usr/bin/env node
/**
 * Standalone W2 probe — no IDE required.
 * Exercises omnisWriteGate against a live omnis-key binary.
 *
 * Usage:
 *   node scripts/omnis-write-gate-probe.mjs
 *
 * Exit 0 = all assertions held. Nonzero = gate failed its own claims.
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

function findEngine() {
  const candidates = [
    process.env.OMNIS_CODE_ENGINE_PATH,
    process.env.OMNIS_KEY_PATH,
    join(homedir(), '.local', 'bin', 'omnis-key'),
    join(homedir(), '.cargo', 'bin', 'omnis-key'),
    '/usr/local/bin/omnis-key',
    '/opt/homebrew/bin/omnis-key',
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('OK  ', msg);
}

// Load compiled gate (after npm run compile / transpile of that file).
const gatePath = join(repoRoot, 'out/vs/workbench/api/node/omnisWriteGate.js');
if (!existsSync(gatePath)) {
  console.error('Compiled gate missing. Run: npm run compile   (or compile-client)');
  console.error('Expected:', gatePath);
  process.exit(2);
}

const require = createRequire(import.meta.url);
const gate = await import(gatePath);
const {
  checkChainSync,
  createGatedFs,
  resolveEnginePath,
  OMNIS_WRITE_REFUSED,
} = gate;

const engine = findEngine();
assert(engine, `omnis-key found at ${engine}`);
assert(resolveEnginePath(), 'resolveEnginePath sees engine');

// --- A: engine removed / nonsense path → refuse ---
{
  const verdict = checkChainSync({
    ...process.env,
    OMNIS_CODE_ENGINE_PATH: '/no/such/omnis-key',
    OMNIS_KEY_PATH: '/no/such/omnis-key',
    HOME: mkdtempSync(join(tmpdir(), 'empty-home-')),
    PATH: '/usr/bin:/bin',
  });
  assert(verdict.allow === false, `engine unreachable refuses (code=${verdict.code})`);
}

// --- B: healthy ledger → write lands + receipt ---
{
  const home = mkdtempSync(join(tmpdir(), 'omnis-healthy-'));
  mkdirSync(join(home, 'state', 'omnis-key'), { recursive: true });
  chmodSync(home, 0o700);
  chmodSync(join(home, 'state'), 0o700);
  chmodSync(join(home, 'state', 'omnis-key'), 0o700);

  const prev = process.env.JCODE_HOME;
  process.env.JCODE_HOME = home;
  try {
    const realFs = require('fs');
    const gated = createGatedFs(realFs);
    const target = join(home, 'allowed.txt');
    const body = `ok-${randomBytes(4).toString('hex')}`;
    gated.writeFileSync(target, body);
    assert(readFileSync(target, 'utf8') === body, 'healthy chain: file content written');

    const st = spawnSync(engine, ['receipts', 'status', '--json'], {
      encoding: 'utf8',
      env: { ...process.env, JCODE_HOME: home },
    });
    assert(st.status === 0, `receipts status exit 0: ${st.stdout || st.stderr}`);
    assert(st.stdout.includes('RECEIPT_CHAIN_VALID'), `receipt exists / chain valid: ${st.stdout}`);
  } finally {
    if (prev === undefined) delete process.env.JCODE_HOME;
    else process.env.JCODE_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
}

// --- C: tampered ledger → file on disk unchanged ---
{
  const home = mkdtempSync(join(tmpdir(), 'omnis-tamper-'));
  const stateDir = join(home, 'state', 'omnis-key');
  mkdirSync(stateDir, { recursive: true });
  chmodSync(home, 0o700);
  chmodSync(join(home, 'state'), 0o700);
  chmodSync(stateDir, 0o700);

  const ev = createHash('sha256').update('seed').digest('hex');
  const rec = spawnSync(
    engine,
    ['receipts', 'record', '--event-id', 'seed1', '--evidence-sha256', ev, 'ide.test', 'seed', '--json'],
    { encoding: 'utf8', env: { ...process.env, JCODE_HOME: home } },
  );
  assert(rec.status === 0, `seed receipt: ${rec.stdout || rec.stderr}`);

  const ledger = join(stateDir, 'receipts.jsonl');
  writeFileSync(ledger, readFileSync(ledger, 'utf8') + '\n{"tampered":true}\n');

  const target = join(home, 'protected.txt');
  writeFileSync(target, 'ORIGINAL');

  const prev = process.env.JCODE_HOME;
  process.env.JCODE_HOME = home;
  try {
    const realFs = require('fs');
    const gated = createGatedFs(realFs);
    let threw = false;
    try {
      gated.writeFileSync(target, 'ATTACK');
    } catch (e) {
      threw = true;
      assert(
        String(e.message).includes(OMNIS_WRITE_REFUSED) || e.code === OMNIS_WRITE_REFUSED,
        `refusal error shape: ${e}`,
      );
    }
    assert(threw, 'tampered chain throws');
    assert(readFileSync(target, 'utf8') === 'ORIGINAL', '🔴 file on disk unchanged after refusal');
  } finally {
    if (prev === undefined) delete process.env.JCODE_HOME;
    else process.env.JCODE_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  }
}

console.log('\nW2 probe PASS — healthy write+receipt, tampered refuse+unchanged, unreachable refuse.');
