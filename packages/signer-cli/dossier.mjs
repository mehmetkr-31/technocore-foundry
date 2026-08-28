import { createHash, createPublicKey, verify } from 'node:crypto';
import {
  canonicalJson,
  EVENT_SCHEMA,
  parseStrictJson,
  REVIEW_RECEIPT_SCHEMA,
  TCR1_DOMAIN,
  TCR1_TYPE,
  validateFoundryEventDocument,
  validateReviewReceiptDocument,
  validateVerificationReceiptDocument,
  VERIFICATION_RECEIPT_SCHEMA,
} from './core.mjs';

export const DOSSIER_SCHEMA = 'foundry-contribution-dossier-v1';
export const MAX_DOSSIER_BYTES = 2 * 1024 * 1024;
export const MAX_DOSSIER_RECEIPTS = 256;

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const KINDS = new Set([
  'mission', 'claim', 'result', 'revision', 'change_request', 'verification',
  'review', 'acceptance', 'finalization', 'attestation',
]);
const PREFIX = {
  mission: 'fms', claim: 'frc', revision: 'frv', change_request: 'fcr',
  verification: 'fev', review: 'frw', acceptance: 'fac', finalization: 'tcf',
  attestation: 'fat',
};

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function base58Decode(value) {
  if (!value || Array.from(value).some((character) => !BASE58.includes(character))) throw new Error('Malformed did:key base58 value.');
  let number = 0n;
  for (const character of value) number = number * 58n + BigInt(BASE58.indexOf(character));
  const output = [];
  while (number > 0n) {
    output.unshift(Number(number % 256n));
    number /= 256n;
  }
  for (const character of value) {
    if (character !== '1') break;
    output.unshift(0);
  }
  return Buffer.from(output);
}

function publicKeyForDid(did) {
  if (typeof did !== 'string' || !did.startsWith('did:key:z')) throw new Error('Expected an Ed25519 did:key signer.');
  const decoded = base58Decode(did.slice('did:key:z'.length));
  if (decoded.length !== 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) throw new Error('Unsupported did:key multicodec.');
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, decoded.subarray(2)]), type: 'spki', format: 'der' });
}

function domainBytes(domain, payload) {
  return Buffer.concat([Buffer.from(`${domain}\0`, 'utf8'), Buffer.from(canonicalJson(payload), 'utf8')]);
}

function validSignature(did, signature, bytes) {
  return typeof signature === 'string' && /^[A-Za-z0-9_-]{86}$/.test(signature) &&
    verify(null, bytes, publicKeyForDid(did), Buffer.from(signature, 'base64url'));
}

function claimantDid(receipt) {
  return typeof receipt.claimant === 'string' ? receipt.claimant : receipt.claimant?.did;
}

