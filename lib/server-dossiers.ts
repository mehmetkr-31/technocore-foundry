import { env } from 'cloudflare:workers';
import { createDossier, findDossier, type DossierRecord } from '@/db/queries';
import type { ContributionDossier } from './contribution-dossier';
import { sha256Hex } from './foundry-crypto';
import { putImmutableObject } from './server-receipts';

type AssembledDossier = {
  dossier: ContributionDossier;
  bytes: Uint8Array;
  sha256: string;
  id: string;
};

function sameRecord(left: DossierRecord, right: DossierRecord) {
  return left.id === right.id &&
    left.resultId === right.resultId &&
    left.missionId === right.missionId &&
    left.claimId === right.claimId &&
    left.claimantDid === right.claimantDid &&
    left.objectKey === right.objectKey &&
    left.sha256 === right.sha256 &&
    left.bytes === right.bytes &&
    left.snapshotAt === right.snapshotAt;
}

export async function persistDossier(assembled: AssembledDossier) {
  const objectKey = `dossiers/${assembled.id}.json`;
  const expected: DossierRecord = {
    id: assembled.id,
    resultId: assembled.dossier.subject.selectedResultId,
    missionId: assembled.dossier.subject.missionId,
    claimId: assembled.dossier.subject.claimId,
    claimantDid: assembled.dossier.subject.claimantDid,
    objectKey,
    sha256: assembled.sha256,
    bytes: assembled.bytes.byteLength,
    snapshotAt: assembled.dossier.snapshotAt,
    createdAt: new Date().toISOString(),
  };
  const existing = await findDossier(assembled.id);
  if (existing) {
    if (!sameRecord(existing, expected)) throw new Error('Immutable dossier identifier collision.');
    return { record: existing, created: false };
  }

  await putImmutableObject({
    objectKey,
    bytes: assembled.bytes,
    contentType: 'application/json',
    customMetadata: {
      schema: assembled.dossier.schema,
      resultId: assembled.dossier.subject.selectedResultId,
      missionId: assembled.dossier.subject.missionId,
    },
  });

  try {
    await createDossier(expected);
    return { record: expected, created: true };
  } catch (error) {
    const raced = await findDossier(assembled.id);
    if (raced && sameRecord(raced, expected)) return { record: raced, created: false };
    throw error;
  }
}

export async function loadDossierBytes(id: string) {
  const record = await findDossier(id);
  if (!record || !env.FILES) return null;
  const object = await env.FILES.get(record.objectKey);
  if (!object) return null;
  const bytes = new Uint8Array(await object.arrayBuffer());
  const digest = await sha256Hex(bytes);
  if (bytes.byteLength !== record.bytes || digest !== record.sha256 || id !== `fds_${digest.slice(0, 24)}`) {
    throw new Error('Dossier storage integrity check failed.');
  }
  return { record, bytes };
}
