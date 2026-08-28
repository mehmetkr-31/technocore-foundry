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

export const resultRevisions = sqliteTable(
  'result_revisions',
  {
    id: text('id').primaryKey(),
    missionId: text('mission_id').notNull(),
    claimId: text('claim_id').notNull(),
    actorDid: text('actor_did').notNull(),
    revision: integer('revision').notNull(),
    parentResultId: text('parent_result_id'),
    parentReceiptSha256: text('parent_receipt_sha256'),
    changeRequestId: text('change_request_id'),
    changeRequestSha256: text('change_request_sha256'),
    revisionReceiptId: text('revision_receipt_id'),
    revisionEventJson: text('revision_event_json'),
    revisionSignature: text('revision_signature'),
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
    uniqueIndex('idx_result_revisions_claim_revision').on(table.claimId, table.revision),
    uniqueIndex('idx_result_revisions_parent').on(table.parentResultId),
    uniqueIndex('idx_result_revisions_change_request').on(table.changeRequestId),
    uniqueIndex('idx_result_revisions_receipt').on(table.revisionReceiptId),
    index('idx_result_revisions_mission_created').on(table.missionId, table.createdAt),
    index('idx_result_revisions_actor_created').on(table.actorDid, table.createdAt),
  ],
);

export const changeRequests = sqliteTable(
  'change_requests',
  {
    id: text('id').primaryKey(),
    resultId: text('result_id').notNull(),
    missionId: text('mission_id').notNull(),
    issuerDid: text('issuer_did').notNull(),
    resultSha256: text('result_sha256').notNull(),
    note: text('note').notNull(),
    eventJson: text('event_json').notNull(),
    signature: text('signature').notNull(),
    receiptSha256: text('receipt_sha256').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_change_requests_result').on(table.resultId),
    index('idx_change_requests_mission_created').on(table.missionId, table.createdAt),
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

export const evidenceReceipts = sqliteTable(
  'evidence_receipts',
  {
    id: text('id').primaryKey(),
    resultId: text('result_id').notNull(),
    missionId: text('mission_id').notNull(),
    kind: text('kind').notNull(),
    actorDid: text('actor_did').notNull(),
    receiptSha256: text('receipt_sha256').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_evidence_receipts_result_kind_actor').on(table.resultId, table.kind, table.actorDid),
    index('idx_evidence_receipts_result_created').on(table.resultId, table.createdAt),
    index('idx_evidence_receipts_mission_created').on(table.missionId, table.createdAt),
  ],
);

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

export const attestations = sqliteTable(
  'attestations',
  {
    id: text('id').primaryKey(),
    resultId: text('result_id').notNull(),
    missionId: text('mission_id').notNull(),
    actorDid: text('actor_did').notNull(),
    statement: text('statement').notNull(),
    note: text('note').notNull(),
    eventJson: text('event_json').notNull(),
    signature: text('signature').notNull(),
    receiptSha256: text('receipt_sha256').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_attestations_result_actor_statement').on(table.resultId, table.actorDid, table.statement),
    index('idx_attestations_mission_created').on(table.missionId, table.createdAt),
    index('idx_attestations_actor_created').on(table.actorDid, table.createdAt),
  ],
);

export const roomEpochs = sqliteTable(
  'room_epochs',
  {
    id: text('id').primaryKey(),
    room: text('room').notNull(),
    epoch: integer('epoch').notNull(),
    startSeq: integer('start_seq').notNull(),
    endSeq: integer('end_seq').notNull(),
    gapCount: integer('gap_count').notNull().default(0),
    sourceCommit: text('source_commit').notNull(),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
    lastSyncAt: text('last_sync_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_room_epochs_room_epoch').on(table.room, table.epoch),
    index('idx_room_epochs_room_started').on(table.room, table.startedAt),
  ],
);

export const transportObservations = sqliteTable(
  'transport_observations',
  {
    id: text('id').primaryKey(),
    room: text('room').notNull(),
    epoch: integer('epoch').notNull(),
    sequence: integer('sequence').notNull(),
    serverTimestamp: text('server_timestamp').notNull(),
    actorHint: text('actor_hint').notNull(),
    textSha256: text('text_sha256').notNull(),
    receiptId: text('receipt_id'),
    verificationState: text('verification_state').notNull(),
    observedAt: text('observed_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_transport_observations_room_epoch_sequence').on(table.room, table.epoch, table.sequence),
    index('idx_transport_observations_receipt').on(table.receiptId),
    index('idx_transport_observations_observed').on(table.observedAt),
  ],
);

export const observerGaps = sqliteTable(
  'observer_gaps',
  {
    id: text('id').primaryKey(),
    room: text('room').notNull(),
    epoch: integer('epoch').notNull(),
    kind: text('kind').notNull(),
    expectedSeq: integer('expected_seq').notNull(),
    firstSeq: integer('first_seq').notNull(),
    detectedAt: text('detected_at').notNull(),
  },
  (table) => [index('idx_observer_gaps_room_detected').on(table.room, table.detectedAt)],
);
