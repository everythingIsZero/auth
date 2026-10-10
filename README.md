# @hxym18/auth

统一登录客户端（由 `@app/auth` 升级而来）。把原先在 wordinput / fang / nuantie 各复制一份的
**登录动线**收敛成一层：框架无关的**服务端核心**（`server`）+ Next/Hono 薄适配 + 小程序（weapp）登录 + 框架无关控制器 + React/Taro 适配。

> 分工：**统一层认人，各站用人**。本包只跑「登录状态机」，界面由各站自绘；服务端身份锚定
> 仍留在各产品后端（`identities(provider, provider_uid) → 本地 user_id`）。

## 出口

> 出口面自 **v0.6.0** 起**稳定**；后续新增只 additive（新出口/可选配置），**不破坏已有站**。

| 出口 | 运行时 | 职责 |
|---|---|---|
| `@hxym18/auth/server` | 服务端（框架无关；**运行时限 Node**） | `createAuthServer`（核心）+ `getSession`（读 cookie/Bearer → uid）。Next/Hono 薄适配；Edge/CF 需自备签名 |
| `@hxym18/auth/next` | Next.js 服务端 | `createAuthRoutes`（= 核心的 Next 出口名，薄层） |
| `@hxym18/auth/hono` | Hono 服务端 | `createHonoAuthRoutes`：核心的 Hono 薄适配（Context→Request，几行） |
| `@hxym18/auth/node` | Node | 会话签名/验签、`callAuthServer`、`exchangeWeappCode`（小程序换码，含 unionid） |
| `@hxym18/auth/controller` | 全环境（零框架依赖） | 登录控制器：按端分流、SSO 跳转/回跳、PC 取码轮询、手机配对码、dev-login |
| `@hxym18/auth/react` | 浏览器 + React | `useSsoLogin` 钩子（接线 + 状态订阅） |
| `@hxym18/auth/taro` | Taro（H5/小程序） | `createTaroLogin` + `createTaroApi`（H5）；`createWeappLogin`（取 code）；`createWeappProfile`（资料采集）；小程序端 controller 惰性 |
| `@hxym18/auth/core` | 浏览器/Edge | 同构常量与纯函数（票根名/格式、redirect 白名单、`buildAuthRedirect`、`profileFallback`） |
| `@hxym18/auth`（`.`） | Node | `core` + `node` 聚合（含 `node:crypto`，勿在 Edge 引） |

> **换框架不用重写**：登录逻辑只在 `server.mjs` 写一次（Web `Request`/`Response`）。换掉 Next/Hono 时，新框架只需几行适配（`c.req.raw` ↔ `Request`）；不属 Web 标准的框架（Express）用 `@hxym18/auth/server` + 一行 `dispatch`，登录逻辑零改动。
> **注意**：核心**框架无关，但运行时限 Node**（内部经 `node:crypto` 签会话）。Edge / Cloudflare Workers 等无 `node:crypto` 的运行时**不能直接引**，需自备签名。

## 安装

```bash
pnpm add github:everythingIsZero/auth#v0.4.0
```

**能力位依赖**：控制器的 `caps` 建议由 [`@hxym18/env`](../env) 计算后注入（本包不自判 UA）：

