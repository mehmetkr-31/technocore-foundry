import { env } from 'cloudflare:workers';

export type MissionRecord = {
  id: string;
  title: string;
  lane: string;
  summary: string;
  requirementsHash: string;
  issuerDid: string;
  status: 'open' | 'closed';
  createdAt: string;
  claimCount: number;
  resultCount: number;
  revisionCount: number;
  changeRequestCount: number;
  acceptedCount: number;
  attestationCount: number;
};

export type ClaimRecord = {
  id: string;
  missionId: string;
  actorDid: string;
  signature: string;
  eventJson: string;
  createdAt: string;
};

export type ResultRecord = {
  id: string;
  missionId: string;
  claimId: string;
  actorDid: string;
  revision: number;
  parentResultId: string | null;
  parentReceiptSha256: string | null;
  revisionReceiptId: string | null;
  revisionEventJson: string | null;
  receiptJson: string;
  receiptSha256: string;
  artifactObjectKey: string;
  artifactName: string;
  artifactMediaType: string;
  artifactSha256: string;
  artifactBytes: number;
  repositoryUrl: string | null;
  commitSha: string | null;
  createdAt: string;
  acceptanceId: string | null;
  acceptanceDecision: 'accepted' | 'rejected' | null;
  acceptanceNote: string | null;
  acceptanceReceiptSha256: string | null;
  changeRequestId: string | null;
  changeRequestNote: string | null;
  changeRequestReceiptSha256: string | null;
  changeRequestCreatedAt: string | null;
  evidenceGithubStatus: string | null;
  evidenceCiStatus: string | null;
  evidenceIdentityBinding: string | null;
  evidenceDetail: string | null;
  evidenceCheckedAt: string | null;
  verificationReceiptId: string | null;
  verificationReceiptSha256: string | null;
  verificationActorDid: string | null;
  verificationCreatedAt: string | null;
  verificationReceiptCount: number;
  finalReceiptId: string | null;
  finalReceiptJson: string | null;
  finalReceiptSha256: string | null;
  finalCreatedAt: string | null;
  attestationCount: number;
};

export type AttestationRecord = {
  id: string;
  resultId: string;
  missionId: string;
  actorDid: string;
  statement: 'reproduced' | 'reviewed' | 'used' | 'collaborated';
  note: string;
  eventJson: string;
  signature: string;
  receiptSha256: string;
  createdAt: string;
};

export type ChangeRequestRecord = {
  id: string;
  resultId: string;
  missionId: string;
  issuerDid: string;
  resultSha256: string;
  note: string;
  eventJson: string;
  signature: string;
  receiptSha256: string;
  createdAt: string;
};

export type EvidenceCheckRecord = {
  resultId: string;
  githubStatus: 'verified' | 'unverified' | 'error';
  ciStatus: 'verified' | 'unverified' | 'not_checked' | 'error';
  identityBinding: 'not_established';
  detail: string;
  snapshotJson: string;
  checkedAt: string;
};

export type EvidenceReceiptRecord = {
  id: string;
  resultId: string;
  missionId: string;
  kind: 'verification';
  actorDid: string;
  receiptSha256: string;
  createdAt: string;
};

export type FinalizationRecord = {
  resultId: string;
  receiptId: string;
  receiptJson: string;
  receiptSha256: string;
  createdAt: string;
};

export type ReceiptMetadata = {
  id: string;
  schema: string;
  actorDid: string;
  missionId: string | null;
  objectKey: string;
  sha256: string;
  bytes: number;
  createdAt: string;
  missionTitle: string | null;
  missionLane: string | null;
  resultId: string | null;
};

export type ObserverEpochRecord = {
  id: string;
  room: string;
  epoch: number;
  startSeq: number;
  endSeq: number;
  gapCount: number;
  sourceCommit: string;
  startedAt: string;
  endedAt: string | null;
  lastSyncAt: string;
};

export type TransportObservationRecord = {
  id: string;
  room: string;
  epoch: number;
  sequence: number;
  serverTimestamp: string;
  actorHint: string;
  textSha256: string;
  receiptId: string | null;
  verificationState: 'transport_unverifiable';
  observedAt: string;
};

export type ObserverGapRecord = {
  id: string;
  room: string;
  epoch: number;
  kind: 'retention_gap' | 'epoch_rewind';
  expectedSeq: number;
  firstSeq: number;
  detectedAt: string;
};

const issuerDid = 'did:key:z6MkjtkShmr1CG8rHHPBUDqCUbtwfQ6E9u4g2NdHXjCsg471';

const seedMissions = [
  {
    id: 'M-042',
    title: 'Ship a Turkish protocol conformance guide',
    lane: 'DOCS / TRANSLATION',
    summary: 'Turn the room, signing, and normalization rules into a testable Turkish field guide.',
    requirementsHash: 'sha256:4fb4a80831905db903078457af5b9b1fd88e837068eb7876a11f78d84e4ad8e7',
    createdAt: '2026-08-26T08:42:00.000Z',
  },
  {
    id: 'M-039',
    title: 'Stress-test Unicode message normalization',
    lane: 'SECURITY / TESTING',
    summary: 'Publish reproducible vectors for composed, decomposed, bidirectional, and confusable text.',
    requirementsHash: 'sha256:5a2b2ca70c692eff940584238b2e9315628141347e202966e9dc00a39da1cc87',
    createdAt: '2026-08-26T07:39:00.000Z',
  },
  {
    id: 'M-031',
    title: 'Bridge a signed room into Matrix',
    lane: 'INTEROP / CODE',
    summary: 'Mirror signed events without weakening provenance or trusting remote content as instructions.',
    requirementsHash: 'sha256:b9be6f782e6e42aec0c8d23bdf384928d7d818cebbf47e4f3b43d95f8206bf99',
    createdAt: '2026-08-26T06:31:00.000Z',
  },
] as const;

