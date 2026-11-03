// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { BrowserSessionProfile } from '../shared/browser-workspace-types'

const { importCookiesFromBrowser } = vi.hoisted(() => ({
  importCookiesFromBrowser: vi.fn(async () => ({
    ok: true as const,
    summary: {
      totalCookies: 1,
      importedCookies: 1,
      skippedCookies: 0,
      domains: ['example.com']
    }
  }))
}))

vi.mock('@/components/ui/dropdown-menu', () => dropdownMenuStubs())
vi.mock('@/store', () => ({
  useAppStore: appStoreStub()
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/browser-cookie-import-toast', () => ({
  emitBrowserCookieImportToast: vi.fn()
}))

import { BrowserProfileRow } from '../renderer/src/components/settings/browser/profiles/BrowserProfileRow'
import { registerEgoLiteCookieBrowser } from './ego-lite-cookie-browser'

const profile: BrowserSessionProfile = {
  id: 'default',
  scope: 'default',
  partition: 'persist:orca-browser',
  label: 'Default',
  source: { browserFamily: 'ego-lite', profileName: 'Personal', importedAt: 1 }
}

describe('Import Cookie menu — Ego Lite', () => {
  // The renderer registration names the family in the settings row.
  beforeAll(() => {
    registerEgoLiteCookieBrowser()
  })

  afterEach(() => {
    cleanup()
    importCookiesFromBrowser.mockClear()
  })

  it('shows Ego Lite next to Chrome and keeps file import', () => {
    render(
      <BrowserProfileRow
        profile={profile}
        detectedBrowsers={[
          {
            family: 'chrome',
            label: 'Google Chrome',
            profiles: [{ name: 'Default', directory: 'Default' }],
            selectedProfile: 'Default'
          },
          {
            family: 'ego-lite',
            label: 'Ego Lite',
            profiles: [{ name: 'Personal', directory: 'Default' }],
            selectedProfile: 'Default'
          }
        ]}
        importState={null}
        isActive
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'From Google Chrome' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'From Ego Lite' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'From File…' })).toBeTruthy()
    expect(screen.getByText('Ego Lite (Personal)')).toBeTruthy()
    expect(screen.getByText("Google logins aren't imported")).toBeTruthy()
  })

  it('hides Ego Lite when it was not discovered, same as a missing browser', () => {
    render(
      <BrowserProfileRow
        profile={{ ...profile, source: null }}
        detectedBrowsers={[
          {
            family: 'chrome',
            label: 'Google Chrome',
            profiles: [{ name: 'Default', directory: 'Default' }],
            selectedProfile: 'Default'
          }
        ]}
        importState={null}
        isActive
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'From Google Chrome' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'From Ego Lite' })).toBeNull()
    expect(screen.getByRole('button', { name: 'From File…' })).toBeTruthy()
  })

  it('imports the chosen Ego Lite profile through the Chromium menu action', () => {
    render(
      <BrowserProfileRow
        profile={profile}
        detectedBrowsers={[
          {
            family: 'ego-lite',
            label: 'Ego Lite',
            profiles: [
              { name: 'Personal', directory: 'Default' },
              { name: 'Work', directory: 'Profile 1' }
            ],
            selectedProfile: 'Default'
          }
        ]}
        importState={null}
        isActive
        onSelect={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Work' }))

    expect(importCookiesFromBrowser).toHaveBeenCalledWith('default', 'ego-lite', 'Profile 1')
  })

  it('uses the same From-browser strings as Chrome in English and Chinese', () => {
    const en = JSON.parse(readFileSync('src/renderer/src/i18n/locales/en.json', 'utf8'))
    const zh = JSON.parse(readFileSync('src/renderer/src/i18n/locales/zh.json', 'utf8'))
    expect(en.auto.components.settings.BrowserProfileRow.c5a273a809).toBe('From {{value0}}')
    expect(zh.auto.components.settings.BrowserProfileRow.c5a273a809).toBe('从 {{value0}}')
    expect(en.auto.components.browser.pane.BrowserToolbarMenu.eb280bfb11).toBe('From {{value0}}')
    expect(zh.auto.components.browser.pane.BrowserToolbarMenu.eb280bfb11).toBe('从 {{value0}}')
  })
})

function dropdownMenuStubs(): Record<string, unknown> {
  const passthrough = ({ children }: { children?: ReactNode }): ReactNode => children
  const item = ({
    children,
    onSelect
  }: {
    children?: ReactNode
    onSelect?: () => void
  }): ReactNode => (
    <button type="button" onClick={() => onSelect?.()}>
      {children}
    </button>
  )
  return {
    DropdownMenu: passthrough,
    DropdownMenuContent: passthrough,
    DropdownMenuItem: item,
    DropdownMenuLabel: ({ children }: { children?: ReactNode }): ReactNode => <div>{children}</div>,
    DropdownMenuPortal: passthrough,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuSub: passthrough,
    DropdownMenuSubContent: passthrough,
    DropdownMenuSubTrigger: item,
    DropdownMenuTrigger: passthrough
  }
}

function appStoreStub(): unknown {
  const state = {
    detectedBrowsersHost: null,
    fetchDetectedBrowsers: vi.fn(),
    importCookiesFromBrowser,
    importCookiesToProfile: vi.fn()
  }
  const useAppStore = (selector?: (value: typeof state) => unknown): unknown =>
    selector ? selector(state) : state
  useAppStore.getState = (): typeof state => state
  return useAppStore
}
