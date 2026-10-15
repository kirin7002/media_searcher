import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../backend/app.js';
import { loadConfig } from '../backend/config.js';
import { createDiscoverService, dateWindow } from '../backend/discover.js';

const cfg = () => loadConfig({ TMDB_READ_ACCESS_TOKEN: 'test-token' });
const clock = () => new Date('2026-10-14T17:00:00Z');
const providerRows = [{ provider_id: 8, provider_name: 'Netflix' }, { provider_id: 119, provider_name: 'Amazon Prime Video' }, { provider_id: 15, provider_name: 'Hulu' }];
const row = (overrides = {}) => ({ id: 123, name: '测试新剧', original_name: 'Test Series', first_air_date: '2026-10-10', vote_average: 8.2, vote_count: 123, poster_path: '/poster123.jpg', overview: '这是测试数据。', ...overrides });

function mockFetch(onRequest = () => {}, results = [row()]) {
  return async (value, options) => {
    const url = new URL(value); onRequest(url, options);
    return url.pathname.includes('/watch/providers/') ? Response.json({ results: providerRows }) : Response.json({ results, total_results: results.length, total_pages: 2 });
  };
}

test('month and rolling dates use Shanghai calendar and exclude future dates', () => {
  assert.deepEqual(dateWindow('month', clock()), { from: '2026-10-01', to: '2026-10-15' });
  assert.deepEqual(dateWindow('30d', clock()), { from: '2026-09-16', to: '2026-10-15' });
  assert.deepEqual(dateWindow('30d', new Date('2026-03-01T00:00:00Z')), { from: '2026-01-31', to: '2026-03-01' });
});

test('longer ranges handle year boundaries and leap days without future dates', () => {
  assert.deepEqual(dateWindow('90d', clock()), { from: '2026-07-18', to: '2026-10-15' });
  assert.deepEqual(dateWindow('180d', clock()), { from: '2026-04-19', to: '2026-10-15' });
  assert.deepEqual(dateWindow('365d', clock()), { from: '2025-10-16', to: '2026-10-15' });
  assert.deepEqual(dateWindow('3y', clock()), { from: '2023-10-15', to: '2026-10-15' });
  assert.deepEqual(dateWindow('3y', new Date('2024-02-29T00:00:00Z')), { from: '2021-02-28', to: '2024-02-29' });
  assert.deepEqual(dateWindow('all', clock()), { from: null, to: '2026-10-15' });
});

test('custom range validates real calendar dates, order, missing start and future end', () => {
  assert.deepEqual(dateWindow('custom', clock(), 'Asia/Shanghai', { from: '2020-02-29', to: '2026-10-01' }), { from: '2020-02-29', to: '2026-10-01' });
  for (const custom of [{ from: '2026-02-30' }, { from: 'bad' }, { from: '' }, { from: '2026-10-10', to: '2026-10-09' }, { from: '2026-10-01', to: '2026-10-16' }]) assert.throws(() => dateWindow('custom', clock(), 'Asia/Shanghai', custom), error => error.status === 400);
});

test('defaults truly browse globally with unrestricted vote count, without a hidden US catalog', async () => {
  const requests = [];
  const service = createDiscoverService(cfg(), mockFetch(url => requests.push(url)), clock);
  const result = await service.discover(new URLSearchParams());
  const request = requests.at(-1);
  assert.equal(result.region, 'all');
  assert.equal(request.searchParams.get('vote_count.gte'), '0');
  for (const key of ['watch_region', 'with_watch_providers', 'with_watch_monetization_types']) assert.equal(request.searchParams.has(key), false, key);
  assert.equal(requests[0].searchParams.has('watch_region'), false);
});

test('global region never silently ignores an explicitly selected streaming platform', async () => {
  let calls = 0;
  const service = createDiscoverService(cfg(), async () => { calls++; throw new Error(); }, clock);
  await assert.rejects(service.discover(new URLSearchParams({ platform: 'netflix' })), error => error.status === 400 && error.message.includes('具体片库地区'));
  assert.equal(calls, 0);
});

test('anime series, anime films and variety use the correct API families and genre filters', async () => {
  for (const [type, mediaType, genres, name] of [['anime', 'tv', '16', '动漫剧集'], ['anime_movie', 'movie', '16', '动漫电影'], ['variety', 'tv', '10764|10767', '综艺']]) {
    const requests = [];
    const service = createDiscoverService(cfg(), mockFetch(url => requests.push(url), [row({ title: '测试作品', release_date: '2026-10-10', genre_ids: genres.split('|').map(Number) })]), clock);
    const result = await service.discover(new URLSearchParams({ type, period: '90d' }));
    const request = requests.at(-1);
    assert.equal(request.pathname, `/3/discover/${mediaType}`);
    assert.equal(request.searchParams.get('with_genres'), genres);
    assert.equal(requests[0].pathname, `/3/watch/providers/${mediaType}`);
    assert.equal(result.items[0].categoryName, name);
    assert.equal(result.items[0].category, type);
    assert.equal(result.items[0].type, mediaType);
    assert.equal(result.items[0].tmdbUrl, `https://www.themoviedb.org/${mediaType}/123`);
  }
});

test('all-time queries omit the lower bound and custom dates reach the actual API', async () => {
  const requests = [];
  const service = createDiscoverService(cfg(), mockFetch(url => requests.push(url)), clock);
  const all = await service.discover(new URLSearchParams({ period: 'all' }));
  assert.equal(all.range.from, null);
  assert.equal(requests.at(-1).searchParams.has('first_air_date.gte'), false);
  assert.equal(requests.at(-1).searchParams.get('first_air_date.lte'), '2026-10-15');
  await service.discover(new URLSearchParams({ period: 'custom', from: '2024-01-01', to: '2026-10-01' }));
  assert.equal(requests.at(-1).searchParams.get('first_air_date.gte'), '2024-01-01');
  assert.equal(requests.at(-1).searchParams.get('first_air_date.lte'), '2026-10-01');
});

