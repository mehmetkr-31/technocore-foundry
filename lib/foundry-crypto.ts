export const VAULT_SCHEMA = 'foundry-vault-v1' as const;
export const EVENT_SCHEMA = 'foundry-event-v1' as const;

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ED25519_MULTICODEC = new Uint8Array([0xed, 0x01]);
const KDF_ITERATIONS = 310_000;

export type FoundryVault = {
  schema: typeof VAULT_SCHEMA;
  did: string;
  publicKey: string;
  ciphertext: string;
  salt: string;
  iv: string;
  kdf: {
    name: 'PBKDF2';
    hash: 'SHA-256';
    iterations: number;
  };
  cipher: 'AES-GCM';
  createdAt: string;
};

export type FoundryClaimEvent = {
  schema: typeof EVENT_SCHEMA;
  type: 'claim';
  missionId: string;
  requirementsHash: string;
  actor: string;
  nonce: string;
  createdAt: string;
};

export type SignedFoundryEvent = {
  event: FoundryClaimEvent;
  signature: string;
};

function concatBytes(...parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function base58Encode(bytes: Uint8Array) {
  let number = 0n;
  for (const byte of bytes) number = number * 256n + BigInt(byte);
  let encoded = '';
  while (number > 0n) {
    const remainder = Number(number % 58n);
    number /= 58n;
    encoded = BASE58[remainder] + encoded;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded;
}

export function base58Decode(value: string) {
  let number = 0n;
  for (const character of value) {
    const index = BASE58.indexOf(character);
    if (index < 0) throw new Error('Invalid base58btc character.');
    number = number * 58n + BigInt(index);
  }
  const output: number[] = [];
  while (number > 0n) {
    output.unshift(Number(number % 256n));
    number /= 256n;
  }
  for (const character of value) {
    if (character !== '1') break;
    output.unshift(0);
  }
  return new Uint8Array(output);
}

export function didFromPublicKey(publicKey: Uint8Array) {
  if (publicKey.length !== 32) throw new Error('Ed25519 public keys must contain 32 bytes.');
  return `did:key:z${base58Encode(concatBytes(ED25519_MULTICODEC, publicKey))}`;
}

export function publicKeyFromDid(did: string) {
  if (!did.startsWith('did:key:z6Mk')) throw new Error('Expected a canonical Ed25519 did:key.');
  const decoded = base58Decode(did.slice('did:key:z'.length));
  if (decoded.length !== 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error('DID does not contain an Ed25519 public key.');
  }
  return decoded.slice(2);
}

async function deriveVaultKey(passphrase: string, salt: Uint8Array, iterations: number) {
  const saltBuffer = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer;
  const passphraseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBuffer, iterations },
    passphraseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function assertEd25519Support() {
  if (!globalThis.crypto?.subtle) {
    throw new Error('This browser does not expose the Web Crypto API.');
  }
}

export async function createVault(passphrase: string): Promise<FoundryVault> {
  assertEd25519Support();
  if (passphrase.length < 12) throw new Error('Use a passphrase with at least 12 characters.');

  const keyPair = (await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const [publicBytes, privateBytes] = await Promise.all([
    crypto.subtle.exportKey('raw', keyPair.publicKey),
    crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
  ]);
  const publicKey = new Uint8Array(publicBytes);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptionKey = await deriveVaultKey(passphrase, salt, KDF_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: publicKey },
    encryptionKey,
    privateBytes,
  );

  return {
    schema: VAULT_SCHEMA,
    did: didFromPublicKey(publicKey),
    publicKey: bytesToBase64Url(publicKey),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    salt: bytesToBase64Url(salt),
    iv: bytesToBase64Url(iv),
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: KDF_ITERATIONS },
    cipher: 'AES-GCM',
    createdAt: new Date().toISOString(),
  };
}

export function parseVault(value: unknown): FoundryVault {
  if (!value || typeof value !== 'object') throw new Error('Vault file must contain a JSON object.');
  const candidate = value as Partial<FoundryVault>;
  if (
    candidate.schema !== VAULT_SCHEMA ||
    typeof candidate.did !== 'string' ||
    typeof candidate.publicKey !== 'string' ||
    typeof candidate.ciphertext !== 'string' ||
    typeof candidate.salt !== 'string' ||
    typeof candidate.iv !== 'string' ||
    candidate.cipher !== 'AES-GCM' ||
    candidate.kdf?.name !== 'PBKDF2' ||
    candidate.kdf.hash !== 'SHA-256' ||
    typeof candidate.kdf.iterations !== 'number'
  ) {
    throw new Error('Unsupported or malformed Foundry vault.');
  }
  const publicKey = base64UrlToBytes(candidate.publicKey);
  if (didFromPublicKey(publicKey) !== candidate.did) throw new Error('Vault DID does not match its public key.');
  return candidate as FoundryVault;
}

export async function unlockVault(vault: FoundryVault, passphrase: string) {
  const publicKey = base64UrlToBytes(vault.publicKey);
  const encryptionKey = await deriveVaultKey(
    passphrase,
    base64UrlToBytes(vault.salt),
    vault.kdf.iterations,
  );
  let privateBytes: ArrayBuffer;
  try {
    privateBytes = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64UrlToBytes(vault.iv),
        additionalData: publicKey,
      },
      encryptionKey,
      base64UrlToBytes(vault.ciphertext),
    );
  } catch {
    throw new Error('Passphrase is incorrect or the vault was modified.');
  }

  const [privateKey, verifyKey] = await Promise.all([
    crypto.subtle.importKey('pkcs8', privateBytes, { name: 'Ed25519' }, false, ['sign']),
    crypto.subtle.importKey('raw', publicKey, { name: 'Ed25519' }, false, ['verify']),
  ]);
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const signature = await crypto.subtle.sign('Ed25519', privateKey, challenge);
  const verified = await crypto.subtle.verify('Ed25519', verifyKey, signature, challenge);
  if (!verified) throw new Error('Vault key pair failed its local recovery test.');
  return privateKey;
}

function sortCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortCanonical(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(sortCanonical(value));
}

export function eventSigningBytes(event: FoundryClaimEvent) {
  return concatBytes(
    new TextEncoder().encode(`${EVENT_SCHEMA}\0`),
    new TextEncoder().encode(canonicalJson(event)),
  );
}

export async function signClaim(
  vault: FoundryVault,
  passphrase: string,
  missionId: string,
  requirementsHash: string,
): Promise<SignedFoundryEvent> {
  const privateKey = await unlockVault(vault, passphrase);
  const event: FoundryClaimEvent = {
    schema: EVENT_SCHEMA,
    type: 'claim',
    missionId,
    requirementsHash,
    actor: vault.did,
    nonce: Date.now().toString(),
    createdAt: new Date().toISOString(),
  };
  const signature = await crypto.subtle.sign('Ed25519', privateKey, eventSigningBytes(event));
  return { event, signature: bytesToBase64Url(new Uint8Array(signature)) };
}

export async function verifySignedEvent(receipt: SignedFoundryEvent) {
  if (receipt.event?.schema !== EVENT_SCHEMA || receipt.event.type !== 'claim') return false;
  const publicKey = await crypto.subtle.importKey(
    'raw',
    publicKeyFromDid(receipt.event.actor),
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    'Ed25519',
    publicKey,
    base64UrlToBytes(receipt.signature),
    eventSigningBytes(receipt.event),
  );
}

export function downloadVault(vault: FoundryVault) {
  const blob = new Blob([`${JSON.stringify(vault, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `technocore-foundry-${vault.did.slice(-8)}.vault.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
