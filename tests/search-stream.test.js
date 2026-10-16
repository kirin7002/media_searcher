import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../backend/app.js';
import { loadConfig } from '../backend/config.js';
import { createSearchService } from '../backend/search.js';
import { normalizeItem, UpstreamError, createProviders, relevantHaisouItems } from '../backend/providers.js';
import { readSearchStream } from '../frontend/search-stream.js';

const config = () => loadConfig({});
const raw = (title, id = 'example123') => ({ title, url: `https://pan.quark.cn/s/${id}` });
const source = id => ({ id, name: id, enabled: true });
const item = (id, title = '白夜追凶') => normalizeItem(raw(title), source(id));
const batch = items => ({ items, total: items.length, hasMore: false });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('fast results arrive before a slow source finishes and a timeout preserves them', async () => {
  const slow = deferred();
  const early = deferred();
  const updates = [];
  const service = createSearchService([
    { ...source('slow'), search: async () => { await slow.promise; throw new UpstreamError('来源响应超时'); } },
    { ...source('fast'), search: async () => batch([item('fast')]) }
  ], config());
  const task = service.search(new URLSearchParams({ q: '白夜追凶' }), { onUpdate: data => {
    updates.push(data);
    if (data.items.length) early.resolve(data);
  } });
  const first = await early.promise;
  assert.equal(first.pending, 1);
  assert.equal(first.done, false);
  assert.equal(first.failed, false);
  assert.equal(first.sources[0].state, 'pending');
  slow.resolve();
  const final = await task;
  assert.equal(final.done, true);
  assert.equal(final.pending, 0);
  assert.equal(final.partial, true);
  assert.equal(final.items.length, 1);
  assert.equal(updates.at(-1).sources[0].message, '来源响应超时');
});

test('stream and JSON clients share pending work, merge provenance, and reuse successful cache', async () => {
  const gate = deferred(); let calls = 0;
  const service = createSearchService(['one', 'two'].map(id => ({ ...source(id), search: async () => {
    calls++; await gate.promise; return batch([item(id)]);
  } })), config());
  const params = new URLSearchParams({ q: '白夜追凶' });
  const streaming = service.search(params, { onUpdate() {} });
  const json = service.search(params);
  gate.resolve();
  for (const result of await Promise.all([streaming, json])) {
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].sources.length, 2);
  }
  assert.equal(calls, 2);
  const cached = await service.search(params);
  assert.ok(cached.sources.every(s => s.cached));
  assert.equal(calls, 2);
});

test('later sources append distinct links without moving the first batch', async () => {
  const slow = deferred(); const first = deferred();
  const slowItem = normalizeItem(raw('白夜追凶 第二季', 'second123'), source('slow'));
  const service = createSearchService([
    { ...source('slow'), search: async () => { await slow.promise; return batch([slowItem]); } },
    { ...source('fast'), search: async () => batch([item('fast')]) }
  ], config());
  const task = service.search(new URLSearchParams({ q: '白夜追凶' }), { onUpdate: data => { if (data.items.length) first.resolve(data); } });
  const initial = await first.promise;
  slow.resolve();
  const final = await task;
  assert.deepEqual(initial.items.map(i => i.id), ['quark:example123']);
  assert.deepEqual(final.items.map(i => i.id), ['quark:example123', 'quark:second123']);
  assert.equal(final.partial, false);
});

test('HTTP streaming delivers actual bytes before the slow provider is released', async t => {
  const slow = deferred(); t.after(() => slow.resolve());
  const server = createApp({ config: config(), providers: [
    { ...source('slow'), search: async () => { await slow.promise; return batch([item('slow')]); } },
    { ...source('fast'), search: async () => batch([item('fast')]) }
  ] });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const invalid = await fetch(`${base}/api/search/stream?q=`);
  assert.equal(invalid.status, 400);
  assert.match(invalid.headers.get('content-type'), /application\/json/);
  assert.equal((await fetch(`${base}/api/search/stream?q=x`, { method: 'POST' })).status, 405);
  const response = await fetch(`${base}/api/search/stream?q=白夜追凶`);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  assert.match(response.headers.get('cache-control'), /no-transform/);
  const early = deferred(); const updates = [];
  const reading = readSearchStream(response, data => { updates.push(data); if (data.items.length) early.resolve(data); });
  const first = await early.promise;
  assert.equal(first.pending, 1);
  assert.equal(first.items[0].sources[0].id, 'fast');
  slow.resolve();
  const result = await reading;
  assert.equal(result.items[0].sources.length, 2);
  assert.equal(updates.at(-1).done, true);
  assert.equal((await fetch(`${base}/search-stream.js`)).status, 200);
});

