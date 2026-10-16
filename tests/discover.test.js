import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../backend/app.js';
import { loadConfig } from '../backend/config.js';
import { createDiscoverService, dateWindow } from '../backend/discover.js';

const cfg = () => loadConfig({ TMDB_READ_ACCESS_TOKEN: 'test-token' });
const query = (values = {}) => new URLSearchParams({ minVotes: '0', ...values });
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

test('explicit unrestricted voting browses globally without a hidden US catalog', async () => {
  const requests = [];
  const service = createDiscoverService(cfg(), mockFetch(url => requests.push(url)), clock);
  const result = await service.discover(query());
  const request = requests.at(-1);
  assert.equal(result.region, 'all');
  assert.equal(request.searchParams.get('vote_count.gte'), '0');
  for (const key of ['watch_region', 'with_watch_providers', 'with_watch_monetization_types']) assert.equal(request.searchParams.has(key), false, key);
  assert.equal(requests[0].searchParams.has('watch_region'), false);
});

test('platform browsing without a region queries supported regional catalogs and deduplicates titles', async () => {
  const requests = [];
  const service = createDiscoverService(cfg(), async value => {
    const url = new URL(value); requests.push(url);
    const region = url.searchParams.get('watch_region');
    if (url.pathname.includes('/watch/providers/')) return Response.json({ results: [{ provider_id: region === 'JP' ? 175 : 8, provider_name: 'Netflix' }] });
    assert.equal(url.searchParams.get('with_watch_providers'), region === 'JP' ? '175' : '8');
    assert.equal(url.searchParams.get('with_watch_monetization_types'), 'flatrate');
    const results = [row(), ...(region === 'JP' ? [row({ id: 456, name: '日本独有作品', vote_average: 9 })] : [])];
    return Response.json({ results, total_results: results.length, total_pages: 2 });
  }, clock);
  const result = await service.discover(query({ platform: 'netflix' }));
  assert.equal(result.region, 'all');
  assert.equal(result.regionMode, 'combined');
  assert.deepEqual(result.items.map(item => item.id), ['tv:456', 'tv:123']);
  assert.equal(result.items.find(item => item.id === 'tv:123').catalogRegions.length, 8);
  assert.deepEqual(result.items.find(item => item.id === 'tv:456').catalogRegions, ['JP']);
  assert.deepEqual(new Set(requests.filter(url => url.pathname.includes('/discover/')).map(url => url.searchParams.get('watch_region'))), new Set(['US', 'GB', 'JP', 'KR', 'HK', 'TW', 'CA', 'AU']));
  assert.equal(result.total, 9);
  assert.equal(result.totalType, 'regional_sum');
  assert.equal(result.partial, false);
  assert.equal(result.hasMore, true);
});

