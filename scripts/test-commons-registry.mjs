import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCommonsIndex,
  canonicalCommonsIndex,
  loadCommonsRegistry,
  MAX_COMMONS_DOSSIER_BYTES,
  verifyCommonsDossierBytes,
} from '../packages/signer-cli/commons.mjs';
import { canonicalJson } from '../packages/signer-cli/core.mjs';
import { verifyContributionDossierBytes } from '../packages/signer-cli/dossier.mjs';
import { createAcceptedDossierFixture } from './fixtures/accepted-dossier.mjs';

const fixture = createAcceptedDossierFixture();
const accepted = verifyCommonsDossierBytes(fixture.bytes, { expectedId: fixture.verified.id });
assert.equal(accepted.entry.selectedState, 'accepted');
assert.equal(accepted.entry.roleSeparation, 'distinct_keys');
assert.deepEqual(accepted.entry.proofGaps, ['execution_evidence', 'structured_review', 'peer_evidence', 'artifact_bytes']);

const root = await mkdtemp(join(tmpdir(), 'foundry-commons-'));
try {
  const validDirectory = join(root, 'valid');
  await mkdir(validDirectory);
  await writeFile(join(validDirectory, `${fixture.verified.id}.json`), fixture.bytes, { mode: 0o644 });
  const records = await loadCommonsRegistry(validDirectory);
  assert.equal(records.length, 1);
  const firstIndex = buildCommonsIndex(records);
  const secondIndex = buildCommonsIndex(await loadCommonsRegistry(validDirectory));
  assert.equal(canonicalCommonsIndex(firstIndex), canonicalCommonsIndex(secondIndex));
  assert.equal(firstIndex.metrics.dossiers, 1);
  assert.equal(Object.hasOwn(firstIndex.entries[0], 'declaredSnapshotAt'), false);

  const submitted = structuredClone(fixture.dossier);
  submitted.subject.selectedState = 'submitted';
  submitted.revisionChain[0].issuerOutcome = { decision: null, changeRequestReceiptId: null, acceptanceReceiptId: null, finalReceiptId: null };
  submitted.receipts = submitted.receipts.filter((receipt) => receipt.kind !== 'acceptance');
  const submittedBytes = Buffer.from(canonicalJson(submitted));
  assert.equal(verifyContributionDossierBytes(submittedBytes).selectedState, 'submitted');
  assert.throws(() => verifyCommonsDossierBytes(submittedBytes), /acceptance/i);

  const forgedState = structuredClone(submitted);
  forgedState.subject.selectedState = 'finalized';
  assert.throws(() => verifyContributionDossierBytes(Buffer.from(canonicalJson(forgedState))), /selected state/i);

  const forgedMissionStatus = structuredClone(fixture.dossier);
  forgedMissionStatus.mission.status = 'officially_verified';
  assert.throws(() => verifyContributionDossierBytes(Buffer.from(canonicalJson(forgedMissionStatus))), /mission snapshot/i);

  const mismatchedRequirements = createAcceptedDossierFixture({ requirementsHash: `sha256:${'2'.repeat(64)}`, verifyCore: false });
  assert.throws(() => verifyContributionDossierBytes(mismatchedRequirements.bytes), /requirements bytes/i);

  const wrongAcceptanceMission = createAcceptedDossierFixture({ acceptanceMissionId: 'F-BAD0C0DE', verifyCore: false });
  assert.throws(() => verifyContributionDossierBytes(wrongAcceptanceMission.bytes), /acceptance target/i);

  const contradictoryFinalization = createAcceptedDossierFixture({ finalize: true, finalArtifactType: 'application/octet-stream', verifyCore: false });
  assert.throws(() => verifyContributionDossierBytes(contradictoryFinalization.bytes), /preserve the result/i);

  const privateArtifact = createAcceptedDossierFixture({ artifactUri: 'http://10.0.0.8/api/artifacts/res_111111111111111111111111' });
  assert.throws(() => verifyCommonsDossierBytes(privateArtifact.bytes), /Artifact URI/i);
  const credentialArtifact = createAcceptedDossierFixture({ artifactUri: 'https://agent:credential@example.org/api/artifacts/res_111111111111111111111111' });
  assert.throws(() => verifyCommonsDossierBytes(credentialArtifact.bytes), /Artifact URI/i);
  const unsafeRepository = createAcceptedDossierFixture({ repository: 'https://github.com/example/project?ref=private' });
  assert.throws(() => verifyCommonsDossierBytes(unsafeRepository.bytes), /GitHub repository/i);

  const malformedObservation = structuredClone(fixture.dossier);
  malformedObservation.revisionChain[0].github.observation = { signed: false, detail: 'unsigned and incomplete' };
  const malformedObservationBytes = Buffer.from(canonicalJson(malformedObservation));
  assert.equal(verifyContributionDossierBytes(malformedObservationBytes).ok, true);
  assert.throws(() => verifyCommonsDossierBytes(malformedObservationBytes), /GitHub observation/i);

  const oversizedDid = structuredClone(fixture.dossier);
  oversizedDid.subject.claimantDid = `did:key:z${'1'.repeat(100_000)}`;
  assert.throws(() => verifyContributionDossierBytes(Buffer.from(canonicalJson(oversizedDid))), /bounded Ed25519/i);

  const alteredTitle = structuredClone(fixture.dossier);
  alteredTitle.mission.title = '<script>alert(1)</script>';
  assert.throws(() => verifyContributionDossierBytes(Buffer.from(canonicalJson(alteredTitle))), /bind|signature/i);

  assert.throws(() => verifyCommonsDossierBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fixture.bytes])), /canonical|JSON|UTF/i);
  assert.throws(() => verifyCommonsDossierBytes(Buffer.concat([fixture.bytes, Buffer.from('\n')])), /canonical/i);
  assert.throws(() => verifyCommonsDossierBytes(Buffer.from('{"x":1,"x":2}')), /canonical|duplicate|dossier/i);
  assert.throws(() => verifyCommonsDossierBytes(Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d])), /encoded|UTF/i);
  assert.throws(() => verifyCommonsDossierBytes(Buffer.alloc(MAX_COMMONS_DOSSIER_BYTES + 1, 0x20)), /bytes/i);
  assert.throws(() => verifyCommonsDossierBytes(Buffer.from(`${'['.repeat(65)}0${']'.repeat(65)}`)), /depth/i);
  assert.throws(() => verifyCommonsDossierBytes(Buffer.from('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 1')), /LFS/i);

  const wrongNameDirectory = join(root, 'wrong-name');
  await mkdir(wrongNameDirectory);
  await writeFile(join(wrongNameDirectory, 'fds_aaaaaaaaaaaaaaaaaaaaaaaa.json'), fixture.bytes, { mode: 0o644 });
  await assert.rejects(() => loadCommonsRegistry(wrongNameDirectory), /identifier/i);

  const symlinkDirectory = join(root, 'symlink');
  await mkdir(symlinkDirectory);
  await symlink(join(validDirectory, `${fixture.verified.id}.json`), join(symlinkDirectory, `${fixture.verified.id}.json`));
  await assert.rejects(() => loadCommonsRegistry(symlinkDirectory), /regular file/i);

  const executableDirectory = join(root, 'executable');
  await mkdir(executableDirectory);
  const executablePath = join(executableDirectory, `${fixture.verified.id}.json`);
  await writeFile(executablePath, fixture.bytes);
  await chmod(executablePath, 0o755);
  await assert.rejects(() => loadCommonsRegistry(executableDirectory), /executable/i);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log(JSON.stringify({
  commonsRegistry: 'ok',
  gates: ['canonical-bytes', 'signed-state', 'signed-mission', 'context-binding', 'public-url-policy', 'filename', 'size', 'depth', 'utf8', 'lfs', 'symlink', 'mode', 'determinism'],
}));
