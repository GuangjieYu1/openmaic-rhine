# OpenMAIC → 阿里云 ECS 部署手册

> 目标机：一台阿里云 ECS，与机器上已有的若干服务同机共存
>
> 本手册刻意不写具体主机地址与实例信息；部署时按实际环境替换下面出现的 `<ECS>`。
> 适用形态：OpenMAIC 容器 + Postgres 容器，全部只绑回环；Cloudflare Tunnel 提供 HTTPS

---

## 零、为什么是这套形态

三个约束决定了下面的每一步，先看懂再动手：

| 约束 | 出处 | 后果 |
|---|---|---|
| ECS 只有 **~1.6 GB 内存** | `实测 | ① 绝不能在这台机器上构建镜像；② Postgres 必须调低内存参数；③ 两个容器都要设 `mem_limit` |
| 现有业务占着 **80 / 8081 / 5568 / 8080** | 部署前 `ss -ltnp` 核对 | OpenMAIC 只能用新端口，且只绑 `127.0.0.1` |
| iOS 的 `NSAllowsLocalNetworking` **不覆盖公网明文 HTTP** | ReinLab `ios/App/App/Info.plist` | 公网入口**必须** HTTPS，否则 iPad 上 ATS 直接拦掉 |

**为什么用 Cloudflare Tunnel 而不是 Nginx**：Tunnel 是**出站**连接。它不需要在安全组放行任何端口，也不需要证书和域名，而且顺手把 OpenMAIC 藏在了公网扫描之外——正好避开那份手册 §9 指出的「同机上已有的服务是直接暴露在公网 HTTP 上的，没有应用级登录，这里不再重复那个形态。

**代价（必须知情）**：免费 quick tunnel 的域名是 `https://<随机>.trycloudflare.com`，**每次重启都会变**。iPad 的「终端设置 → OpenMAIC 地址」要跟着改。想要固定域名，两条路：

- 买个最便宜的域名（约 ¥30/年）挂到 Cloudflare，改用 **named tunnel**；
- 或改用 **Tailscale Funnel**（`https://<机器>.<tailnet>.ts.net`，固定、免费、真证书）。

---

## 一、端口分配（不要与现有服务冲突）

| 端口 | 归属 | 对外 |
|---|---|---|
| `3000` | OpenMAIC 容器 | **仅 127.0.0.1** |
| `5433` | Postgres 容器（避开系统可能已有的 5432） | **仅 127.0.0.1** |
| `22 / 80 / 8081 / 5568 / 8080` | 现有服务 | **保持原样，一个都别动** |

**不需要新增任何安全组规则。**

---

## 二、在 Mac 上构建镜像（不在 ECS 上构建）

```bash
cd <OpenMAIC 检出>
DOCKER_BUILDKIT=1 docker build \
  --build-arg NEXT_PUBLIC_PRO_WORKBENCH_ENABLED=true \
  -t openmaic-rhine:v1 .

docker save openmaic-rhine:v1 | gzip -9 > /tmp/openmaic-rhine-v1.tar.gz
ls -lh /tmp/openmaic-rhine-v1.tar.gz
```

> 若 BuildKit 报 `failed to authorize ... auth.docker.io`：这台网络的 IPv6 到 Cloudflare 是断的，而 BuildKit 解析前端镜像走的就是那条路。用经典 puller 预拉即可绕过：
> ```bash
> docker pull docker/dockerfile:1 && docker pull node:22-alpine
> ```

---

## 三、传输与加载

```bash
# Mac
scp /tmp/openmaic-rhine-v1.tar.gz root@<ECS>:/tmp/

# ECS
gzip -dc /tmp/openmaic-rhine-v1.tar.gz | docker load
docker images | grep openmaic-rhine
```

---

## 四、首次部署

```bash
sudo mkdir -p /srv/openmaic
sudo chown -R "$USER":"$USER" /srv/openmaic
cd /srv/openmaic

# 放入 compose 与 .env 模板（见本目录）
cp docker-compose.openmaic-aliyun.yml .
cp .env.openmaic.template .env
chmod 600 .env
vi .env     # 按模板逐项填写
```

校验并启动：

```bash
docker compose -f docker-compose.openmaic-aliyun.yml config   # 必须能渲染
docker compose -f docker-compose.openmaic-aliyun.yml up -d
docker compose -f docker-compose.openmaic-aliyun.yml ps
```

---

## 五、数据迁移（本地 → 云端）