function database() {
  if (!env.DB) throw new Error('The D1 binding is unavailable.');
  return env.DB;
}

export async function ensureDatabase() {
  const db = database();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS missions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      lane TEXT NOT NULL,
      summary TEXT NOT NULL,
      requirements_hash TEXT NOT NULL,
      issuer_did TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_missions_status_created ON missions(status, created_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      actor_did TEXT NOT NULL,
      signature TEXT NOT NULL,
      event_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      observed_at INTEGER NOT NULL
    )`),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_mission_actor ON claims(mission_id, actor_did)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_claims_actor_created ON claims(actor_did, created_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY,
      schema TEXT NOT NULL,
      actor_did TEXT NOT NULL,
      mission_id TEXT,
      object_key TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_receipts_actor_created ON receipts(actor_did, created_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS mission_signatures (
      mission_id TEXT PRIMARY KEY,
      receipt_id TEXT NOT NULL,
      event_json TEXT NOT NULL,
      signature TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS results (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      claim_id TEXT NOT NULL,
      actor_did TEXT NOT NULL,
      receipt_json TEXT NOT NULL,
      receipt_sha256 TEXT NOT NULL,
      artifact_object_key TEXT NOT NULL,
      artifact_name TEXT NOT NULL,
      artifact_media_type TEXT NOT NULL,
      artifact_sha256 TEXT NOT NULL,
      artifact_bytes INTEGER NOT NULL,
      repository_url TEXT,
      commit_sha TEXT,
      created_at TEXT NOT NULL
    )`),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_results_claim ON results(claim_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_results_mission_created ON results(mission_id, created_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_results_actor_created ON results(actor_did, created_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS result_revisions (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      claim_id TEXT NOT NULL,
      actor_did TEXT NOT NULL,
      revision INTEGER NOT NULL,
      parent_result_id TEXT,
      parent_receipt_sha256 TEXT,
      change_request_id TEXT,
      change_request_sha256 TEXT,
      revision_receipt_id TEXT,
      revision_event_json TEXT,
      revision_signature TEXT,
      receipt_json TEXT NOT NULL,
      receipt_sha256 TEXT NOT NULL,
      artifact_object_key TEXT NOT NULL,
      artifact_name TEXT NOT NULL,
      artifact_media_type TEXT NOT NULL,
      artifact_sha256 TEXT NOT NULL,
      artifact_bytes INTEGER NOT NULL,
      repository_url TEXT,
      commit_sha TEXT,
      created_at TEXT NOT NULL
    )`),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_result_revisions_claim_revision ON result_revisions(claim_id, revision)'),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_result_revisions_parent ON result_revisions(parent_result_id)'),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_result_revisions_change_request ON result_revisions(change_request_id)'),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_result_revisions_receipt ON result_revisions(revision_receipt_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_result_revisions_mission_created ON result_revisions(mission_id, created_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_result_revisions_actor_created ON result_revisions(actor_did, created_at)'),
    db.prepare(`INSERT OR IGNORE INTO result_revisions (
      id, mission_id, claim_id, actor_did, revision, receipt_json, receipt_sha256,
      artifact_object_key, artifact_name, artifact_media_type, artifact_sha256,
      artifact_bytes, repository_url, commit_sha, created_at
    ) SELECT
      id, mission_id, claim_id, actor_did, 1, receipt_json, receipt_sha256,
      artifact_object_key, artifact_name, artifact_media_type, artifact_sha256,
      artifact_bytes, repository_url, commit_sha, created_at
    FROM results`),
    db.prepare(`CREATE TABLE IF NOT EXISTS change_requests (
      id TEXT PRIMARY KEY,
      result_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      issuer_did TEXT NOT NULL,
      result_sha256 TEXT NOT NULL,
      note TEXT NOT NULL,
      event_json TEXT NOT NULL,
      signature TEXT NOT NULL,
      receipt_sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_change_requests_result ON change_requests(result_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_change_requests_mission_created ON change_requests(mission_id, created_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS acceptances (
      id TEXT PRIMARY KEY,
      result_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      issuer_did TEXT NOT NULL,
      decision TEXT NOT NULL,
      note TEXT NOT NULL,
      event_json TEXT NOT NULL,
      signature TEXT NOT NULL,
      receipt_sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_acceptances_result ON acceptances(result_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_acceptances_mission_created ON acceptances(mission_id, created_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS evidence_checks (
      result_id TEXT PRIMARY KEY,
      github_status TEXT NOT NULL,
      ci_status TEXT NOT NULL,
      identity_binding TEXT NOT NULL,
      detail TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      checked_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS evidence_receipts (
      id TEXT PRIMARY KEY,
      result_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      actor_did TEXT NOT NULL,
      receipt_sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_receipts_result_kind_actor ON evidence_receipts(result_id, kind, actor_did)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_evidence_receipts_result_created ON evidence_receipts(result_id, created_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_evidence_receipts_mission_created ON evidence_receipts(mission_id, created_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS result_finalizations (
      result_id TEXT PRIMARY KEY,
      receipt_id TEXT NOT NULL,
      receipt_json TEXT NOT NULL,
      receipt_sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_result_finalizations_receipt ON result_finalizations(receipt_id)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS attestations (
      id TEXT PRIMARY KEY,
      result_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      actor_did TEXT NOT NULL,
      statement TEXT NOT NULL,
      note TEXT NOT NULL,
      event_json TEXT NOT NULL,
      signature TEXT NOT NULL,
      receipt_sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_attestations_result_actor_statement ON attestations(result_id, actor_did, statement)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_attestations_mission_created ON attestations(mission_id, created_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_attestations_actor_created ON attestations(actor_did, created_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS room_epochs (
      id TEXT PRIMARY KEY,
      room TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      start_seq INTEGER NOT NULL,
      end_seq INTEGER NOT NULL,
      gap_count INTEGER NOT NULL DEFAULT 0,
      source_commit TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      last_sync_at TEXT NOT NULL
    )`),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_room_epochs_room_epoch ON room_epochs(room, epoch)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_room_epochs_room_started ON room_epochs(room, started_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS transport_observations (
      id TEXT PRIMARY KEY,
      room TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      sequence INTEGER NOT NULL,
      server_timestamp TEXT NOT NULL,
      actor_hint TEXT NOT NULL,
      text_sha256 TEXT NOT NULL,
      receipt_id TEXT,
      verification_state TEXT NOT NULL,
      observed_at TEXT NOT NULL
    )`),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_transport_observations_room_epoch_sequence ON transport_observations(room, epoch, sequence)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_transport_observations_receipt ON transport_observations(receipt_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_transport_observations_observed ON transport_observations(observed_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS observer_gaps (
      id TEXT PRIMARY KEY,
      room TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      kind TEXT NOT NULL,
      expected_seq INTEGER NOT NULL,
      first_seq INTEGER NOT NULL,
      detected_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_observer_gaps_room_detected ON observer_gaps(room, detected_at)'),
  ]);

  await db.batch(
    seedMissions.map((mission) =>
      db.prepare(`INSERT OR IGNORE INTO missions
        (id, title, lane, summary, requirements_hash, issuer_did, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`)
        .bind(mission.id, mission.title, mission.lane, mission.summary, mission.requirementsHash, issuerDid, mission.createdAt),
    ),
  );
  await db.prepare('PRAGMA optimize').run();
}

export async function listMissions(): Promise<MissionRecord[]> {
  await ensureDatabase();
  const result = await database().prepare(`SELECT
    m.id,
    m.title,
    m.lane,
    m.summary,
    m.requirements_hash AS requirementsHash,
    m.issuer_did AS issuerDid,
    m.status,
    m.created_at AS createdAt,
    (SELECT COUNT(*) FROM claims c WHERE c.mission_id = m.id) AS claimCount,
    (SELECT COUNT(*) FROM result_revisions r WHERE r.mission_id = m.id AND r.revision = 1) AS resultCount,
    (SELECT COUNT(*) FROM result_revisions r WHERE r.mission_id = m.id) AS revisionCount,
    (SELECT COUNT(*) FROM change_requests cr WHERE cr.mission_id = m.id) AS changeRequestCount,
    (SELECT COUNT(*) FROM acceptances a WHERE a.mission_id = m.id AND a.decision = 'accepted') AS acceptedCount,
    (SELECT COUNT(*) FROM attestations at WHERE at.mission_id = m.id) AS attestationCount
  FROM missions m
  ORDER BY m.created_at DESC`).all<MissionRecord>();
  return result.results.map((mission) => ({
    ...mission,
    claimCount: Number(mission.claimCount),
    resultCount: Number(mission.resultCount),
    revisionCount: Number(mission.revisionCount),
    changeRequestCount: Number(mission.changeRequestCount),
    acceptedCount: Number(mission.acceptedCount),
    attestationCount: Number(mission.attestationCount),
  }));
}

export async function findMission(id: string) {
  await ensureDatabase();
  const mission = await database().prepare(`SELECT
    id,
    title,
    lane,
    summary,
    requirements_hash AS requirementsHash,
    issuer_did AS issuerDid,
    status,
    created_at AS createdAt,
    (SELECT COUNT(*) FROM claims c WHERE c.mission_id = missions.id) AS claimCount,
    (SELECT COUNT(*) FROM result_revisions r WHERE r.mission_id = missions.id AND r.revision = 1) AS resultCount,
    (SELECT COUNT(*) FROM result_revisions r WHERE r.mission_id = missions.id) AS revisionCount,
    (SELECT COUNT(*) FROM change_requests cr WHERE cr.mission_id = missions.id) AS changeRequestCount,
    (SELECT COUNT(*) FROM acceptances a WHERE a.mission_id = missions.id AND a.decision = 'accepted') AS acceptedCount,
    (SELECT COUNT(*) FROM attestations at WHERE at.mission_id = missions.id) AS attestationCount
  FROM missions WHERE id = ?`).bind(id).first<MissionRecord>();
  return mission ? {
    ...mission,
    claimCount: Number(mission.claimCount),
    resultCount: Number(mission.resultCount),
    revisionCount: Number(mission.revisionCount),
    changeRequestCount: Number(mission.changeRequestCount),
    acceptedCount: Number(mission.acceptedCount),
    attestationCount: Number(mission.attestationCount),
  } : null;
}

export async function createMission(input: {
  id: string;
  title: string;
  lane: string;
  summary: string;
  requirementsHash: string;
  issuerDid: string;
  createdAt: string;
  receiptId: string;
  eventJson: string;
  signature: string;
}) {
  const db = database();
  await db.batch([
    db.prepare(`INSERT INTO missions
      (id, title, lane, summary, requirements_hash, issuer_did, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`)
      .bind(input.id, input.title, input.lane, input.summary, input.requirementsHash, input.issuerDid, input.createdAt),
    db.prepare(`INSERT INTO mission_signatures (mission_id, receipt_id, event_json, signature)
      VALUES (?, ?, ?, ?)`)
      .bind(input.id, input.receiptId, input.eventJson, input.signature),
  ]);
}

export async function createClaim(input: {
  id: string;
  missionId: string;
  actorDid: string;
  signature: string;
  eventJson: string;
  createdAt: string;
}) {
  await database().prepare(`INSERT INTO claims
    (id, mission_id, actor_did, signature, event_json, created_at, observed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(input.id, input.missionId, input.actorDid, input.signature, input.eventJson, input.createdAt, Date.now())
    .run();
}

export async function findClaim(missionId: string, actorDid: string) {
  await ensureDatabase();
  return database().prepare(`SELECT
    id,
    mission_id AS missionId,
    actor_did AS actorDid,
    signature,
    event_json AS eventJson,
    created_at AS createdAt
  FROM claims WHERE mission_id = ? AND actor_did = ?`)
    .bind(missionId, actorDid)
    .first<ClaimRecord>();
}

export async function findClaimById(id: string) {
  await ensureDatabase();
  return database().prepare(`SELECT
    id,
    mission_id AS missionId,
    actor_did AS actorDid,
    signature,
    event_json AS eventJson,
    created_at AS createdAt
  FROM claims WHERE id = ?`).bind(id).first<ClaimRecord>();
}

export async function createResult(input: {
  id: string;
  missionId: string;
  claimId: string;
  actorDid: string;
  receiptJson: string;
  receiptSha256: string;
  artifactObjectKey: string;
  artifactName: string;
  artifactMediaType: string;
  artifactSha256: string;
  artifactBytes: number;
  repositoryUrl: string | null;
  commitSha: string | null;
  createdAt: string;
}) {
  const db = database();
  await db.batch([
    db.prepare(`INSERT INTO results
      (id, mission_id, claim_id, actor_did, receipt_json, receipt_sha256,
       artifact_object_key, artifact_name, artifact_media_type, artifact_sha256,
       artifact_bytes, repository_url, commit_sha, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        input.id, input.missionId, input.claimId, input.actorDid, input.receiptJson,
        input.receiptSha256, input.artifactObjectKey, input.artifactName,
        input.artifactMediaType, input.artifactSha256, input.artifactBytes,
        input.repositoryUrl, input.commitSha, input.createdAt,
      ),
    db.prepare(`INSERT INTO result_revisions
      (id, mission_id, claim_id, actor_did, revision, receipt_json, receipt_sha256,
       artifact_object_key, artifact_name, artifact_media_type, artifact_sha256,
       artifact_bytes, repository_url, commit_sha, created_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        input.id, input.missionId, input.claimId, input.actorDid, input.receiptJson,
        input.receiptSha256, input.artifactObjectKey, input.artifactName,
        input.artifactMediaType, input.artifactSha256, input.artifactBytes,
        input.repositoryUrl, input.commitSha, input.createdAt,
      ),
  ]);
}

export async function createRevision(input: {
  id: string;
  missionId: string;
  claimId: string;
  actorDid: string;
  revision: number;
  parentResultId: string;
  parentReceiptSha256: string;
  changeRequestId: string;
  changeRequestSha256: string;
  revisionReceiptId: string;
  revisionEventJson: string;
  revisionSignature: string;
  receiptJson: string;
  receiptSha256: string;
  artifactObjectKey: string;
  artifactName: string;
  artifactMediaType: string;
  artifactSha256: string;
  artifactBytes: number;
  repositoryUrl: string | null;
  commitSha: string | null;
  createdAt: string;
}) {
  await database().prepare(`INSERT INTO result_revisions
    (id, mission_id, claim_id, actor_did, revision, parent_result_id,
     parent_receipt_sha256, change_request_id, change_request_sha256,
     revision_receipt_id, revision_event_json, revision_signature,
     receipt_json, receipt_sha256, artifact_object_key, artifact_name,
     artifact_media_type, artifact_sha256, artifact_bytes, repository_url,
     commit_sha, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      input.id, input.missionId, input.claimId, input.actorDid, input.revision,
      input.parentResultId, input.parentReceiptSha256, input.changeRequestId,
      input.changeRequestSha256, input.revisionReceiptId, input.revisionEventJson,
      input.revisionSignature, input.receiptJson, input.receiptSha256,
      input.artifactObjectKey, input.artifactName, input.artifactMediaType,
      input.artifactSha256, input.artifactBytes, input.repositoryUrl,
      input.commitSha, input.createdAt,
    ).run();
}

const resultSelect = `SELECT
  r.id,
  r.mission_id AS missionId,
  r.claim_id AS claimId,
  r.actor_did AS actorDid,
  r.revision,
  r.parent_result_id AS parentResultId,
  r.parent_receipt_sha256 AS parentReceiptSha256,
  r.revision_receipt_id AS revisionReceiptId,
  r.revision_event_json AS revisionEventJson,
  r.receipt_json AS receiptJson,
  r.receipt_sha256 AS receiptSha256,
  r.artifact_object_key AS artifactObjectKey,
  r.artifact_name AS artifactName,
  r.artifact_media_type AS artifactMediaType,
  r.artifact_sha256 AS artifactSha256,
  r.artifact_bytes AS artifactBytes,
  r.repository_url AS repositoryUrl,
  r.commit_sha AS commitSha,
  r.created_at AS createdAt,
  a.id AS acceptanceId,
  a.decision AS acceptanceDecision,
  a.note AS acceptanceNote,
  a.receipt_sha256 AS acceptanceReceiptSha256,
  cr.id AS changeRequestId,
  cr.note AS changeRequestNote,
  cr.receipt_sha256 AS changeRequestReceiptSha256,
  cr.created_at AS changeRequestCreatedAt,
  e.github_status AS evidenceGithubStatus,
  e.ci_status AS evidenceCiStatus,
  e.identity_binding AS evidenceIdentityBinding,
  e.detail AS evidenceDetail,
  e.checked_at AS evidenceCheckedAt,
  ver.id AS verificationReceiptId,
  ver.receipt_sha256 AS verificationReceiptSha256,
  ver.actor_did AS verificationActorDid,
  ver.created_at AS verificationCreatedAt,
  f.receipt_id AS finalReceiptId,
  f.receipt_json AS finalReceiptJson,
  f.receipt_sha256 AS finalReceiptSha256,
  f.created_at AS finalCreatedAt,
  (SELECT COUNT(*) FROM evidence_receipts er WHERE er.result_id = r.id AND er.kind = 'verification') AS verificationReceiptCount,
  (SELECT COUNT(*) FROM attestations at WHERE at.result_id = r.id) AS attestationCount
FROM result_revisions r
LEFT JOIN acceptances a ON a.result_id = r.id
LEFT JOIN change_requests cr ON cr.result_id = r.id
LEFT JOIN evidence_checks e ON e.result_id = r.id
LEFT JOIN evidence_receipts ver ON ver.id = (
  SELECT er.id FROM evidence_receipts er
  WHERE er.result_id = r.id AND er.kind = 'verification'
  ORDER BY er.created_at DESC
  LIMIT 1
)
LEFT JOIN result_finalizations f ON f.result_id = r.id`;

function normalizeResult(result: ResultRecord | null) {
  return result ? {
    ...result,
    revision: Number(result.revision),
    artifactBytes: Number(result.artifactBytes),
    attestationCount: Number(result.attestationCount),
    verificationReceiptCount: Number(result.verificationReceiptCount),
  } : null;
}

export async function findResult(id: string) {
  await ensureDatabase();
  const result = await database().prepare(`${resultSelect} WHERE r.id = ?`).bind(id).first<ResultRecord>();
  return normalizeResult(result);
}

export async function findActorResult(missionId: string, actorDid: string) {
  await ensureDatabase();
  const result = await database().prepare(`${resultSelect} WHERE r.mission_id = ? AND r.actor_did = ? ORDER BY r.revision DESC LIMIT 1`)
    .bind(missionId, actorDid).first<ResultRecord>();
  return normalizeResult(result);
}

export async function findLatestResultForClaim(claimId: string) {
  await ensureDatabase();
  const result = await database().prepare(`${resultSelect} WHERE r.claim_id = ? ORDER BY r.revision DESC LIMIT 1`)
    .bind(claimId).first<ResultRecord>();
  return normalizeResult(result);
}

export async function listMissionResults(missionId: string) {
  await ensureDatabase();
  const result = await database().prepare(`${resultSelect} WHERE r.mission_id = ? ORDER BY r.created_at ASC`)
    .bind(missionId).all<ResultRecord>();
  return result.results.map((row) => normalizeResult(row) as ResultRecord);
}

export async function createAcceptance(input: {
  id: string;
  resultId: string;
  missionId: string;
  issuerDid: string;
  decision: 'accepted' | 'rejected';
  note: string;
  eventJson: string;
  signature: string;
  receiptSha256: string;
  createdAt: string;
}) {
  await database().prepare(`INSERT INTO acceptances
    (id, result_id, mission_id, issuer_did, decision, note, event_json, signature, receipt_sha256, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      input.id, input.resultId, input.missionId, input.issuerDid, input.decision,
      input.note, input.eventJson, input.signature, input.receiptSha256, input.createdAt,
    ).run();
}

export async function createChangeRequest(input: ChangeRequestRecord) {
  await database().prepare(`INSERT INTO change_requests
    (id, result_id, mission_id, issuer_did, result_sha256, note,
     event_json, signature, receipt_sha256, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      input.id, input.resultId, input.missionId, input.issuerDid,
      input.resultSha256, input.note, input.eventJson, input.signature,
      input.receiptSha256, input.createdAt,
    ).run();
}

export async function findChangeRequest(resultId: string) {
  await ensureDatabase();
  return database().prepare(`SELECT
    id,
    result_id AS resultId,
    mission_id AS missionId,
    issuer_did AS issuerDid,
    result_sha256 AS resultSha256,
    note,
    event_json AS eventJson,
    signature,
    receipt_sha256 AS receiptSha256,
    created_at AS createdAt
  FROM change_requests WHERE result_id = ?`).bind(resultId).first<ChangeRequestRecord>();
}

export async function createReceipt(input: {
  id: string;
  schema: string;
  actorDid: string;
  missionId: string;
  objectKey: string;
  sha256: string;
  bytes: number;
  createdAt: string;
}) {
  await database().prepare(`INSERT OR REPLACE INTO receipts
    (id, schema, actor_did, mission_id, object_key, sha256, bytes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(input.id, input.schema, input.actorDid, input.missionId, input.objectKey, input.sha256, input.bytes, input.createdAt)
    .run();
}

export async function upsertEvidenceCheck(input: EvidenceCheckRecord) {
  await database().prepare(`INSERT OR REPLACE INTO evidence_checks
    (result_id, github_status, ci_status, identity_binding, detail, snapshot_json, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
      input.resultId,
      input.githubStatus,
      input.ciStatus,
      input.identityBinding,
      input.detail,
      input.snapshotJson,
      input.checkedAt,
    ).run();
}

export async function findEvidenceCheck(resultId: string) {
  await ensureDatabase();
  return database().prepare(`SELECT
    result_id AS resultId,
    github_status AS githubStatus,
    ci_status AS ciStatus,
    identity_binding AS identityBinding,
    detail,
    snapshot_json AS snapshotJson,
    checked_at AS checkedAt
  FROM evidence_checks WHERE result_id = ?`).bind(resultId).first<EvidenceCheckRecord>();
}

export async function createEvidenceReceipt(input: EvidenceReceiptRecord) {
  await database().prepare(`INSERT INTO evidence_receipts
    (id, result_id, mission_id, kind, actor_did, receipt_sha256, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
      input.id,
      input.resultId,
      input.missionId,
      input.kind,
      input.actorDid,
      input.receiptSha256,
      input.createdAt,
    ).run();
}

export async function listResultEvidenceReceipts(resultId: string) {
  await ensureDatabase();
  const result = await database().prepare(`SELECT
    id,
    result_id AS resultId,
    mission_id AS missionId,
    kind,
    actor_did AS actorDid,
    receipt_sha256 AS receiptSha256,
    created_at AS createdAt
  FROM evidence_receipts
  WHERE result_id = ?
  ORDER BY created_at ASC`).bind(resultId).all<EvidenceReceiptRecord>();
  return result.results;
}

export async function createFinalization(input: FinalizationRecord) {
  await database().prepare(`INSERT INTO result_finalizations
    (result_id, receipt_id, receipt_json, receipt_sha256, created_at)
    VALUES (?, ?, ?, ?, ?)`).bind(
      input.resultId,
      input.receiptId,
      input.receiptJson,
      input.receiptSha256,
      input.createdAt,
    ).run();
}

export async function findFinalization(resultId: string) {
  await ensureDatabase();
  return database().prepare(`SELECT
    result_id AS resultId,
    receipt_id AS receiptId,
    receipt_json AS receiptJson,
    receipt_sha256 AS receiptSha256,
    created_at AS createdAt
  FROM result_finalizations WHERE result_id = ?`).bind(resultId).first<FinalizationRecord>();
}

export async function createAttestation(input: AttestationRecord) {
  await database().prepare(`INSERT INTO attestations
    (id, result_id, mission_id, actor_did, statement, note, event_json,
     signature, receipt_sha256, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      input.id,
      input.resultId,
      input.missionId,
      input.actorDid,
      input.statement,
      input.note,
      input.eventJson,
      input.signature,
      input.receiptSha256,
      input.createdAt,
    ).run();
}

export async function listResultAttestations(resultId: string) {
  await ensureDatabase();
  const result = await database().prepare(`SELECT
    id,
    result_id AS resultId,
    mission_id AS missionId,
    actor_did AS actorDid,
    statement,
    note,
    event_json AS eventJson,
    signature,
    receipt_sha256 AS receiptSha256,
    created_at AS createdAt
  FROM attestations
  WHERE result_id = ?
  ORDER BY created_at ASC`).bind(resultId).all<AttestationRecord>();
  return result.results;
}

export async function listMissionAttestations(missionId: string) {
  await ensureDatabase();
  const result = await database().prepare(`SELECT
    id,
    result_id AS resultId,
    mission_id AS missionId,
    actor_did AS actorDid,
    statement,
    note,
    event_json AS eventJson,
    signature,
    receipt_sha256 AS receiptSha256,
    created_at AS createdAt
  FROM attestations
  WHERE mission_id = ?
  ORDER BY created_at ASC`).bind(missionId).all<AttestationRecord>();
  return result.results;
}

export async function findReceiptMetadata(id: string) {
  await ensureDatabase();
  const receipt = await database().prepare(`SELECT
    rec.id,
    rec.schema,
    rec.actor_did AS actorDid,
    rec.mission_id AS missionId,
    rec.object_key AS objectKey,
    rec.sha256,
    rec.bytes,
    rec.created_at AS createdAt,
    m.title AS missionTitle,
    m.lane AS missionLane,
    COALESCE(
      (SELECT r.id FROM result_revisions r WHERE r.id = rec.id),
      (SELECT a.result_id FROM acceptances a WHERE a.id = rec.id),
      (SELECT cr.result_id FROM change_requests cr WHERE cr.id = rec.id),
      (SELECT rr.id FROM result_revisions rr WHERE rr.revision_receipt_id = rec.id),
      (SELECT f.result_id FROM result_finalizations f WHERE f.receipt_id = rec.id),
      (SELECT at.result_id FROM attestations at WHERE at.id = rec.id),
      (SELECT er.result_id FROM evidence_receipts er WHERE er.id = rec.id)
    ) AS resultId
  FROM receipts rec
  LEFT JOIN missions m ON m.id = rec.mission_id
  WHERE rec.id = ?`).bind(id).first<ReceiptMetadata>();
  return receipt ? { ...receipt, bytes: Number(receipt.bytes) } : null;
}

export async function getCurrentObserverEpoch(room: string) {
  await ensureDatabase();
  const row = await database().prepare(`SELECT
    id,
    room,
    epoch,
    start_seq AS startSeq,
    end_seq AS endSeq,
    gap_count AS gapCount,
    source_commit AS sourceCommit,
    started_at AS startedAt,
    ended_at AS endedAt,
    last_sync_at AS lastSyncAt
  FROM room_epochs
  WHERE room = ?
  ORDER BY epoch DESC
  LIMIT 1`).bind(room).first<ObserverEpochRecord>();
  return row ? {
    ...row,
    epoch: Number(row.epoch),
    startSeq: Number(row.startSeq),
    endSeq: Number(row.endSeq),
    gapCount: Number(row.gapCount),
  } : null;
}

export async function recordObserverSync(input: {
  room: string;
  epoch: number;
  priorEpoch: number | null;
  startSeq: number;
  endSeq: number;
  sourceCommit: string;
  syncedAt: string;
  epochRewind: ObserverGapRecord | null;
  gap: ObserverGapRecord | null;
  observations: TransportObservationRecord[];
}) {
  await ensureDatabase();
  const db = database();
  const epochId = `${input.room}:${input.epoch}`;
  const statements = [
    ...(input.priorEpoch !== null && input.priorEpoch !== input.epoch
      ? [db.prepare('UPDATE room_epochs SET ended_at = ? WHERE room = ? AND epoch = ? AND ended_at IS NULL').bind(input.syncedAt, input.room, input.priorEpoch)]
      : []),
    db.prepare(`INSERT OR IGNORE INTO room_epochs
      (id, room, epoch, start_seq, end_seq, gap_count, source_commit, started_at, last_sync_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`).bind(
        epochId,
        input.room,
        input.epoch,
        input.startSeq,
        input.endSeq,
        input.sourceCommit,
        input.syncedAt,
        input.syncedAt,
      ),
    ...(input.epochRewind ? [db.prepare(`INSERT OR IGNORE INTO observer_gaps
      (id, room, epoch, kind, expected_seq, first_seq, detected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
        input.epochRewind.id,
        input.epochRewind.room,
        input.epochRewind.epoch,
        input.epochRewind.kind,
        input.epochRewind.expectedSeq,
        input.epochRewind.firstSeq,
        input.epochRewind.detectedAt,
      )] : []),
    ...(input.gap ? [db.prepare(`INSERT OR IGNORE INTO observer_gaps
      (id, room, epoch, kind, expected_seq, first_seq, detected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
        input.gap.id,
        input.gap.room,
        input.gap.epoch,
        input.gap.kind,
        input.gap.expectedSeq,
        input.gap.firstSeq,
        input.gap.detectedAt,
      )] : []),
    ...input.observations.map((observation) => db.prepare(`INSERT OR IGNORE INTO transport_observations
      (id, room, epoch, sequence, server_timestamp, actor_hint, text_sha256,
       receipt_id, verification_state, observed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        observation.id,
        observation.room,
        observation.epoch,
        observation.sequence,
        observation.serverTimestamp,
        observation.actorHint,
        observation.textSha256,
        observation.receiptId,
        observation.verificationState,
        observation.observedAt,
      )),
    db.prepare(`UPDATE room_epochs
      SET end_seq = CASE WHEN end_seq < ? THEN ? ELSE end_seq END,
          last_sync_at = ?,
          gap_count = (SELECT COUNT(*) FROM observer_gaps g WHERE g.room = ? AND g.epoch = ?)
      WHERE room = ? AND epoch = ?`).bind(
        input.endSeq,
        input.endSeq,
        input.syncedAt,
        input.room,
        input.epoch,
        input.room,
        input.epoch,
      ),
  ];
  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50));
  }
  await db.prepare('PRAGMA optimize').run();
}

export async function getObserverIndex(room: string) {
  await ensureDatabase();
  const db = database();
  const [epochs, gaps, observations, stats] = await Promise.all([
    db.prepare(`SELECT
      id, room, epoch, start_seq AS startSeq, end_seq AS endSeq,
      gap_count AS gapCount, source_commit AS sourceCommit,
      started_at AS startedAt, ended_at AS endedAt, last_sync_at AS lastSyncAt
    FROM room_epochs WHERE room = ? ORDER BY epoch DESC LIMIT 20`).bind(room).all<ObserverEpochRecord>(),
    db.prepare(`SELECT
      id, room, epoch, kind, expected_seq AS expectedSeq,
      first_seq AS firstSeq, detected_at AS detectedAt
    FROM observer_gaps WHERE room = ? ORDER BY detected_at DESC LIMIT 50`).bind(room).all<ObserverGapRecord>(),
    db.prepare(`SELECT
      id, room, epoch, sequence, server_timestamp AS serverTimestamp,
      actor_hint AS actorHint, text_sha256 AS textSha256, receipt_id AS receiptId,
      verification_state AS verificationState, observed_at AS observedAt
    FROM transport_observations WHERE room = ? ORDER BY epoch DESC, sequence DESC LIMIT 100`).bind(room).all<TransportObservationRecord>(),
    db.prepare(`SELECT
      COUNT(*) AS observations,
      COUNT(DISTINCT receipt_id) AS receiptLinks,
      COUNT(DISTINCT CASE WHEN actor_hint LIKE 'did:key:%' THEN actor_hint END) AS didWriters
    FROM transport_observations WHERE room = ?`).bind(room).first<{ observations: number; receiptLinks: number; didWriters: number }>(),
  ]);
  return {
    room,
    source: 'https://technocore.chat',
    trust: 'transport_unverifiable' as const,
    metrics: {
      observations: Number(stats?.observations ?? 0),
      receiptLinks: Number(stats?.receiptLinks ?? 0),
      didWriters: Number(stats?.didWriters ?? 0),
      epochs: epochs.results.length,
      gaps: gaps.results.length,
    },
    epochs: epochs.results.map((row) => ({ ...row, epoch: Number(row.epoch), startSeq: Number(row.startSeq), endSeq: Number(row.endSeq), gapCount: Number(row.gapCount) })),
    gaps: gaps.results.map((row) => ({ ...row, epoch: Number(row.epoch), expectedSeq: Number(row.expectedSeq), firstSeq: Number(row.firstSeq) })),
    observations: observations.results.map((row) => ({ ...row, epoch: Number(row.epoch), sequence: Number(row.sequence) })),
  };
}

export type AtlasContribution = {
  resultId: string;
  missionId: string;
  missionTitle: string;
  lane: string;
  actorDid: string;
  artifactName: string;
  artifactBytes: number;
  artifactSha256: string;
  acceptedAt: string;
  evidenceGithub: string | null;
  evidenceCi: string | null;
  finalizedReceiptId: string | null;
  attestationCount: number;
  verificationReceiptCount: number;
};

export async function getAtlas() {
  await ensureDatabase();
  const [missionStats, participantStats, contributionStats, attestationStats, contributions] = await Promise.all([
    database().prepare(`SELECT
      COUNT(*) AS missions,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS openMissions
    FROM missions`).first<{ missions: number; openMissions: number }>(),
    database().prepare('SELECT COUNT(DISTINCT actor_did) AS participants FROM claims')
      .first<{ participants: number }>(),
    database().prepare(`SELECT
      COUNT(*) AS accepted,
      COALESCE(SUM(r.artifact_bytes), 0) AS artifactBytes
    FROM acceptances a
    JOIN result_revisions r ON r.id = a.result_id
    WHERE a.decision = 'accepted'`).first<{ accepted: number; artifactBytes: number }>(),
    database().prepare(`SELECT
      COUNT(*) AS attestations,
      COUNT(DISTINCT actor_did) AS attestors
    FROM attestations`).first<{ attestations: number; attestors: number }>(),
    database().prepare(`SELECT
      r.id AS resultId,
      r.mission_id AS missionId,
      m.title AS missionTitle,
      m.lane,
      r.actor_did AS actorDid,
      r.artifact_name AS artifactName,
      r.artifact_bytes AS artifactBytes,
      r.artifact_sha256 AS artifactSha256,
      a.created_at AS acceptedAt,
      e.github_status AS evidenceGithub,
      e.ci_status AS evidenceCi,
      f.receipt_id AS finalizedReceiptId,
      (SELECT COUNT(*) FROM attestations at WHERE at.result_id = r.id) AS attestationCount,
      (SELECT COUNT(*) FROM evidence_receipts er WHERE er.result_id = r.id AND er.kind = 'verification') AS verificationReceiptCount
    FROM acceptances a
    JOIN result_revisions r ON r.id = a.result_id
    JOIN missions m ON m.id = r.mission_id
    LEFT JOIN evidence_checks e ON e.result_id = r.id
    LEFT JOIN result_finalizations f ON f.result_id = r.id
    WHERE a.decision = 'accepted'
    ORDER BY a.created_at DESC
    LIMIT 50`).all<AtlasContribution>(),
  ]);
  return {
    metrics: {
      missions: Number(missionStats?.missions ?? 0),
      openMissions: Number(missionStats?.openMissions ?? 0),
      participants: Number(participantStats?.participants ?? 0),
      accepted: Number(contributionStats?.accepted ?? 0),
      artifactBytes: Number(contributionStats?.artifactBytes ?? 0),
      attestations: Number(attestationStats?.attestations ?? 0),
      attestors: Number(attestationStats?.attestors ?? 0),
    },
    contributions: contributions.results.map((item) => ({
      ...item,
      artifactBytes: Number(item.artifactBytes),
      attestationCount: Number(item.attestationCount),
      verificationReceiptCount: Number(item.verificationReceiptCount),
    })),
  };
}
