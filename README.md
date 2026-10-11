# @hxym18/auth

统一登录客户端（由 `@app/auth` 升级而来）。把原先在 wordinput / fang / nuantie 各复制一份的
**登录动线**收敛成一层：框架无关的**服务端核心**（`server`）+ Next/Hono 薄适配 + 小程序（weapp）登录 + 框架无关控制器 + React/Taro 适配。

> 分工：**统一层认人，各站用人**。本包只跑「登录状态机」，界面由各站自绘；服务端身份锚定
> 仍留在各产品后端（`identities(provider, provider_uid) → 本地 user_id`）。

## 出口

> 出口面自 **v0.6.0** 起**稳定**；后续新增只 additive（新出口/可选配置），**不破坏已有站**。
> 例外：**v0.7.0** 修正终端契约语义（`LoginCaps` 字段改名、`taroAdapter` 不再看 `isH5`）——见 `CHANGELOG.md`，迁移见下。

| 出口 | 运行时 | 职责 |
|---|---|---|
| `@hxym18/auth/server` | 服务端（框架无关；**运行时限 Node**） | `createAuthServer`（核心）+ `getSession`（读 cookie/Bearer → uid）。Next/Hono 薄适配；Edge/CF 需自备签名 |
| `@hxym18/auth/next` | Next.js 服务端 | `createAuthRoutes`（= 核心的 Next 出口名，薄层） |
| `@hxym18/auth/hono` | Hono 服务端 | `createHonoAuthRoutes`：核心的 Hono 薄适配（Context→Request，几行） |
| `@hxym18/auth/node` | Node | 会话签名/验签、`renewSession`（续期回写，Node-only）、`callAuthServer`、`exchangeWeappCode`（小程序换码，含 unionid） |
| `@hxym18/auth/controller` | 全环境（零框架依赖） | 登录控制器：按端分流、SSO 跳转/回跳、PC 取码轮询、手机配对码、dev-login |
| `@hxym18/auth/react` | 浏览器 + React | `useSsoLogin` 钩子（接线 + 状态订阅） |
| `@hxym18/auth/taro` | Taro（H5/小程序） | `createTaroLogin` + `createTaroApi`（H5）；`createWeappLogin`（取 code）；`createWeappProfile`（资料采集）；小程序端 controller 惰性 |
| `@hxym18/auth/core` | 浏览器/Edge | 同构常量与纯函数（票根名/格式、redirect 白名单、`buildAuthRedirect`、`renewIfStale`、`profileFallback`、`loginCapsFromCapabilities`） |
| `@hxym18/auth`（`.`） | Node | `core` + `node` 聚合（含 `node:crypto`，勿在 Edge 引） |

> **换框架不用重写**：登录逻辑只在 `server.mjs` 写一次（Web `Request`/`Response`）。换掉 Next/Hono 时，新框架只需几行适配（`c.req.raw` ↔ `Request`）；不属 Web 标准的框架（Express）用 `@hxym18/auth/server` + 一行 `dispatch`，登录逻辑零改动。
> **注意**：核心**框架无关，但运行时限 Node**（内部经 `node:crypto` 签会话）。Edge / Cloudflare Workers 等无 `node:crypto` 的运行时**不能直接引**，需自备签名。

## 安装

```bash
pnpm add github:everythingIsZero/auth#v0.8.0
```

**能力位依赖**：控制器的 `caps` 由 [`@hxym18/env`](../env) 计算、经 `@hxym18/auth/core` 的
`loginCapsFromCapabilities()` 投影后注入（本包不自判 UA，也不读 env 的运行期依赖）：

```bash
pnpm add github:everythingIsZero/env#v0.1.1
```

> **为什么必须走 `loginCapsFromCapabilities`**：env 的 `isWechat` 涵盖桌面微信 / 小程序 webview，
> 而登录「微信内」通道只指能走 OAuth 静默授权的**移动微信**——同名不同义，整体透传会把桌面微信
> 送进 OAuth 死路。投影只此一处，各站勿手写。

## 客户端接入（React / Next 客户端组件）

