# OTP Relay 云端服务

该目录是安卓验证码同步工具的密文中转服务。生产模式使用：

- PostgreSQL：配对关系、设备凭证哈希和撤销状态。
- Redis：5 分钟配对会话、待投递密文和 10 分钟 ACK 幂等键；关闭持久化。
- Caddy：自动申请及续期 TLS 证书，代理 HTTPS 和 WSS。
- Fastify：配对、密文上传、WebSocket 推送、ACK 和解绑接口。

服务端不会解密验证码。日志关闭常规请求访问记录，并对凭证、密文、nonce 和临时公钥字段做脱敏。

## 本地开发

```bash
npm ci
npm run typecheck
npm test
npm run dev
```

默认使用 `STORE_DRIVER=memory` 并监听 `127.0.0.1:39002`，仅用于本地联调。

## 生产部署前准备

1. 准备指向服务器公网 IP 的域名，例如 `otp.example.com`。
2. 安全组和系统防火墙只对公网开放 TCP 22、80、443 和 UDP 443。
3. 不要开放 39002、5432、6379。
4. 服务器安装 Docker Engine 与 Docker Compose 插件。
5. 建议至少 2 核、2 GB 内存和 20 GB 磁盘。

## 首次部署

将 `server/` 目录上传到服务器后执行：

```bash
cd server
cp .env.production.example .env.production
```

编辑 `.env.production`：

- `RELAY_DOMAIN`：已经解析到该服务器的域名，不包含 `https://`。
- `POSTGRES_PASSWORD`：至少 32 位随机字符串，建议只使用大小写字母和数字。
- 其余值小范围内测可保持默认。

然后执行：

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

应用启动时会在 PostgreSQL 中自动执行未运行的迁移。Caddy 会在 80/443 可从公网访问后自动申请证书。

### 接入服务器现有 Nginx

如果 80/443 已由 Docker 中的 Nginx 使用，请设置：

```dotenv
RELAY_DOMAIN=现有证书域名
PUBLIC_BASE_URL=https://现有证书域名/otp-relay
EXTERNAL_PROXY_NETWORK=现有Nginx所在的Docker网络
```

然后执行：

```bash
chmod +x scripts/deploy-behind-nginx.sh
./scripts/deploy-behind-nginx.sh
```

该模式不会启动 Caddy。应用容器仅加入 Nginx 网络，PostgreSQL 和 Redis仍只位于内部网络。Nginx 需要将 `/otp-relay/` 代理到 `http://otp-relay-app:39002/`，并保留 WebSocket Upgrade 请求头。

## 验证

```bash
curl --fail --silent "https://${RELAY_DOMAIN}/otp-relay/healthz"
curl --fail --silent "https://${RELAY_DOMAIN}/otp-relay/readyz"
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs --tail=100 app caddy
```

预期：

- `/healthz` 返回 `status=ok`。
- `/readyz` 返回 `status=ready`，表示 PostgreSQL 与 Redis 均可用。
- `postgres`、`redis`、`app` 状态为 healthy。
- Caddy 日志显示证书申请成功。

首次上云后，在 macOS 或 Windows 客户端的偏好设置中填入域名（如 `otp.example.com`），然后生成新二维码并用 Android 客户端重新配对。本地内存版的配对不能迁移。

## 更新

上传新代码后再次运行：

```bash
./scripts/deploy.sh
```

数据库迁移具有幂等记录。PostgreSQL 数据卷、Caddy 证书卷不会因应用镜像更新而删除。不要执行 `docker compose down -v`。

## 备份

小范围内测至少每天备份一次 PostgreSQL：

```bash
docker compose --env-file .env.production exec -T postgres \
  pg_dump -U otp_relay -d otp_relay --format=custom > otp-relay.dump
```

备份只包含配对元数据和凭证哈希，不包含短信正文、验证码或可解密密钥。Redis 不备份，未送达密文最多保留 5 分钟。

## 故障定位

- `healthz` 正常、`readyz` 失败：检查 PostgreSQL/Redis 容器和连接配置。
- HTTPS 失败：检查 DNS、80/443 安全组和 Caddy 日志。
- Android 上传失败：确认二维码中的服务地址为 HTTPS 域名，检查设备时间。
- Mac 不收消息：检查 WSS 是否在线；服务端每 15 秒 ping，Mac 客户端每 10 秒主动心跳并自动重连。
- 服务重启后待投递消息：Redis 容器未重建时仍可补发；Redis 重启按 MVP 设计允许丢失最长 5 分钟的待投递密文。
