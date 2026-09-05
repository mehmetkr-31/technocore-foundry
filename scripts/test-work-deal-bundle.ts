import assert from 'node:assert/strict';
import { createAcceptedDossierFixture } from './fixtures/accepted-dossier.mjs';
import { createVault, signTechnocore } from '../packages/signer-cli/core.mjs';
import { canonicalJson, sha256Hex } from '../lib/foundry-crypto';
import {
  createWorkDealBundle,
  deriveFoundryJob,
  verifyWorkDealBundle,
  WORK_DEAL_MAX_BYTES,
  WORK_DEAL_TRANSCRIPT_MAX_BYTES,
} from '../lib/work-deal-bundle';
import { demoData } from '../app/deals/bundle/demo-data';

const asciiWire = (value: string) => value.replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const frame = (value: Record<string, unknown>) => `tclk1 ${asciiWire(canonicalJson(value))}`;

async function makeTranscript(dossierBytes: Uint8Array, overrides: Record<string, unknown> = {}) {
  const { job, work } = await deriveFoundryJob(dossierBytes);
  const payer = (overrides.payer as string | undefined) ?? work.mission.issuerDid;
  const payee = (overrides.payee as string | undefined) ?? work.mission.claimantDid;
  const offerCore = {
    type: 'offer', from: payer, role: 'payer', amount: '1', asset: 'FLOP', lock: 'hash',
    rails: ['paper'], claimByMs: 1756703600000, refundAfterMs: 1756707200000, expiresMs: 1756700600000,
    job: { ...job, ...(overrides.job as object ?? {}) }, nonce: '9f2c81d04c9e1f7a',
  };
  const offer = { ...offerCore, id: `0x${await sha256Hex(`FLOP::tclk::v1|offer|${asciiWire(canonicalJson(offerCore))}`)}` };
  const acceptCore = { from: payee, ref: offer.id, statement: `0x${'ab'.repeat(32)}`, nonce: '0011223344556677' };
  const contract = `0x${await sha256Hex(`FLOP::tclk::v1|contract|${asciiWire(canonicalJson({ offer, accept: acceptCore }))}`)}`;
  const accept = { type: 'accept', ...acceptCore, contract };
  const cancel = { type: 'cancel', from: payer, contract, reason: 'paper test terminal' };
  return { text: [frame(offer), frame(accept), frame(cancel)].join('\n'), work, job, contract };
}

const fixture = createAcceptedDossierFixture();
const dossierBytes = new Uint8Array(fixture.bytes);
const transcript = await makeTranscript(dossierBytes);
const raw = new TextEncoder().encode(transcript.text);
const created = await createWorkDealBundle(dossierBytes, raw, 'raw');
const verified = await verifyWorkDealBundle(created.bytes);
assert.deepEqual(verified.binding, created.report.binding);
assert.equal(verified.binding.dossierSha256, fixture.verified!.sha256);
assert.equal(verified.binding.payerDid, fixture.dossier.mission.issuerDid);
assert.equal(verified.binding.payeeDid, fixture.dossier.subject.claimantDid);
assert.equal(verified.binding.terminalFrames.length, 1);
assert.equal(verified.binding.terminalFrames[0].type, 'cancel');
assert.equal(verified.id, created.report.id);
assert.equal(verified.sha256, created.report.sha256);
assert.equal(verified.deal.transport, null);
assert.equal(verified.limits.settlement, 'not-checked');
const demo = await verifyWorkDealBundle(new TextEncoder().encode(demoData.bundle));
assert.equal(demo.deal.status, 'cancelled');
assert.equal(demo.deal.transport, null);
assert.deepEqual(demo.binding.terminalFrames.map((entry) => entry.type), ['cancel', 'receipt']);

