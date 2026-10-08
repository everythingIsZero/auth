/**
 * react.mjs — React（Next.js 客户端组件）适配：`useSsoLogin`
 *
 * 只做「挂载即回跳消费 → 非微信内自动出码」的生命周期接线与状态订阅；
 * 全部流程在 controller（已单测）。各站自行渲染 state。
 */
import { useEffect, useMemo, useState } from 'react'
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

  const controller = useMemo(() => {
    const adapter = o.adapter || (typeof window !== 'undefined' ? browserAdapter(window) : null)
    if (!adapter) return null
    return createLoginController({
      authOrigin: o.authOrigin,
      cookieName: o.cookieName,
      caps: o.caps,
      adapter,
      api:
        o.api ||
        createFetchApi({
          fetchImpl: o.fetchImpl,
          qrcodeUrl: o.qrcodeUrl,
          pollUrl: o.pollUrl,
          verifyUrl: o.verifyUrl,
          configUrl: o.configUrl,
          devLoginUrl: o.devLoginUrl,
        }),
      pollIntervalMs: o.pollIntervalMs,
      retryIntervalMs: o.retryIntervalMs,
      onSuccess: o.onSuccess,
      onState: setState,
    })
    // 依赖收敛到稳定的原始值，避免内联对象导致控制器重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.adapter, o.api, o.authOrigin, o.cookieName, isWx, isMobile])

  useEffect(() => {
    if (!controller) return
    let cancelled = false
    ;(async () => {
      const loggedIn = await controller.consumeReturn()
      if (cancelled) return
      // 微信内：消费回跳后不出码（等用户点「微信登录」→ startSso）
      if (!loggedIn && controller.getState().channel !== 'wechat') await controller.start()
    })()
    return () => {
      cancelled = true
      controller.dispose()
    }
  }, [controller])

  return {
    state,
    startSso: () => controller && controller.startSso(),
    refresh: () => (controller ? controller.refresh() : undefined),
    devLogin: () => (controller ? controller.devLogin() : undefined),
  }
}
