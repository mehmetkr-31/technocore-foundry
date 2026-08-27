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
  acceptedCount: number;
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
    (SELECT COUNT(*) FROM results r WHERE r.mission_id = m.id) AS resultCount,
    (SELECT COUNT(*) FROM acceptances a WHERE a.mission_id = m.id AND a.decision = 'accepted') AS acceptedCount
  FROM missions m
  ORDER BY m.created_at DESC`).all<MissionRecord>();
  return result.results.map((mission) => ({
    ...mission,
    claimCount: Number(mission.claimCount),
    resultCount: Number(mission.resultCount),
    acceptedCount: Number(mission.acceptedCount),
  }));
}

export async function findMission(id: string) {
  await ensureDatabase();
  return database().prepare(`SELECT
    id,
    title,
    lane,
    summary,
    requirements_hash AS requirementsHash,
    issuer_did AS issuerDid,
    status,
    created_at AS createdAt,
    (SELECT COUNT(*) FROM claims c WHERE c.mission_id = missions.id) AS claimCount,
    (SELECT COUNT(*) FROM results r WHERE r.mission_id = missions.id) AS resultCount,
    (SELECT COUNT(*) FROM acceptances a WHERE a.mission_id = missions.id AND a.decision = 'accepted') AS acceptedCount
  FROM missions WHERE id = ?`).bind(id).first<MissionRecord>();
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
  await database().prepare(`INSERT INTO results
    (id, mission_id, claim_id, actor_did, receipt_json, receipt_sha256,
     artifact_object_key, artifact_name, artifact_media_type, artifact_sha256,
     artifact_bytes, repository_url, commit_sha, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      input.id, input.missionId, input.claimId, input.actorDid, input.receiptJson,
      input.receiptSha256, input.artifactObjectKey, input.artifactName,
      input.artifactMediaType, input.artifactSha256, input.artifactBytes,
      input.repositoryUrl, input.commitSha, input.createdAt,
    ).run();
}

const resultSelect = `SELECT
  r.id,
  r.mission_id AS missionId,
  r.claim_id AS claimId,
  r.actor_did AS actorDid,
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
  a.receipt_sha256 AS acceptanceReceiptSha256
FROM results r
LEFT JOIN acceptances a ON a.result_id = r.id`;

function normalizeResult(result: ResultRecord | null) {
  return result ? { ...result, artifactBytes: Number(result.artifactBytes) } : null;
}

export async function findResult(id: string) {
  await ensureDatabase();
  const result = await database().prepare(`${resultSelect} WHERE r.id = ?`).bind(id).first<ResultRecord>();
  return normalizeResult(result);
}

export async function findActorResult(missionId: string, actorDid: string) {
  await ensureDatabase();
  const result = await database().prepare(`${resultSelect} WHERE r.mission_id = ? AND r.actor_did = ?`)
    .bind(missionId, actorDid).first<ResultRecord>();
  return normalizeResult(result);
}

export async function listMissionResults(missionId: string) {
  await ensureDatabase();
  const result = await database().prepare(`${resultSelect} WHERE r.mission_id = ? ORDER BY r.created_at DESC`)
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
