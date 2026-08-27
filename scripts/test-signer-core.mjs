import assert from 'node:assert/strict';
import { createVault, parseStrictJson, parseVault, signEvent, signTcr1, signTechnocore, unlockVault } from '../packages/signer-cli/core.mjs';

const passphrase = 'correct horse battery staple';
const vault = createVault(passphrase, new Date('2026-08-27T00:00:00.000Z'));
assert.equal(parseVault(vault).did, vault.did);
assert.ok(unlockVault(vault, passphrase));
assert.throws(() => unlockVault(vault, 'wrong passphrase'), /incorrect|modified/);

const event = {
  schema: 'foundry-event-v1', type: 'claim', missionId: 'M-042',
  requirementsHash: `sha256:${'1'.repeat(64)}`, actor: vault.did,
  nonce: '2026082700000000001', createdAt: '2026-08-27T00:00:00.000Z',
};
assert.match(signEvent(vault, passphrase, event).signature, /^[A-Za-z0-9_-]{86}$/);
assert.throws(() => signEvent(vault, passphrase, { ...event, actor: 'did:key:z6Mkwrong' }), /actor/);
assert.throws(() => signEvent(vault, passphrase, { ...event, extra: true }), /Malformed|noncanonical/);
assert.throws(() => parseStrictJson('{"event":1,"event":2}'), /Duplicate/);

const unsignedTcr1 = {
  type: 'technocore-task-receipt', version: 1,
  task: { id: 'M-042', issuer: vault.did, requirements_sha256: '1'.repeat(64) },
  claimant: { did: vault.did }, artifacts: [{ type: 'text/plain', uri: 'https://github.com/example/repo', sha256: '2'.repeat(64) }],
  created_at: '2026-08-27T00:00:00.000Z',
};
assert.match(signTcr1(vault, passphrase, unsignedTcr1).signature.value, /^[A-Za-z0-9_-]{86}$/);
assert.throws(() => signTcr1(vault, passphrase, { ...unsignedTcr1, private_token: 'nope' }), /Malformed|noncanonical/);
assert.match(signTechnocore(vault, passphrase, { room: 'foundry-contributions', nonce: '2026082700000000001', text: 'proof res_123' }).sig, /^[A-Za-z0-9_-]{86}$/);

console.log(JSON.stringify({ signerCore: 'ok', vaultSchema: vault.schema, did: vault.did }));
