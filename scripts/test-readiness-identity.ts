import assert from 'node:assert/strict';
import { createVault } from '../lib/foundry-crypto';
import { assertReadinessDid, restoreReadinessVault } from '../lib/readiness-identity';

const passphrase = 'readiness-test-only-password';
const original = await createVault(passphrase);
const other = await createVault(passphrase);
assert.doesNotThrow(() => assertReadinessDid(original.did, original.did));
for (const expected of ['', other.did, ` ${original.did}`, 'not-a-did']) {
  assert.throws(() => assertReadinessDid(original.did, expected));
}
assert.throws(() => assertReadinessDid(undefined, original.did));
const bytes = JSON.stringify(original);
const recovered = await restoreReadinessVault(bytes, passphrase, original.did);
assert.deepEqual(recovered, original);
await assert.rejects(restoreReadinessVault(bytes, passphrase, other.did), /eşleşmiyor/);
await assert.rejects(restoreReadinessVault(bytes, 'wrong-password', original.did));
await assert.rejects(restoreReadinessVault('{"did":"x","did":"y"}', passphrase, original.did));
assert.equal(JSON.stringify(original), bytes, 'A failed restore must not mutate the original vault');
console.log(JSON.stringify({ readinessIdentity: 'ok', gates: ['explicit-did', 'wrong-did-rejected', 'password-tested', 'strict-vault-input', 'no-mutation'] }));
