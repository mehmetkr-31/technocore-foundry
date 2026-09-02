export type TechnocoreRelayAttemptState = 'reserved' | 'published' | 'rejected' | 'ambiguous';

export type TechnocoreRelayAttempt = {
  envelopeSha256: string;
  resultId: string;
  room: string;
  actorDid: string;
  nonceValue: string;
  textSha256: string;
  state: TechnocoreRelayAttemptState;
  upstreamStatus: number | null;
  upstreamDetail: string | null;
  reservedAt: string;
  completedAt: string | null;
};

export type RelayReservation =
  | { reserved: true; attempt: TechnocoreRelayAttempt }
  | { reserved: false; reason: 'replay' | 'result_locked' | 'stale_nonce' | 'conflict'; attempt: TechnocoreRelayAttempt | null };

export type RelayAttemptStore = ReturnType<typeof createTechnocoreRelayAttemptStore>;

export const TECHNOCORE_RELAY_ATTEMPTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS technocore_relay_attempts (
  envelope_sha256 TEXT PRIMARY KEY,
  result_id TEXT NOT NULL,
  room TEXT NOT NULL,
  actor_did TEXT NOT NULL,
  nonce_value TEXT NOT NULL,
  text_sha256 TEXT NOT NULL,
  state TEXT NOT NULL,
  upstream_status INTEGER,
  upstream_detail TEXT,
  reserved_at TEXT NOT NULL,
  completed_at TEXT
)`;

export const TECHNOCORE_RELAY_NONCE_INDEX_SQL = 'CREATE UNIQUE INDEX IF NOT EXISTS idx_technocore_relay_nonce ON technocore_relay_attempts(room, actor_did, nonce_value)';
export const TECHNOCORE_RELAY_RESULT_INDEX_SQL = 'CREATE INDEX IF NOT EXISTS idx_technocore_relay_result_state ON technocore_relay_attempts(result_id, state)';
export const TECHNOCORE_RELAY_RESERVE_SQL = `INSERT INTO technocore_relay_attempts (
  envelope_sha256, result_id, room, actor_did, nonce_value, text_sha256,
  state, upstream_status, upstream_detail, reserved_at, completed_at
)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'reserved', NULL, NULL, ?7, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM technocore_relay_attempts
  WHERE room = ?3 AND actor_did = ?4 AND (
    length(nonce_value) > length(?5) OR
    (length(nonce_value) = length(?5) AND nonce_value >= ?5)
  )
)
AND NOT EXISTS (
  SELECT 1 FROM technocore_relay_attempts
  WHERE result_id = ?2 AND state IN ('reserved', 'published', 'ambiguous')
)`;

export const TECHNOCORE_RELAY_COMPLETE_SQL = `UPDATE technocore_relay_attempts
  SET state = ?1, upstream_status = ?2, upstream_detail = ?3, completed_at = ?4
  WHERE envelope_sha256 = ?5 AND state = 'reserved'`;

export function normalizeTechnocoreNonce(value: string) {
  if (!/^\d{1,19}$/.test(value)) throw new Error('Technocore nonce must be a 1-19 digit decimal integer.');
  return BigInt(value).toString();
}

function changes(result: D1Result<unknown>) {
  return Number(result.meta?.changes ?? 0);
}

export function createTechnocoreRelayAttemptStore(database: D1Database) {
  async function findByEnvelope(envelopeSha256: string) {
    return database.prepare(`SELECT
      envelope_sha256 AS envelopeSha256,
      result_id AS resultId,
      room,
      actor_did AS actorDid,
      nonce_value AS nonceValue,
      text_sha256 AS textSha256,
      state,
      upstream_status AS upstreamStatus,
      upstream_detail AS upstreamDetail,
      reserved_at AS reservedAt,
      completed_at AS completedAt
    FROM technocore_relay_attempts WHERE envelope_sha256 = ?`)
      .bind(envelopeSha256).first<TechnocoreRelayAttempt>();
  }

  async function reserve(input: {
    envelopeSha256: string;
    resultId: string;
    room: string;
    actorDid: string;
    nonce: string;
    textSha256: string;
    reservedAt: string;
  }): Promise<RelayReservation> {
    const nonceValue = normalizeTechnocoreNonce(input.nonce);
    const insertion = await database.prepare(TECHNOCORE_RELAY_RESERVE_SQL)
      .bind(
        input.envelopeSha256, input.resultId, input.room, input.actorDid,
        nonceValue, input.textSha256, input.reservedAt,
      ).run();
    if (changes(insertion) === 1) {
      const attempt = await findByEnvelope(input.envelopeSha256);
      if (!attempt) throw new Error('Relay reservation was not readable after insertion.');
      return { reserved: true, attempt };
    }

    const exact = await findByEnvelope(input.envelopeSha256);
    if (exact) return { reserved: false, reason: 'replay', attempt: exact };
    const active = await database.prepare(`SELECT
      envelope_sha256 AS envelopeSha256, result_id AS resultId, room,
      actor_did AS actorDid, nonce_value AS nonceValue, text_sha256 AS textSha256,
      state, upstream_status AS upstreamStatus, upstream_detail AS upstreamDetail,
      reserved_at AS reservedAt, completed_at AS completedAt
    FROM technocore_relay_attempts
    WHERE result_id = ? AND state IN ('reserved', 'published', 'ambiguous')
    ORDER BY reserved_at DESC LIMIT 1`).bind(input.resultId).first<TechnocoreRelayAttempt>();
    if (active) return { reserved: false, reason: 'result_locked', attempt: active };
    const latestNonce = await database.prepare(`SELECT
      envelope_sha256 AS envelopeSha256, result_id AS resultId, room,
      actor_did AS actorDid, nonce_value AS nonceValue, text_sha256 AS textSha256,
      state, upstream_status AS upstreamStatus, upstream_detail AS upstreamDetail,
      reserved_at AS reservedAt, completed_at AS completedAt
    FROM technocore_relay_attempts
    WHERE room = ? AND actor_did = ?
    ORDER BY length(nonce_value) DESC, nonce_value DESC LIMIT 1`)
      .bind(input.room, input.actorDid).first<TechnocoreRelayAttempt>();
    if (latestNonce && (
      latestNonce.nonceValue.length > nonceValue.length ||
      (latestNonce.nonceValue.length === nonceValue.length && latestNonce.nonceValue >= nonceValue)
    )) return { reserved: false, reason: 'stale_nonce', attempt: latestNonce };
    return { reserved: false, reason: 'conflict', attempt: null };
  }

  async function complete(input: {
    envelopeSha256: string;
    state: Exclude<TechnocoreRelayAttemptState, 'reserved'>;
    upstreamStatus: number | null;
    upstreamDetail: string;
    completedAt: string;
  }) {
    const completion = await database.prepare(TECHNOCORE_RELAY_COMPLETE_SQL)
      .bind(input.state, input.upstreamStatus, input.upstreamDetail.slice(0, 500), input.completedAt, input.envelopeSha256)
      .run();
    if (changes(completion) !== 1) throw new Error('Relay attempt completion lost its reserved-state compare-and-set.');
    const attempt = await findByEnvelope(input.envelopeSha256);
    if (!attempt) throw new Error('Completed relay attempt was not readable.');
    return attempt;
  }

  return { findByEnvelope, reserve, complete };
}
