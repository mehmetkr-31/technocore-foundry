// Synthetic offline rehearsal only. No network or real operator identity is used.
import { createAcceptedDossierFixture } from './fixtures/accepted-dossier.mjs';
import { canonicalJson, sha256Hex } from '../lib/foundry-crypto';
import { deriveFoundryJob, createWorkDealBundle } from '../lib/work-deal-bundle';

const fixture = createAcceptedDossierFixture();
const { job, work } = await deriveFoundryJob(fixture.bytes);
const wire = (value: unknown) => canonicalJson(value).replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const offerCore = {
  type: 'offer', from: work.mission.issuerDid, role: 'payer', amount: '1', asset: 'DEMO', lock: 'hash',
  rails: ['paper'], claimByMs: 1788613200000, refundAfterMs: 1788616800000, expiresMs: 1788609600000,
  job, nonce: '1122334455667788',
};
const offer = { ...offerCore, id: `0x${await sha256Hex(`FLOP::tclk::v1|offer|${wire(offerCore)}`)}` };
const acceptCore = { from: work.mission.claimantDid, ref: offer.id, statement: `0x${'ab'.repeat(32)}`, nonce: '8877665544332211' };
const contract = `0x${await sha256Hex(`FLOP::tclk::v1|contract|${wire({ offer, accept: acceptCore })}`)}`;
const transcript = [offer, { type: 'accept', ...acceptCore, contract },
  { type: 'cancel', from: work.mission.issuerDid, contract, reason: 'Synthetic paper rehearsal; no funds' },
  { type: 'receipt', from: work.mission.claimantDid, contract, outcome: 'cancelled' },
].map((value) => `tclk1 ${wire(value)}`).join('\n');
const result = await createWorkDealBundle(fixture.bytes, new TextEncoder().encode(transcript), 'raw');
// Emit only public bytes so callers can review and store them. Private fixture keys
// are never part of the emitted object. Regeneration intentionally creates new IDs.
console.log(JSON.stringify({ dossier: new TextDecoder().decode(fixture.bytes), transcript, bundle: new TextDecoder().decode(result.bytes) }));
