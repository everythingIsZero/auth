import type { ReactElement } from 'react'
import type { UseSsoLoginOptions } from './react'

export interface SsoLoginState {
  channel: 'wechat' | 'mobile' | 'pc'
  status: string
  qrUrl?: string
  pairCode?: string
  error?: string
  devLogin?: boolean
}

/** 已自持的登录态（useSsoLogin 返回值或等价对象） */
export interface SsoLoginHandle {
  state: SsoLoginState
  startSso?: () => void
  refresh?: () => void
  devLogin?: () => void
}

export interface SsoLoginViewProps extends SsoLoginHandle {
  title?: string
  hint?: string
  devLoginLabel?: string
}

/** 纯视图：只按 state 渲染（可测、可嵌入） */
export declare function SsoLoginView(props: SsoLoginViewProps): ReactElement

export interface SsoLoginPanelProps extends UseSsoLoginOptions {
  title?: string
  hint?: string
  devLoginLabel?: string
  onSuccess?: (data: any) => void
  /** 传入已自持的登录态（如外层已调用 useSsoLogin）；不传则本组件自建 */
  login?: SsoLoginHandle
}

export declare function SsoLoginPanel(props: SsoLoginPanelProps): ReactElement

export interface SsoLoginModalProps extends SsoLoginPanelProps {
  open?: boolean
  onClose?: () => void
}

export declare function SsoLoginModal(props: SsoLoginModalProps): ReactElement | null
export default SsoLoginModal
