import fixture from '@/protocol/fixtures/v1.json';

export const dynamic = 'force-static';

export async function GET(request: Request) {
  const download = new URL(request.url).searchParams.get('download') === '1';
  return new Response(`${JSON.stringify(fixture, null, 2)}\n`, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="technocore-foundry-protocol-fixtures-v1.json"`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
