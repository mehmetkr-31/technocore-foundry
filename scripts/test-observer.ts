import assert from 'node:assert/strict';
import { parseRoomView, planObserverSync } from '../lib/technocore-observer';

const did = 'did:key:z6MkjtkShmr1CG8rHHPBUDqCUbtwfQ6E9u4g2NdHXjCsg471';
const normalView = parseRoomView({
  room: 'foundry-contributions', count: 2, first_seq: 11, last_seq: 12,
  messages: [
    { seq: 11, ts: '2026-08-27T00:00:00.000Z', from: did, text: 'receipt fat_1234567890abcdef12345678' },
    { seq: 12, ts: '2026-08-27T00:00:01.000Z', from: 'alice', text: 'plain observation' },
  ],
});
const current = {
  id: 'foundry-contributions:0', room: 'foundry-contributions', epoch: 0,
  startSeq: 1, endSeq: 10, gapCount: 0, sourceCommit: 'source',
  startedAt: '2026-08-26T00:00:00.000Z', endedAt: null, lastSyncAt: '2026-08-26T00:00:00.000Z',
};
const normal = await planObserverSync({ current, tailSeq: 12, view: normalView, syncedAt: '2026-08-27T00:00:02.000Z' });
assert.equal(normal.epoch, 0);
assert.equal(normal.gap, null);
assert.equal(normal.observations[0].receiptId, 'fat_1234567890abcdef12345678');
assert.equal(normal.observations[1].actorHint, 'unsigned-or-self-asserted');
assert.equal(normal.observations[0].verificationState, 'transport_unverifiable');

const gapView = parseRoomView({
  room: 'foundry-contributions', count: 1, first_seq: 15, last_seq: 15,
  messages: [{ seq: 15, ts: '2026-08-27T00:00:03.000Z', from: did, text: 'after retention' }],
});
const gap = await planObserverSync({ current, tailSeq: 15, view: gapView, syncedAt: '2026-08-27T00:00:04.000Z' });
assert.equal(gap.gap?.kind, 'retention_gap');
assert.equal(gap.gap?.expectedSeq, 11);

const rewindView = parseRoomView({
  room: 'foundry-contributions', count: 1, first_seq: 1, last_seq: 1,
  messages: [{ seq: 1, ts: '2026-08-27T00:00:05.000Z', from: did, text: 'new room lifetime' }],
});
const rewind = await planObserverSync({ current, tailSeq: 1, view: rewindView, syncedAt: '2026-08-27T00:00:06.000Z' });
assert.equal(rewind.epoch, 1);
assert.equal(rewind.epochRewind?.kind, 'epoch_rewind');
assert.equal(rewind.gap, null);

assert.throws(() => parseRoomView({ ...normalView, room: 'attacker-room' }), /unexpected/);
console.log(JSON.stringify({ observerReducer: 'ok', cases: ['normal', 'retention-gap', 'epoch-rewind'] }));
