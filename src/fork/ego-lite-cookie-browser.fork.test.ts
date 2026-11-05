import { pbkdf2Sync } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHROMIUM_BROWSERS } from '../main/browser/cookies/sources/browser-cookie-source-profiles'
import { BROWSER_FAMILY_LABELS } from '../shared/constants'
import { getBrowserCookieImportSourceLabels } from '../shared/browser-cookie-import-sources'
import { registerForkCookieImportSources } from '../shared/fork-hooks/chromium-cookie-browsers'
import { appendChromiumCookieBrowser } from './main/ego-lite-cookie-detection'
import {
  EGO_LITE_BROWSER_FAMILY,
  EGO_LITE_KEYCHAIN_ACCOUNT,
  EGO_LITE_KEYCHAIN_SERVICE,
  EGO_LITE_MAC_PROFILE_ROOT,
  EGO_LITE_WINDOWS_PROFILE_ROOT,
  registerEgoLiteCookieBrowser
} from './ego-lite-cookie-browser'

const { runProcessMock } = vi.hoisted(() => ({ runProcessMock: vi.fn() }))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  session: { fromPartition: vi.fn() }
}))

vi.mock('@orca/process-host', () => ({ runProcess: runProcessMock }))

function slashPath(pathValue: string): string {
  return pathValue.replaceAll('\\', '/')
}

// 只提供发现和读 Local State 用到的函数。不铺开真实 fs，避免测试里 importActual。
function mockFs(overrides: {
  existsSync: (path: string) => boolean
  readFileSync?: (path: string) => string
}): void {
  vi.doMock('node:fs', () => ({
    readdirSync: () => [],
    readFileSync: (path: string) => {
      if (!overrides.readFileSync) {
        throw new Error(`Unexpected read: ${path}`)
      }
      return overrides.readFileSync(path)
    },
    existsSync: overrides.existsSync
  }))
}

const MAC_ROOT = `/Users/test/Library/Application Support/${EGO_LITE_MAC_PROFILE_ROOT}`

describe('Ego Lite cookie import registration', () => {
  afterEach(() => {
    registerForkCookieImportSources([])
  })

  it('maps the family key to the menu label Ego Lite once registered', () => {
    expect(BROWSER_FAMILY_LABELS[EGO_LITE_BROWSER_FAMILY]).toBeUndefined()
    registerEgoLiteCookieBrowser()
    expect(BROWSER_FAMILY_LABELS[EGO_LITE_BROWSER_FAMILY]).toBe('Ego Lite')
  })

  it('adds Ego Lite to the import hint on macOS and Windows only after registration', () => {
    expect(getBrowserCookieImportSourceLabels('darwin')).not.toContain('Ego Lite')
    expect(getBrowserCookieImportSourceLabels('win32')).not.toContain('Ego Lite')

    registerEgoLiteCookieBrowser()

    expect(getBrowserCookieImportSourceLabels('darwin')).toEqual([
      'Google Chrome',
      'Microsoft Edge',
      'Arc',
      'Brave',
      'Comet',
      'Helium',
      'Vivaldi',
      'Ego Lite',
      'Firefox',
      'Safari'
    ])
    expect(getBrowserCookieImportSourceLabels('win32')).toEqual([
      'Google Chrome',
      'Microsoft Edge',
      'Brave',
      'Comet',
      'Vivaldi',
      'Ego Lite',
      'Firefox'
    ])
    expect(getBrowserCookieImportSourceLabels('linux')).not.toContain('Ego Lite')
  })

  it('does not let a registration replace Chrome', () => {
    appendChromiumCookieBrowser({
      family: 'chrome',
      label: 'Not Chrome',
      keychainService: 'nope',
      keychainAccount: 'nope',
      macRoot: EGO_LITE_MAC_PROFILE_ROOT
    })

    const chrome = CHROMIUM_BROWSERS.filter((browser) => browser.family === 'chrome')
    expect(chrome).toEqual([
      expect.objectContaining({
        label: 'Google Chrome',
        keychainService: 'Chrome Safe Storage',
        macRoot: 'Google/Chrome'
      })
    ])
  })
})

