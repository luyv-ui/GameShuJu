# 团队部署与正式联调

当前仓库提供单实例 Docker Compose 部署：Node 工作台、Caddy HTTPS 反向代理、SQLite 持久卷。需要一台可运行 Docker Compose 的服务器、指向该服务器的域名，以及组织身份服务提供的登录入口、企业 ID 和双方共享密钥。部署平台和真实身份服务尚未在仓库中配置，因此下列生产操作须在获得这些信息后执行。

## 组织登录联调包含什么

1. 身份服务验证组织成员后，按[身份交换契约](auth-integration.md)签发身份声明，浏览器回传至工作台 `/api/auth/exchange`。双方确认回调地址、企业 ID、角色映射、签名顺序、时间戳和密钥。
2. 分别用投资人、分析师、管理员账号完成真实浏览器登录，核对姓名、角色和页面状态。投资人只读；分析师可写项目与游戏；管理员可改评分参数和启动采集同步。
3. 用测试身份验证错误企业 ID、签名、过期时间戳、重复 nonce、缺少或重用 state 会被拒绝；验证退出登录、会话过期和重启后重新登录。正式密钥仅进入服务端环境变量。
4. 在团队域名上确认 HTTPS、`Secure`/`HttpOnly` Cookie、未登录 API 返回 401、无权限或缺 CSRF 的写入返回 403。

## 首次部署

1. 将域名的 A/AAAA 记录指向服务器，开放入站 80/443，安装 Docker Engine 与 Compose 插件。仓库代码放到服务器；`data/*.json` 不在 Git 中，如需保留本机业务数据，应先经安全通道单独复制到服务器。
2. 复制 `deploy/production.env.example` 为 `deploy/production.env`，填写真实值，执行 `chmod 600 deploy/production.env`。`APP_DOMAIN` 只填域名，不加协议；`EXTERNAL_LOGIN_URL` 必须是 HTTPS。生成随机共享密钥并在工作台与身份服务两端安全配置，不提交到 Git。
3. 所有 Compose 命令均带 `--env-file deploy/production.env`，以便只把域名传给 Caddy，不把身份密钥传给代理。先运行 `docker compose --env-file deploy/production.env build app`。如果要迁移现有 JSON，先把 `games.json`、`projects.json`、`score-config.json` 放入服务器上的独立目录，例如 `/srv/game-import`，再执行：

   ```sh
   docker compose --env-file deploy/production.env run --rm -v /srv/game-import:/import:ro app \
     npm run migrate:sqlite -- --database /app/data/investment.sqlite \
     --games /import/games.json --projects /import/projects.json \
     --score-config /import/score-config.json
   ```

   迁移不删除源 JSON；目标库已有不同数据时会拒绝覆盖。若从零开始，可不执行迁移，但数据库不会自动导入示例游戏。
4. 执行 `docker compose --env-file deploy/production.env up -d`，查看 `docker compose --env-file deploy/production.env ps`，再执行 `docker compose --env-file deploy/production.env run --rm app npm run check:deployment -- https://你的域名`。此检查验证健康接口、匿名访问限制、组织登录跳转和生产 Cookie 属性；它不能代替真实三角色登录联调。
5. 完成上述真实身份验收后才把地址发给团队。单实例会话保存在进程内，重启后需要重新登录。不要把 `app` 服务端口直接发布到公网。

## 备份、恢复和升级

每次升级前先备份。以下命令使用独立备份文件；按实际备份目录调整挂载路径：

```sh
docker compose --env-file deploy/production.env run --rm -v /srv/game-backups:/backup app \
  npm run backup:sqlite -- --database /app/data/investment.sqlite \
  --output /backup/investment-$(date +%Y%m%d-%H%M%S).sqlite
docker compose --env-file deploy/production.env build app
docker compose --env-file deploy/production.env up -d
docker compose --env-file deploy/production.env run --rm app \
  npm run check:deployment -- https://你的域名
```

定期把备份复制到服务器以外的安全位置，并在独立目标路径执行 `npm run restore:sqlite -- --backup <备份> --database <新目标>` 演练，核对游戏、项目及风险记录数。不要直接覆盖运行中的 SQLite 文件。部署脚本和检查通过不代表正式身份联调已通过；以真实组织账号在最终域名完成验收为准。
