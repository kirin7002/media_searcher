# 盘觅 · Media Searcher

可自行部署的网盘资源搜索器，包含 Web 前端与 Node.js API 后端。查询公开分享索引，筛选网盘类型、合并重复链接、展示分享地址与提取码，并在浏览器保存收藏。

## 功能

- 真实搜索：默认接入盘搜索、PanSearch、人人电影网，以及两个公开影视频道；可选接入海搜和自部署 PanSou。
- 网盘筛选、最新收录 / 来源热度排序、分页加载与可分享的查询 URL。
- 按网盘分享 ID 去重，合并多个来源并保留各来源的链接与提取码。
- 打开原始分享链接、复制分享信息、收藏与 JSON 导出。
- 来源目录；尚未接入的网站仅作为外部入口展示。
- 来源独立超时、短期缓存、重复请求合并、限流与部分失败提示。
- 配置海搜或 PanSou 后，按需检测分享链接；默认不宣称链接已有效。
- 响应式中文界面，适配桌面和手机。
- 近期上映页面：Netflix、Hulu、Prime Video、Disney+、HBO Max、Apple TV、Paramount+ 和 Peacock 的地区片库；本月 / 最近 30 天、电影 / 新剧、TMDb 评分与上映时间排序，点击片名直接搜索网盘。
- Docker / Compose 部署、健康检查、Nginx 与 systemd 示例。

未配置的来源不会参与搜索；来源失效会展示错误，不使用演示资源替代真实结果。

## 本地运行

需要 **Node.js 22.9+**（建议 24）。后端用 Cheerio 解析公开 HTML，前端无需单独构建。

```sh
cp .env.example .env
npm ci --ignore-scripts
npm start
```

