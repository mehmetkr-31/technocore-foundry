import { canonicalJson } from './strict-json';

export const VAULT_SCHEMA = 'foundry-vault-v1' as const;
export const EVENT_SCHEMA = 'foundry-event-v1' as const;
export const TCR1_TYPE = 'technocore-task-receipt' as const;
export const TCR1_DOMAIN = 'technocore-task-receipt:v1' as const;
export const MAX_RESULT_REVISIONS = 5 as const;

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
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number };
  cipher: 'AES-GCM';
  createdAt: string;
};

type EventBase = {
  schema: typeof EVENT_SCHEMA;
  actor: string;
  nonce: string;
  createdAt: string;
};

export type FoundryMissionEvent = EventBase & {
  type: 'mission';
  missionId: string;
  title: string;
  lane: string;
  summary: string;
  requirements: string;
  requirementsHash: string;
};

export type FoundryClaimEvent = EventBase & {
  type: 'claim';
  missionId: string;
  requirementsHash: string;
};

export type FoundryAcceptanceEvent = EventBase & {
  type: 'acceptance';
  missionId: string;
  resultId: string;
  resultSha256: string;
  decision: 'accepted' | 'rejected';
  note: string;
};

export type FoundryChangeRequestEvent = EventBase & {
  type: 'change_request';
  missionId: string;
  resultId: string;
  resultSha256: string;
  note: string;
};

export type FoundryRevisionEvent = EventBase & {
  type: 'revision';
  missionId: string;
  claimId: string;
  resultId: string;
  resultSha256: string;
  parentResultId: string;
  parentResultSha256: string;
  changeRequestId: string;
  changeRequestSha256: string;
  revision: number;
};

export type FoundryEvent =
  | FoundryMissionEvent
  | FoundryClaimEvent
  | FoundryAcceptanceEvent
  | FoundryChangeRequestEvent
  | FoundryRevisionEvent;

export type SignedFoundryEvent<T extends FoundryEvent = FoundryEvent> = {
  event: T;
  signature: string;
};

export type Tcr1Artifact = {
  type: string;
  uri: string;
  sha256: string;
  size?: number;
};

export type Tcr1Receipt = {
  type: typeof TCR1_TYPE;
  version: 1;
  task: {
    id: string;
    issuer: string;
    requirements_sha256: string;
  };
  claimant: { did: string } | string;
  artifacts: Tcr1Artifact[];
  created_at: string;
  expires_at?: string;
  evidence?: {
    repository?: string;
    commit?: string;
    pull_request?: string;
    ci_url?: string;
    ci_status?: 'success' | 'failure' | 'pending' | 'cancelled';
    acceptance_sha256?: string;
  };
  signature: {
    algorithm: 'Ed25519';
    domain: typeof TCR1_DOMAIN;
    value: string;
  };
};

export type TechnocoreSignedMessage = {
  room: string;
  did: string;
  sig: string;
  nonce: string;
  text: string;
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

function exactBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
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
  const publicKey = decoded.slice(2);
  if (didFromPublicKey(publicKey) !== did) throw new Error('DID uses a noncanonical base58btc encoding.');
  return publicKey;
}

async function deriveVaultKey(passphrase: string, salt: Uint8Array, iterations: number) {
  const passphraseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: exactBuffer(salt), iterations },
    passphraseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function assertEd25519Support() {
  if (!globalThis.crypto?.subtle) throw new Error('This browser does not expose the Web Crypto API.');
}

export async function createVault(passphrase: string): Promise<FoundryVault> {
  assertEd25519Support();
  if (passphrase.length < 12) throw new Error('Use a passphrase with at least 12 characters.');

  const keyPair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
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
  ) throw new Error('Unsupported or malformed Foundry vault.');
  const publicKey = base64UrlToBytes(candidate.publicKey);
  if (didFromPublicKey(publicKey) !== candidate.did) throw new Error('Vault DID does not match its public key.');
  return candidate as FoundryVault;
}

