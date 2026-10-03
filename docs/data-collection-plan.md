# 游戏情报数据收集方案（MVP）

状态：Draft v1  
更新日期：2026-10-03  
适用范围：第一阶段数据采集、清洗、入库和质量监控

## 1. 目标与边界

第一阶段建立一个可稳定重复运行的数据管道，为 Web 看板和钉钉机器人提供数据。MVP 不追求覆盖所有游戏平台，而是先验证以下闭环：

1. 从官方或明确授权的 API 获取游戏主数据、新闻和热度指标。
2. 将不同来源的同一游戏归并为一个内部游戏实体。
3. 保存原始响应和标准化数据，保证错误可追溯、任务可重跑。
4. 按固定频率生成时间序列快照，支持热度趋势和异常告警。
5. 向后端 API 提供更新时间明确、来源可解释的数据。

时间窗口在 MVP 中定义为滚动窗口，每次任务按运行日期动态计算：

- 近一年窗口：最近 365 天，用于国内外发行、新闻、视频和榜单的年度分析；
- 近几个月窗口：最近 90 天，用于季度趋势和平台对比；
- 短期窗口：最近 30 天和最近 7 天，用于热点变化和钉钉告警；
- 未来窗口：未来 12 个月内计划发行的游戏；
- 首批规模：300～500 个主游戏，不采集合集、豪华版等重复版本；
- 区域和语言：全球数据为主，优先保留中国、亚洲和全球发行信息。

暂不纳入 MVP：全网网页爬取、论坛用户画像、未获授权的评论全文、用户个人数据，以及对所有历史游戏进行全量镜像。

### 1.1 历史回填的可行范围

“覆盖近一年”不代表所有指标都能事后还原。采集器必须为每个指标标记 `historical_mode`：

- `event_history`：可以按发布时间回填，例如发行信息、新闻、公告和视频；
- `current_cumulative`：能找到过去发布的内容，但只能获得当前累计播放/互动量，不能伪造历史每日变化；
- `point_in_time`：官方接口只返回当前值，例如部分当前玩家数和直播观看数据，只能从系统上线当天开始积累；
- `first_party_export`：自有微信/抖音小游戏能否回填取决于后台保留期和导出范围；
- `licensed_history`：需要采购或获得授权的数据商历史库。

因此，第一轮回填目标是：

1. 回填最近 365 天的游戏发行、新闻、公告、视频发布和公开榜单记录；
2. 同时生成最近 90、30、7 天的派生数据集；
3. 对无法事后还原的热度指标，从首次上线采集时间开始形成快照；
4. 自有小游戏优先导入平台后台能够提供的最长历史区间，并记录实际覆盖起止日期；
5. 每个图表显示数据覆盖范围，缺失历史时不得用 0 填充。

## 2. 数据源优先级

| 优先级 | 来源 | 主要用途 | MVP 策略 | 接入凭证 |
| --- | --- | --- | --- | --- |
| P0 | IGDB | 游戏主数据、发行日期、类型、厂商、平台、评分、外部 ID | 建立内部游戏目录的主来源 | Twitch Client ID/Secret，后端换取 App Token |
| P0 | Steam | Steam 应用目录、游戏新闻、当前玩家数 | 仅采集已映射且被跟踪的游戏 | Steam Web API Key；公开新闻接口无需密钥 |
| P0 | Twitch | 热门游戏、直播流、观看人数 | 每次采集头部样本并按游戏汇总 | Twitch Client ID/Secret + App Token |
| P1 | YouTube | 相关视频、播放量和发布时间 | 每天仅查询重点游戏，严格控制配额 | YouTube Data API Key |
| P0（自有游戏） | 微信小游戏 | 自有游戏的访问、留存、来源和聚合画像 | 官方数据接口优先，后台导出兜底 | 自有小游戏 AppID/Secret 与数据权限 |
| P0（自有游戏） | 抖音小游戏 | 自有游戏的用户、来源、增长、性能和自定义事件 | 客户端埋点 + 官方后台/API/导出 | 自有小游戏权限与服务端 Token |
| P1 | B站 | 游戏相关视频、稿件表现和内容事件 | 仅采集自有或已授权账号数据 | B站开放平台应用 + 用户 OAuth 授权 |
| P2 | TapTap、国内公开榜单 | 市场排名和公开事件 | API/授权确认后接入；MVP 可人工导入 | 待确认 |

权威文档：