打开 [http://localhost:3210](http://localhost:3210)。macOS 也可双击 `scripts/start.command` 启动，按终端打印的地址打开浏览器。

开发时使用 `npm run dev`，后端修改后自动重启，前端修改后刷新浏览器即可。

## 来源配置

环境变量仅由后端读取，`.env` 不提交到 Git，也不会从 Web 服务暴露。

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 监听地址；容器中覆盖为 `0.0.0.0` |
| `PORT` | `3210` | Node 服务端口 |
| `PANSOUSUO_BASE_URL` | `https://www.pansousuo.com` | 盘搜索服务地址 |
| `PANSEARCH_BASE_URL` | `https://www.pansearch.me` | PanSearch 公开搜索页地址 |
| `RRDYNB_BASE_URL` | `https://www.rrdynb.com` | 人人电影网公开影视搜索地址 |
| `TELEGRAM_CHANNELS` | `Aliyun_4K_Movies,Quark_Movies` | 最多 5 个公开频道；设为空关闭频道来源 |
| `DISABLED_SOURCES` | 空 | 逗号分隔要停用的来源 ID，ID 可从 `/api/sources` 获取 |
| `PANSOU_BASE_URL` | 空 | 自部署 PanSou 根地址；配置后启用 |
| `PANSOU_TOKEN` | 空 | PanSou 认证 Token（如开启认证） |
| `HAISOU_API_KEY` | 空 | 海搜开放接口 key；配置后启用 |
| `SOURCE_TIMEOUT_MS` | `12000` | 盘搜索与 PanSou 请求超时 |
| `HAISOU_TIMEOUT_MS` | `65000` | 海搜超时，按其文档避免过早终止扣费请求 |
| `CACHE_TTL_SECONDS` | `120` | 成功搜索响应缓存时长；0 为关闭 |
| `RATE_LIMIT_PER_MINUTE` | `60` | 每客户端每分钟搜索 / 检测请求上限 |
| `TRUST_PROXY` | `false` | 信任转发 IP，仅在可信反代后开启 |
| `TMDB_READ_ACCESS_TOKEN` | 空 | TMDb API Read Access Token，启用近期上映页面的真实数据 |
| `TMDB_API_KEY` | 空 | 可选 v3 API key，与 Read Access Token 任选一种 |
| `DISCOVER_TIMEZONE` | `Asia/Shanghai` | 本月与最近 30 天的日期边界 |

海搜按站方额度计费，仓库不包含 key。收藏保存在当前浏览器，不同步到服务器；服务端缓存为内存缓存，重启后清空。

影视页默认使用美国区片库，支持切换地区。日期指首次上映 / 首播日期，不是平台上架日期，也不包含旧剧最近一季的更新。TMDb 评分采用其真实 `vote_average` 和评分人数，不冒充 IMDb 评分；未知评分显示为暂无评分。平台标识从 TMDb 当前地区的官方列表读取；可看状态和资料以 TMDb / JustWatch 数据为准。

TMDb 未配置时，页面明确显示数据源未连接，不使用虚构片单。申请入口为 [TMDb API 设置](https://www.themoviedb.org/settings/api)。填入 `.env` 后重启服务；Docker 使用 `docker compose up -d --build`。配置不会返回给前端。新片列表成功响应缓存 10 分钟，失败不会缓存。

来源站点可能改接口、换域名或限制访问，详见 [来源调研](docs/SOURCES.md)。海搜和 PanSou 适配器经过隔离测试，真实鉴权调用需要自己的配置。

PanSearch 一条记录可能包含多个分享链接，后端会逐个提取并按分享 ID 去重；其网盘过滤作用于当前返回页。人人电影网只读取搜索结果中的影视正文，每页最多 6 个详情页，整体超时沿用 `SOURCE_TIMEOUT_MS`；一个详情读取失败时仍保留其他结果。

公开频道仅在最近公开展示的帖子中匹配关键词，**不是全频道历史搜索**，不参与后续分页。`tg_aliyun_4k_movies` 和 `tg_quark_movies` 是默认频道来源 ID。需要完整的公开频道历史聚合时可以接入自己部署的 PanSou。

## 服务器部署

完整步骤见 [部署指南](docs/DEPLOYMENT.md)。Docker Compose 快速启动：

```sh
git clone git@github.com:kirin7002/media_searcher.git
cd media_searcher
cp .env.example .env
docker compose up -d --build
curl http://127.0.0.1:3210/api/health
```

默认仅映射宿主机 `127.0.0.1:3210`，适合 Nginx 反代；如需通过服务器 IP 直接访问，在 `.env` 设置 `APP_BIND_ADDRESS=0.0.0.0`。有域名时可用 Nginx 与 HTTPS。

## API

- `GET /api/health`：服务健康状态，不代表上游来源可用。
- `GET /api/sources`：来源配置状态，不返回凭据。
- `GET /api/search?q=Python&pan=all&page=1&sort=latest&sources=pansousuo`：搜索。
- `POST /api/check`：JSON 参数包含 `url` 与可选 `password`，需要配置检测来源。
- `GET /api/discover/config`：影视数据配置状态、平台与地区列表，不返回 token。
- `GET /api/discover?type=tv&platform=netflix&period=month&region=US&sort=rating&minVotes=10&page=1`：近期上映作品。
- `GET /api/discover/providers?type=tv&region=US`：当前地区可用的主流平台。

`pan` 取值见 `frontend/shared.js`；`sources` 从 `/api/sources` 的已启用来源中选择。`sort` 支持 `latest`、`hot`，排序以各来源为准；公开页面与频道保持来源原始顺序。PanSou 和最近公开频道无分页能力，第一页聚合后不重复查询后续页。

响应包括 `items`、`sources`、`hasMore`、`partial` 和耗时。结果数为当前返回页去重后的链接数量，`sourceTotal` 是来源自报命中数量之和，不是全网去重总数。

`sources[].totalType=page` 表示本页找到的链接数；其他来源的数字可能是索引记录数，一条记录可能有多个链接。`items[].sources[].pageUrl` 保存原始文章或帖子位置（来源提供时）。

全部来源失败返回 502；部分成功返回 200 并标明失败来源；正常查询无结果返回 200 的空列表；参数错误返回 400，限流返回 429。

## 检查与测试

```sh
npm run check
npm test
```

测试使用隔离的上游响应，验证去重、缓存、部分失败、错误重试、分页、参数校验、限流、静态文件访问边界与凭据隐藏，不依赖第三方站点在线。

## 目录

```text
frontend/    中文 Web 界面、样式与共享的链接规则
backend/     HTTP 服务、来源适配器、缓存与检测逻辑
tests/       后端与链接规则测试
deploy/      Nginx、systemd 示例
docs/        来源调研与部署说明
scripts/     语法检查与本地启动脚本
```
