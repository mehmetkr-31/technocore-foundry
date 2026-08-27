import assert from 'node:assert/strict';
import { verifyTcr1Receipt, type Tcr1Receipt } from '../lib/foundry-crypto';
import { validateGitHubEvidence } from '../lib/github-evidence';

for (const repository of [
  'http://github.com/owner/repo',
  'https://github.com@127.0.0.1/repo',
  'https://127.0.0.1/owner/repo',
  'https://github.com/owner/repo?redirect=http://127.0.0.1',
]) {
  assert.throws(() => validateGitHubEvidence({ repository }), /GitHub|Repository/);
}

assert.throws(() => validateGitHubEvidence({
  repository: 'https://github.com/owner/repo',
  ci_url: 'https://github.com/other/repo/actions/runs/1',
  ci_status: 'success',
}), /same GitHub repository/);

const forbidden = {
  type: 'technocore-task-receipt', version: 1,
  task: { id: 'M-042', issuer: 'did:key:z6MkjtkShmr1CG8rHHPBUDqCUbtwfQ6E9u4g2NdHXjCsg471', requirements_sha256: '1'.repeat(64) },
  claimant: { did: 'did:key:z6MkjtkShmr1CG8rHHPBUDqCUbtwfQ6E9u4g2NdHXjCsg471' },
  artifacts: [{ type: 'text/plain', uri: 'https://example.org/a', sha256: '2'.repeat(64) }],
  created_at: '2026-08-27T00:00:00.000Z',
  private_token: 'must-never-enter-a-receipt',
  signature: { algorithm: 'Ed25519', domain: 'technocore-task-receipt:v1', value: 'A'.repeat(86) },
} as unknown as Tcr1Receipt;
assert.equal(await verifyTcr1Receipt(forbidden), false);

console.log(JSON.stringify({ securityUnit: 'ok', gates: ['ssrf-url-policy', 'cross-repository-binding', 'secret-field-rejection'] }));
