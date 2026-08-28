#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, openSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { parseStrictJson, parseVault, signVerification, sha256Hex, VERIFICATION_RECEIPT_SCHEMA } from '../core.mjs';

function usage() {
  return `foundry-verifier --vault <path> --allowlist <path>\n\nRuns operator-controlled verification commands and signs a foundry-verification-receipt-v1.\nThe command output is not embedded; only stdout/stderr digests and execution metadata are stored.`;
}

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

async function terminalPassphrase() {
  let ttyFd;
  let input;
  let output;
  try {
    ttyFd = openSync('/dev/tty', 'r+');
    input = createReadStream('', { fd: ttyFd, autoClose: false });
    output = createWriteStream('', { fd: ttyFd, autoClose: false });
  } catch {
    if (!stdin.isTTY) throw new Error('A controlling terminal is required for passphrase entry.');
    input = stdin;
    output = process.stderr;
    ttyFd = 0;
  }
  const rl = createInterface({ input, output, terminal: true });
  output.write('Vault passphrase: ');
  spawnSync('stty', ['-echo'], { stdio: [ttyFd, ttyFd, ttyFd] });
  try {
    return await rl.question('');
  } finally {
    spawnSync('stty', ['echo'], { stdio: [ttyFd, ttyFd, ttyFd] });
    output.write('\n');
    rl.close();
  }
}

function assertAllowlist(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new Error('Allowlist must be a JSON object.');
  if (plan.schema !== 'foundry-verifier-allowlist-v1') throw new Error('Unsupported allowlist schema.');
  if (!/^res_[a-f0-9]{24}$/.test(plan.resultId)) throw new Error('Malformed resultId.');
  if (!/^sha256:[a-f0-9]{64}$/.test(plan.resultReceiptSha256)) throw new Error('Malformed resultReceiptSha256.');
  if (!/^[a-f0-9]{40}$/.test(plan.candidateCommit)) throw new Error('Malformed candidateCommit.');
  if (!Array.isArray(plan.checks) || plan.checks.length < 1 || plan.checks.length > 20) throw new Error('Allowlist must contain 1-20 checks.');
  for (const check of plan.checks) {
    if (!check || typeof check !== 'object' || Array.isArray(check)) throw new Error('Each check must be an object.');
    if (typeof check.id !== 'string' || !/^[a-z0-9][a-z0-9_.:-]{1,63}$/.test(check.id)) throw new Error('Malformed check id.');
    if (!Array.isArray(check.command) || check.command.length < 1 || check.command.length > 16) throw new Error('Each check command must be argv array length 1-16.');
    if (!check.command.every((part) => typeof part === 'string' && part.length > 0 && part.length <= 300)) throw new Error('Command arguments must be bounded strings.');
    if (typeof check.cwd !== 'undefined' && (typeof check.cwd !== 'string' || check.cwd.length > 500)) throw new Error('Malformed check cwd.');
    if (typeof check.timeoutMs !== 'undefined' && (!Number.isSafeInteger(check.timeoutMs) || check.timeoutMs < 100 || check.timeoutMs > 3_600_000)) throw new Error('Malformed check timeout.');
  }
}

function hashBytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function resolveExecutable(name) {
  if (name.includes('/')) return name;
  const found = spawnSync('which', [name], { encoding: 'utf8' });
  if (found.status !== 0) throw new Error(`Executable not found: ${name}`);
  return found.stdout.trim();
}

async function executableDigest(name) {
  const resolved = resolveExecutable(name);
  return hashBytes(await readFile(resolved));
}

async function runCheck(check) {
  const started = performance.now();
  const result = spawnSync(check.command[0], check.command.slice(1), {
    cwd: check.cwd,
    shell: false,
    encoding: 'buffer',
    timeout: check.timeoutMs ?? 600_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const durationMs = Math.round(performance.now() - started);
  if (result.error && result.error.code !== 'ETIMEDOUT') throw result.error;
  const exitCode = result.status === null ? 124 : result.status;
  return {
    id: check.id,
    executableSha256: await executableDigest(check.command[0]),
    argvSha256: `sha256:${sha256Hex(JSON.stringify(check.command))}`,
    exitCode,
    stdoutSha256: hashBytes(result.stdout ?? Buffer.alloc(0)),
    stderrSha256: hashBytes(result.stderr ?? Buffer.alloc(0)),
    durationMs,
  };
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    stdout.write(`${usage()}\n`);
    return;
  }
  if (process.argv.some((value) => /pass(word|phrase)/i.test(value))) throw new Error('Passphrase arguments are forbidden.');
  const vaultPath = option('--vault');
  const allowlistPath = option('--allowlist');
  if (!vaultPath || !allowlistPath) throw new Error('Both --vault and --allowlist are required.');
  const [vault, plan] = await Promise.all([
    readFile(vaultPath, 'utf8').then((text) => parseVault(JSON.parse(text))),
    readFile(allowlistPath).then((bytes) => parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes))),
  ]);
  assertAllowlist(plan);
  const checks = [];
  for (const check of plan.checks) checks.push(await runCheck(check));
  const unsigned = {
    schema: VERIFICATION_RECEIPT_SCHEMA,
    resultId: plan.resultId,
    resultReceiptSha256: plan.resultReceiptSha256,
    candidateCommit: plan.candidateCommit,
    verifierDid: vault.did,
    checks,
    createdAt: new Date().toISOString(),
  };
  const signed = signVerification(vault, await terminalPassphrase(), unsigned);
  stdout.write(`${JSON.stringify(signed)}\n`);
  if (checks.some((check) => check.exitCode !== 0)) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`foundry-verifier: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
