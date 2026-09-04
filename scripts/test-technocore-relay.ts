import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  normalizeTechnocoreNonce,
  TECHNOCORE_RELAY_ATTEMPTS_TABLE_SQL,
  TECHNOCORE_RELAY_COMPLETE_SQL,
  TECHNOCORE_RELAY_NONCE_INDEX_SQL,
  TECHNOCORE_RELAY_RESERVE_SQL,
  TECHNOCORE_RELAY_RESULT_INDEX_SQL,
  type RelayAttemptStore,
  type TechnocoreRelayAttempt,
  type TechnocoreRelayAttemptState,
} from '../db/technocore-relay-attempts';
import { relayConfiguration } from '../lib/technocore-relay-policy';
import { TECHNOCORE_OPERATIONAL_COMMIT } from '../lib/technocore-contract';
import {
  FOUNDRY_TECHNOCORE_ACK_SOURCE_COMMIT,
  FOUNDRY_TECHNOCORE_ENDPOINT,
  handleTechnocoreRelayPost,
  type TechnocoreRelayDependencies,
} from '../lib/technocore-relay-service';

const publicOrigin = 'https://proofs.example.org';
const configuration = relayConfiguration({
  FOUNDRY_TECHNOCORE_RELAY_ENABLED: '1',
  FOUNDRY_PUBLIC_ORIGIN: publicOrigin,
});
const did = 'did:key:z6MktwupdmLXVVqTzCw4i46r4uGyosGXRnR3XjN4Zq7oMMsw';
const resultId = 'res_111111111111111111111111';
const artifactSha256 = 'a'.repeat(64);
const result = {
  id: resultId,
  missionId: 'F-C0FFEE01',
  claimId: 'frc_111111111111111111111111',
  actorDid: did,
  receiptJson: '{}',
  artifactSha256,
  acceptanceDecision: 'accepted' as const,
};

function compactDid(value: string) {
  return `${value.slice(8, 16)}…${value.slice(-6)}`;
}