describe('detectInstalledBrowsers — Ego Lite', () => {
  const originalPlatform = process.platform
  const originalHome = process.env.HOME
  const originalLocalAppData = process.env.LOCALAPPDATA

  beforeEach(() => {
    vi.resetModules()
    runProcessMock.mockReset()
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    process.env.HOME = '/Users/test'
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    process.env.HOME = originalHome
    if (originalLocalAppData === undefined) {
      delete process.env.LOCALAPPDATA
    } else {
      process.env.LOCALAPPDATA = originalLocalAppData
    }
    vi.restoreAllMocks()
  })

  async function registeredDetection() {
    const { registerEgoLiteCookieDetection: register } =
      await import('./main/ego-lite-cookie-detection')
    register()
    return import('../main/browser/cookies/browser-cookie-import')
  }

  it('does not list Ego Lite until the fork browser is registered', async () => {
    mockFs({
      existsSync: (p: string) => slashPath(p).includes(`${EGO_LITE_MAC_PROFILE_ROOT}/`)
    })

    const { detectInstalledBrowsers } =
      await import('../main/browser/cookies/browser-cookie-import')
    expect(
      detectInstalledBrowsers().find((browser) => browser.family === EGO_LITE_BROWSER_FAMILY)
    ).toBeUndefined()
  })

  it('detects Ego Lite from Network/Cookies and keeps Chrome beside it', async () => {
    mockFs({
      existsSync: (p: string) => {
        const normalizedPath = slashPath(p)
        return (
          normalizedPath.includes(`${EGO_LITE_MAC_PROFILE_ROOT}/Default/Network/Cookies`) ||
          normalizedPath.includes(`${EGO_LITE_MAC_PROFILE_ROOT}/Local State`) ||
          normalizedPath.includes('Google/Chrome/Default/Network/Cookies') ||
          normalizedPath.includes('Google/Chrome/Local State')
        )
      },
      readFileSync: (p: string) => {
        if (slashPath(p).includes('/Local State')) {
          return JSON.stringify({ profile: { info_cache: { Default: { name: 'Default' } } } })
        }
        throw new Error(`Unexpected read: ${p}`)
      }
    })

    const { detectInstalledBrowsers } = await registeredDetection()
    const detected = detectInstalledBrowsers()
    const ego = detected.find((browser) => browser.family === EGO_LITE_BROWSER_FAMILY)
    const chrome = detected.find((browser) => browser.family === 'chrome')

    expect(ego).toMatchObject({
      label: 'Ego Lite',
      keychainService: EGO_LITE_KEYCHAIN_SERVICE,
      keychainAccount: EGO_LITE_KEYCHAIN_ACCOUNT,
      selectedProfile: 'Default'
    })
    expect(slashPath(ego?.cookiesPath ?? '')).toBe(`${MAC_ROOT}/Default/Network/Cookies`)
    expect(chrome).toMatchObject({
      label: 'Google Chrome',
      keychainService: 'Chrome Safe Storage',
      keychainAccount: 'Chrome'
    })
    expect(slashPath(chrome?.cookiesPath ?? '')).toContain('Google/Chrome/Default/Network/Cookies')
  })

  it('reads the legacy Cookies file when Network/Cookies is absent', async () => {
    mockFs({
      existsSync: (p: string) => {
        const normalizedPath = slashPath(p)
        if (normalizedPath.includes(`${EGO_LITE_MAC_PROFILE_ROOT}/Default/Network/Cookies`)) {
          return false
        }
        return (
          normalizedPath.endsWith(`${EGO_LITE_MAC_PROFILE_ROOT}/Default/Cookies`) ||
          normalizedPath.includes(`${EGO_LITE_MAC_PROFILE_ROOT}/Local State`)
        )
      },
      readFileSync: (p: string) => {
        if (slashPath(p).includes(`${EGO_LITE_MAC_PROFILE_ROOT}/Local State`)) {
          return JSON.stringify({ profile: { info_cache: { Default: { name: 'Default' } } } })
        }
        throw new Error(`Unexpected read: ${p}`)
      }
    })

    const { detectInstalledBrowsers } = await registeredDetection()
    const ego = detectInstalledBrowsers().find(
      (browser) => browser.family === EGO_LITE_BROWSER_FAMILY
    )
    expect(slashPath(ego?.cookiesPath ?? '')).toBe(`${MAC_ROOT}/Default/Cookies`)
  })

  it('enumerates every Local State profile and can switch to one', async () => {
    mockFs({
      existsSync: (p: string) => {
        const normalizedPath = slashPath(p)
        return (
          normalizedPath.includes(`${EGO_LITE_MAC_PROFILE_ROOT}/Default/Network/Cookies`) ||
          normalizedPath.includes(`${EGO_LITE_MAC_PROFILE_ROOT}/Profile 1/Network/Cookies`) ||
          normalizedPath.includes(`${EGO_LITE_MAC_PROFILE_ROOT}/Local State`)
        )
      },
      readFileSync: (p: string) => {
        if (slashPath(p).includes(`${EGO_LITE_MAC_PROFILE_ROOT}/Local State`)) {
          return JSON.stringify({
            profile: {
              info_cache: {
                Default: { name: 'Personal' },
                'Profile 1': { name: 'Work' }
              }
            }
          })
        }
        throw new Error(`Unexpected read: ${p}`)
      }
    })

    const { detectInstalledBrowsers, selectBrowserProfile } = await registeredDetection()
    const ego = detectInstalledBrowsers().find(
      (browser) => browser.family === EGO_LITE_BROWSER_FAMILY
    )
    expect(ego).toBeDefined()
    expect(ego!.profiles.map((profile) => profile.directory).sort()).toEqual([
      'Default',
      'Profile 1'
    ])
    expect(ego!.profiles.map((profile) => profile.name).sort()).toEqual(['Personal', 'Work'])

    const selected = selectBrowserProfile(ego!, 'Profile 1')
    expect(slashPath(selected?.cookiesPath ?? '')).toBe(`${MAC_ROOT}/Profile 1/Network/Cookies`)
    expect(selected?.selectedProfile).toBe('Profile 1')
  })

  it('hides Ego Lite when the data directory or cookie database is missing', async () => {
    mockFs({ existsSync: () => false })

    const { detectInstalledBrowsers } = await registeredDetection()
    expect(
      detectInstalledBrowsers().find((browser) => browser.family === EGO_LITE_BROWSER_FAMILY)
    ).toBeUndefined()
  })

  it('rejects a profile directory that escapes the Ego Lite root', async () => {
    mockFs({
      existsSync: (p: string) =>
        slashPath(p).includes('Application Support/Outside/Network/Cookies')
    })

    const { selectBrowserProfile } = await registeredDetection()
    const selected = selectBrowserProfile(
      {
        family: EGO_LITE_BROWSER_FAMILY,
        label: 'Ego Lite',
        cookiesPath: `${MAC_ROOT}/Default/Network/Cookies`,
        keychainService: EGO_LITE_KEYCHAIN_SERVICE,
        keychainAccount: EGO_LITE_KEYCHAIN_ACCOUNT,
        profiles: [{ name: 'Outside', directory: '../Outside' }],
        selectedProfile: 'Default'
      },
      '../Outside'
    )

    expect(selected).toBeNull()
  })

  it('does not invent a Linux profile root', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    mockFs({
      existsSync: () => true,
      readFileSync: () =>
        JSON.stringify({ profile: { info_cache: { Default: { name: 'Default' } } } })
    })

    const { detectInstalledBrowsers } = await registeredDetection()
    const detected = detectInstalledBrowsers()
    expect(detected.find((browser) => browser.family === EGO_LITE_BROWSER_FAMILY)).toBeUndefined()
    expect(detected.find((browser) => browser.family === 'chrome')?.keychainService).toBe(
      'Chrome Safe Storage'
    )
  })
})

