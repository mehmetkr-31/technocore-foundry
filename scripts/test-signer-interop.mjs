import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createVault as createNodeVault, parseVault as parseNodeVault, signEvent as signNodeEvent, signReview as signNodeReview, unlockVault as unlockNodeVault } from '../packages/signer-cli/core.mjs';
import { createVault as createBrowserVault, parseVault, unlockVault, verifyReviewReceipt, verifySignedEvent } from '../lib/foundry-crypto.ts';

const passphrase = 'browser and cli interop phrase';
const cliVault = createNodeVault(passphrase, new Date('2026-08-27T00:00:00.000Z'));
await unlockVault(parseVault(cliVault), passphrase);
assert.equal(parseNodeVault(structuredClone(cliVault)).did, cliVault.did);
for (const malformed of [
  { ...cliVault, extra: true },
  { ...cliVault, kdf: { ...cliVault.kdf, iterations: 9_999_999_999 } },
  { ...cliVault, ciphertext: 'A'.repeat(10_000) },
  { ...cliVault, createdAt: 'not-a-timestamp' },
]) {
  assert.throws(() => parseVault(malformed));
  assert.throws(() => parseNodeVault(malformed));
}

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

const verifierFixture = await mkdtemp(join(tmpdir(), 'foundry-verifier-'));
try {
  const oversizedVault = join(verifierFixture, 'oversized-vault.json');
  const allowlist = join(verifierFixture, 'allowlist.json');
  await writeFile(oversizedVault, 'x'.repeat(32 * 1024 + 1));
  await writeFile(allowlist, '{}');
  const bounded = spawnSync(process.execPath, [
    'packages/signer-cli/bin/foundry-verifier.mjs',
    '--vault', oversizedVault,
    '--allowlist', allowlist,
  ], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(bounded.status, 1);
  assert.match(bounded.stderr, /Vault exceeds the 32768-byte limit/);
} finally {
  await rm(verifierFixture, { recursive: true, force: true });
}

console.log(JSON.stringify({ signerInterop: 'ok', directions: ['cli-to-browser', 'browser-to-cli'], proofs: ['event', 'review'] }));
