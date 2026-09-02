import assert from 'node:assert/strict';
import { canonicalJson } from '../packages/signer-cli/core.mjs';
import { verifyContributionDossierBytes } from '../packages/signer-cli/dossier.mjs';
import {
  BROWSER_DOSSIER_MAX_BYTES,
  BrowserDossierError,
  verifyDossierInBrowser,
} from '../lib/browser-dossier-verifier.mjs';
import { createInspectorRunGate } from '../lib/inspector-run-gate.ts';
import { createAcceptedDossierFixture, createFullLifecycleDossierFixture } from './fixtures/accepted-dossier.mjs';

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (cause) => cause instanceof BrowserDossierError && cause.code === code);
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Browser dossier verification must never call fetch.'); };
try {
  for (const options of [{}, { finalize: true }]) {
    const fixture = createAcceptedDossierFixture(options);
    const node = verifyContributionDossierBytes(fixture.bytes, { artifactBytes: fixture.artifact });
    const browser = await verifyDossierInBrowser(fixture.bytes, {
      artifactBytes: fixture.artifact,
      filename: `${node.id}.json`,
    });
    assert.deepEqual({
      id: browser.id,
      sha256: browser.sha256,
      selectedResultId: browser.selectedResultId,
      selectedState: browser.selectedState,
      layers: browser.layers,
    }, {
      id: node.id,
      sha256: node.sha256,
      selectedResultId: node.selectedResultId,
      selectedState: node.selectedState,
      layers: node.layers,
    });
    assert.equal(browser.commons.eligible, true);
  }

  const completeFixture = createFullLifecycleDossierFixture();
  const completeBrowser = await verifyDossierInBrowser(completeFixture.bytes, {
    artifactBytes: completeFixture.artifact,
    filename: `${completeFixture.verified.id}.json`,
  });
  assert.deepEqual({
    id: completeBrowser.id,
    sha256: completeBrowser.sha256,
    selectedResultId: completeBrowser.selectedResultId,
    selectedState: completeBrowser.selectedState,
    layers: completeBrowser.layers,
  }, {
    id: completeFixture.verified.id,
    sha256: completeFixture.verified.sha256,
    selectedResultId: completeFixture.verified.selectedResultId,
    selectedState: completeFixture.verified.selectedState,
    layers: completeFixture.verified.layers,
  });
  assert.equal(completeBrowser.revisionCount, 2);
  assert.equal(completeBrowser.receiptCount, 11);
  assert.deepEqual(completeBrowser.revisions.map((revision) => revision.outcome), ['changes_requested', 'finalized']);
  assert.deepEqual(completeBrowser.gaps, []);
  assert.equal(completeBrowser.commons.eligible, true);

  const fixture = createAcceptedDossierFixture();
  const valid = await verifyDossierInBrowser(fixture.bytes, { filename: 'wrong-name.json' });
  assert.equal(valid.ok, true);
  assert.equal(valid.commons.eligible, false);
  assert.equal(valid.commons.filenameMatches, false);
  const wrongArtifact = await verifyDossierInBrowser(fixture.bytes, { artifactBytes: Buffer.from('wrong') });
  assert.equal(wrongArtifact.layers.artifact, 'mismatch');
  assert.equal(wrongArtifact.gaps.includes('artifact_mismatch'), true);

  await rejectsCode(verifyDossierInBrowser(Buffer.concat([fixture.bytes, Buffer.from('\n')])), 'CANONICAL');
  await rejectsCode(verifyDossierInBrowser(Buffer.from('{"x":1,"x":2}')), 'STRICT_JSON');
  await rejectsCode(verifyDossierInBrowser(Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d])), 'UTF8');
  await rejectsCode(verifyDossierInBrowser(Buffer.alloc(BROWSER_DOSSIER_MAX_BYTES + 1)), 'FILE_SIZE');
  await rejectsCode(verifyDossierInBrowser(Buffer.from(`${'['.repeat(65)}0${']'.repeat(65)}`)), 'JSON_DEPTH');

  const forgedState = structuredClone(fixture.dossier);
  forgedState.subject.selectedState = 'finalized';
  await rejectsCode(verifyDossierInBrowser(Buffer.from(canonicalJson(forgedState))), 'BINDING');
  const oversizedDid = structuredClone(fixture.dossier);
  oversizedDid.subject.claimantDid = `did:key:z${'1'.repeat(100_000)}`;
  await rejectsCode(verifyDossierInBrowser(Buffer.from(canonicalJson(oversizedDid))), 'SHAPE');
  const bidiSpoof = structuredClone(fixture.dossier);
  bidiSpoof.mission.title = `Portable proof \u202eresu spoof`;
  const bidiBytes = Buffer.from(canonicalJson(bidiSpoof));
  await rejectsCode(verifyDossierInBrowser(bidiBytes), 'SHAPE');
  assert.throws(() => verifyContributionDossierBytes(bidiBytes), /mission snapshot/);

  const requirementsMismatch = createAcceptedDossierFixture({ requirementsHash: `sha256:${'2'.repeat(64)}`, verifyCore: false });
  await rejectsCode(verifyDossierInBrowser(requirementsMismatch.bytes), 'BINDING');
  const acceptanceMismatch = createAcceptedDossierFixture({ acceptanceMissionId: 'F-BAD0C0DE', verifyCore: false });
  await rejectsCode(verifyDossierInBrowser(acceptanceMismatch.bytes), 'BINDING');
  const finalMismatch = createAcceptedDossierFixture({ finalize: true, finalArtifactType: 'application/octet-stream', verifyCore: false });
  await rejectsCode(verifyDossierInBrowser(finalMismatch.bytes), 'BINDING');

  const privateArtifact = createAcceptedDossierFixture({ artifactUri: 'http://10.0.0.8/api/artifacts/res_111111111111111111111111' });
  const privateResult = await verifyDossierInBrowser(privateArtifact.bytes);
  assert.equal(privateResult.ok, true);
  assert.equal(privateResult.commons.eligible, false);
  assert.match(privateResult.commons.reason, /Artifact URI/);

  const unsignedMission = structuredClone(fixture.dossier);
  unsignedMission.mission.receiptId = null;
  unsignedMission.receipts = unsignedMission.receipts.filter((receipt) => receipt.kind !== 'mission');
  unsignedMission.limitations.push('mission_receipt_unavailable');
  const unsignedMissionBytes = Buffer.from(canonicalJson(unsignedMission));
  const unsignedNode = verifyContributionDossierBytes(unsignedMissionBytes);
  const unsignedBrowser = await verifyDossierInBrowser(unsignedMissionBytes);
  assert.equal(unsignedNode.layers.missionAndClaim, 'absent');
  assert.equal(unsignedBrowser.layers.missionAndClaim, 'absent');
  assert.equal(unsignedBrowser.gaps.includes('mission_receipt'), true);
  assert.equal(unsignedBrowser.commons.eligible, false);

  const gate = createInspectorRunGate();
  const slowSelection = gate.begin();
  const fastSelection = gate.begin();
  assert.equal(gate.isCurrent(slowSelection), false);
  assert.equal(gate.isCurrent(fastSelection), true);
  gate.cancel();
  assert.equal(gate.isCurrent(fastSelection), false);

  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { subtle: { importKey: async () => { const error = new Error('Ed25519 unavailable'); error.name = 'NotSupportedError'; throw error; } } },
  });
  try {
    await rejectsCode(verifyDossierInBrowser(fixture.bytes), 'CRYPTO_UNSUPPORTED');
  } finally {
    if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
    else delete globalThis.crypto;
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log(JSON.stringify({
  browserDossierVerifier: 'ok',
  gates: ['node-browser-full-lifecycle-parity', 'no-fetch', 'canonical', 'utf8', 'bounds', 'bidi-controls', 'signature-bindings', 'unsigned-mission-layer', 'ed25519-capability', 'run-token-ordering', 'commons-policy', 'artifact-bytes'],
}));
