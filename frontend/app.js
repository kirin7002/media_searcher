import { PLATFORMS, safeShareUrl, mergeItems } from './shared.js';
import { initDiscovery } from './discover.js';

const $ = id => document.getElementById(id);
const icons = {
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"/>',
  link: '<path d="m10 13 4-4m-5 7-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2-1 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  folder: '<path d="M3 7V4h6l3 3h9v14H3z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c6 6 6 12 0 18-6-6-6-12 0-18"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.link}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const readStored = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } };
const writeStored = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { toast('浏览器未允许保存本地数据'); } };
const initialFavorites = readStored('panmi:favorites', []);
const favorites = new Map((Array.isArray(initialFavorites) ? initialFavorites : []).filter(item => item && safeShareUrl(item.url) && typeof item.title === 'string' && Array.isArray(item.sources)).map(item => [item.id, item]));
const state = { view: 'search', query: '', platform: 'all', sort: 'latest', page: 1, items: [], providers: [], selected: [], checkingEnabled: false, hasMore: false, busy: false, controller: null, urlKey: location.search };
const labels = { unchecked: '未检测', valid: '链接有效', invalid: '链接失效', locked: '需要提取码', unknown: '未确认', checking: '检测中' };
let toastTimer;
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2500); }

const sites = [
  { name: 'PanSearch', website: 'https://www.pansearch.me/', tag: '网盘搜索', description: '提供百度、夸克、阿里和迅雷等网盘的网页搜索入口。' },
  { name: '轻搜搜', website: 'https://sosopx.com/', tag: '网盘搜索', description: '可通过网页搜索百度、夸克等网盘分享索引。' },
  { name: '小鸡窝', website: 'https://xiaojiwo.sylu.net/', tag: '分享索引', description: '通过分类、搜索和详情页寻找公开分享信息。' },
  { name: '人人电影网', website: 'https://www.rrdynb.com/index.html', tag: '影视目录', description: '浏览影视条目，查看详情中的资源说明和分享入口。' },
  { name: '易搜', website: 'https://yiso.eu.org/', tag: '待核实', description: '地址发布页；本轮访问受限，当前可用性尚未确认。' },
  { name: '混合盘', website: 'https://hunhepan.com/', tag: '待核实', description: '聚合搜索入口；本轮访问异常，当前可用性尚未确认。' }
];

function platformTabs() {
  const primary = ['all', 'quark', 'baidu', 'aliyun', 'xunlei'];
  $('platform-tabs').innerHTML = primary.map(p => `<button type="button" data-platform="${p}" class="platform-tab ${state.platform === p ? 'selected' : ''}" aria-pressed="${state.platform === p}">${p === 'all' ? '全部网盘' : escape(PLATFORMS[p].short)}</button>`).join('') + `<label class="sr-only" for="more-platforms">更多网盘</label><select id="more-platforms" class="more-platforms ${!primary.includes(state.platform) ? 'selected' : ''}"><option value="all">更多网盘</option>${Object.entries(PLATFORMS).filter(([p]) => !primary.includes(p)).map(([p, details]) => `<option value="${p}" ${state.platform === p ? 'selected' : ''}>${escape(details.name)}</option>`).join('')}</select>`;
}

function sourceOptions() {
  $('source-options').innerHTML = state.providers.map(p => `<label class="source-checkbox ${p.enabled ? '' : 'disabled'}" title="${escape(p.disabledReason || p.description)}"><input type="checkbox" value="${p.id}" ${state.selected.includes(p.id) ? 'checked' : ''} ${p.enabled ? '' : 'disabled'}><span>${escape(p.name)}</span>${p.enabled ? '' : '<span class="source-lock">未配置</span>'}</label>`).join('');
}

function renderDirectories() {
  $('provider-directory').innerHTML = state.providers.map(p => `<article class="source-card"><div class="source-card-head"><span class="directory-icon">${icon('layers')}</span><span class="badge ${p.enabled ? 'green' : 'neutral'}">${p.enabled ? '已接入' : '待配置'}</span></div><h3>${escape(p.name)}</h3><p>${escape(p.description)}</p><div class="source-card-bottom"><span>${p.enabled ? (p.supportsCheck ? '搜索 · 链接检测' : '搜索 · 分页') : escape(p.disabledReason)}</span><a href="${escape(p.website)}" target="_blank" rel="noopener noreferrer" aria-label="访问${escape(p.name)}">↗</a></div></article>`).join('');
  $('site-directory').innerHTML = sites.map(p => `<article class="source-card"><div class="source-card-head"><span class="directory-icon light">${icon('globe')}</span><span class="badge neutral">${p.tag}</span></div><h3>${p.name}</h3><p>${p.description}</p><div class="source-card-bottom"><span>${new URL(p.website).hostname}</span><a href="${p.website}" target="_blank" rel="noopener noreferrer" aria-label="访问${p.name}">↗</a></div></article>`).join('');
}

