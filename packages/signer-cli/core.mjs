import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  pbkdf2Sync,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';

export const VAULT_SCHEMA = 'foundry-vault-v1';
export const EVENT_SCHEMA = 'foundry-event-v1';
export const TCR1_TYPE = 'technocore-task-receipt';
export const TCR1_DOMAIN = 'technocore-task-receipt:v1';
export const VERIFICATION_RECEIPT_SCHEMA = 'foundry-verification-receipt-v1';
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ED25519_MULTICODEC = Buffer.from([0xed, 0x01]);
const KDF_ITERATIONS = 310_000;

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function fromBase64url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Malformed base64url value.');
  return Buffer.from(value, 'base64url');
}

function base58(bytes) {
  let number = 0n;
  for (const byte of bytes) number = number * 256n + BigInt(byte);
  let encoded = '';
  while (number > 0n) {
    encoded = BASE58[Number(number % 58n)] + encoded;
    number /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded;
}

function didFromPublicKey(publicKey) {
  if (publicKey.length !== 32) throw new Error('Expected a 32-byte Ed25519 public key.');
  return `did:key:z${base58(Buffer.concat([ED25519_MULTICODEC, publicKey]))}`;
}

function compareUnicode(left, right) {
  const a = Array.from(left, (value) => value.codePointAt(0));
  const b = Array.from(right, (value) => value.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function assertUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('Lone Unicode surrogate is forbidden.');
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error('Lone Unicode surrogate is forbidden.');
    }
  }
}

function assertJson(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') { assertUnicode(value); return; }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Only safe JSON integers are allowed.');
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('Cyclic JSON is forbidden.');
    seen.add(value);
    value.forEach((item) => assertJson(item, seen));
    seen.delete(value);
    return;
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    if (seen.has(value)) throw new Error('Cyclic JSON is forbidden.');
    seen.add(value);
    Object.entries(value).forEach(([key, item]) => { assertUnicode(key); assertJson(item, seen); });
    seen.delete(value);
    return;
  }
  throw new Error('Only plain JSON values are allowed.');
}

