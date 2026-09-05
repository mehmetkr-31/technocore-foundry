import { lstat, readFile } from 'node:fs/promises';
import { verifyWorkDealBundle, WORK_DEAL_MAX_BYTES } from '../lib/work-deal-bundle';

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] === '--help') {
  console.log('Usage: npm run deal:verify -- <fwd-package.json>\nOffline verification only. No keys, network or settlement.');
  process.exitCode = args[0] === '--help' ? 0 : 1;
} else {
  try {
    const stat = await lstat(args[0]);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > WORK_DEAL_MAX_BYTES) throw new Error('A regular package file of at most 4 MiB is required.');
    const result = await verifyWorkDealBundle(await readFile(args[0]));
    console.log(JSON.stringify({ valid: result.valid, id: result.id, sha256: result.sha256,
      mission: result.work.mission.id, workState: result.work.selectedState,
      dealState: result.deal.status, transportDid: result.deal.layers.transportDid,
      limits: result.limits }, null, 2));
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : 'Verification failed');
    process.exitCode = 1;
  }
}
