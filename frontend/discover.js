const $ = id => document.getElementById(id);

export function initDiscovery({ icon, escape, onSearch }) {
  const state = { enabled: false, ready: false, loaded: false, platforms: [], items: [], platform: 'all', page: 1, hasMore: false, controller: null, filterKey: '', types: {}, periods: {} };
  const params = () => {
    const query = new URLSearchParams({ platform: state.platform, region: $('discover-region').value, type: $('discover-type').value, period: $('discover-period').value, sort: $('discover-sort').value, minVotes: $('discover-votes').value });
    if (query.get('period') === 'custom') { query.set('from', $('discover-from').value); query.set('to', $('discover-to').value); }
    return query;
  };
  const empty = (title, description) => `<div class="empty-state"><span class="empty-icon">${icon('film')}</span><h3>${escape(title)}</h3><p>${escape(description)}</p></div>`;

  function platforms() {
    const global = $('discover-region').value === 'all';
    $('streaming-platforms').innerHTML = [{ id: 'all', name: '全部平台', available: true }, ...state.platforms].map(p => {
      const needsRegion = global && p.id !== 'all';
      return `<button type="button" class="streaming-chip ${state.platform === p.id ? 'selected' : ''}" data-streamer="${escape(p.id)}" aria-pressed="${state.platform === p.id}" ${needsRegion || p.available === false ? 'disabled' : ''} title="${needsRegion ? '先选择具体地区，即可按平台筛选' : p.available === false ? '该地区暂未提供此平台片库数据' : escape(p.name)}">${escape(p.name)}</button>`;
    }).join('');
    $('discover-region-hint').hidden = !global;
  }
  function render() {
    $('discover-results').innerHTML = state.items.length ? state.items.map((item, index) => {
      const rated = item.rating != null;
      const original = item.originalTitle && item.originalTitle !== item.title;
      return `<article class="movie-card"><button class="poster-button" type="button" data-discover-search="${index}" aria-label="搜索 ${escape(item.title)} 的网盘资源">${item.posterUrl ? `<img src="${escape(item.posterUrl)}" alt="${escape(item.title)} 海报" loading="lazy" width="342" height="513" referrerpolicy="no-referrer">` : `<span class="poster-fallback">${icon('film')}<span>暂无海报</span></span>`}<span class="movie-rating">${rated ? `★ ${Number(item.rating).toFixed(1)}` : '暂无评分'}<small>TMDb</small></span></button><div class="movie-content"><h3><button type="button" data-discover-search="${index}" title="${escape(item.title)}">${escape(item.title)}</button></h3><p class="movie-original" title="${escape(item.originalTitle)}">${escape(item.originalTitle || item.title)}</p><div class="movie-meta"><span>${escape(item.categoryName || (item.type === 'movie' ? '电影' : '电视剧'))} · ${escape(item.releaseDate)}</span><span>${item.voteCount} 人评分</span></div><p class="movie-overview" title="${escape(item.overview)}">${escape(item.overview || '暂无简介')}</p><button type="button" class="movie-search" data-discover-search="${index}">${icon('search')}搜索网盘<span>↗</span></button><div class="movie-links">${original ? `<button type="button" data-discover-original="${index}">用原名搜索</button>` : '<span></span>'}<a href="${escape(item.tmdbUrl)}" target="_blank" rel="noopener noreferrer">TMDb 详情 ↗</a></div></div></article>`;
    }).join('') : empty('这个条件下还没有作品', '尝试更长的时间范围、其他类型或地区，或降低最低评分人数。');
    $('discover-more').hidden = !state.hasMore;
  }

  async function load({ append = false, refresh = false } = {}) {
    if (!state.ready) return;
    if (!state.enabled && !refresh) {
      $('discover-summary').textContent = '影视数据服务尚未连接';
      $('discover-results').innerHTML = empty('影视片库准备中', '连接 TMDb 数据服务后，将在这里展示真实新片、评分和上映时间。');
      return;
    }
    state.controller?.abort();
    const controller = new AbortController(); state.controller = controller;
    const query = params(); const key = query.toString();
    const page = append ? state.page + 1 : 1;
    $('discover-results').setAttribute('aria-busy', 'true');
    $('discover-more').disabled = true; $('discover-refresh').disabled = true;
    $('discover-notice').textContent = '';
    const periodLabel = state.periods[query.get('period')] || '';
    const typeLabel = state.types[query.get('type')]?.name || '作品';
    $('discover-title').textContent = `${periodLabel} · ${typeLabel}`;
    $('discover-summary').textContent = '正在查询平台片库…';
    if (!append) { state.items = []; state.hasMore = false; $('discover-more').hidden = true; $('discover-results').innerHTML = Array.from({ length: 4 }, () => '<div class="skeleton-card movie-skeleton"><div></div><div></div><div></div></div>').join(''); }
    try {
      if (refresh) {
        const configResponse = await fetch('/api/discover/config', { signal: controller.signal });
        if (!configResponse.ok) throw new Error('无法读取影视服务配置');
        const config = await configResponse.json(); state.enabled = config.enabled;
        if (!state.enabled) throw new Error('影视数据服务尚未连接，需由管理员配置 TMDb 访问凭据');
      }
      query.set('page', page);
      const response = await fetch(`/api/discover?${query}`, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '影视片库暂时不可用');
      if (state.controller !== controller) return;
      if (!Array.isArray(data.items)) throw new Error('影视数据格式不正确');
      state.page = page; state.hasMore = data.hasMore; state.loaded = true; state.filterKey = key;
      const merged = new Map((append ? [...state.items, ...data.items] : data.items).map(item => [item.id, item]));
      state.items = [...merged.values()]; state.platforms = data.platforms;
      platforms(); render();
      const rangeLabel = data.range.from ? `${data.range.from} — ${data.range.to}` : `截至 ${data.range.to} 的全部历史`;
      const regionLabel = query.get('region') === 'all' ? '不限地区' : $('discover-region').selectedOptions[0].textContent;
      $('discover-summary').textContent = `${rangeLabel} · ${regionLabel} · 共 ${data.total} 部，已显示 ${state.items.length} 部 · TMDb 评分`;
      if (data.reason) $('discover-notice').innerHTML = `<div class="partial-note">${escape(data.reason)}</div>`;
    } catch (error) {
      if (error.name === 'AbortError' || state.controller !== controller) return;
      $('discover-notice').innerHTML = `<div class="error-banner">${escape(error.message)}</div>`;
      $('discover-summary').textContent = '未取得片库数据，稍后可重新加载。';
      if (!append) $('discover-results').innerHTML = empty('暂时无法加载影视片库', '已有的网盘搜索功能仍可使用。');
    } finally {
      if (state.controller === controller) {
        $('discover-results').setAttribute('aria-busy', 'false'); $('discover-refresh').disabled = false; $('discover-more').disabled = false;
      }
    }
  }

  $('streaming-platforms').addEventListener('click', event => {
    const button = event.target.closest('[data-streamer]');
    if (!button || button.disabled) return;
    state.platform = button.dataset.streamer; platforms(); load();
  });
  $('discover-filters').addEventListener('submit', event => event.preventDefault());
  $('discover-filters').addEventListener('change', event => {
    $('discover-custom-dates').hidden = $('discover-period').value !== 'custom';
    if (['discover-from', 'discover-to'].includes(event.target.id)) return;
    if ($('discover-region').value === 'all') state.platform = 'all';
    // Region availability is refreshed from the next API response.
    state.platforms = state.platforms.map(p => ({ ...p, available: undefined })); platforms(); load();
  });
  $('discover-apply-dates').addEventListener('click', () => load());
  $('discover-more').addEventListener('click', () => load({ append: true }));
  $('discover-refresh').addEventListener('click', () => load({ refresh: true }));
  $('discover-results').addEventListener('click', event => {
    const button = event.target.closest('[data-discover-search], [data-discover-original]');
    if (!button) return;
    const index = Number(button.dataset.discoverSearch ?? button.dataset.discoverOriginal);
    const item = state.items[index];
    if (item) onSearch(button.hasAttribute('data-discover-original') ? item.originalTitle : item.title);
  });
  function open() {
    if (location.hash === '#discover' && (!state.loaded || state.filterKey !== params().toString())) load();
  }
  addEventListener('hashchange', open);
  async function initialize() {
    try {
      const response = await fetch('/api/discover/config');
      if (!response.ok) throw new Error();
      const data = await response.json(); state.enabled = data.enabled; state.platforms = data.platforms; state.types = data.contentTypes; state.periods = data.periods; state.ready = true;
      const today = data.today;
      if (today) {
        const from = new Date(`${today}T00:00:00Z`); from.setUTCDate(from.getUTCDate() - 89);
        $('discover-from').value = from.toISOString().slice(0, 10); $('discover-from').max = today;
        $('discover-to').value = today; $('discover-to').max = today;
      }
      platforms(); open();
    } catch {
      $('discover-summary').textContent = '影视服务连接失败';
      $('discover-results').innerHTML = empty('服务暂时不可用', '请刷新页面后重试。');
    }
  }
  initialize();
}
