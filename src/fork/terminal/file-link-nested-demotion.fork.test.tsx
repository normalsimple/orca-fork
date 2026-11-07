// 更深工作区打开同一路径后，外层可写标签降为只读；脏的等干净了再降；工作区列表晚到也补上。
import { beforeEach, describe, expect, it, vi } from 'vitest'

type DemotionFile = {
  id: string
  worktreeId: string
  filePath: string
  mode?: 'edit'
  readOnly?: true
  isDirty?: boolean
}
type DemotionState = {
  openFiles: DemotionFile[]
  settings: object
  worktreesByRepo?: object
  folderWorkspaces?: unknown[]
}

const listeners = new Set<(state: DemotionState) => void>()
let state: DemotionState

function setState(partial: Partial<DemotionState>): void {
  state = { ...state, ...partial }
  for (const listener of listeners) {
    listener(state)
  }
}

const findRoute = vi.hoisted(() => vi.fn())

vi.mock('@/lib/runtime-workspace-file-route', () => ({
  findWorkspaceFileRoute: findRoute
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => state,
    setState: (partial: Partial<DemotionState>) => setState(partial),
    subscribe: (listener: (next: DemotionState) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}))

vi.mock('@/components/settings/section-layout/SearchableSetting', () => ({
  SearchableSetting: () => null
}))

import {
  registerNestedCopyDemotion,
  resetNestedCopyDemotionForTests
} from './file-link-nested-demotion'

describe('nested copy demotion', () => {
  beforeEach(() => {
    resetNestedCopyDemotionForTests()
    listeners.clear()
    findRoute.mockReset()
    findRoute.mockReturnValue(null)
    state = { openFiles: [], settings: {} }
  })

  it('demotes an older writable outer tab when the nested workspace opens the same path', () => {
    registerNestedCopyDemotion()
    findRoute.mockReturnValue({
      worktreeId: 'wt-nas',
      relativePath: 'x.txt',
      executionHostId: 'local'
    })
    const filePath = '/Users/me/nas/x.txt'

    setState({
      worktreesByRepo: {},
      folderWorkspaces: [],
      openFiles: [
        { id: 'outer', worktreeId: 'wt-home', filePath, mode: 'edit' },
        { id: 'inner', worktreeId: 'wt-nas', filePath, mode: 'edit' }
      ]
    })

    expect(state.openFiles.map((file) => [file.id, file.readOnly])).toEqual([
      ['outer', true],
      ['inner', undefined]
    ])
  })

  it('waits to demote a dirty outer tab until the edits are gone', () => {
    registerNestedCopyDemotion()
    findRoute.mockReturnValue({
      worktreeId: 'wt-nas',
      relativePath: 'x.txt',
      executionHostId: 'local'
    })
    const filePath = '/Users/me/nas/x.txt'
    const inner = { id: 'inner', worktreeId: 'wt-nas', filePath, mode: 'edit' as const }

    setState({
      worktreesByRepo: {},
      folderWorkspaces: [],
      openFiles: [
        { id: 'outer', worktreeId: 'wt-home', filePath, mode: 'edit', isDirty: true },
        inner
      ]
    })
    expect(state.openFiles.find((file) => file.id === 'outer')?.readOnly).toBeUndefined()

    setState({
      openFiles: [
        { id: 'outer', worktreeId: 'wt-home', filePath, mode: 'edit', isDirty: false },
        inner
      ]
    })
    expect(state.openFiles.map((file) => [file.id, file.readOnly])).toEqual([
      ['outer', true],
      ['inner', undefined]
    ])
  })

  it('does not demote when the nested tab is read-only', () => {
    registerNestedCopyDemotion()
    findRoute.mockReturnValue({
      worktreeId: 'wt-nas',
      relativePath: 'x.txt',
      executionHostId: 'local'
    })
    const filePath = '/Users/me/nas/x.txt'

    setState({
      worktreesByRepo: {},
      folderWorkspaces: [],
      openFiles: [
        { id: 'outer', worktreeId: 'wt-home', filePath, mode: 'edit' },
        { id: 'inner', worktreeId: 'wt-nas', filePath, mode: 'edit', readOnly: true }
      ]
    })

    expect(state.openFiles.find((file) => file.id === 'outer')?.readOnly).toBeUndefined()
  })

  it('looks up only the path that changed', () => {
    registerNestedCopyDemotion()
    const nested = '/Users/me/nas/x.txt'
    const other = '/Users/me/other.txt'
    findRoute.mockImplementation((_state, _host, filePath: string) =>
      filePath === nested
        ? { worktreeId: 'wt-nas', relativePath: 'x.txt', executionHostId: 'local' }
        : { worktreeId: 'wt-home', relativePath: 'other.txt', executionHostId: 'local' }
    )
    setState({
      worktreesByRepo: {},
      folderWorkspaces: [],
      openFiles: [
        { id: 'other', worktreeId: 'wt-home', filePath: other, mode: 'edit' },
        { id: 'outer', worktreeId: 'wt-home', filePath: nested, mode: 'edit' }
      ]
    })
    findRoute.mockClear()

    setState({
      openFiles: [
        { id: 'other', worktreeId: 'wt-home', filePath: other, mode: 'edit' },
        { id: 'outer', worktreeId: 'wt-home', filePath: nested, mode: 'edit' },
        { id: 'inner', worktreeId: 'wt-nas', filePath: nested, mode: 'edit' }
      ]
    })

    const paths = findRoute.mock.calls.map((call) => call[2])
    expect(paths).toContain(nested)
    expect(paths).not.toContain(other)
    expect(state.openFiles.find((file) => file.id === 'outer')?.readOnly).toBe(true)
  })

  it('demotes both copies when the workspace list arrives after they are open', () => {
    registerNestedCopyDemotion()
    const filePath = '/Users/me/nas/x.txt'
    const route = { worktreeId: 'wt-nas', relativePath: 'x.txt', executionHostId: 'local' }
    findRoute.mockReturnValue(route)
    setState({
      openFiles: [
        { id: 'outer', worktreeId: 'wt-home', filePath, mode: 'edit' },
        { id: 'inner', worktreeId: 'wt-nas', filePath, mode: 'edit' }
      ]
    })
    expect(findRoute).not.toHaveBeenCalled()
    expect(state.openFiles.find((file) => file.id === 'outer')?.readOnly).toBeUndefined()

    setState({ worktreesByRepo: { 'repo-ssh': [] } })

    expect(findRoute).toHaveBeenCalled()
    expect(state.openFiles.map((file) => [file.id, file.readOnly])).toEqual([
      ['outer', true],
      ['inner', undefined]
    ])
  })

  it('demotes both copies when only the folder workspace list arrives late', () => {
    registerNestedCopyDemotion()
    const filePath = '/Users/me/nas/x.txt'
    findRoute.mockReturnValue({
      worktreeId: 'wt-nas',
      relativePath: 'x.txt',
      executionHostId: 'local'
    })
    setState({
      openFiles: [
        { id: 'outer', worktreeId: 'wt-home', filePath, mode: 'edit' },
        { id: 'inner', worktreeId: 'wt-nas', filePath, mode: 'edit' }
      ]
    })
    expect(state.openFiles.find((file) => file.id === 'outer')?.readOnly).toBeUndefined()

    setState({ folderWorkspaces: [] })

    expect(state.openFiles.find((file) => file.id === 'outer')?.readOnly).toBe(true)
  })

  it('keeps a dirty outer tab writable when the workspace list arrives, then demotes it once clean', () => {
    registerNestedCopyDemotion()
    const filePath = '/Users/me/nas/x.txt'
    const inner = { id: 'inner', worktreeId: 'wt-nas', filePath, mode: 'edit' as const }
    findRoute.mockReturnValue({
      worktreeId: 'wt-nas',
      relativePath: 'x.txt',
      executionHostId: 'local'
    })
    setState({
      openFiles: [
        { id: 'outer', worktreeId: 'wt-home', filePath, mode: 'edit', isDirty: true },
        inner
      ]
    })
    setState({ worktreesByRepo: {}, folderWorkspaces: [] })
    expect(state.openFiles.find((file) => file.id === 'outer')?.readOnly).toBeUndefined()

    setState({
      openFiles: [
        { id: 'outer', worktreeId: 'wt-home', filePath, mode: 'edit', isDirty: false },
        inner
      ]
    })
    expect(state.openFiles.find((file) => file.id === 'outer')?.readOnly).toBe(true)
  })

  it('demotes both writable copies once the workspace catalog arrives', () => {
    registerNestedCopyDemotion()
    const filePath = '/Users/me/nas/x.txt'
    const other = '/Users/me/other.txt'
    findRoute.mockImplementation((_state, _host, path: string) =>
      path === filePath
        ? { worktreeId: 'wt-nas', relativePath: 'x.txt', executionHostId: 'local' }
        : { worktreeId: 'wt-home', relativePath: 'other.txt', executionHostId: 'local' }
    )
    setState({
      openFiles: [
        { id: 'other', worktreeId: 'wt-home', filePath: other, mode: 'edit' },
        { id: 'outer', worktreeId: 'wt-home', filePath, mode: 'edit' },
        { id: 'inner', worktreeId: 'wt-nas', filePath, mode: 'edit' }
      ]
    })
    expect(state.openFiles.find((file) => file.id === 'outer')?.readOnly).toBeUndefined()
    findRoute.mockClear()

    setState({ worktreesByRepo: {}, folderWorkspaces: [] })

    const paths = findRoute.mock.calls.map((call) => call[2])
    expect(paths).toContain(filePath)
    expect(paths).toContain(other)
    expect(state.openFiles.find((file) => file.id === 'outer')?.readOnly).toBe(true)
    expect(state.openFiles.find((file) => file.id === 'inner')?.readOnly).toBeUndefined()
    expect(state.openFiles.find((file) => file.id === 'other')?.readOnly).toBeUndefined()
  })

  it('retries a path whose owner was unknown when another tab changes', () => {
    registerNestedCopyDemotion()
    const filePath = '/Users/me/nas/x.txt'
    const other = '/Users/me/other.txt'
    findRoute.mockReturnValue(null)
    setState({ worktreesByRepo: {}, folderWorkspaces: [] })
    setState({
      openFiles: [
        { id: 'outer', worktreeId: 'wt-home', filePath, mode: 'edit' },
        { id: 'inner', worktreeId: 'wt-nas', filePath, mode: 'edit' }
      ]
    })
    expect(state.openFiles.find((file) => file.id === 'outer')?.readOnly).toBeUndefined()

    findRoute.mockReturnValue({
      worktreeId: 'wt-nas',
      relativePath: 'x.txt',
      executionHostId: 'local'
    })
    findRoute.mockClear()
    setState({
      openFiles: [
        { id: 'outer', worktreeId: 'wt-home', filePath, mode: 'edit' },
        { id: 'inner', worktreeId: 'wt-nas', filePath, mode: 'edit' },
        { id: 'extra', worktreeId: 'wt-home', filePath: other, mode: 'edit' }
      ]
    })

    const paths = findRoute.mock.calls.map((call) => call[2])
    expect(paths).toContain(filePath)
    expect(state.openFiles.find((file) => file.id === 'outer')?.readOnly).toBe(true)
    expect(state.openFiles.find((file) => file.id === 'inner')?.readOnly).toBeUndefined()
  })
})
