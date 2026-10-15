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
export const REGIONS = { all: '不限', US: '美国', GB: '英国', JP: '日本', KR: '韩国', HK: '香港', TW: '台湾', CA: '加拿大', AU: '澳大利亚' };
export const CONTENT_TYPES = {
  tv: { name: '电视剧', mediaType: 'tv' },
  movie: { name: '电影', mediaType: 'movie' },
  anime: { name: '动漫剧集', mediaType: 'tv', genres: [16] },
  anime_movie: { name: '动漫电影', mediaType: 'movie', genres: [16] },
  variety: { name: '综艺', mediaType: 'tv', genres: [10764, 10767] }
};
export const PERIODS = { month: '本月', '30d': '最近 30 天', '90d': '最近 90 天', '180d': '最近半年', '365d': '最近 1 年', '3y': '最近 3 年', all: '全部时间', custom: '自定义日期' };

function imageUrl(path, size) {
  return typeof path === 'string' && /^\/[a-zA-Z0-9_-]+\.(?:jpg|png)$/.test(path) ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

function artwork(row, type) {
  const category = CONTENT_TYPES[type];
  const mediaType = category.mediaType;
  const votes = Number.isSafeInteger(row.vote_count) && row.vote_count > 0 ? row.vote_count : 0;
  const originalTitle = String(row.original_title || row.original_name || '').slice(0, 250);
  const releaseDate = row.release_date || row.first_air_date;
  const score = Number(row.vote_average);
  return {
    id: `${mediaType}:${row.id}`, title: String(row.title || row.name || originalTitle).slice(0, 250), originalTitle,
    type: mediaType, category: type, categoryName: category.name,
    releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(releaseDate || '') ? releaseDate : null,
    rating: votes > 0 && Number.isFinite(score) && score >= 0 && score <= 10 ? score : null,
    voteCount: votes, ratingSource: 'TMDb', overview: String(row.overview || '').slice(0, 1200),
    posterUrl: imageUrl(row.poster_path, 'w342'), backdropUrl: imageUrl(row.backdrop_path, 'w1280'),
    tmdbUrl: `https://www.themoviedb.org/${mediaType}/${row.id}`
  };
}

export function dateWindow(period, now = new Date(), timezone = 'Asia/Shanghai', custom = {}) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  if (period === 'month') return { from: `${parts.year}-${parts.month}-01`, to: today };
  if (period === 'all') return { from: null, to: today };
  if (period === 'custom') {
    const from = custom.from; const to = custom.to || today;
    const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    if (!valid(from) || !valid(to)) throw new InputError('请选择有效的开始和结束日期');
    if (from > to) throw new InputError('开始日期不能晚于结束日期');
    if (to > today) throw new InputError('结束日期不能晚于今天');
    return { from, to };
  }
  const from = new Date(`${today}T00:00:00Z`);
  if (period === '3y') {
    const year = from.getUTCFullYear() - 3; const month = from.getUTCMonth();
    const day = Math.min(from.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
    from.setUTCFullYear(year, month, day);
  } else {
    const days = { '30d': 30, '90d': 90, '180d': 180, '365d': 365 }[period];
    if (!days) throw new InputError('不支持的时间范围');
    from.setUTCDate(from.getUTCDate() - days + 1);
  }
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
    const region = params.get('region') || 'all';
    const type = params.get('type') || 'tv';
    if (!Object.hasOwn(REGIONS, region)) throw new InputError('不支持的片库地区');
    if (!Object.hasOwn(CONTENT_TYPES, type)) throw new InputError('不支持的作品类型');
    return { region, type, mediaType: CONTENT_TYPES[type].mediaType };
  }
  async function providers(params) {
    const { region, mediaType } = filters(params);
    const data = await tmdb(`watch/providers/${mediaType}`, { ...(region !== 'all' ? { watch_region: region } : {}), language: 'en-US' });
    return STREAMERS.map(({ match, ...platform }) => {
      const ids = data.results.filter(p => typeof p.provider_name === 'string' && match.test(p.provider_name) && Number.isSafeInteger(p.provider_id)).map(p => p.provider_id);
      return { ...platform, providerIds: [...new Set(ids)], available: ids.length > 0 };
    });
  }
  const service = {
    config() { return { enabled, platforms: STREAMERS.map(({ match, ...p }) => p), regions: REGIONS, contentTypes: CONTENT_TYPES, periods: PERIODS, today: dateWindow('month', now(), config.discoverTimezone).to, ratingSource: 'TMDb' }; },
    async providers(params) { return { platforms: await providers(params), ...filters(params) }; },
    async discover(params) {
      const { region, type, mediaType } = filters(params);
      const platform = params.get('platform') || 'all';
      const period = params.get('period') || 'month';
      const sort = params.get('sort') || 'rating';
      const minVotes = params.get('minVotes') || '0';
      const minRating = params.get('minRating') || '0';
      const pageText = params.get('page') || '1';
      if (platform !== 'all' && !STREAMERS.some(p => p.id === platform)) throw new InputError('不支持的流媒体平台');
      if (!Object.hasOwn(PERIODS, period)) throw new InputError('不支持的时间范围');
      if (region === 'all' && platform !== 'all') throw new InputError('按流媒体平台筛选时，请先选择具体片库地区');
      if (!['rating', 'rating_asc', 'newest'].includes(sort)) throw new InputError('不支持的排序方式');
      if (!['0', '10', '100'].includes(minVotes)) throw new InputError('不支持的最低评分人数');
      if (!/^(?:[0-9](?:\.[0-9])?|10(?:\.0)?)$/.test(minRating)) throw new InputError('最低评分必须在 0–10 之间');
      if (!/^\d+$/.test(pageText) || Number(pageText) < 1 || Number(pageText) > 50) throw new InputError('页码必须在 1–50 之间');
      const page = Number(pageText);
      const range = dateWindow(period, now(), config.discoverTimezone, { from: params.get('from'), to: params.get('to') });
      const available = await providers(params);
      const selected = available.filter(p => (platform === 'all' || platform === p.id) && p.available);
      const providerIds = [...new Set(selected.flatMap(p => p.providerIds))];
      if (region !== 'all' && !providerIds.length) return { items: [], total: 0, page, hasMore: false, range, region, type, platform, platforms: available, reason: '所选平台在该地区没有可用的片库数据' };
      const dateField = mediaType === 'movie' ? 'primary_release_date' : 'first_air_date';
      const category = CONTENT_TYPES[type];
      const data = await tmdb(`discover/${mediaType}`, {
        language: 'zh-CN',
        ...(region !== 'all' ? { watch_region: region, with_watch_providers: providerIds.join('|'), with_watch_monetization_types: 'flatrate' } : {}),
        ...(category.genres ? { with_genres: category.genres.join('|') } : {}),
        include_adult: 'false', page,
        ...(range.from ? { [`${dateField}.gte`]: range.from } : {}), [`${dateField}.lte`]: range.to,
        'vote_count.gte': minVotes, 'vote_average.gte': minRating,
        sort_by: sort === 'newest' ? `${dateField}.desc` : sort === 'rating_asc' ? 'vote_average.asc' : 'vote_average.desc'
      });
      if (!Number.isFinite(Number(data.total_results)) || !Number.isFinite(Number(data.total_pages))) throw new UpstreamError('TMDb 分页数据格式发生变化');
      const items = data.results.filter(row => row && Number.isSafeInteger(row.id) && row.id > 0 && row.adult !== true)
        .map(row => artwork(row, type)).filter(row => row.title && row.releaseDate && (!range.from || row.releaseDate >= range.from) && row.releaseDate <= range.to
          && (Number(minRating) === 0 || (row.rating != null && row.rating >= Number(minRating))));
      items.sort((a, b) => sort === 'newest' ? b.releaseDate.localeCompare(a.releaseDate)
        : a.rating == null ? (b.rating == null ? 0 : 1) : b.rating == null ? -1 : sort === 'rating_asc' ? a.rating - b.rating : b.rating - a.rating);
      return { items, total: Number(data.total_results), page, hasMore: page < Math.min(Number(data.total_pages), 50), range, region, type, platform, platforms: available, ratingSource: 'TMDb' };
    },
    async home() {
      if (!enabled) throw new InputError('影视数据服务尚未连接，请配置 TMDb 访问凭据', 503);
      const today = dateWindow('month', now(), config.discoverTimezone).to;
      const results = await Promise.allSettled([
        tmdb('trending/all/week', { language: 'zh-CN' }).then(data => data.results
          .filter(row => row && ['movie', 'tv'].includes(row.media_type) && Number.isSafeInteger(row.id) && row.id > 0 && row.adult !== true)
          .map(row => artwork(row, row.media_type)).filter(row => row.title && row.releaseDate && row.releaseDate <= today).slice(0, 12)),
        service.discover(new URLSearchParams({ type: 'movie', period: '30d', sort: 'newest', minVotes: '10' })).then(data => data.items.slice(0, 6)),
        service.discover(new URLSearchParams({ type: 'tv', period: '30d', sort: 'newest', minVotes: '10' })).then(data => data.items.slice(0, 6))
      ]);
      if (results.every(result => result.status === 'rejected')) throw results[0].reason;
      const names = ['本周趋势', '近期电影', '近期新剧'];
      const sections = results.map(result => result.status === 'fulfilled' ? result.value : []);
      const featured = (sections[0].length ? sections[0] : [...sections[1], ...sections[2]]);
      return {
        featured: [...featured.filter(item => item.backdropUrl), ...featured.filter(item => !item.backdropUrl)].slice(0, 3),
        trending: sections[0], movies: sections[1], series: sections[2],
        partial: results.some(result => result.status === 'rejected'),
        notices: results.flatMap((result, i) => result.status === 'rejected' ? [`${names[i]}暂时无法加载`] : []),
        trendSource: 'TMDb 本周趋势', recentMinVotes: 10, today
      };
    }
  };
  return service;
}
