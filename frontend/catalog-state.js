export const CATALOG_DEFAULTS = Object.freeze({ type: 'tv', region: 'all', platform: 'all', period: 'month', sort: 'rating', minVotes: '10', minRating: '0' });
const allowed = {
  type: ['tv', 'movie', 'anime', 'anime_movie', 'variety'], region: ['all', 'US', 'GB', 'JP', 'KR', 'HK', 'TW', 'CA', 'AU'],
  platform: ['all', 'netflix', 'hulu', 'prime', 'disney', 'max', 'apple', 'paramount', 'peacock'],
  period: ['month', '30d', '90d', '180d', '365d', '3y', 'all', 'custom'], sort: ['rating', 'rating_asc', 'newest'], minVotes: ['0', '10', '100']
};
export function parseCatalog(hash = '') {
  const params = new URLSearchParams(hash.split('?')[1] || '');
  const value = { ...CATALOG_DEFAULTS };
  for (const [key, options] of Object.entries(allowed)) if (options.includes(params.get(key))) value[key] = params.get(key);
  const rating = params.get('minRating');
  if (rating && /^(?:[0-9](?:\.[0-9])?|10(?:\.0)?)$/.test(rating)) value.minRating = String(Number(rating));
  if (value.period === 'custom') for (const key of ['from', 'to']) if (/^\d{4}-\d{2}-\d{2}$/.test(params.get(key) || '')) value[key] = params.get(key);
  return value;
}
export function catalogHash(value) {
  const params = new URLSearchParams();
  for (const key of Object.keys(CATALOG_DEFAULTS)) if (value[key] != null && value[key] !== CATALOG_DEFAULTS[key]) params.set(key, value[key]);
  if (value.period === 'custom') for (const key of ['from', 'to']) if (value[key]) params.set(key, value[key]);
  return '#discover' + (params.size ? '?' + params : '');
}
export function pageFromLocation(hash, search = '') {
  const name = hash.slice(1).split('?')[0];
  return ['home', 'search', 'discover', 'favorites', 'sources'].includes(name) ? name : new URLSearchParams(search).has('q') ? 'search' : 'home';
}

export function sortCatalogItems(items, sort, minVotes = '0') {
  return items.sort((a, b) => {
    const priority = minVotes === '10' ? Number(b.voteCount >= 10) - Number(a.voteCount >= 10) : 0;
    if (priority) return priority;
    return sort === 'newest' ? (b.releaseDate || '').localeCompare(a.releaseDate || '')
      : a.rating == null ? (b.rating == null ? 0 : 1) : b.rating == null ? -1 : sort === 'rating_asc' ? a.rating - b.rating : b.rating - a.rating;
  });
}
