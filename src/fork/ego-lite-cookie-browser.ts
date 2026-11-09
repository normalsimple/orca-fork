// fork: Ego Lite（Citro Labs）走上游同一条 Chromium cookie 导入。
// 配置目录和钥匙串来自已核对的安装，不猜 Linux（官方还在路线图上）。

import { BROWSER_FAMILY_LABELS } from '../shared/browser/browser-family-labels'
import { registerForkCookieImportSources } from '../shared/fork-hooks/chromium-cookie-browsers'

/** 持久化在会话来源里的 family。 */
export const EGO_LITE_BROWSER_FAMILY = 'ego-lite' as const
export const EGO_LITE_LABEL = 'Ego Lite'

/**
 * macOS 登录钥匙串里的通用密码。
 * 服务名和账户都是小写，不是 “Ego Lite Safe Storage”。
 * SweetCookieKit 的目录和用户钥匙串记录一致。
 */
export const EGO_LITE_KEYCHAIN_SERVICE = 'ego safe storage'
export const EGO_LITE_KEYCHAIN_ACCOUNT = 'ego'

/** ~/Library/Application Support 下的产品目录。Local State 和配置直接放在这里。 */
export const EGO_LITE_MAC_PROFILE_ROOT = 'Citro Labs/ego lite'

/**
 * %LOCALAPPDATA% 下的目录。Windows 比 macOS 多一层 User Data，和 Chrome 相同。
 * 见 citrolabs/ego-lite#544 以及启动页问题里的 Profile 路径。
 */
export const EGO_LITE_WINDOWS_PROFILE_ROOT = 'Citro Labs/ego lite/User Data'

/** Main process and renderer: the settings row label and the import hint. Detection is in main. */
export function registerEgoLiteCookieBrowser(): void {
  // ??= keeps upstream's label if upstream ever ships this family itself.
  BROWSER_FAMILY_LABELS[EGO_LITE_BROWSER_FAMILY] ??= EGO_LITE_LABEL
  registerForkCookieImportSources([{ label: EGO_LITE_LABEL, mac: true, win: true, linux: false }])
}
