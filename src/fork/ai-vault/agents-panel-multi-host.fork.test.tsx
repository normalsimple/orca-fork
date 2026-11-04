// @vitest-environment happy-dom
// The Agents panel listing this Mac and Linux servers reached through managed orcad. Pins the fork's
// hook lines in upstream's AiVaultPanel: host rows named after the saved server, new rows collapsed,
// a host row hiding its directories, collapse-all, and idle servers under other hosts.
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { default as AiVaultPanelComponent } from '../../renderer/src/components/right-sidebar/ai-vault/panel/AiVaultPanel'
import {
  connectedRuntimeStatus,
  publicRuntimeEnvironment
} from '../../renderer/src/runtime/paired-runtime-environment-test-fixture'
import type { AiVaultSession } from '../../shared/ai-vault/contracts/ai-vault-types'
import {
  getLocalExecutionHostLabel,
  LOCAL_EXECUTION_HOST_ID,
  toRuntimeExecutionHostId,
  type ExecutionHostId
} from '../../shared/execution-host'

const BUILD_ENV = 'b4f1c2d0-build'
const GPU_ENV = '91d3e6b2-gpu'
const IDLE_ENV = '7e0a9d31-idle'
const BUSY_ENV = '5c2e8f47-busy'

function session(n: number, host: ExecutionHostId, cwd: string): AiVaultSession {
  const at = new Date(Date.UTC(2026, 9, 30, 12, 60 - n)).toISOString()
  return {
    id: `${host}:claude:s-${n}`,
    executionHostId: host,
    agent: 'claude',
    sessionId: `s-${n}`,
    title: `Session ${n}`,
    cwd,
    branch: null,
    model: null,
    filePath: `${cwd}/.claude/s-${n}.jsonl`,
    codexHome: null,
    createdAt: at,
    updatedAt: at,
    modifiedAt: at,
    messageCount: 4,
    totalTokens: 10,
    previewMessages: [],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: 'claude --resume',
    subagent: null
  }
}

const build = toRuntimeExecutionHostId(BUILD_ENV)
const gpu = toRuntimeExecutionHostId(GPU_ENV)
const sessions = [
  session(1, LOCAL_EXECUTION_HOST_ID, '/home/user/src/app'),
  session(2, LOCAL_EXECUTION_HOST_ID, '/home/user/src/app'),
  session(3, build, '/home/user/src/app'),
  session(4, build, '/home/user/src/app'),
  session(5, build, '/srv/tools'),
  session(6, gpu, '/home/user/train')
]
// The host's answer for each scope, one array per scope as the real hook keeps its result.
const sessionsByScope = new Map<string, AiVaultSession[]>()
function scanned(scope: string): AiVaultSession[] {
  const listed =
    sessionsByScope.get(scope) ??
    sessions.filter((entry) => scope === 'all' || entry.executionHostId === scope)
  sessionsByScope.set(scope, listed)
  return listed
}

vi.mock('../../renderer/src/components/right-sidebar/ai-vault/scanning/ai-vault-session-refresh', () => ({
  useAiVaultSessionRefresh: (_scopePaths: readonly string[], scope: string) => ({
    error: null,
    loading: false,
    refresh: vi.fn(),
    scanResult: { sessions: scanned(scope), issues: [], scannedAt: '2026-10-30T12:00:00.000Z' },
    sessions: scanned(scope),
    loadedSessionLimit: null
  })
}))
vi.mock('../../renderer/src/components/right-sidebar/ai-vault/session-actions/ai-vault-session-delete-action', () => ({
  useAiVaultSessionDeleteAction: () => vi.fn()
}))
vi.mock('../../renderer/src/components/right-sidebar/ai-vault/session-list/AiVaultSessionRow', () => ({
  VaultSessionRow: (props: { session: AiVaultSession }) => <div>{props.session.title}</div>
}))

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let AiVaultPanel: typeof AiVaultPanelComponent