export async function unlockVault(vault: FoundryVault, passphrase: string) {
  const publicKey = base64UrlToBytes(vault.publicKey);
  const encryptionKey = await deriveVaultKey(passphrase, base64UrlToBytes(vault.salt), vault.kdf.iterations);
  let privateBytes: ArrayBuffer;
  try {
    privateBytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64UrlToBytes(vault.iv), additionalData: publicKey },
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
  if (!(await crypto.subtle.verify('Ed25519', verifyKey, signature, challenge))) {
    throw new Error('Vault key pair failed its local recovery test.');
  }
  return privateKey;
}

export { canonicalJson };

export async function sha256Hex(value: string | ArrayBuffer | Uint8Array) {
  const bytes = typeof value === 'string'
    ? new TextEncoder().encode(value)
    : value instanceof Uint8Array
      ? value
      : new Uint8Array(value);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', exactBuffer(bytes)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function domainBytes(domain: string, value: unknown) {
  return concatBytes(new TextEncoder().encode(`${domain}\0`), new TextEncoder().encode(canonicalJson(value)));
}

export function eventSigningBytes(event: FoundryEvent) {
  return domainBytes(EVENT_SCHEMA, event);
}

async function signFoundryEvent<T extends FoundryEvent>(vault: FoundryVault, passphrase: string, event: T) {
  const privateKey = await unlockVault(vault, passphrase);
  const signature = await crypto.subtle.sign('Ed25519', privateKey, eventSigningBytes(event));
  return { event, signature: bytesToBase64Url(new Uint8Array(signature)) } satisfies SignedFoundryEvent<T>;
}

let lastNonce = 0n;

function nonce() {
  const random = BigInt(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000);
  const candidate = BigInt(Date.now()) * 1_000_000n + random;
  lastNonce = candidate > lastNonce ? candidate : lastNonce + 1n;
  return lastNonce.toString();
}

