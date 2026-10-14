# 服务器部署

前端与 API 由同一个 Node 服务提供，不需要单独部署前端，也不需要数据库。默认查询盘搜索公开 API，服务器需要能连接对应来源。

## Docker Compose（推荐）

服务器需要 Git、Docker 与 Docker Compose 插件。准备项目：

```sh
git clone git@github.com:kirin7002/media_searcher.git
cd media_searcher
cp .env.example .env
```

私有仓库需要先配置服务器自己的 GitHub 访问凭据；本仓库不包含本地机器的 SSH 私钥。

编辑 `.env`，填写要启用的来源。默认不填写海搜或 PanSou 也可以运行。

```sh
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:3210/api/health
curl --get --data-urlencode 'q=Python' http://127.0.0.1:3210/api/search
docker compose logs --tail=100 media-searcher
```

健康接口返回 `status: ok` 表示应用已启动；搜索接口的 `sources` 字段显示实际来源是否成功。健康检查不会不断查询上游或消耗海搜额度。

容器使用非 root 用户、只读文件系统、内存缓存与日志轮转。Docker 官方 Node 基础镜像支持 amd64 和 arm64。无需挂载数据卷。

### 通过服务器 IP 访问

默认宿主机只监听回环地址。如暂不使用反向代理，在 `.env` 设置：

```dotenv
APP_BIND_ADDRESS=0.0.0.0
APP_PORT=3210
TRUST_PROXY=false
```

执行 `docker compose up -d` 应用配置，在服务器防火墙 / 云安全组允许所需端口。打开 `http://服务器IP:3210`。

### 域名与 Nginx

将域名 DNS 指向服务器，保持 `APP_BIND_ADDRESS=127.0.0.1`。将 `deploy/nginx.conf` 安装到 Nginx 的站点配置目录，替换域名和服务端口，再执行：

```sh
sudo nginx -t
sudo systemctl reload nginx
```

示例覆盖客户端 `X-Forwarded-For`，可以在 `.env` 设置 `TRUST_PROXY=true` 后重建容器，使应用按真实客户端 IP 限流。开启该选项时必须只允许可信代理访问后端。

示例只有 HTTP 配置；HTTPS 需按服务器的证书管理方式安装证书、配置 Nginx 443，或使用已有 HTTPS 网关。

海搜是有额度的上游；若仅供个人使用，可通过反向代理限制访问，避免其他访问者消耗该 key 的额度。

### 可选 PanSou

部署自己的 PanSou 后，填写 `PANSOU_BASE_URL`。若与本项目运行在同一 Compose 网络，应使用其服务名（例如 `http://pansou:8888`）；容器中的 `127.0.0.1` 指向本容器。

如 PanSou 开启认证，填写 `PANSOU_TOKEN`。插件是否可用及公开频道可达性由 PanSou 自身决定。

### 更新与停止

```sh
git pull --ff-only
docker compose up -d --build
docker compose logs --tail=100 media-searcher
```

`docker compose down` 停止服务。回退时检出此前已验证的 Git 版本后重新构建；`.env` 留在服务器上，不随 Git 更新覆盖。收藏在用户浏览器里，服务重启不影响收藏。

## 无 Docker：Node.js + systemd

安装 Node.js 22.9+，将代码放到 `/opt/media-searcher`，创建专用用户 `media-searcher`，创建 `.env`。用该用户运行 `npm start`，先验证健康和查询接口。

将 `deploy/media-searcher.service` 安装到 `/etc/systemd/system/media-searcher.service`。根据 Node 安装位置调整 `ExecStart`（用 `command -v node` 确认），确保专用用户可以读取代码和 `.env`。

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now media-searcher
sudo systemctl status media-searcher
sudo journalctl -u media-searcher -n 100 --no-pager
```

此方式使用 `.env` 的 `HOST` / `PORT`，默认只监听本机。Nginx 配置与 Docker 方式相同。

## 常见问题

- **主页可用，搜索失败**：检查 `sources[].message`、服务器 DNS、出网 HTTPS 及上游访问限制。应用运行和上游可达性是不同状态。
- **海搜 / PanSou 显示待配置**：检查 `.env`，修改后重启 Node 或执行 `docker compose up -d`。
- **检测不可用**：默认盘搜索没有检测接口；需启用 PanSou 或海搜。不确定、超时和需要密码不会当作明确失效。
- **域名访问被限流**：可信反代后未开启 `TRUST_PROXY` 时，服务看到的是代理 IP。按反代说明调整。
- **不能自动复制**：HTTPS 或 localhost 下通常允许剪贴板操作；普通 HTTP 页面提供手动复制对话框。
- **凭据管理**：key 不发送给前端、不提交到 Git、不输出到应用日志；部署时避免在外部网关记录海搜出站 URL 的 key。
