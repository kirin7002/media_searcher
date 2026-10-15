import { mergeItems } from '../frontend/shared.js';
import { consumeEvents } from './stream-source.js';

export function createXiaojiwo(config, { normalizeItem, requestJson, UpstreamError }, fetchImpl) {
  const base = config.xiaojiwoBaseUrl;
  const source = {
    id: 'xiaojiwo', name: '小鸡窝', website: 'https://xiaojiwo.sylu.net/', enabled: true,
    supportsCheck: false, supportsPagination: false,
    description: '默认检索夸克，可筛选百度、UC、迅雷；每次最多解析 6 条，无分页，部分失败保留结果。',
    async search({ query, platform, page }) {
      const types = { all: '0', quark: '0', baidu: '2', uc: '3', xunlei: '4' };
      if (page > 1 || !Object.hasOwn(types, platform)) return { items: [], total: 0, totalType: 'page', hasMore: false };
      const deadline = Date.now() + config.xiaojiwoTimeoutMs;
      const remaining = () => {
        const time = deadline - Date.now();
        if (time <= 0) throw new UpstreamError('小鸡窝响应超时');
        return time;
      };
      const headers = { 'User-Agent': 'MediaSearcher/1.0', Accept: 'text/event-stream', Referer: new URL('/', base).href };
      const url = new URL('/api/other/web_search', base);
      url.searchParams.set('title', query); url.searchParams.set('is_type', types[platform]);
      const rows = []; const visited = new Set(); let complete = false; let interrupted = false;
      try {
        // Reserve time for the same public link-resolution action used by the site.
        const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(Math.max(100, remaining() - 8000)), redirect: 'error' });
        if (!response.ok || !/^text\/event-stream(?:;|$)/i.test(response.headers.get('Content-Type') || '')) {
          await response.body?.cancel().catch(() => {});
          throw new UpstreamError(`小鸡窝搜索不可用（HTTP ${response.status}）`);
        }
        await consumeEvents(response, (event, data) => {
          if (event !== 'message') return;
          if (data === null) { complete = true; return true; }
          if (!data || typeof data !== 'object' || typeof data.url !== 'string' || typeof data.title !== 'string') throw new UpstreamError('小鸡窝结果格式发生变化');
          if (data.url.length > 4096 || data.title.length > 1000 || visited.has(data.url)) return;
          visited.add(data.url); rows.push(data);
          return rows.length >= 6;
        }, UpstreamError);
      } catch (error) {
        if (!rows.length) {
          if (error instanceof UpstreamError) throw error;
          throw new UpstreamError(['TimeoutError', 'AbortError'].includes(error.name) ? '小鸡窝响应超时' : '暂时无法连接小鸡窝');
        }
        interrupted = true;
      }
      if (!rows.length && !complete) throw new UpstreamError('小鸡窝搜索未完整返回');
      const sourcePage = new URL(`/s/${encodeURIComponent(query)}.html`, base).href;
      let cursor = 0; let failed = 0; const items = [];
      async function worker() {
        while (cursor < rows.length) {
          const row = rows[cursor++];
          try {
            let raw = row;
            if (!row.url.startsWith('https://')) {
              const data = await requestJson(fetchImpl, new URL('/api/other/save_url', base), {
                method: 'POST', headers: { 'Content-Type': 'application/json', Referer: new URL('/', base).href },
                body: JSON.stringify({ url: encodeURIComponent(row.url), title: row.title })
              }, remaining());
              if (data?.code !== 200 || typeof data.data?.url !== 'string') throw new UpstreamError('小鸡窝分享暂时无法解析');
              raw = { title: row.title, url: data.data.url };
            }
            const item = normalizeItem({ title: raw.title, url: raw.url, sourcePage }, source);
            if (item) items.push(item); else failed++;
          } catch { failed++; }
        }
      }
      await Promise.all([worker(), worker()]);
      if (rows.length && !items.length) throw new UpstreamError('小鸡窝未能取得可用的分享地址');
      const results = mergeItems(items);
      const degraded = interrupted || (!complete && rows.length < 6) || failed > 0;
      return { items: results, total: results.length, totalType: 'page', hasMore: false, degraded,
        ...(degraded ? { note: `部分搜索或分享解析失败，已保留 ${results.length} 条结果` } : {}) };
    }
  };
  return source;
}
