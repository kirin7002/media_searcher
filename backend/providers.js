import { safeShareUrl, mergeItems } from '../frontend/shared.js';
import { createXiaojiwo } from './xiaojiwo.js';
import { createLightsearch } from './stream-source.js';
import { createPublicProviders } from './public-sources.js';

const text = (value, limit = 500) => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').trim().slice(0, limit) : '';
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

export function normalizeItem(raw, source) {
  if (!raw || typeof raw !== 'object') return null;
  const share = safeShareUrl(raw.share_url || raw.shareUrl || raw.url);
  const title = text(raw.title || raw.note || raw.work_title, 250);
  if (!share || !title) return null;
  const password = text(raw.access_code || raw.sharePwd || raw.password || share.password, 64);
  return {
    id: share.id, title, platform: share.platform, url: share.url, password,
    size: text(raw.size_text || raw.size, 50) || (Number(raw.sizeBytes) > 0 ? formatSize(Number(raw.sizeBytes)) : ''),
    quality: text(raw.quality, 30),
    description: text(raw.description, 300),
    publishedAt: date(raw.published_at || raw.datetime),
    fileCount: Number.isSafeInteger(Number(raw.fileCount || raw.file_count)) && Number(raw.fileCount || raw.file_count) > 0 ? Number(raw.fileCount || raw.file_count) : null,
    linkState: 'unchecked',
    sources: [{ id: source.id, name: source.name, url: share.url, password, ...(raw.sourcePage ? { pageUrl: raw.sourcePage } : {}) }]
  };
}

function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  while (bytes >= 1024 && index < 4) { bytes /= 1024; index++; }
  return `${bytes.toFixed(index ? 1 : 0)} ${units[index]}`;
}

export class UpstreamError extends Error {
  constructor(message) { super(message); this.name = 'UpstreamError'; }
}

async function requestBody(fetchImpl, url, options, timeout, acceptedStatuses = []) {
  try {
    const response = await fetchImpl(url, {
      ...options, headers: { Accept: 'application/json', 'User-Agent': 'MediaSearcher/1.0', ...options?.headers },
      signal: AbortSignal.timeout(timeout), redirect: 'error'
    });
    if (!response.ok && !acceptedStatuses.includes(response.status)) throw new UpstreamError(`来源返回 HTTP ${response.status}`);
    let length = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 4 * 1024 * 1024) { await response.body.cancel?.().catch(() => {}); throw new UpstreamError('来源响应过大'); }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    if (['TimeoutError', 'AbortError'].includes(error.name)) throw new UpstreamError('来源响应超时，请稍后重试');
    if (error instanceof SyntaxError) throw new UpstreamError('来源未返回有效的 JSON 数据');
    throw new UpstreamError('暂时无法连接该来源，请稍后重试');
  }
}

export async function requestJson(fetchImpl, url, options, timeout, acceptedStatuses = []) {
  try { return JSON.parse(await requestBody(fetchImpl, url, options, timeout, acceptedStatuses)); }
  catch (error) {
    if (error instanceof SyntaxError) throw new UpstreamError('来源未返回有效的 JSON 数据');
    throw error;
  }
}

export async function requestText(fetchImpl, url, options, timeout) {
  return requestBody(fetchImpl, url, { ...options, headers: { Accept: 'text/html', ...options?.headers } }, timeout);
}