- IGDB API：https://api-docs.igdb.com/
- Steam Web API：https://partner.steamgames.com/doc/webapi_overview
- Steam Store Service：https://partner.steamgames.com/doc/webapi/IStoreService
- Steam News：https://partner.steamgames.com/doc/webapi/ISteamNews
- Twitch API：https://dev.twitch.tv/docs/api/reference
- Twitch 限流：https://dev.twitch.tv/docs/api/guide
- YouTube Data API：https://developers.google.com/youtube/v3/getting-started
- YouTube 配额：https://developers.google.com/youtube/v3/determine_quota_cost
- B站开放平台：https://openhome.bilibili.com/doc
- 抖音小游戏数据分析：https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/operation1/about-data/data-assistant
- 抖音小游戏服务端 API：https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/server/server-api-introduction
- 微信数据分析接口：https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/data-analysis/analysis/getDailyVisitTrend.html

### 2.1 国内平台的数据权限边界

国内平台必须拆成两条数据线，不能混在一起设计：

**自有运营数据**是指团队拥有 AppID，或已被管理员授权的数据。微信、抖音小游戏的活跃、留存、来源、收入等数据属于这一类，可以通过官方接口、官方后台或后台导出接入。

**市场情报数据**是指其他公司游戏的热度、排行和内容表现。微信、抖音不会向普通开发者开放竞争游戏的 DAU、留存、收入等后台指标；系统不能假设可以获得这些数据。此类情报只使用公开榜单、已授权账号内容、公开新闻，以及具备合法授权的数据供应商。

| 平台 | 可以稳定获取 | 不能作为默认可获取数据 | MVP 获取方式 |
| --- | --- | --- | --- |
| B站 | 自有/合作 UP 主授权后的稿件、视频和账号数据 | 全站任意关键词的完整历史数据、竞争账号后台数据 | 开放平台 OAuth；无授权数据走人工导入或合规数据商 |
| 抖音小游戏 | 自有游戏用户、来源、增长、性能、自定义事件等聚合数据 | 其他小游戏 DAU、留存、收入和完整投放数据 | `tt.reportAnalytics` 埋点；官方后台/API；CSV 导出适配器 |
| 微信小游戏 | 自有 AppID 的访问趋势、留存、来源、页面等聚合数据，具体以 AppID 权限为准 | 其他小游戏的运营后台指标 | 官方数据接口；接口权限不足时使用后台导出 |

任何“网页上能看到”的数据都不自动等于允许批量抓取。未找到官方开放接口时，先记录为 `manual_import`，不调用未公开接口、不绕过签名或登录态。

### 2.2 国内数据接入路线

#### B站内容信号

B站开放平台当前主要提供账号授权、用户管理、视频管理、数据开放和直播能力。第一阶段只对以下账号建采集任务：

- 团队自己的官方账号；
- 发行商、合作媒体或 UP 主明确授权的账号；
- 已签署数据合作协议的数据源。

采集字段包括：`bvid/稿件 ID`、标题、发布时间、作者、关联游戏、播放/互动聚合指标、原始链接、采集时间和授权主体。视频标题和描述只用于游戏匹配，匹配失败进入人工审核。

如果目标是全站游戏舆情，MVP 不直接使用非公开 Web 接口。先实现统一 CSV 导入器，为后续采购的合规数据或人工导出的榜单预留入口。

#### 抖音小游戏运营数据

抖音小游戏提供用户分析、来源分析、增长分析、性能分析和自定义分析。接入分两部分：

1. 在小游戏端通过 `tt.reportAnalytics` 上报已在开发者后台配置的自定义事件。
2. 服务端从官方可用接口或后台导出结果获取聚合数据；小游戏接口与普通抖音小程序接口分开验证，禁止直接假设两者权限相同。

首批自定义事件建议统一为：

```text
game_launch
tutorial_start
tutorial_complete
level_start
level_complete
share_attempt
share_success
ad_impression
ad_reward_granted
purchase_success
```

事件只上报业务所需的匿名维度，例如关卡、渠道、版本和设备大类；不上传昵称、手机号、OpenID 明文或自由输入内容。

#### 微信小游戏运营数据

对团队自有微信小游戏，优先验证 AppID 是否可调用数据分析接口，包括日访问趋势、访问分布、留存、页面和聚合画像。由于部分文档与权限同时覆盖小程序生态，接入前必须用真实小游戏测试账号做一次权限探测。

探测结果写入 `source_capabilities`：

