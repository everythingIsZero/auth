/**
 * react.mjs — React（Next.js 客户端组件）适配：`useSsoLogin`
 *
 * 只做「挂载即回跳消费 → 非微信内自动出码」的生命周期接线与状态订阅；
 * 全部流程在 controller（已单测）。各站自行渲染 state。
 *
 * 生命周期：控制器在 effect 内创建（每次 effect 运行一个实例）。这样 React 18 StrictMode
 * 的「挂载→清理→再挂载」会得到新实例，不会像 memo 常数那样复用已 dispose 的控制器导致
 * 回跳/轮询静默失效。`opts` 每渲染更新到 ref，effect 依赖只用原始值（避免内联 api/adapter
 * 触发重建）；api / adapter 请尽量传引用稳定的对象。
 */
import { useEffect, useRef, useState } from 'react'
import { browserAdapter, createFetchApi, createLoginController } from './controller.mjs'

const IDLE = {
  channel: 'pc',
  status: 'idle',
  qrUrl: '',
  pairCode: '',
  error: '',
  wxEnabled: null,
  devLogin: false,
  user: null,
}

/**
 * @param {{
 *   caps?: { isWechat?: boolean, isMobile?: boolean },
 *   authOrigin?: string, cookieName?: string,
 *   adapter?: any, api?: any, fetchImpl?: typeof fetch,
 *   qrcodeUrl?: string, pollUrl?: string, verifyUrl?: string, configUrl?: string, devLoginUrl?: string,
 *   pollIntervalMs?: number, retryIntervalMs?: number,
 *   onSuccess?: (data: any) => void
 * }} [opts]
 */
export function useSsoLogin(opts) {
  const o = opts || {}
  const isWx = !!(o.caps && o.caps.isWechat)
  const isMobile = !!(o.caps && o.caps.isMobile)
  const [state, setState] = useState(() => ({
    ...IDLE,
    channel: isWx ? 'wechat' : isMobile ? 'mobile' : 'pc',
  }))

  // 最新 opts 放 ref：effect 不因内联对象重建；effect 内按需读取最新值。
  const optsRef = useRef(o)
  optsRef.current = o
  const controllerRef = useRef(null)

  useEffect(() => {
    const cur = optsRef.current
    const adapter = cur.adapter || (typeof window !== 'undefined' ? browserAdapter(window) : null)
    if (!adapter) return undefined

    let cancelled = false
    const controller = createLoginController({
      authOrigin: cur.authOrigin,
      cookieName: cur.cookieName,
      caps: cur.caps,
      adapter,
      api:
        cur.api ||
        createFetchApi({
          fetchImpl: cur.fetchImpl,
          qrcodeUrl: cur.qrcodeUrl,
          pollUrl: cur.pollUrl,
          verifyUrl: cur.verifyUrl,
          configUrl: cur.configUrl,
          devLoginUrl: cur.devLoginUrl,
        }),
      pollIntervalMs: cur.pollIntervalMs,
      retryIntervalMs: cur.retryIntervalMs,
      onSuccess: cur.onSuccess,
      onState: (s) => {
        if (!cancelled) setState(s)
      },
    })
    controllerRef.current = controller

    ;(async () => {
      const loggedIn = await controller.consumeReturn()
      if (cancelled) return
      // 微信内：消费回跳后不出码（等用户点「微信登录」→ startSso）
      if (!loggedIn && controller.getState().channel !== 'wechat') await controller.start()
    })()

    return () => {
      cancelled = true
      controller.dispose()
      if (controllerRef.current === controller) controllerRef.current = null
    }
    // 依赖只用原始值；api/adapter 通过 optsRef 取最新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.authOrigin, o.cookieName, isWx, isMobile])

  return {
    state,
    startSso: () => controllerRef.current && controllerRef.current.startSso(),
    refresh: () => (controllerRef.current ? controllerRef.current.refresh() : undefined),
    devLogin: () => (controllerRef.current ? controllerRef.current.devLogin() : undefined),
  }
}
