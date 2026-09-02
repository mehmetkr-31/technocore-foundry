import {
  base64UrlToBytes,
  canonicalJson,
  publicKeyFromDid,
  sha256Hex,
  verifyReviewReceipt,
  verifySignedEvent,
  verifyVerificationReceipt,
} from './foundry-crypto.ts';
import { decodeStrictUtf8, parseStrictJson } from './strict-json.ts';

export const BROWSER_DOSSIER_MAX_BYTES = 512 * 1024;
export const BROWSER_ARTIFACT_MAX_BYTES = 5 * 1024 * 1024;

const EVENT_SCHEMA = 'foundry-event-v1';
const TCR1_TYPE = 'technocore-task-receipt';
const TCR1_DOMAIN = 'technocore-task-receipt:v1';
const VERIFICATION_SCHEMA = 'foundry-verification-receipt-v1';
const REVIEW_SCHEMA = 'foundry-review-receipt-v1';
const DOSSIER_SCHEMA = 'foundry-contribution-dossier-v1';
const MAX_RECEIPTS = 64;
const MAX_DIDS = 32;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 50_000;
const RECEIPT_CAPS = { verification: 16, review: 16, attestation: 32 };
const KINDS = new Set([
  'mission', 'claim', 'result', 'revision', 'change_request', 'verification',
  'review', 'acceptance', 'finalization', 'attestation',
]);
const PREFIX = {
  mission: 'fms', claim: 'frc', revision: 'frv', change_request: 'fcr',
  verification: 'fev', review: 'frw', acceptance: 'fac', finalization: 'tcf',
  attestation: 'fat',
};

export class BrowserDossierError extends Error {
  constructor(code, stage, message) {
    super(message);
    this.name = 'BrowserDossierError';
    this.code = code;
    this.stage = stage;
  }
}

function fail(code, stage, message) {
  throw new BrowserDossierError(code, stage, message);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function allowedKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key));
}

function boundedText(value, minimum, maximum) {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum &&
    !/[\u0000-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(value);
}

function validTimestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value));
}

function assertDid(value) {
  if (typeof value !== 'string' || !/^did:key:z[1-9A-HJ-NP-Za-km-z]{47}$/.test(value)) {
    throw new Error('Expected a bounded Ed25519 did:key signer.');
  }
  publicKeyFromDid(value);
  return value;
}