export function canonicalJson(value) {
  assertJson(value);
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => compareUnicode(a, b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

export function parseStrictJson(source) {
  assertUnicode(source);
  let index = 0;
  const error = (message) => new Error(`${message} At character ${index}.`);
  const whitespace = () => { while (/[\t\n\r ]/.test(source[index] ?? '')) index += 1; };
  const string = () => {
    const start = index++;
    while (index < source.length) {
      if (source[index] === '"') {
        index += 1;
        try {
          const value = JSON.parse(source.slice(start, index));
          assertUnicode(value);
          return value;
        } catch { throw error('Malformed JSON string.'); }
      }
      index += source[index] === '\\' ? 2 : 1;
    }
    throw error('Unterminated JSON string.');
  };
  const value = () => {
    whitespace();
    const character = source[index];
    if (character === '"') return string();
    for (const [token, result] of [['true', true], ['false', false], ['null', null]]) {
      if (source.startsWith(token, index)) { index += token.length; return result; }
    }
    if (character === '[') {
      index += 1; whitespace();
      const output = [];
      if (source[index] === ']') { index += 1; return output; }
      while (true) {
        output.push(value()); whitespace();
        if (source[index] === ']') { index += 1; return output; }
        if (source[index++] !== ',') throw error('Expected a comma or closing bracket.');
      }
    }
    if (character === '{') {
      index += 1; whitespace();
      const output = {};
      const keys = new Set();
      if (source[index] === '}') { index += 1; return output; }
      while (true) {
        whitespace();
        if (source[index] !== '"') throw error('Expected an object key.');
        const key = string();
        if (keys.has(key)) throw error(`Duplicate object key: ${key}.`);
        keys.add(key); whitespace();
        if (source[index++] !== ':') throw error('Expected a colon after the object key.');
        output[key] = value(); whitespace();
        if (source[index] === '}') { index += 1; return output; }
        if (source[index++] !== ',') throw error('Expected a comma or closing brace.');
      }
    }
    if (character === '-' || /[0-9]/.test(character ?? '')) {
      const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(index));
      if (!match) throw error('Malformed JSON number.');
      index += match[0].length;
      if (/[.eE]/.test(match[0])) throw error('Floats are forbidden.');
      const number = Number(match[0]);
      if (!Number.isSafeInteger(number)) throw error('JSON integer exceeds the safe cross-language profile.');
      return number;
    }
    throw error('Expected a JSON value.');
  };
  whitespace();
  const output = value();
  whitespace();
  if (index !== source.length) throw error('Unexpected trailing input.');
  assertJson(output);
  return output;
}

function domainBytes(domain, value) {
  return Buffer.concat([Buffer.from(`${domain}\0`, 'utf8'), Buffer.from(canonicalJson(value), 'utf8')]);
}

export function createVault(passphrase, now = new Date()) {
  if (typeof passphrase !== 'string' || passphrase.length < 12) throw new Error('Use a passphrase with at least 12 characters.');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const rawPublicKey = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const privateBytes = privateKey.export({ type: 'pkcs8', format: 'der' });
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(passphrase, salt, KDF_ITERATIONS, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(rawPublicKey);
  const encrypted = Buffer.concat([cipher.update(privateBytes), cipher.final(), cipher.getAuthTag()]);
  return {
    schema: VAULT_SCHEMA,
    did: didFromPublicKey(rawPublicKey),
    publicKey: base64url(rawPublicKey),
    ciphertext: base64url(encrypted),
    salt: base64url(salt),
    iv: base64url(iv),
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: KDF_ITERATIONS },
    cipher: 'AES-GCM',
    createdAt: now.toISOString(),
  };
}

export function parseVault(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Vault must be a JSON object.');
  if (value.schema !== VAULT_SCHEMA || value.cipher !== 'AES-GCM' || value.kdf?.name !== 'PBKDF2' || value.kdf?.hash !== 'SHA-256' || value.kdf?.iterations !== KDF_ITERATIONS) {
    throw new Error('Unsupported Foundry vault.');
  }
  const publicKey = fromBase64url(value.publicKey);
  if (didFromPublicKey(publicKey) !== value.did) throw new Error('Vault DID does not match its public key.');
  if (fromBase64url(value.iv).length !== 12 || fromBase64url(value.salt).length !== 16 || fromBase64url(value.ciphertext).length < 17) throw new Error('Malformed vault encryption fields.');
  return value;
}

export function unlockVault(vaultInput, passphrase) {
  const vault = parseVault(vaultInput);
  const publicKey = fromBase64url(vault.publicKey);
  const encrypted = fromBase64url(vault.ciphertext);
  const key = pbkdf2Sync(passphrase, fromBase64url(vault.salt), vault.kdf.iterations, 32, 'sha256');
  const decipher = createDecipheriv('aes-256-gcm', key, fromBase64url(vault.iv));
  decipher.setAAD(publicKey);
  decipher.setAuthTag(encrypted.subarray(-16));
  let privateKey;
  try {
    privateKey = createPrivateKey({ key: Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]), type: 'pkcs8', format: 'der' });
  } catch {
    throw new Error('Passphrase is incorrect or the vault was modified.');
  }
  const challenge = randomBytes(32);
  const signature = sign(null, challenge, privateKey);
  if (!verify(null, challenge, createPublicKey(privateKey), signature) || !createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(-32).equals(publicKey)) {
    throw new Error('Vault key pair failed its local recovery test.');
  }
  return privateKey;
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validTimestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value));
}

