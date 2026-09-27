// Reproducible offline audit of the maintainer's existing PUBLIC evidence only.
// No vault, signing, publication, or remote URL is used.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseStrictJson, decodeStrictUtf8 } from '../lib/strict-json';
import { verifyTechnocoreRecordProof } from '../lib/technocore-records';
import { verifySignedParticipationBundle } from '../lib/participation-bundle';

const expectedDid = 'did:key:z6MkgputwyYsihYJpxsd3Wc6so1sxuJUoJR3oEiNPU4tCyYo';
const files = [
  'lobby-seq-25843281.technocore-proof.json',
  'technocore-participation-a022410137e3f233.json',
];
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('This audit forbids network access.'); };
try {
  const results = [];
  for (const [index, file] of files.entries()) {
    const bytes = await readFile(new URL(`../docs/participation/${file}`, import.meta.url));
    assert(bytes.length > 0 && bytes.length <= 1024 * 1024);
    const value = parseStrictJson(decodeStrictUtf8(bytes));
    const verify = index === 0 ? verifyTechnocoreRecordProof : verifySignedParticipationBundle;
    assert.equal(await verify(value), true, `${file}: signature rejected`);
    // After schema/signature validation, inspect only public fields.
    const proof = value as { record?: { from: string; text: string }; room?: string; generation?: number;
      bundle?: { did: string; contribution: { summary: string } } };
    const did = index === 0 ? proof.record!.from : proof.bundle!.did;
    assert.equal(did, expectedDid, `${file}: wrong DID`);
    const changed = structuredClone(proof);
    if (index === 0) changed.record!.text += ' altered';
    else changed.bundle!.contribution.summary += ' altered';
    assert.equal(await verify(changed), false, `${file}: signed-text tampering accepted`);
    if (index === 0) {
      assert.equal(await verify({ ...proof, room: 'technocore' }), false);
      // This MUST remain valid: generation is not covered by the author's signature.
      assert.equal(await verify({ ...proof, generation: proof.generation! + 1 }), true);
    }
    results.push({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
      did, signature: 'valid', alteredSignedText: 'rejected' });
  }
  console.log(JSON.stringify({ audit: 'passed', results, network: 'disabled',
    unsignedServerMetadata: 'not-authenticated', independentReview: 'not-performed',
    taskAcceptance: 'not-established', payment: 'not-checked', eligibility: 'not-established' }, null, 2));
} finally { globalThis.fetch = originalFetch; }