function verifyReceiptSignature(kind, payload) {
  if (['mission', 'claim', 'revision', 'change_request', 'acceptance', 'attestation'].includes(kind)) {
    if (!exactKeys(payload, ['event', 'signature']) || payload.event?.schema !== EVENT_SCHEMA) throw new Error(`Malformed ${kind} Foundry event envelope.`);
    validateFoundryEventDocument(payload.event);
    const expectedType = kind === 'change_request' ? 'change_request' : kind;
    if (payload.event.type !== expectedType || !validSignature(payload.event.actor, payload.signature, domainBytes(EVENT_SCHEMA, payload.event))) {
      throw new Error(`Invalid ${kind} Foundry event signature.`);
    }
    return payload.event.actor;
  }
  if (kind === 'result' || kind === 'finalization') {
    if (!payload || payload.type !== TCR1_TYPE || payload.version !== 1 || !payload.signature ||
      payload.signature.algorithm !== 'Ed25519' || payload.signature.domain !== TCR1_DOMAIN ||
      !exactKeys(payload.signature, ['algorithm', 'domain', 'value']) ||
      !Object.keys(payload).every((key) => ['type', 'version', 'task', 'claimant', 'artifacts', 'created_at', 'expires_at', 'evidence', 'signature'].includes(key)) ||
      !payload.task || !Object.keys(payload.task).every((key) => ['id', 'issuer', 'requirements_sha256'].includes(key)) ||
      !Array.isArray(payload.artifacts) || payload.artifacts.length < 1 ||
      !payload.artifacts.every((artifact) => artifact && !Array.isArray(artifact) && Object.keys(artifact).every((key) => ['type', 'uri', 'sha256', 'size'].includes(key))) ||
      (payload.evidence && (!Object.keys(payload.evidence).every((key) => ['repository', 'commit', 'pull_request', 'ci_url', 'ci_status', 'acceptance_sha256'].includes(key))))) throw new Error(`Malformed ${kind} TCR-1 receipt.`);
    const unsigned = { ...payload };
    delete unsigned.signature;
    const did = claimantDid(payload);
    if (!validSignature(did, payload.signature.value, domainBytes(TCR1_DOMAIN, unsigned))) throw new Error(`Invalid ${kind} TCR-1 signature.`);
    return did;
  }
  if (kind === 'verification' || kind === 'review') {
    const domain = kind === 'verification' ? VERIFICATION_RECEIPT_SCHEMA : REVIEW_RECEIPT_SCHEMA;
    const didField = kind === 'verification' ? 'verifierDid' : 'reviewerDid';
    if (!exactKeys(payload, ['receipt', 'signature']) || payload.receipt?.schema !== domain ||
      !exactKeys(payload.signature, ['algorithm', 'domain', 'value']) ||
      payload.signature.algorithm !== 'Ed25519' || payload.signature.domain !== domain) {
      throw new Error(`Malformed ${kind} receipt envelope.`);
    }
    const did = payload.receipt[didField];
    if (kind === 'verification') validateVerificationReceiptDocument(payload.receipt);
    else validateReviewReceiptDocument(payload.receipt);
    if (!validSignature(did, payload.signature.value, domainBytes(domain, payload.receipt))) throw new Error(`Invalid ${kind} signature.`);
    return did;
  }
  throw new Error(`Unsupported dossier receipt kind: ${kind}.`);
}

function assertDossierShape(dossier) {
  if (!exactKeys(dossier, ['schema', 'subject', 'snapshotAt', 'mission', 'claim', 'revisionChain', 'receipts', 'limitations', 'caveats']) || dossier.schema !== DOSSIER_SCHEMA) {
    throw new Error('Malformed contribution dossier envelope.');
  }
  if (!exactKeys(dossier.subject, ['missionId', 'claimId', 'claimantDid', 'selectedResultId', 'selectedState']) ||
    !/^(M-[0-9]{3}|F-[A-F0-9]{8})$/.test(dossier.subject.missionId) ||
    !/^frc_[a-f0-9]{24}$/.test(dossier.subject.claimId) ||
    !/^res_[a-f0-9]{24}$/.test(dossier.subject.selectedResultId) ||
    !['submitted', 'changes_requested', 'rejected', 'accepted', 'finalized'].includes(dossier.subject.selectedState)) {
    throw new Error('Malformed dossier subject.');
  }
  publicKeyForDid(dossier.subject.claimantDid);
  if (!exactKeys(dossier.mission, ['id', 'title', 'lane', 'summary', 'requirementsHash', 'issuerDid', 'status', 'createdAt', 'receiptId']) ||
    dossier.mission.id !== dossier.subject.missionId || !/^sha256:[a-f0-9]{64}$/.test(dossier.mission.requirementsHash)) {
    throw new Error('Malformed dossier mission snapshot.');
  }
  publicKeyForDid(dossier.mission.issuerDid);
  if (!exactKeys(dossier.claim, ['id', 'actorDid', 'createdAt', 'receiptId']) ||
    dossier.claim.id !== dossier.subject.claimId || dossier.claim.receiptId !== dossier.claim.id ||
    dossier.claim.actorDid !== dossier.subject.claimantDid) throw new Error('Malformed dossier claim snapshot.');
  if (!Array.isArray(dossier.revisionChain) || dossier.revisionChain.length < 1 || dossier.revisionChain.length > 5 ||
    !Array.isArray(dossier.receipts) || dossier.receipts.length < 2 || dossier.receipts.length > MAX_DOSSIER_RECEIPTS ||
    !Array.isArray(dossier.limitations) || !Array.isArray(dossier.caveats)) throw new Error('Malformed dossier collections.');
}