function assertFoundryEvent(event, did) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Unsigned input must be a JSON object.');
  if (event.schema !== EVENT_SCHEMA || !['mission', 'claim', 'acceptance', 'change_request', 'revision', 'attestation'].includes(event.type)) throw new Error('Unsupported Foundry event.');
  if (event.actor !== did) throw new Error('Unsigned event actor must equal the vault DID.');
  if (typeof event.nonce !== 'string' || !/^\d{1,80}$/.test(event.nonce) || !validTimestamp(event.createdAt)) throw new Error('Malformed event nonce or timestamp.');
  const missionId = typeof event.missionId === 'string' && /^(M-[0-9]{3}|F-[A-F0-9]{8})$/.test(event.missionId);
  const digest = (value) => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
  let valid = false;
  if (event.type === 'mission') valid = hasOnlyKeys(event, ['schema', 'type', 'missionId', 'title', 'lane', 'summary', 'requirements', 'requirementsHash', 'actor', 'nonce', 'createdAt']) && /^F-[A-F0-9]{8}$/.test(event.missionId) && typeof event.title === 'string' && event.title.length >= 8 && event.title.length <= 100 && typeof event.lane === 'string' && event.lane.length >= 3 && event.lane.length <= 40 && typeof event.summary === 'string' && event.summary.length >= 20 && event.summary.length <= 300 && typeof event.requirements === 'string' && event.requirements.length >= 20 && event.requirements.length <= 4000 && digest(event.requirementsHash);
  if (event.type === 'claim') valid = hasOnlyKeys(event, ['schema', 'type', 'missionId', 'requirementsHash', 'actor', 'nonce', 'createdAt']) && missionId && digest(event.requirementsHash);
  if (event.type === 'acceptance') valid = hasOnlyKeys(event, ['schema', 'type', 'missionId', 'resultId', 'resultSha256', 'decision', 'note', 'actor', 'nonce', 'createdAt']) && missionId && /^res_[a-f0-9]{24}$/.test(event.resultId) && digest(event.resultSha256) && ['accepted', 'rejected'].includes(event.decision) && typeof event.note === 'string' && event.note.length <= 500;
  if (event.type === 'change_request') valid = hasOnlyKeys(event, ['schema', 'type', 'missionId', 'resultId', 'resultSha256', 'note', 'actor', 'nonce', 'createdAt']) && missionId && /^res_[a-f0-9]{24}$/.test(event.resultId) && digest(event.resultSha256) && typeof event.note === 'string' && event.note.length >= 12 && event.note.length <= 1000;
  if (event.type === 'attestation') valid = hasOnlyKeys(event, ['schema', 'type', 'missionId', 'resultId', 'resultSha256', 'statement', 'note', 'actor', 'nonce', 'createdAt']) && missionId && /^res_[a-f0-9]{24}$/.test(event.resultId) && digest(event.resultSha256) && ['reproduced', 'reviewed', 'used', 'collaborated'].includes(event.statement) && typeof event.note === 'string' && event.note.length >= 12 && event.note.length <= 500;
  if (event.type === 'revision') valid = hasOnlyKeys(event, ['schema', 'type', 'missionId', 'claimId', 'resultId', 'resultSha256', 'parentResultId', 'parentResultSha256', 'changeRequestId', 'changeRequestSha256', 'revision', 'actor', 'nonce', 'createdAt']) && missionId && /^frc_[a-f0-9]{24}$/.test(event.claimId) && /^res_[a-f0-9]{24}$/.test(event.resultId) && digest(event.resultSha256) && /^res_[a-f0-9]{24}$/.test(event.parentResultId) && digest(event.parentResultSha256) && /^fcr_[a-f0-9]{24}$/.test(event.changeRequestId) && digest(event.changeRequestSha256) && Number.isInteger(event.revision) && event.revision >= 2 && event.revision <= 5;
  if (!valid) throw new Error('Malformed or noncanonical Foundry event.');
}

function assertVerificationReceipt(receipt, did) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || 'signature' in receipt) throw new Error('Input must be an unsigned verification receipt.');
  const digest = (value) => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
  const forbidden = (value) => Array.isArray(value) ? value.some(forbidden) : value && typeof value === 'object' ? Object.entries(value).some(([key, item]) => /secret|private|password|token|airdrop|eligib/i.test(key) || forbidden(item)) : false;
  const checkValid = (check) => check && typeof check === 'object' && !Array.isArray(check) &&
    hasOnlyKeys(check, ['id', 'executableSha256', 'argvSha256', 'exitCode', 'stdoutSha256', 'stderrSha256', 'durationMs']) &&
    typeof check.id === 'string' && /^[a-z0-9][a-z0-9_.:-]{1,63}$/.test(check.id) &&
    digest(check.executableSha256) &&
    digest(check.argvSha256) &&
    Number.isSafeInteger(check.exitCode) && check.exitCode >= 0 && check.exitCode <= 255 &&
    digest(check.stdoutSha256) &&
    digest(check.stderrSha256) &&
    Number.isSafeInteger(check.durationMs) && check.durationMs >= 0 && check.durationMs <= 3_600_000;
  const valid = hasOnlyKeys(receipt, ['schema', 'resultId', 'resultReceiptSha256', 'candidateCommit', 'verifierDid', 'checks', 'createdAt']) &&
    !forbidden(receipt) &&
    receipt.schema === VERIFICATION_RECEIPT_SCHEMA &&
    /^res_[a-f0-9]{24}$/.test(receipt.resultId) &&
    digest(receipt.resultReceiptSha256) &&
    typeof receipt.candidateCommit === 'string' && /^[a-f0-9]{40}$/.test(receipt.candidateCommit) &&
    receipt.verifierDid === did &&
    validTimestamp(receipt.createdAt) &&
    Array.isArray(receipt.checks) && receipt.checks.length >= 1 && receipt.checks.length <= 20 &&
    receipt.checks.every(checkValid);
  if (!valid) throw new Error('Malformed or noncanonical verification receipt.');
}

export function signEvent(vault, passphrase, event) {
  assertFoundryEvent(event, vault.did);
  const privateKey = unlockVault(vault, passphrase);
  return { event, signature: base64url(sign(null, domainBytes(EVENT_SCHEMA, event), privateKey)) };
}

