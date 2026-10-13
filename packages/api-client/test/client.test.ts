import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VoidApiClient } from '../src/index.ts';

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('VoidApiClient', () => {
  it('returns success envelope', async () => {
    const fetchFn = (async () =>
      jsonResponse({ success: true, data: [{ id: '1' }] })) as typeof fetch;
    const client = new VoidApiClient({ baseUrl: 'https://api.example.com', fetchFn });
    const res = await client.getPosts();
    assert.equal(res.success, true);
  });

  it('returns HTTP-error envelope with JSON body', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ message: 'nope' }), {
        status: 404,
        statusText: 'Not Found',
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    const client = new VoidApiClient({ baseUrl: 'https://api.example.com', fetchFn });
    const res = await client.getPosts();
    assert.equal(res.success, false);
    assert.equal(res.error?.code, 'HTTP_404');
    assert.equal(res.error?.message, 'nope');
  });

  it('returns NETWORK_ERROR envelope when fetch throws', async () => {
    const fetchFn = (async () => {
      throw new Error('boom');
    }) as typeof fetch;
    const client = new VoidApiClient({ baseUrl: 'https://api.example.com', fetchFn });
    const res = await client.getPosts();
    assert.equal(res.success, false);
    assert.equal(res.error?.code, 'NETWORK_ERROR');
  });
});
