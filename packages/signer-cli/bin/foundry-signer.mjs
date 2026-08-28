#!/usr/bin/env node
import { chmod, open, readFile } from 'node:fs/promises';
import { createReadStream, createWriteStream, openSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createVault, parseStrictJson, parseVault, signEvent, signReview, signTcr1, signTechnocore, signVerification, unlockVault } from '../core.mjs';
import { MAX_DOSSIER_BYTES, verifyContributionDossierBytes } from '../dossier.mjs';

function usage() {
  return `foundry-signer <command> [options]\n\nVault commands:\n  init               create a browser-compatible encrypted vault\n  did                print the public DID without unlocking\n  doctor             unlock and perform a sign/verify recovery test\n  sign-event         sign an unsigned foundry-event-v1 object\n  sign-tcr1          sign an unsigned TCR-1 receipt\n  sign-verification  sign an unsigned foundry-verification-receipt-v1 object\n  sign-review        sign an unsigned foundry-review-receipt-v1 object\n  sign-technocore    sign an exact room|nonce|text Technocore payload\n\nPublic proof commands (no vault):\n  export-dossier     POST an exact resultId and save immutable canonical dossier bytes\n  verify-dossier     verify a saved dossier offline, optionally with artifact bytes\n\nVault commands use --vault <path> and signing commands use --input <path|->.\nExport uses --base-url <origin> --result-id <res_...> --output <path>.\nVerify uses --input <path|-> [--artifact <path>].\nPassphrases are accepted only from the controlling terminal; never argv, env, stdin, or files.`;
}

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

async function terminalPassphrase(label, confirm = false) {
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
  const readHidden = async (prompt) => {
    output.write(prompt);
    spawnSync('stty', ['-echo'], { stdio: [ttyFd, ttyFd, ttyFd] });
    try {
      return await rl.question('');
    } finally {
      spawnSync('stty', ['echo'], { stdio: [ttyFd, ttyFd, ttyFd] });
      output.write('\n');
    }
  };
  try {
    const first = await readHidden(label);
    if (confirm) {
      const second = await readHidden('Confirm passphrase: ');
      if (first !== second) throw new Error('Passphrases do not match.');
    }
    return first;
  } finally {
    rl.close();
  }
}

async function readInput(path) {
  const bytes = await readRaw(path);
  return parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

async function readRaw(path, maximum = 256 * 1024) {
  const bytes = path === '-' ? await new Promise((resolve, reject) => {
    const chunks = [];
    stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stdin.on('end', () => resolve(Buffer.concat(chunks)));
    stdin.on('error', reject);
  }) : await readFile(path);
  if (bytes.length > maximum) throw new Error(`Input exceeds the ${maximum}-byte limit.`);
  return bytes;
}

async function loadVault(path) {
  return parseVault(JSON.parse(await readFile(path, 'utf8')));
}

async function main() {
  const command = process.argv[2];
  if (!command || command === '--help' || command === '-h') {
    stdout.write(`${usage()}\n`);
    return;
  }
  if (process.argv.some((value) => /pass(word|phrase)/i.test(value))) throw new Error('Passphrase arguments are forbidden.');

  if (command === 'export-dossier') {
    const baseUrl = option('--base-url');
    const resultId = option('--result-id');
    const outputPath = option('--output');
    if (!baseUrl || !resultId || !outputPath) throw new Error('export-dossier requires --base-url, --result-id, and --output.');
    if (!/^res_[a-f0-9]{24}$/.test(resultId)) throw new Error('Malformed result identifier.');
    const origin = new URL(baseUrl);
    const localHttp = origin.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(origin.hostname);
    if (origin.protocol !== 'https:' && !localHttp) throw new Error('Dossier export requires HTTPS, except for a local development origin.');
    const createResponse = await fetch(new URL('/api/dossiers', origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ resultId }),
      signal: AbortSignal.timeout(30_000),
    });
    const createText = await createResponse.text();
    const created = parseStrictJson(createText);
    if (!createResponse.ok) throw new Error(`Dossier export failed with ${createResponse.status}: ${created.error ?? 'unknown response'}.`);
    if (!/^fds_[a-f0-9]{24}$/.test(created.id)) throw new Error('Server returned a malformed dossier identifier.');
    const rawResponse = await fetch(new URL(`/api/dossiers/${created.id}`, origin), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!rawResponse.ok) throw new Error(`Dossier download failed with ${rawResponse.status}.`);
    const bytes = Buffer.from(await rawResponse.arrayBuffer());
    const verified = verifyContributionDossierBytes(bytes, { expectedId: created.id });
    const handle = await open(outputPath, 'wx', 0o644);
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
    stdout.write(`${JSON.stringify({ ...verified, output: outputPath })}\n`);
    return;
  }

  if (command === 'verify-dossier') {
    const inputPath = option('--input') ?? '-';
    const artifactPath = option('--artifact');
    if (inputPath === '-' && artifactPath === '-') throw new Error('Dossier and artifact cannot both use stdin.');
    const bytes = await readRaw(inputPath, MAX_DOSSIER_BYTES);
    const artifactBytes = artifactPath ? await readRaw(artifactPath, 5 * 1024 * 1024) : undefined;
    stdout.write(`${JSON.stringify(verifyContributionDossierBytes(bytes, { artifactBytes }))}\n`);
    return;
  }

  const vaultPath = option('--vault');
  if (!vaultPath) throw new Error('--vault is required.');

  if (command === 'init') {
    try {
      const passphrase = await terminalPassphrase('New passphrase: ', true);
      const vault = createVault(passphrase);
      const handle = await open(vaultPath, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(vault, null, 2)}\n`, 'utf8');
      await handle.close();
      await chmod(vaultPath, 0o600);
      stdout.write(`${JSON.stringify({ did: vault.did, vault: vaultPath })}\n`);
      return;
    } catch (error) {
      if (error?.code === 'EEXIST') throw new Error('Vault path already exists; refusing to overwrite it.');
      throw error;
    }
  }

  const vault = await loadVault(vaultPath);
  if (command === 'did') {
    stdout.write(`${vault.did}\n`);
    return;
  }
  const passphrase = await terminalPassphrase('Vault passphrase: ');
  if (command === 'doctor') {
    unlockVault(vault, passphrase);
    stdout.write(`${JSON.stringify({ ok: true, did: vault.did, vaultSchema: vault.schema })}\n`);
    return;
  }
  const inputPath = option('--input') ?? '-';
  const input = await readInput(inputPath);
  const output = command === 'sign-event'
    ? signEvent(vault, passphrase, input)
    : command === 'sign-tcr1'
      ? signTcr1(vault, passphrase, input)
      : command === 'sign-verification'
        ? signVerification(vault, passphrase, input)
        : command === 'sign-review'
          ? signReview(vault, passphrase, input)
          : command === 'sign-technocore'
            ? signTechnocore(vault, passphrase, input)
            : null;
  if (!output) throw new Error(`Unknown command: ${command}`);
  stdout.write(`${JSON.stringify(output)}\n`);
}

main().catch((error) => {
  process.stderr.write(`foundry-signer: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
