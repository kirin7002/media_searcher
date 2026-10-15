# 盘觅 · Media Searcher

可自行部署的影视发现与网盘资源搜索器，包含 Web 前端与 Node.js API 后端。打开首页浏览热门影视，进入片库按偏好挑选，再一步查询公开网盘分享索引；也可直接搜索课程、书籍和资料。

## 功能

- 真实搜索：默认接入盘搜索、PanSearch、人人电影网，以及两个公开影视频道；可选接入海搜、起零数据和自部署 PanSou。
- 网盘筛选、最新收录 / 来源热度排序、分页加载与可分享的查询 URL。
- 按网盘分享 ID 去重，合并多个来源并保留各来源的链接与提取码。
- 打开原始分享链接、复制分享信息、收藏与 JSON 导出。
- 来源目录；尚未接入的网站仅作为外部入口展示。
- 来源独立超时、短期缓存、重复请求合并、限流与部分失败提示。
- 配置海搜或 PanSou 后，按需检测分享链接；默认不宣称链接已有效。
- 响应式中文界面，适配桌面和手机。
- 流媒体风格发现首页：真实 TMDb 本周趋势、精选宽幅剧照、最近 30 天电影与新剧、8 个平台入口；点击海报搜索网盘，剧情弹窗查看资料。
- 独立筛选片库：地区、流媒体平台、电影 / 剧集 / 动漫 / 综艺、长时间范围和自定义日期、最低 TMDb 评分、评分人数、评分升降序和最新上映排序。
- 可分享的片库条件 URL；从影视进入网盘搜索后返回，保留已加载分页与滚动位置。电脑横向导航，手机折叠筛选和底部导航。
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

默认打开“发现”，顶部“片库”保留完整条件筛选。电影、剧集、动漫、综艺入口会预选类型；首页平台入口直接打开跨地区片库，无需先选地区。旧的 `?q=关键词#search` 和 `#discover` 链接仍然可用。更新后请重启后端并刷新页面，以加载新增的首页接口。

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
| `QILING_API_TOKEN` | 空 | 起零数据 Bearer Token；配置后启用，仅在后端保存 |
| `QILING_TIMEOUT_MS` | `20000` | 起零数据独立请求超时 |
| `SOURCE_TIMEOUT_MS` | `12000` | 盘搜索与 PanSou 请求超时 |
| `HAISOU_TIMEOUT_MS` | `65000` | 海搜超时，按其文档避免过早终止扣费请求 |
| `CACHE_TTL_SECONDS` | `120` | 成功搜索响应缓存时长；0 为关闭 |
| `RATE_LIMIT_PER_MINUTE` | `60` | 每客户端每分钟搜索 / 检测请求上限 |
| `TRUST_PROXY` | `false` | 信任转发 IP，仅在可信反代后开启 |
| `TMDB_READ_ACCESS_TOKEN` | 空 | TMDb API Read Access Token，启用近期上映页面的真实数据 |
| `TMDB_API_KEY` | 空 | 可选 v3 API key，与 Read Access Token 任选一种 |
| `DISCOVER_TIMEZONE` | `Asia/Shanghai` | 各时间范围及“今天”的日期边界 |

海搜按站方额度计费，仓库不包含 key。收藏保存在当前浏览器，不同步到服务器；服务端缓存为内存缓存，重启后清空。

