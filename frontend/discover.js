import { CATALOG_DEFAULTS, parseCatalog, catalogHash, pageFromLocation, sortCatalogItems } from './catalog-state.js';
import { bindHeroSwipe } from './hero-swipe.js';
const $ = id => document.getElementById(id);
const typeLabels = { tv: '剧集', movie: '电影', anime: '动漫剧集', anime_movie: '动漫电影', variety: '综艺' };

export function initDiscovery({ icon, escape, onSearch }) {
  const state = { config: null, catalog: { ...CATALOG_DEFAULTS }, items: [], page: 1, hasMore: false, total: 0, key: '', scroll: 0, controller: null, homeController: null, homeLoaded: false, home: null, heroIndex: 0, view: '', cache: new Map(), regionMode: null, queriedRegions: [], notice: '' };
  const media = new Map();
  const empty = (title, description) => `<div class="empty-state"><span class="empty-icon">${icon('film')}</span><h3>${escape(title)}</h3><p>${escape(description)}</p></div>`;
  const remember = item => { media.set(item.id, item); return escape(item.id); };
  const image = (item, landscape = false, eager = false) => {
    const url = landscape ? item.backdropUrl || item.posterUrl : item.posterUrl;
    return `${url ? `<img src="${escape(url)}" alt="${escape(item.title)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" width="${landscape ? 640 : 342}" height="${landscape ? 360 : 513}">` : ''}<span class="art-fallback" aria-hidden="true">${icon('film')}<span>${url ? '图片暂不可用' : '暂无海报'}</span></span>`;
  };
  const rating = item => `${item.rating == null ? '暂无评分' : '★ ' + item.rating.toFixed(1)} <small>TMDb</small>`;
  const findItem = target => media.get(target.dataset.mediaSearch || target.dataset.mediaDetails || target.dataset.mediaOriginal);
  function poster(item, detailed = false, landscape = false) {
    const id = remember(item);
    return `<article class="movie-card ${landscape ? 'landscape-card' : ''}"><button type="button" class="poster-button ${landscape ? 'landscape-art' : ''}" data-media-search="${id}" aria-label="搜索 ${escape(item.title)} 的网盘资源">${image(item, landscape)}<span class="movie-rating">${rating(item)}</span><span class="poster-action">${icon('search')}搜索网盘</span></button><div class="movie-content"><h3><button type="button" data-media-search="${id}">${escape(item.title)}</button></h3><p class="movie-meta">${escape(item.categoryName)} · ${escape(item.releaseDate || '')}</p>${detailed ? `<p class="movie-original">${escape(item.originalTitle)}</p><p class="movie-overview">${escape(item.overview || '暂无简介')}</p><div class="movie-links"><button type="button" data-media-details="${id}">剧情 · ${item.voteCount} 人评分</button>${item.originalTitle !== item.title ? `<button type="button" data-media-original="${id}">用原名搜索 ↗</button>` : ''}</div>` : ''}</div></article>`;
  }
  function rememberCatalog() {
    if (!state.key) return;
    state.scroll = window.scrollY;
    const saved = state.cache.get(state.key);
    if (saved) saved.scroll = state.scroll;
  }
  function searchMedia(item, original = false) {
    if (state.view === 'discover') rememberCatalog();
    $('media-dialog').close();
    onSearch(item, original ? item.originalTitle : item.title);
  }
  function details(item) {
    const id = remember(item);
    $('media-dialog-content').innerHTML = `<div class="detail-art">${image(item, true)}</div><div class="detail-copy"><div class="eyebrow">${escape(item.categoryName)} · ${escape(item.releaseDate || '')}</div><h2 id="media-dialog-title">${escape(item.title)}</h2><p class="movie-original">${escape(item.originalTitle)}</p><p>${rating(item)} · ${item.voteCount} 人评分</p><p class="detail-overview">${escape(item.overview || '暂无剧情简介')}</p><div class="detail-actions"><button type="button" class="primary-button" data-media-search="${id}">${icon('search')}搜索网盘</button><a class="secondary-button" href="${escape(item.tmdbUrl)}" target="_blank" rel="noopener noreferrer">TMDb 详情 ↗</a></div></div>`;
    $('media-dialog').showModal();
  }
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-media-search], [data-media-original], [data-media-details]');
    if (target) { const item = findItem(target); if (item) target.hasAttribute('data-media-details') ? details(item) : searchMedia(item, target.hasAttribute('data-media-original')); }
    if (event.target.closest('.dialog-close')) $('media-dialog').close();
  });
  document.addEventListener('click', event => { if (state.view === 'discover' && event.target.closest('a[href]')) rememberCatalog(); }, true);
  document.addEventListener('error', event => { if (event.target instanceof HTMLImageElement && event.target.closest('.poster-button, .detail-art, .cinema-hero')) event.target.classList.add('image-failed'); }, true);
  $('media-dialog').addEventListener('click', event => { if (event.target === $('media-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });

  function showHero(index = 0) {
    const items = state.home?.featured || [];
    const item = items[index];
    if (!item) return;
    state.heroIndex = index;
    const id = remember(item);
    $('home-hero').innerHTML = `<div class="hero-art" draggable="false">${image(item, true, true)}</div><div class="hero-shade"></div><div class="hero-copy"><div class="eyebrow">本期精选 · ${escape(item.categoryName)}</div><h1>${escape(item.title)}</h1><p class="hero-original">${escape(item.originalTitle)}</p><div class="hero-meta">${escape(item.releaseDate)} <span>·</span> ${rating(item)}</div><p class="hero-overview">${escape(item.overview || '发现一个新的故事，从这里开始。')}</p><div class="hero-actions"><button type="button" class="primary-button" data-media-search="${id}">${icon('search')}搜索网盘</button><button type="button" class="secondary-button" data-media-details="${id}">了解剧情</button></div><p class="hero-hint">点击影视海报，即可搜索相关网盘资源</p></div><div class="hero-switcher" role="group" aria-label="精选影视切换">${items.map((entry, i) => `<button type="button" data-hero="${i}" aria-label="精选 ${i + 1}：${escape(entry.title)}" aria-pressed="${index === i}">${entry.posterUrl ? `<img src="${escape(entry.posterUrl)}" alt="" width="80" height="52">` : escape(String(i + 1).padStart(2, '0'))}<span>${escape(entry.title)}</span></button>`).join('')}${items.length > 1 ? '<span class="hero-swipe-hint">左右滑动切换</span>' : ''}</div>`;
  }
  bindHeroSwipe($('home-hero'), { getIndex: () => state.heroIndex, getCount: () => state.home?.featured?.length || 0, onChange: showHero });
  $('home-hero').addEventListener('click', event => { const button = event.target.closest('[data-hero]'); if (button) showHero(Number(button.dataset.hero)); });
  function homeHubs() {
    $('home-platforms').innerHTML = (state.config?.platforms || []).map(p => `<button type="button" class="provider-hub provider-${escape(p.id)}" data-hub="${escape(p.id)}">${escape(p.name)}<span>探索片库 ↗</span></button>`).join('');
  }
  $('home-platforms').addEventListener('click', event => {
    const button = event.target.closest('[data-hub]');
    if (!button) return;
    location.hash = catalogHash({ ...CATALOG_DEFAULTS, platform: button.dataset.hub, period: 'all' });
  });
  async function loadHome() {
    if (state.homeController) return;
    const controller = new AbortController(); state.homeController = controller;
    $('home-hero').setAttribute('aria-busy', 'true');
    $('home-notice').textContent = '';
    try {
      if (!state.config?.enabled) throw new Error('影视数据服务尚未连接，请在服务端配置 TMDb 访问凭据后重试。');
      const response = await fetch('/api/discover/home', { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '影视首页暂时不可用');
      state.home = data; state.homeLoaded = true;
      showHero();
      $('home-trending').innerHTML = data.trending.length ? data.trending.map(item => poster(item)).join('') : empty('暂时没有趋势片单', '可以通过片库按自己的偏好继续挑选。');
      $('home-movies').innerHTML = data.movies.length ? data.movies.map(item => poster(item, false, true)).join('') : empty('暂无近期电影', '去片库试试更长的时间范围。');
      $('home-series').innerHTML = data.series.length ? data.series.map(item => poster(item, false, true)).join('') : empty('暂无近期新剧', '按首次首播日期筛选，旧剧新季不计入近期新剧。');
      if (data.partial) $('home-notice').innerHTML = `<div class="partial-note">${data.notices.map(escape).join('；')}。<button type="button" class="text-button" id="home-retry">重试加载</button></div>`;
    } catch (error) {
      $('home-notice').innerHTML = `<div class="error-banner">${escape(error.message)} <button type="button" id="home-retry">重试加载</button><a href="#search">直接搜索资源 ↗</a></div>`;
      for (const id of ['home-trending', 'home-movies', 'home-series']) $(id).innerHTML = empty('片单暂未加载', '影视数据恢复后可重试，网盘资源搜索仍可使用。');
    } finally { state.homeController = null; $('home-hero').setAttribute('aria-busy', 'false'); }
  }
  $('home-notice').addEventListener('click', async event => { if (event.target.closest('#home-retry')) { await readConfig(); loadHome(); } });

  function setControl(id, value) {
    const control = $(id);
    if (control instanceof HTMLSelectElement && ![...control.options].some(option => option.value === value)) control.add(new Option(`${value} 分以上`, value));
    control.value = value || '';
  }
  function syncControls() {
    const c = state.catalog;
    for (const [id, key] of Object.entries({ 'discover-type': 'type', 'discover-region': 'region', 'discover-period': 'period', 'discover-sort': 'sort', 'discover-votes': 'minVotes', 'discover-rating': 'minRating', 'discover-from': 'from', 'discover-to': 'to' })) setControl(id, c[key]);
    $('discover-custom-dates').hidden = c.period !== 'custom';
    $('catalog-types').innerHTML = Object.entries(typeLabels).map(([type, label]) => `<button type="button" class="type-tab ${c.type === type ? 'selected' : ''}" data-type="${type}" aria-pressed="${c.type === type}">${label}</button>`).join('');
    const global = c.region === 'all';
    $('discover-region').options[0].textContent = c.platform === 'all' ? '不限' : '跨地区（合并片库）';
    $('streaming-platforms').innerHTML = [{ id: 'all', name: '全部平台' }, ...(state.config?.platforms || [])].map(p => `<button type="button" class="streaming-chip ${c.platform === p.id ? 'selected' : ''}" data-streamer="${escape(p.id)}" aria-pressed="${c.platform === p.id}">${escape(p.name)}</button>`).join('');
    $('discover-region-hint').hidden = !global;
    const regionNames = Object.entries(state.config?.regions || {}).filter(([code]) => code !== 'all').map(([, name]) => name);
    $('discover-region-hint').textContent = c.platform === 'all' ? '地区不限时展示全球作品，选择平台可直接浏览跨地区片库。' : `合并${regionNames.join('、')}的片库并去重；也可选择具体地区缩小范围。`;
    const parts = [typeLabels[c.type], global ? (c.platform === 'all' ? '不限地区' : '跨地区') : state.config?.regions[c.region], c.platform === 'all' ? '全部平台' : state.config?.platforms.find(p => p.id === c.platform)?.name, state.config?.periods[c.period]];
    if (c.period === 'custom') parts.push(`${c.from || '选择开始日期'} — ${c.to || '选择结束日期'}`);
    if (Number(c.minRating)) parts.push(`${c.minRating} 分以上`);
    if (Number(c.minVotes)) parts.push(`至少 ${c.minVotes} 人评分`);
    parts.push({ rating: '评分 ↓', rating_asc: '评分 ↑', newest: '最新上映' }[c.sort]);
    $('catalog-selected').textContent = parts.filter(Boolean).join(' · ');
    const count = Object.keys(CATALOG_DEFAULTS).filter(key => c[key] !== CATALOG_DEFAULTS[key]).length;
    $('catalog-filter-count').textContent = count ? `${count} 项已调整` : '';
  }
  function collect() {
    const c = { ...state.catalog };
    for (const [id, key] of Object.entries({ 'discover-type': 'type', 'discover-region': 'region', 'discover-period': 'period', 'discover-sort': 'sort', 'discover-votes': 'minVotes', 'discover-rating': 'minRating', 'discover-from': 'from', 'discover-to': 'to' })) c[key] = $(id).value;
    if (c.period !== 'custom') { delete c.from; delete c.to; }
    return c;
  }
  function commit(c) {
    rememberCatalog();
    const hash = catalogHash(c);
    if (location.hash !== hash) location.hash = hash;
    else { state.catalog = c; syncControls(); loadCatalog(); }
  }
  function renderCatalog() {
    $('discover-results').innerHTML = state.items.length ? state.items.map(item => poster(item, true)).join('') : empty('这个条件下还没有作品', '试试更长的时间范围、其他类型或地区，或降低最低评分和评分人数。');
    $('discover-more').hidden = !state.hasMore;
    $('discover-title').textContent = `${state.config?.periods[state.catalog.period] || ''} · ${typeLabels[state.catalog.type]}`;
    $('discover-summary').textContent = state.regionMode === 'combined'
      ? `合并 ${state.queriedRegions.length} 个地区片库 · 地区命中合计 ${state.total} 条（含重复） · 已显示 ${state.items.length} 部去重作品 · TMDb 评分`
      : `来源命中 ${state.total} 部 · 已显示 ${state.items.length} 部 · 评分来自 TMDb`;
  }
  async function loadCatalog({ append = false } = {}) {
    state.controller?.abort();
    const c = { ...state.catalog }; const key = catalogHash(c);
    const page = append ? state.page + 1 : 1;
    const controller = new AbortController(); state.controller = controller;
    $('discover-notice').textContent = '';
    $('discover-results').setAttribute('aria-busy', 'false'); $('discover-more').disabled = false; $('discover-refresh').disabled = false;
    if (!append) { state.items = []; state.hasMore = false; $('discover-more').hidden = true; }
    if (c.period === 'custom' && (!c.from || !c.to || !$('discover-from').checkValidity() || !$('discover-to').checkValidity() || c.from > c.to)) {
      $('discover-notice').innerHTML = '<div class="partial-note">请填写有效的开始和结束日期，再点击“应用日期”。</div>';
      $('discover-results').innerHTML = empty('选择日期范围', '开始日期不能晚于结束日期，结束日期不能晚于今天。');
      $('discover-summary').textContent = '等待应用有效日期'; return;
    }
    $('discover-results').setAttribute('aria-busy', 'true'); $('discover-more').disabled = true; $('discover-refresh').disabled = true;
    $('discover-summary').textContent = '正在查询影视片库…';
    if (!append) $('discover-results').innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton-card movie-skeleton"><div></div><div></div></div>').join('');
    try {
      if (!state.config?.enabled) throw new Error('影视数据服务尚未连接，请在服务端配置 TMDb 访问凭据后重试。');
      const response = await fetch(`/api/discover?${new URLSearchParams({ ...c, page: String(page) })}`, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '影视片库暂时不可用');
      if (state.controller !== controller) return;
      state.items = sortCatalogItems([...new Map((append ? [...state.items, ...data.items] : data.items).map(item => [item.id, item])).values()], c.sort);
      state.page = page; state.total = data.total; state.hasMore = data.hasMore; state.key = key;
      state.regionMode = data.regionMode || null; state.queriedRegions = data.queriedRegions || []; state.notice = data.reason || '';
      renderCatalog();
      if (data.reason) $('discover-notice').innerHTML = `<div class="partial-note">${escape(data.reason)}</div>`;
      if (state.cache.size >= 12 && !state.cache.has(key)) state.cache.delete(state.cache.keys().next().value);
      state.cache.set(key, { items: [...state.items], page, total: state.total, hasMore: state.hasMore, scroll: append ? window.scrollY : 0, regionMode: state.regionMode, queriedRegions: [...state.queriedRegions], notice: state.notice });
    } catch (error) {
      if (error.name === 'AbortError' || state.controller !== controller) return;
      $('discover-notice').innerHTML = `<div class="error-banner">${escape(error.message)}</div>`;
      $('discover-summary').textContent = append ? `已保留 ${state.items.length} 部作品，下一页加载失败，可重试。` : '未能取得片库数据，可重新加载。';
      if (!append) $('discover-results').innerHTML = empty('暂时无法加载影视片库', '网盘资源搜索仍可使用。');
    } finally {
      if (state.controller === controller) { $('discover-results').setAttribute('aria-busy', 'false'); $('discover-more').disabled = false; $('discover-refresh').disabled = false; }
    }
  }
  $('catalog-types').addEventListener('click', event => { const button = event.target.closest('[data-type]'); if (button) commit({ ...state.catalog, type: button.dataset.type }); });
  $('streaming-platforms').addEventListener('click', event => {
    const button = event.target.closest('[data-streamer]'); if (!button) return;
    commit({ ...state.catalog, platform: button.dataset.streamer });
  });
  $('discover-filters').addEventListener('submit', event => event.preventDefault());
  $('discover-filters').addEventListener('change', event => {
    const c = collect();
    $('discover-custom-dates').hidden = c.period !== 'custom';
    if (['discover-from', 'discover-to'].includes(event.target.id)) return;
    commit(c);
  });
  $('discover-apply-dates').addEventListener('click', () => commit(collect()));
  $('catalog-reset').addEventListener('click', () => commit({ ...CATALOG_DEFAULTS }));
  $('discover-more').addEventListener('click', () => loadCatalog({ append: true }));
  $('discover-refresh').addEventListener('click', async () => { await readConfig(); loadCatalog(); });

  function route() {
    if (!state.config) return;
    const view = pageFromLocation(location.hash, location.search);
    const entering = state.view !== view;
    state.view = view;
    if (view === 'home') { if (!state.homeLoaded) loadHome(); if (entering) window.scrollTo({ top: 0 }); }
    if (view !== 'discover') return;
    const c = parseCatalog(location.hash); const key = catalogHash(c);
    if (!entering && key === catalogHash(state.catalog)) return;
    state.catalog = c; syncControls();
    const saved = state.cache.get(key);
    $('discover-notice').textContent = '';
    if (saved) {
      state.controller?.abort();
      Object.assign(state, { items: [...saved.items], page: saved.page, total: saved.total, hasMore: saved.hasMore, key, regionMode: saved.regionMode, queriedRegions: saved.queriedRegions, notice: saved.notice });
      $('discover-results').setAttribute('aria-busy', 'false'); $('discover-refresh').disabled = false; $('discover-more').disabled = false;
      renderCatalog();
      if (state.notice) $('discover-notice').innerHTML = `<div class="partial-note">${escape(state.notice)}</div>`;
      requestAnimationFrame(() => window.scrollTo({ top: saved.scroll }));
    } else { state.key = ''; loadCatalog(); if (entering) window.scrollTo({ top: 0 }); }
  }
  async function readConfig() {
    try {
      const response = await fetch('/api/discover/config');
      if (!response.ok) throw new Error('无法读取影视服务配置');
      state.config = await response.json();
      $('discover-from').max = state.config.today; $('discover-to').max = state.config.today;
      homeHubs(); return true;
    } catch {
      state.config = { enabled: false, regions: {}, periods: {}, platforms: [] };
      return false;
    }
  }
  const mobileQuery = window.matchMedia('(max-width: 767px)');
  const adaptFilters = () => { $('catalog-filter-panel').open = !mobileQuery.matches; };
  adaptFilters();
  mobileQuery.addEventListener('change', adaptFilters);
  addEventListener('panmi:viewchange', route);
  readConfig().then(() => { syncControls(); route(); });
}
