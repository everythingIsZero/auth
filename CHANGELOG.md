# Changelog

本仓遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，版本语义按 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