test('anime series, anime films and variety use the correct API families and genre filters', async () => {
  for (const [type, mediaType, genres, name] of [['anime', 'tv', '16', '动漫剧集'], ['anime_movie', 'movie', '16', '动漫电影'], ['variety', 'tv', '10764|10767', '综艺']]) {
    const requests = [];
    const service = createDiscoverService(cfg(), mockFetch(url => requests.push(url), [row({ title: '测试作品', release_date: '2026-10-10', genre_ids: genres.split('|').map(Number) })]), clock);
    const result = await service.discover(query({ type, period: '90d' }));
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
  const all = await service.discover(query({ period: 'all' }));
  assert.equal(all.range.from, null);
  assert.equal(requests.at(-1).searchParams.has('first_air_date.gte'), false);
  assert.equal(requests.at(-1).searchParams.get('first_air_date.lte'), '2026-10-15');
  await service.discover(query({ period: 'custom', from: '2024-01-01', to: '2026-10-01' }));
  assert.equal(requests.at(-1).searchParams.get('first_air_date.gte'), '2024-01-01');
  assert.equal(requests.at(-1).searchParams.get('first_air_date.lte'), '2026-10-01');
});

test('unconfigured metadata never contacts upstream or fabricates titles', async () => {
  let calls = 0;
  const service = createDiscoverService(loadConfig({}), async () => { calls++; throw new Error(); });
  assert.equal(service.config().enabled, false);
  await assert.rejects(service.discover(query()), error => error.status === 503);
  assert.equal(calls, 0);
});

test('movie discovery resolves provider IDs and sends date, region, score and pagination filters', async () => {
  const requests = [];
  const service = createDiscoverService(cfg(), mockFetch((url, options) => requests.push({ url, options }), [row({ title: '测试电影', release_date: '2026-10-12' })]), clock);
  const data = await service.discover(query({ type: 'movie', platform: 'prime', region: 'US', period: 'month', sort: 'rating', page: '2', minVotes: '100' }));
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
  const data = await service.discover(query({ type: 'tv', region: 'US', sort: 'newest', period: '30d' }));
  assert.equal(last.searchParams.get('sort_by'), 'first_air_date.desc');
  assert.equal(last.searchParams.get('first_air_date.gte'), '2026-09-16');
  assert.equal(last.searchParams.get('with_watch_providers'), '8|15|119');
  assert.equal(data.items[0].originalTitle, 'Test Series');
});

test('unknown ratings remain null, future releases and unsafe poster paths are excluded', async () => {
  const service = createDiscoverService(cfg(), mockFetch(() => {}, [row({ vote_count: 0, poster_path: '//evil.example/p.jpg' }), row({ id: 456, first_air_date: '2026-10-30' })]), clock);
  const data = await service.discover(query({ minVotes: '0' }));
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].rating, null);
  assert.equal(data.items[0].posterUrl, null);
});

test('unavailable platform does not broaden the search to another platform', async () => {
  let calls = 0;
  const service = createDiscoverService(cfg(), mockFetch(() => calls++), clock);
  const data = await service.discover(query({ platform: 'peacock', region: 'US' }));
  assert.equal(data.items.length, 0);
  assert.equal(calls, 1, 'only provider catalog was queried');
  assert.match(data.reason, /没有可用/);
});

test('discovery cache separates regions and filters, and coalesces identical requests', async () => {
  let calls = 0;
  const service = createDiscoverService(cfg(), mockFetch(() => calls++), clock);
  await Promise.all([service.discover(query()), service.discover(query())]);
  assert.equal(calls, 2);
  await service.discover(query({ region: 'JP' }));
  assert.equal(calls, 4);
  await service.discover(query({ sort: 'newest' }));
  assert.equal(calls, 5);
});

test('discovery rejects unsupported input before any upstream call', async () => {
  const service = createDiscoverService(cfg(), async () => { throw new Error('should not run'); });
  for (const params of [{ region: 'XX' }, { type: 'person' }, { platform: 'constructor' }, { period: 'year' }, { sort: 'imdb' }, { page: '51' }, { minVotes: '-1' }]) await assert.rejects(service.discover(query(params)), error => error.status === 400);
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
  for (let i = 0; i < 2; i++) await assert.rejects(service.discover(query()), error => !error.message.includes('test-token') && error.message.includes('401'));
  assert.equal(calls, 2);
});

test('rating threshold and ascending ordering reach TMDb; invalid thresholds never query upstream', async () => {
  const requests = [];
  const service = createDiscoverService(cfg(), mockFetch(url => requests.push(url)), clock);
  await service.discover(query({ minRating: '7.5', sort: 'rating_asc' }));
  assert.equal(requests.at(-1).searchParams.get('vote_average.gte'), '7.5');
  assert.equal(requests.at(-1).searchParams.get('sort_by'), 'vote_average.asc');
  for (const minRating of ['-1', '11', 'Infinity', 'NaN', '7;drop', '1e1']) {
    const count = requests.length;
    await assert.rejects(service.discover(query({ minRating })), error => error.status === 400);
    assert.equal(requests.length, count);
  }
});