function receiptMap(dossier) {
  const map = new Map();
  for (const receipt of dossier.receipts) {
    if (!exactKeys(receipt, ['id', 'kind', 'schema', 'actorDid', 'createdAt', 'canonicalSha256', 'storedBytesSha256', 'rawPath', 'proofPath', 'payload']) ||
      !KINDS.has(receipt.kind) || !/^(?:fms|frc|res|frv|fcr|fev|frw|fac|tcf|fat)_[a-f0-9]{24}$/.test(receipt.id) ||
      receipt.rawPath !== `/api/receipts/${receipt.id}` || receipt.proofPath !== `/receipt/${receipt.id}` || map.has(receipt.id)) {
      throw new Error('Malformed or duplicate embedded dossier receipt.');
    }
    const canonical = canonicalJson(receipt.payload);
    const canonicalDigest = sha256(canonical);
    if (receipt.canonicalSha256 !== `sha256:${canonicalDigest}` ||
      receipt.storedBytesSha256 !== `sha256:${sha256(`${canonical}\n`)}`) {
      throw new Error(`Embedded receipt ${receipt.id} hash mismatch.`);
    }
    if (receipt.kind !== 'result') {
      const prefix = PREFIX[receipt.kind];
      if (!prefix || receipt.id !== `${prefix}_${canonicalDigest.slice(0, 24)}`) throw new Error(`Embedded receipt ${receipt.id} content address mismatch.`);
    }
    const signer = verifyReceiptSignature(receipt.kind, receipt.payload);
    if (signer !== receipt.actorDid) throw new Error(`Embedded receipt ${receipt.id} actor metadata mismatch.`);
    map.set(receipt.id, receipt);
  }
  return map;
}

function requireReceipt(map, id, kind, referenced) {
  const receipt = map.get(id);
  if (!receipt || receipt.kind !== kind) throw new Error(`Missing ${kind} receipt ${id}.`);
  referenced.add(id);
  return receipt;
}

function digestOf(receipt) {
  return receipt.canonicalSha256;
}