describe('detectInstalledBrowsers — Ego Lite on Windows', () => {
  const originalPlatform = process.platform
  const originalLocalAppData = process.env.LOCALAPPDATA
  const localAppData = 'C:\\Users\\test\\AppData\\Local'
  const egoRoot = `${slashPath(localAppData)}/${EGO_LITE_WINDOWS_PROFILE_ROOT}`

  beforeEach(() => {
    vi.resetModules()
    runProcessMock.mockReset()
    Object.defineProperty(process, 'platform', { value: 'win32' })
    process.env.LOCALAPPDATA = localAppData
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    if (originalLocalAppData === undefined) {
      delete process.env.LOCALAPPDATA
    } else {
      process.env.LOCALAPPDATA = originalLocalAppData
    }
    vi.restoreAllMocks()
  })

  function mockInstallAt(rootPath: string): void {
    mockFs({
      existsSync: (p: string) =>
        slashPath(p) === `${rootPath}/Local State` ||
        slashPath(p) === `${rootPath}/Default/Network/Cookies`,
      readFileSync: (p: string) => {
        if (slashPath(p) === `${rootPath}/Local State`) {
          return JSON.stringify({ profile: { info_cache: { Default: { name: 'Default' } } } })
        }
        throw new Error(`Unexpected fixture read: ${p}`)
      }
    })
  }

  it('detects Ego Lite under Local AppData with the User Data segment', async () => {
    mockInstallAt(egoRoot)
    const { registerEgoLiteCookieDetection: register } =
      await import('./main/ego-lite-cookie-detection')
    register()
    const { detectInstalledBrowsers } =
      await import('../main/browser/cookies/browser-cookie-import')
    const ego = detectInstalledBrowsers().find(
      (browser) => browser.family === EGO_LITE_BROWSER_FAMILY
    )

    expect(ego).toBeDefined()
    expect(slashPath(ego?.cookiesPath ?? '')).toBe(`${egoRoot}/Default/Network/Cookies`)
  })

  it('does not treat the macOS layout without User Data as a Windows install', async () => {
    mockInstallAt(`${slashPath(localAppData)}/${EGO_LITE_MAC_PROFILE_ROOT}`)
    const { registerEgoLiteCookieDetection: register } =
      await import('./main/ego-lite-cookie-detection')
    register()
    const { detectInstalledBrowsers } =
      await import('../main/browser/cookies/browser-cookie-import')

    expect(
      detectInstalledBrowsers().find((browser) => browser.family === EGO_LITE_BROWSER_FAMILY)
    ).toBeUndefined()
  })
})