```text
source = wechat_minigame
capability = daily_visit_trend | retain | distribution | page | portrait
access_mode = api | export | unavailable
verified_at
```

接口不可用不视为系统错误，任务自动降级为后台 CSV 导入流程，并在 Web 管理页显示“需要更新数据文件”。

### 2.3 国内公开榜单的人工导入

为微信、抖音、TapTap 等暂无稳定开放接口的数据建立统一模板：

```text
snapshot_date,source,rank,game_name,external_url,
category,metric_name,metric_value,region,evidence_note
```

每次导入同时保存原文件哈希、导入人、来源页面、采集日期和备注。排名只能做“该榜单内排名”分析，不能直接推导真实 DAU 或收入。

## 3. 采集字段

### 3.1 游戏主数据

内部统一字段：

| 字段 | 含义 | 首选来源 |
| --- | --- | --- |
| `canonical_game_id` | 内部 UUID，永不复用 | 系统生成 |
| `name` / `slug` | 标准名称和 URL 名称 | IGDB |
| `alternative_names` | 别名、中文名、旧名称 | IGDB + 人工维护 |
| `summary` | 游戏简介 | IGDB |
| `game_type` | 主游戏、DLC、资料片等 | IGDB |
| `genres` / `themes` | 类型和主题 | IGDB |
| `companies` | 开发商、发行商及角色 | IGDB |
| `platforms` | PC、PlayStation、Xbox、Switch 等 | IGDB |
| `release_dates` | 按平台、地区记录的发行日期 | IGDB |
| `cover_url` | 封面资源标识或 URL | IGDB |
| `rating` / `rating_count` | 评分及样本量 | IGDB |
| `external_ids` | IGDB、Steam AppID、Twitch Game ID 等 | 各来源 |
| `source_updated_at` | 来源数据最后更新时间 | 各来源 |
| `normalized_at` | 本系统最后标准化时间 | 系统生成 |

不要用游戏名称作为唯一键；名称会重名、改名，并存在本地化差异。

### 3.2 新闻与事件

统一字段：

- `source`、`source_item_id`、`canonical_game_id`；
- 标题、摘要、原始链接、作者/发布方；
- 发布时间、首次发现时间、最后更新时间；
- 内容语言、事件类型（更新、发售、活动、公告等）；
- 原始内容哈希，用于去重；
- 是否已用于钉钉推送。

Steam 首期使用 `ISteamNews/GetNewsForApp/v2`。正文只保留分析所需内容；对外展示时保留来源和原始链接。

### 3.3 热度快照

每条指标都必须带来源、采集时间、指标名称、数值和采样范围：

- Steam：当前玩家数；
- Twitch：样本中的直播间数量、观看人数合计、最高直播间观看人数；
- YouTube：匹配视频数量、视频播放量、点赞量、发布时间；
- IGDB：评分、评分人数、hype 等可用指标。
- B站：授权稿件的播放、点赞、评论、收藏等公开或授权聚合指标；
- 抖音小游戏：自有游戏的活跃、新增、打开次数、停留、留存、渠道转化和自定义事件；
- 微信小游戏：自有游戏的访问次数、访问人数、新用户、停留、深度、留存和来源分布；
- 国内公开榜单：榜单名、分类、名次和采集日期。

Twitch 的 `Get Streams` 返回的是分页直播流样本，因此汇总值应命名为“已采集样本观看人数”，不能宣称为平台全量观看人数。

自有小游戏运营指标和竞争游戏公开情报必须分表或带 `data_scope` 字段区分：`first_party`、`authorized_content`、`public_ranking`、`licensed_market_data`。分析层禁止把不同范围的数据直接横向排名。

## 4. 首次导入和增量策略

### 4.1 首次导入

1. 从 IGDB 读取 2022-01-01 至今以及未来 12 个月的主游戏候选。
2. 排除 `version_parent` 非空的版本；DLC 和资料片是否保留由 `game_type` 白名单控制。
3. 按热度、评分样本量、发行时间和平台范围筛选 300～500 个游戏。
4. 同步平台、类型、公司、发行日期和外部 ID。
5. 使用 IGDB 外部 ID 优先映射 Steam AppID；无法确定的记录进入人工审核队列。
6. 对已映射 Steam 游戏补采最近新闻，并建立热度快照任务。
7. 通过 Twitch 分类搜索建立 Twitch Game ID 映射。

### 4.2 增量更新