export function signTcr1(vault, passphrase, unsigned) {
  if (!unsigned || typeof unsigned !== 'object' || Array.isArray(unsigned) || 'signature' in unsigned) throw new Error('Input must be an unsigned TCR-1 object.');
  if (unsigned.type !== TCR1_TYPE || unsigned.version !== 1) throw new Error('Unsupported TCR-1 document.');
  const claimant = typeof unsigned.claimant === 'string' ? unsigned.claimant : unsigned.claimant?.did;
  if (claimant !== vault.did) throw new Error('TCR-1 claimant must equal the vault DID.');
  const forbidden = (value) => Array.isArray(value) ? value.some(forbidden) : value && typeof value === 'object' ? Object.entries(value).some(([key, item]) => /secret|private|password|token|airdrop|eligib/i.test(key) || forbidden(item)) : false;
  const artifactValid = (artifact) => artifact && typeof artifact === 'object' && !Array.isArray(artifact) && hasOnlyKeys(artifact, ['type', 'uri', 'sha256', 'size']) && typeof artifact.type === 'string' && artifact.type.length > 0 && typeof artifact.uri === 'string' && artifact.uri.length > 0 && /^[a-f0-9]{64}$/.test(artifact.sha256) && (artifact.size === undefined || (Number.isSafeInteger(artifact.size) && artifact.size >= 0));
  const evidence = unsigned.evidence;
  const valid = hasOnlyKeys(unsigned, ['type', 'version', 'task', 'claimant', 'artifacts', 'created_at', 'expires_at', 'evidence']) && !forbidden(unsigned) && unsigned.task && typeof unsigned.task === 'object' && !Array.isArray(unsigned.task) && hasOnlyKeys(unsigned.task, ['id', 'issuer', 'requirements_sha256']) && typeof unsigned.task.id === 'string' && /^did:key:z6Mk/.test(unsigned.task.issuer) && /^[a-f0-9]{64}$/.test(unsigned.task.requirements_sha256) && validTimestamp(unsigned.created_at) && (unsigned.expires_at === undefined || validTimestamp(unsigned.expires_at)) && Array.isArray(unsigned.artifacts) && unsigned.artifacts.length >= 1 && unsigned.artifacts.every(artifactValid) && (typeof unsigned.claimant === 'string' || (unsigned.claimant && typeof unsigned.claimant === 'object' && !Array.isArray(unsigned.claimant) && hasOnlyKeys(unsigned.claimant, ['did']))) && (evidence === undefined || (evidence && typeof evidence === 'object' && !Array.isArray(evidence) && hasOnlyKeys(evidence, ['repository', 'commit', 'pull_request', 'ci_url', 'ci_status', 'acceptance_sha256']) && (evidence.repository === undefined || typeof evidence.repository === 'string') && (evidence.commit === undefined || /^[a-f0-9]{40}$/.test(evidence.commit)) && (evidence.pull_request === undefined || typeof evidence.pull_request === 'string') && (evidence.ci_url === undefined || typeof evidence.ci_url === 'string') && (evidence.ci_status === undefined || ['success', 'failure', 'pending', 'cancelled'].includes(evidence.ci_status)) && (evidence.acceptance_sha256 === undefined || /^[a-f0-9]{64}$/.test(evidence.acceptance_sha256))));
  if (!valid) throw new Error('Malformed or noncanonical unsigned TCR-1 document.');
  const privateKey = unlockVault(vault, passphrase);
  return {
    ...unsigned,
    signature: { algorithm: 'Ed25519', domain: TCR1_DOMAIN, value: base64url(sign(null, domainBytes(TCR1_DOMAIN, unsigned), privateKey)) },
  };
}

export function signVerification(vault, passphrase, receipt) {
  assertVerificationReceipt(receipt, vault.did);
  const privateKey = unlockVault(vault, passphrase);
  return {
    receipt,
    signature: { algorithm: 'Ed25519', domain: VERIFICATION_RECEIPT_SCHEMA, value: base64url(sign(null, domainBytes(VERIFICATION_RECEIPT_SCHEMA, receipt), privateKey)) },
  };
}

export function signTechnocore(vault, passphrase, message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Technocore input must be a JSON object.');
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(message.room) || typeof message.text !== 'string' || message.text.includes('\n') || message.text.length > 4096 || !/^\d{19}$/.test(message.nonce)) {
    throw new Error('Malformed Technocore room, text, or 19-digit nonce.');
  }
  const privateKey = unlockVault(vault, passphrase);
  const payload = Buffer.from(`${message.room}|${message.nonce}|${message.text}`, 'utf8');
  return { room: message.room, did: vault.did, sig: base64url(sign(null, payload, privateKey)), nonce: message.nonce, text: message.text };
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}
