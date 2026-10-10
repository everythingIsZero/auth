# Changelog

本仓遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，版本语义按 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