- IGDB：按 `updated_at > last_checkpoint` 拉取变化，成功提交后再推进 checkpoint。
- Steam App List：使用 `if_modified_since`；新闻按已跟踪 AppID 增量采集。
- Twitch：每次重新获取热门分类和直播流，写入不可变快照。
- YouTube：保存 `publishedAfter` 和已见过的 Video ID，避免重复搜索与入库。

所有增量任务必须满足幂等性：同一个来源 ID 重跑不会产生重复业务记录。

## 5. 采集频率

| 任务 | 建议频率 | 原因 |
| --- | --- | --- |
| IGDB 游戏目录增量 | 每天 02:00 | 主数据变化较慢 |
| 未来 30 天新游检查 | 每 6 小时 | 发行日期可能调整 |
| Steam 新闻 | 每 2 小时 | 支持及时情报告警 |
| Steam 当前玩家数 | 每 30 分钟，仅跟踪游戏 | 控制请求量并形成趋势 |
| Twitch 热门游戏与直播流 | 每 15 分钟 | 直播热度变化快 |
| YouTube 关键词搜索 | 每天一次 | `search.list` 有单独配额限制 |
| B站授权稿件数据 | 每 2 小时 | 用于内容热度趋势，受授权范围限制 |
| 抖音小游戏运营数据 | 每天 15:00 后 | 以官方数据更新时间为准，保存 T+1 快照 |
| 微信小游戏运营数据 | 每天 06:00 | 拉取前一日聚合数据；失败时等待下一窗口重试 |
| 国内榜单人工导入检查 | 每天 10:00 | 只提醒缺失，不自动抓取页面 |
| 数据质量检查 | 每天 04:00 | 在日报生成前发现异常 |
| 钉钉日报数据汇总 | 每天 08:30 | 供 09:00 推送 |

调度时间加 0～5 分钟随机抖动，避免所有任务在整点同时请求外部服务。

## 6. 游戏身份匹配

匹配顺序从可靠到不可靠：

1. 已知外部 ID 的直接映射，例如 IGDB `external_games` 对应 Steam AppID。
2. 标准化名称 + 发行年份 + 开发商/发行商一致。
3. 标准化名称 + 平台 + 发行日期接近。
4. 仅名称相似的结果不得自动合并，进入人工审核队列。

名称标准化只用于候选匹配，不覆盖展示名称。建议处理：大小写、全半角、标点、商标符号、连续空格和常见版本后缀；中文名与英文名作为别名保存。

匹配结果需要保存：`match_method`、`confidence`、`review_status`、`reviewed_by` 和时间，方便纠错与回滚。

## 7. 存储分层

### 7.1 原始层

`raw_ingestions` 保存：

- 来源、端点、请求参数摘要；
- HTTP 状态、采集时间、响应哈希；
- 原始 JSON 或对象存储路径；
- 采集任务 ID、解析状态和错误信息。

原始数据用于追溯和重新解析，不直接提供给前端。

### 7.2 标准化层

建议核心表：

```text
games
game_aliases
platforms
game_platforms
companies
game_companies
release_dates
external_game_ids
news_items
metric_snapshots
source_checkpoints
ingestion_runs
entity_match_reviews
source_capabilities
owned_game_daily_metrics
content_metric_snapshots
domestic_rank_snapshots
manual_import_batches
```

`metric_snapshots` 按月分区的需求可在数据量明显增长后再实现，MVP 先建立 `(canonical_game_id, metric_name, captured_at)` 复合索引。

## 8. 可靠性与限流

统一采集客户端必须实现：

- 连接超时、读取超时和最大响应大小；
- 只对超时、429、502、503、504 进行自动重试；
- 指数退避并加入随机抖动，最多 4 次；
- 解析 Twitch 的 `Ratelimit-Remaining` 和 `Ratelimit-Reset`；
- 401 时最多刷新一次 OAuth Token，禁止无限刷新；
- 单条数据异常进入失败队列，不中止整个批次；
- checkpoint 只在批次完整提交后更新；
- 每个任务使用分布式锁或数据库锁，避免重复执行。

连续失败达到阈值后，生成系统告警，而不是继续高频请求外部 API。

## 9. 数据质量规则

每天至少检查：

1. 新增和更新数量是否显著偏离近 7 天均值。
2. 游戏名称、来源 ID、来源更新时间是否缺失。
3. 同一来源 ID 是否映射到多个内部游戏。
4. 发行日期是否超出合理范围，时间戳单位是否错误。
5. 热度指标是否为负数或发生不合理跳变。
6. 最近一次成功采集时间是否超过该来源新鲜度目标。
7. 数据源返回结构是否变化，未知字段只记录、不导致任务整体失败。

