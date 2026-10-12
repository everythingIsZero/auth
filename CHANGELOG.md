# Changelog

本仓遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，版本语义按 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Docs

- **门面契约同步：`unionid` 转 required（2026-10-12）**：`sso-bridge` 已在 `introspect` / `profile` / `qr/poll` 三响应回传 `unionid`（微信开放平台绑定落地），契约 `facade@1+<sha8>` 的 `pending` 清空，`Projects/auth/contracts/` 内联副本随生成器更新（`contracts@1+<sha8>` 指针同步）。**auth 源码零改动**（早已 `unionid-ready`，有则透传 `ctx.unionid`、无则 `null`）；`test/facade.test.mjs` 两态覆盖不变。详见 [`account-unification.md`](../../knowledge/integration/account-unification.md) §12。

- **`AUTH_ORIGIN` 登记为 SSO 源单源（OPS-9）**：`@hxym18/auth/core` 早已导出该常量（自 v0.1.0），本批补文档并收紧声明——README 出口表/说明写明站点一律取 `AUTH_ORIGIN`（`'https://auth.hxym18.com'`，无尾斜杠），勿再硬编码（wordinput / fang / nuantie 历史上共 4 处逐字复制）。`src/core.d.ts` 声明由 `string` 收紧为字面量类型 `'https://auth.hxym18.com'`（仅精度，兼容既有消费方）；`core.test.mjs` 增断言：值正确、可从 core 取、规范 origin 形态、且为 `buildAuthRedirect` 缺省 origin（单源不分叉）。**无行为变更，无新出口，无需发版**。

## [0.11.0] - 2026-10-12

### Added

- **迁移期旧会话常量下沉 `@hxym18/auth/core`**（审计 A3）：`LEGACY_HMD_COOKIE` / `LEGACY_HMD_WECHAT_COOKIE` / `LEGACY_WORDINPUT_COOKIE` / `LEGACY_FANG_COOKIE` / `LEGACY_SESSION_COOKIES` 与 `LEGACY_HEX_RE`（服务端 64hex token 形态）从 `node.mjs` 移入同构层，**Edge middleware 可直接取常量做格式粗判**（旧实现引不到 node 出口、被迫硬编码）。`@hxym18/auth/node`（及聚合出口 `.`）再导出**同一绑定**——向后兼容，且与 core 同源、不产生 `export*` 歧义。
- **`createSessionReader(config)`（`@hxym18/auth/server`，Node-only）**：收敛各站 `lib/auth.ts` 的会话胶水（审计 A1/A2/A3）→ `{ read, renew }`。新会话读 `app_session`（验签 + `loadUser(uid, { kind:'session' })`）→ 过续期点静默重签写回；回落迁移期旧 64hex cookie（`loadUser(token, { kind:'legacy', source })`，命中即升级写新名）。站点只交 `loadUser`（本站查库，唯一业务回调）与 `legacyCookies`（本站旧 cookie 名）；cookie 名、TTL、64hex 判定、续期、升级全部单源，`Secure` 决策与签发侧共用 `core.resolveSessionSecure`。

## [0.10.0] - 2026-10-11

### Added

- **登出扩展点（迁移期旧会话统一收口）**：`session.legacyCookies: string[]`（声明式——`logout` 时一并清站点私有旧 cookie，同 `Path`/`HttpOnly`/`SameSite`，`Secure` 随环境；与统一会话同名者自动忽略）与 `onLogout(ctx)` 钩子（返回 `string[]` 的额外 `Set-Cookie` 头原样追加；`ctx.req` 为原始 `Request`，供销本站旧会话 DB 行）。**与 `onFirstLogin` 对称**：站点只声明，不再复制「在 `[action]` 里包一层、只对 logout 追加清 cookie」的路由代码（此前 wordinput 的迁移期 shim 即为该重复）。`onLogout` **异常降级，不阻塞登出**。
- `logout` 的公开签名改为 `logout(req?)`（`createAuthServer` 的 `dispatch` 与 Hono 适配均透传 `req`；不传时行为不变）。

## [0.9.0] - 2026-10-11

