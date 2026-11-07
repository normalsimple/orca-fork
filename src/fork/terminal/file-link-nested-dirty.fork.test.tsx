// 外层还有未保存的修改时不能改成只读：草稿留在原标签，保存之后才降级。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { needsSavePromptOnClose } from '@/store/slices/editor/buffers/editor-buffer-close-rule'
import type { OpenFile } from '@/store/slices/editor/types/open-file'
import { TEST_REPO } from '@/store/repos/repo.test-fixture'
import { makeWorktree } from '@/store/slices/worktrees/worktree.test-fixture'
import {
  registerNestedCopyDemotion,
  resetNestedCopyDemotionForTests
} from './file-link-nested-demotion'

vi.mock('sonner', () => ({
  toast: { error: vi.fn() }
}))

const FILE = '/Users/me/nas/x.txt'

function tab(id: string, worktreeId: string, patch: Partial<OpenFile> = {}): OpenFile {
  return {
    id,
    filePath: FILE,
    relativePath: worktreeId === 'wt-nas' ? 'x.txt' : 'nas/x.txt',
    worktreeId,
    language: 'plaintext',
    isDirty: false,
    mode: 'edit',
    lastKnownDiskSignature: 'sig-base',
    ...patch
  }
}

const state = () => useAppStore.getState()
const view = (id: string) => state().openFiles.find((file) => file.id === id)

describe('nested demotion keeps unsaved edits', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    storage.clear()
    resetNestedCopyDemotionForTests()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value)
        },
        removeItem: (key: string) => {
          storage.delete(key)
        }
      }
    })
    useAppStore.setState(useAppStore.getInitialState(), true)
    useAppStore.setState({
      repos: [
        {
          ...TEST_REPO,
          id: 'repo-1',
          path: '/Users/me',
          connectionId: null,
          executionHostId: 'local'
        }
      ],
      worktreesByRepo: {
        'repo-1': [
          makeWorktree({ id: 'wt-home', repoId: 'repo-1', path: '/Users/me', hostId: 'local' }),
          makeWorktree({ id: 'wt-nas', repoId: 'repo-1', path: '/Users/me/nas', hostId: 'local' })
        ]
      },
      folderWorkspaces: []
    })
    registerNestedCopyDemotion()
  })

  it('keeps a dirty outer tab writable, then demotes it after the edits are saved', () => {
    useAppStore.setState({
      openFiles: [tab('outer', 'wt-home', { isDirty: true })],
      editorDrafts: { outer: 'keep me' }
    })
    useAppStore.setState((current) => ({
      openFiles: [...current.openFiles, tab('inner', 'wt-nas')]
    }))

    expect(view('outer')?.readOnly).toBeUndefined()
    expect(view('outer')?.isDirty).toBe(true)
    expect(Object.values(state().editorDrafts)).toContain('keep me')
    expect(view('inner')?.readOnly).toBeUndefined()

    state().markFileDirty('outer', false)
    state().clearEditorDraft('outer')

    expect(view('outer')?.readOnly).toBe(true)
    expect(view('outer')?.isDirty).toBe(false)
    expect(state().editorDrafts.outer).toBeUndefined()
    expect(state().editorDrafts.inner).toBeUndefined()
    expect(view('inner')?.readOnly).toBeUndefined()
  })

  it('still asks to save when closing the dirty inner tab of a separate buffer', () => {
    useAppStore.setState({
      openFiles: [
        tab('outer', 'wt-home', { isDirty: true }),
        tab('inner', 'wt-nas', { isDirty: true })
      ],
      editorDrafts: { outer: 'outer edits', inner: 'inner edits' }
    })

    expect(view('outer')?.readOnly).toBeUndefined()
    expect(state().editorDrafts.outer).toBe('outer edits')
    expect(state().editorDrafts.inner).toBe('inner edits')
    expect(state().editorBufferIdOf.inner).not.toBe(state().editorBufferIdOf.outer)
    expect(needsSavePromptOnClose(state(), 'inner')).toBe(true)
    expect(needsSavePromptOnClose(state(), 'outer')).toBe(true)
  })

  it('keeps the shared draft saveable after the inner tab closes', () => {
    useAppStore.setState({
      openFiles: [tab('outer', 'wt-home', { isDirty: true })],
      editorDrafts: { outer: 'keep me' }
    })
    useAppStore.setState((current) => ({
      openFiles: [...current.openFiles, tab('inner', 'wt-nas')]
    }))

    expect(state().editorBufferIdOf.inner).toBe(state().editorBufferIdOf.outer)
    expect(needsSavePromptOnClose(state(), 'inner')).toBe(false)
    state().closeFile('inner')

    expect(view('outer')?.readOnly).toBeUndefined()
    expect(view('outer')?.isDirty).toBe(true)
    expect(state().editorDrafts.outer).toBe('keep me')
    expect(needsSavePromptOnClose(state(), 'outer')).toBe(true)
  })
})