beforeEach(async () => {
  // Fresh modules, so the sidebar's remembered groups and hosts from one test do not reach the next.
  vi.resetModules()
  const { useAppStore } = await import('@/store')
  ;(await import('../register')).registerForkModules()
  ;(await import('../register-renderer')).registerForkRendererModules()
  AiVaultPanel = (await import('../../renderer/src/components/right-sidebar/ai-vault/panel/AiVaultPanel')).default
  useAppStore.setState({
    runtimeEnvironments: [
      publicRuntimeEnvironment({ id: BUILD_ENV, name: 'build-linux' }),
      publicRuntimeEnvironment({ id: GPU_ENV, name: 'gpu-linux' }),
      publicRuntimeEnvironment({ id: IDLE_ENV, name: 'idle-linux' }),
      publicRuntimeEnvironment({ id: BUSY_ENV, name: 'busy-linux' })
    ],
    runtimeStatusByEnvironmentId: new Map([[BUSY_ENV, connectedRuntimeStatus('busy', 1)]])
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      aiVault: { searchSessions: vi.fn(), searchStatus: vi.fn(async () => null) },
      ui: { writeClipboardText: vi.fn() }
    }
  })
  // happy-dom has no layout; give the virtualizer a viewport so it renders the rows.
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement
  ) {
    return this.classList.contains('overflow-y-auto') ? 2000 : 32
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return new DOMRect(0, 0, 400, this.classList.contains('overflow-y-auto') ? 2000 : 32)
  })
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// Group header rows: the list's toggles, not the header's menu triggers.
function groupHeaders(): string[] {
  return screen
    .getAllByRole('button')
    .filter(
      (button) => button.hasAttribute('aria-expanded') && !button.hasAttribute('aria-haspopup')
    )
    .map((button) => {
      const [, label, count] = button.children
      const state = button.getAttribute('aria-expanded') === 'true' ? 'open' : 'closed'
      return `${label?.textContent} (${count?.textContent}) ${state}`
    })
}

function renderPanel(): void {
  render(<AiVaultPanel />)
}

it('lists each host under its own row, named after the saved server, collapsed until opened', async () => {
  renderPanel()
  const user = userEvent.setup()
  const local = getLocalExecutionHostLabel()
  expect(groupHeaders()).toEqual([
    `${local} (2) closed`,
    'build-linux (3) closed',
    'gpu-linux (1) closed'
  ])

  await user.click(screen.getByRole('button', { name: /build-linux/ }))
  expect(groupHeaders()).toEqual([
    `${local} (2) closed`,
    'build-linux (3) open',
    '/home/user/src/app (2) closed',
    '/srv/tools (1) closed',
    'gpu-linux (1) closed'
  ])
  expect(screen.queryByText('Session 3')).toBeNull()

  await user.click(screen.getByRole('button', { name: /\/home\/user\/src\/app/ }))
  expect(screen.getByText('Session 3')).toBeTruthy()
  expect(screen.getByText('Session 4')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Collapse all groups' }))
  expect(groupHeaders()).toEqual([
    `${local} (2) closed`,
    'build-linux (3) closed',
    'gpu-linux (1) closed'
  ])
  expect(screen.queryByText('Session 3')).toBeNull()

  // Collapse-all also closed the directories under the server row.
  await user.click(screen.getByRole('button', { name: /build-linux/ }))
  expect(groupHeaders().slice(2, 4)).toEqual([
    '/home/user/src/app (2) closed',
    '/srv/tools (1) closed'
  ])
})

async function openHostMenu(user: ReturnType<typeof userEvent.setup>, current: string) {
  await user.click(screen.getByRole('button', { name: `Session History host: ${current}` }))
  const menu = await screen.findByRole('menu')
  return {
    menu,
    primary: within(menu)
      .getAllByRole('menuitemradio')
      .map((item) => item.textContent)
  }
}

it('keeps hosts with sessions, the connected server and All hosts in the menu, and folds the idle one', async () => {
  renderPanel()
  const user = userEvent.setup()
  const { menu, primary } = await openHostMenu(user, 'All hosts')
  expect(primary).toEqual([
    getLocalExecutionHostLabel(),
    'build-linux',
    'gpu-linux',
    'busy-linux',
    'All hosts'
  ])
  const other = within(menu).getByRole('menuitem', { name: 'Other configured hosts' })
  act(() => other.focus())
  await user.keyboard('{ArrowRight}')
  await user.click(await screen.findByRole('menuitemradio', { name: 'idle-linux' }))

  // Picked from the submenu, the server keeps its saved name and moves to the main list.
  const reopened = await openHostMenu(user, 'idle-linux')
  expect(reopened.primary).toContain('idle-linux')
  expect(
    within(reopened.menu).queryByRole('menuitem', { name: 'Other configured hosts' })
  ).toBeNull()
})

it('keeps a server that listed sessions in the main menu after picking another host', async () => {
  renderPanel()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /build-linux/ }))
  await user.click(screen.getByRole('button', { name: /\/home\/user\/src\/app/ }))
  const { menu } = await openHostMenu(user, 'All hosts')
  await user.click(within(menu).getByRole('menuitemradio', { name: 'build-linux' }))
  // The server alone has no host row; the directory opened under it stays open.
  expect(groupHeaders()).toEqual(['/home/user/src/app (2) open', '/srv/tools (1) closed'])

  const { primary } = await openHostMenu(user, 'build-linux')
  expect(primary).toContain('gpu-linux')
  expect(primary).not.toContain('idle-linux')
})