function verifyBindings(dossier, map) {
  const referenced = new Set();
  const issuer = dossier.mission.issuerDid;
  const claimant = dossier.subject.claimantDid;

  if (dossier.mission.receiptId) {
    const mission = requireReceipt(map, dossier.mission.receiptId, 'mission', referenced).payload.event;
    if (mission.actor !== issuer || mission.missionId !== dossier.mission.id || mission.title !== dossier.mission.title ||
      mission.lane.toUpperCase() !== dossier.mission.lane || mission.summary !== dossier.mission.summary ||
      mission.requirementsHash !== dossier.mission.requirementsHash) throw new Error('Mission receipt does not bind the dossier mission snapshot.');
  } else if (!dossier.limitations.includes('mission_receipt_unavailable')) {
    throw new Error('Unsigned seed mission limitation is not declared.');
  }
  const claim = requireReceipt(map, dossier.claim.receiptId, 'claim', referenced).payload.event;
  if (claim.actor !== claimant || claim.missionId !== dossier.mission.id || claim.requirementsHash !== dossier.mission.requirementsHash) {
    throw new Error('Claim receipt does not bind the dossier subject.');
  }

  for (let index = 0; index < dossier.revisionChain.length; index += 1) {
    const revision = dossier.revisionChain[index];
    if (!exactKeys(revision, ['revision', 'resultId', 'receiptId', 'resultReceiptSha256', 'createdAt', 'artifact', 'github', 'revisionLink', 'issuerOutcome', 'executionEvidenceReceiptIds', 'reviewReceiptIds', 'attestationReceiptIds']) ||
      revision.revision !== index + 1 || revision.receiptId !== revision.resultId || !/^res_[a-f0-9]{24}$/.test(revision.resultId) ||
      !exactKeys(revision.artifact, ['name', 'mediaType', 'bytes', 'sha256', 'downloadPath']) ||
      revision.artifact.downloadPath !== `/api/artifacts/${revision.resultId}` || !/^sha256:[a-f0-9]{64}$/.test(revision.artifact.sha256)) {
      throw new Error('Malformed dossier revision entry.');
    }
    const resultProof = requireReceipt(map, revision.receiptId, 'result', referenced);
    const result = resultProof.payload;
    if (revision.resultReceiptSha256 !== digestOf(resultProof) || claimantDid(result) !== claimant ||
      result.task?.id !== dossier.mission.id || result.task?.issuer !== issuer ||
      result.task?.requirements_sha256 !== dossier.mission.requirementsHash.slice(7) || result.artifacts?.length !== 1 ||
      result.artifacts[0].sha256 !== revision.artifact.sha256.slice(7) || result.artifacts[0].size !== revision.artifact.bytes ||
      result.artifacts[0].type !== revision.artifact.mediaType || result.artifacts[0].uri?.endsWith(revision.artifact.downloadPath) !== true ||
      (result.evidence?.repository ?? null) !== revision.github?.claim?.repository ||
      (result.evidence?.commit ?? null) !== revision.github?.claim?.commit) {
      throw new Error(`Result ${revision.resultId} does not bind its revision snapshot.`);
    }

    if (index === 0) {
      if (revision.revisionLink !== null) throw new Error('Root revision unexpectedly contains a parent link.');
    } else {
      const parent = dossier.revisionChain[index - 1];
      const link = revision.revisionLink;
      if (!link || !exactKeys(link, ['parentResultId', 'parentReceiptSha256', 'changeRequestReceiptId', 'changeRequestReceiptSha256', 'revisionReceiptId']) ||
        link.parentResultId !== parent.resultId || link.parentReceiptSha256 !== parent.resultReceiptSha256) throw new Error('Revision parent hash link mismatch.');
      const change = requireReceipt(map, link.changeRequestReceiptId, 'change_request', referenced);
      if (link.changeRequestReceiptSha256 !== digestOf(change) || change.payload.event.actor !== issuer ||
        change.payload.event.resultId !== parent.resultId || change.payload.event.resultSha256 !== parent.resultReceiptSha256) {
        throw new Error('Revision change-request link mismatch.');
      }
      const chain = requireReceipt(map, link.revisionReceiptId, 'revision', referenced).payload.event;
      if (chain.actor !== claimant || chain.resultId !== revision.resultId || chain.resultSha256 !== revision.resultReceiptSha256 ||
        chain.parentResultId !== parent.resultId || chain.parentResultSha256 !== parent.resultReceiptSha256 ||
        chain.changeRequestId !== link.changeRequestReceiptId || chain.changeRequestSha256 !== link.changeRequestReceiptSha256 ||
        chain.revision !== revision.revision) throw new Error('Claimant revision receipt link mismatch.');
    }

    const outcome = revision.issuerOutcome;
    if (!exactKeys(outcome, ['decision', 'changeRequestReceiptId', 'acceptanceReceiptId', 'finalReceiptId'])) throw new Error('Malformed issuer outcome.');
    if (outcome.changeRequestReceiptId) {
      const change = requireReceipt(map, outcome.changeRequestReceiptId, 'change_request', referenced).payload.event;
      if (change.actor !== issuer || change.resultId !== revision.resultId || change.resultSha256 !== revision.resultReceiptSha256) throw new Error('Issuer change request target mismatch.');
    }
    let acceptanceProof;
    if (outcome.acceptanceReceiptId) {
      acceptanceProof = requireReceipt(map, outcome.acceptanceReceiptId, 'acceptance', referenced);
      const acceptance = acceptanceProof.payload.event;
      if (acceptance.actor !== issuer || acceptance.resultId !== revision.resultId || acceptance.resultSha256 !== revision.resultReceiptSha256 || acceptance.decision !== outcome.decision) {
        throw new Error('Issuer acceptance target mismatch.');
      }
    } else if (outcome.decision !== null) throw new Error('Issuer decision lacks its signed receipt.');
    if (outcome.finalReceiptId) {
      if (!acceptanceProof || outcome.decision !== 'accepted') throw new Error('Finalization lacks exact issuer acceptance.');
      const final = requireReceipt(map, outcome.finalReceiptId, 'finalization', referenced).payload;
      if (claimantDid(final) !== claimant || final.task?.id !== dossier.mission.id ||
        final.evidence?.acceptance_sha256 !== digestOf(acceptanceProof).slice(7) ||
        final.artifacts?.[0]?.sha256 !== revision.artifact.sha256.slice(7)) throw new Error('Final TCR-1 acceptance binding mismatch.');
    }

    const verificationDigests = new Set();
    for (const id of revision.executionEvidenceReceiptIds) {
      const proof = requireReceipt(map, id, 'verification', referenced);
      const receipt = proof.payload.receipt;
      if (receipt.resultId !== revision.resultId || receipt.resultReceiptSha256 !== revision.resultReceiptSha256 ||
        receipt.candidateCommit !== revision.github.claim.commit || !receipt.checks?.every((check) => check.exitCode === 0)) {
        throw new Error('Execution evidence binding mismatch.');
      }
      verificationDigests.add(digestOf(proof));
    }
    for (const id of revision.reviewReceiptIds) {
      const proof = requireReceipt(map, id, 'review', referenced);
      const receipt = proof.payload.receipt;
      if (receipt.missionId !== dossier.mission.id || receipt.resultId !== revision.resultId ||
        receipt.resultReceiptSha256 !== revision.resultReceiptSha256 ||
        (receipt.candidateCommit ?? null) !== revision.github.claim.commit ||
        receipt.reviewerDid === claimant || receipt.reviewerDid === issuer ||
        (receipt.verificationReceiptSha256 && !verificationDigests.has(receipt.verificationReceiptSha256))) {
        throw new Error('Structured review binding or independence mismatch.');
      }
    }
    for (const id of revision.attestationReceiptIds) {
      const event = requireReceipt(map, id, 'attestation', referenced).payload.event;
      if (event.missionId !== dossier.mission.id || event.resultId !== revision.resultId ||
        event.resultSha256 !== revision.resultReceiptSha256 || event.actor === claimant || event.actor === issuer) {
        throw new Error('Peer attestation binding or independence mismatch.');
      }
    }
  }
  if (dossier.revisionChain.at(-1).resultId !== dossier.subject.selectedResultId) throw new Error('Selected result is not the latest revision.');
  const unreferenced = dossier.receipts.filter((receipt) => !referenced.has(receipt.id));
  if (unreferenced.length) throw new Error(`Dossier contains unreferenced receipt ${unreferenced[0].id}.`);
}

