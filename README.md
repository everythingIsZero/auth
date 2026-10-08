# @hxym18/auth

统一登录客户端（由 `@app/auth` 升级而来）。把原先在 wordinput / fang / nuantie 各复制一份的
**登录动线**收敛成一层：框架无关的控制器 + React/Taro 适配 + 既有 Next 服务端路由工厂。

> 分工：**统一层认人，各站用人**。本包只跑「登录状态机」，界面由各站自绘；服务端身份锚定
> 仍留在各产品后端（`identities(provider, provider_uid) → 本地 user_id`）。

## 出口

| 出口 | 运行时 | 职责 |
|---|---|---|
| `@hxym18/auth/controller` | 全环境（零框架依赖） | 登录控制器：按端分流、SSO 跳转/回跳、PC 取码轮询、手机配对码、dev-login |
| `@hxym18/auth/react` | 浏览器 + React | `useSsoLogin` 钩子（接线 + 状态订阅） |
| `@hxym18/auth/taro` | Taro（H5/小程序） | `createTaroLogin`；小程序端惰性，登录走各自身份源 |
| `@hxym18/auth/next` | Next.js 服务端 | `createAuthRoutes` 路由工厂（sso-verify / wx-qrcode / wx-poll / logout） |
| `@hxym18/auth/node` | Node | 会话签名/验签、`callAuthServer` 等原语 |
| `@hxym18/auth/core` | 浏览器/Edge | 同构常量与纯函数（票根名/格式、redirect 白名单、`buildAuthRedirect`） |
| `@hxym18/auth`（`.`） | Node | `core` + `node` 聚合（含 `node:crypto`，勿在 Edge 引） |

## 安装

```bash
pnpm add github:everythingIsZero/auth#v0.1.0
```

**能力位依赖**：控制器的 `caps` 建议由 [`@hxym18/env`](../env) 计算后注入（本包不自判 UA）：

```bash
pnpm add github:everythingIsZero/env#v0.1.0
```

## 客户端接入（React / Next 客户端组件）

```jsx
'use client'
import { capabilities } from '@hxym18/env'
import { useSsoLogin } from '@hxym18/auth/react'

export function LoginPanel() {
  const { state, startSso, refresh, devLogin } = useSsoLogin({
    caps: capabilities({
      ua: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
    }),
  })

  if (state.channel === 'wechat')
    return <button onClick={startSso}>微信登录</button>
  if (state.status === 'error')
    return <button onClick={refresh}>重试</button>
  if (state.channel === 'mobile' && state.pairCode)
    return <div>{state.pairCode}（发给服务号）</div>
  return <img src={state.qrUrl} alt="微信登录二维码" />
}
```

`state` 形态：`{ channel: 'wechat'|'mobile'|'pc', status: 'idle'|'waiting'|'pending'|'ok'|'error'|'verifying', qrUrl, pairCode, error, wxEnabled, devLogin, user }`（`user` 默认含 `id / displayName / avatar`）。

- 挂载即消费 `?sso=return` 回跳；非微信内自动出码轮询。
- 状态枚举与服务端契约一致：`waiting | pending（已扫码待确认）| ok | expired（自动换码）`。

## 服务端接入（Next）

沿用原 `@app/auth/next` 契约（`createAuthRoutes`），见各站 `lib/auth-routes.ts`。本升级保持其出口签名兼容。

## Taro

```js
import { createTaroLogin } from '@hxym18/auth/taro'
const login = createTaroLogin({ Taro, isH5, caps: capabilities({ ua: '...' }), api: makeTaroApi() })
```

小程序端（`isH5 !== true`）adapter 惰性：读不到全域 cookie、不跳转、不抛错，登录由小程序身份源自行处理。

## 边界

- 不碰各产品业务数据、鉴权语义与界面。
- 登录安全契约（票根名/格式/TTL、redirect 白名单、`introspect` 四分支）以 `sso-bridge` 为准，本包不另立。
- 平台差异（cookie / 导航 / 定时器 / 请求）全部经 `adapter` / `api` 注入。

## 测试

```bash
npm test        # node --test
```
