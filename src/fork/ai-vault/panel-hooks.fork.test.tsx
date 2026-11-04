// @vitest-environment happy-dom
// The sidebar panel collapses new groups and keeps that across remounts; a `/resume` dialog panel
// starts from upstream's expanded groups. Covers toggles, groups that appear later, collapse-all
// per panel, StrictMode, groups the panel's set already holds, and the remembered-group bound.
import { StrictMode, useState } from 'react'
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiVaultSession } from '../../shared/ai-vault/contracts/ai-vault-types'
import {
  ALL_EXECUTION_HOSTS_SCOPE,
  LOCAL_EXECUTION_HOST_ID,
  toRuntimeExecutionHostId
} from '../../shared/execution-host'
import type { AiVaultHostScopeOption } from '../../renderer/src/components/right-sidebar/ai-vault/scope/ai-vault-host-scope'
import type { AiVaultSessionListGroup } from '../../renderer/src/components/right-sidebar/ai-vault/session-list/ai-vault-session-filters'
import type * as HostMenu from './host-menu'
import type * as PanelHooks from './panel-hooks'

let hooks: typeof PanelHooks
let hostMenu: typeof HostMenu

const SIDEBAR = undefined
const DIALOG = { worktreeId: 'wt-1' }

function group(key: string, label: string | null = key): AiVaultSessionListGroup {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook only reads executionHostId.
  const session = { executionHostId: LOCAL_EXECUTION_HOST_ID } as AiVaultSession
  return { key, label, sessions: [session] }
}

// Upstream's panel store: toggling adds or removes the key, nothing else writes it.
function useList(props: {
  groups: readonly AiVaultSessionListGroup[]
  workspace: unknown
  held?: ReadonlySet<string>
}) {
  const [held, setHeld] = useState<ReadonlySet<string>>(
    () => new Set([...(props.held ?? [])].map(listed))
  )
  const list = hooks.useForkAiVaultGroups(props.groups, held, [], null, props.workspace)
  const toggle = (key: string): void =>
    setHeld((current) => {
      const next = new Set(current)
      if (!next.delete(listed(key))) {
        next.add(listed(key))
      }
      return next
    })
  return { list, toggle, collapsed: (key: string) => list.collapsedGroups.has(listed(key)) }
}

// The key the list shows for group `key`: directory keys carry their host.
function listed(key: string): string {
  return `${LOCAL_EXECUTION_HOST_ID}::${key}`
}

function collapseAll(headerAction: React.ReactNode): void {
  const { getByRole, unmount } = render(<>{headerAction}</>)
  act(() => getByRole('button', { name: 'Collapse all groups' }).click())
  unmount()
}

beforeEach(async () => {
  // A fresh module, so the sidebar's remembered groups start empty in every test.
  vi.resetModules()
  hooks = await import('./panel-hooks')
  hostMenu = await import('./host-menu')
  const { registerAiVaultListPresentation } = await import('./list-presentation')
  registerAiVaultListPresentation()
})

afterEach(() => {
  cleanup()
})

describe('sidebar panel', () => {
  it('collapses new groups from the first frame, and the first toggle expands one', () => {
    const groups = [group('a'), group('b'), group('flat', null)]
    const frames: boolean[] = []
    const { result } = renderHook(() => {
      const view = useList({ groups, workspace: SIDEBAR })
      frames.push(view.collapsed('a'))
      return view
    })
    expect(frames.every(Boolean)).toBe(true)
    expect(result.current.collapsed('flat')).toBe(false)

    act(() => result.current.toggle('a'))
    expect([result.current.collapsed('a'), result.current.collapsed('b')]).toEqual([false, true])
    act(() => result.current.toggle('a'))
    expect(result.current.collapsed('a')).toBe(true)
  })

  it('keeps an expanded group expanded when the panel remounts', () => {
    const groups = [group('a'), group('b')]
    const first = renderHook(() => useList({ groups, workspace: SIDEBAR }))
    act(() => first.result.current.toggle('a'))
    first.unmount()

    // Upstream's sidebar set survives the remount too, so the next mount starts with the same keys.
    const second = renderHook(() => useList({ groups, workspace: SIDEBAR, held: new Set(['a']) }))
    expect([second.result.current.collapsed('a'), second.result.current.collapsed('b')]).toEqual([
      false,
      true
    ])
  })

  it('collapses a group that appears later and leaves an expanded one alone', () => {
    const { result, rerender } = renderHook(
      (props: { groups: readonly AiVaultSessionListGroup[] }) =>
        useList({ groups: props.groups, workspace: SIDEBAR }),
      { initialProps: { groups: [group('a'), group('b')] } }
    )
    act(() => result.current.toggle('a'))
    rerender({ groups: [group('a'), group('b'), group('c')] })
    expect(['a', 'b', 'c'].map(result.current.collapsed)).toEqual([false, true, true])
  })

  it('shows a group its set already holds as collapsed, and the first toggle expands it', () => {
    const { result } = renderHook(() =>
      useList({ groups: [group('a')], workspace: SIDEBAR, held: new Set(['a']) })
    )
    expect(result.current.collapsed('a')).toBe(true)
    act(() => result.current.toggle('a'))
    expect(result.current.collapsed('a')).toBe(false)
  })

  it('settles under StrictMode', () => {
    const renders = { count: 0 }
    const { result } = renderHook(
      () => {
        renders.count += 1
        return useList({ groups: [group('a'), group('b')], workspace: SIDEBAR })
      },
      { wrapper: StrictMode }
    )
    expect(renders.count).toBeLessThan(10)
    act(() => result.current.toggle('a'))
    expect([result.current.collapsed('a'), result.current.collapsed('b')]).toEqual([false, true])
  })

  it('forgets the oldest unlisted groups past the bound, so a returning one collapses again', () => {
    const first = Array.from({ length: 512 }, (_, index) => group(`a${index}`))
    const second = Array.from({ length: 600 }, (_, index) => group(`b${index}`))
    const renders = { count: 0 }
    const { result, rerender } = renderHook(
      (props: { groups: readonly AiVaultSessionListGroup[] }) => {
        renders.count += 1
        return useList({ groups: props.groups, workspace: SIDEBAR })
      },
      { initialProps: { groups: first } }
    )
    act(() => result.current.toggle('a0'))
    expect(result.current.collapsed('a0')).toBe(false)
    // A list longer than the bound keeps every listed group and still settles.
    rerender({ groups: second })
    expect(renders.count).toBeLessThan(10)
    expect(result.current.list.collapsedGroups.size).toBe(600)
    rerender({ groups: [group('a0')] })
    expect(result.current.collapsed('a0')).toBe(true)
  })
})

