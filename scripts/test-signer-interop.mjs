import assert from 'node:assert/strict';
import { createVault as createNodeVault, signEvent as signNodeEvent, signReview as signNodeReview, unlockVault as unlockNodeVault } from '../packages/signer-cli/core.mjs';
import { createVault as createBrowserVault, parseVault, unlockVault, verifyReviewReceipt, verifySignedEvent } from '../lib/foundry-crypto.ts';

const passphrase = 'browser and cli interop phrase';
const cliVault = createNodeVault(passphrase, new Date('2026-08-27T00:00:00.000Z'));
await unlockVault(parseVault(cliVault), passphrase);

const event = {
  schema: 'foundry-event-v1', type: 'claim', missionId: 'M-042',
  requirementsHash: `sha256:${'a'.repeat(64)}`, actor: cliVault.did,
  nonce: '2026082700000000001', createdAt: '2026-08-27T00:00:00.000Z',
};
assert.equal(await verifySignedEvent(signNodeEvent(cliVault, passphrase, event)), true);

const review = signNodeReview(cliVault, passphrase, {
  schema: 'foundry-review-receipt-v1',
  missionId: 'M-042',
  resultId: `res_${'b'.repeat(24)}`,
  resultReceiptSha256: `sha256:${'c'.repeat(64)}`,
  candidateCommit: '9c7df0e3616cf28d17e7c8ebeb0c05de6adf117c',
  reviewerDid: cliVault.did,
  criteria: [{ id: 'interop', status: 'met', evidence: 'Node signer bytes verify through the browser implementation.' }],
  findings: [],
  reviewDecision: 'approved',
  residualRisks: [],
  createdAt: '2026-08-27T00:00:00.000Z',
});
assert.equal(await verifyReviewReceipt(review), true);
assert.equal(await verifyReviewReceipt({
  ...review,
  receipt: { ...review.receipt, resultReceiptSha256: `sha256:${'d'.repeat(64)}` },
}), false);
assert.equal(await verifyReviewReceipt({ ...review, extra: true }), false);
assert.equal(await verifyReviewReceipt({
  ...review,
  signature: { ...review.signature, domain: 'foundry-event-v1' },
}), false);

const browserVault = await createBrowserVault(passphrase);
assert.ok(unlockNodeVault(browserVault, passphrase));

console.log(JSON.stringify({ signerInterop: 'ok', directions: ['cli-to-browser', 'browser-to-cli'], proofs: ['event', 'review'] }));
