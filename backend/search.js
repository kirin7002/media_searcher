import { mergeItems, PLATFORMS, safeShareUrl } from '../frontend/shared.js';

export class InputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

class BoundedCache {
  constructor(max = 500) { this.entries = new Map(); this.max = max; }
  get(key) {
    const value = this.entries.get(key);
    if (!value) return null;
    if (value.expires <= Date.now()) { this.entries.delete(key); return null; }
    return value.data;
  }
  set(key, data, ttl) {
    if (!ttl) return;
    this.entries.delete(key);
    if (this.entries.size >= this.max) this.entries.delete(this.entries.keys().next().value);
    this.entries.set(key, { data, expires: Date.now() + ttl });
  }
}

export function createSearchService(providers, config) {
  const cache = new BoundedCache();
  const checks = new BoundedCache();
  const pending = new Map();
  const pendingChecks = new Map();
  const available = providers.filter(p => p.enabled);
  return {
    sources() {
      return providers.map(({ id, name, website, description, enabled, disabledReason, supportsCheck }) => ({ id, name, website, description, enabled, supportsCheck, disabledReason: enabled ? null : disabledReason }));
    },
    async search(params) {
      const query = (params.get('q') || '').trim();
      if (!query || [...query].length > 60) throw new InputError('请输入 1–60 个字符的搜索词');
      const platform = params.get('pan') || 'all';
      if (platform !== 'all' && !Object.hasOwn(PLATFORMS, platform)) throw new InputError('不支持的网盘类型');
      const pageText = params.get('page') || '1';
      if (!/^\d+$/.test(pageText) || Number(pageText) < 1 || Number(pageText) > 50) throw new InputError('页码必须在 1–50 之间');
      const page = Number(pageText);
      const sort = params.get('sort') || 'latest';
      if (!['latest', 'hot'].includes(sort)) throw new InputError('不支持的排序方式');
      const ids = [...new Set((params.get('sources') || available.map(p => p.id).join(',')).split(',').filter(Boolean))];
      if (!ids.length || ids.some(id => !available.some(p => p.id === id))) throw new InputError('请选择已配置的搜索来源');
      const started = Date.now();
      const args = { query, platform, page, sort };
      const selected = available.filter(p => ids.includes(p.id));
      const statuses = await Promise.all(selected.map(async provider => {
        const key = JSON.stringify([provider.id, query, platform, page, sort]);
        const began = Date.now();
        try {
          let data = cache.get(key);
          const cached = Boolean(data);
          if (!data) {
            if (!pending.has(key)) {
              const promise = provider.search(args).then(result => { cache.set(key, result, config.cacheTtlMs); return result; }).finally(() => pending.delete(key));
              pending.set(key, promise);
            }
            data = await pending.get(key);
          }
          return { id: provider.id, name: provider.name, state: 'ok', cached, durationMs: Date.now() - began, ...data };
        } catch (error) {
          return { id: provider.id, name: provider.name, state: 'error', cached: false, durationMs: Date.now() - began, message: error.name === 'UpstreamError' ? error.message : '来源暂时不可用', items: [], total: 0, hasMore: false };
        }
      }));
      const items = mergeItems(statuses.flatMap(s => s.items).filter(i => platform === 'all' || i.platform === platform));
      const succeeded = statuses.filter(s => s.state === 'ok').length;
      return {
        query, platform, page, sort, items, count: items.length,
        sourceTotal: statuses.reduce((n, s) => n + s.total, 0),
        hasMore: page < 50 && statuses.some(s => s.hasMore),
        durationMs: Date.now() - started,
        partial: succeeded > 0 && succeeded < selected.length,
        failed: succeeded === 0,
        sources: statuses.map(({ items: ignored, ...status }) => status)
      };
    },
    async check(body) {
      const share = safeShareUrl(body.url);
      if (!share) throw new InputError('仅支持已识别网盘的 HTTPS 分享链接');
      if (body.password != null && (typeof body.password !== 'string' || body.password.length > 64)) throw new InputError('提取码格式不正确');
      const provider = available.find(p => p.id === 'pansou' && p.check) || available.find(p => p.check);
      if (!provider) throw new InputError('链接检测需要先配置 PanSou 或海搜', 503);
      const password = body.password || share.password;
      const key = JSON.stringify([share.id, password]);
      const cached = checks.get(key);
      if (cached) return { ...cached, cached: true };
      if (!pendingChecks.has(key)) {
        const task = provider.check(share.url, password).then(result => {
          const value = { ...result, provider: provider.name, checkedAt: new Date().toISOString(), cached: false };
          if (result.state !== 'unknown') checks.set(key, value, 10 * 60 * 1000);
          return value;
        }).finally(() => pendingChecks.delete(key));
        pendingChecks.set(key, task);
      }
      return pendingChecks.get(key);
    }
  };
}
