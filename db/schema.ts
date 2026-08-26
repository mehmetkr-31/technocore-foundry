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
