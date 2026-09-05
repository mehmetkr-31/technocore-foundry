import { didFromPublicKey, publicKeyFromDid, parseVault, unlockVault, type FoundryVault } from './foundry-crypto';
import { parseStrictJson } from './strict-json';

export function assertReadinessDid(actual: string | undefined, expected: string) {
  if (!expected || expected !== expected.trim()) throw new Error('Kullanmak istediğin tam DID adresini gir.');
  if (didFromPublicKey(publicKeyFromDid(expected)) !== expected) throw new Error('DID adresi geçerli değil.');
  if (actual !== expected) throw new Error('Kimlikler eşleşmiyor. Seçtiğin DID ile aktif kasa farklı; doğru kasayı yükle.');
}

// Validate before the caller replaces any saved vault. A wrong password or DID
// returns no vault and leaves the existing identity untouched.
export async function restoreReadinessVault(source: string, passphrase: string, expectedDid: string): Promise<FoundryVault> {
  const restored = parseVault(parseStrictJson(source));
  assertReadinessDid(restored.did, expectedDid);
  await unlockVault(restored, passphrase);
  return restored;
}
