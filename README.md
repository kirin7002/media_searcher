# 盘觅 · Media Searcher

可自行部署的网盘资源搜索器，包含 Web 前端与 Node.js API 后端。查询公开分享索引，筛选网盘类型、合并重复链接、展示分享地址与提取码，并在浏览器保存收藏。

## 功能

- 真实搜索：默认接入盘搜索公开 API，可选接入海搜和自部署 PanSou。
- 网盘筛选、最新收录 / 来源热度排序、分页加载与可分享的查询 URL。
- 按网盘分享 ID 去重，合并多个来源并保留各来源的链接与提取码。
- 打开原始分享链接、复制分享信息、收藏与 JSON 导出。
- 来源目录；尚未接入的网站仅作为外部入口展示。
- 来源独立超时、短期缓存、重复请求合并、限流与部分失败提示。
- 配置海搜或 PanSou 后，按需检测分享链接；默认不宣称链接已有效。
- 响应式中文界面，适配桌面和手机。
- Docker / Compose 部署、健康检查、Nginx 与 systemd 示例。

未配置的来源不会参与搜索；来源失效会展示错误，不使用演示资源替代真实结果。

## 本地运行

需要 **Node.js 22.9+**（建议 24）。没有第三方运行时依赖，无需安装依赖或构建前端。

```sh
cp .env.example .env
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
| `PANSOU_BASE_URL` | 空 | 自部署 PanSou 根地址；配置后启用 |
| `PANSOU_TOKEN` | 空 | PanSou 认证 Token（如开启认证） |
| `HAISOU_API_KEY` | 空 | 海搜开放接口 key；配置后启用 |
| `SOURCE_TIMEOUT_MS` | `12000` | 盘搜索与 PanSou 请求超时 |
| `HAISOU_TIMEOUT_MS` | `65000` | 海搜超时，按其文档避免过早终止扣费请求 |
| `CACHE_TTL_SECONDS` | `120` | 成功搜索响应缓存时长；0 为关闭 |
| `RATE_LIMIT_PER_MINUTE` | `60` | 每客户端每分钟搜索 / 检测请求上限 |
| `TRUST_PROXY` | `false` | 信任转发 IP，仅在可信反代后开启 |

海搜按站方额度计费，仓库不包含 key。收藏保存在当前浏览器，不同步到服务器；服务端缓存为内存缓存，重启后清空。

来源站点可能改接口、换域名或限制访问，详见 [来源调研](docs/SOURCES.md)。海搜和 PanSou 适配器经过隔离测试，真实鉴权调用需要自己的配置。

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

`pan` 取值见 `frontend/shared.js`；`sources` 可选 `pansousuo,pansou,haisou` 中已启用的来源。`sort` 支持 `latest`、`hot`，排序以各来源为准。PanSou 无分页能力，第一页聚合后不重复查询后续页。

响应包括 `items`、`sources`、`hasMore`、`partial` 和耗时。结果数为当前返回页去重后的链接数量，`sourceTotal` 是来源自报命中数量之和，不是全网去重总数。

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
