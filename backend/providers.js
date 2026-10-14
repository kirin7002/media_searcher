import { safeShareUrl } from '../frontend/shared.js';

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
    sources: [{ id: source.id, name: source.name, url: share.url, password }]
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

export async function requestJson(fetchImpl, url, options, timeout) {
  try {
    const response = await fetchImpl(url, {
      ...options, headers: { Accept: 'application/json', 'User-Agent': 'MediaSearcher/1.0', ...options?.headers },
      signal: AbortSignal.timeout(timeout), redirect: 'error'
    });
    if (!response.ok) throw new UpstreamError(`来源返回 HTTP ${response.status}`);
    let length = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 4 * 1024 * 1024) { await response.body.cancel?.().catch(() => {}); throw new UpstreamError('来源响应过大'); }
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    if (['TimeoutError', 'AbortError'].includes(error.name)) throw new UpstreamError('来源响应超时，请稍后重试');
    if (error instanceof SyntaxError) throw new UpstreamError('来源未返回有效的 JSON 数据');
    throw new UpstreamError('暂时无法连接该来源，请稍后重试');
  }
}

export function createProviders(config, fetchImpl = fetch) {
  const pansousuo = {
    id: 'pansousuo', name: '盘搜索', enabled: true, website: 'https://www.pansousuo.com/',
    description: '公开分享索引，支持关键词、网盘筛选和分页。', supportsCheck: false,
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
    description: '连接你部署的 PanSou，聚合多个网站与公开频道。', disabledReason: '尚未配置 PanSou 服务地址', supportsCheck: Boolean(config.pansouBaseUrl),
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
    description: '按站方额度调用，可返回分享链接与提取码并检测有效性。', disabledReason: '尚未配置海搜 API key', supportsCheck: Boolean(config.haisouApiKey),
    async search({ query, platform, page }) {
      const platformAlias = { aliyun: 'ali', mobile: 'yidong' };
      const supported = ['all', 'aliyun', 'baidu', 'quark', 'xunlei', 'tianyi', 'mobile', '115', '123', 'uc'];
      if (!supported.includes(platform)) return { items: [], total: 0, hasMore: false };
      const data = await haisouRequest('search', { query, page, pageSize: 30, searchIn: 'title', ...(platform !== 'all' ? { platforms: [platformAlias[platform] || platform] } : {}) });
      if (!Array.isArray(data.items) || !data.pagination) throw new UpstreamError('海搜数据格式发生变化');
      return { items: data.items.map(r => normalizeItem(r, haisou)).filter(Boolean), total: Number(data.pagination.total) || 0, hasMore: page < Number(data.pagination.totalPages || 1) };
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
  return [pansousuo, pansou, haisou];
}
