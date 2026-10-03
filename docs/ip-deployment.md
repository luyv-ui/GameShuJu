# 129.204.33.162 独立测试环境

目标地址：`https://129.204.33.162:8448/`。此地址只有在服务器部署、8448 入站放行及验证通过后才可交付使用。现有产品占用 443；本系统使用独立 Docker Compose 项目、仅绑定本机的 8768 端口、独立 SQLite 卷，以及 Nginx 的独立 8448 HTTPS server 块。不会替换 443 的站点配置。

## 账号与安全边界

测试环境使用 `AUTH_MODE=accounts`，账号文件存放三种角色的 scrypt 加盐哈希；初始密码另存交付文件，二者都不进入 Git。账户分别为 `investor-demo`、`analyst-demo`、`admin-demo`。投资人只读，分析师可维护项目与游戏，管理员还可调整评分参数。此模式用于合作伙伴试用，**不是组织身份服务的正式联调结果**。正式组织登录仍按 [身份交换契约](auth-integration.md) 对接。

在受控电脑上生成账号文件：

```sh
npm run create:test-accounts -- \
  --users deploy/secrets/accounts.json \
  --credentials data/credentials/game-intelligence-test-accounts.txt
```

两份文件权限均为 `0600`，脚本拒绝覆盖已有文件。将密码交付文件通过安全渠道分别发给三位试用者；服务器只需要账号哈希文件。不要把密码写入 README、Git 提交或群聊。

## 服务器部署

前提：具有服务器 SSH 管理权限、Docker Engine 与 Compose 插件；服务器已有的 `/etc/letsencrypt/live/129.204.33.162/` IP 证书可供 Nginx 使用。先确认 8448 未被占用，并在腾讯云安全组和服务器防火墙中允许 TCP 8448。

1. 把仓库复制到服务器的独立目录，例如 `/opt/game-intelligence`。复制 `deploy/ip.env.example` 为 `deploy/ip.env`，权限 `0600`。通过安全通道把 `deploy/secrets/accounts.json` 放到服务器，确保容器内 UID 1000 可读；不要上传密码交付文件。
2. 将 [Nginx 独立端口配置](../deploy/nginx-ip-8448.conf) 放入 `/etc/nginx/sites-available/game-intelligence.conf` 并单独启用。先运行 `sudo nginx -t`，通过后运行 `sudo systemctl reload nginx`。不要覆盖现有 default 配置。
3. 如需迁移本机业务数据，将 JSON 文件安全复制到服务器独立目录，按[部署说明](deployment.md)中的迁移命令执行，但使用 `docker compose -f compose.ip.yaml`，避免操作已有产品的数据库或卷。
4. 在仓库目录运行 `docker compose -f compose.ip.yaml build app` 和 `docker compose -f compose.ip.yaml up -d`。检查 `docker compose -f compose.ip.yaml ps`、`curl -fsS http://127.0.0.1:8768/api/health` 和 `curl -fsS https://129.204.33.162:8448/api/health`。
5. 运行 `docker compose -f compose.ip.yaml run --rm app npm run check:deployment -- https://129.204.33.162:8448/ --mode accounts`。再用三种测试账号分别登录，核对角色显示、只读与写入权限、退出登录和错误密码拒绝。

正式对外通知前，还需设置定期 SQLite 备份和异机备份位置，并演练从备份恢复到全新卷。升级前先备份；仅对 `game-intelligence` Compose 项目操作，不运行会影响其他 Compose 项目的清理命令。