describe('dialog panel', () => {
  it("keeps upstream's expanded groups and toggles", () => {
    const { result, rerender } = renderHook(
      (props: { groups: readonly AiVaultSessionListGroup[] }) =>
        useList({ groups: props.groups, workspace: DIALOG }),
      { initialProps: { groups: [group('a')] } }
    )
    expect(result.current.collapsed('a')).toBe(false)
    act(() => result.current.toggle('a'))
    expect(result.current.collapsed('a')).toBe(true)
    rerender({ groups: [group('a'), group('b')] })
    expect(result.current.collapsed('b')).toBe(false)
  })
})

describe('collapse-all', () => {
  it.each([
    ['sidebar', SIDEBAR],
    ['dialog', DIALOG]
  ])('collapses every group, then one toggle expands one group (%s)', (_, workspace) => {
    const { result } = renderHook(() => useList({ groups: [group('a'), group('b')], workspace }))
    for (const key of ['a', 'b'].filter(result.current.collapsed)) {
      act(() => result.current.toggle(key))
    }
    expect(result.current.list.collapsedGroups.size).toBe(0)

    collapseAll(result.current.list.headerAction)
    expect([result.current.collapsed('a'), result.current.collapsed('b')]).toEqual([true, true])

    act(() => result.current.toggle('a'))
    expect([result.current.collapsed('a'), result.current.collapsed('b')]).toEqual([false, true])
  })

  it('acts on its own panel, and the sidebar button still works after a dialog closes', () => {
    const groups = [group('a')]
    const sidebar = renderHook(() => useList({ groups, workspace: SIDEBAR }))
    const dialog = renderHook(() => useList({ groups, workspace: DIALOG }))
    act(() => sidebar.result.current.toggle('a'))
    expect([sidebar.result.current.collapsed('a'), dialog.result.current.collapsed('a')]).toEqual([
      false,
      false
    ])

    collapseAll(dialog.result.current.list.headerAction)
    expect([sidebar.result.current.collapsed('a'), dialog.result.current.collapsed('a')]).toEqual([
      false,
      true
    ])
    dialog.unmount()
    collapseAll(sidebar.result.current.list.headerAction)
    expect(sidebar.result.current.collapsed('a')).toBe(true)
  })
})

it('changes nothing until the presentation is registered', async () => {
  vi.resetModules()
  const fresh = await import('./panel-hooks')
  const groups = [group('a')]
  const held = new Set<string>()
  const action = <span />
  const { result } = renderHook(() => fresh.useForkAiVaultGroups(groups, held, [], action, SIDEBAR))
  expect(result.current.groups).toBe(groups)
  expect(result.current.collapsedGroups).toBe(held)
  expect(result.current.headerAction).toBe(action)
})

describe('useForkVaultHostMenu', () => {
  it('moves a host another panel listed into the main menu of a mounted panel', () => {
    const gpu = toRuntimeExecutionHostId('env-gpu')
    const options: AiVaultHostScopeOption[] = [
      { id: LOCAL_EXECUTION_HOST_ID, label: 'Local Mac' },
      { id: gpu, label: 'gpu-linux' },
      { id: ALL_EXECUTION_HOSTS_SCOPE, label: 'All hosts' }
    ]
    const sidebarHistory: { executionHostId: string }[] = []
    const dialogHistory = [{ executionHostId: gpu }]
    const sidebar = renderHook(() =>
      hooks.useForkVaultHostMenu(options, sidebarHistory, ALL_EXECUTION_HOSTS_SCOPE, undefined)
    )
    const folded = () => hostMenu.otherVaultHosts(sidebar.result.current).map((host) => host.label)
    expect(folded()).toEqual(['gpu-linux'])

    renderHook(() =>
      hooks.useForkVaultHostMenu(options, dialogHistory, ALL_EXECUTION_HOSTS_SCOPE, DIALOG)
    )
    expect(folded()).toEqual([])
    expect(sidebar.result.current.map((host) => host.label)).toContain('gpu-linux')
  })
})