```bash
pnpm add github:everythingIsZero/env#v0.1.1
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
- **`caps` 用 `@hxym18/env` 的 `capabilities()` 计算后传入**（微信内/手机/PC 分流依据）；漏传会按 PC 处理并在开发期 `console.warn` 一次。
- 状态枚举与服务端契约一致：`waiting | pending（已扫码待确认）| ok | expired（自动换码）`。

## 服务端接入（框架无关核心 + 薄适配）

登录服务端逻辑**只写一次**（`@hxym18/auth/server`，Web `Request`→`Response`）；各框架薄适配：

- **Next**：`createAuthRoutes(config)`（`@hxym18/auth/next`，出口签名与旧版兼容）。
- **Hono**：`createHonoAuthRoutes(config)`（`@hxym18/auth/hono`）→ `app.all('/api/auth/:action', (c) => auth.dispatch(c))`。
- **任意 Web 标准框架**：`createAuthServer(config)` + 一行 `dispatch`。

站点唯一业务回调 = `resolveIdentity(openid, ctx)`（openid → 本站 user）。`session.secret` **不传** = 装配错误（抛 `TypeError`）；**取值为空** = 运行期缺配，fail-closed 返 503。

**会话投递 `session.deliver`**（缺省 `cookie`）：
- `cookie`：`Set-Cookie`（Next 站现状）。
- `token`：响应带 `{ token }`、不设 cookie——供 **Bearer 到处用**的站（Taro/Hono token 模型）。
- `both`：两者都给。

验证侧用 `@hxym18/auth/node` 的 `readSession(value, { secret })`（cookie 值 / Bearer token 通用），或直接用 `getSession(req, { secret, cookieName })`（读 cookie 或 `Bearer` → `{ uid, iat } | null`）。

**资料读回 `loadProfile(uid)`**（可选）：登录后按 uid 读本站已存资料（昵称/头像）——`resolveIdentity` 未给的字段用它补齐，weapp 端借此**继承 H5 昵称/头像**。故障降级，不阻塞登录。

### 微信小程序（weapp）

核心**已内置** `POST /api/auth/weapp`（`weappVerify`）：`Taro.login` code → `jscode2session` → **同一个 `resolveIdentity`** → 签 token（weapp 无 cookie）。站点**无需自写锚定/换码**。

- 底层原语（如需自定义）：`exchangeWeappCode({ code, appId, appSecret })`（`@hxym18/auth/node`）→ `{ ok:true, openid, unionid|null, sessionKey }`。
- `resolveIdentity` 的 `ctx.unionid` 带上微信 unionid（小程序绑定同一微信开放平台时有值）——用 `ctx.unionid ?? openid` 归一 H5 与小程序身份。（**核心已就绪**；端到端需门面 sso-bridge 回传 unionid，见 [`account-unification.md`](../../knowledge/integration/account-unification.md)）
- env：`WEAPP_APPID` / `WEAPP_SECRET`（未配 → 404）。
- **昵称/头像**：微信**不允许自动获取**（2022 起）。统一做法：客户端 `createWeappProfile({ upload })`（`button open-type="chooseAvatar"` + `<input type="nickname">`，站点自绘 UI）+ 服务端 `loadProfile(uid)` 读回；回退 `profileFallback()`（昵称空→「微信用户」）。已有 H5 资料的用户，weapp 端 `loadProfile` 直接继承。

## Taro（H5 与 Next 对等；小程序登录走共享核心，UI/动线自备）

```js
import Taro from '@tarojs/taro'
import { capabilities } from '@hxym18/env'
import { createTaroLogin, createTaroApi } from '@hxym18/auth/taro'

const isH5 = process.env.TARO_ENV === 'h5'
const login = createTaroLogin({
  isH5,
  caps: capabilities({ ua: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints }),
  // 小程序无标准 fetch：createTaroApi 注入 Taro.request，不必手写 5 个端点
  api: createTaroApi({ request: (opts) => Taro.request(opts) }),
})
```

- `createTaroApi({ request })`：`request` 收 `{ url, method, header, data }`、返 `{ statusCode, data }`（即 `Taro.request` 形状），与 `createFetchApi` 对齐。
- **H5 端**：动线同 React 站（出码轮询 / 跳门面回跳）。
- **小程序端（`isH5 !== true`）**：controller 惰性——读不到全域 cookie、不跳转、不抛错；登录走小程序身份源：
  ```js
  import Taro from '@tarojs/taro'
  import { createWeappLogin } from '@hxym18/auth/taro'
  const weappLogin = createWeappLogin({
    Taro,
    request: (code) => Taro.request({ url: '/api/auth/weapp', method: 'POST', data: { code } }).then((r) => r.data),
    store: { set: (t) => Taro.setStorageSync('token', t) },
  })
  ```
  服务端用核心 `POST /api/auth/weapp`（`weappVerify`，复用同一 `resolveIdentity`）。
- **接线文件用 CLI 生成**：`hxym18 init auth --target taro --write --dir apps/<app>` —— 生成客户端 `src/lib/sso-login.ts`（H5 `createTaroLogin` + 小程序 `createWeappLogin`）**+ Hono 服务端 `server/src/auth.ts`**；站点**只补 `resolveIdentity`**（唯一业务回调）。

## 默认皮肤（可选，开箱即用）

不想自己画登录 UI 的站，直接用弹层（内部已接 `useSsoLogin`）：

```jsx
'use client'
import { SsoLoginModal } from '@hxym18/auth/ui'
import { capabilities } from '@hxym18/env'

const caps = capabilities({ ua: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints })

<SsoLoginModal open={open} onClose={() => setOpen(false)} caps={caps} onSuccess={() => location.reload()} />
```

按端自动显示：**PC=二维码**、**手机浏览器=配对码文字**、**微信内=「一键登录」按钮**；可选 `title` / `hint` / `devLoginLabel`。样式走内联 + CSS 变量（`--sso-accent` / `--sso-bg` / `--sso-fg` 可覆盖），**零 antd/tailwind 依赖**。仅 React DOM，小程序端（Taro weapp）不适用。

## 边界

- 不碰各产品业务数据、鉴权语义与界面。
- 登录安全契约（票根名/格式/TTL、redirect 白名单、`introspect` 四分支）以 `sso-bridge` 为准，本包不另立。
- 平台差异（cookie / 导航 / 定时器 / 请求）全部经 `adapter` / `api` 注入。

## 测试

```bash
npm test        # node --test
```
