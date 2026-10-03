# 钉钉游戏信息助手接入说明

## 当前能力

机器人与 Web 共用 `server/store.js` 返回的游戏数据。网页通过 `/api/games` 查询，钉钉 Stream 机器人通过 `server/dingtalk.js` 接收文本消息并调用同一个查询模块。

支持的消息：

```text
帮助
查询 黑神话
当前在线
最近发布
最新公告
数据状态
```

## 钉钉侧配置

1. 在钉钉开发者后台选择企业组织。
2. 创建企业内部应用，添加机器人能力。
3. 消息接收模式选择 Stream 模式。
4. 发布应用，并把自己加入可见范围。
5. 获取 Client ID、Client Secret 和企业 CorpId。

如机器人已经由同事创建，请让创建人或管理员把你添加为应用开发者，不要重复创建。

## 本地配置

复制环境变量文件：

```bash
cp .env.example .env
```

填写 `.env`：

```env
PORT=3001
DINGTALK_CLIENT_ID=替换为ClientID
DINGTALK_CLIENT_SECRET=替换为ClientSecret
DINGTALK_CORP_ID=替换为CorpId
PUBLIC_WEB_URL=
```

`PUBLIC_WEB_URL` 可暂时留空。正式部署网页后再填写 HTTPS 地址，机器人会把网页入口附加到回复末尾。

真实凭证不得提交到 Git、聊天或截图中。

## 启动与检查

```bash
npm install
npm run dev
```

启动日志应包含：

```text
API listening on http://localhost:3001
DingTalk bot connected.
```

状态接口：

```text
GET http://localhost:3001/api/bot/status
```

其中 `configured=true` 且 `connected=true` 表示 Stream 机器人已经连接。

本地电脑休眠或服务退出后机器人会停止回答。正式使用时应把后端部署到持续运行的服务器。

## 联调顺序

1. 与机器人单聊，发送“帮助”。
2. 发送“查询 黑神话”，确认能返回游戏记录。
3. 发送“当前在线”和“最新公告”，确认能读取采集数据。
4. 在网页新增或修改一款游戏，再从钉钉查询，验证两端共用数据。
5. 最后把机器人加入测试群，通过 `@机器人 查询 游戏名` 验证群聊。

## 安全边界

- 当前网页写接口尚未接入登录，不能直接暴露到公网。
- Stream 模式不要求提供公网消息回调地址，但后端必须能主动连接钉钉。
- 回复只接受钉钉域名的临时 `sessionWebhook`。
- 设置 `DINGTALK_CORP_ID` 后，机器人只回答指定企业中的消息。