test('unconfigured metadata never contacts upstream or fabricates titles', async () => {
  let calls = 0;
  const service = createDiscoverService(loadConfig({}), async () => { calls++; throw new Error(); });
  assert.equal(service.config().enabled, false);
  await assert.rejects(service.discover(new URLSearchParams()), error => error.status === 503);
  assert.equal(calls, 0);
});

test('movie discovery resolves provider IDs and sends date, region, score and pagination filters', async () => {
  const requests = [];
  const service = createDiscoverService(cfg(), mockFetch((url, options) => requests.push({ url, options }), [row({ title: '测试电影', release_date: '2026-10-12' })]), clock);
  const data = await service.discover(new URLSearchParams({ type: 'movie', platform: 'prime', region: 'US', period: 'month', sort: 'rating', page: '2', minVotes: '100' }));
  const request = requests[1];
  assert.equal(request.url.pathname, '/3/discover/movie');
  for (const [key, value] of Object.entries({ with_watch_providers: '119', watch_region: 'US', 'primary_release_date.gte': '2026-10-01', 'primary_release_date.lte': '2026-10-15', sort_by: 'vote_average.desc', 'vote_count.gte': '100', page: '2', with_watch_monetization_types: 'flatrate' })) assert.equal(request.url.searchParams.get(key), value, key);
  assert.equal(request.options.headers.Authorization, 'Bearer test-token');
  assert.equal(data.items[0].ratingSource, 'TMDb');
  assert.equal(data.items[0].title, '测试电影');
  assert.equal(data.items[0].tmdbUrl, 'https://www.themoviedb.org/movie/123');
});

test('TV newest ordering uses first air date and ORs provider IDs for all platforms', async () => {
  let last;
  const service = createDiscoverService(cfg(), mockFetch(url => { last = url; }), clock);
  const data = await service.discover(new URLSearchParams({ type: 'tv', region: 'US', sort: 'newest', period: '30d' }));
  assert.equal(last.searchParams.get('sort_by'), 'first_air_date.desc');
  assert.equal(last.searchParams.get('first_air_date.gte'), '2026-09-16');
  assert.equal(last.searchParams.get('with_watch_providers'), '8|15|119');
  assert.equal(data.items[0].originalTitle, 'Test Series');
});

test('unknown ratings remain null, future releases and unsafe poster paths are excluded', async () => {
  const service = createDiscoverService(cfg(), mockFetch(() => {}, [row({ vote_count: 0, poster_path: '//evil.example/p.jpg' }), row({ id: 456, first_air_date: '2026-10-30' })]), clock);
  const data = await service.discover(new URLSearchParams({ minVotes: '0' }));
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].rating, null);
  assert.equal(data.items[0].posterUrl, null);
});

test('unavailable platform does not broaden the search to another platform', async () => {
  let calls = 0;
  const service = createDiscoverService(cfg(), mockFetch(() => calls++), clock);
  const data = await service.discover(new URLSearchParams({ platform: 'peacock', region: 'US' }));
  assert.equal(data.items.length, 0);
  assert.equal(calls, 1, 'only provider catalog was queried');
  assert.match(data.reason, /没有可用/);
});

test('discovery cache separates regions and filters, and coalesces identical requests', async () => {
  let calls = 0;
  const service = createDiscoverService(cfg(), mockFetch(() => calls++), clock);
  await Promise.all([service.discover(new URLSearchParams()), service.discover(new URLSearchParams())]);
  assert.equal(calls, 2);
  await service.discover(new URLSearchParams({ region: 'JP' }));
  assert.equal(calls, 4);
  await service.discover(new URLSearchParams({ sort: 'newest' }));
  assert.equal(calls, 5);
});

test('discovery rejects unsupported input before any upstream call', async () => {
  const service = createDiscoverService(cfg(), async () => { throw new Error('should not run'); });
  for (const params of [{ region: 'XX' }, { type: 'person' }, { platform: 'constructor' }, { period: 'year' }, { sort: 'imdb' }, { page: '51' }, { minVotes: '-1' }]) await assert.rejects(service.discover(new URLSearchParams(params)), error => error.status === 400);
});

test('metadata HTTP API hides tokens, serves the page module, and returns missing configuration explicitly', async t => {
  const server = createApp({ config: loadConfig({ TMDB_READ_ACCESS_TOKEN: '' }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const configResponse = await (await fetch(`${base}/api/discover/config`)).json();
  assert.equal(configResponse.enabled, false);
  assert.equal(configResponse.platforms.length, 8);
  assert.equal((await fetch(`${base}/api/discover`)).status, 503);
  assert.equal((await fetch(`${base}/discover.js`)).status, 200);
  const page = await (await fetch(base)).text();
  assert.ok(page.includes('id="discover-view"'));
});

test('upstream authentication errors are retryable and token details are redacted', async () => {
  let calls = 0;
  const service = createDiscoverService(cfg(), async () => { calls++; return new Response('test-token', { status: 401 }); }, clock);
  for (let i = 0; i < 2; i++) await assert.rejects(service.discover(new URLSearchParams()), error => !error.message.includes('test-token') && error.message.includes('401'));
  assert.equal(calls, 2);
});