describe('Ego Lite Windows cookie key', () => {
  const originalPlatform = process.platform
  const originalLocalAppData = process.env.LOCALAPPDATA
  const localAppData = 'C:\\Users\\test\\AppData\\Local'
  const egoRoot = `${slashPath(localAppData)}/${EGO_LITE_WINDOWS_PROFILE_ROOT}`
  const chromeRoot = `${slashPath(localAppData)}/Google/Chrome/User Data`

  beforeEach(() => {
    vi.resetModules()
    runProcessMock.mockReset()
    Object.defineProperty(process, 'platform', { value: 'win32' })
    process.env.LOCALAPPDATA = localAppData
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    if (originalLocalAppData === undefined) {
      delete process.env.LOCALAPPDATA
    } else {
      process.env.LOCALAPPDATA = originalLocalAppData
    }
    vi.restoreAllMocks()
  })

  it('unwraps DPAPI from Ego Lite Local State without touching Chrome', async () => {
    const egoPayload = Buffer.from('ego-dpapi')
    const chromePayload = Buffer.from('chrome-dpapi')
    const egoKey = Buffer.alloc(32, 4)
    const chromeKey = Buffer.alloc(32, 9)
    const localState = (payload: Buffer): string =>
      JSON.stringify({
        os_crypt: {
          encrypted_key: Buffer.concat([Buffer.from('DPAPI'), payload]).toString('base64')
        }
      })

    mockFs({
      existsSync: (p: string) => {
        const normalizedPath = slashPath(p)
        return (
          normalizedPath === `${egoRoot}/Local State` ||
          normalizedPath === `${chromeRoot}/Local State`
        )
      },
      readFileSync: (p: string) => {
        const normalizedPath = slashPath(p)
        if (normalizedPath === `${egoRoot}/Local State`) {
          return localState(egoPayload)
        }
        if (normalizedPath === `${chromeRoot}/Local State`) {
          return localState(chromePayload)
        }
        throw new Error(`Unexpected fixture read: ${p}`)
      }
    })

    runProcessMock.mockImplementation((invocation: { input?: string }) => {
      const key = invocation.input === egoPayload.toString('base64') ? egoKey : chromeKey
      return { code: 0, timedOut: false, stdout: `${key.toString('base64')}\n`, stderr: '' }
    })

    const { registerEgoLiteCookieDetection: register } =
      await import('./main/ego-lite-cookie-detection')
    register()
    const { getWindowsEncryptionKey } =
      await import('../main/browser/cookies/sources/browser-cookie-key')
    const egoBrowser = {
      family: EGO_LITE_BROWSER_FAMILY,
      label: 'Ego Lite',
      cookiesPath: `${egoRoot}/Default/Network/Cookies`,
      keychainService: EGO_LITE_KEYCHAIN_SERVICE,
      keychainAccount: EGO_LITE_KEYCHAIN_ACCOUNT,
      profiles: [{ name: 'Default', directory: 'Default' }],
      selectedProfile: 'Default'
    }
    const chromeBrowser = {
      ...egoBrowser,
      family: 'chrome' as const,
      label: 'Google Chrome',
      cookiesPath: `${chromeRoot}/Default/Network/Cookies`,
      keychainService: 'Chrome Safe Storage',
      keychainAccount: 'Chrome'
    }

    expect(await getWindowsEncryptionKey(egoBrowser)).toEqual({ key: egoKey, mode: 'aes-256-gcm' })
    expect(await getWindowsEncryptionKey(chromeBrowser)).toEqual({
      key: chromeKey,
      mode: 'aes-256-gcm'
    })
    expect(runProcessMock).toHaveBeenCalledTimes(2)
  })

  it('returns null for Ego Lite when the browser was not registered', async () => {
    mockFs({ existsSync: () => true })

    const { getWindowsEncryptionKey } =
      await import('../main/browser/cookies/sources/browser-cookie-key')
    expect(
      await getWindowsEncryptionKey({
        family: EGO_LITE_BROWSER_FAMILY
      })
    ).toBeNull()
    expect(runProcessMock).not.toHaveBeenCalled()
  })
})

describe('Ego Lite macOS safe-storage password', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.resetModules()
    runProcessMock.mockReset()
    Object.defineProperty(process, 'platform', { value: 'darwin' })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    vi.restoreAllMocks()
  })

  it('asks the login keychain for ego safe storage / ego', async () => {
    runProcessMock.mockReturnValue({
      code: 0,
      timedOut: false,
      stdout: 'ego-password\n',
      stderr: ''
    })

    const { getMacEncryptionKey } =
      await import('../main/browser/cookies/sources/browser-cookie-key')
    const key = await getMacEncryptionKey(EGO_LITE_KEYCHAIN_SERVICE, EGO_LITE_KEYCHAIN_ACCOUNT)

    expect(runProcessMock).toHaveBeenCalledWith({
      program: 'security',
      args: ['find-generic-password', '-s', 'ego safe storage', '-a', 'ego', '-w'],
      timeoutMs: 30_000
    })
    expect(key).toEqual({
      mode: 'aes-128-cbc',
      keysByVersion: {
        v10: pbkdf2Sync('ego-password', 'saltysalt', 1003, 16, 'sha1')
      }
    })
  })
})
