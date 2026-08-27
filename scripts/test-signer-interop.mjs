import assert from 'node:assert/strict';
import { createVault as createNodeVault, signEvent as signNodeEvent, unlockVault as unlockNodeVault } from '../packages/signer-cli/core.mjs';
import { createVault as createBrowserVault, parseVault, unlockVault, verifySignedEvent } from '../lib/foundry-crypto.ts';

const passphrase = 'browser and cli interop phrase';
const cliVault = createNodeVault(passphrase, new Date('2026-08-27T00:00:00.000Z'));
await unlockVault(parseVault(cliVault), passphrase);

const event = {
  schema: 'foundry-event-v1', type: 'claim', missionId: 'M-042',
  requirementsHash: `sha256:${'a'.repeat(64)}`, actor: cliVault.did,
  nonce: '2026082700000000001', createdAt: '2026-08-27T00:00:00.000Z',
};
assert.equal(await verifySignedEvent(signNodeEvent(cliVault, passphrase, event)), true);

const browserVault = await createBrowserVault(passphrase);
assert.ok(unlockNodeVault(browserVault, passphrase));

console.log(JSON.stringify({ signerInterop: 'ok', directions: ['cli-to-browser', 'browser-to-cli'] }));
