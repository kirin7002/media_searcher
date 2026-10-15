import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../backend/config.js';
import { createProviders, requestJson } from '../backend/providers.js';
import { createSearchService } from '../backend/search.js';
import { createApp } from '../backend/app.js';

const config = () => loadConfig({ QILING_API_TOKEN: 'private-test-token' });
const args = changes => ({ query: '吴京', platform: 'all', page: 1, sort: 'latest', ...changes });
const provider = fetchImpl => createProviders(config(), fetchImpl).find(p => p.id === 'qiling');

test('Qiling is opt-in, has its own timeout, and respects disabled source configuration', () => {
  assert.equal(createProviders(loadConfig({})).find(p => p.id === 'qiling').enabled, false);
  assert.equal(config().qilingTimeoutMs, 20000);
  assert.equal(createProviders(loadConfig({ QILING_API_TOKEN: 'test', DISABLED_SOURCES: 'qiling' })).find(p => p.id === 'qiling').enabled, false);
  assert.throws(() => loadConfig({ QILING_TIMEOUT_MS: '0' }));
});

test('Qiling uses header authentication, encodes search text, and trusts actual share hosts', async () => {
  let received;
  const source = provider(async (url, options) => {
    received = { url: new URL(url), options };
    return Response.json({ code: 200, data: [
      { name: '<b>公开资料</b>', url: 'https://www.alipan.com/s/qiling123?pwd=abcd', disk: 2, type: 0 },
      { name: '不可信链接', url: 'https://example.com/s/other123', disk: 1 },
      { name: '脚本链接', url: 'javascript:alert(1)' }
    ] });
  });
  const data = await source.search(args({ query: 'C++ & 中文' }));
  assert.equal(received.url.origin, 'https://api.istero.com');
  assert.equal(received.url.pathname, '/resource/v1/disk/source/search');
  assert.equal(received.url.searchParams.get('keywords'), 'C++ & 中文');
  assert.equal(received.url.searchParams.has('token'), false);
  assert.equal(received.url.href.includes('private-test-token'), false);
  assert.equal(received.options.headers.Authorization, 'Bearer private-test-token');
  assert.equal(received.url.searchParams.has('disk'), false);
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].title, '公开资料');
  assert.equal(data.items[0].platform, 'aliyun');
  assert.equal(data.items[0].password, 'abcd');
  assert.equal(data.items[0].publishedAt, null);
  assert.equal(data.hasMore, false);
  assert.equal(source.supportsPagination, false);
});

test('Qiling maps all four disk filters including zero without extra page requests', async () => {
  let calls = 0;
  const source = provider(async url => {
    assert.equal(new URL(url).searchParams.get('disk'), String(calls++));
    return Response.json({ code: 200, data: [] });
  });
  for (const platform of ['aliyun', 'quark', 'baidu', 'xunlei']) await source.search(args({ platform }));
  assert.equal(calls, 4);
  assert.equal((await source.search(args({ page: 2 }))).items.length, 0);
  assert.equal((await source.search(args({ platform: '115' }))).items.length, 0);
  assert.equal(calls, 4);
});

test('Qiling treats only the documented no-result HTTP 400 payload as an empty search', async () => {
  const source = provider(async () => Response.json({ code: 400, data: '', message: '未找到相关网盘资源' }, { status: 400 }));
  const data = await source.search(args());
  assert.equal(data.total, 0);
  assert.equal(data.items.length, 0);
  const invalid = provider(async () => Response.json({ code: 400, data: '', message: '参数错误' }, { status: 400 }));
  await assert.rejects(invalid.search(args()), /拒绝了查询参数/);
  const malformed = provider(async () => new Response('<html>blocked</html>', { status: 400 }));
  await assert.rejects(malformed.search(args()), /有效的 JSON/);
});

test('Qiling quota, authorization, rate and schema failures remain errors without leaking credentials', async () => {
  for (const [status, code, pattern] of [[200, 202, /额度不足/], [403, 403, /鉴权失败/], [429, 429, /频率受限/]]) {
    const source = provider(async () => Response.json({ code, message: 'private-test-token', data: '' }, { status }));
    await assert.rejects(source.search(args()), error => pattern.test(error.message) && !error.message.includes('private-test-token'));
  }
  await assert.rejects(provider(async () => Response.json({ code: 200, data: {} })).search(args()), /格式发生变化/);
  await assert.rejects(requestJson(async () => Response.json({ code: 400 }, { status: 400 }), new URL('https://example.com'), {}, 1000), /HTTP 400/);
});

test('Qiling results participate in cross-source deduplication', async () => {
  const source = provider(async () => Response.json({ code: 200, data: [
    { name: '公开资料', url: 'https://www.alipan.com/s/qiling123' },
    { name: '公开资料', url: 'https://www.aliyundrive.com/s/qiling123?pwd=abcd' }
  ] }));
  const service = createSearchService([source], config());
  const result = await service.search(new URLSearchParams({ q: '资料', sources: 'qiling' }));
  assert.equal(result.failed, false);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].password, 'abcd');
  assert.equal(result.sources[0].totalType, 'records');
});

test('Qiling configuration status and public search responses never expose its token', async t => {
  const server = createApp({ config: config(), fetchImpl: async () => Response.json({ code: 200, data: [] }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/api/health', '/api/sources', '/api/search?q=test&sources=qiling']) {
    const response = await fetch(base + path);
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.equal(text.includes('private-test-token'), false);
    if (path === '/api/sources') assert.equal(JSON.parse(text).sources.find(p => p.id === 'qiling').enabled, true);
  }
});
