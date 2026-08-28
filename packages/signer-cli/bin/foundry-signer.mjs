#!/usr/bin/env node
import { chmod, open, readFile } from 'node:fs/promises';
import { createReadStream, createWriteStream, openSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createVault, parseStrictJson, parseVault, signEvent, signTcr1, signTechnocore, signVerification, unlockVault } from '../core.mjs';

function usage() {
  return `foundry-signer <command> --vault <path> [--input <path|->]\n\nCommands:\n  init               create a browser-compatible encrypted vault\n  did                print the public DID without unlocking\n  doctor             unlock and perform a sign/verify recovery test\n  sign-event         sign an unsigned foundry-event-v1 object\n  sign-tcr1          sign an unsigned TCR-1 receipt\n  sign-verification  sign an unsigned foundry-verification-receipt-v1 object\n  sign-technocore    sign an exact room|nonce|text Technocore payload\n\nPassphrases are accepted only from the controlling terminal; never argv, env, stdin, or files.`;
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
  const bytes = path === '-' ? await new Promise((resolve, reject) => {
    const chunks = [];
    stdin.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stdin.on('end', () => resolve(Buffer.concat(chunks)));
    stdin.on('error', reject);
  }) : await readFile(path);
  return parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
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
