# 游观：游戏情报收集系统

供点触科技团队协作维护的 Web 版游戏情报库。首版包括游戏搜索、类型/平台分类、可视化分析、两款产品对比，以及钉钉聊天查询机器人。

## 本地运行

要求 Node.js 20+。

```bash
npm install
npm run dev
```

打开 `http://localhost:5173`。前端由 Vite 启动，API 位于 `http://localhost:3001`。执行 `npm run build` 后可用 `npm start` 从同一服务提供前端与 API。测试命令为 `npm test`。

首次运行读取 `data/seed.json` 中的 12 款演示游戏；网页新增、编辑、删除后会保存到 `data/games.json`。后者已加入 `.gitignore`，不会把团队运行数据误提交到代码仓库。演示记录的价格、好评率、评价数和在线峰值只是界面样例，不应作为真实市场结论。

## 钉钉机器人

详细步骤见 [钉钉游戏信息助手接入说明](docs/dingtalk-bot-setup.md)。

1. 在钉钉开放平台为**点触科技股份有限公司**创建企业内部应用，添加机器人能力，选择 **Stream 模式**，发布并让组织成员可用。
2. 将 `.env.example` 复制为 `.env`，填入应用的 `DINGTALK_CLIENT_ID`（AppKey）、`DINGTALK_CLIENT_SECRET`（AppSecret）。建议同时填写点触科技的 `DINGTALK_CORP_ID`。
3. 运行 `npm run dev` 或在构建后运行 `npm start`；服务启动时会自动读取 `.env`。
4. 在钉钉与机器人单聊，或将机器人加入组织内群聊，发送 `查询 星露谷`、`黑神话`、`游戏科学` 等文字。机器人检索与网页相同的情报库，并标记演示指标。

机器人仅回应 `senderCorpId` 与应用 `chatbotCorpId` 一致的组织内消息；设置 `DINGTALK_CORP_ID` 后还会核对指定企业。凭证不要提交到 Git。当前没有企业应用凭证，因此真实钉钉收发需要在应用创建后联调。钉钉接入使用官方 `dingtalk-stream` Node SDK。

**部署注意：**此首版 API 未实现网页登录与编辑权限控制。对组织开放时，应先接入钉钉登录/组织身份校验，并把写接口限定给授权成员；当前仅适合本机或受限网络内试用。团队并发编辑与正式部署建议将 `data/games.json` 迁移到数据库。

## 两人 Git 协作

仓库默认分支为 `main`。把仓库推送到双方可访问的 Git 远端后，建议按功能分支协作：

```bash
git switch -c feat/web-experience
# 另一位成员使用 feat/dingtalk-bot 等独立分支
git add .
git commit -m "feat: improve game intelligence features"
git push -u origin feat/web-experience
```

通过合并请求互相审查后合并到 `main`。一个人负责 Web 检索、图表、对比与数据录入，另一人负责钉钉机器人、组织登录和部署联调。远端仓库地址和双方账号尚未提供，因此这里没有配置 `origin` 或邀请卢雨。