// Rank literal title matches only; unrelated records never enter the retained shortlist.
export function relevantHaisouItems(items, query, limit = 12) {
  const compact = value => value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}+#]/gu, '');
  const phrase = compact(query);
  const terms = query.normalize('NFKC').toLocaleLowerCase('en-US').match(/[\p{L}\p{N}+#]+/gu) || [];
  if (!phrase || !terms.length) return [];
  const ranked = items.map((item, index) => {
    const title = compact(item.title);
    const matches = terms.every(term => title.includes(compact(term)));
    const score = title === phrase ? 3 : title.startsWith(phrase) ? 2 : title.includes(phrase) ? 1 : 0;
    return { item, index, matches, score, extra: Math.max(0, title.length - phrase.length) };
  }).filter(row => row.matches).sort((a, b) => b.score - a.score || a.extra - b.extra || a.index - b.index)
    .map(row => row.item);
  return mergeItems(ranked).slice(0, limit);
}

export function createProviders(config, fetchImpl = fetch) {
  const pansousuo = {
    id: 'pansousuo', name: '盘搜索', enabled: true, website: 'https://www.pansousuo.com/',
    description: '公开分享索引，支持关键词、网盘筛选和分页。', supportsCheck: false, supportsPagination: true,
    async search({ query, platform, page, sort }) {
      const url = new URL('/api/search', config.pansousuoBaseUrl);
      url.searchParams.set('q', query); url.searchParams.set('p', page); url.searchParams.set('sort', sort);
      if (platform !== 'all') url.searchParams.set('pan', platform);
      const data = await requestJson(fetchImpl, url, {}, config.timeoutMs);
      if (!Array.isArray(data.items) || !Number.isFinite(Number(data.total))) throw new UpstreamError('来源数据格式发生变化');
      return { items: data.items.map(r => normalizeItem(r, pansousuo)).filter(Boolean), total: Number(data.total), hasMore: page < Number(data.totalPages || 1), blocked: Boolean(data.blocked) };
    }
  };
  const pansou = {
    id: 'pansou', name: 'PanSou 聚合', enabled: Boolean(config.pansouBaseUrl), website: 'https://github.com/fish2018/pansou',
    description: '连接你部署的 PanSou，聚合多个网站与公开频道。', disabledReason: '尚未配置 PanSou 服务地址', supportsCheck: Boolean(config.pansouBaseUrl), supportsPagination: false,
    async search({ query, platform, page }) {
      if (page > 1) return { items: [], total: 0, hasMore: false };
      const data = await requestJson(fetchImpl, new URL('/api/search', config.pansouBaseUrl), {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(config.pansouToken ? { Authorization: `Bearer ${config.pansouToken}` } : {}) },
        body: JSON.stringify({ kw: query, res: 'merge', ...(platform !== 'all' ? { cloud_types: [platform] } : {}) })
      }, config.timeoutMs);
      if (!data.merged_by_type || typeof data.merged_by_type !== 'object' || Array.isArray(data.merged_by_type)) throw new UpstreamError('PanSou 返回了错误或数据格式发生变化');
      const rows = Object.values(data.merged_by_type).flat().slice(0, 300);
      return { items: rows.map(r => normalizeItem(r, pansou)).filter(Boolean), total: rows.length, hasMore: false };
    },
    async check(url, password) {
      const share = safeShareUrl(url);
      const data = await requestJson(fetchImpl, new URL('/api/check/links', config.pansouBaseUrl), {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(config.pansouToken ? { Authorization: `Bearer ${config.pansouToken}` } : {}) },
        body: JSON.stringify({ items: [{ disk_type: share.platform, url, password }] })
      }, config.timeoutMs);
      const row = data.results?.[0];
      if (!row || typeof row.state !== 'string') throw new UpstreamError('PanSou 检测结果格式发生变化');
      return { state: ({ ok: 'valid', bad: 'invalid', locked: 'locked' })[row.state] || 'unknown' };
    }
  };
  const haisou = {
    id: 'haisou', name: '海搜', enabled: Boolean(config.haisouApiKey), website: 'https://haisou.cc/',
    description: '保留标题相关性最高的至多 12 个分享，可检测有效性。', disabledReason: '尚未配置海搜 API key', supportsCheck: Boolean(config.haisouApiKey), supportsPagination: false,
    async search({ query, platform, page }) {
      const platformAlias = { aliyun: 'ali', mobile: 'yidong' };
      const supported = ['all', 'aliyun', 'baidu', 'quark', 'xunlei', 'tianyi', 'mobile', '115', '123', 'uc'];
      if (page > 1 || !supported.includes(platform)) return { items: [], total: 0, hasMore: false };
      const data = await haisouRequest('search', { query, page, pageSize: 30, searchIn: 'title', ...(platform !== 'all' ? { platforms: [platformAlias[platform] || platform] } : {}) });
      if (!Array.isArray(data.items) || !data.pagination) throw new UpstreamError('海搜数据格式发生变化');
      const items = relevantHaisouItems(data.items.map(r => normalizeItem(r, haisou)).filter(Boolean), query);
      return { items, total: items.length, totalType: 'selected', hasMore: false, note: '仅保留相关性最高的至多 12 条' };
    },
    async check(url, password) {
      const data = await haisouRequest('validate', { url, pwd: password });
      if (typeof data.valid !== 'boolean' && typeof data.status !== 'string') throw new UpstreamError('海搜检测结果格式发生变化');
      let state = 'unknown';
      if (data.status === 'valid' || data.valid === true) state = 'valid';
      else if (['invalid', 'expired', 'deleted'].includes(data.status)) state = 'invalid';
      else if (['locked', 'password_required', 'password_error'].includes(data.status)) state = 'locked';
      return { state };
    }
  };
  async function haisouRequest(endpoint, body) {
    const url = new URL(`https://apiok.us/api/b9d1/${endpoint}`);
    url.searchParams.set('apikey', config.haisouApiKey);
    const data = await requestJson(fetchImpl, url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, config.haisouTimeoutMs);
    if (data.code !== 0) throw new UpstreamError(({ 1004: '海搜 API key 权限不足', 1005: '海搜额度不足', 1003: '海搜繁忙，请稍后重试' })[data.code] || '海搜接口调用失败');
    return data.result;
  }
  const qiling = {
    id: 'qiling', name: '起零数据', enabled: Boolean(config.qilingToken), website: 'https://api.istero.com/service/doc/pan-resource-search',
    description: '通过开放接口搜索阿里、夸克、百度和迅雷分享；不提供分页，时间按来源实际字段展示。',
    disabledReason: '尚未配置起零数据 API Token', supportsCheck: false, supportsPagination: false,
    async search({ query, platform, page }) {
      const disks = { aliyun: '0', quark: '1', baidu: '2', xunlei: '3' };
      const empty = { items: [], total: 0, totalType: 'records', hasMore: false };
      if (page > 1 || (platform !== 'all' && !Object.hasOwn(disks, platform))) return empty;
      const url = new URL('https://api.istero.com/resource/v1/disk/source/search');
      url.searchParams.set('keywords', query);
      if (platform !== 'all') url.searchParams.set('disk', disks[platform]);
      const data = await requestJson(fetchImpl, url, { headers: { Authorization: `Bearer ${config.qilingToken}` } }, config.qilingTimeoutMs, [400, 401, 403, 404, 429, 500, 502]);
      const code = Number(data?.code);
      // This API reports an ordinary search miss as HTTP/business 400.
      if (code === 400 && data.message === '未找到相关网盘资源' && (!data.data || (Array.isArray(data.data) && !data.data.length))) return empty;
      if (code !== 200) throw new UpstreamError(({
        202: '起零数据额度不足', 302: '起零数据接口维护中', 400: '起零数据拒绝了查询参数',
        401: '起零数据 Token 鉴权失败', 403: '起零数据 Token 鉴权失败', 404: '起零数据接口不存在',
        429: '起零数据请求频率受限，请稍后重试', 500: '起零数据服务暂时异常', 502: '起零数据账号受限'
      })[code] || '起零数据接口调用失败');
      if (!Array.isArray(data.data)) throw new UpstreamError('起零数据返回格式发生变化');
      const rows = data.data.slice(0, 300);
      return { items: rows.filter(row => row && typeof row === 'object').map(row => normalizeItem({ title: row.name, url: row.url }, qiling)).filter(Boolean), total: data.data.length, totalType: 'records', hasMore: false };
    }
  };
  return [pansousuo, pansou, haisou, qiling, createXiaojiwo(config, { normalizeItem, requestJson, UpstreamError }, fetchImpl), createLightsearch(config, { normalizeItem, UpstreamError }, fetchImpl), ...createPublicProviders(config, { requestText, requestJson, normalizeItem, UpstreamError }, fetchImpl)].map(provider => {
    if (config.disabledSources?.includes(provider.id)) return { ...provider, enabled: false, supportsCheck: false, disabledReason: '已由服务器配置停用' };
    return provider;
  });
}
