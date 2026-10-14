const $ = id => document.getElementById(id);

export function initDiscovery({ icon, escape, onSearch }) {
  const state = { enabled: false, ready: false, loaded: false, platforms: [], items: [], platform: 'all', page: 1, hasMore: false, controller: null, filterKey: '' };
  const params = () => new URLSearchParams({ platform: state.platform, region: $('discover-region').value, type: $('discover-type').value, period: $('discover-period').value, sort: $('discover-sort').value, minVotes: $('discover-votes').value });
  const empty = (title, description) => `<div class="empty-state"><span class="empty-icon">${icon('film')}</span><h3>${escape(title)}</h3><p>${escape(description)}</p></div>`;

  function platforms() {
    $('streaming-platforms').innerHTML = [{ id: 'all', name: '全部平台', available: true }, ...state.platforms].map(p => `<button type="button" class="streaming-chip ${state.platform === p.id ? 'selected' : ''}" data-streamer="${escape(p.id)}" aria-pressed="${state.platform === p.id}" ${p.available === false ? 'disabled' : ''} title="${p.available === false ? '该地区暂未提供此平台片库数据' : escape(p.name)}">${escape(p.name)}</button>`).join('');
  }
  function render() {
    $('discover-results').innerHTML = state.items.length ? state.items.map((item, index) => {
      const rated = item.rating != null;
      const original = item.originalTitle && item.originalTitle !== item.title;
      return `<article class="movie-card"><button class="poster-button" type="button" data-discover-search="${index}" aria-label="搜索 ${escape(item.title)} 的网盘资源">${item.posterUrl ? `<img src="${escape(item.posterUrl)}" alt="${escape(item.title)} 海报" loading="lazy" width="342" height="513" referrerpolicy="no-referrer">` : `<span class="poster-fallback">${icon('film')}<span>暂无海报</span></span>`}<span class="movie-rating">${rated ? `★ ${Number(item.rating).toFixed(1)}` : '暂无评分'}<small>TMDb</small></span></button><div class="movie-content"><h3><button type="button" data-discover-search="${index}" title="${escape(item.title)}">${escape(item.title)}</button></h3><p class="movie-original" title="${escape(item.originalTitle)}">${escape(item.originalTitle || item.title)}</p><div class="movie-meta"><span>${item.type === 'movie' ? '电影' : '电视剧'} · ${escape(item.releaseDate)}</span><span>${item.voteCount} 人评分</span></div><p class="movie-overview" title="${escape(item.overview)}">${escape(item.overview || '暂无简介')}</p><button type="button" class="movie-search" data-discover-search="${index}">${icon('search')}搜索网盘<span>↗</span></button><div class="movie-links">${original ? `<button type="button" data-discover-original="${index}">用原名搜索</button>` : '<span></span>'}<a href="${escape(item.tmdbUrl)}" target="_blank" rel="noopener noreferrer">TMDb 详情 ↗</a></div></div></article>`;
    }).join('') : empty('这个条件下还没有作品', '尝试最近 30 天、其他平台或地区，或降低最低评分人数。');
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
    $('discover-title').textContent = `${query.get('period') === 'month' ? '本月' : '最近 30 天'}${query.get('type') === 'movie' ? '电影' : '新剧'}`;
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
      $('discover-summary').textContent = `${data.range.from} — ${data.range.to} · 共 ${data.total} 部，已显示 ${state.items.length} 部 · TMDb 评分`;
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
  $('discover-filters').addEventListener('change', () => {
    // Region availability is refreshed from the next API response.
    state.platforms = state.platforms.map(p => ({ ...p, available: undefined })); platforms(); load();
  });
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
      const data = await response.json(); state.enabled = data.enabled; state.platforms = data.platforms; state.ready = true; platforms(); open();
    } catch {
      $('discover-summary').textContent = '影视服务连接失败';
      $('discover-results').innerHTML = empty('服务暂时不可用', '请刷新页面后重试。');
    }
  }
  initialize();
}
