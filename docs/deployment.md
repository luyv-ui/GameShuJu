# 团队部署准备

当前可在本机完成构建和数据迁移。团队环境的域名、TLS、网络访问和真实身份联调须在目标环境确定后执行。

1. 使用 Node.js 20+，执行 `npm ci`、`npm test`、`npm run build`。
2. 备份现有 `data/*.json`。执行 `npm run migrate:sqlite -- --database <持久目录>/investment.sqlite`，核对游戏、项目和风险数量。迁移不会删除 JSON。
3. 在仅部署主机可读的 `.env` 设置 `DATABASE_FILE` 为上述路径，并按[外部身份契约](auth-integration.md)设置认证变量。不要将 `.env`、SQLite 文件或备份提交到仓库。
4. 将工作台置于 HTTPS 反向代理之后，保持 Node 服务监听内部 `127.0.0.1`；通过 `GET /api/health` 验证服务启动。单实例运行 `npm start`。
5. 先完成三角色登录及写权限联调，再开放团队入口。当前会话在进程内，多实例部署需要共享会话存储。
6. 定期执行 `npm run backup:sqlite -- --database <运行库> --output <新备份路径>`，在隔离路径用 `npm run restore:sqlite -- --backup <备份> --database <新目标>` 演练恢复，并核对业务记录数量。

本机预览地址只在当前电脑可访问，不是团队访问地址。部署目标、域名和真实身份服务未确定前，阶段④的生产验收仍待完成。