test('backdrop URLs are allowlisted independently from poster paths', async () => {
  const service = createDiscoverService(cfg(), mockFetch(() => {}, [row({ backdrop_path: '/wide123.jpg' }), row({ id: 124, backdrop_path: '//evil.example/a.jpg' })]), clock);
  const result = await service.discover(query());
  assert.equal(result.items[0].backdropUrl, 'https://image.tmdb.org/t/p/w1280/wide123.jpg');
  assert.equal(result.items[1].backdropUrl, null);
});

test('home uses actual weekly trends, excludes people/adult/future titles and coalesces requests', async () => {
  const requests = [];
  const upstream = mockFetch(url => requests.push(url));
  const service = createDiscoverService(cfg(), async (value, options) => {
    const url = new URL(value);
    if (url.pathname.includes('/trending/')) {
      requests.push(url);
      return Response.json({ results: [
        row({ media_type: 'tv', backdrop_path: '/wide.jpg' }),
        row({ id: 234, media_type: 'person' }), row({ id: 345, media_type: 'movie', release_date: '2026-11-01' }),
        row({ id: 456, media_type: 'tv', adult: true }), row({ id: -1, media_type: 'tv' })
      ] });
    }
    return upstream(value, options);
  }, clock);
  const [result, again] = await Promise.all([service.home(), service.home()]);
  assert.equal(result.trendSource, 'TMDb 本周趋势');
  assert.deepEqual(result.trending.map(item => item.id), ['tv:123']);
  assert.equal(result.featured[0].backdropUrl, 'https://image.tmdb.org/t/p/w1280/wide.jpg');
  assert.equal(result.partial, false);
  assert.deepEqual(again, result);
  assert.equal(requests.filter(url => url.pathname === '/3/trending/all/week').length, 1);
  assert.ok(requests.filter(url => url.pathname.includes('/discover/')).every(url => url.searchParams.get('vote_count.gte') === '10' && url.searchParams.get('sort_by').endsWith('.desc')));
});

test('home preserves successful sections on partial failure, retries errors and fails when all fail', async () => {
  let trendingCalls = 0;
  const upstream = mockFetch();
  const service = createDiscoverService(cfg(), async (value, options) => {
    if (new URL(value).pathname.includes('/trending/')) { trendingCalls++; return new Response('not allowed', { status: 503 }); }
    return upstream(value, options);
  }, clock);
  for (let i = 0; i < 2; i++) {
    const result = await service.home();
    assert.equal(result.partial, true);
    assert.equal(result.trending.length, 0);
    assert.ok(result.series.length);
    assert.ok(result.featured.length);
    assert.deepEqual(result.notices, ['本周趋势暂时无法加载']);
  }
  assert.equal(trendingCalls, 2);
  await assert.rejects(createDiscoverService(cfg(), async () => new Response('bad', { status: 503 }), clock).home());
  let calls = 0;
  await assert.rejects(createDiscoverService(loadConfig({}), async () => { calls++; }).home(), error => error.status === 503);
  assert.equal(calls, 0);
});