function suggestions() {
  const history = readStored('panmi:history', []);
  const words = Array.isArray(history) && history.some(s => typeof s === 'string') ? history.filter(s => typeof s === 'string').slice(0, 5) : ['Python', '摄影教程', '公开课', '电子书'];
  $('suggestion-label').textContent = Array.isArray(history) && history.length ? '最近搜索' : '试着搜';
  $('suggestion-list').innerHTML = words.map(q => `<button type="button" data-query="${escape(q)}">${escape(q)}<span>↗</span></button>`).join('');
}

function card(item) {
  const platform = PLATFORMS[item.platform] || { name: '网盘', letter: '盘', color: 'blue' };
  const saved = favorites.has(item.id);
  const sourceText = [...new Set(item.sources.map(s => s.name))].join('、');
  const published = item.publishedAt ? new Date(item.publishedAt).toLocaleDateString('zh-CN') : '日期未提供';
  const metadata = [item.size, item.quality, item.fileCount ? `${item.fileCount} 个文件` : ''].filter(Boolean);
  return `<article class="result-card"><div class="card-top"><span class="disk-icon ${platform.color}">${escape(platform.letter)}</span><div class="card-labels"><span>${escape(platform.name)}</span><span class="link-status ${escape(item.linkState || 'unknown')}">${escape(labels[item.linkState] || '未检测')}</span></div><button type="button" class="icon-button favorite-button ${saved ? 'saved' : ''}" data-action="favorite" data-id="${escape(item.id)}" aria-label="${saved ? '取消收藏' : '收藏资源'}" aria-pressed="${saved}">${icon('bookmark')}</button></div><h3 title="${escape(item.title)}">${escape(item.title)}</h3><div class="card-tags">${metadata.length ? metadata.map(t => `<span>${escape(t)}</span>`).join('') : '<span>公开分享</span>'}</div><div class="card-meta"><span title="${escape(sourceText)}">来自 ${escape(sourceText)}</span><span>${escape(published)}</span></div>${item.password ? `<div class="password-line"><span>提取码</span><button data-action="password" data-id="${escape(item.id)}" aria-label="复制提取码 ${escape(item.password)}">${escape(item.password)}${icon('copy')}</button></div>` : '<div class="password-line no-password">来源未提供提取码</div>'}<div class="card-actions"><a href="${escape(item.url)}" class="open-link" target="_blank" rel="noopener noreferrer">打开网盘<span>↗</span></a><button class="icon-button" data-action="copy" data-id="${escape(item.id)}" aria-label="复制分享链接">${icon('copy')}</button><button class="icon-button" data-action="check" data-id="${escape(item.id)}" aria-label="检测链接" ${!state.checkingEnabled || item.linkState === 'checking' ? 'disabled' : ''} title="${state.checkingEnabled ? '检测链接有效性' : '配置 PanSou 或海搜后可检测'}">${icon('check')}</button></div></article>`;
}

function empty(iconName, title, description) {
  return `<div class="empty-state"><span class="empty-icon">${icon(iconName)}</span><h3>${escape(title)}</h3><p>${escape(description)}</p></div>`;
}

function renderResults() {
  $('results').innerHTML = state.items.length ? state.items.map(card).join('') : empty('search', state.query ? '没有找到匹配的链接' : '你想找什么？', state.query ? '试试更短的关键词，或切换网盘和搜索来源。' : '输入关键词搜索，也可以从上面的推荐词开始。');
  $('load-more').hidden = !state.hasMore;
  $('load-more').disabled = state.busy;
  $('favorite-count').textContent = favorites.size;
}

function renderFavorites() {
  $('favorite-count').textContent = favorites.size;
  $('favorites-title').textContent = `收藏的资源 · ${favorites.size}`;
  $('export-favorites').disabled = !favorites.size;
  $('favorites-results').innerHTML = favorites.size ? [...favorites.values()].map(card).join('') : empty('bookmark', '还没有收藏', '搜索资源后，点击卡片右上角的收藏图标。');
}

function setView() {
  const view = location.hash.slice(1);
  state.view = ['search', 'favorites', 'sources', 'discover'].includes(view) ? view : 'search';
  for (const name of ['search', 'favorites', 'sources', 'discover']) $(`${name}-view`).hidden = name !== state.view;
  document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === state.view));
  $('breadcrumb').innerHTML = `工作台 <span>/</span> ${{ search: '资源搜索', favorites: '我的收藏', sources: '搜索来源', discover: '近期上映' }[state.view]}`;
  if (state.view === 'favorites') renderFavorites();
}