```jsx
'use client'
import { capabilities } from '@hxym18/env'
import { loginCapsFromCapabilities } from '@hxym18/auth/core'
import { useSsoLogin } from '@hxym18/auth/react'

export function LoginPanel() {
  const { state, startSso, refresh, devLogin } = useSsoLogin({
    caps: loginCapsFromCapabilities(capabilities({
      ua: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
    })),
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
- **`caps` 用 `@hxym18/env` 的 `capabilities()` 经 `@hxym18/auth/core` 的 `loginCapsFromCapabilities()` 投影后传入**（微信内/手机/PC 分流依据）；漏传会按 PC 处理并在开发期 `console.warn` 一次。
- 状态枚举与服务端契约一致：`waiting | pending（已扫码待确认）| ok | expired（自动换码）`。

## 服务端接入（框架无关核心 + 薄适配）

登录服务端逻辑**只写一次**（`@hxym18/auth/server`，Web `Request`→`Response`）；各框架薄适配：

- **Next**：`createAuthRoutes(config)`（`@hxym18/auth/next`，出口签名与旧版兼容）。
- **Hono**：`createHonoAuthRoutes(config)`（`@hxym18/auth/hono`）→ `app.all('/api/auth/:action', (c) => auth.dispatch(c))`。
- **任意 Web 标准框架**：`createAuthServer(config)` + 一行 `dispatch`。

**核心端点（单源，站点不得自写）**：`createAuthServer` 经 `dispatch` 单源提供 `/api/auth/<action>`；`hxym18 check` 命中站点自写这些 core 端点即红（§S5）。

| action | method | 说明 |
|---|---|---|
| `config` | GET | 能力探测（`wxEnabled` / `devLogin`） |
| `dev-login` | POST | 开发旁路（三重 fail-closed 门，未开 404） |
| `sso-verify` | POST | 微信内静默登录（票根 → openid → 会话） |
| `wx-qrcode` | GET | PC 扫码取码 |
| `wx-poll` | GET | PC 扫码轮询 |
| `weapp` | POST | 小程序换码登录（token） |
| `logout` | POST | 登出 |

站点唯一业务回调 = `resolveIdentity(openid, ctx)`（openid → 本站 user）。**非 `allowlist` 锚定必填**（缺则装配抛 `TypeError`，消息含 `resolveIdentity`）；`allowlist` 站可省略——uid 即白名单 openid。`resolveIdentity` 返回的 `uid` 须匹配 `/^[A-Za-z0-9_-]{8,64}$/`（字母数字 + `-`/`_`，8..64）：**openid 不作公开 id（除 allowlist）**，站点须映射为本站 uid，不得直接回传微信 openid。`session.secret` **不传** = 装配错误（抛 `TypeError`）；**取值为空** = 运行期缺配，fail-closed 返 503。

**会话投递 `session.deliver`**（缺省 `cookie`）：
- `cookie`：`Set-Cookie`（Next 站现状）。
- `token`：响应带 `{ token }`、不设 cookie——供 **Bearer 到处用**的站（Taro/Hono token 模型）。
- `both`：两者都给。

> **私有前缀响应必须 `no-store`（S2 反向义务）**：`/s/`、`/r/`、`/api/` 等私有/敏感前缀的响应一律不得被缓存。本包所有响应（票根、会话、门面回包）固定 `Cache-Control: no-store`（`src/server.mjs:29`，含 `config`/`dev-login`/`sso-verify`/`wx-*`/`weapp`/`logout` 全部端点）；站点自有的私有前缀响应也须自标 `no-store`——SW 读不到 `Cookie`/`Set-Cookie`（forbidden header），防线只能靠响应头。

> **能力位投影（与 `capability-projection` 契约一致）**：`caps` 只经 `loginCapsFromCapabilities()` 投影，返回 `isWechatInApp`（← env `isWechatMobile`）与 `isMobileBrowser`（← env `isMobile`）两键；本包不读 UA、不依赖 env 运行期。

> **`deliver:'both'` 的 body token 风险**：`both` 把**同一份**签名会话值同时写进 httpOnly cookie 与响应 JSON（`src/server.mjs:272-279`，两处同值，均来自 `issueSession`，`src/server.mjs:236`）。body 里的 token **不受 `HttpOnly` 保护**：页面任意 JS（含第三方脚本 / 埋点 SDK）、服务端与反代的访问日志、APM 都能读到它——暴露面大于 httpOnly cookie，`HttpOnly` 的防护意义被抵消。响应已带 `Cache-Control: no-store`（`src/server.mjs:29`），缓存/中介存储风险受控；只有在站点把 token 再写进 URL 或 localStorage 时，才进一步进入浏览器历史/持久存储（属站点行为，非本包）。
> - **适用**：同一站既有浏览器 cookie 会话、又需把 token 交给非 cookie 客户端（如 Taro/小程序复用同一登录响应）。
> - **不适用**：纯浏览器站（用 `deliver:'cookie'`，回 token 无收益只增暴露）；纯 Bearer 站（用 `deliver:'token'`，不设 cookie）。

验证侧用 `@hxym18/auth/node` 的 `readSession(value, { secret, ttlSec })`（cookie 值 / Bearer token 通用；`now > iat + ttlSec` 判**绝对过期**，`ttlSec` 缺省 48h），或直接用 `getSession(req, { secret, cookieName, ttlSec })`（读 cookie 或 `Bearer` → `{ uid, iat } | null`）。

**会话续期 `renewSession(req, { secret, ttlSec, cookieName, secure, env })`**（`@hxym18/auth/node`）：读请求会话（cookie 或 `Bearer`），**未过期但已过续期点**（`renewIfStale`）→ 返带 `Set-Cookie` 的 `Response`，否则 `null`。`secure` 与 `env` 见下「会话 cookie 硬化」；`env` 缺省 `process.env`，与签发侧注入 env 同口径。**续期回写仅 Node 运行时可用；Edge middleware 不可续期**（重签依赖 `node:crypto`）——Edge 站把续期落到 Node 端点（Route Handler / Server Action / Node middleware）。纯判定 `renewIfStale(iat, { ttlSec, halfLife })` 在同构层 `@hxym18/auth/core`（零 `node:crypto`，Edge 可载）。

> ⚠️ **`ttlSec` 必须与签发侧一致（读侧联动）**：读侧（`getSession` / `renewSession` / `readSession`）**必须与签发侧 `session.ttlSec` 传同一值**。三者缺省均为 `SESSION_TTL_SEC`（48h）——**仅当签发用自定义 TTL 时才需显式同传**；否则读侧按缺省 48h 判绝对过期，**短 TTL 形同虚设**：`deliver:'token'` 的 Bearer 无浏览器 `Max-Age` 约束，捕获后可被用满 48h。
>
> 正确做法：用**同一份配置对象**同时喂 `createAuthServer` 与读侧。
>
> ```js
> import { createAuthServer, getSession } from '@hxym18/auth/server'
>
> // 单源：签发与读侧共用同一 ttlSec
> const session = { secret: process.env.SESSION_SECRET, ttlSec: 3600 } // 1h
> const routes = createAuthServer({ session, resolveIdentity })
>
> // 中间件读侧：同传 session.ttlSec
> const who = getSession(req, { secret: session.secret, cookieName: session.cookieName, ttlSec: session.ttlSec })
> ```

**会话 cookie 硬化**：`Set-Cookie` 固定 `Path=/; HttpOnly; SameSite=Lax` 且**不设 `Domain`**（host-only；`src/server.mjs:34-36`，读侧自持同款 `src/node.mjs:219-221`）；**`Secure` 缺省恒开、不看 `NODE_ENV`**（单一决策口径 `core.resolveSessionSecure`，`src/core.mjs:77`）。仅当**显式** `session.secure === false`（签发侧 `src/server.mjs:277`）或 `renewSession(..., { secure: false })`（续期侧 `src/node.mjs:261`）**且当前非生产**（`env.NODE_ENV !== 'production'`）才关，供**本地 http 开发**；**生产里显式关无效**（fail-closed 仍带 `Secure`）。**本地 http 开发请用该显式开关，不要靠 `NODE_ENV` 推断。** 续期侧 `renewSession` 的 `env` 选项与签发侧 `createAuthServer` 的 `env` **同口径**——注入 env 时 `Secure` 决策只读注入源，不读 `process.env`（注入 env 的站：测试、Edge 代理、多租，续期不再漏 `Secure`）。

> **`__Host-` 前缀评估结论：暂不采用。** `__Host-` 要求 `Secure` + `Path=/` + **无 `Domain`**（限单一 host、不可跨子域共享）。本包会话 cookie 现已满足 `Path=/` + 无 `Domain`，就属性而言**兼容** `__Host-`；**跨子域共享不落在本 cookie 上**——承担跨子域的是 SSO 票根 `sl_web_session`（`domain=.hxym18.com`、非 HttpOnly，属 sso-bridge/auth 站，见 `../nuantie/docs/HANDOFF-2026-10-08-web-alignment-h5-auth.md:62`），故「多站共享登录」不构成否决 `__Host-` 的理由。不采用的真实原因是**改动成本**：① 改名 `app_session` → `__Host-app_session` 是**破坏性**——现存会话全部失效，且所有读侧（`getSession` / `renewSession` / 站点中间件）与配置须同步换名；② `__Host-` 强制 `Secure`，而本包现已**默认恒带 `Secure`**（`src/server.mjs:277`，仅非生产可显式关），本地 http 开发须**显式** `session.secure:false` 例外。其收益是防「兄弟子域写入域 cookie 冒充本 host 会话」（与残余风险 R44 同源，`../../knowledge/integration/pitfalls.md:114`）。**登记为后续独立硬化事项**：待会话改名走 major 版本后，再一并评估。

> **会话吊销评估结论：登记为后续独立事项。** 会话是无状态 HMAC 自包含值（`v1.<uid>.<iat>.<sig>`，`src/node.mjs:185-194`），服务端**无会话表、无吊销名单**；签发/验签只做 HMAC 与形态校验，登出仅清 cookie（`src/server.mjs:377-381`），旧签名值仍验签通过。**窗口限制**：`readSession` 强制绝对过期，`now > iat + ttlSec` 即失效（`src/node.mjs:214`；`ttlSec` 缺省 48h，`src/core.mjs:34`）——被窃的**未续期** token 最多再用 `ttlSec`。但 `renewSession` 重签会**重置 `iat`**（`src/node.mjs:254`），续期只要求「未过绝对过期 + 已达续期点」（`renewIfStale`，`src/core.mjs:96-106`），**当前无总寿命 / 续期次数上限**：活跃持有者（含窃取者，只要能打到 Node 续期端点）可**无限滑动**——绝对过期是相对最后一次签发，不是「首次登录起算」的硬上限。**结论**：本批不引入吊销（现状无每请求存储，且无吊销需求）。后续若要，两条独立路径：**版本化密钥**（更换 `SESSION_SECRET`/版本前缀使旧签名整体失效，代价=全员重登）或**吊销名单**（记 uid/iat 阻止特定会话，代价=每请求查询或引入存储）——均属独立设计，不在现有契约内。


**资料读回 `loadProfile(uid)`**（可选）：登录后按 uid 读本站已存资料（昵称/头像）——`resolveIdentity` 未给的字段用它补齐，weapp 端借此**继承 H5 昵称/头像**。故障降级，不阻塞登录。

**首登钩子 `onFirstLogin(ctx)`**（可选）：`resolveIdentity` 返回 `isNew:true` 且登录成功时**调用一次**（`ctx = { uid, source, openid, unionid }`）——站点据此做建号后处理 / 发欢迎 / 授默认权限。

```js
createAuthServer({
  session, // 同上
  anchor: 'first-login', // 用 first-login 锚定器时 onFirstLogin 必填
  resolveIdentity: async (openid) => {
    const { user, created } = await upsertByOpenid(openid)
    return { uid: user.id, isNew: created } // created=本次新建 → 触发首登钩子
  },
  onFirstLogin: async ({ uid }) => {
    await sendWelcome(uid) // 抛错会被降级，不阻塞登录
  },
})
```

- **核心无状态**：「是否首次」全由站点 `resolveIdentity` 的 `isNew` 判定；核心**不存首登记录、不比对本地库**。
- **异常降级**：`onFirstLogin` 抛错**不阻塞登录**（登录照常签发会话）。
- `anchor:'first-login'` 要求提供 `onFirstLogin`，**缺则装配抛 `TypeError`**；其锚定语义同 `identity`（先到先得）。

### 微信小程序（weapp）

核心**已内置** `POST /api/auth/weapp`（`weappVerify`）：`Taro.login` code → `jscode2session` → **同一个 `resolveIdentity`** → 签 token（weapp 无 cookie）。站点**无需自写锚定/换码**。

- 底层原语（如需自定义）：`exchangeWeappCode({ code, appId, appSecret })`（`@hxym18/auth/node`）→ `{ ok:true, openid, unionid|null, sessionKey }`。
- `resolveIdentity` 的 `ctx.unionid` 带上微信 unionid（小程序绑定同一微信开放平台时有值）——用 `ctx.unionid ?? openid` 归一 H5 与小程序身份。（**核心已就绪**；端到端需门面 sso-bridge 回传 unionid，见 [`account-unification.md`](../../knowledge/integration/account-unification.md)）
- env：`WEAPP_APPID` / `WEAPP_SECRET`（未配 → 404）。
- **昵称/头像**：微信**不允许自动获取**（2022 起）。统一做法：客户端 `createWeappProfile({ upload })`（`button open-type="chooseAvatar"` + `<input type="nickname">`，站点自绘 UI）+ 服务端 `loadProfile(uid)` 读回；回退 `profileFallback()`（昵称空→「微信用户」）。已有 H5 资料的用户，weapp 端 `loadProfile` 直接继承。

### 门面契约（auth ↔ sso-bridge，S10）

auth 消费的门面端点形态（`callAuthServer` POST JSON + `x-auth-secret`；`sso-bridge` 实现侧须对齐）：

| 端点 | 门面形态 | auth 取用 |
|---|---|---|
| `introspect` | `{ openid, unionid? }` | `openid` 认人；`unionid` 有则透传 `resolveIdentity.ctx`，无则 `null`（不阻塞登录） |
| `profile` | `{ profile: { nickname, avatar } }` | 补昵称/头像（需配 `authServer.org`），取用失败降级 |
| `qr/issue` | `{ scene, qrUrl, pairCode?, confirm? }` | `scene`/`qrUrl` 必给；`pairCode`/`confirm` 门面有才透传 |
| `qr/poll` | `{ status, openid?, nickname?, avatar?, unionid? }` | `status≠ok` 原样透传；`status=ok` 时取 `openid` 签会话，昵称/头像/unionid 有则透传 |

**`unionid` 现状（pending）**：真门面 `introspect` 当前**只回 `openid`**（`sso-bridge/auth-service.mjs`）；`unionid` 为**待门面变更的依赖项**（见 [`account-unification.md`](../../knowledge/integration/account-unification.md) §12）。auth 已 **unionid-ready**：门面回则透传、不回则 `null`，登录链路不受影响；`test/facade.test.mjs` 用 fake 门面覆盖**有/无 `unionid` 两态**。

## Taro（H5 与 Next 对等；小程序登录走共享核心，UI/动线自备）

```js
import Taro from '@tarojs/taro'
import { capabilities } from '@hxym18/env'
import { loginCapsFromCapabilities } from '@hxym18/auth/core'
import { createTaroLogin, createTaroApi } from '@hxym18/auth/taro'

