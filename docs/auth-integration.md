# 外部身份服务对接契约

工作台只接收外部服务已经验证的组织身份。钉钉连接由卢雨维护；本接口不调用钉钉 API。

## 工作台配置

设置 `AUTH_MODE=external`、`AUTH_CORP_ID`、`AUTH_SHARED_SECRET`（至少 32 字符）、`EXTERNAL_LOGIN_URL` 和 `AUTH_COOKIE_SECURE=true`。公网登录入口必须是 HTTPS。工作台本身也必须通过 HTTPS 访问；生产环境的 Cookie 带 `Secure`。`AUTH_SHARED_SECRET` 只在两端服务端保存。

## 浏览器流程

1. 用户访问工作台。未登录时前端导航至 `GET /api/auth/login`。
2. 工作台生成一次性 `state`，设置 HttpOnly Cookie，并跳转到 `EXTERNAL_LOGIN_URL?state=<state>`。
3. 卢雨的身份服务完成组织成员验证及角色映射后，由浏览器以 `application/x-www-form-urlencoded` 表单 POST 到工作台 `/api/auth/exchange`。表单字段为 `corpId`、`id`、`name`、`role`、`timestamp`、`nonce`、`state`、`signature`。
4. 工作台验证通过后设置 HttpOnly 会话 Cookie，返回 303 到 `/`。前端随后读取 `GET /api/auth/me`，取得用户信息和 `csrfToken`。

`role` 只接受 `investor`、`analyst`、`admin`。`timestamp` 是 Unix 毫秒时间戳；`nonce` 是 16–128 位 URL-safe 随机串，不能重复。`state` 原样回传。`signature` 为 HMAC-SHA256 的小写十六进制值：签名原文按 `corpId`、`id`、`name`、`role`、`timestamp`、`nonce`、`state` 顺序，用单个 LF（`\n`）连接，末尾不加换行。身份声明有效期为 5 分钟，企业 ID 必须匹配 `AUTH_CORP_ID`。

前端写请求带 `X-CSRF-Token`。投资人只读；分析师可编辑项目和游戏并导入；管理员可修改评分参数。未登录返回 401，权限或 CSRF 不通过返回 403。会话保存在工作台进程内，重启后需重新登录；多实例部署前须改为共享会话存储或保持单实例。

## 联调验收

- 三种角色各登录一次，核对工作台显示的姓名与角色，以及按钮和 API 权限。
- 验证企业不匹配、签名错误、过期时间戳、重复 `nonce`、缺少或重用 `state` 均被拒绝。
- 验证退出后会话失效，重新登录可获得新会话。