test('new homepage route obeys HTTP methods and serves catalog state without exposing configuration', async t => {
  const server = createApp({ config: loadConfig({}) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/discover/home`)).status, 503);
  const wrong = await fetch(`${base}/api/discover/home`, { method: 'POST' });
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get('allow'), 'GET');
  assert.equal((await fetch(`${base}/catalog-state.js`)).status, 200);
});

test('rating filters enforce the actual returned score and sort unscored entries last', async () => {
  const service = createDiscoverService(cfg(), mockFetch(() => {}, [row({ id: 1, vote_average: 8.1 }), row({ id: 2, vote_average: 6.94 }), row({ id: 3, vote_count: 0 }), row({ id: 4, vote_average: 7.2 })]), clock);
  const result = await service.discover(query({ minRating: '7', sort: 'rating_asc' }));
  assert.deepEqual(result.items.map(item => item.id), ['tv:4', 'tv:1']);
  const unrestricted = await service.discover(query({ sort: 'rating_asc' }));
  assert.equal(unrestricted.items.at(-1).rating, null);
});

test('cross-region platform batches preserve filters and pagination with regional failure isolation', async () => {
  const upstream = mockFetch();
  const requests = [];
  const service = createDiscoverService(cfg(), async (value, options) => {
    const url = new URL(value); requests.push(url);
    if (url.searchParams.get('watch_region') === 'US') return new Response('unavailable', { status: 503 });
    if (url.pathname.includes('/discover/')) {
      assert.equal(url.pathname, '/3/discover/movie');
      assert.equal(url.searchParams.get('page'), '2');
      assert.equal(url.searchParams.get('with_genres'), '16');
      assert.equal(url.searchParams.get('vote_average.gte'), '7');
      assert.equal(url.searchParams.get('vote_count.gte'), '100');
      assert.equal(url.searchParams.get('primary_release_date.gte'), '2026-01-01');
      return Response.json({ results: [row({ title: '动漫电影', release_date: '2026-10-01' })], total_results: 21, total_pages: 2 });
    }
    return upstream(value, options);
  }, clock);
  const result = await service.discover(query({ platform: 'netflix', type: 'anime_movie', period: 'custom', from: '2026-01-01', to: '2026-10-15', page: '2', minRating: '7', minVotes: '100' }));
  assert.deepEqual(result.failedRegions, ['US']);
  assert.equal(result.queriedRegions.length, 7);
  assert.equal(result.items.length, 1);
  assert.equal(result.partial, true);
  assert.equal(result.page, 2);
  assert.equal(result.hasMore, false);
  assert.match(result.reason, /美国/);
  assert.ok(requests.every(url => url.searchParams.has('watch_region')));
});

test('cross-region platform errors never broaden to all platforms or bypass input validation', async () => {
  const service = createDiscoverService(cfg(), mockFetch(), clock);
  const unavailable = await service.discover(query({ platform: 'peacock' }));
  assert.equal(unavailable.items.length, 0);
  assert.equal(unavailable.hasMore, false);
  assert.match(unavailable.reason, /暂无可用/);
  let calls = 0;
  const failed = createDiscoverService(cfg(), async () => { calls++; return new Response('bad', { status: 503 }); }, clock);
  await assert.rejects(failed.discover(query({ platform: 'netflix', page: '51' })), error => error.status === 400);
  assert.equal(calls, 0);
  await assert.rejects(failed.discover(query({ platform: 'netflix' })));
  assert.equal(calls, 8);
});

function votePages(rows) {
  return async value => {
    const url = new URL(value);
    if (url.pathname.includes('/watch/providers/')) return Response.json({ results: providerRows });
    const min = Number(url.searchParams.get('vote_count.gte') || 0);
    const max = Number(url.searchParams.get('vote_count.lte') || Infinity);
    const matching = rows.filter(row => row.vote_count >= min && row.vote_count <= max);
    const sort = url.searchParams.get('sort_by');
    matching.sort((a, b) => sort === 'vote_average.asc' ? a.vote_average - b.vote_average
      : sort === 'vote_average.desc' ? b.vote_average - a.vote_average : b.first_air_date.localeCompare(a.first_air_date));
    const page = Number(url.searchParams.get('page'));
    return Response.json({ results: matching.slice((page - 1) * 20, page * 20), total_results: matching.length, total_pages: Math.ceil(matching.length / 20) });
  };
}

test('default vote priority retains all titles across high and low pages without repeats', async () => {
  const rows = Array.from({ length: 23 }, (_, i) => row({ id: i + 1, vote_count: 10 + i, vote_average: 8 - i / 10 }));
  rows.push(row({ id: 100, vote_count: 9, vote_average: 10 }), row({ id: 101, vote_count: 0, vote_average: 0 }));
  const service = createDiscoverService(cfg(), votePages(rows), clock);
  const first = await service.discover(new URLSearchParams());
  assert.equal(first.region, 'all');
  assert.equal(first.total, 25);
  assert.equal(first.priorityTotal, 23);
  assert.equal(first.lowerVoteTotal, 2);
  assert.equal(first.items.length, 20);
  assert.ok(first.items.every(item => item.voteCount >= 10));
  assert.deepEqual(first.next, { page: 2, voteGroup: 'high' });
  const second = await service.discover(new URLSearchParams(first.next));
  assert.equal(second.items.length, 3);
  assert.ok(second.items.every(item => item.voteCount >= 10));
  assert.deepEqual(second.next, { page: 1, voteGroup: 'low' });
  const last = await service.discover(new URLSearchParams(second.next));
  assert.deepEqual(last.items.map(item => item.id), ['tv:100', 'tv:101']);
  assert.equal(last.hasMore, false);
  assert.equal(last.next, null);
  assert.equal(last.items[1].rating, null);
  assert.equal(new Set([...first.items, ...second.items, ...last.items].map(item => item.id)).size, 25);
});

test('low-vote-only catalogs remain visible and unrestricted/100-vote filters keep their meaning', async () => {
  const service = createDiscoverService(cfg(), votePages([row({ vote_count: 9 })]), clock);
  const result = await service.discover(new URLSearchParams());
  assert.equal(result.items.length, 1);
  assert.equal(result.voteGroup, 'low');
  assert.equal(result.total, 1);
  assert.equal(result.hasMore, false);
  assert.equal((await service.discover(query({ minVotes: '100' }))).items.length, 0);
  assert.equal((await service.discover(query())).items.length, 1);
  await assert.rejects(service.discover(new URLSearchParams({ voteGroup: 'other' })), error => error.status === 400);
});

test('priority grouping also spans merged regional batches and each requested sorting mode', async () => {
  const rows = [row({ id: 1, vote_count: 9, vote_average: 10, first_air_date: '2026-10-14' }),
    row({ id: 2, vote_count: 10, vote_average: 8, first_air_date: '2026-10-10' }),
    row({ id: 3, vote_count: 100, vote_average: 9, first_air_date: '2026-10-11' })];
  const service = createDiscoverService(cfg(), votePages(rows), clock);
  for (const [sort, ids] of [['rating', ['tv:3', 'tv:2']], ['rating_asc', ['tv:2', 'tv:3']], ['newest', ['tv:3', 'tv:2']]]) {
    const result = await service.discover(new URLSearchParams({ platform: 'netflix', sort }));
    assert.deepEqual(result.items.map(item => item.id), ids);
    assert.equal(result.regionMode, 'combined');
    assert.deepEqual(result.next, { page: 1, voteGroup: 'low' });
    const tail = await service.discover(new URLSearchParams({ platform: 'netflix', sort, ...result.next }));
    assert.deepEqual(tail.items.map(item => item.id), ['tv:1']);
    assert.equal(tail.hasMore, false);
  }
});


test('the low-vote band keeps its own pagination and remains reachable after the high-band limit', async () => {
  const rows = [...Array.from({ length: 1001 }, (_, i) => row({ id: i + 1, vote_count: 10 })),
    ...Array.from({ length: 21 }, (_, i) => row({ id: i + 2000, vote_count: 9 }))];
  const service = createDiscoverService(cfg(), votePages(rows), clock);
  const highEnd = await service.discover(new URLSearchParams({ page: '50' }));
  assert.deepEqual(highEnd.next, { page: 1, voteGroup: 'low' });
  const lowFirst = await service.discover(new URLSearchParams(highEnd.next));
  assert.equal(lowFirst.items.length, 20);
  assert.deepEqual(lowFirst.next, { page: 2, voteGroup: 'low' });
  const lowLast = await service.discover(new URLSearchParams(lowFirst.next));
  assert.equal(lowLast.items.length, 1);
  assert.equal(lowLast.next, null);
});
