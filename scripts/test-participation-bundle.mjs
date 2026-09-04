import assert from 'node:assert/strict';
import { createVault } from '../lib/foundry-crypto.ts';
import { createSignedParticipationBundle, verifySignedParticipationBundle } from '../lib/participation-bundle.ts';

const passphrase = 'correct horse battery staple';
const vault = await createVault(passphrase);
const envelope = await createSignedParticipationBundle({
  vault,
  passphrase,
  contributionType: 'tool',
  contributionUrl: 'https://example.com/tool',
  contributionSummary: 'A useful local-first Technocore tool.',
  profilePath: '/kv/did-aa/example',
  profileValue: 'routing only',
  mailbox: 'mb-p-0123456789abcdef',
  activity: [{ room: 'lobby', sequence: '1', generation: 0, publishedAt: '2026-09-04T00:00:00.000Z' }],
  portableProofs: [],
});
assert.equal(await verifySignedParticipationBundle(envelope), true);
const tampered = structuredClone(envelope);
tampered.bundle.contribution.summary = 'tampered';
assert.equal(await verifySignedParticipationBundle(tampered), false);
const dishonestClaims = structuredClone(envelope);
dishonestClaims.bundle.claims.airdrop = 'guaranteed';
assert.equal(await verifySignedParticipationBundle(dishonestClaims), false);
assert.equal(JSON.stringify(envelope).includes('ciphertext'), false);
assert.equal(JSON.stringify(envelope).includes('privateKey'), false);
console.log('participation bundle tests passed');
