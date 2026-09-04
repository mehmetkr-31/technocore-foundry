#!/usr/bin/env node
import { chmod, open, readFile, stat } from 'node:fs/promises';
import { constants, createReadStream, createWriteStream, openSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createVault, importEncryptedPemVault, parseStrictJson, parseVault, signEvent, signReview, signTcr1, signTechnocore, signVerification, unlockVault } from '../core.mjs';
import { MAX_DOSSIER_BYTES, verifyContributionDossierBytes } from '../dossier.mjs';

function usage() {
  return `foundry-signer <command> [options]\n\nVault commands:\n  init               create a browser-compatible encrypted vault\n  import-pem         migrate an existing encrypted Ed25519 PKCS#8 PEM without changing its DID\n  did                print the public DID without unlocking\n  doctor             unlock and perform a sign/verify recovery test\n  sign-event         sign an unsigned foundry-event-v1 object\n  sign-tcr1          sign an unsigned TCR-1 receipt\n  sign-verification  sign an unsigned foundry-verification-receipt-v1 object\n  sign-review        sign an unsigned foundry-review-receipt-v1 object\n  sign-technocore    sign an exact room|nonce|text Technocore payload\n\nPublic proof commands (no vault):\n  export-dossier     POST an exact resultId and save immutable canonical dossier bytes\n  verify-dossier     verify a saved dossier offline, optionally with artifact bytes\n\nVault commands use --vault <path> and signing commands use --input <path|->.\nPEM migration also requires --pem <path> and --expect-did <did:key:...>.\nExport uses --base-url <origin> --result-id <res_...> --output <path>.\nVerify uses --input <path|-> [--artifact <path>].\nPassphrases are accepted only from the controlling terminal; never argv, env, stdin, or files.`;
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
    const hidden = spawnSync('stty', ['-echo'], { stdio: [ttyFd, ttyFd, ttyFd] });
    if (hidden.status !== 0) throw new Error('Secure hidden passphrase entry is unavailable. Use macOS, Linux, or WSL2 with a controlling terminal.');
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
  if (path !== '-') {
    const metadata = await stat(path);
    if (!metadata.isFile()) throw new Error('Input must be a regular file.');
    if (metadata.size > maximum) throw new Error(`Input exceeds the ${maximum}-byte limit.`);
  }
  const bytes = path === '-' ? await (async () => {
    const chunks = [];
    let size = 0;
    for await (const chunk of stdin) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > maximum) throw new Error(`Input exceeds the ${maximum}-byte limit.`);
      chunks.push(bytes);
    }
    return Buffer.concat(chunks, size);
  })() : await readFile(path);
  if (bytes.length > maximum) throw new Error(`Input exceeds the ${maximum}-byte limit.`);
  return bytes;
}

async function loadVault(path) {
  const bytes = await readRaw(path, 32 * 1024);
  return parseVault(parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
}

async function readPrivatePem(path) {
  if (!path || path === '-') throw new Error('Encrypted PEM input must be a file path, not stdin.');
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error('Encrypted PEM input must be a regular file.');
    if (metadata.size < 1 || metadata.size > 32 * 1024) throw new Error('Encrypted PEM input exceeds the 32768-byte limit.');
    return await handle.readFile();
  } catch (error) {
    if (error?.code === 'ELOOP') throw new Error('Encrypted PEM input must not be a symbolic link.');
    throw error;
  } finally {
    await handle?.close();
  }
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

  if (command === 'import-pem') {
    const pemPath = option('--pem');
    const expectedDid = option('--expect-did');
    if (!pemPath || !expectedDid) throw new Error('import-pem requires --pem <path> and --expect-did <did:key:...>.');
    if (!/^did:key:z[1-9A-HJ-NP-Za-km-z]{47}$/.test(expectedDid)) throw new Error('--expect-did must be a complete Ed25519 did:key value.');
    let pemBytes;
    let pemPassphrase = '';
    let vaultPassphrase = '';
    try {
      pemBytes = await readPrivatePem(pemPath);
      pemPassphrase = await terminalPassphrase('Existing PEM passphrase: ');
      vaultPassphrase = await terminalPassphrase('New Foundry vault passphrase: ', true);
      const vault = importEncryptedPemVault(pemBytes, pemPassphrase, vaultPassphrase);
      if (vault.did !== expectedDid) throw new Error('Imported key DID does not match --expect-did; refusing to write a vault.');
      const handle = await open(vaultPath, 'wx', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(vault, null, 2)}\n`, 'utf8');
      } finally {
        await handle.close();
      }
      await chmod(vaultPath, 0o600);
      stdout.write(`${JSON.stringify({ did: vault.did, vault: vaultPath })}\n`);
      return;
    } catch (error) {
      if (error?.code === 'EEXIST') throw new Error('Vault path already exists; refusing to overwrite it.');
      throw error;
    } finally {
      pemBytes?.fill(0);
      pemPassphrase = '';
      vaultPassphrase = '';
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
