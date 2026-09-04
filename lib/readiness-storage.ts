export type ReadinessMessage = {
  room: string;
  sequence: string;
  generation: number;
  publishedAt: string;
};

export type ReadinessLedger = {
  schema: 'foundry-readiness-ledger-v1';
  did: string;
  backupVerifiedAt: string | null;
  profilePublishedAt: string | null;
  mailbox: string | null;
  messages: ReadinessMessage[];
};

const PREFIX = 'technocore-foundry-readiness:';

function emptyLedger(did: string): ReadinessLedger {
  return { schema: 'foundry-readiness-ledger-v1', did, backupVerifiedAt: null, profilePublishedAt: null, mailbox: null, messages: [] };
}

function validTimestamp(value: unknown) {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function parseLedger(value: unknown, did: string): ReadinessLedger {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyLedger(did);
  const candidate = value as Partial<ReadinessLedger>;
  if (candidate.schema !== 'foundry-readiness-ledger-v1' || candidate.did !== did || !Array.isArray(candidate.messages)) return emptyLedger(did);
  const messages = candidate.messages.filter((item): item is ReadinessMessage => Boolean(
    item && typeof item === 'object' &&
    typeof item.room === 'string' && /^[a-z0-9][a-z0-9_-]{0,47}$/.test(item.room) &&
    typeof item.sequence === 'string' && /^\d+$/.test(item.sequence) &&
    Number.isSafeInteger(item.generation) && item.generation >= 0 && validTimestamp(item.publishedAt),
  )).slice(-32);
  return {
    schema: 'foundry-readiness-ledger-v1',
    did,
    backupVerifiedAt: candidate.backupVerifiedAt === null || validTimestamp(candidate.backupVerifiedAt) ? candidate.backupVerifiedAt ?? null : null,
    profilePublishedAt: candidate.profilePublishedAt === null || validTimestamp(candidate.profilePublishedAt) ? candidate.profilePublishedAt ?? null : null,
    mailbox: typeof candidate.mailbox === 'string' && /^mb-p-[a-z0-9]{16,40}$/.test(candidate.mailbox) ? candidate.mailbox : null,
    messages,
  };
}

export function loadReadinessLedger(did: string) {
  try {
    const raw = localStorage.getItem(`${PREFIX}${did}`);
    return raw ? parseLedger(JSON.parse(raw), did) : emptyLedger(did);
  } catch {
    return emptyLedger(did);
  }
}

export function saveReadinessLedger(ledger: ReadinessLedger) {
  localStorage.setItem(`${PREFIX}${ledger.did}`, JSON.stringify(parseLedger(ledger, ledger.did)));
}

export function recordReadinessMessage(ledger: ReadinessLedger, message: ReadinessMessage) {
  const next = { ...ledger, messages: [...ledger.messages, message].slice(-32) };
  saveReadinessLedger(next);
  return next;
}
