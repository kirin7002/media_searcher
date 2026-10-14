import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../backend/config.js';
import { createProviders, normalizeItem } from '../backend/providers.js';
import { extractHtmlShares } from '../backend/public-sources.js';
import { createSearchService } from '../backend/search.js';
import { mergeItems } from '../frontend/shared.js';

const config = () => loadConfig({ TELEGRAM_CHANNELS: 'Aliyun_4K_Movies' });
const source = { id: 'sample', name: '样例来源' };
const nextPage = (rows, total = 10, limit = 2) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { data: { total, data: rows }, limit } } })}</script></html>`;
const telegram = (text, link = 'https://pan.quark.cn/s/valid123') => `<div class="tgme_channel_info"><div class="tgme_channel_info_header">频道</div></div><div class="tgme_widget_message" data-post="Aliyun_4K_Movies/123"><div class="tgme_widget_message_text">名称：${text}<br>描述：公开资料<br><a href="${link}">链接</a> 提取码：abcd</div><time datetime="2026-10-15T00:00:00Z"></time></div>`;

test('HTML link extraction decodes entities, keeps multiple shares and rejects ads and unsafe URLs', () => {
  const html = '1、Python &amp; 自动化：<a href="https://pan.baidu.com/s/valid123?pwd=aaaa&amp;foo=bar">链接</a>\n2、Python 资料：<a href="https://pan.quark.cn/s/valid456">链接</a> 提取码：bbbb<a href="https://ad.example/download">广告</a><script>https://pan.quark.cn/s/script123</script>';
  const items = extractHtmlShares(html, '资料合集', source, normalizeItem, {}, true);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Python & 自动化');
  assert.equal(items[0].password, 'aaaa');
  assert.equal(items[1].password, 'bbbb');
  assert.ok(!items.some(i => i.id.includes('script123')));
});

test('plain-text URLs and a single password are supported without inventing dates', () => {
  const items = extractHtmlShares('公开资料\nhttps://pan.quark.cn/s/plain123\n提取码：qwer', '公开资料', source, normalizeItem);
  assert.equal(items.length, 1); assert.equal(items[0].password, 'qwer'); assert.equal(items[0].publishedAt, null);
});

test('PanSearch uses actual page size, encodes query and retains every share in a result', async () => {
  const urls = [];
  const providers = createProviders(config(), async value => {
    const url = new URL(value); urls.push(url);
    return new Response(nextPage([{ content: 'Python 资料：<a href="https://pan.quark.cn/s/pan123">链接</a>\nPython 教程：<a href="https://www.alipan.com/s/ali123">链接</a>', time: '2026-10-14T00:00:00Z' }]), { headers: { 'Content-Type': 'text/html' } });
  });
  const provider = providers.find(p => p.id === 'pansearch');
  const args = { query: 'C++ & 中文', page: 1, platform: 'all' };
  const first = await provider.search(args); await provider.search({ ...args, page: 2 });
  assert.equal(first.items.length, 2); assert.equal(first.hasMore, true);
  assert.equal(urls[0].searchParams.get('keyword'), args.query);
  assert.equal(urls[1].searchParams.get('offset'), '2');
  assert.ok(first.items[0].sources[0].pageUrl.includes('/search?'));
});

test('PanSearch direct page 2 discovers page size instead of guessing an offset', async () => {
  const offsets = [];
  const provider = createProviders(config(), async value => { offsets.push(new URL(value).searchParams.get('offset')); return new Response(nextPage([], 30, 3)); }).find(p => p.id === 'pansearch');
  await provider.search({ query: '资料', page: 2 });
  assert.deepEqual(offsets, ['0', '3']);
});

test('challenge or changed HTML is an upstream error, not an empty successful search', async () => {
  const provider = createProviders(config(), async () => new Response('<title>Just a moment</title>')).find(p => p.id === 'pansearch');
  await assert.rejects(provider.search({ query: '资料', page: 1 }), /结构变化或访问受限/);
});

test('public channels match only recent visible posts and share a cached feed across queries', async () => {
  let calls = 0;
  const provider = createProviders(config(), async value => { calls++; assert.equal(new URL(value).search, '', 'does not pretend Telegram supports full-text web search'); return new Response(telegram('Python 学习资料')); }).find(p => p.id.startsWith('tg_'));
  const match = await provider.search({ query: 'Python 资料', page: 1 });
  const absent = await provider.search({ query: '不在最近帖子中', page: 1 });
  const second = await provider.search({ query: 'Python', page: 2 });
  assert.equal(match.items.length, 1); assert.equal(match.hasMore, false); assert.equal(match.scope, 'recent_public_posts');
  assert.equal(absent.items.length, 0); assert.equal(second.items.length, 0); assert.equal(calls, 1);
  assert.equal(match.items[0].title, 'Python 学习资料');
  assert.equal(match.items[0].sources[0].pageUrl, 'https://t.me/Aliyun_4K_Movies/123');
});

test('private or unavailable channel pages are not reported as valid empty feeds', async () => {
  const provider = createProviders(config(), async () => new Response('<title>Telegram: Contact</title>')).find(p => p.id.startsWith('tg_'));
  await assert.rejects(provider.search({ query: '资料', page: 1 }), /公开频道/);
});

test('channel configuration rejects path injection and excess channels; disabling sources preserves other services', () => {
  assert.throws(() => loadConfig({ TELEGRAM_CHANNELS: '../admin' }), /合法/);
  assert.throws(() => loadConfig({ TELEGRAM_CHANNELS: 'one11,two22,three3,four44,five55,six666' }), /最多/);
  const cfg = loadConfig({ TELEGRAM_CHANNELS: '', DISABLED_SOURCES: 'pansearch' });
  const sources = createProviders(cfg);
  assert.equal(sources.filter(p => p.id.startsWith('tg_')).length, 0);
  assert.equal(sources.find(p => p.id === 'pansearch').enabled, false);
  assert.equal(sources[0].enabled, true);
});

test('rrdynb reads only result-list articles on the same origin and excludes utility downloads', async () => {
  const calls = [];
  const provider = createProviders(config(), async value => {
    const url = new URL(value); calls.push(url);
    if (url.pathname === '/plus/search.php') return new Response('<ul id="movielist"><li><a href="/dianshiju/2026/1015/12345.html">作品名</a></li><li><a href="https://evil.test/movie/2026/1015/999.html">外站</a></li></ul><aside><a href="/movie/2026/1015/555.html">无关推荐</a></aside>');
    return new Response('<h1>作品名 (2026)</h1><div class="movie-txt"><a href="https://pan.quark.cn/s/movie123">夸克网盘</a><a href="https://pan.baidu.com/s/tool123">使用utorrent下载</a></div>');
  }).find(p => p.id === 'rrdynb');
  const data = await provider.search({ query: '作品名', page: 1 });
  assert.equal(calls.length, 2); assert.equal(data.items.length, 1);
  assert.equal(data.items[0].title, '作品名 (2026)'); assert.equal(data.items[0].platform, 'quark');
  assert.equal(data.hasMore, false);
});

test('rrdynb retains successful articles when another detail fails and reports partial data', async () => {
  const provider = createProviders(config(), async value => {
    const url = new URL(value);
    if (url.pathname === '/plus/search.php') return new Response('<ul id="movielist"><li><a href="/movie/2026/1015/111.html">作品一</a></li><li><a href="/movie/2026/1015/222.html">作品二</a></li></ul>');
    if (url.pathname.endsWith('/222.html')) return new Response('', { status: 503 });
    return new Response('<h1>作品一</h1><div class="movie-txt"><a href="https://pan.quark.cn/s/valid123">夸克</a></div>');
  }).find(p => p.id === 'rrdynb');
  const service = createSearchService([provider], config());
  const data = await service.search(new URLSearchParams({ q: '作品' }));
  assert.equal(data.partial, true); assert.equal(data.failed, false); assert.equal(data.items.length, 1);
  assert.match(data.sources[0].note, /1 个详情/);
});

test('deduplication preserves distinct article provenance for the same share', () => {
  const one = normalizeItem({ title: '作品', url: 'https://pan.quark.cn/s/valid123', sourcePage: 'https://example.com/one' }, source);
  const two = normalizeItem({ title: '作品', url: 'https://pan.quark.cn/s/valid123', sourcePage: 'https://example.com/two' }, source);
  const merged = mergeItems([one, two]); assert.equal(merged.length, 1); assert.equal(merged[0].sources.length, 2);
});
