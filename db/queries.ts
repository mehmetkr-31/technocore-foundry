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
  ]);

  await db.batch(
    seedMissions.map((mission) =>
      db
        .prepare(`INSERT OR IGNORE INTO missions
          (id, title, lane, summary, requirements_hash, issuer_did, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`)
        .bind(
          mission.id,
          mission.title,
          mission.lane,
          mission.summary,
          mission.requirementsHash,
          issuerDid,
          mission.createdAt,
        ),
    ),
  );
}

export async function listMissions(): Promise<MissionRecord[]> {
  await ensureDatabase();
  const result = await database()
    .prepare(`SELECT
      m.id,
      m.title,
      m.lane,
      m.summary,
      m.requirements_hash AS requirementsHash,
      m.issuer_did AS issuerDid,
      m.status,
      m.created_at AS createdAt,
      COUNT(c.id) AS claimCount
    FROM missions m
    LEFT JOIN claims c ON c.mission_id = m.id
    GROUP BY m.id
    ORDER BY m.created_at DESC`)
    .all<MissionRecord>();
  return result.results.map((mission) => ({ ...mission, claimCount: Number(mission.claimCount) }));
}

export async function findMission(id: string) {
  await ensureDatabase();
  return database()
    .prepare(`SELECT
      id,
      title,
      lane,
      summary,
      requirements_hash AS requirementsHash,
      issuer_did AS issuerDid,
      status,
      created_at AS createdAt
    FROM missions WHERE id = ?`)
    .bind(id)
    .first<Omit<MissionRecord, 'claimCount'>>();
}

export async function createClaim(input: {
  id: string;
  missionId: string;
  actorDid: string;
  signature: string;
  eventJson: string;
  createdAt: string;
}) {
  await database()
    .prepare(`INSERT INTO claims
      (id, mission_id, actor_did, signature, event_json, created_at, observed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      input.id,
      input.missionId,
      input.actorDid,
      input.signature,
      input.eventJson,
      input.createdAt,
      Date.now(),
    )
    .run();
}

export async function createReceipt(input: {
  id: string;
  actorDid: string;
  missionId: string;
  objectKey: string;
  sha256: string;
  bytes: number;
  createdAt: string;
}) {
  await database()
    .prepare(`INSERT OR REPLACE INTO receipts
      (id, schema, actor_did, mission_id, object_key, sha256, bytes, created_at)
      VALUES (?, 'foundry-receipt-v1', ?, ?, ?, ?, ?, ?)`)
    .bind(
      input.id,
      input.actorDid,
      input.missionId,
      input.objectKey,
      input.sha256,
      input.bytes,
      input.createdAt,
    )
    .run();
}
