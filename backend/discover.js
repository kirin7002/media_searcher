import { InputError } from './search.js';
import { requestJson, UpstreamError } from './providers.js';

// IDs are resolved from TMDb's region-specific provider list instead of hardcoded.
export const STREAMERS = [
  { id: 'netflix', name: 'Netflix', match: /^Netflix(?:$| )/i },
  { id: 'hulu', name: 'Hulu', match: /^Hulu(?:$| )/i },
  { id: 'prime', name: 'Prime Video', match: /^Amazon Prime Video(?:$| with Ads)/i },
  { id: 'disney', name: 'Disney+', match: /^Disney(?: Plus|\+)$/i },
  { id: 'max', name: 'HBO Max', match: /^(?:HBO Max(?:$| )|Max$)/i },
  { id: 'apple', name: 'Apple TV', match: /^Apple TV(?: Plus|\+)?$/i },
  { id: 'paramount', name: 'Paramount+', match: /^Paramount(?: Plus|\+)(?:$| )/i },
  { id: 'peacock', name: 'Peacock', match: /^Peacock(?:$| )/i }
];
export const REGIONS = { US: '美国', GB: '英国', JP: '日本', KR: '韩国', HK: '香港', TW: '台湾', CA: '加拿大', AU: '澳大利亚' };

export function dateWindow(period, now = new Date(), timezone = 'Asia/Shanghai') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  if (period === 'month') return { from: `${parts.year}-${parts.month}-01`, to: today };
  const from = new Date(`${today}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: from.toISOString().slice(0, 10), to: today };
}

export function createDiscoverService(config, fetchImpl = fetch, now = () => new Date()) {
  const enabled = Boolean(config.tmdbToken || config.tmdbApiKey);
  const cache = new Map();
  const pending = new Map();
  async function tmdb(path, params) {
    if (!enabled) throw new InputError('请先在服务端配置 TMDB_READ_ACCESS_TOKEN 或 TMDB_API_KEY', 503);
    const url = new URL(`https://api.themoviedb.org/3/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    if (!config.tmdbToken) url.searchParams.set('api_key', config.tmdbApiKey);
    const key = path + '?' + new URLSearchParams(params);
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.data;
    if (!pending.has(key)) {
      pending.set(key, requestJson(fetchImpl, url, { headers: config.tmdbToken ? { Authorization: `Bearer ${config.tmdbToken}` } : {} }, config.timeoutMs).then(data => {
        if (!data || !Array.isArray(data.results)) throw new UpstreamError('TMDb 数据格式发生变化');
        if (cache.size >= 200) cache.delete(cache.keys().next().value);
        cache.set(key, { data, expires: Date.now() + 10 * 60 * 1000 });
        return data;
      }).finally(() => pending.delete(key)));
    }
    return pending.get(key);
  }
  function filters(params) {
    const region = params.get('region') || 'US';
    const type = params.get('type') || 'tv';
    if (!Object.hasOwn(REGIONS, region)) throw new InputError('不支持的片库地区');
    if (!['tv', 'movie'].includes(type)) throw new InputError('类型必须为电影或电视剧');
    return { region, type };
  }
  async function providers(params) {
    const { region, type } = filters(params);
    const data = await tmdb(`watch/providers/${type}`, { watch_region: region, language: 'en-US' });
    return STREAMERS.map(({ match, ...platform }) => {
      const ids = data.results.filter(p => typeof p.provider_name === 'string' && match.test(p.provider_name) && Number.isSafeInteger(p.provider_id)).map(p => p.provider_id);
      return { ...platform, providerIds: [...new Set(ids)], available: ids.length > 0 };
    });
  }
  return {
    config() { return { enabled, platforms: STREAMERS.map(({ match, ...p }) => p), regions: REGIONS, ratingSource: 'TMDb' }; },
    async providers(params) { return { platforms: await providers(params), ...filters(params) }; },
    async discover(params) {
      const { region, type } = filters(params);
      const platform = params.get('platform') || 'all';
      const period = params.get('period') || 'month';
      const sort = params.get('sort') || 'rating';
      const minVotes = params.get('minVotes') || '10';
      const pageText = params.get('page') || '1';
      if (platform !== 'all' && !STREAMERS.some(p => p.id === platform)) throw new InputError('不支持的流媒体平台');
      if (!['month', '30d'].includes(period)) throw new InputError('不支持的时间范围');
      if (!['rating', 'newest'].includes(sort)) throw new InputError('不支持的排序方式');
      if (!['0', '10', '100'].includes(minVotes)) throw new InputError('不支持的最低评分人数');
      if (!/^\d+$/.test(pageText) || Number(pageText) < 1 || Number(pageText) > 50) throw new InputError('页码必须在 1–50 之间');
      const page = Number(pageText);
      const range = dateWindow(period, now(), config.discoverTimezone);
      const available = await providers(params);
      const selected = available.filter(p => (platform === 'all' || platform === p.id) && p.available);
      const providerIds = [...new Set(selected.flatMap(p => p.providerIds))];
      if (!providerIds.length) return { items: [], total: 0, page, hasMore: false, range, region, type, platform, platforms: available, reason: '所选平台在该地区没有可用的片库数据' };
      const dateField = type === 'movie' ? 'primary_release_date' : 'first_air_date';
      const data = await tmdb(`discover/${type}`, {
        language: 'zh-CN', watch_region: region, with_watch_providers: providerIds.join('|'),
        with_watch_monetization_types: 'flatrate', include_adult: 'false', page,
        [`${dateField}.gte`]: range.from, [`${dateField}.lte`]: range.to,
        'vote_count.gte': minVotes, sort_by: sort === 'rating' ? 'vote_average.desc' : `${dateField}.desc`
      });
      if (!Number.isFinite(Number(data.total_results)) || !Number.isFinite(Number(data.total_pages))) throw new UpstreamError('TMDb 分页数据格式发生变化');
      const items = data.results.filter(row => Number.isSafeInteger(row.id) && row.id > 0).map(row => {
        const votes = Number.isSafeInteger(row.vote_count) ? row.vote_count : 0;
        const originalTitle = String(row.original_title || row.original_name || '').slice(0, 250);
        const title = String(row.title || row.name || originalTitle).slice(0, 250);
        const releaseDate = row.release_date || row.first_air_date;
        const score = Number(row.vote_average);
        const posterPath = typeof row.poster_path === 'string' && /^\/[a-zA-Z0-9_-]+\.(?:jpg|png)$/.test(row.poster_path) ? row.poster_path : '';
        return {
          id: `${type}:${row.id}`, title, originalTitle, type,
          releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(releaseDate || '') ? releaseDate : null,
          rating: votes > 0 && Number.isFinite(score) && score >= 0 && score <= 10 ? score : null,
          voteCount: votes, ratingSource: 'TMDb', overview: String(row.overview || '').slice(0, 1200),
          posterUrl: posterPath ? `https://image.tmdb.org/t/p/w342${posterPath}` : null,
          tmdbUrl: `https://www.themoviedb.org/${type}/${row.id}`
        };
      }).filter(row => row.title && row.releaseDate && row.releaseDate >= range.from && row.releaseDate <= range.to);
      return { items, total: Number(data.total_results), page, hasMore: page < Math.min(Number(data.total_pages), 50), range, region, type, platform, platforms: available, ratingSource: 'TMDb' };
    }
  };
}
