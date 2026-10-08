# Changelog

本仓遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，版本语义按 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
