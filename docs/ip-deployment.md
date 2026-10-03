# 129.204.33.162 独立测试环境

测试入口预定为 `https://129.204.33.162:8448/`。本系统使用独立的 `game-intelligence.service`、`gameintel` 系统用户、`/opt/game-intelligence` 代码目录、`/var/lib/game-intelligence` 数据目录和 Nginx 8448 配置。已有产品继续使用 443 和各自的服务、数据目录。**只有 8448 公网入站放行并通过公网验收后，该地址才能交付合作伙伴使用。**

## 账号

测试环境使用 `AUTH_MODE=accounts`，不是正式组织身份服务。三种账号分别为 `investor-demo`、`analyst-demo`、`admin-demo`。账号哈希文件保存在服务器 `/etc/game-intelligence/accounts.json`；初始密码只保存在部署人员本机权限为 `0600` 的 `data/credentials/game-intelligence-test-accounts.txt`，不进入 Git。请通过安全渠道分别交付密码。

需要重新生成账号时运行：

```sh
npm run create:test-accounts -- \
  --users deploy/secrets/accounts.json \
  --credentials data/credentials/game-intelligence-test-accounts.txt
```

脚本会拒绝覆盖现有文件。重置账号须先备份旧账号文件并停用旧会话，再将新的哈希文件复制到服务器、设为 `root:gameintel` 且权限 `0640`，最后重启本系统服务。正式组织登录需另按[身份交换契约](auth-integration.md)联调。

## 服务器结构和更新

服务器的 Node 22 运行时单独放在 `/opt/game-intelligence/node`，没有修改系统 Node 或其他产品。当前代码按提交号保存在 `/opt/game-intelligence/releases/<提交号>`，`current` 链接指向运行版本。systemd 配置见 [game-intelligence.service](../deploy/game-intelligence.service)，环境变量模板见 [game-intelligence.env.example](../deploy/game-intelligence.env.example)，Nginx 配置见 [nginx-ip-8448.conf](../deploy/nginx-ip-8448.conf)。Nginx 8448 使用现有 IP 证书，Node 仅监听 `127.0.0.1:8768`。

更新时先运行 `sudo systemctl start game-intelligence-backup.service`，确认备份存在，再将新提交解包到新的 release 目录，用独立 Node 执行 `npm ci`、`npm run build`、`npm prune --omit=dev`。确认新目录所有权为 root 后切换 `current` 链接，并只重启 `game-intelligence.service`。验证失败时将链接切回上一版并重启该服务；数据库不随代码目录回退。

## 数据和备份

SQLite 运行库位于 `/var/lib/game-intelligence/investment.sqlite`。备份脚本 [backup-game-intelligence.sh](../deploy/backup-game-intelligence.sh) 由 [每日定时器](../deploy/game-intelligence-backup.timer) 在服务器时间 02:45 执行，备份保留 30 天，目录为 `/var/backups/game-intelligence`。恢复必须写到新的独立文件，并核对完整性及游戏、项目、风险数量，不能覆盖运行库。服务器本机备份无法防范整机故障，正式长期使用前仍需配置异机备份。

## 验收

```sh
sudo systemctl is-active game-intelligence.service
sudo systemctl is-active game-intelligence-backup.timer
curl -fsS http://127.0.0.1:8768/api/health
curl -fsS https://129.204.33.162:8448/api/health
npm run check:deployment -- https://129.204.33.162:8448/ --mode accounts
```

公网 8448 还需在腾讯云安全组放行 TCP 入站；服务器自身的 Nginx 和本机健康检查正常并不代表外部网络可达。完成公网检查后，再用三种账号分别验证登录、读写权限与退出，核对 443 上的活动、音乐和小游戏页面仍可访问。
