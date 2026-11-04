// fork (F049): main-process side of Ego Lite. Upstream's discovery, profile switch and key lookup
// all read CHROMIUM_BROWSERS, so registering appends one definition there and changes no upstream file.

import {
  CHROMIUM_BROWSERS,
  type ChromiumBrowserDef
} from '../../main/browser/cookies/sources/browser-cookie-source-profiles'
import {
  EGO_LITE_BROWSER_FAMILY,
  EGO_LITE_KEYCHAIN_ACCOUNT,
  EGO_LITE_KEYCHAIN_SERVICE,
  EGO_LITE_LABEL,
  EGO_LITE_MAC_PROFILE_ROOT,
  EGO_LITE_WINDOWS_PROFILE_ROOT
} from '../ego-lite-cookie-browser'

/** Appended after upstream's browsers; a family upstream already lists is never replaced. */
export function appendChromiumCookieBrowser(browser: ChromiumBrowserDef): void {
  if (!CHROMIUM_BROWSERS.some((existing) => existing.family === browser.family)) {
    CHROMIUM_BROWSERS.push(browser)
  }
}

/** Desktop and orcad, so a remote import discovers the browser on the host it runs on. */
export function registerEgoLiteCookieDetection(): void {
  appendChromiumCookieBrowser({
    family: EGO_LITE_BROWSER_FAMILY,
    label: EGO_LITE_LABEL,
    keychainService: EGO_LITE_KEYCHAIN_SERVICE,
    keychainAccount: EGO_LITE_KEYCHAIN_ACCOUNT,
    macRoot: EGO_LITE_MAC_PROFILE_ROOT,
    winRoot: EGO_LITE_WINDOWS_PROFILE_ROOT
  })
}
