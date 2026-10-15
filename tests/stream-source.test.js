import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviders, UpstreamError } from '../backend/providers.js';
import { loadConfig } from '../backend/config.js';
import { consumeEvents } from '../backend/stream-source.js';

const args = { query: '中文 & Python', platform: 'all', page: 1 };
const item = { title: '中文资料', url: 'https://pan.quark.cn/s/valid123', code: 'abcd', check_done: true, valid: true };
const frame = (event, data) => `event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
const session = () => new Response('{}', { headers: [['Set-Cookie', 'search_token=anonymous; HttpOnly'], ['Set-Cookie', 'search_device_id=device; Secure'], ['Set-Cookie', 'unrelated=private; Secure']] });
const stream = raw => new Response(raw, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
const provider = fetcher => createProviders(loadConfig({ TELEGRAM_CHANNELS: '' }), fetcher).find(p => p.id === 'lightsearch');

test('anonymous session stays backend-only; query is encoded, results deduplicated and unverified', async () => {
  const calls = [];
  const p = provider(async (url, options) => {
    calls.push({ url, options });
    if (url.pathname.endsWith('/session')) return session();
    assert.equal(url.searchParams.get('keyword'), args.query);
    assert.equal(options.headers.Cookie, 'search_token=anonymous; search_device_id=device');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Origin, 'https://sosopx.com');
    return stream(frame('item', item) + frame('item', item) + frame('item', { title: 'unsafe', url: 'https://evil.test/' }) + frame('done', {}));
  });
  const result = await p.search(args);
  assert.equal(result.items.length, 1); assert.equal(result.degraded, false);
  assert.equal(result.items[0].password, 'abcd'); assert.equal(result.items[0].publishedAt, null);
  assert.equal(result.items[0].linkState, 'unchecked');
  assert.ok(!JSON.stringify(result).includes('anonymous'));
  await p.search({ ...args, page: 2 }); await p.search({ ...args, platform: 'aliyun' });
  assert.equal(calls.length, 2);
});

test('refreshes only the declared expired anonymous token once', async () => {
  let sessions = 0; let searches = 0;
  const p = provider(async url => {
    if (url.pathname.endsWith('/session')) { sessions++; return session(); }
    searches++;
    return searches === 1 ? Response.json({ code: 'TOKEN_REFRESH_REQUIRED' }, { status: 401 }) : stream(frame('done', {}));
  });
  const data = await p.search(args); assert.equal(data.items.length, 0);
  assert.equal(sessions, 2); assert.equal(searches, 2);
  let calls = 0;
  const bad = provider(async url => { calls++; return url.pathname.endsWith('/session') ? session() : Response.json({ code: 'FORBIDDEN' }, { status: 401 }); });
  await assert.rejects(bad.search(args), /拒绝/); assert.equal(calls, 2);
});

test('partial branches and truncated streams preserve usable results', async () => {
  for (const raw of [frame('item', item), frame('item', item) + 'event: line_error\ndata: invalid upstream diagnostic\n\n' + frame('done', {})]) {
    const p = provider(async url => url.pathname.endsWith('/session') ? session() : stream(raw));
    const result = await p.search(args); assert.equal(result.degraded, true); assert.equal(result.items.length, 1); assert.match(result.note, /已保留/);
  }
});

test('challenge pages, missing session, malformed and unfinished empty streams are errors', async () => {
  for (const response of [new Response('<html>challenge</html>'), stream(frame('meta', {})), stream('event: item\ndata: invalid\n\n'), stream(frame('line_error', {}) + frame('done', {}))]) {
    const p = provider(async url => url.pathname.endsWith('/session') ? session() : response);
    await assert.rejects(p.search(args), /轻搜搜|结果流/);
  }
  await assert.rejects(provider(async () => new Response('{}')).search(args), /匿名搜索会话/);
});

test('SSE handles UTF-8, CRLF boundaries, comments and multiline JSON across chunks', async () => {
  const bytes = new TextEncoder().encode(': heartbeat\r\n\r\nevent: item\r\ndata: {"title":\r\ndata: "中文"}\r\n\r\n');
  const body = new ReadableStream({ start(c) { for (const b of bytes) c.enqueue(new Uint8Array([b])); c.close(); } });
  const events = [];
  await consumeEvents(new Response(body), (event, value) => events.push([event, value]), UpstreamError);
  assert.deepEqual(events, [['item', { title: '中文' }]]);
});

test('bounded SSE cancels oversized responses and surfaces stream read errors', async () => {
  await assert.rejects(consumeEvents(stream('x'.repeat(4 * 1024 * 1024 + 1)), () => {}, UpstreamError), /过大/);
  const p = provider(async url => url.pathname.endsWith('/session') ? session() : new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(frame('item', item))); }, pull(c) { c.error(new Error('connection lost')); } }), { headers: { 'Content-Type': 'text/event-stream' } }));
  const data = await p.search(args); assert.equal(data.degraded, true); assert.equal(data.items.length, 1);
});
