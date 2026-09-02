import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const drizzleDirectory = join(root, 'drizzle');
const migrationNames = (await readdir(drizzleDirectory))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
const journal = JSON.parse(await readFile(join(drizzleDirectory, 'meta/_journal.json'), 'utf8'));
assert.equal(journal.dialect, 'sqlite');
assert.deepEqual(journal.entries.map((entry) => `${entry.tag}.sql`), migrationNames);
for (const entry of journal.entries) {
  assert.equal(entry.idx, journal.entries.indexOf(entry));
  await readFile(join(drizzleDirectory, `meta/${String(entry.idx).padStart(4, '0')}_snapshot.json`));
}

const database = new DatabaseSync(':memory:');
try {
  database.exec('PRAGMA foreign_keys = ON;');
  for (const name of migrationNames) {
    const source = await readFile(join(drizzleDirectory, name), 'utf8');
    database.exec(source.replaceAll('--> statement-breakpoint', ''));
  }
  const integrity = database.prepare('PRAGMA integrity_check').get();
  assert.equal(integrity.integrity_check, 'ok');
  const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  for (const table of ['missions', 'result_revisions', 'contribution_dossiers', 'room_epochs', 'technocore_relay_attempts']) {
    assert.equal(tables.has(table), true, `Missing migrated table: ${table}`);
  }
  const relayColumns = new Set(database.prepare("PRAGMA table_info('technocore_relay_attempts')").all().map((row) => row.name));
  for (const column of ['envelope_sha256', 'nonce_value', 'state', 'reserved_at', 'completed_at']) {
    assert.equal(relayColumns.has(column), true, `Missing relay column: ${column}`);
  }
} finally {
  database.close();
}

console.log(JSON.stringify({ migrations: 'ok', applied: migrationNames.length, journal: 'aligned', integrity: 'ok' }));