export async function signMission(
  vault: FoundryVault,
  passphrase: string,
  input: { title: string; lane: string; summary: string; requirements: string },
) {
  const requirementsHash = `sha256:${await sha256Hex(input.requirements)}`;
  const random = crypto.getRandomValues(new Uint8Array(4));
  const missionId = `F-${Array.from(random, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  return signFoundryEvent(vault, passphrase, {
    schema: EVENT_SCHEMA,
    type: 'mission',
    missionId,
    title: input.title,
    lane: input.lane,
    summary: input.summary,
    requirements: input.requirements,
    requirementsHash,
    actor: vault.did,
    nonce: nonce(),
    createdAt: new Date().toISOString(),
  });
}

export async function signClaim(vault: FoundryVault, passphrase: string, missionId: string, requirementsHash: string) {
  return signFoundryEvent(vault, passphrase, {
    schema: EVENT_SCHEMA,
    type: 'claim',
    missionId,
    requirementsHash,
    actor: vault.did,
    nonce: nonce(),
    createdAt: new Date().toISOString(),
  });
}

export async function signAcceptance(
  vault: FoundryVault,
  passphrase: string,
  input: { missionId: string; resultId: string; resultSha256: string; decision: 'accepted' | 'rejected'; note: string },
) {
  return signFoundryEvent(vault, passphrase, {
    schema: EVENT_SCHEMA,
    type: 'acceptance',
    ...input,
    actor: vault.did,
    nonce: nonce(),
    createdAt: new Date().toISOString(),
  });
}

export async function signChangeRequest(
  vault: FoundryVault,
  passphrase: string,
  input: { missionId: string; resultId: string; resultSha256: string; note: string },
) {
  return signFoundryEvent(vault, passphrase, {
    schema: EVENT_SCHEMA,
    type: 'change_request',
    ...input,
    actor: vault.did,
    nonce: nonce(),
    createdAt: new Date().toISOString(),
  });
}

export async function signRevision(
  vault: FoundryVault,
  passphrase: string,
  input: Omit<FoundryRevisionEvent, keyof EventBase | 'type' | 'schema'>,
) {
  return signFoundryEvent(vault, passphrase, {
    schema: EVENT_SCHEMA,
    type: 'revision',
    ...input,
    actor: vault.did,
    nonce: nonce(),
    createdAt: new Date().toISOString(),
  });
}

export async function verifySignedEvent(receipt: SignedFoundryEvent) {
  try {
    if (!isFoundryEvent(receipt?.event) || !/^[A-Za-z0-9_-]{86}$/.test(receipt.signature)) return false;
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
  } catch {
    return false;
  }
}

function isFoundryEvent(value: unknown): value is FoundryEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  if (
    event.schema !== EVENT_SCHEMA ||
    !['mission', 'claim', 'acceptance', 'change_request', 'revision'].includes(typeof event.type === 'string' ? event.type : '') ||
    typeof event.actor !== 'string' ||
    typeof event.nonce !== 'string' || !/^\d{1,80}$/.test(event.nonce) ||
    typeof event.createdAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(event.createdAt) ||
    !Number.isFinite(Date.parse(event.createdAt))
  ) return false;
  if (event.type === 'mission') {
    return hasOnlyKeys(event, ['schema', 'type', 'missionId', 'title', 'lane', 'summary', 'requirements', 'requirementsHash', 'actor', 'nonce', 'createdAt']) &&
      typeof event.missionId === 'string' && /^F-[A-F0-9]{8}$/.test(event.missionId) &&
      typeof event.title === 'string' && event.title.length >= 8 && event.title.length <= 100 &&
      typeof event.lane === 'string' && event.lane.length >= 3 && event.lane.length <= 40 &&
      typeof event.summary === 'string' && event.summary.length >= 20 && event.summary.length <= 300 &&
      typeof event.requirements === 'string' && event.requirements.length >= 20 && event.requirements.length <= 4000 &&
      typeof event.requirementsHash === 'string' && /^sha256:[a-f0-9]{64}$/.test(event.requirementsHash);
  }
  if (event.type === 'claim') {
    return hasOnlyKeys(event, ['schema', 'type', 'missionId', 'requirementsHash', 'actor', 'nonce', 'createdAt']) &&
      typeof event.missionId === 'string' && /^(M-[0-9]{3}|F-[A-F0-9]{8})$/.test(event.missionId) &&
      typeof event.requirementsHash === 'string' && /^sha256:[a-f0-9]{64}$/.test(event.requirementsHash);
  }
  if (event.type === 'acceptance') {
    return hasOnlyKeys(event, ['schema', 'type', 'missionId', 'resultId', 'resultSha256', 'decision', 'note', 'actor', 'nonce', 'createdAt']) &&
      typeof event.missionId === 'string' && /^(M-[0-9]{3}|F-[A-F0-9]{8})$/.test(event.missionId) &&
      typeof event.resultId === 'string' && /^res_[a-f0-9]{24}$/.test(event.resultId) &&
      typeof event.resultSha256 === 'string' && /^sha256:[a-f0-9]{64}$/.test(event.resultSha256) &&
      (event.decision === 'accepted' || event.decision === 'rejected') &&
      typeof event.note === 'string' && event.note.length <= 500;
  }
  if (event.type === 'change_request') {
    return hasOnlyKeys(event, ['schema', 'type', 'missionId', 'resultId', 'resultSha256', 'note', 'actor', 'nonce', 'createdAt']) &&
      typeof event.missionId === 'string' && /^(M-[0-9]{3}|F-[A-F0-9]{8})$/.test(event.missionId) &&
      typeof event.resultId === 'string' && /^res_[a-f0-9]{24}$/.test(event.resultId) &&
      typeof event.resultSha256 === 'string' && /^sha256:[a-f0-9]{64}$/.test(event.resultSha256) &&
      typeof event.note === 'string' && event.note.length >= 12 && event.note.length <= 1000;
  }
  return hasOnlyKeys(event, [
    'schema', 'type', 'missionId', 'claimId', 'resultId', 'resultSha256', 'parentResultId',
    'parentResultSha256', 'changeRequestId', 'changeRequestSha256', 'revision', 'actor', 'nonce', 'createdAt',
  ]) &&
    typeof event.missionId === 'string' && /^(M-[0-9]{3}|F-[A-F0-9]{8})$/.test(event.missionId) &&
    typeof event.claimId === 'string' && /^frc_[a-f0-9]{24}$/.test(event.claimId) &&
    typeof event.resultId === 'string' && /^res_[a-f0-9]{24}$/.test(event.resultId) &&
    typeof event.resultSha256 === 'string' && /^sha256:[a-f0-9]{64}$/.test(event.resultSha256) &&
    typeof event.parentResultId === 'string' && /^res_[a-f0-9]{24}$/.test(event.parentResultId) &&
    typeof event.parentResultSha256 === 'string' && /^sha256:[a-f0-9]{64}$/.test(event.parentResultSha256) &&
    typeof event.changeRequestId === 'string' && /^fcr_[a-f0-9]{24}$/.test(event.changeRequestId) &&
    typeof event.changeRequestSha256 === 'string' && /^sha256:[a-f0-9]{64}$/.test(event.changeRequestSha256) &&
    Number.isInteger(event.revision) && Number(event.revision) >= 2 && Number(event.revision) <= MAX_RESULT_REVISIONS;
}

function tcr1Unsigned(receipt: Tcr1Receipt) {
  const unsigned = { ...receipt };
  Reflect.deleteProperty(unsigned, 'signature');
  return unsigned;
}

export async function signTcr1Receipt(
  vault: FoundryVault,
  passphrase: string,
  input: {
    task: Tcr1Receipt['task'];
    artifact: Tcr1Artifact;
    evidence?: Tcr1Receipt['evidence'];
  },
) {
  const privateKey = await unlockVault(vault, passphrase);
  const unsigned = {
    type: TCR1_TYPE,
    version: 1 as const,
    task: input.task,
    claimant: { did: vault.did },
    artifacts: [input.artifact],
    created_at: new Date().toISOString(),
    ...(input.evidence && Object.keys(input.evidence).length ? { evidence: input.evidence } : {}),
  };
  const signature = await crypto.subtle.sign('Ed25519', privateKey, domainBytes(TCR1_DOMAIN, unsigned));
  return {
    ...unsigned,
    signature: { algorithm: 'Ed25519' as const, domain: TCR1_DOMAIN, value: bytesToBase64Url(new Uint8Array(signature)) },
  } satisfies Tcr1Receipt;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function hasForbiddenReceiptKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenReceiptKey);
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, item]) => /secret|private|password|token|airdrop|eligib/i.test(key) || hasForbiddenReceiptKey(item),
    );
  }
  return false;
}

export async function verifyTcr1Receipt(receipt: Tcr1Receipt) {
  try {
    if (!receipt || typeof receipt !== 'object' || !hasOnlyKeys(receipt as unknown as Record<string, unknown>, ['type', 'version', 'task', 'claimant', 'artifacts', 'created_at', 'expires_at', 'evidence', 'signature'])) return false;
    if (hasForbiddenReceiptKey(receipt)) return false;
    if (receipt.type !== TCR1_TYPE || receipt.version !== 1 || !receipt.task || !receipt.signature) return false;
    if (!hasOnlyKeys(receipt.task as unknown as Record<string, unknown>, ['id', 'issuer', 'requirements_sha256'])) return false;
    if (!hasOnlyKeys(receipt.signature as unknown as Record<string, unknown>, ['algorithm', 'domain', 'value'])) return false;
    if (receipt.signature.algorithm !== 'Ed25519' || receipt.signature.domain !== TCR1_DOMAIN || !/^[A-Za-z0-9_-]{86}$/.test(receipt.signature.value)) return false;
    if (typeof receipt.task.id !== 'string' || typeof receipt.task.issuer !== 'string') return false;
    const claimantDid = tcr1ClaimantDid(receipt);
    if (!claimantDid) return false;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(receipt.created_at) || !Number.isFinite(Date.parse(receipt.created_at))) return false;
    if (receipt.expires_at !== undefined && (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(receipt.expires_at) ||
      !Number.isFinite(Date.parse(receipt.expires_at)) ||
      Date.parse(receipt.expires_at) <= Date.now()
    )) return false;
    if (!Array.isArray(receipt.artifacts) || receipt.artifacts.length < 1) return false;
    if (!/^[a-f0-9]{64}$/.test(receipt.task.requirements_sha256)) return false;
    if (!receipt.artifacts.every((artifact) =>
      artifact &&
      hasOnlyKeys(artifact as unknown as Record<string, unknown>, ['type', 'uri', 'sha256', 'size']) &&
      /^[a-f0-9]{64}$/.test(artifact.sha256) &&
      typeof artifact.uri === 'string' && artifact.uri.length > 0 &&
      typeof artifact.type === 'string' && artifact.type.length > 0 &&
      (artifact.size === undefined || (Number.isSafeInteger(artifact.size) && artifact.size >= 0)),
    )) return false;
    if (receipt.evidence && (
      !hasOnlyKeys(receipt.evidence as unknown as Record<string, unknown>, ['repository', 'commit', 'pull_request', 'ci_url', 'ci_status', 'acceptance_sha256']) ||
      (receipt.evidence.repository !== undefined && typeof receipt.evidence.repository !== 'string') ||
      (receipt.evidence.commit !== undefined && !/^[a-f0-9]{40}$/.test(receipt.evidence.commit)) ||
      (receipt.evidence.pull_request !== undefined && typeof receipt.evidence.pull_request !== 'string') ||
      (receipt.evidence.ci_url !== undefined && typeof receipt.evidence.ci_url !== 'string') ||
      (receipt.evidence.ci_status !== undefined && !['success', 'failure', 'pending', 'cancelled'].includes(receipt.evidence.ci_status)) ||
      (receipt.evidence.acceptance_sha256 !== undefined && !/^[a-f0-9]{64}$/.test(receipt.evidence.acceptance_sha256))
    )) return false;
    const claimantPublicKey = publicKeyFromDid(claimantDid);
    if (didFromPublicKey(claimantPublicKey) !== claimantDid || publicKeyFromDid(receipt.task.issuer).length !== 32) return false;
    const publicKey = await crypto.subtle.importKey('raw', claimantPublicKey, { name: 'Ed25519' }, false, ['verify']);
    return crypto.subtle.verify(
      'Ed25519',
      publicKey,
      base64UrlToBytes(receipt.signature.value),
      domainBytes(TCR1_DOMAIN, tcr1Unsigned(receipt)),
    );
  } catch {
    return false;
  }
}

export function tcr1ClaimantDid(receipt: Pick<Tcr1Receipt, 'claimant'>) {
  if (typeof receipt.claimant === 'string') return receipt.claimant;
  if (
    receipt.claimant && typeof receipt.claimant === 'object' &&
    hasOnlyKeys(receipt.claimant as unknown as Record<string, unknown>, ['did']) &&
    typeof receipt.claimant.did === 'string'
  ) return receipt.claimant.did;
  return null;
}

export function sweepTechnocoreText(text: string) {
  return Array.from(text)
    .map((character) => /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/u.test(character) ? ' ' : character)
    .join('')
    .slice(0, 4096);
}

export async function signTechnocoreAnnouncement(vault: FoundryVault, passphrase: string, room: string, text: string) {
  const privateKey = await unlockVault(vault, passphrase);
  const cleanText = sweepTechnocoreText(text);
  const messageNonce = nonce();
  const bytes = new TextEncoder().encode(`${room}|${messageNonce}|${cleanText}`);
  const signature = await crypto.subtle.sign('Ed25519', privateKey, bytes);
  return { room, did: vault.did, sig: bytesToBase64Url(new Uint8Array(signature)), nonce: messageNonce, text: cleanText } satisfies TechnocoreSignedMessage;
}

export async function verifyTechnocoreMessage(message: TechnocoreSignedMessage) {
  try {
    if (message.text !== sweepTechnocoreText(message.text) || !/^\d{1,19}$/.test(message.nonce) || !/^[A-Za-z0-9_-]{86}$/.test(message.sig)) return false;
    const publicKey = await crypto.subtle.importKey('raw', publicKeyFromDid(message.did), { name: 'Ed25519' }, false, ['verify']);
    return crypto.subtle.verify(
      'Ed25519',
      publicKey,
      base64UrlToBytes(message.sig),
      new TextEncoder().encode(`${message.room}|${message.nonce}|${message.text}`),
    );
  } catch {
    return false;
  }
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