```bash
# Mac：导出（本地 PG 在 127.0.0.1:55433）
/opt/homebrew/opt/postgresql@16/bin/pg_dump \
  "$(grep '^DATABASE_URL=' ~/Documents/Codex/2026-09-26/new-chat/outputs/OpenMAIC/.env.local | cut -d= -f2-)" \
  --no-owner --no-privileges -Fc -f /tmp/openmaic.dump
scp /tmp/openmaic.dump root@<ECS>:/tmp/

# ECS：导入
docker exec -i $(docker compose -f /srv/openmaic/docker-compose.openmaic-aliyun.yml ps -q postgres) \
  pg_restore --no-owner --no-privileges -U openmaic -d openmaic < /tmp/openmaic.dump
```

导入后**必须重启 openmaic 容器**，让连接池看到新数据。

---

## 六、HTTPS（Cloudflare quick tunnel）

```bash
# 安装 cloudflared（单文件二进制，不占内存）
curl -fsSL -o /usr/local/bin/cloudflared \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x /usr/local/bin/cloudflared

# 装服务
sudo cp cloudflared-openmaic.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared-openmaic
systemctl status cloudflared-openmaic --no-pager

# 取出本次的公网地址
journalctl -u cloudflared-openmaic --no-pager \
  | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1
```

把这个地址填进 iPad 的「终端设置 → OpenMAIC 地址」，然后验证：

```bash
curl -fsS https://<你的地址>/api/reinlab/health
# 期望 {"ok":true,"apiVersion":1,"persistence":true}
```

---

## 七、验收清单

```bash
cd /srv/openmaic
docker compose -f docker-compose.openmaic-aliyun.yml ps
ss -ltnp | grep -E ':(3000|5433)\b'          # 必须是 127.0.0.1，不能是 0.0.0.0
curl -fsS http://127.0.0.1:3000/api/reinlab/health
curl -fsS https://<公网地址>/api/reinlab/courses | head -c 200
free -m                                        # 关键：看还有多少余量、swap 有没有被吃
```

**内存是这次部署唯一的真风险。** 若 `free -m` 显示 available 低于 ~150 MB，或 swap 使用持续增长，说明这台机器装不下，需要变配到 4 GB 或把 OpenMAIC 挪到独立机器。

---

## 八、日常运维

```bash
cd /srv/openmaic
COMPOSE="docker compose -f docker-compose.openmaic-aliyun.yml"

$COMPOSE ps
$COMPOSE logs --tail=200 -f openmaic
$COMPOSE restart openmaic
$COMPOSE down && $COMPOSE up -d
```

发布新版本：

```bash
docker tag openmaic-rhine:v1 openmaic-rhine:rollback-$(date +%F)
gzip -dc /tmp/openmaic-rhine-v2.tar.gz | docker load
vi /srv/openmaic/.env          # OPENMAIC_IMAGE_TAG=openmaic-rhine:v2
$COMPOSE up -d --force-recreate openmaic
```

回滚：把 `OPENMAIC_IMAGE_TAG` 改回旧 tag 再 `up -d --force-recreate`。

---

## 九、故障排查

| 现象 | 排查方向 |
|---|---|
| 容器起不来，日志报连不上数据库 | `.env` 里 `DATABASE_URL` 的主机名必须是 `postgres`（compose 服务名），不是 `127.0.0.1` |
| `/api/reinlab/courses` 返回 `{"courses":[]}` | `REINLAB_OWNER_ID` 没设或写错；用 `/api/reinlab/whoami` 核对 |
| `/api/reinlab/courses` 返回 404 | 服务端没读到 `DATABASE_URL`（`/api/reinlab/health` 会报 `persistence:false`） |
| 每刷新一次课程库都变空 | `COOKIE_SECURE` 没设成 `0`——隧道回源是 http，Secure cookie 存不下，每次请求都铸一个新 owner |
| iPad 上打不开，浏览器却正常 | ATS：确认用的是 `https://` 地址 |
| `docker compose config` 报错 | `.env` 缺 `POSTGRES_PASSWORD` |
| 整机变慢、SSH 卡 | `free -m` 与 `docker stats`；多半是内存不够，见第七节 |
| 隧道地址变了 | 正常现象（quick tunnel）。重启后重新取一次并更新 iPad 设置 |

---

## 十、安全须知

- `.env` 里有 DeepSeek key、MiMo key、数据库口令，**永远不要提交进 Git**（`chmod 600`，本目录的模板里全是占位符）。
- 镜像构建时 `.dockerignore` 会排除 `.env*`，所以**密钥不会烤进镜像**——换 key 只需改 `.env` 并重启，不用重新构建。
- 隧道地址就是唯一凭据。若担心被人扫到，在 `.env` 里设 `REINLAB_EXPORT_TOKEN` 并在 iPad 的「终端设置 → 导出令牌」填同一个值。
