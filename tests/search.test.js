import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../backend/app.js';
import { loadConfig } from '../backend/config.js';
import { createProviders, normalizeItem, UpstreamError } from '../backend/providers.js';
import { createSearchService } from '../backend/search.js';
import { safeShareUrl, mergeItems } from '../frontend/shared.js';

const config = () => loadConfig({});
const raw = (changes = {}) => ({ title: '公开学习资料', share_url: 'https://pan.quark.cn/s/example123', access_code: 'abcd', ...changes });
const source = { id: 'one', name: '来源一' };
const item = changes => normalizeItem(raw(changes), source);

async function app(t, options = {}) {
  const server = createApp({ config: config(), ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('share URLs reject unsafe protocols, credentials, lookalike hosts and non-share pages', () => {
  for (const url of ['javascript:alert(1)', 'http://pan.quark.cn/s/abc123', 'https://pan.quark.cn.evil.test/s/abc123', 'https://token@pan.quark.cn/s/abc123', 'https://pan.quark.cn:444/s/abc123', 'https://127.0.0.1/s/abc123', 'https://pan.quark.cn/']) assert.equal(safeShareUrl(url), null, url);
  assert.equal(safeShareUrl('https://www.alipan.com/s/AbC123?pwd=pass').password, 'pass');
  assert.equal(safeShareUrl('https://cloud.189.cn/web/share?code=AbC123').platform, 'tianyi');
});

test('deduplication merges password variants and preserves each provider reference', () => {
  const first = item({ access_code: '' });
  const second = normalizeItem(raw({ share_url: 'https://pan.quark.cn/s/example123?pwd=abcd' }), { id: 'two', name: '来源二' });
  const merged = mergeItems([first, second]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].password, 'abcd');
  assert.equal(merged[0].sources.length, 2);
  assert.equal(first.password, '', 'does not mutate the original cached item');
});

test('normalization identifies the actual URL platform and keeps unknown dates empty', () => {
  const normalized = item({ pan: 'baidu', title: '<b>学习资料</b>', published_at: 'bad date' });
  assert.equal(normalized.platform, 'quark');
  assert.equal(normalized.title, '学习资料');
  assert.equal(normalized.publishedAt, null);
  assert.equal(normalizeItem(raw({ share_url: 'https://ad.example/go' }), source), null);
});

test('query encoding, upstream shape validation, pagination and empty success', async () => {
  let received;
  const providers = createProviders(config(), async url => {
    received = new URL(url);
    return Response.json({ items: [], total: 0, totalPages: 1 });
  });
  const result = await providers[0].search({ query: 'C++ & 中文', platform: 'quark', page: 2, sort: 'hot' });
  assert.equal(received.searchParams.get('q'), 'C++ & 中文');
  assert.equal(received.searchParams.get('p'), '2');
  assert.equal(received.searchParams.get('pan'), 'quark');
  assert.equal(result.hasMore, false);
  const broken = createProviders(config(), async () => Response.json({ message: 'schema changed' }));
  await assert.rejects(broken[0].search({ query: 'test', platform: 'all', page: 1, sort: 'latest' }), /格式/);
});

test('upstream failures preserve successful providers and filter by actual disk type', async () => {
  const service = createSearchService([
    { ...source, enabled: true, search: async () => ({ items: [item(), item({ share_url: 'https://pan.baidu.com/s/baidu123' })], total: 2, hasMore: true }) },
    { id: 'two', name: '来源二', enabled: true, search: async () => { throw new UpstreamError('响应超时'); } }
  ], config());
  const result = await service.search(new URLSearchParams({ q: '学习', pan: 'quark' }));
  assert.equal(result.partial, true);
  assert.equal(result.failed, false);
  assert.equal(result.items.length, 1);
  assert.equal(result.sources[1].message, '响应超时');
});

test('cache coalesces concurrent identical requests and separates pages and platforms', async () => {
  let calls = 0;
  const service = createSearchService([{ ...source, enabled: true, search: async () => { calls++; await new Promise(r => setTimeout(r, 10)); return { items: [item()], total: 2, hasMore: true }; } }], config());
  await Promise.all([service.search(new URLSearchParams({ q: '学习' })), service.search(new URLSearchParams({ q: '学习' }))]);
  assert.equal(calls, 1);
  assert.equal((await service.search(new URLSearchParams({ q: '学习' }))).sources[0].cached, true);
  await service.search(new URLSearchParams({ q: '学习', page: '2' }));
  await service.search(new URLSearchParams({ q: '学习', pan: 'baidu' }));
  assert.equal(calls, 3);
});

test('failed calls are retryable and do not leak unexpected exception details', async () => {
  let calls = 0;
  const service = createSearchService([{ ...source, enabled: true, search: async () => { calls++; throw new Error('apikey=secret-token'); } }], config());
  const params = new URLSearchParams({ q: 'test' });
  const first = await service.search(params);
  await service.search(params);
  assert.equal(calls, 2);
  assert.equal(first.failed, true);
  assert.ok(!JSON.stringify(first).includes('secret-token'));
});

test('search validates query, pages, platforms and unavailable provider choices', async () => {
  const service = createSearchService([{ ...source, enabled: true }], config());
  for (const params of [{ q: '' }, { q: 'a'.repeat(61) }, { q: 'x', page: '1.5' }, { q: 'x', page: '51' }, { q: 'x', pan: 'constructor' }, { q: 'x', sources: 'missing' }, { q: 'x', sort: 'script' }]) await assert.rejects(service.search(new URLSearchParams(params)), error => error.status === 400);
});

test('health and sources expose configuration without exposing credentials', async t => {
  const base = await app(t, { config: loadConfig({ HAISOU_API_KEY: 'private-secret', PANSOU_TOKEN: 'another-secret', PANSOU_BASE_URL: 'http://localhost:8888' }) });
  assert.equal((await (await fetch(`${base}/api/health`)).json()).status, 'ok');
  const response = await fetch(`${base}/api/sources`);
  const text = await response.text();
  assert.ok(!text.includes('private-secret') && !text.includes('another-secret'));
  assert.equal(JSON.parse(text).checkingEnabled, true);
});

test('API distinguishes no results, all-provider failure and input errors', async t => {
  const base = await app(t, { providers: [{ ...source, enabled: true, search: async ({ query }) => {
    if (query === 'fail') throw new UpstreamError('来源不可用');
    return { items: [], total: 0, hasMore: false };
  } }] });
  assert.equal((await fetch(`${base}/api/search?q=none`)).status, 200);
  assert.equal((await fetch(`${base}/api/search?q=fail`)).status, 502);
  assert.equal((await fetch(`${base}/api/search?q=`)).status, 400);
  assert.equal((await fetch(`${base}/api/search`, { method: 'POST' })).status, 405);
});

test('HTTP rate limit has Retry-After, excludes health and bounds upstream calls', async t => {
  let calls = 0;
  const base = await app(t, { config: loadConfig({ RATE_LIMIT_PER_MINUTE: '1' }), providers: [{ ...source, enabled: true, search: async () => { calls++; return { items: [], total: 0, hasMore: false }; } }] });
  assert.equal((await fetch(`${base}/api/search?q=one`)).status, 200);
  const limited = await fetch(`${base}/api/search?q=two`);
  assert.equal(limited.status, 429); assert.ok(limited.headers.has('retry-after'));
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  assert.equal(calls, 1);
});

test('static routing never serves env, git files or traversal paths', async t => {
  const base = await app(t);
  for (const path of ['/.env', '/.git/config', '/backend/config.js', '/%2e%2e%2f.env']) assert.equal((await fetch(base + path)).status, 404);
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('content-security-policy').includes("script-src 'self'"));
  assert.ok((await response.text()).includes('盘觅'));
});

test('link checking rejects arbitrary URLs, does not claim timeout is invalid, and caches confirmed states', async () => {
  let calls = 0;
  let mode = 'unknown';
  const service = createSearchService([{ ...source, enabled: true, check: async () => { calls++; return { state: mode }; } }], config());
  await assert.rejects(service.check({ url: 'http://localhost:8888/private' }), error => error.status === 400);
  assert.equal(calls, 0);
  const body = { url: raw().share_url };
  assert.equal((await service.check(body)).state, 'unknown');
  mode = 'valid';
  assert.equal((await service.check(body)).state, 'valid');
  assert.equal((await service.check(body)).cached, true);
  assert.equal(calls, 2);
});

test('Haisou treats HTTP 200 with an API error as failure and normalizes its fields', async () => {
  const cfg = loadConfig({ HAISOU_API_KEY: 'test-key' });
  const errorProvider = createProviders(cfg, async () => Response.json({ code: 1005, credits: 0 }))[2];
  await assert.rejects(errorProvider.search({ query: 'test', platform: 'all', page: 1 }), /额度不足/);
  let request;
  const provider = createProviders(cfg, async (url, options) => { request = { url: new URL(url), body: JSON.parse(options.body) }; return Response.json({ code: 0, result: { items: [{ title: '公开资料', shareUrl: 'https://www.alipan.com/s/ali123', sharePwd: 'abcd' }], pagination: { total: 1, totalPages: 1 } } }); })[2];
  const result = await provider.search({ query: '资料', platform: 'aliyun', page: 1 });
  assert.equal(request.url.searchParams.get('apikey'), 'test-key');
  assert.deepEqual(request.body.platforms, ['ali']);
  assert.equal(result.items[0].password, 'abcd');
});

test('PanSou merged responses deduplicate across official domain aliases', async () => {
  const cfg = loadConfig({ PANSOU_BASE_URL: 'http://localhost:8888' });
  const provider = createProviders(cfg, async () => Response.json({ merged_by_type: { aliyun: [{ note: '公开资料', url: 'https://www.alipan.com/s/ali123' }, { note: '公开资料', url: 'https://www.aliyundrive.com/s/ali123' }] } }))[1];
  const service = createSearchService([provider], cfg);
  const result = await service.search(new URLSearchParams({ q: '资料' }));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].sources.length, 2);
  assert.equal(result.hasMore, false);
});