起零数据支持阿里云盘、夸克、百度和迅雷的资源搜索，配置 `QILING_API_TOKEN` 后重启即可启用。Token 通过 Authorization 请求头发送，不放进 URL。该来源没有文档支持的分页、时间排序或链接检测，不重复请求第二页，也不伪造发布时间。明确的“未找到相关网盘资源”响应作为空结果，其他鉴权、额度、限流和格式错误仍显示失败。接口与额度以[官方文档](https://api.istero.com/service/doc/pan-resource-search)为准。

影视页默认地区不限、评分人数不限。未指定平台时直接查询全球作品；指定 Netflix 等平台但不指定地区时，自动合并当前支持的美国、英国、日本、韩国、香港、台湾、加拿大和澳大利亚片库，并按作品 ID 去重，不暗中套用美国区。片库中仍可选择具体地区缩小范围。

跨地区模式中每次“加载更多”查询各地区的同一页，合并该批全部结果，避免截断后遗漏作品；最多每批 160 条地区记录，重复影视仅显示一次，已加载作品保持当前排序。`totalType=regional_sum` 表示 `total` 为成功查询地区的命中数合计，含重复，不是跨地区去重总数。`queriedRegions` / `failedRegions` 说明成功 / 失败片库；部分地区失败时显示提示，其他地区结果仍可浏览。

首页“近期热门”来自 TMDb 每周趋势，不是播放量榜单，也不保证作品刚上映；“近期电影 / 新剧”只展示最近 30 天首次上映 / 首播且至少 10 人评分的作品，查看全部会带入同样条件。首页分区独立失败时保留成功片单并提示；数据不可用时不会用演示片名替代。首页平台入口不代表单部影视已确认在哪个平台可看，也不代表存在有效网盘资源。

片库筛选条件保存在 `#discover?...` 中，刷新可恢复；已加载分页与滚动位置在同一次页面访问中保留，刷新后重新获取第一页。实现设计和任务拆分见 [设计文档](docs/DESIGN.md) 与 [任务清单](docs/TASKS.md)。

时间范围支持本月、30 天、90 天、半年、1 年、3 年、全部时间和自定义开始 / 结束日期。自定义范围校验真实日期、先后关系，结束日期不能晚于今天；全部时间不设置开始日期，仍排除未来作品。日期指首次上映 / 首播日期，不是平台上架日期，也不包含旧剧最近一季的更新。

类型包括电视剧、电影、动漫剧集、动漫电影、综艺。动漫对应 TMDb Animation 分类，综艺对应 Reality / Talk 分类。动漫电影使用电影接口，动漫剧集和综艺使用电视剧接口，详情链接仍保持正确的电影 / 电视剧 ID 路径。TMDb 评分采用其真实 `vote_average` 和评分人数；未知评分显示为暂无评分，不冒充 IMDb 评分。

TMDb 未配置时，页面明确显示数据源未连接，不使用虚构片单。申请入口为 [TMDb API 设置](https://www.themoviedb.org/settings/api)。填入 `.env` 后重启服务；Docker 使用 `docker compose up -d --build`。配置不会返回给前端。新片列表成功响应缓存 10 分钟，失败不会缓存。

来源站点可能改接口、换域名或限制访问，详见 [来源调研](docs/SOURCES.md)。海搜、起零数据和 PanSou 适配器经过隔离测试，真实鉴权调用需要自己的配置。

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
- `GET /api/discover/home`：精选、每周趋势、近期电影与新剧；含部分失败状态与分区提示。
- 片库新增 `minRating=7` 最低评分（0–10），`sort=rating_asc` 评分升序；原有 `rating` 降序与 `newest` 日期排序继续有效。结果新增安全的 `backdropUrl` 剧照字段。
- `GET /api/discover?type=tv&platform=netflix&period=month&region=US&sort=rating&minVotes=10&page=1`：近期上映作品。
- `GET /api/discover/providers?type=tv&region=US`：当前地区可用的主流平台。

影视查询类型 `type` 支持 `tv/movie/anime/anime_movie/variety`；时间 `period` 支持 `month/30d/90d/180d/365d/3y/all/custom`。自定义示例：`/api/discover?type=anime&period=custom&from=2024-01-01&to=2025-12-31`。省略 `region` 和 `minVotes` 时，分别按 `all` 与 `0` 处理。

`pan` 取值见 `frontend/shared.js`；`sources` 从 `/api/sources` 的已启用来源中选择。`sort` 支持 `latest`、`hot`，排序以各来源为准；公开页面与频道保持来源原始顺序。PanSou、起零数据和最近公开频道无分页能力，第一页聚合后不重复查询后续页。

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