新鲜度目标：IGDB 小于 30 小时、Steam 新闻小于 3 小时、Twitch 小于 30 分钟、YouTube 小于 30 小时。

## 10. 安全与合规

- 所有密钥只通过环境变量或部署平台 Secret 注入。
- `.env` 不提交 Git，只提交不含真实值的 `.env.example`。
- 日志不得输出 Token、Webhook、完整请求头或个人数据。
- 优先使用官方 API，并遵守来源的服务条款、配额、缓存和署名要求。
- 不绕过登录、验证码、反爬或访问限制。
- 展示新闻和视频时保留来源、发布时间和原始链接。
- MVP 不采集 Twitch/YouTube 用户个人画像和评论用户信息。
- 微信、抖音小游戏只保存汇总数据；如业务确需用户级事件，必须使用不可逆内部标识并单独完成隐私评审。
- B站 OAuth 授权范围、授权人、过期时间和撤销状态必须可审计；撤销后停止增量采集。

## 11. 监控指标

每次任务写入 `ingestion_runs`：

- 开始/结束时间、状态、任务版本；
- 请求数、成功数、失败数、重试数；
- 获取、创建、更新、跳过的记录数；
- 429、401 和解析失败数量；
- checkpoint 起止值；
- 数据延迟和任务耗时。

需要告警的条件：任务连续失败 3 次、来源超过新鲜度目标、429 持续出现、单次数据量下降 80% 以上、映射冲突或数据库写入失败。

## 12. 开发顺序与验收

### Iteration 1：IGDB 主目录

- OAuth Token 管理；
- IGDB 分页和 checkpoint；
- 游戏、平台、类型、公司和发行日期标准化；
- 原始响应、任务运行记录与幂等 upsert；
- 使用固定响应 fixture 的单元测试。

验收：连续执行两次不产生重复游戏；中途失败后可从旧 checkpoint 安全重跑；数据库中至少有 300 个符合窗口的游戏。

### Iteration 2：Steam

- Steam AppID 映射；
- 新闻增量采集；
- 被跟踪游戏的当前玩家数快照；
- 映射冲突人工审核表。

验收：至少 100 个游戏完成 Steam 映射；新闻无重复；玩家数形成至少 24 小时趋势。

### Iteration 3：Twitch 与日报数据集

- 热门分类和直播流采集；
- 按游戏汇总样本指标；
- 生成每日排行榜和变化率；
- 暴露给钉钉日报的只读查询。

验收：15 分钟任务稳定运行；能解释排行榜中每个数值的来源、采集时间和样本范围。

### Iteration 4：国内平台

- 建立 `data_scope` 与 `source_capabilities`；
- 实现国内榜单通用 CSV 导入；
- 完成微信小游戏权限探测和日数据采集/导入；
- 完成抖音自定义事件字典和日报导入；
- 接入至少一个已授权 B站账号的稿件数据。

验收：任何一条国内指标都能回答“属于谁、如何授权、采集时间、数据范围、是否为全量”；接口权限不足时能降级到导入流程，不调用未公开接口。

### Iteration 5：YouTube（可选）

- 仅对重点游戏生成搜索词；
- 每日请求预算和硬限制；
- 视频 ID 去重与 `videos.list` 批量补充指标。

验收：超出每日预算前主动停止，不因单个关键词失败影响其他任务。

## 13. 第一批 Git Issue

1. `data: define PostgreSQL schema and migrations`
2. `collector: implement shared HTTP client and retry policy`
3. `collector: implement OAuth token cache for IGDB/Twitch`
4. `collector: import IGDB game catalog incrementally`
5. `data: normalize platforms, companies and release dates`
6. `quality: add ingestion run metrics and freshness checks`
7. `test: add API fixtures and idempotency tests`
8. `docs: add local secrets and collector run instructions`
9. `data: add data scope and source capability model`
10. `import: add domestic ranking CSV validation and idempotent import`
11. `collector: probe WeChat mini-game analytics capabilities`
12. `integration: define Douyin mini-game event dictionary and export adapter`
13. `collector: import authorized Bilibili content metrics`

建议第一个 PR 只完成 Issue 1～3；第二个 PR 再接入 IGDB，降低多人同时修改同一批基础文件的冲突。
