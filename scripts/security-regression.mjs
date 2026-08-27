const ORIGIN = process.env.FOUNDRY_ORIGIN ?? 'http://localhost:3000';

async function expect(path, init, status, label) {
  const response = await fetch(`${ORIGIN}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
  const accepted = Array.isArray(status) ? status : [status];
  if (!accepted.includes(response.status)) throw new Error(`${label}: expected ${accepted.join(' or ')}, received ${response.status}.`);
  return response;
}

const home = await expect('/', undefined, 200, 'home');
for (const [header, expected] of [
  ['x-content-type-options', 'nosniff'],
  ['x-frame-options', 'DENY'],
  ['referrer-policy', 'strict-origin-when-cross-origin'],
]) {
  if (home.headers.get(header) !== expected) throw new Error(`Missing security header ${header}.`);
}
if (!home.headers.get('content-security-policy')?.includes("frame-ancestors 'none'")) throw new Error('CSP frame boundary is missing.');

await expect('/api/claims', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: '{"event":{},"event":{},"signature":"x"}',
}, 400, 'duplicate JSON keys');

await expect('/api/claims', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: Uint8Array.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]),
}, 400, 'invalid UTF-8');

await expect('/api/claims', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(17_000),
}, [400, 413], 'oversized claim');

await expect('/api/claims', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    event: {
      schema: 'foundry-event-v1', type: 'claim', missionId: 'M-042',
      requirementsHash: `sha256:${'1'.repeat(64)}`,
      actor: 'did:key:z6MkjtkShmr1CG8rHHPBUDqCUbtwfQ6E9u4g2NdHXjCsg471',
      nonce: '2026082700000000001', createdAt: new Date().toISOString(),
    },
    signature: 'A'.repeat(86),
  }),
}, 400, 'tampered signature');

await expect('/api/observer/sync', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'http://127.0.0.1:8080/private' }),
}, 400, 'observer SSRF input');

await expect('/api/receipts/fat_not-a-receipt', undefined, 400, 'receipt identifier boundary');
await expect('/security', undefined, 200, 'security surface');

console.log(JSON.stringify({ securityRegression: 'ok', gates: ['headers', 'strict-json', 'utf8', 'size', 'signature', 'fixed-origin', 'receipt-id'] }));
