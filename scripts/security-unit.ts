import assert from 'node:assert/strict';
import {
  createVault,
  signTechnocoreAnnouncement,
  verifyTechnocoreMessage,
  verifyTcr1Receipt,
  type Tcr1Receipt,
} from '../lib/foundry-crypto';
import { validateGitHubEvidence } from '../lib/github-evidence';
import {
  assertPublicReceiptAnnouncement,
  relayConfiguration,
} from '../lib/technocore-relay-policy';

for (const repository of [
  'http://github.com/owner/repo',
  'https://github.com@127.0.0.1/repo',
  'https://127.0.0.1/owner/repo',
  'https://github.com/owner/repo?redirect=http://127.0.0.1',
]) {
  assert.throws(() => validateGitHubEvidence({ repository }), /GitHub|Repository/);
}

assert.throws(() => validateGitHubEvidence({
  repository: 'https://github.com/owner/repo',
  ci_url: 'https://github.com/other/repo/actions/runs/1',
  ci_status: 'success',
}), /same GitHub repository/);

const forbidden = {
  type: 'technocore-task-receipt', version: 1,
  task: { id: 'M-042', issuer: 'did:key:z6MkjtkShmr1CG8rHHPBUDqCUbtwfQ6E9u4g2NdHXjCsg471', requirements_sha256: '1'.repeat(64) },
  claimant: { did: 'did:key:z6MkjtkShmr1CG8rHHPBUDqCUbtwfQ6E9u4g2NdHXjCsg471' },
  artifacts: [{ type: 'text/plain', uri: 'https://example.org/a', sha256: '2'.repeat(64) }],
  created_at: '2026-08-27T00:00:00.000Z',
  private_token: 'must-never-enter-a-receipt',
  signature: { algorithm: 'Ed25519', domain: 'technocore-task-receipt:v1', value: 'A'.repeat(86) },
} as unknown as Tcr1Receipt;
assert.equal(await verifyTcr1Receipt(forbidden), false);

assert.deepEqual(relayConfiguration({}), {
  enabled: false,
  code: 'disabled',
  publicOrigin: null,
  reason: 'Relay is disabled. Set FOUNDRY_TECHNOCORE_RELAY_ENABLED=1 only after configuring a public Foundry origin.',
});
assert.equal(relayConfiguration({
  FOUNDRY_TECHNOCORE_RELAY_ENABLED: '1',
  FOUNDRY_PUBLIC_ORIGIN: 'http://localhost:3000',
}).code, 'invalid_public_origin');
const readyRelay = relayConfiguration({
  FOUNDRY_TECHNOCORE_RELAY_ENABLED: '1',
  FOUNDRY_PUBLIC_ORIGIN: 'https://proofs.example.org',
});
assert.equal(readyRelay.enabled, true);
const publicAnnouncement = `[FOUNDRY] receipt res_${'1'.repeat(24)} | mission F-C0FFEE01 | claimant z6Mktest…agent | artifact sha256:${'2'.repeat(64)} | key=valid artifact=match issuer=accepted | https://proofs.example.org/receipt/res_${'1'.repeat(24)}`;
assert.equal(assertPublicReceiptAnnouncement(publicAnnouncement, 'https://proofs.example.org').receiptId, `res_${'1'.repeat(24)}`);
assert.throws(
  () => assertPublicReceiptAnnouncement(publicAnnouncement.replace('https://proofs.example.org', 'http://localhost:3000'), 'https://proofs.example.org'),
  /bounded|matching receipt/,
);
assert.throws(
  () => assertPublicReceiptAnnouncement(publicAnnouncement.replace('proofs.example.org', 'other.example.org'), 'https://proofs.example.org'),
  /matching receipt/,
);

const nonceVault = await createVault('relay nonce regression phrase');
const nonceOne = await signTechnocoreAnnouncement(nonceVault, 'relay nonce regression phrase', 'foundry-contributions', publicAnnouncement);
const nonceTwo = await signTechnocoreAnnouncement(nonceVault, 'relay nonce regression phrase', 'foundry-contributions', publicAnnouncement);
assert.equal(Number.isSafeInteger(Number(nonceOne.nonce)), true);
assert.equal(Number.isSafeInteger(Number(nonceTwo.nonce)), true);
assert.equal(BigInt(nonceTwo.nonce) > BigInt(nonceOne.nonce), true);
assert.equal(await verifyTechnocoreMessage(nonceOne), true);
assert.equal(await verifyTechnocoreMessage(nonceTwo), true);

console.log(JSON.stringify({ securityUnit: 'ok', gates: ['ssrf-url-policy', 'cross-repository-binding', 'secret-field-rejection', 'relay-default-off', 'public-receipt-origin', 'json-safe-production-nonce'] }));
