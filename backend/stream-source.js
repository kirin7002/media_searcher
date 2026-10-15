import { mergeItems } from '../frontend/shared.js';

// Session cookies remain request-local. The browser-facing API never receives them.
export function createLightsearch(config, { normalizeItem, UpstreamError }, fetchImpl) {
  const base = config.sosopxBaseUrl;
  const source = {
    id: 'lightsearch', name: '轻搜搜', website: 'https://sosopx.com/', enabled: true,
    supportsCheck: false, supportsPagination: false,
    description: '读取公开搜索的实时结果；无分页，部分线路失败时保留已返回的分享。',
    async search({ query, platform, page }) {
      const empty = { items: [], total: 0, totalType: 'records', hasMore: false };
      if (page > 1 || !['all', 'quark', 'baidu', 'xunlei', 'uc'].includes(platform)) return empty;
      const signal = AbortSignal.timeout(config.sosopxTimeoutMs);
      const headers = { 'User-Agent': 'MediaSearcher/1.0', 'X-Requested-With': 'XMLHttpRequest', Origin: new URL(base).origin, Referer: new URL('/', base).href, 'Cache-Control': 'no-cache' };
      let cookies = '';
      async function session() {
        const response = await fetchImpl(new URL('/api/search/session', base), { headers, signal, redirect: 'error' });
        try {
          if (!response.ok) throw new UpstreamError(`轻搜搜会话返回 HTTP ${response.status}`);
          cookies = response.headers.getSetCookie().map(value => value.split(';')[0]).filter(value => /^search_(?:token|device_id)=[^\r\n;]+$/.test(value)).join('; ');
          if (!cookies.includes('search_token=')) throw new UpstreamError('轻搜搜未提供匿名搜索会话');
        } finally { await response.body?.cancel().catch(() => {}); }
      }
      const items = []; let complete = false; let failedLines = 0; let interrupted = false;
      try {
        await session();
        const url = new URL('/api/search/stream', base);
        url.searchParams.set('keyword', query); url.searchParams.set('type', platform); url.searchParams.set('_', Date.now());
        let response;
        for (let attempt = 0; attempt < 2; attempt++) {
          response = await fetchImpl(url, { headers: { ...headers, Accept: 'text/event-stream', Cookie: cookies }, signal, redirect: 'error' });
          if (response.status !== 401 || attempt) break;
          const raw = await boundedText(response, 65536, UpstreamError);
          let data; try { data = JSON.parse(raw); } catch { /* Reject non-JSON below. */ }
          if (data?.code !== 'TOKEN_REFRESH_REQUIRED') throw new UpstreamError('轻搜搜搜索会话被拒绝');
          await session();
        }
        if (!response.ok || !/^text\/event-stream(?:;|$)/i.test(response.headers.get('Content-Type') || '')) {
          await response.body?.cancel().catch(() => {});
          throw new UpstreamError(`轻搜搜搜索不可用（HTTP ${response.status}）`);
        }
        await consumeEvents(response, (event, data) => {
          if (event === 'item') {
            if (!data || typeof data !== 'object') throw new UpstreamError('轻搜搜结果格式发生变化');
            const item = normalizeItem({ title: data.title || data.name, url: data.url, password: data.code || data.pwd || data.password || data.extract_code, description: data.description, sourcePage: source.website }, source);
            if (item && items.length < 1000) items.push(item);
          } else if (event === 'line_error' || event === 'error') failedLines++;
          else if (event === 'done') complete = true;
          return complete;
        }, UpstreamError);
      } catch (error) {
        if (!items.length) {
          if (error instanceof UpstreamError) throw error;
          throw new UpstreamError(['TimeoutError', 'AbortError'].includes(error.name) ? '轻搜搜响应超时，请稍后重试' : '暂时无法连接轻搜搜');
        }
        interrupted = true;
      }
      if (!complete && !items.length) throw new UpstreamError('轻搜搜结果流未完整返回');
      if (failedLines && !items.length) throw new UpstreamError('轻搜搜搜索线路暂时不可用');
      const results = mergeItems(items);
      const degraded = interrupted || !complete || failedLines > 0;
      return { items: results, total: results.length, totalType: 'records', hasMore: false, degraded,
        ...(degraded ? { note: `${failedLines ? `${failedLines} 条搜索线路失败；` : ''}${interrupted || !complete ? '结果流中断；' : ''}已保留返回结果` } : {}) };
    }
  };
  return source;
}

async function boundedText(response, max, UpstreamError) {
  let text = '';
  await consumeBody(response, chunk => { text += chunk; }, max, UpstreamError);
  return text;
}

async function consumeBody(response, onChunk, max, UpstreamError) {
  if (!response.body) throw new UpstreamError('来源返回空响应');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { onChunk(decoder.decode()); break; }
      bytes += value.byteLength;
      if (bytes > max) throw new UpstreamError('来源响应过大');
      if (onChunk(decoder.decode(value, { stream: true })) === true) break;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function consumeEvents(response, onEvent, UpstreamError) {
  let buffer = '';
  await consumeBody(response, chunk => {
    buffer = (buffer + chunk).replace(/\r\n/g, '\n');
    let index;
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2);
      let event = 'message'; const data = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (!event || !data.length) continue;
      let parsed;
      try { parsed = event === 'message' && data.join('\n').trim() === '[DONE]' ? null : JSON.parse(data.join('\n')); } catch {
        // Some upstream line errors embed invalid JSON escapes in diagnostics.
        // Their payload is not used; keep consuming the other independent lines.
        if (event === 'line_error' || event === 'error') parsed = {};
        else throw new UpstreamError('来源结果流格式发生变化');
      }
      if (onEvent(event, parsed) === true) return true;
    }
  }, 4 * 1024 * 1024, UpstreamError);
}
