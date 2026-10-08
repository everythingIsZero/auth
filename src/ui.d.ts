import type { ReactElement } from 'react'
import type { UseSsoLoginOptions } from './react'

export interface SsoLoginPanelProps extends UseSsoLoginOptions {
  /** 标题，默认「登录」 */
  title?: string
  /** 底部提示文案 */
  hint?: string
  /** 开发旁路按钮文案 */
  devLoginLabel?: string
  /** 登录成功回调 */
  onSuccess?: (data: any) => void
}

/** 内层面板（直接嵌入；自带 useSsoLogin） */
export declare function SsoLoginPanel(props: SsoLoginPanelProps): ReactElement

export interface SsoLoginModalProps extends SsoLoginPanelProps {
  /** 是否显示弹层；false 时不挂载 */
  open?: boolean
  /** 关闭回调（点遮罩/关闭按钮触发） */
  onClose?: () => void
}

/** 弹层（覆盖 + 关闭；open=false 返回 null） */
export declare function SsoLoginModal(props: SsoLoginModalProps): ReactElement | null
export default SsoLoginModal