function concatBytes(...parts) {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function domainBytes(domain, value) {
  return concatBytes(new TextEncoder().encode(`${domain}\0`), new TextEncoder().encode(canonicalJson(value)));
}

async function assertEd25519Support() {
  if (!globalThis.crypto?.subtle) fail('CRYPTO_UNSUPPORTED', 'crypto', 'This browser does not expose WebCrypto. Use the local CLI verifier instead.');
  try {
    const probeKey = Uint8Array.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'.match(/../g), (byte) => Number.parseInt(byte, 16));
    await globalThis.crypto.subtle.importKey('raw', probeKey, { name: 'Ed25519' }, false, ['verify']);
  } catch {
    fail('CRYPTO_UNSUPPORTED', 'crypto', 'This browser does not support Ed25519 verification. Run `npm run signer -- verify-dossier --input <file>` locally.');
  }
}

async function validSignature(did, signature, bytes) {
  if (!globalThis.crypto?.subtle) fail('CRYPTO_UNSUPPORTED', 'crypto', 'This browser does not expose WebCrypto.');
  assertDid(did);
  if (typeof signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(signature)) return false;
  const publicKey = await crypto.subtle.importKey('raw', publicKeyFromDid(did), { name: 'Ed25519' }, false, ['verify']);
  return crypto.subtle.verify('Ed25519', publicKey, base64UrlToBytes(signature), bytes);
}

function claimantDid(receipt) {
  return typeof receipt?.claimant === 'string' ? receipt.claimant : receipt?.claimant?.did;
}

function validTcr1Shape(payload) {
  const artifactValid = (artifact) => allowedKeys(artifact, ['type', 'uri', 'sha256', 'size']) &&
    boundedText(artifact.type, 1, 120) && boundedText(artifact.uri, 1, 2_000) && /^[a-f0-9]{64}$/.test(artifact.sha256) &&
    (artifact.size === undefined || (Number.isSafeInteger(artifact.size) && artifact.size >= 0 && artifact.size <= BROWSER_ARTIFACT_MAX_BYTES));
  const claimant = typeof payload?.claimant === 'string'
    ? payload.claimant
    : exactKeys(payload?.claimant, ['did']) ? payload.claimant.did : null;
  const evidence = payload?.evidence;
  const evidenceValid = evidence === undefined || (allowedKeys(evidence, ['repository', 'commit', 'pull_request', 'ci_url', 'ci_status', 'acceptance_sha256']) &&
    (evidence.repository === undefined || boundedText(evidence.repository, 1, 500)) &&
    (evidence.commit === undefined || /^[a-f0-9]{40}$/.test(evidence.commit)) &&
    (evidence.pull_request === undefined || boundedText(evidence.pull_request, 1, 500)) &&
    (evidence.ci_url === undefined || boundedText(evidence.ci_url, 1, 500)) &&
    (evidence.ci_status === undefined || ['success', 'failure', 'pending', 'cancelled'].includes(evidence.ci_status)) &&
    (evidence.acceptance_sha256 === undefined || /^[a-f0-9]{64}$/.test(evidence.acceptance_sha256)));
  return allowedKeys(payload, ['type', 'version', 'task', 'claimant', 'artifacts', 'created_at', 'expires_at', 'evidence', 'signature']) &&
    exactKeys(payload?.task, ['id', 'issuer', 'requirements_sha256']) && boundedText(payload.task.id, 1, 120) &&
    typeof payload.task.issuer === 'string' && /^[a-f0-9]{64}$/.test(payload.task.requirements_sha256) &&
    typeof claimant === 'string' && validTimestamp(payload.created_at) &&
    (payload.expires_at === undefined || validTimestamp(payload.expires_at)) &&
    Array.isArray(payload.artifacts) && payload.artifacts.length >= 1 && payload.artifacts.length <= 16 && payload.artifacts.every(artifactValid) &&
    evidenceValid;
}

async function verifyReceiptSignature(kind, payload) {
  if (['mission', 'claim', 'revision', 'change_request', 'acceptance', 'attestation'].includes(kind)) {
    if (!exactKeys(payload, ['event', 'signature']) || payload.event?.schema !== EVENT_SCHEMA || payload.event?.type !== kind) {
      throw new Error(`Malformed ${kind} Foundry event envelope.`);
    }
    if (!(await verifySignedEvent(payload))) throw new Error(`Invalid ${kind} Foundry event signature.`);
    return payload.event.actor;
  }
  if (kind === 'result' || kind === 'finalization') {
    if (!payload || payload.type !== TCR1_TYPE || payload.version !== 1 || !payload.signature ||
      payload.signature.algorithm !== 'Ed25519' || payload.signature.domain !== TCR1_DOMAIN ||
      !exactKeys(payload.signature, ['algorithm', 'domain', 'value']) || !validTcr1Shape(payload)) {
      throw new Error(`Malformed ${kind} TCR-1 receipt.`);
    }
    const unsigned = { ...payload };
    delete unsigned.signature;
    const did = claimantDid(payload);
    if (!(await validSignature(did, payload.signature.value, domainBytes(TCR1_DOMAIN, unsigned)))) {
      throw new Error(`Invalid ${kind} TCR-1 signature.`);
    }
    return did;
  }
  if (kind === 'verification') {
    if (!exactKeys(payload, ['receipt', 'signature']) || payload.receipt?.schema !== VERIFICATION_SCHEMA ||
      !exactKeys(payload.signature, ['algorithm', 'domain', 'value']) ||
      payload.signature.algorithm !== 'Ed25519' || payload.signature.domain !== VERIFICATION_SCHEMA ||
      !(await verifyVerificationReceipt(payload))) throw new Error('Invalid verification receipt signature.');
    return payload.receipt.verifierDid;
  }
  if (kind === 'review') {
    if (!exactKeys(payload, ['receipt', 'signature']) || payload.receipt?.schema !== REVIEW_SCHEMA ||
      !exactKeys(payload.signature, ['algorithm', 'domain', 'value']) ||
      payload.signature.algorithm !== 'Ed25519' || payload.signature.domain !== REVIEW_SCHEMA ||
      !(await verifyReviewReceipt(payload))) throw new Error('Invalid review receipt signature.');
    return payload.receipt.reviewerDid;
  }
  throw new Error(`Unsupported dossier receipt kind: ${kind}.`);
}

function assertJsonResourceProfile(bytes, source) {
  if (bytes.byteLength < 2 || bytes.byteLength > BROWSER_DOSSIER_MAX_BYTES) {
    fail('FILE_SIZE', 'file', `Dossier must be between 2 and ${BROWSER_DOSSIER_MAX_BYTES} bytes.`);
  }
  if (source.startsWith('version https://git-lfs.github.com/spec/v1')) fail('LFS_POINTER', 'file', 'Git LFS pointer files are not dossiers.');
  let depth = 0;
  let nodes = 1;
  let inString = false;
  let escaped = false;
  for (const character of source) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{' || character === '[') {
      depth += 1;
      nodes += 1;
      if (depth > MAX_JSON_DEPTH) fail('JSON_DEPTH', 'profile', 'Dossier exceeds the JSON depth limit.');
    } else if (character === '}' || character === ']') depth -= 1;
    else if (character === ',') nodes += 1;
    if (nodes > MAX_JSON_NODES) fail('JSON_NODES', 'profile', 'Dossier exceeds the JSON node limit.');
  }
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
  assertDid(dossier.subject.claimantDid);
  if (!exactKeys(dossier.mission, ['id', 'title', 'lane', 'summary', 'requirementsHash', 'issuerDid', 'status', 'createdAt', 'receiptId']) ||
    dossier.mission.id !== dossier.subject.missionId || !/^sha256:[a-f0-9]{64}$/.test(dossier.mission.requirementsHash) ||
    !boundedText(dossier.mission.title, 8, 100) || !boundedText(dossier.mission.lane, 3, 40) ||
    !boundedText(dossier.mission.summary, 20, 300) || !['open', 'closed'].includes(dossier.mission.status) ||
    !validTimestamp(dossier.mission.createdAt) || (dossier.mission.receiptId !== null && !/^fms_[a-f0-9]{24}$/.test(dossier.mission.receiptId))) {
    throw new Error('Malformed dossier mission snapshot.');
  }
  assertDid(dossier.mission.issuerDid);
  if (!exactKeys(dossier.claim, ['id', 'actorDid', 'createdAt', 'receiptId']) ||
    dossier.claim.id !== dossier.subject.claimId || dossier.claim.receiptId !== dossier.claim.id ||
    dossier.claim.actorDid !== dossier.subject.claimantDid || !validTimestamp(dossier.claim.createdAt) || !validTimestamp(dossier.snapshotAt)) {
    throw new Error('Malformed dossier claim or snapshot timestamp.');
  }
  if (!Array.isArray(dossier.revisionChain) || dossier.revisionChain.length < 1 || dossier.revisionChain.length > 5 ||
    !Array.isArray(dossier.receipts) || dossier.receipts.length < 2 || dossier.receipts.length > MAX_RECEIPTS ||
    !Array.isArray(dossier.limitations) || dossier.limitations.length > 16 ||
    !dossier.limitations.every((value) => typeof value === 'string' && /^[a-z0-9][a-z0-9_]{0,63}$/.test(value)) ||
    !Array.isArray(dossier.caveats) || dossier.caveats.length > 16 ||
    !dossier.caveats.every((value) => boundedText(value, 1, 500))) throw new Error('Malformed dossier collections.');
}

async function receiptMap(dossier) {
  const map = new Map();
  for (const receipt of dossier.receipts) {
    if (!exactKeys(receipt, ['id', 'kind', 'schema', 'actorDid', 'createdAt', 'canonicalSha256', 'storedBytesSha256', 'rawPath', 'proofPath', 'payload']) ||
      !KINDS.has(receipt.kind) || !/^(?:fms|frc|res|frv|fcr|fev|frw|fac|tcf|fat)_[a-f0-9]{24}$/.test(receipt.id) ||
      !boundedText(receipt.schema, 1, 80) || !validTimestamp(receipt.createdAt) ||
      receipt.rawPath !== `/api/receipts/${receipt.id}` || receipt.proofPath !== `/receipt/${receipt.id}` || map.has(receipt.id)) {
      throw new Error('Malformed or duplicate embedded dossier receipt.');
    }
    assertDid(receipt.actorDid);
    const canonical = canonicalJson(receipt.payload);
    const canonicalDigest = await sha256Hex(canonical);
    const storedDigest = await sha256Hex(`${canonical}\n`);
    if (receipt.canonicalSha256 !== `sha256:${canonicalDigest}` || receipt.storedBytesSha256 !== `sha256:${storedDigest}`) {
      throw new Error(`Embedded receipt ${receipt.id} hash mismatch.`);
    }
    if (receipt.kind !== 'result') {
      const prefix = PREFIX[receipt.kind];
      if (!prefix || receipt.id !== `${prefix}_${canonicalDigest.slice(0, 24)}`) throw new Error(`Embedded receipt ${receipt.id} content address mismatch.`);
    }
    const signer = await verifyReceiptSignature(receipt.kind, receipt.payload);
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

function evidenceWithoutAcceptance(evidence) {
  if (!evidence) return null;
  const output = Object.fromEntries(Object.entries(evidence).filter(([key]) => key !== 'acceptance_sha256'));
  return Object.keys(output).length ? output : null;
}

async function verifyBindings(dossier, map) {
  const referenced = new Set();
  const issuer = dossier.mission.issuerDid;
  const claimant = dossier.subject.claimantDid;
  if (dossier.mission.receiptId) {
    const mission = requireReceipt(map, dossier.mission.receiptId, 'mission', referenced).payload.event;
    if (mission.actor !== issuer || mission.missionId !== dossier.mission.id || mission.title !== dossier.mission.title ||
      mission.lane.toUpperCase() !== dossier.mission.lane || mission.summary !== dossier.mission.summary ||
      mission.requirementsHash !== dossier.mission.requirementsHash ||
      `sha256:${await sha256Hex(mission.requirements)}` !== dossier.mission.requirementsHash) {
      throw new Error('Mission receipt does not bind the exact dossier mission and requirements bytes.');
    }
  } else if (!dossier.limitations.includes('mission_receipt_unavailable')) throw new Error('Unsigned mission limitation is not declared.');

  const claim = requireReceipt(map, dossier.claim.receiptId, 'claim', referenced).payload.event;
  if (claim.actor !== claimant || claim.missionId !== dossier.mission.id || claim.requirementsHash !== dossier.mission.requirementsHash) {
    throw new Error('Claim receipt does not bind the dossier subject.');
  }

  for (let index = 0; index < dossier.revisionChain.length; index += 1) {
    const revision = dossier.revisionChain[index];
    if (!exactKeys(revision, ['revision', 'resultId', 'receiptId', 'resultReceiptSha256', 'createdAt', 'artifact', 'github', 'revisionLink', 'issuerOutcome', 'executionEvidenceReceiptIds', 'reviewReceiptIds', 'attestationReceiptIds']) ||
      revision.revision !== index + 1 || revision.receiptId !== revision.resultId || !/^res_[a-f0-9]{24}$/.test(revision.resultId) ||
      !exactKeys(revision.artifact, ['name', 'mediaType', 'bytes', 'sha256', 'downloadPath']) ||
      !boundedText(revision.artifact.name, 1, 180) || !boundedText(revision.artifact.mediaType, 1, 120) ||
      !Number.isSafeInteger(revision.artifact.bytes) || revision.artifact.bytes < 0 || revision.artifact.bytes > BROWSER_ARTIFACT_MAX_BYTES ||
      !validTimestamp(revision.createdAt) || revision.artifact.downloadPath !== `/api/artifacts/${revision.resultId}` ||
      !/^sha256:[a-f0-9]{64}$/.test(revision.artifact.sha256)) throw new Error('Malformed dossier revision entry.');
    if (!exactKeys(revision.github, ['claim', 'observation']) || !exactKeys(revision.github.claim, ['repository', 'commit']) ||
      (revision.github.claim.repository !== null && !boundedText(revision.github.claim.repository, 1, 500)) ||
      (revision.github.claim.commit !== null && !/^[a-f0-9]{40}$/.test(revision.github.claim.commit))) throw new Error('Malformed dossier GitHub claim snapshot.');
    if (!Array.isArray(revision.executionEvidenceReceiptIds) || !Array.isArray(revision.reviewReceiptIds) || !Array.isArray(revision.attestationReceiptIds)) {
      throw new Error('Malformed dossier evidence receipt lists.');
    }
    const resultProof = requireReceipt(map, revision.receiptId, 'result', referenced);
    const result = resultProof.payload;
    if (revision.resultReceiptSha256 !== resultProof.canonicalSha256 || claimantDid(result) !== claimant ||
      result.task?.id !== dossier.mission.id || result.task?.issuer !== issuer ||
      result.task?.requirements_sha256 !== dossier.mission.requirementsHash.slice(7) || result.artifacts?.length !== 1 ||
      result.artifacts[0].sha256 !== revision.artifact.sha256.slice(7) || result.artifacts[0].size !== revision.artifact.bytes ||
      result.artifacts[0].type !== revision.artifact.mediaType || result.artifacts[0].uri?.endsWith(revision.artifact.downloadPath) !== true ||
      (result.evidence?.repository ?? null) !== revision.github.claim.repository ||
      (result.evidence?.commit ?? null) !== revision.github.claim.commit) throw new Error(`Result ${revision.resultId} does not bind its revision snapshot.`);

    if (index === 0) {
      if (revision.revisionLink !== null) throw new Error('Root revision unexpectedly contains a parent link.');
    } else {
      const parent = dossier.revisionChain[index - 1];
      const link = revision.revisionLink;
      if (!link || !exactKeys(link, ['parentResultId', 'parentReceiptSha256', 'changeRequestReceiptId', 'changeRequestReceiptSha256', 'revisionReceiptId']) ||
        link.parentResultId !== parent.resultId || link.parentReceiptSha256 !== parent.resultReceiptSha256) throw new Error('Revision parent hash link mismatch.');
      const change = requireReceipt(map, link.changeRequestReceiptId, 'change_request', referenced);
      if (link.changeRequestReceiptSha256 !== change.canonicalSha256 || change.payload.event.actor !== issuer ||
        change.payload.event.missionId !== dossier.mission.id || change.payload.event.resultId !== parent.resultId ||
        change.payload.event.resultSha256 !== parent.resultReceiptSha256) throw new Error('Revision change-request link mismatch.');
      const chain = requireReceipt(map, link.revisionReceiptId, 'revision', referenced).payload.event;
      if (chain.actor !== claimant || chain.missionId !== dossier.mission.id || chain.claimId !== dossier.subject.claimId ||
        chain.resultId !== revision.resultId || chain.resultSha256 !== revision.resultReceiptSha256 ||
        chain.parentResultId !== parent.resultId || chain.parentResultSha256 !== parent.resultReceiptSha256 ||
        chain.changeRequestId !== link.changeRequestReceiptId || chain.changeRequestSha256 !== link.changeRequestReceiptSha256 ||
        chain.revision !== revision.revision) throw new Error('Claimant revision receipt link mismatch.');
    }

    const outcome = revision.issuerOutcome;
    if (!exactKeys(outcome, ['decision', 'changeRequestReceiptId', 'acceptanceReceiptId', 'finalReceiptId'])) throw new Error('Malformed issuer outcome.');
    if (outcome.changeRequestReceiptId) {
      const change = requireReceipt(map, outcome.changeRequestReceiptId, 'change_request', referenced).payload.event;
      if (change.actor !== issuer || change.missionId !== dossier.mission.id || change.resultId !== revision.resultId ||
        change.resultSha256 !== revision.resultReceiptSha256) throw new Error('Issuer change request target mismatch.');
    }
    let acceptanceProof;
    if (outcome.acceptanceReceiptId) {
      acceptanceProof = requireReceipt(map, outcome.acceptanceReceiptId, 'acceptance', referenced);
      const acceptance = acceptanceProof.payload.event;
      if (acceptance.actor !== issuer || acceptance.missionId !== dossier.mission.id || acceptance.resultId !== revision.resultId ||
        acceptance.resultSha256 !== revision.resultReceiptSha256 || acceptance.decision !== outcome.decision) throw new Error('Issuer acceptance target mismatch.');
    } else if (outcome.decision !== null) throw new Error('Issuer decision lacks its signed receipt.');
    if (outcome.finalReceiptId) {
      if (!acceptanceProof || outcome.decision !== 'accepted') throw new Error('Finalization lacks exact issuer acceptance.');
      const final = requireReceipt(map, outcome.finalReceiptId, 'finalization', referenced).payload;
      if (claimantDid(final) !== claimant || final.task?.id !== dossier.mission.id || final.task?.issuer !== issuer ||
        final.task?.requirements_sha256 !== dossier.mission.requirementsHash.slice(7) ||
        final.evidence?.acceptance_sha256 !== acceptanceProof.canonicalSha256.slice(7) ||
        canonicalJson(final.task) !== canonicalJson(result.task) || canonicalJson(final.artifacts) !== canonicalJson(result.artifacts) ||
        canonicalJson(evidenceWithoutAcceptance(final.evidence)) !== canonicalJson(evidenceWithoutAcceptance(result.evidence))) {
        throw new Error('Final TCR-1 must preserve the result and exact issuer acceptance binding.');
      }
    }

    const verificationDigests = new Set();
    for (const id of revision.executionEvidenceReceiptIds) {
      const proof = requireReceipt(map, id, 'verification', referenced);
      const receipt = proof.payload.receipt;
      if (receipt.resultId !== revision.resultId || receipt.resultReceiptSha256 !== revision.resultReceiptSha256 ||
        receipt.candidateCommit !== revision.github.claim.commit || !receipt.checks?.every((check) => check.exitCode === 0)) {
        throw new Error('Execution evidence binding mismatch.');
      }
      verificationDigests.add(proof.canonicalSha256);
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
  const latestOutcome = dossier.revisionChain.at(-1).issuerOutcome;
  const derivedState = latestOutcome.finalReceiptId ? 'finalized'
    : latestOutcome.acceptanceReceiptId ? latestOutcome.decision
      : latestOutcome.changeRequestReceiptId ? 'changes_requested'
        : 'submitted';
  if (dossier.subject.selectedState !== derivedState) throw new Error('Selected state does not match the signed latest receipt chain.');
  const unreferenced = dossier.receipts.filter((receipt) => !referenced.has(receipt.id));
  if (unreferenced.length) throw new Error(`Dossier contains unreferenced receipt ${unreferenced[0].id}.`);
}

function deriveLayers(dossier, artifact) {
  const selected = dossier.revisionChain.at(-1);
  const outcomePresent = Boolean(selected.issuerOutcome.acceptanceReceiptId || selected.issuerOutcome.changeRequestReceiptId);
  return {
    contentAddress: 'valid', receiptSignatures: 'valid', missionAndClaim: dossier.mission?.receiptId ? 'valid' : 'absent', revisionChain: 'valid',
    issuerOutcome: outcomePresent ? 'valid' : 'absent',
    executionEvidence: selected.executionEvidenceReceiptIds.length ? 'valid' : 'absent',
    structuredReview: selected.reviewReceiptIds.length ? 'valid' : 'absent',
    peerEvidence: selected.attestationReceiptIds.length ? 'valid' : 'absent',
    artifact,
  };
}

function parsePublicHttps(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be an absolute public HTTPS URL.`); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash ||
    !hostname.includes('.') || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') ||
    hostname.endsWith('.internal') || hostname.includes(':') || /^\d+(?:\.\d+){3}$/.test(hostname) ||
    !hostname.split('.').every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) {
    throw new Error(`${label} must use public HTTPS without credentials, ports, query strings, fragments, or literal/private hosts.`);
  }
  return url;
}

function githubRepository(value, label) {
  const url = parsePublicHttps(value, label);
  if (url.hostname.toLowerCase() !== 'github.com') throw new Error(`${label} must use github.com.`);
  const match = /^\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})\/?$/.exec(url.pathname);
  if (!match || match[2].endsWith('.git')) throw new Error(`${label} must be a plain GitHub owner/repository URL.`);
  return { owner: match[1].toLowerCase(), repository: match[2].toLowerCase() };
}

function assertRelatedGitHubUrl(value, repository, kind) {
  const url = parsePublicHttps(value, `GitHub ${kind} URL`);
  if (url.hostname.toLowerCase() !== 'github.com') throw new Error(`GitHub ${kind} URL must use github.com.`);
  const suffix = kind === 'pull request' ? 'pull' : 'actions/runs';
  const expected = `/${repository.owner}/${repository.repository}/${suffix}/`;
  if (!url.pathname.toLowerCase().startsWith(expected) || !/^\d+$/.test(url.pathname.slice(expected.length))) {
    throw new Error(`GitHub ${kind} URL must point to the claimed repository.`);
  }
}

function assertArtifactUri(value, sha256) {
  if (value === `urn:sha256:${sha256}`) return;
  let url;
  try { url = new URL(value); } catch { throw new Error('Artifact URI is malformed.'); }
  const local = url.protocol === 'http:' && url.hostname === 'localhost' && !url.username && !url.password && !url.search && !url.hash &&
    /^\/api\/artifacts\/res_[a-f0-9]{24}$/.test(url.pathname);
  if (!local) parsePublicHttps(value, 'Artifact URI');
}

function assertGitHubObservation(observation) {
  if (observation === null) return;
  if (!exactKeys(observation, ['signed', 'githubStatus', 'ciStatus', 'identityBinding', 'detail', 'checkedAt', 'snapshotCanonicalSha256']) ||
    observation.signed !== false || !['verified', 'unverified', 'error'].includes(observation.githubStatus) ||
    !['verified', 'unverified', 'not_checked', 'error'].includes(observation.ciStatus) ||
    observation.identityBinding !== 'not_established' || !boundedText(observation.detail, 1, 500) ||
    !validTimestamp(observation.checkedAt) || !/^sha256:[a-f0-9]{64}$/.test(observation.snapshotCanonicalSha256)) {
    throw new Error('Commons dossier contains a malformed unsigned GitHub observation.');
  }
}

function assertPublicMetadata(dossier) {
  for (const revision of dossier.revisionChain) {
    const repository = revision.github.claim.repository === null ? null : githubRepository(revision.github.claim.repository, 'GitHub repository claim');
    assertGitHubObservation(revision.github.observation);
    if (revision.github.claim.commit !== null && repository === null) throw new Error('GitHub commit claim requires a repository claim.');
  }
  for (const receipt of dossier.receipts) {
    if (!['result', 'finalization'].includes(receipt.kind)) continue;
    for (const artifact of receipt.payload.artifacts) assertArtifactUri(artifact.uri, artifact.sha256);
    const evidence = receipt.payload.evidence;
    if (!evidence) continue;
    const repository = evidence.repository ? githubRepository(evidence.repository, 'TCR-1 GitHub repository') : null;
    if ((evidence.commit || evidence.pull_request || evidence.ci_url) && !repository) throw new Error('TCR-1 GitHub evidence requires a repository URL.');
    if (evidence.pull_request) assertRelatedGitHubUrl(evidence.pull_request, repository, 'pull request');
    if (evidence.ci_url) assertRelatedGitHubUrl(evidence.ci_url, repository, 'Actions run');
  }
}

function commonsEligibility(dossier, id, filename) {
  try {
    assertPublicMetadata(dossier);
    if (!['accepted', 'finalized'].includes(dossier.subject.selectedState)) throw new Error('Commons requires a signed latest issuer acceptance.');
    if (!dossier.mission.receiptId) throw new Error('Commons requires a signed mission receipt.');
    const counts = dossier.receipts.reduce((output, receipt) => {
      output[receipt.kind] = (output[receipt.kind] ?? 0) + 1;
      return output;
    }, {});
    for (const [kind, cap] of Object.entries(RECEIPT_CAPS)) {
      if ((counts[kind] ?? 0) > cap) throw new Error(`Commons exceeds the ${kind} receipt cap.`);
    }
    const dids = new Set([dossier.subject.claimantDid, dossier.mission.issuerDid, ...dossier.receipts.map((receipt) => receipt.actorDid)]);
    if (dids.size > MAX_DIDS) throw new Error(`Commons exceeds the ${MAX_DIDS}-DID profile.`);
    const expectedFilename = `${id}.json`;
    if (filename && filename !== expectedFilename) return { eligible: false, filenameMatches: false, expectedFilename, reason: `Rename the canonical file to ${expectedFilename} before proposing it.` };
    return { eligible: true, filenameMatches: !filename || filename === expectedFilename, expectedFilename, reason: 'Dossier satisfies the browser-checkable Commons content profile.' };
  } catch (cause) {
    return { eligible: false, filenameMatches: !filename || filename === `${id}.json`, expectedFilename: `${id}.json`, reason: cause instanceof Error ? cause.message : 'Commons policy rejected the dossier.' };
  }
}

function gapList(layers) {
  const gaps = [];
  if (layers.missionAndClaim === 'absent') gaps.push('mission_receipt');
  if (layers.issuerOutcome === 'absent') gaps.push('issuer_outcome');
  if (layers.executionEvidence === 'absent') gaps.push('execution_evidence');
  if (layers.structuredReview === 'absent') gaps.push('structured_review');
  if (layers.peerEvidence === 'absent') gaps.push('peer_evidence');
  if (layers.artifact === 'not_checked') gaps.push('artifact_bytes');
  if (layers.artifact === 'mismatch') gaps.push('artifact_mismatch');
  return gaps;
}

export async function verifyDossierInBrowser(input, options = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  await assertEd25519Support();
  if (bytes.byteLength < 2 || bytes.byteLength > BROWSER_DOSSIER_MAX_BYTES) {
    fail('FILE_SIZE', 'file', `Dossier must be no larger than ${BROWSER_DOSSIER_MAX_BYTES} bytes.`);
  }
  let source;
  try { source = decodeStrictUtf8(bytes); } catch { fail('UTF8', 'decode', 'Dossier is not strict UTF-8.'); }
  assertJsonResourceProfile(bytes, source);
  let dossier;
  try { dossier = parseStrictJson(source); } catch (cause) {
    fail('STRICT_JSON', 'parse', cause instanceof Error ? cause.message : 'Dossier is not strict JSON.');
  }
  const canonicalBytes = new TextEncoder().encode(canonicalJson(dossier));
  if (canonicalBytes.byteLength !== bytes.byteLength || canonicalBytes.some((byte, index) => byte !== bytes[index])) {
    fail('CANONICAL', 'canonical', 'Dossier file is not exact canonical JSON bytes.');
  }
  const digest = await sha256Hex(canonicalBytes);
  const id = `fds_${digest.slice(0, 24)}`;
  if (options.expectedId && options.expectedId !== id) fail('CONTENT_ADDRESS', 'canonical', 'Expected dossier identifier does not match canonical bytes.');
  try { assertDossierShape(dossier); } catch (cause) {
    fail('SHAPE', 'shape', cause instanceof Error ? cause.message : 'Dossier shape is invalid.');
  }
  let map;
  try { map = await receiptMap(dossier); } catch (cause) {
    if (cause instanceof BrowserDossierError) throw cause;
    fail('SIGNATURE', 'receipts', cause instanceof Error ? cause.message : 'Embedded receipt verification failed.');
  }
  try { await verifyBindings(dossier, map); } catch (cause) {
    fail('BINDING', 'bindings', cause instanceof Error ? cause.message : 'Dossier binding verification failed.');
  }

  let artifact = 'not_checked';
  if (options.artifactBytes) {
    const supplied = options.artifactBytes instanceof Uint8Array ? options.artifactBytes : new Uint8Array(options.artifactBytes);
    if (supplied.byteLength > BROWSER_ARTIFACT_MAX_BYTES) fail('ARTIFACT_SIZE', 'artifact', 'Artifact exceeds the 5 MiB profile.');
    const selectedArtifact = dossier.revisionChain.at(-1).artifact;
    artifact = supplied.byteLength === selectedArtifact.bytes && await sha256Hex(supplied) === selectedArtifact.sha256.slice(7) ? 'valid' : 'mismatch';
  }
  const layers = deriveLayers(dossier, artifact);
  const commons = commonsEligibility(dossier, id, options.filename);
  return {
    ok: true,
    id,
    sha256: `sha256:${digest}`,
    selectedResultId: dossier.subject.selectedResultId,
    selectedState: dossier.subject.selectedState,
    mission: {
      id: dossier.mission.id,
      title: dossier.mission.title,
      lane: dossier.mission.lane,
      summary: dossier.mission.summary,
      issuerDid: dossier.mission.issuerDid,
      claimantDid: dossier.subject.claimantDid,
    },
    revisionCount: dossier.revisionChain.length,
    receiptCount: dossier.receipts.length,
    revisions: dossier.revisionChain.map((revision) => ({
      revision: revision.revision,
      resultId: revision.resultId,
      createdAt: revision.createdAt,
      resultReceiptSha256: revision.resultReceiptSha256,
      outcome: revision.issuerOutcome.finalReceiptId ? 'finalized' : revision.issuerOutcome.decision ?? (revision.issuerOutcome.changeRequestReceiptId ? 'changes_requested' : 'submitted'),
    })),
    layers,
    gaps: gapList(layers),
    commons,
    caveat: 'Valid signatures and hash links prove key control and byte integrity, not authorship, correctness, identity, payment, or airdrop eligibility.',
  };
}
