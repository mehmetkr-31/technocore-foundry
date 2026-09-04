import {
  base64UrlToBytes,
  bytesToBase64Url,
  canonicalJson,
  publicKeyFromDid,
  sha256Hex,
  unlockVault,
  type FoundryVault,
} from './foundry-crypto';
import type { ReadinessMessage } from './readiness-storage';
import { verifyTechnocoreRecordProof, type TechnocoreRecordProof } from './technocore-records';

export const PARTICIPATION_BUNDLE_SCHEMA = 'foundry-technocore-participation-v1' as const;
export const PARTICIPATION_BUNDLE_DOMAIN = 'foundry-technocore-participation:v1' as const;

export type ParticipationBundle = {
  schema: typeof PARTICIPATION_BUNDLE_SCHEMA;
  did: string;
  fingerprint: string;
  createdAt: string;
  contribution: { type: string; url: string; summary: string };
  routing: {
    profilePath: string | null;
    profileValue: string | null;
    profileTrust: 'unsigned-world-writable-routing-only';
    mailbox: string | null;
    mailboxTrust: 'public-append-room-signed-writes-only-not-private';
  };
  activity: Array<ReadinessMessage & { trust: 'local-ack-metadata-seq-ts-generation-not-author-signed' }>;
  portableProofs: TechnocoreRecordProof[];
  claims: { eligibility: 'not-claimed'; airdrop: 'not-guaranteed'; serverInclusion: 'not-proven-offline' };
};

export type SignedParticipationBundle = {
  bundle: ParticipationBundle;
  signature: { algorithm: 'Ed25519'; domain: typeof PARTICIPATION_BUNDLE_DOMAIN; value: string };
};

function cleanSingleLine(value: string, limit: number, label: string) {
  const clean = Array.from(value)
    .map((character) => /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/u.test(character) ? ' ' : character)
    .join('').trim();
  if (!clean || Array.from(clean).length > limit) throw new Error(`${label} must contain 1-${limit} visible characters.`);
  return clean;
}

function signingBytes(bundle: ParticipationBundle) {
  return new TextEncoder().encode(`${PARTICIPATION_BUNDLE_DOMAIN}\0${canonicalJson(bundle)}`);
}

function exactObject(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export async function createSignedParticipationBundle(input: {
  vault: FoundryVault;
  passphrase: string;
  contributionType: string;
  contributionUrl: string;
  contributionSummary: string;
  profilePath: string | null;
  profileValue: string | null;
  mailbox: string | null;
  activity: ReadinessMessage[];
  portableProofs: TechnocoreRecordProof[];
}) {
  const contributionUrl = new URL(input.contributionUrl);
  if (!['https:', 'http:'].includes(contributionUrl.protocol)) throw new Error('Contribution URL must use HTTP or HTTPS.');
  const fingerprint = (await sha256Hex(input.vault.did)).slice(0, 16);
  for (const proof of input.portableProofs) {
    if (proof.record.from !== input.vault.did || !await verifyTechnocoreRecordProof(proof)) {
      throw new Error('Every embedded portable proof must have a valid signature from the active DID.');
    }
  }
  const bundle: ParticipationBundle = {
    schema: PARTICIPATION_BUNDLE_SCHEMA,
    did: input.vault.did,
    fingerprint,
    createdAt: new Date().toISOString(),
    contribution: {
      type: cleanSingleLine(input.contributionType, 32, 'Contribution type'),
      url: contributionUrl.toString(),
      summary: cleanSingleLine(input.contributionSummary, 320, 'Contribution summary'),
    },
    routing: {
      profilePath: input.profilePath,
      profileValue: input.profileValue,
      profileTrust: 'unsigned-world-writable-routing-only',
      mailbox: input.mailbox,
      mailboxTrust: 'public-append-room-signed-writes-only-not-private',
    },
    activity: input.activity.slice(-32).map((item) => ({ ...item, trust: 'local-ack-metadata-seq-ts-generation-not-author-signed' })),
    portableProofs: input.portableProofs.slice(-8),
    claims: { eligibility: 'not-claimed', airdrop: 'not-guaranteed', serverInclusion: 'not-proven-offline' },
  };
  const privateKey = await unlockVault(input.vault, input.passphrase);
  const signature = await crypto.subtle.sign('Ed25519', privateKey, signingBytes(bundle));
  return {
    bundle,
    signature: { algorithm: 'Ed25519', domain: PARTICIPATION_BUNDLE_DOMAIN, value: bytesToBase64Url(new Uint8Array(signature)) },
  } satisfies SignedParticipationBundle;
}

export async function verifySignedParticipationBundle(value: unknown) {
  try {
    const envelope = value as SignedParticipationBundle;
    if (
      !exactObject(envelope, ['bundle', 'signature']) ||
      !envelope.bundle || envelope.bundle.schema !== PARTICIPATION_BUNDLE_SCHEMA ||
      !exactObject(envelope.bundle, ['schema', 'did', 'fingerprint', 'createdAt', 'contribution', 'routing', 'activity', 'portableProofs', 'claims']) ||
      !exactObject(envelope.bundle.contribution, ['type', 'url', 'summary']) ||
      !exactObject(envelope.bundle.routing, ['profilePath', 'profileValue', 'profileTrust', 'mailbox', 'mailboxTrust']) ||
      !exactObject(envelope.bundle.claims, ['eligibility', 'airdrop', 'serverInclusion']) ||
      !exactObject(envelope.signature, ['algorithm', 'domain', 'value']) ||
      !envelope.signature || envelope.signature.algorithm !== 'Ed25519' ||
      envelope.signature.domain !== PARTICIPATION_BUNDLE_DOMAIN || !/^[A-Za-z0-9_-]{86}$/.test(envelope.signature.value) ||
      !/^did:key:z[1-9A-HJ-NP-Za-km-z]{47}$/.test(envelope.bundle.did) ||
      !/^[a-f0-9]{16}$/.test(envelope.bundle.fingerprint) ||
      (await sha256Hex(envelope.bundle.did)).slice(0, 16) !== envelope.bundle.fingerprint ||
      !Number.isFinite(Date.parse(envelope.bundle.createdAt)) || new Date(envelope.bundle.createdAt).toISOString() !== envelope.bundle.createdAt ||
      envelope.bundle.routing.profileTrust !== 'unsigned-world-writable-routing-only' ||
      envelope.bundle.routing.mailboxTrust !== 'public-append-room-signed-writes-only-not-private' ||
      (envelope.bundle.routing.mailbox !== null && !/^mb-p-[a-z0-9]{16,40}$/.test(envelope.bundle.routing.mailbox)) ||
      envelope.bundle.claims.eligibility !== 'not-claimed' || envelope.bundle.claims.airdrop !== 'not-guaranteed' ||
      envelope.bundle.claims.serverInclusion !== 'not-proven-offline' ||
      !Array.isArray(envelope.bundle.activity) || envelope.bundle.activity.length > 32 ||
      !Array.isArray(envelope.bundle.portableProofs) || envelope.bundle.portableProofs.length > 8
    ) return false;
    for (const proof of envelope.bundle.portableProofs) {
      if (proof.record.from !== envelope.bundle.did || !await verifyTechnocoreRecordProof(proof)) return false;
    }
    const publicKey = await crypto.subtle.importKey('raw', publicKeyFromDid(envelope.bundle.did), { name: 'Ed25519' }, false, ['verify']);
    return crypto.subtle.verify('Ed25519', publicKey, base64UrlToBytes(envelope.signature.value), signingBytes(envelope.bundle));
  } catch {
    return false;
  }
}
