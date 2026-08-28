import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCommonsIndex,
  loadCommonsRegistry,
  serializeCommonsIndex,
} from '../packages/signer-cli/commons.mjs';

const mode = process.argv[2] ?? '--verify';
if (!['--verify', '--check', '--write'].includes(mode) || process.argv.length > 3) {
  throw new Error('Usage: node scripts/commons-registry.mjs [--verify|--check|--write]');
}

const repositoryRoot = process.env.COMMONS_REPOSITORY_ROOT
  ? resolve(process.env.COMMONS_REPOSITORY_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registryDirectory = resolve(repositoryRoot, 'commons/dossiers');
const indexPath = resolve(repositoryRoot, 'public/commons/index.json');
const records = await loadCommonsRegistry(registryDirectory);
const serialized = serializeCommonsIndex(buildCommonsIndex(records));

if (mode === '--write') {
  await mkdir(dirname(indexPath), { recursive: true });
  await writeFile(indexPath, serialized, { encoding: 'utf8', mode: 0o644 });
} else if (mode === '--check') {
  const current = await readFile(indexPath, 'utf8').catch(() => '');
  if (current !== serialized) throw new Error('public/commons/index.json is stale. Run npm run commons:build.');
}

console.log(JSON.stringify({
  commonsRegistry: 'ok',
  mode: mode.slice(2),
  dossiers: records.length,
  index: 'public/commons/index.json',
}));