含**行为变更**（会话 cookie `Secure` 口径）：不再依赖 `NODE_ENV` 推断——本地 http 开发须显式 `session.secure: false`。

### Added

- **`session.secure` 显式开关**（`createAuthServer` 的 `session` 配置）：控制会话 cookie 是否带 `Secure`。
- **`renewSession(..., { secure, env })`**（`@hxym18/auth/node`）：续期侧新增 `secure` 显式开关与 `env` 注入，`env` 与签发侧 `createAuthServer` 的 `env` **同口径**（对象或 `(key) => value`，缺省 `process.env`）——注入 env 的站（测试 / Edge 代理 / 多租）续期时不再读 `process.env`，`Secure` 与签发一致。
- **`resolveSessionSecure(envGet, secure)`**（`@hxym18/auth/core`）：`Secure` 决策的单一入口（纯函数，签发侧与续期侧共用）。

### Changed（行为变更）

- **会话 cookie `Secure` 默认恒开，不再依赖 `NODE_ENV`**（spec §S6「生产强制 `Secure`（不依赖 `NODE_ENV` 默认）」）。新语义：
  - **默认恒 `Secure`**——不看 `NODE_ENV`，生产路径不可能漏掉 `Secure`；
  - 仅**显式** `session.secure === false`（签发侧）/ `renewSession(..., { secure: false })`（续期侧）**且当前非生产**（`env.NODE_ENV !== 'production'`）才关，供**本地 http 开发**；
  - **生产里显式关无效**（fail-closed 仍带 `Secure`）——选择「忽略」而非「抛错」：`renewSession` 契约是「不抛错、返 `null`」的分支型 helper，抛错会破坏该契约且给续期路径引入新的失败模式；忽略则在任何环境都保住安全属性，显式误配可见（http 下 cookie 被浏览器拒）。
- **`renewSession` 不再直接读 `process.env`**：`Secure` 决策改由 `env` 选项（缺省 `process.env`）供给，与签发侧同口径（修复「注入 env 的站续期拿不到 `Secure`」）。
- **迁移（本地 http 开发）**：旧行为靠「`NODE_ENV != 'production'` 自动去 `Secure`」；现须**显式**声明 `session.secure: false`（签发）+ `renewSession(..., { secure: false, env })`（续期）。**不要再用 `NODE_ENV` 推断 `Secure`**；生产部署无需改动（默认即带 `Secure`）。

### Docs

- README 更新「会话 cookie 硬化」为实际行为（`Secure` 默认恒开 + 显式开关 + `renewSession` 的 `env` 同口径）。
- README 补 S6 文档义务（纯文档，无行为变更）：`session.deliver:'both'` 的 body token 暴露风险与适用/不适用场景；`__Host-` cookie 前缀**评估结论：暂不采用**（`app_session` 已 host-only、兼容，但改名破坏性 + 强制 Secure 打断本地 http 开发）；token 吊销**登记为后续独立事项**（无状态 HMAC 无吊销名单，绝对过期只相对最后签发，续期会重置 `iat` 且无总寿命上限）。

### Chore

- 包内**契约副本**声明（`package.json` 的 `hxym18.contracts`，由 `hxym18 gen contracts` 生成、禁手改）：`sensitive-prefixes@1`、`endpoints@1`、`capability-projection@1`、`facade@1`；包级校验 `hxym18 check <pkg> --contracts <L0>`。

## [0.8.0] - 2026-10-11

### Added

- **core 端点 `config` / `dev-login`（端点单源）**：`GET /api/auth/config`（下发给客户端的非密配置）+ `POST /api/auth/dev-login`（本地开发免微信登录）。`dev-login` 走**三重门**（非生产 `NODE_ENV` + 显式开关 + 密钥），任一不满足即 404。
- **首登钩子 `onFirstLogin(ctx)`**：`resolveIdentity` 返回 `isNew:true` 且登录成功时调用一次（`ctx = { uid, source, openid, unionid }`）；异常降级，不阻塞登录。配套锚定器 `anchor:'first-login'`（要求提供 `onFirstLogin`，缺则装配抛 `TypeError`）。
- **`renewSession(req, { secret, ttlSec, cookieName })`（`@hxym18/auth/node`，Node-only）**：读请求会话，未过期但已过续期点（`renewIfStale`）→ 返带 `Set-Cookie` 的 `Response`，否则 `null`。重签依赖 `node:crypto`，**Edge middleware 不可续期**。
- **门面契约（README）**：记录 auth 消费的门面端点形态（`introspect`/`profile`/`qr/issue`/`qr/poll`）与 `unionid` 现状（pending）；auth 已 **unionid-ready**（门面回则透传、不回则 `null`，登录链路不受影响）。