function message(nonce: string, overrides: Record<string, unknown> = {}) {
  return {
    room: 'foundry-contributions',
    did,
    sig: 'A'.repeat(86),
    nonce,
    text: `[FOUNDRY] receipt ${resultId} | mission ${result.missionId} | claimant ${compactDid(did)} | artifact sha256:${artifactSha256} | key=valid artifact=match issuer=accepted | ${publicOrigin}/receipt/${resultId}`,
    ...overrides,
  };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${publicOrigin}/api/technocore/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: publicOrigin, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

class MemoryAttemptStore {
  rows: TechnocoreRelayAttempt[] = [];

  async findByEnvelope(envelopeSha256: string) {
    return this.rows.find((row) => row.envelopeSha256 === envelopeSha256) ?? null;
  }

  async reserve(input: {
    envelopeSha256: string; resultId: string; room: string; actorDid: string;
    nonce: string; textSha256: string; reservedAt: string;
  }) {
    const nonceValue = normalizeTechnocoreNonce(input.nonce);
    const exact = await this.findByEnvelope(input.envelopeSha256);
    if (exact) return { reserved: false as const, reason: 'replay' as const, attempt: exact };
    const active = this.rows.find((row) => row.resultId === input.resultId && ['reserved', 'published', 'ambiguous'].includes(row.state));
    if (active) return { reserved: false as const, reason: 'result_locked' as const, attempt: active };
    const stale = this.rows
      .filter((row) => row.room === input.room && row.actorDid === input.actorDid)
      .some((row) => BigInt(row.nonceValue) >= BigInt(nonceValue));
    if (stale) return { reserved: false as const, reason: 'stale_nonce' as const, attempt: null };
    const attempt: TechnocoreRelayAttempt = {
      envelopeSha256: input.envelopeSha256, resultId: input.resultId, room: input.room,
      actorDid: input.actorDid, nonceValue, textSha256: input.textSha256, state: 'reserved',
      upstreamStatus: null, upstreamDetail: null, reservedAt: input.reservedAt, completedAt: null,
    };
    this.rows.push(attempt);
    return { reserved: true as const, attempt };
  }

  async complete(input: {
    envelopeSha256: string; state: Exclude<TechnocoreRelayAttemptState, 'reserved'>;
    upstreamStatus: number | null; upstreamDetail: string; completedAt: string;
  }) {
    const row = this.rows.find((candidate) => candidate.envelopeSha256 === input.envelopeSha256);
    if (!row || row.state !== 'reserved') throw new Error('compare-and-set failed');
    row.state = input.state;
    row.upstreamStatus = input.upstreamStatus;
    row.upstreamDetail = input.upstreamDetail.slice(0, 500);
    row.completedAt = input.completedAt;
    return row;
  }
}

function dependencies(store: MemoryAttemptStore, upstreamFetch: typeof fetch, overrides: Partial<TechnocoreRelayDependencies> = {}): TechnocoreRelayDependencies {
  return {
    verifyMessage: async () => true,
    verifyResultReceipt: async () => true,
    findPublishableResult: async (id) => id === resultId ? result : null,
    attempts: store as unknown as RelayAttemptStore,
    upstreamFetch,
    now: () => new Date('2026-08-28T02:00:00.000Z'),
    ...overrides,
  };
}

function acknowledgement(signedMessage: ReturnType<typeof message>, seq = 42, overrides: Record<string, unknown> = {}, messages?: unknown[]) {
  const posted = {
    seq,
    ts: '2026-08-28T02:00:01.000Z',
    from: signedMessage.did,
    text: signedMessage.text,
    nonce: Number(BigInt(signedMessage.nonce)),
    sig: signedMessage.sig,
    ...overrides,
  };
  return new Response(JSON.stringify({
    room: 'foundry-contributions',
    generation: 7,
    count: 1,
    first_seq: seq,
    last_seq: seq,
    messages: messages ?? [posted],
    posted,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function payload(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Relay tests must use the injected upstream boundary.'); };
try {
  assert.equal(FOUNDRY_TECHNOCORE_ACK_SOURCE_COMMIT, TECHNOCORE_OPERATIONAL_COMMIT);
  const disabledStore = new MemoryAttemptStore();
  const disabled = await handleTechnocoreRelayPost(request(message('1')), relayConfiguration({}), dependencies(disabledStore, globalThis.fetch));
  assert.equal(disabled.status, 403);
  assert.equal(disabledStore.rows.length, 0);

  const boundaryStore = new MemoryAttemptStore();
  let boundaryFetches = 0;
  const neverFetch = async () => { boundaryFetches += 1; return new Response('unexpected'); };
  assert.equal((await handleTechnocoreRelayPost(request(message('1'), { 'Content-Type': 'text/plain' }), configuration, dependencies(boundaryStore, neverFetch))).status, 415);
  assert.equal((await handleTechnocoreRelayPost(request(message('1'), { Origin: 'https://other.example.org' }), configuration, dependencies(boundaryStore, neverFetch))).status, 403);
  assert.equal((await handleTechnocoreRelayPost(request({ ...message('1'), extra: true }), configuration, dependencies(boundaryStore, neverFetch))).status, 400);
  assert.equal((await handleTechnocoreRelayPost(request(message('1', { text: message('1').text.replace(publicOrigin, 'http://localhost:3000') })), configuration, dependencies(boundaryStore, neverFetch))).status, 400);
  assert.equal((await handleTechnocoreRelayPost(request(`${JSON.stringify(message('1'))}${' '.repeat(9000)}`), configuration, dependencies(boundaryStore, neverFetch))).status, 413);
  assert.equal((await handleTechnocoreRelayPost(request(message('1')), configuration, dependencies(boundaryStore, neverFetch, { verifyMessage: async () => false }))).status, 400);
  assert.equal((await handleTechnocoreRelayPost(request(message('1')), configuration, dependencies(boundaryStore, neverFetch, { verifyResultReceipt: async () => false }))).status, 400);
  assert.equal((await handleTechnocoreRelayPost(request(message('1')), configuration, dependencies(boundaryStore, neverFetch, { findPublishableResult: async () => null }))).status, 400);
  assert.equal((await handleTechnocoreRelayPost(request(message('10000000000000000000')), configuration, dependencies(boundaryStore, neverFetch))).status, 400);
  assert.equal(boundaryFetches, 0);
  assert.equal(boundaryStore.rows.length, 0);

  const successStore = new MemoryAttemptStore();
  let successFetches = 0;
  const successFetch: typeof fetch = async (url, init) => {
    successFetches += 1;
    assert.equal(String(url), FOUNDRY_TECHNOCORE_ENDPOINT);
    assert.equal(init?.redirect, 'manual');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      did, sig: 'A'.repeat(86), nonce: '10', text: message('10').text,
    });
    return acknowledgement(message('10'));
  };
  const published = await handleTechnocoreRelayPost(request(message('10')), configuration, dependencies(successStore, successFetch));
  assert.equal(published.status, 200);
  const publishedPayload = await payload(published);
  assert.equal(publishedPayload.status, 'published');
  assert.equal(publishedPayload.generation, 7);
  assert.equal((publishedPayload.proof as Record<string, unknown>).schema, 'foundry-technocore-record-proof-v1');
  const replay = await handleTechnocoreRelayPost(request(message('10')), configuration, dependencies(successStore, successFetch));
  assert.equal(replay.status, 200);
  assert.equal((await payload(replay)).status, 'already_published');
  const sameResultNewNonce = await handleTechnocoreRelayPost(request(message('11')), configuration, dependencies(successStore, successFetch));
  assert.equal(sameResultNewNonce.status, 200);
  assert.equal(successFetches, 1);

  const highNonceStore = new MemoryAttemptStore();
  const highNonce = '9007199254740992';
  const highNonceMessage = message(highNonce);
  const highNoncePublished = await handleTechnocoreRelayPost(
    request(highNonceMessage),
    configuration,
    dependencies(highNonceStore, async () => acknowledgement(highNonceMessage, 44)),
  );
  assert.equal(highNoncePublished.status, 200);
  assert.equal(((await payload(highNoncePublished)).proof as { record: { nonce: string } }).record.nonce, highNonce);

  const legacyNonceStore = new MemoryAttemptStore();
  const legacyNonceMessage = message('12');
  const legacyNonceResponse = acknowledgement(legacyNonceMessage, 43, {}, [{
    seq: 41,
    ts: '2026-08-28T01:59:59.000Z',
    from: did,
    text: 'unrelated room history',
    nonce: 9_007_199_254_740_992,
    sig: 'B'.repeat(86),
  }]);
  const legacyNonceJson = await legacyNonceResponse.text();
  const publishedWithLegacyHistory = await handleTechnocoreRelayPost(
    request(legacyNonceMessage),
    configuration,
    dependencies(legacyNonceStore, async () => new Response(
      legacyNonceJson,
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )),
  );
  assert.equal(publishedWithLegacyHistory.status, 200);

  const concurrentStore = new MemoryAttemptStore();
  let concurrentFetches = 0;
  const concurrentFetch: typeof fetch = async (_url, init) => {
    concurrentFetches += 1;
    await Promise.resolve();
    return acknowledgement(JSON.parse(String(init?.body)));
  };
  const concurrent = await Promise.all([
    handleTechnocoreRelayPost(request(message('20')), configuration, dependencies(concurrentStore, concurrentFetch)),
    handleTechnocoreRelayPost(request(message('21')), configuration, dependencies(concurrentStore, concurrentFetch)),
  ]);
  assert.equal(concurrentFetches, 1);
  assert.equal(concurrent.some((response) => response.status === 200), true);
  assert.equal(concurrent.every((response) => [200, 409].includes(response.status)), true);

  const rejectionStore = new MemoryAttemptStore();
  let rejectionFetches = 0;
  const rejected = await handleTechnocoreRelayPost(request(message('30')), configuration, dependencies(rejectionStore, async () => {
    rejectionFetches += 1;
    return new Response('x'.repeat(1000), { status: 400 });
  }));
  assert.equal(rejected.status, 502);
  const rejectedPayload = await payload(rejected);
  assert.equal(rejectedPayload.detail, 'Technocore returned a known rejection status.');
  assert.doesNotMatch(JSON.stringify(rejectionStore.rows), /xxx/);
  const retried = await handleTechnocoreRelayPost(request(message('31')), configuration, dependencies(rejectionStore, async () => {
    rejectionFetches += 1;
    return acknowledgement(message('31'));
  }));
  assert.equal(retried.status, 200);
  assert.equal(rejectionFetches, 2);

  const normalizedStore = new MemoryAttemptStore();
  let normalizedFetches = 0;
  await handleTechnocoreRelayPost(request(message('1')), configuration, dependencies(normalizedStore, async () => {
    normalizedFetches += 1;
    return new Response('no', { status: 400 });
  }));
  const normalizedReplay = await handleTechnocoreRelayPost(request(message('01')), configuration, dependencies(normalizedStore, async () => {
    normalizedFetches += 1;
    return new Response('unexpected');
  }));
  assert.equal(normalizedReplay.status, 400);
  assert.equal(normalizedFetches, 1);

  const badAcknowledgements: Array<() => Promise<Response>> = [
    async () => new Response('', { status: 302 }),
    async () => new Response('unavailable', { status: 500 }),
    async () => { throw new Error('timeout'); },
    async () => acknowledgement(message('40'), 42, { from: `${did}x` }),
    async () => acknowledgement(message('40'), 42, { text: `${message('40').text}x` }),
    async () => acknowledgement(message('40'), 42, { nonce: 41 }),
    async () => new Response('stored', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    async () => new Response('{"room":"foundry-contributions","posted":', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    async () => new Response('{"room":"foundry-contributions","room":"wrong","posted":{}}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    async () => new Response('x'.repeat(512 * 1024 + 1), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('body read failed')); } }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    async () => new Response(JSON.stringify({ room: 'foundry-contributions' }), { status: 201, headers: { 'Content-Type': 'application/json' } }),
    async () => new Response(null, { status: 204 }),
  ];
  for (const scripted of badAcknowledgements) {
    const ambiguousStore = new MemoryAttemptStore();
    let ambiguousFetches = 0;
    const first = await handleTechnocoreRelayPost(request(message('40')), configuration, dependencies(ambiguousStore, async () => {
      ambiguousFetches += 1;
      return scripted();
    }));
    assert.equal(first.status, 503);
    const second = await handleTechnocoreRelayPost(request(message('41')), configuration, dependencies(ambiguousStore, async () => {
      ambiguousFetches += 1;
      return new Response('unexpected');
    }));
    assert.equal(second.status, 409);
    assert.equal(ambiguousFetches, 1);
  }

  const completionStore = new MemoryAttemptStore();
  let completionFetches = 0;
  const failingCompletion = {
    ...completionStore,
    findByEnvelope: completionStore.findByEnvelope.bind(completionStore),
    reserve: completionStore.reserve.bind(completionStore),
    complete: async () => { throw new Error('D1 completion failure'); },
  } as unknown as RelayAttemptStore;
  const completionDependencies = dependencies(completionStore, async () => {
    completionFetches += 1;
    return acknowledgement(message('50'));
  }, { attempts: failingCompletion });
  assert.equal((await handleTechnocoreRelayPost(request(message('50')), configuration, completionDependencies)).status, 503);
  assert.equal((await handleTechnocoreRelayPost(request(message('50')), configuration, completionDependencies)).status, 409);
  assert.equal(completionFetches, 1);
} finally {
  globalThis.fetch = originalFetch;
}

const sqlite = new DatabaseSync(':memory:');
const bound = (sql: string, values: Array<string | number | null>) => {
  const expanded: Array<string | number | null> = [];
  const anonymousSql = sql.replace(/\?(\d+)/g, (_placeholder, index: string) => {
    const value = values[Number(index) - 1];
    if (value === undefined) throw new Error(`Missing numbered SQL parameter ${index}.`);
    expanded.push(value);
    return '?';
  });
  return Number(sqlite.prepare(anonymousSql).run(...expanded).changes);
};
try {
  sqlite.exec(`${TECHNOCORE_RELAY_ATTEMPTS_TABLE_SQL};\n${TECHNOCORE_RELAY_NONCE_INDEX_SQL};\n${TECHNOCORE_RELAY_RESULT_INDEX_SQL};`);
  assert.equal(bound(TECHNOCORE_RELAY_RESERVE_SQL, ['sha256:one', resultId, 'foundry-contributions', did, '100', 'sha256:text-one', '2026-08-28T02:00:00.000Z']), 1);
  assert.equal(bound(TECHNOCORE_RELAY_RESERVE_SQL, ['sha256:two', resultId, 'foundry-contributions', did, '101', 'sha256:text-two', '2026-08-28T02:00:01.000Z']), 0);
  assert.equal(bound(TECHNOCORE_RELAY_COMPLETE_SQL, ['published', 200, 'seq:42', '2026-08-28T02:00:02.000Z', 'sha256:one']), 1);
  assert.equal(bound(TECHNOCORE_RELAY_RESERVE_SQL, ['sha256:three', 'res_222222222222222222222222', 'foundry-contributions', did, '100', 'sha256:text-three', '2026-08-28T02:00:03.000Z']), 0);
  assert.equal(bound(TECHNOCORE_RELAY_RESERVE_SQL, ['sha256:four', 'res_222222222222222222222222', 'foundry-contributions', did, '101', 'sha256:text-four', '2026-08-28T02:00:04.000Z']), 1);
  assert.equal(bound(TECHNOCORE_RELAY_RESERVE_SQL, ['sha256:five', 'res_333333333333333333333333', 'foundry-contributions', `${did}x`, '200', 'sha256:text-five', '2026-08-28T02:00:05.000Z']), 1);
  assert.equal(bound(TECHNOCORE_RELAY_COMPLETE_SQL, ['rejected', 400, 'bad request', '2026-08-28T02:00:06.000Z', 'sha256:five']), 1);
  assert.equal(bound(TECHNOCORE_RELAY_RESERVE_SQL, ['sha256:six', 'res_333333333333333333333333', 'foundry-contributions', `${did}x`, '201', 'sha256:text-six', '2026-08-28T02:00:07.000Z']), 1);
} finally {
  sqlite.close();
}

console.log(JSON.stringify({
  technocoreRelay: 'ok',
  gates: ['default-off', 'strict-request-boundary', 'fixed-upstream', 'latest-accepted-binding', 'durable-reservation-sql', 'canonical-19-digit-nonce', 'exact-replay', 'concurrent-result-lock', 'known-rejection-retry', 'bound-json-acknowledgement', 'ambiguous-fail-closed', 'completion-cas', 'bounded-upstream'],
}));