function updateUrl() {
  const params = new URLSearchParams();
  if (state.query) params.set('q', state.query);
  if (state.platform !== 'all') params.set('pan', state.platform);
  if (state.sort !== 'latest') params.set('sort', state.sort);
  if (state.selected.length) params.set('sources', state.selected.join(','));
  const suffix = params.toString();
  history.pushState(null, '', `${location.pathname}${suffix ? '?' + suffix : ''}#search`);
  state.urlKey = location.search;
  setView();
}

function showStatuses(data) {
  $('search-notices').innerHTML = data.sources.map(source => `<span class="source-response ${source.state === 'error' ? 'error' : ''}"><span class="status-dot ${source.state === 'error' ? 'warning' : 'connected'}"></span>${escape(source.name)} · ${source.state === 'error' ? escape(source.message) : source.blocked ? '来源限制了该关键词' : `${source.total} 条${source.cached ? ' · 缓存' : ''}`}</span>`).join('') + (data.failed ? '<div class="error-banner">搜索来源暂时不可用。<button id="retry-search">重试搜索</button></div>' : data.partial ? '<div class="partial-note">部分来源暂时不可用，已显示其他来源的结果。</div>' : '');
}

async function search({ append = false, url = true } = {}) {
  if (!state.query.trim()) return;
  if (!state.selected.length) { toast('请至少选择一个搜索来源'); return; }
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  state.busy = true;
  const page = append ? state.page + 1 : 1;
  if (!append) { state.page = 1; state.items = []; state.hasMore = false; }
  if (url && !append) updateUrl();
  $('results').setAttribute('aria-busy', 'true');
  $('results-title').textContent = `“${state.query}” 的搜索结果`;
  $('results-summary').textContent = '正在查询所选来源…';
  $('load-more').disabled = true;
  if (!append) {
    $('search-notices').textContent = '';
    $('load-more').hidden = true;
    $('results').innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton-card"><div></div><div></div><div></div></div>').join('');
  }
  try {
    const params = new URLSearchParams({ q: state.query, pan: state.platform, sort: state.sort, page: String(page), sources: state.selected.join(',') });
    const response = await fetch(`/api/search?${params}`, { signal: controller.signal });
    const data = await response.json();
    if (controller !== state.controller) return;
    if (!Array.isArray(data.items)) throw new Error(data.error || '搜索失败，请稍后重试');
    showStatuses(data);
    if (data.failed) {
      if (!append) $('results').innerHTML = empty('globe', '暂时无法连接搜索来源', '可以稍后重试，或在搜索来源页直接访问网站。');
      $('results-summary').textContent = append ? `已保留 ${state.items.length} 个链接，本页加载失败` : '此次查询未成功，页面未使用演示数据。';
      return;
    }
    state.items = mergeItems(append ? [...state.items, ...data.items] : data.items);
    state.page = page; state.hasMore = data.hasMore;
    renderResults();
    $('results-summary').textContent = `已显示 ${state.items.length} 个去重链接 · 来源命中 ${data.sourceTotal} 条 · ${(data.durationMs / 1000).toFixed(1)} 秒`;
    const previous = readStored('panmi:history', []);
    writeStored('panmi:history', [state.query, ...(Array.isArray(previous) ? previous.filter(q => q !== state.query && typeof q === 'string') : [])].slice(0, 5));
    suggestions();
  } catch (error) {
    if (error.name === 'AbortError' || controller !== state.controller) return;
    $('search-notices').innerHTML = `<div class="error-banner">${escape(error.message)}<button id="retry-search">重试搜索</button></div>`;
    $('results-summary').textContent = '查询未成功，请检查服务连接后重试。';
    if (!append) $('results').innerHTML = empty('globe', '搜索遇到了一点问题', '请稍后重试。已有收藏仍然可以查看。');
  } finally {
    if (controller === state.controller) {
      state.busy = false;
      $('results').setAttribute('aria-busy', 'false');
      $('load-more').disabled = false;
    }
  }
}

async function copy(value) {
  try { await navigator.clipboard.writeText(value); toast('已复制'); }
  catch { $('copy-value').value = value; $('copy-dialog').showModal(); $('copy-value').select(); }
}