### Changed（破坏性）

- **非 `allowlist` 锚定必须提供 `resolveIdentity`**：缺则**装配抛 `TypeError`**（消息含 `resolveIdentity`）；`allowlist` 站可省略（uid 即白名单 openid）。`resolveIdentity` 返回的 `uid` 须匹配 `/^[A-Za-z0-9_-]{8,64}$/`（字母数字 + `-`/`_`，8..64）——**openid 不作公开 id（除 allowlist）**，站点须映射为本站 uid，不得直接回传微信 openid。
- **`getSession` 增 `ttlSec`**：读侧须与签发侧 `session.ttlSec` 传同一值（三者缺省均 `SESSION_TTL_SEC`＝48h）；仅当签发用自定义 TTL 时才需显式同传，否则短 TTL 形同虚设（`deliver:'token'` 的 Bearer 无 `Max-Age` 约束）。
- **`readSession` 强制绝对过期**：`now > iat + ttlSec` 判过期，`ttlSec` 缺省 48h。
- **`renewIfStale` 迁至 `@hxym18/auth/core`**：纯判定（零 `node:crypto`），Edge 可载。
- **`init auth` 不再自写 `config` 路由**：端点单源，改由共享核心提供——见 `@hxym18/cli` v0.5.2。

### Fixed

- `dev-login` **门① 缺失 `NODE_ENV` fail-closed**：未显式声明非生产环境即拒绝，不再默认放行。

## [0.7.0] - 2026-10-11

### Changed（破坏性：终端契约语义收敛）

- **`LoginCaps` 字段改名，消除与 `@hxym18/env` 的同名不同义**：`isWechat` → `isWechatInApp`、`isMobile` → `isMobileBrowser`。
  旧 `isWechat` 把「桌面微信 / 小程序 webview」也算微信内，与登录通道（移动微信内才走 OAuth 静默授权）同名不同义，
  曾导致桌面微信跳门面 OAuth 死路。控制器只认新字段；误传旧字段时按 PC 兜底并在开发期告警一次。
  **消费方须迁移**（nuantie 已迁）：用下一条的桥接函数，勿手写投影。
- **`taroAdapter` / `createTaroLogin` 不再以 `isH5` 判端**：改为「有无 `window`」判定（H5 有、weapp 无）。
  `isH5` 保留但被忽略（旧调用不报错）。删除一个消费方可手传错的终端位。

### Added

- **`loginCapsFromCapabilities(caps)`（`@hxym18/auth/core`）**：把 `@hxym18/env` 的 `capabilities()` 投影成
  `{ isWechatInApp, isMobileBrowser }` 的**唯一桥接**（按结构类型取参，不依赖 env）。此前该投影由各站手写，
  已发生漂移（auth 契约与 nuantie 实现相反）。

### Fixed

- 控制器对 `caps` 的终端判定对齐「移动微信」语义：桌面微信 / 小程序 webview 归 PC 通道（出二维码），不再进 OAuth。

## [0.6.1] - 2026-10-10

### Fixed

- `next.d.ts` 补 `getSession` 导出（`next.mjs` 已再导出，类型此前缺失）。

## [0.6.0] - 2026-10-10

### Added

- `getSession(req, { secret, cookieName })`（`@hxym18/auth/server`）：读 cookie 或 `Authorization: Bearer` → `{ uid, iat } | null`——站点中间件「认人」一步到位。
- `createWeappProfile({ upload })`（`@hxym18/auth/taro`）：小程序资料采集（临时头像上传 + 归一资料）。
- `profileFallback(profile)` + `DEFAULT_DISPLAY_NAME`（`@hxym18/auth/core`）：统一资料回退（昵称空 → 「微信用户」）。
- `createAuthServer` 配置 `loadProfile(uid)`：登录后读回本站资料，weapp 端继承 H5 昵称/头像（resolveIdentity 未给时补）。

