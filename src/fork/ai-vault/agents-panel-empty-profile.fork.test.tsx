// @vitest-environment happy-dom
// A fresh profile opening the right sidebar's Agents tab with the fork's panel slots and list
// presentation registered. A fork slot once selected a new array on every store read, and
// zustand's useSyncExternalStore re-rendered without end (React #185, "Maximum update depth
// exceeded"); every fork store read in the panel must stay stable.
import { act, cleanup, render, screen } from '@testing-library/react'
import { Component, type ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { registerForkModules } from '../register'
import { registerForkRendererModules } from '../register-renderer'

// No agent sessions at all, as in a profile that never ran one.
vi.mock('../../renderer/src/components/right-sidebar/ai-vault/scanning/ai-vault-session-refresh', () => ({
  useAiVaultSessionRefresh: () => ({
    error: null,
    loading: false,
    refresh: vi.fn(),
    scanResult: null,
    sessions: [],
    loadedSessionLimit: null
  })
}))
// The panel's delete action needs the app's confirmation dialog provider.
vi.mock('../../renderer/src/components/right-sidebar/ai-vault/session-actions/ai-vault-session-delete-action', () => ({
  useAiVaultSessionDeleteAction: () => vi.fn()
}))

let caught: unknown
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  componentDidCatch(error: unknown): void {
    caught = error
  }
  render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

beforeAll(() => {
  registerForkModules()
  registerForkRendererModules()
})

beforeEach(() => {
  caught = undefined
  useAppStore.setState(useAppStore.getInitialState(), true)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      aiVault: { searchSessions: vi.fn(), searchStatus: vi.fn(async () => null) },
      ui: { writeClipboardText: vi.fn() }
    }
  })
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

it('opens the Agents panel of an empty profile without an update loop', async () => {
  const { default: AiVaultPanel } =
    await import('../../renderer/src/components/right-sidebar/ai-vault/panel/AiVaultPanel')
  // act flushes the mount's effects and the store and status reads they start.
  await act(async () => {
    render(
      <Boundary>
        <AiVaultPanel />
      </Boundary>
    )
  })
  expect(caught).toBeUndefined()
  // The fork's collapse-all button rendered, so the check above covered the fork's panel code.
  expect(screen.getByRole('button', { name: 'Collapse all groups' })).toBeTruthy()
})
