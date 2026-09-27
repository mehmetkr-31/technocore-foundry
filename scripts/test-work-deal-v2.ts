import assert from 'node:assert/strict';
import { createVault, signTechnocore } from '../packages/signer-cli/core.mjs';
import { createAcceptedDossierFixture } from './fixtures/accepted-dossier.mjs';
import { canonicalJson, sha256Hex } from '../lib/foundry-crypto';
import { deriveFoundryJob, verifyWorkDealBundle } from '../lib/work-deal-bundle';
import { createWorkDealBundleV2, verifyWorkDealBundleV2, WORK_DEAL_V2_MAX_BYTES } from '../lib/work-deal-bundle-v2';
import { demoData } from '../app/deals/bundle/demo-data';

const pass = 'commons-test-passphrase';
const issuerVault = createVault(pass), claimantVault = createVault(pass);
const fixture = createAcceptedDossierFixture({ issuerVault, claimantVault });
const { job } = await deriveFoundryJob(fixture.bytes);
const enc = (text: string) => new TextEncoder().encode(text);
async function source(jobOverride = job, wrongParties = false) {
  const issuer = wrongParties ? claimantVault : issuerVault, claimant = wrongParties ? issuerVault : claimantVault;
  const core = { type: 'offer', from: issuer.did, role: 'payer', amount: '1', asset: 'DEMO', lock: 'hash', rails: ['paper'],
    expiresMs: 1800000000000, claimByMs: 1800001000000, refundAfterMs: 1800002000000, nonce: '1122334455667788', job: jobOverride };
  const offer = { ...core, id: `0x${await sha256Hex(`FLOP::tclk::v1|offer|${canonicalJson(core)}`)}` };
  const acceptCore = { from: claimant.did, ref: offer.id, statement: `0x${'ab'.repeat(32)}`, nonce: '8877665544332211' };
  const contract = `0x${await sha256Hex(`FLOP::tclk::v1|contract|${canonicalJson({ offer, accept: acceptCore })}`)}`;
  const room = `mb-p-tclk-${contract.slice(2, 18)}`;
  const row = (vault: ReturnType<typeof createVault>, frame: object, roomName: string, seq: number) => {
    const signed = signTechnocore(vault, pass, { room: roomName, text: `tclk1 ${canonicalJson(frame)}`, nonce: (1000000000000000000n + BigInt(seq)).toString() });
    return JSON.stringify({ seq, ts: '2027-01-01T00:00:00.000Z', from: signed.did, text: signed.text, nonce: signed.nonce, sig: signed.sig }).replace(`"nonce":"${signed.nonce}"`, `"nonce":${signed.nonce}`);
  };
  return { contract, core,
    offers: enc([row(issuer, offer, 'tclk-offers', 1), row(claimant, { type: 'accept', ...acceptCore, contract }, 'tclk-offers', 2)].join('\n') + '\n'),
    agreement: enc(row(issuer, { type: 'lock', from: issuer.did, contract, rail: 'paper', ref: contract }, room, 1) + '\n') };
}
const data = await source();
const result = await createWorkDealBundleV2(fixture.bytes, data.offers, data.agreement, data.contract);
assert.equal(result.report.paper.state, 'absent');
assert.equal(result.report.deal.verifiedStatus, 'locked');
assert.equal(result.report.deal.terminal, false);
assert.equal((await verifyWorkDealBundleV2(result.bytes)).sha256, result.report.sha256);
const responseText = `header\n\ntclkpaper1 locked hash 0x${'ab'.repeat(32)} ${data.core.refundAfterMs}\n`;
const snapshot = { contract: data.contract, url: `https://technocore.chat/kv/tclk-paper-${data.contract.slice(2, 4)}/${data.contract.slice(4, 18)}`,
  observedAt: '2026-09-06T00:00:00.000Z', httpStatus: 200, responseText, responseSha256: await sha256Hex(enc(responseText)) };
const observed = await createWorkDealBundleV2(fixture.bytes, data.offers, data.agreement, data.contract, snapshot);
assert.equal((await verifyWorkDealBundleV2(observed.bytes)).paper.state, 'saved-body-consistent');
assert.equal(observed.report.paper.sourceAuthenticity, 'not-proven');
assert.equal(observed.report.limits.settlement, 'not-proven');
await assert.rejects(createWorkDealBundleV2(fixture.bytes, data.offers, data.agreement, data.contract, { ...snapshot, contract: `0x${'00'.repeat(32)}` }));
await assert.rejects(createWorkDealBundleV2(fixture.bytes, data.offers, data.agreement, data.contract, { ...snapshot, responseText: responseText + 'tampered' }));
const changed = responseText.replace(String(data.core.refundAfterMs), '1');
const mismatch = await createWorkDealBundleV2(fixture.bytes, data.offers, data.agreement, data.contract, { ...snapshot, responseText: changed, responseSha256: await sha256Hex(enc(changed)) });
assert.equal(mismatch.report.valid, true); assert.equal(mismatch.report.paper.state, 'inconsistent');
const missing = await createWorkDealBundleV2(fixture.bytes, data.offers, data.agreement, data.contract, { ...snapshot, httpStatus: 404, responseText: null, responseSha256: null });
assert.equal(missing.report.paper.state, 'reported-missing');
const wrong = await source({ ...job, id: 'wrong-job' });
await assert.rejects(createWorkDealBundleV2(fixture.bytes, wrong.offers, wrong.agreement, wrong.contract), /job/);
const parties = await source(job, true);
await assert.rejects(createWorkDealBundleV2(fixture.bytes, parties.offers, parties.agreement, parties.contract), /taraf/);
const wrapper = JSON.parse(new TextDecoder().decode(result.bytes));
wrapper.binding.contract = 'wrong';
await assert.rejects(verifyWorkDealBundleV2(enc(canonicalJson(wrapper))));
await assert.rejects(verifyWorkDealBundleV2(enc('{}')));
await assert.rejects(verifyWorkDealBundleV2(new Uint8Array(WORK_DEAL_V2_MAX_BYTES + 1)));
await assert.rejects(verifyWorkDealBundleV2(enc(new TextDecoder().decode(result.bytes) + '\n')));
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network forbidden'); };
try {
  assert.equal((await verifyWorkDealBundleV2(observed.bytes)).valid, true);
  assert.equal((await verifyWorkDealBundle(enc(demoData.bundle))).valid, true);
} finally { globalThis.fetch = originalFetch; }
console.log(JSON.stringify({ workDealV2: 'ok', tests: ['roundtrip', 'job-and-parties', 'snapshot-binding', 'recomputed-observation', 'unsigned-observation', 'bounds', 'v1-compatible', 'no-network'] }));
