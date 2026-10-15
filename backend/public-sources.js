import { load } from 'cheerio';
import { safeShareUrl, mergeItems } from '../frontend/shared.js';

function readable(content) {
  const $ = load(String(content || ''), null, false);
  $('script,style,iframe').remove();
  $('br').replaceWith('\n');
  return $.root().text().trim();
}

export function extractHtmlShares(content, title, source, normalize, extra = {}, perLinkTitles = false) {
  const $ = load(String(content || ''), null, false);
  $('script,style,iframe').remove();
  $('br').replaceWith('\n');
  const fullText = $.root().text();
  const fallback = title || fullText.split('\n').map(s => s.trim()).find(s => s && !/^https?:/.test(s)) || '';
  const candidates = [];
  $('a[href]').slice(0, 100).each((_, anchor) => {
    const href = $(anchor).attr('href');
    if (!safeShareUrl(href)) return;
    let before = ''; let node = anchor.prev; let count = 0;
    while (node && count++ < 25) {
      const part = $(node).text(); before = part + before;
      if (part.includes('\n')) break;
      node = node.prev;
    }
    const line = before.split('\n').at(-1).trim().replace(/^\d+[、.．]\s*/, '').replace(/https?:\/\/\S+/g, '').replace(/[：:\s]+$/, '');
    const next = $(anchor.next || []).text().slice(0, 150);
    const password = next.match(/(?:提取码|密码|访问码|pwd)[：:=\s]*([A-Za-z0-9]{3,12})/i)?.[1] || '';
    const specific = perLinkTitles && line.length > 2 && !/^(?:链接|资源|百度|夸克|阿里|迅雷|网盘|下载)(?:链接|地址)?$/.test(line) ? line : fallback;
    candidates.push({ url: href, title: specific, password });
  });
  // Also handle share URLs written as plain text instead of HTML anchors.
  for (const match of fullText.matchAll(/https:\/\/[^\s<>"'，。；（）]+/g)) {
    const url = match[0];
    if (!safeShareUrl(url) || candidates.some(c => c.url === url)) continue;
    const next = fullText.slice(match.index + url.length, match.index + url.length + 120);
    candidates.push({ url, title: fallback, password: next.match(/(?:提取码|密码|访问码)[：:\s]*([A-Za-z0-9]{3,12})/i)?.[1] || '' });
  }
  const singlePassword = candidates.length === 1 ? fullText.match(/(?:提取码|密码|访问码)[：:\s]*([A-Za-z0-9]{3,12})/i)?.[1] : '';
  return candidates.slice(0, 100).map(c => normalize({ ...extra, ...c, password: c.password || singlePassword || '' }, source)).filter(Boolean);
}

export function createPublicProviders(config, helpers, fetchImpl) {
  const { requestText, normalizeItem, UpstreamError } = helpers;
  let pansearchPageSize = null;
  async function pansearchPage(query, offset) {
    const url = new URL('/search', config.pansearchBaseUrl);
    url.searchParams.set('keyword', query); url.searchParams.set('offset', offset);
    const html = await requestText(fetchImpl, url, {}, config.timeoutMs);
    const $ = load(html);
    let props;
    try { props = JSON.parse($('#__NEXT_DATA__').text()).props?.pageProps; }
    catch { throw new UpstreamError('PanSearch 页面结构变化或访问受限'); }
    if (!Array.isArray(props?.data?.data) || !Number.isFinite(Number(props.data.total))) throw new UpstreamError('PanSearch 搜索数据格式发生变化');
    const limit = Number(props.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new UpstreamError('PanSearch 分页信息格式发生变化');
    pansearchPageSize = limit;
    return { props, url: url.href };
  }
  const pansearch = {
    id: 'pansearch', name: 'PanSearch', website: 'https://www.pansearch.me/', enabled: true, supportsCheck: false, supportsPagination: true,
    description: '直接读取公开搜索页，提取一条分享记录里的多个网盘链接；网盘筛选作用于当前返回页。',
    async search({ query, page }) {
      if (page > 1 && pansearchPageSize === null) await pansearchPage(query, 0);
      const offset = (page - 1) * (pansearchPageSize || 9);
      const { props, url } = await pansearchPage(query, offset);
      const items = props.data.data.flatMap(row => {
        if (!row || typeof row.content !== 'string') return [];
        const fallback = readable(row.content).split('\n').find(line => line.trim() && !/^https?:/.test(line.trim()))?.replace(/https?:\/\/\S+/g, '').trim() || query;
        return extractHtmlShares(row.content, fallback, pansearch, normalizeItem, { datetime: row.time, sourcePage: url }, true);
      });
      return { items: mergeItems(items).slice(0, 250), total: Number(props.data.total), totalType: 'records', hasMore: offset + props.limit < Number(props.data.total) };
    }
  };

  const rrdynb = {
    id: 'rrdynb', name: '人人电影网', website: 'https://www.rrdynb.com/index.html', enabled: true, supportsCheck: false, supportsPagination: true,
    description: '按片名搜索影视文章，再提取正文里的网盘链接；每页最多读取 6 个匹配条目。',
    async search({ query, page }) {
      const deadline = Date.now() + config.timeoutMs;
      const remaining = () => {
        const ms = deadline - Date.now();
        if (ms <= 0) throw new UpstreamError('人人电影网查询超时');
        return ms;
      };
      const url = new URL('/plus/search.php', config.rrdynbBaseUrl);
      url.searchParams.set('q', query); url.searchParams.set('pagesize', '6'); url.searchParams.set('page', page);
      const html = await requestText(fetchImpl, url, {}, remaining());
      const $ = load(html);
      if (!$('#movielist').length) throw new UpstreamError('人人电影网搜索结构变化或访问受限');
      const articles = []; const visited = new Set();
      $('#movielist li').each((_, node) => {
        const link = $(node).find('a[href]').filter((_, a) => /\/(?:movie|dianshiju|dongman|zongyi)\/\d{4}\/\d{4}\/\d+\.html$/.test($(a).attr('href') || '')).first();
        if (!link.length) return;
        let target;
        try { target = new URL(link.attr('href'), config.rrdynbBaseUrl); } catch { return; }
        if (target.origin !== new URL(config.rrdynbBaseUrl).origin || visited.has(target.href)) return;
        visited.add(target.href);
        articles.push({ url: target.href, title: link.clone().find('span').remove().end().text().trim().replace(/免费电影下载/g, '').trim() });
      });
      const selected = articles.slice(0, 6); let cursor = 0; let failedDetails = 0; let completed = 0; const items = [];
      async function worker() {
        while (cursor < selected.length) {
          const article = selected[cursor++];
          try {
            const content = await requestText(fetchImpl, article.url, {}, remaining());
            const $detail = load(content); const body = $detail('.movie-txt').first();
            if (!body.length) throw new UpstreamError('影视详情结构变化或访问受限');
            body.find('a').filter((_, a) => /(?:使用.*下载|迅雷5\.|utorrent)/i.test($detail(a).text())).remove();
            const title = $detail('h1').first().text().trim() || article.title;
            items.push(...extractHtmlShares(body.html(), title, rrdynb, normalizeItem, { sourcePage: article.url })); completed++;
          } catch { failedDetails++; }
        }
      }
      await Promise.all([worker(), worker()]);
      if (selected.length && !completed) throw new UpstreamError('人人电影网详情暂时不可读，请稍后重试');
      const next = $('a[href]').filter((_, a) => /^(?:下一页|下页|Next)$/i.test($(a).text().trim())).toArray().some(a => {
        try { const u = new URL($(a).attr('href'), url); return u.origin === url.origin && u.pathname === '/plus/search.php' && Number(u.searchParams.get('page')) > page; } catch { return false; }
      });
      const results = mergeItems(items);
      return { items: results, total: results.length, totalType: 'page', hasMore: next, degraded: failedDetails > 0, ...(failedDetails ? { note: `${failedDetails} 个详情页未读取，已保留其他结果` } : {}) };
    }
  };

  const names = { shareAliyun: '阿里云盘发布频道', Aliyun_4K_Movies: '阿里4K影视频道', Quark_Movies: '夸克影视频道' };
  const telegram = (config.telegramChannels || []).map(channel => {
    let feed = null; let pending = null;
    const source = {
      id: `tg_${channel.toLowerCase()}`, name: names[channel] || `公开频道 · ${channel}`, website: `https://t.me/s/${channel}`, enabled: true, supportsCheck: false, supportsPagination: false,
      description: '匹配该频道最近公开展示的帖子，不是完整历史检索；无需 Telegram 登录。',
      async search({ query, page }) {
        if (page > 1) return { items: [], total: 0, totalType: 'page', hasMore: false };
        if (!feed || feed.expires <= Date.now()) {
          if (!pending) {
            pending = requestText(fetchImpl, source.website, {}, config.timeoutMs).then(html => {
              const $ = load(html);
              if (!$('.tgme_channel_info').length || !$('form.tgme_header_search_form, .tgme_channel_info_header').length) throw new UpstreamError('公开频道暂时不可读或不是公开预览页');
              const posts = [];
              $('.tgme_widget_message').slice(0, 30).each((_, element) => {
                const body = $(element).find('.tgme_widget_message_text').first();
                if (!body.length) return;
                const content = body.html() || ''; const text = readable(content);
                const title = text.split('\n').map(s => s.trim()).find(Boolean)?.replace(/^(?:名称|资源名称|标题)[：:]\s*/, '') || '';
                const postPath = $(element).attr('data-post');
                const sourcePage = postPath && /^[A-Za-z0-9_]+\/\d+$/.test(postPath) ? `https://t.me/${postPath}` : source.website;
                posts.push({ text: text.toLocaleLowerCase(), items: extractHtmlShares(content, title, source, normalizeItem, { datetime: $(element).find('time[datetime]').attr('datetime'), sourcePage }) });
              });
              feed = { posts, expires: Date.now() + 120000 }; return feed;
            }).finally(() => { pending = null; });
          }
          await pending;
        }
        const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
        const items = mergeItems(feed.posts.filter(post => words.every(word => post.text.includes(word))).flatMap(post => post.items));
        return { items, total: items.length, totalType: 'page', hasMore: false, scope: 'recent_public_posts' };
      }
    };
    return source;
  });
  return [pansearch, rrdynb, ...telegram];
}