export function verifyContributionDossierBytes(input, options = {}) {
  const bytes = Buffer.from(input);
  if (bytes.length < 2 || bytes.length > MAX_DOSSIER_BYTES) throw new Error('Dossier byte size is outside the supported profile.');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const dossier = parseStrictJson(source);
  const canonical = Buffer.from(canonicalJson(dossier), 'utf8');
  if (!canonical.equals(bytes)) throw new Error('Dossier file is not exact canonical JSON bytes.');
  const digest = sha256(canonical);
  const id = `fds_${digest.slice(0, 24)}`;
  if (options.expectedId && options.expectedId !== id) throw new Error('Dossier identifier does not match canonical bytes.');
  assertDossierShape(dossier);
  const map = receiptMap(dossier);
  verifyBindings(dossier, map);

  let artifact = 'not_checked';
  if (options.artifactBytes) {
    const selected = dossier.revisionChain.at(-1).artifact;
    const supplied = Buffer.from(options.artifactBytes);
    if (supplied.length !== selected.bytes || sha256(supplied) !== selected.sha256.slice(7)) throw new Error('Supplied artifact bytes do not match the selected revision.');
    artifact = 'valid';
  }
  const count = (kind) => dossier.receipts.filter((receipt) => receipt.kind === kind).length;
  return {
    ok: true,
    id,
    schema: dossier.schema,
    sha256: `sha256:${digest}`,
    selectedResultId: dossier.subject.selectedResultId,
    selectedState: dossier.subject.selectedState,
    layers: {
      contentAddress: 'valid',
      receiptSignatures: 'valid',
      missionAndClaim: 'valid',
      revisionChain: 'valid',
      issuerOutcome: count('acceptance') || count('change_request') ? 'valid' : 'absent',
      executionEvidence: count('verification') ? 'valid' : 'absent',
      structuredReview: count('review') ? 'valid' : 'absent',
      peerEvidence: count('attestation') ? 'valid' : 'absent',
      artifact,
    },
    caveat: 'Valid signatures and hash links prove key control and byte integrity, not authorship, correctness, identity, payment, or airdrop eligibility.',
  };
}