document.addEventListener('click', async event => {
  const queryButton = event.target.closest('[data-query]');
  if (queryButton) { $('query').value = queryButton.dataset.query; state.query = queryButton.dataset.query; search(); }
  const platformButton = event.target.closest('[data-platform]');
  if (platformButton) { state.platform = platformButton.dataset.platform; platformTabs(); if (state.query) search(); }
  if (event.target.closest('#retry-search')) search({ append: state.items.length > 0 });
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const item = state.items.find(i => i.id === button.dataset.id) || favorites.get(button.dataset.id);
  if (!item) return;
  if (button.dataset.action === 'favorite') {
    if (favorites.has(item.id)) favorites.delete(item.id); else favorites.set(item.id, { ...item, linkState: 'unchecked' });
    writeStored('panmi:favorites', [...favorites.values()]); renderResults(); renderFavorites();
  } else if (button.dataset.action === 'copy') await copy(`${item.title}\n${item.url}${item.password ? '\n提取码：' + item.password : ''}`);
  else if (button.dataset.action === 'password') await copy(item.password);
  else if (button.dataset.action === 'check' && state.checkingEnabled) {
    item.linkState = 'checking'; renderResults(); renderFavorites();
    try {
      const response = await fetch('/api/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: item.url, password: item.password }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '检测暂时不可用');
      item.linkState = result.state; item.checkedAt = result.checkedAt;
      if (favorites.has(item.id)) favorites.set(item.id, { ...favorites.get(item.id), linkState: item.linkState, checkedAt: item.checkedAt });
      toast(`${labels[result.state] || '未确认'} · ${result.provider}`);
    } catch (error) { item.linkState = 'unknown'; toast(error.message); }
    renderResults(); renderFavorites();
  }
});

$('search-form').addEventListener('submit', event => { event.preventDefault(); state.query = $('query').value.trim(); search(); });
$('platform-tabs').addEventListener('change', event => { if (event.target.id === 'more-platforms') { state.platform = event.target.value; platformTabs(); if (state.query) search(); } });
$('sort').addEventListener('change', event => { state.sort = event.target.value; if (state.query) search(); });
$('source-options').addEventListener('change', event => {
  const selected = [...$('source-options').querySelectorAll('input:checked')].map(el => el.value);
  if (!selected.length) { event.target.checked = true; toast('至少保留一个搜索来源'); return; }
  state.selected = selected; if (state.query) search();
});
$('load-more').addEventListener('click', () => search({ append: true }));
$('close-copy').addEventListener('click', () => $('copy-dialog').close());
$('export-favorites').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify([...favorites.values()], null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'panmi-favorites.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
addEventListener('hashchange', setView);
addEventListener('popstate', () => {
  // Hash-only navigation switches views without reissuing paid or slow queries.
  if (state.urlKey !== location.search) {
    restoreUrl();
    if (state.query) search({ url: false });
    else {
      state.controller?.abort(); state.items = []; state.hasMore = false; state.busy = false;
      $('results').setAttribute('aria-busy', 'false'); $('search-notices').textContent = '';
      $('results-title').textContent = '从一个关键词开始';
      $('results-summary').textContent = '搜索公开分享链接，找到后直接打开网盘。';
      renderResults();
    }
  }
  setView();
});

function restoreUrl() {
  state.urlKey = location.search;
  const params = new URLSearchParams(location.search);
  state.query = (params.get('q') || '').slice(0, 60);
  state.platform = Object.hasOwn(PLATFORMS, params.get('pan')) ? params.get('pan') : 'all';
  state.sort = params.get('sort') === 'hot' ? 'hot' : 'latest';
  const desired = (params.get('sources') || '').split(',');
  state.selected = state.providers.filter(p => p.enabled && desired.includes(p.id)).map(p => p.id);
  if (!state.selected.length) state.selected = state.providers.filter(p => p.enabled).map(p => p.id);
  $('query').value = state.query; $('sort').value = state.sort; platformTabs(); sourceOptions();
}

async function initialize() {
  platformTabs(); suggestions(); renderResults(); renderFavorites(); setView();
  try {
    const response = await fetch('/api/sources');
    if (!response.ok) throw new Error();
    const data = await response.json();
    state.providers = data.sources; state.checkingEnabled = data.checkingEnabled;
    $('service-state').textContent = '服务运行中'; $('service-dot').classList.add('connected');
    restoreUrl(); renderDirectories(); renderFavorites();
    if (state.query) await search({ url: false });
  } catch {
    $('service-state').textContent = '服务连接失败'; $('service-dot').classList.add('warning');
    $('search-notices').innerHTML = '<div class="error-banner">暂时无法连接后端服务，请刷新页面重试。</div>';
  }
}
initialize().then(() => initDiscovery({
  icon, escape,
  onSearch(title) {
    state.query = [...title].slice(0, 60).join('');
    $('query').value = state.query;
    state.platform = 'all'; platformTabs();
    search(); window.scrollTo({ top: 0 });
  }
}));
