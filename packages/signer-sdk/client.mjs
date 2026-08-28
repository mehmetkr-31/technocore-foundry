import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_CLI = fileURLToPath(new URL('../signer-cli/bin/foundry-signer.mjs', import.meta.url));

export function runSigner(command, { vault, payload, cli = DEFAULT_CLI } = {}) {
  if (!vault) throw new Error('vault is required.');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, command, '--vault', vault, ...(payload === undefined ? [] : ['--input', '-'])], {
      stdio: [payload === undefined ? 'ignore' : 'pipe', 'pipe', 'inherit'],
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`foundry-signer exited with code ${code}.`));
      const trimmed = output.trim();
      try { resolve(command === 'did' ? trimmed : JSON.parse(trimmed)); }
      catch { reject(new Error('foundry-signer returned malformed output.')); }
    });
    if (payload !== undefined) child.stdin.end(`${JSON.stringify(payload)}\n`);
  });
}

export const signer = {
  did: (vault, options = {}) => runSigner('did', { vault, ...options }),
  doctor: (vault, options = {}) => runSigner('doctor', { vault, ...options }),
  signEvent: (vault, payload, options = {}) => runSigner('sign-event', { vault, payload, ...options }),
  signTcr1: (vault, payload, options = {}) => runSigner('sign-tcr1', { vault, payload, ...options }),
  signVerification: (vault, payload, options = {}) => runSigner('sign-verification', { vault, payload, ...options }),
  signTechnocore: (vault, payload, options = {}) => runSigner('sign-technocore', { vault, payload, ...options }),
};