await assert.rejects(createWorkDealBundle(dossierBytes, new TextEncoder().encode((await makeTranscript(dossierBytes, { job: { id: 'F-BAD0C0DE' } })).text), 'raw'), /job/);
await assert.rejects(createWorkDealBundle(dossierBytes, new TextEncoder().encode((await makeTranscript(dossierBytes, { job: { context: 'sha256:' + '0'.repeat(64) } })).text), 'raw'), /job/);
const badParties = await makeTranscript(dossierBytes, { payer: transcript.work.mission.claimantDid, payee: transcript.work.mission.issuerDid });
const wrongParty = badParties.text;
await assert.rejects(createWorkDealBundle(dossierBytes, new TextEncoder().encode(wrongParty), 'raw'));
const wrapper = JSON.parse(new TextDecoder().decode(created.bytes)); wrapper.binding.contractId = '0x' + '0'.repeat(64);
await assert.rejects(verifyWorkDealBundle(new TextEncoder().encode(canonicalJson(wrapper))));
await assert.rejects(verifyWorkDealBundle(new TextEncoder().encode('{"schema":"bad"}')));
const noAccept = transcript.text.slice(0, transcript.text.indexOf('\n'));
await assert.rejects(createWorkDealBundle(dossierBytes, new TextEncoder().encode(noAccept), 'raw'));
await assert.rejects(createWorkDealBundle(dossierBytes, new Uint8Array(WORK_DEAL_TRANSCRIPT_MAX_BYTES + 1), 'raw'));
await assert.rejects(verifyWorkDealBundle(new Uint8Array(WORK_DEAL_MAX_BYTES + 1)));
const noFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('network'); };
try { assert.equal((await verifyWorkDealBundle(created.bytes)).valid, true); } finally { globalThis.fetch = noFetch; }

const passphrase = 'commons-test-passphrase';
const issuerVault = createVault(passphrase, new Date('2026-08-28T00:00:00.000Z'));
const claimantVault = createVault(passphrase, new Date('2026-08-28T00:00:00.000Z'));
const signedFixture = createAcceptedDossierFixture({ issuerVault, claimantVault });
const signed = await makeTranscript(new Uint8Array(signedFixture.bytes));
const room = 'work-deal-test';
const signedLines = signed.text.split('\n').map((text, index) => {
  const vault = index === 1 ? claimantVault : issuerVault;
  const message = signTechnocore(vault, passphrase, { room, text, nonce: (1788596922867153000n + BigInt(index)).toString() });
  return JSON.stringify({ seq: index + 1, ts: `2026-09-05T00:00:0${index + 1}.000Z`, from: message.did, text, nonce: message.nonce, sig: message.sig })
    .replace(`"nonce":"${message.nonce}"`, `"nonce":${message.nonce}`);
});
const signedJsonl = new TextEncoder().encode(`${signedLines.join('\n')}\n`);
const signedBundle = await createWorkDealBundle(new Uint8Array(signedFixture.bytes), signedJsonl, 'technocore-jsonl', room);
assert.equal((await verifyWorkDealBundle(signedBundle.bytes)).valid, true);
assert.equal(signedBundle.report.deal.layers.transportDid, 'valid');
assert.equal(signedBundle.report.deal.transport?.authorsBound, true);
await assert.rejects(createWorkDealBundle(new Uint8Array(signedFixture.bytes), signedJsonl, 'technocore-jsonl', 'wrong-room'));
const reSignedWrongAuthor = signTechnocore(issuerVault, passphrase, { room, text: signed.text.split('\n')[1], nonce: '1788596922867153999' });
const mismatched = signedLines.map((line, index) => index === 1 ? JSON.stringify({ seq: 2, ts: '2026-09-05T00:00:02.000Z', from: reSignedWrongAuthor.did, text: reSignedWrongAuthor.text, nonce: reSignedWrongAuthor.nonce, sig: reSignedWrongAuthor.sig }).replace(`"nonce":"${reSignedWrongAuthor.nonce}"`, `"nonce":${reSignedWrongAuthor.nonce}`) : line).join('\n') + '\n';
await assert.rejects(createWorkDealBundle(new Uint8Array(signedFixture.bytes), new TextEncoder().encode(mismatched), 'technocore-jsonl', room));

console.log(JSON.stringify({ workDealBundle: 'ok', gates: ['dossier-job-binding', 'canonical-tclk', 'party-binding', 'terminal-hash', 'wrapper-integrity', 'raw-trust-boundary', 'bounds', 'no-fetch'] }));
