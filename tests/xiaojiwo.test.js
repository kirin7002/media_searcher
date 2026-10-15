import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviders } from '../backend/providers.js';
import { loadConfig } from '../backend/config.js';
const args = { query: 'Python & 中文', platform: 'all', page: 1 };
const row = (title, url) => `data: ${JSON.stringify({ title, url })}\n\n`;
const stream = raw => new Response(raw, { headers: { 'Content-Type': 'text/event-stream;charset=UTF-8' } });
const provider = f => createProviders(loadConfig({ TELEGRAM_CHANNELS: '' }), f).find(p => p.id === 'xiaojiwo');

test('public stream resolves opaque addresses with the normal site action and retains provenance', async () => {
  const calls = [];
  const p = provider(async (url, options) => {
    calls.push(url);
    if (url.pathname.endsWith('/web_search')) {
      assert.equal(url.searchParams.get('title'), args.query); assert.equal(options.redirect, 'error');
      return stream(row('Python 中文', '/opaque+token=') + 'data: [DONE]\n\n');
    }
    assert.equal(url.pathname, '/api/other/save_url');
    assert.deepEqual(JSON.parse(options.body), { url: '%2Fopaque%2Btoken%3D', title: 'Python 中文' });
    return Response.json({ code: 200, data: { url: 'https://pan.quark.cn/s/valid123?pwd=abcd' } });
  });
  const data = await p.search(args); assert.equal(data.items.length, 1); assert.equal(data.degraded, false);
  assert.equal(data.items[0].password, 'abcd'); assert.equal(data.items[0].linkState, 'unchecked'); assert.equal(data.items[0].publishedAt, null);
  assert.ok(data.items[0].sources[0].pageUrl.includes('/s/Python%20%26%20'));
  await p.search({ ...args, page: 2 }); assert.equal(calls.length, 2);
});

test('bounds resolution to six unique rows with at most two concurrent requests', async () => {
  let requests = 0; let active = 0; let max = 0;
  const p = provider(async url => {
    if (url.pathname.endsWith('/web_search')) return stream(Array.from({ length: 15 }, (_, i) => row(`教程${i}`, `/token${i}`)).join(''));
    requests++; active++; max = Math.max(max, active);
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
    return Response.json({ code: 200, data: { url: `https://pan.quark.cn/s/test${requests}` } });
  });
  const data = await p.search(args); assert.equal(requests, 6); assert.ok(max <= 2); assert.equal(data.degraded, false); assert.equal(data.hasMore, false);
});

test('retains successful shares if stream truncates or another resolution fails', async () => {
  const p = provider(async url => url.pathname.endsWith('/web_search') ? stream(row('教程', 'https://pan.quark.cn/s/valid123') + row('其他', '/fail')) : Response.json({ code: 403, message: '拒绝' }));
  const data = await p.search(args); assert.equal(data.degraded, true); assert.equal(data.items.length, 1);
  assert.match(data.note, /部分/);
});

test('empty completion is valid but challenge, unfinished empty stream and unusable URLs fail', async () => {
  assert.equal((await provider(async () => stream('data: [DONE]\n\n')).search(args)).items.length, 0);
  for (const response of [new Response('<html>blocked</html>'), stream('线路：失败\n\n'), stream(row('广告', 'https://evil.test/') + 'data: [DONE]\n\n')]) await assert.rejects(provider(async () => response).search(args), /小鸡窝/);
});

test('platform filters use the exact types exposed by the current site', async () => {
  const types = [];
  const p = provider(async url => { types.push(url.searchParams.get('is_type')); return stream('data: [DONE]\n\n'); });
  for (const platform of ['all', 'quark', 'baidu', 'uc', 'xunlei', 'aliyun']) await p.search({ ...args, platform });
  assert.deepEqual(types, ['0', '0', '2', '3', '4']);
});