const login = createTaroLogin({
  // 终端由「有无 window」判定，无需手传 isH5
  caps: loginCapsFromCapabilities(capabilities({
    ua: (typeof navigator !== 'undefined' && navigator.userAgent) || '',
    maxTouchPoints: (typeof navigator !== 'undefined' && navigator.maxTouchPoints) || 0,
  })),
  // 小程序无标准 fetch：createTaroApi 注入 Taro.request，不必手写 5 个端点
  api: createTaroApi({ request: (opts) => Taro.request(opts) }),
})
```

- `createTaroApi({ request })`：`request` 收 `{ url, method, header, data }`、返 `{ statusCode, data }`（即 `Taro.request` 形状），与 `createFetchApi` 对齐。
- **H5 端**：动线同 React 站（出码轮询 / 跳门面回跳）。终端由「有无 `window`」判定，不必手传 `isH5`。
- **小程序端（无 `window`）**：controller 惰性——读不到全域 cookie、不跳转、不抛错；登录走小程序身份源：
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
import { capabilities } from '@hxym18/env'
import { loginCapsFromCapabilities } from '@hxym18/auth/core'
import { SsoLoginModal } from '@hxym18/auth/ui'

const caps = loginCapsFromCapabilities(capabilities({ ua: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints }))

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