## [0.5.0] - 2026-10-10

### Added

- `session.deliver`（`cookie` | `token` | `both`，缺省 `cookie`）：会话可投递为响应 `{ token }`（不设 cookie），供「Bearer 到处用」的站（Taro/Hono token 模型）——解决与 cookie-session 模型的不匹配。验证侧用 `@hxym18/auth/node` 的 `readSession`（cookie 值 / Bearer token 通用）。

## [0.4.0] - 2026-10-10

### Added

- **`@hxym18/auth/server`**：`createAuthServer(config)` —— 登录服务端**框架无关核心**（Web `Request`→`Response`）。`env` 可注入（默认 `process.env`）；**框架无关但运行时限 Node**（签名依赖 `node:crypto`，Edge/CF 需自备签名）。
- **`@hxym18/auth/hono`**：`createHonoAuthRoutes(config)` —— 核心的 Hono 薄适配（Context→Request，几行）。
- **小程序登录已并入核心**：`POST /api/auth/weapp`（`weappVerify`）—— `Taro.login` code → `jscode2session` → **复用同一个 `resolveIdentity`** → 签 token；站点不再自写锚定/换码/签会话。
- `resolveIdentity` 的 `ctx` 增 `unionid`（微信 unionid，绑定开放平台时有值）+ `source` 增 `'weapp'`：用 `ctx.unionid ?? openid` 归一 H5 与小程序身份。
- `@hxym18/auth/node`：`exchangeWeappCode({ code, appId, appSecret })` —— 微信小程序换码原语（errcode 分支/超时/**unionid 读取**），失败归一 `{ok:false,error}`。
- `@hxym18/auth/taro`：`createWeappLogin({ Taro, request, store })` —— 小程序登录接线（`Taro.login` 取 code → 站点端点 → 存 token；通道故障不清已有 token）。
- `createTaroApi({ request })`：Taro 版 api 工厂（注入 `Taro.request` 形状的 request），与 `createFetchApi` 对齐。

### Changed

- `@hxym18/auth/next` 变**薄层**：登录逻辑迁至 `server.mjs`，`createAuthRoutes` 即核心的 Next 出口名（**出口签名不变**，现有测试全绿）。
- 门面/小程序配置与 `NODE_ENV`（Secure cookie）改为**按请求**解析（旧 `next.mjs` 中门面配置为装配期冻结、Secure 按请求；抽取后统一为按请求，避免运行期注入的 env 读不到）。

### Fixed

- `exchangeWeappCode`：响应体为 `null`/非对象时归一 `bad_json`（原会抛 `TypeError`，违反「不抛错」契约）。

### Docs

- README 补「框架无关核心 + 薄适配」出口表（换框架只换适配，不重写登录逻辑）；明确**运行时限 Node**；Taro 段补小程序 `createWeappLogin` 与核心 `weappVerify`。

## [0.3.3] - 2026-10-08

### Changed

- `taroAdapter` 去掉未使用的 `Taro` 参数；`createTaroLogin` 不再需要 `Taro`（H5 走 window；小程序端登录不经本层）。

## [0.3.2] - 2026-10-08

### Fixed（独立复核发现）

- `controller`：`dispose()` 后异步完成不再触发 `onSuccess`（防幽灵副作用/重复登录流程）。
- `controller`：配置拉取失败与「微信登录暂未开通」分开报错（不再把网络故障说成未开通）。
- `controller`：`refresh()` 重走 `start()` 的 `wxEnabled` 开关门，重试不再绕过。
- `ui`：`SsoLoginPanel` 传 `login` 时**只渲染纯视图**（不再挂 hook、不轮询）。
- `react`：`onSuccess` 经 ref 取最新，避免内联箭头导致的闭包过期。

## [0.3.1] - 2026-10-08

### Changed

- 回退 v0.3.0 的 `@hxym18/env` 依赖与自动判定：消费仓启用了 pnpm `blockExoticSubdeps`，**禁止 git 依赖作为子依赖**，auth 不能依赖 env。`caps` 仍由调用方用 `@hxym18/env` 计算后传入；漏传时按 PC 处理并在开发期 `console.warn` 一次（提示漏终端）。

## [0.3.0] - 2026-10-08

### Added

- `caps` 兜底：`useSsoLogin` 未传 `caps` 时，浏览器端自动用 `@hxym18/env` 判定端（微信内/手机/PC），避免站点漏传导致默认成 PC。新增 `capsFromBrowser`（含 PWA standalone 判定）。
- 依赖 `@hxym18/env`（终端判定单一来源）。

## [0.2.1] - 2026-10-08

### Added

- `ui`：新增纯视图 `SsoLoginView`（吃 `state` + 动作、不建连接），供测试与「已自持登录态」的站复用；`SsoLoginPanel` 支持 `login` 注入。
- 默认皮肤测试覆盖**每个终端分支**（微信内按钮 / 手机配对码 / PC 二维码 / pending / error / devLogin），SSR 渲染，共 11 项。

## [0.2.0] - 2026-10-08

### Added

- `ui` 出口：默认登录皮肤 `SsoLoginPanel`（内层面板）与 `SsoLoginModal`（弹层）——按端显示二维码 / 配对码文字 / 一键登录按钮；零 antd/tailwind 依赖，样式内联 + CSS 变量可覆盖。仅 React DOM（小程序端不适用）。

## [0.1.3] - 2026-10-08

### Added

- `typesVersions`：为经典 `moduleResolution: node` 的消费方（如 Taro 项目）补子路径类型映射；否则 `@hxym18/auth/core` 等子路径类型在 `exports` map 下解析不到。

## [0.1.2] - 2026-10-08

### Fixed

- `next`：`resolveIdentity` 返回非法 uid（不满足会话值形态 `v1.<uid>.<iat>.<sig>`）时，不再把 `issueSession` 的 TypeError 变成未捕获的裸 500；改为受控 `500 { ok:false, error:'身份锚定异常' }`。
- `react`：`useSsoLogin` 改为在 effect 内创建控制器（每次 effect 运行一个实例），修复 React 18 StrictMode「挂载→清理→再挂载」复用已 dispose 控制器、导致回跳消费与轮询静默失效的问题；`opts` 经 ref 取最新，effect 依赖收敛到原始值（api/adapter 宜传引用稳定对象）。

## [0.1.1] - 2026-10-08

### Added

- `next` 工厂：`resolveIdentity` 可返回 `avatar`，默认 `userPayload` 增带 `avatar`（`{ id, displayName, avatar }`），前端登录后免再调 `/api/auth/me` 取头像。向后兼容（avatar 可缺，回填 null）。

## [0.1.0] - 2026-10-08

由 `@app/auth`（wordinput/fang 各持副本）升级为单一来源，新增框架无关控制器与平台适配。

### Added

- `controller` 出口：`createLoginController`——按端分流、SSO 跳转（`startSso`）、`?sso=return` 回跳消费（`consumeReturn`）、PC/手机取码轮询（`waiting|pending|ok|expired`，过期自动换码、故障续轮）、`devLogin`、`dispose`。
- `browserAdapter` / `taroAdapter`：平台能力注入；小程序端惰性。
- `createFetchApi`：浏览器同源 fetch 版 api。
- `react` 出口：`useSsoLogin` 钩子。
- `taro` 出口：`createTaroLogin`。
- 类型声明（`controller.d.ts` / `react.d.ts` / `taro.d.ts`）。

### Fixed

- poll 状态口径统一到服务端实际值（`pending`），修正原前端误用 `scanned`（服务端从不返回）导致的「已扫码」提示死分支。
- `next` 取码响应透传 `pairCode`（移动浏览器登录桥，来自 fang 副本）。

### Changed

- 包名 `@app/auth` → `@hxym18/auth`（与 `@hxym18/pwa-kit`、`@hxym18/share-kit` 命名一致）。
- 迁移自 wordinput 副本（含单测）；`core`/`node`/`next` 出口签名保持兼容。
