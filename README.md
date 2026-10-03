# 游观：游戏投资立项决策情报系统

面向游戏投资立项研判的内部工作台。当前已完成项目与风险库、三情景财务测算、自动评级、投资总览、赛道对标、风险监控和实时投资报告（含中文 PDF）。组织权限与正式部署按[分阶段开发计划](docs/phase-plan.md)推进。

## 页面预览

> **给合作伙伴的查看备注（2026-10-03）：**这是阶段③验收版，已完成投资总览、项目详情四视图、赛道对标、风险监控和中文 PDF 报告。请先查看下方截图；需要实际操作时按“本地运行”启动。截图中的项目和财务数字均为演示假设，请重点反馈录入流程、评分口径及页面呈现。当前尚未提供可交互的公网地址。

以下截图使用虚构的演示项目，不含本机项目数据。合作伙伴可先查看界面效果，再按下方步骤在本地运行交互版。

**阶段③：投资决策工作台**

![投资总览](docs/screenshots/stage3-dashboard.png)

![赛道对标](docs/screenshots/stage3-benchmark.png)

![投资报告与 PDF 导出](docs/screenshots/stage3-report.png)

[查看风险监控截图](docs/screenshots/stage3-risk-center.png)

**阶段②：项目与财务测算**

![立项项目清单](docs/screenshots/project-list.png)

![项目评分详情](docs/screenshots/project-assessment.png)

![三情景财务测算](docs/screenshots/project-forecast.png)

## 本地运行

要求 Node.js 20+。

```bash
npm install
npm run dev
```

打开 `http://localhost:5173`。前端由 Vite 启动，API 位于 `http://127.0.0.1:3001`，健康检查为 `GET /api/health`。两个服务默认只监听本机。执行 `npm run build` 后可用 `npm start` 从同一服务提供前端与 API。测试命令为 `npm test`。

首次运行读取 `data/seed.json` 中的 12 款演示游戏；网页新增、编辑、删除后会保存到 `data/games.json`。后者已加入 `.gitignore`，不会把团队运行数据误提交到代码仓库。演示记录的价格、好评率、评价数和在线峰值只是界面样例，不应作为真实市场结论。

待立项项目与竞品游戏分开保存，项目资料保存在本机 `data/projects.json`，评分参数保存在 `data/score-config.json`。项目可录入市场、用户、商业化、运营指标，以及乐观、基准、悲观三情景的财务假设；系统计算 24 个月现金流、NPV、年化 IRR、回本月和最大亏损。已确认的毁灭性风险会自动触发“禁止立项”；资料不足时暂不评级。基准情景 NPV 不大于 0 或 24 个月内未回本时，分数封顶 49，结论为“不推荐立项”。项目分数和结论不可手动填写。具体口径见[阶段计划](docs/phase-plan.md)。

投资总览与风险监控使用已录入的项目和风险事实；赛道对标可选择最多四款竞品。竞品商品页指标不能代替财务数据，缺少同口径数据时显示“未取得”。项目详情中的报告由当前数据实时生成，可通过 `GET /api/projects/:id/report` 读取 JSON，或通过 `GET /api/projects/:id/report.pdf` 导出中文 PDF；报告不会保存为历史快照。PDF 使用仓库内的 Noto Sans SC 字体，其许可见 `assets/fonts/OFL.txt`。

## 公开情报样本与导入

`data/imports/public-games-2026-10-03.json` 是 2026-10-03 采集的 49 款公开样本，覆盖 PC、iOS、Android、PS4、PS5、Xbox、Switch，附来源、抓取时间、指标口径和缺失值说明。网页“导入 JSON”可批量导入；相同 Steam App ID 的演示记录会更新为真实来源记录，重复导入会跳过已有记录。导入后的运行数据保存在本机 `data/games.json`。

`data/imports/立项分析-2026-10-03.md` 给出样本观察、局限与立项验证步骤。可用 `node scripts/collect-public-games.mjs` 重新采集；采集器校验完整性后按抓取时间生成新的 JSON 快照，失败时不发布，也不会覆盖已有快照。该样本不包含可验证的销量或收入，不应据此直接预测盈利。

大目录扩展见 `data/imports/目录扩展说明-2026-10-03.md`。当前本地运行库有 1,499 条：端游 806、App 557、微信小游戏 136。`node scripts/collect-game-catalog.mjs` 可从 Steam、Apple 美国区和腾讯应用宝微信小游戏目录重新生成带时间戳的快照；新目录记录主要是商品元数据，未取得的指标保持 `null`。网页可按三类筛选，并每页显示 50 条；批量导入支持单个 JSON 文件最多 2,000 条。

## 钉钉机器人

详细步骤见 [钉钉游戏信息助手接入说明](docs/dingtalk-bot-setup.md)。

1. 在钉钉开放平台为**点触科技股份有限公司**创建企业内部应用，添加机器人能力，选择 **Stream 模式**，发布并让组织成员可用。
2. 将 `.env.example` 复制为 `.env`，填入应用的 `DINGTALK_CLIENT_ID`（AppKey）、`DINGTALK_CLIENT_SECRET`（AppSecret）。建议同时填写点触科技的 `DINGTALK_CORP_ID`。
3. 运行 `npm run dev` 或在构建后运行 `npm start`；服务启动时会自动读取 `.env`。
4. 在钉钉与机器人单聊，或将机器人加入组织内群聊，发送 `查询 星露谷`、`黑神话`、`游戏科学` 等文字。机器人检索与网页相同的情报库，并标记演示指标。

机器人仅回应 `senderCorpId` 与应用 `chatbotCorpId` 一致的组织内消息；设置 `DINGTALK_CORP_ID` 后还会核对指定企业。凭证不要提交到 Git。当前没有企业应用凭证，因此真实钉钉收发需要在应用创建后联调。钉钉接入使用官方 `dingtalk-stream` Node SDK。

**部署注意：**此首版 API 未实现网页登录与编辑权限控制，新增、编辑、删除和批量导入接口均可被服务可达范围内的访问者调用。不要直接暴露到公网或公司网络。默认监听 `127.0.0.1`；只有在具备独立访问控制的受限环境中才明确设置 `HOST`（例如 `HOST=192.0.2.10 npm start`），并确认防火墙规则。开发前端如需监听其他地址，可单独运行 `npm run dev:web -- --host <地址>`。对组织开放前仍需完成组织登录、写接口授权以及数据库迁移；当前 JSON 文件不适合多人并发编辑。

## 模块协作

本轮按目录分工：数据采集负责 `scripts/` 与 `data/imports/`，后端负责 `server/store.js`，Web 负责 `src/`，钉钉负责 `server/dingtalk.js` 与 `server/query.js`。协调集成负责共享接口约定、跨模块联调和验收；组织登录与数据库迁移仍是后续任务。

仓库默认分支为 `main`。接入团队可访问的 Git 远端后，各模块使用独立功能分支，合并前运行 `npm test` 和 `npm run build`，并由协调集成检查共享接口：

```bash
git switch -c feat/web-experience
git add .
git commit -m "feat: improve game intelligence features"
git push -u origin feat/web-experience
```

通过合并请求审查后合并到 `main`。仓库已配置 Git 远端 `origin`，提交和推送前请确认目标分支及远端权限。