function streamResponse(frames, split = 7) {
  const bytes = new TextEncoder().encode(frames.map(f => typeof f === 'string' ? f : JSON.stringify(f)).join('\r\n'));
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.slice(i, i + split));
    controller.close();
  } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
}

test('browser decoder handles UTF-8 split across chunks, heartbeats and final frames without newline', async () => {
  const updates = [];
  const value = item('one');
  const result = await readSearchStream(streamResponse([
    { type: 'ping' }, { type: 'progress', items: [value], sources: [], pending: 1 },
    { type: 'done', items: [value], sources: [], pending: 0 }
  ], 1), data => updates.push(data));
  assert.equal(updates.length, 2);
  assert.equal(result.items[0].title, '白夜追凶');
  assert.equal(updates[0].done, false);
  assert.equal(result.done, true);
});

test('interrupted/invalid streams keep delivered updates and never claim completion', async () => {
  const updates = [];
  await assert.rejects(readSearchStream(streamResponse([{ type: 'progress', items: [item('one')], sources: [] }]), data => updates.push(data)), /未完成/);
  assert.equal(updates.length, 1);
  await assert.rejects(readSearchStream(streamResponse(['not-json']), () => {}));
  await assert.rejects(readSearchStream(streamResponse([{ type: 'error', error: '连接已关闭' }]), () => {}), /连接已关闭/);
  await assert.rejects(readSearchStream(new Response(JSON.stringify({ error: '请求较多' }), { status: 429 }), () => {}), /请求较多/);
  await assert.rejects(readSearchStream(streamResponse(['x'.repeat(2 * 1024 * 1024 + 1)], 100000), () => {}), /过大/);
});

test('all failing sources finish explicitly without reporting pending work as failure or leaking errors', async () => {
  const updates = [];
  const service = createSearchService([{ ...source('bad'), search: async () => { throw new Error('private-secret'); } }], config());
  const final = await service.search(new URLSearchParams({ q: 'test' }), { onUpdate: data => updates.push(data) });
  assert.equal(updates[0].failed, false);
  assert.equal(final.failed, true);
  assert.equal(final.done, true);
  assert.equal(final.pending, 0);
  assert.equal(final.items.length, 0);
  assert.ok(!JSON.stringify(updates).includes('private-secret'));
});

test('Haisou ranks exact titles first, requires all query terms and deduplicates before the 12-link limit', () => {
  const rows = [raw('无关内容', 'duplicate'), ...Array.from({ length: 30 }, (_, i) => raw(`白夜追凶 高清版 ${i}`, `share${i}`)),
    raw('白夜追凶', 'duplicate'), raw('白夜追凶', 'exact123'), raw('白夜电影', 'other123')];
  const result = relevantHaisouItems(rows.map(r => normalizeItem(r, source('haisou'))), '白夜 追凶');
  assert.equal(result.length, 12);
  assert.equal(result[0].title, '白夜追凶');
  assert.equal(new Set(result.map(row => row.id)).size, 12);
  assert.ok(result.every(row => row.title.includes('白夜追凶')));
  assert.equal(relevantHaisouItems([normalizeItem(raw('Python'), source('haisou'))], 'Python 教程').length, 0);
  assert.equal(relevantHaisouItems([normalizeItem(raw('Ｃ＋＋ 教程'), source('haisou'))], 'c++').length, 1);
});

test('Haisou reports only retained links and does not fetch unneeded later pages', async () => {
  let calls = 0;
  const cfg = loadConfig({ HAISOU_API_KEY: 'test-key' });
  const provider = createProviders(cfg, async () => {
    calls++;
    return Response.json({ code: 0, result: { items: Array.from({ length: 30 }, (_, i) => raw(`白夜追凶 ${i}`, `share${i}`)), pagination: { total: 50000, totalPages: 2000 } } });
  }).find(p => p.id === 'haisou');
  const result = await provider.search({ query: '白夜追凶', platform: 'all', page: 1 });
  assert.equal(result.items.length, 12);
  assert.equal(result.total, 12);
  assert.equal(result.totalType, 'selected');
  assert.equal(result.hasMore, false);
  assert.equal(provider.supportsPagination, false);
  assert.deepEqual((await provider.search({ query: '白夜追凶', platform: 'all', page: 2 })).items, []);
  assert.equal(calls, 1);
});
