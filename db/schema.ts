import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const missions = sqliteTable(
  'missions',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    lane: text('lane').notNull(),
    summary: text('summary').notNull(),
    requirementsHash: text('requirements_hash').notNull(),
    issuerDid: text('issuer_did').notNull(),
    status: text('status').notNull().default('open'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_missions_status_created').on(table.status, table.createdAt)],
);

export const claims = sqliteTable(
  'claims',
  {
    id: text('id').primaryKey(),
    missionId: text('mission_id').notNull(),
    actorDid: text('actor_did').notNull(),
    signature: text('signature').notNull(),
    eventJson: text('event_json').notNull(),
    createdAt: text('created_at').notNull(),
    observedAt: integer('observed_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('idx_claims_mission_actor').on(table.missionId, table.actorDid),
    index('idx_claims_actor_created').on(table.actorDid, table.createdAt),
  ],
);

export const receipts = sqliteTable(
  'receipts',
  {
    id: text('id').primaryKey(),
    schema: text('schema').notNull(),
    actorDid: text('actor_did').notNull(),
    missionId: text('mission_id'),
    objectKey: text('object_key').notNull(),
    sha256: text('sha256').notNull(),
    bytes: integer('bytes').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_receipts_actor_created').on(table.actorDid, table.createdAt)],
);

export const missionSignatures = sqliteTable('mission_signatures', {
  missionId: text('mission_id').primaryKey(),
  receiptId: text('receipt_id').notNull(),
  eventJson: text('event_json').notNull(),
  signature: text('signature').notNull(),
});

export const results = sqliteTable(
  'results',
  {
    id: text('id').primaryKey(),
    missionId: text('mission_id').notNull(),
    claimId: text('claim_id').notNull(),
    actorDid: text('actor_did').notNull(),
    receiptJson: text('receipt_json').notNull(),
    receiptSha256: text('receipt_sha256').notNull(),
    artifactObjectKey: text('artifact_object_key').notNull(),
    artifactName: text('artifact_name').notNull(),
    artifactMediaType: text('artifact_media_type').notNull(),
    artifactSha256: text('artifact_sha256').notNull(),
    artifactBytes: integer('artifact_bytes').notNull(),
    repositoryUrl: text('repository_url'),
    commitSha: text('commit_sha'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_results_claim').on(table.claimId),
    index('idx_results_mission_created').on(table.missionId, table.createdAt),
    index('idx_results_actor_created').on(table.actorDid, table.createdAt),
  ],
);

export const acceptances = sqliteTable(
  'acceptances',
  {
    id: text('id').primaryKey(),
    resultId: text('result_id').notNull(),
    missionId: text('mission_id').notNull(),
    issuerDid: text('issuer_did').notNull(),
    decision: text('decision').notNull(),
    note: text('note').notNull(),
    eventJson: text('event_json').notNull(),
    signature: text('signature').notNull(),
    receiptSha256: text('receipt_sha256').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_acceptances_result').on(table.resultId),
    index('idx_acceptances_mission_created').on(table.missionId, table.createdAt),
  ],
);

export const evidenceChecks = sqliteTable('evidence_checks', {
  resultId: text('result_id').primaryKey(),
  githubStatus: text('github_status').notNull(),
  ciStatus: text('ci_status').notNull(),
  identityBinding: text('identity_binding').notNull(),
  detail: text('detail').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  checkedAt: text('checked_at').notNull(),
});

export const resultFinalizations = sqliteTable(
  'result_finalizations',
  {
    resultId: text('result_id').primaryKey(),
    receiptId: text('receipt_id').notNull(),
    receiptJson: text('receipt_json').notNull(),
    receiptSha256: text('receipt_sha256').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('idx_result_finalizations_receipt').on(table.receiptId)],
);
