// @vitest-environment happy-dom
// F046: restoring an absolute server path follows upstream even when an older build saved it read-only.
// Tabs this layer marked read-only lose that flag when another workspace holds the path.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@/store/slices/editor'
import {
  useEditorPanelFileContentLoader,
  type EditorPanelFileContentLoader
} from '@/components/editor/useEditorPanelFileContentLoader'
import {
  registerKeptHostFileViewHooks,
  releaseStaleKeptHostFileReadOnly
} from './kept-host-file-view'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../shared/constants'

const mocks = vi.hoisted(() => ({
  findWorkspaceFileRoute: vi.fn(),
  migrateRestoredEditorFileOwner: vi.fn(),
  readEditorCsvFileContent: vi.fn(),
  getState: vi.fn()
}))

vi.mock('@/lib/connection-context', () => ({
  getConnectionIdForFile: vi.fn(() => null),
  getConnectionIdFromState: vi.fn(() => null),
  isWorktreeConnectionResolved: vi.fn(() => true)
}))
vi.mock('@/runtime/runtime-terminal-artifact-grant', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, hostOpensGrantedFilesInPlace: vi.fn(async () => false) }
})
vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (select: (state: ReturnType<typeof mocks.getState>) => unknown) => select(mocks.getState()),
    { getState: mocks.getState }
  )
}))
vi.mock('@/lib/file-owner-runtime-target', () => {
  const target = (runtimeEnvironmentId?: string | null) =>
    runtimeEnvironmentId
      ? { kind: 'environment' as const, environmentId: runtimeEnvironmentId }
      : { kind: 'local' as const }
  return {
    getRuntimeTargetForFileOwner: (_s: unknown, _w: unknown, id?: string | null) => target(id),
    requireRuntimeTargetForFileOwner: (_s: unknown, _w: unknown, id?: string | null) => target(id),
    getRuntimeTargetForWorktreeOwner: () => target()
  }
})
vi.mock('@/lib/runtime-workspace-file-route', () => ({
  findWorkspaceFileRoute: mocks.findWorkspaceFileRoute
}))
vi.mock('@/components/editor/migrate-restored-editor-file-owner', () => ({
  migrateRestoredEditorFileOwner: mocks.migrateRestoredEditorFileOwner
}))
vi.mock('@/components/editor/restored-editor-workspace-runtime-owner', () => ({
  findRestoredEditorWorkspaceRuntimeOwner: () => null
}))
vi.mock('@/components/editor/csv/csv-file-content', () => ({
  readEditorCsvFileContent: mocks.readEditorCsvFileContent
}))

registerKeptHostFileViewHooks()

const CLICKED = 'wt-feat'
const SHARED = '/srv/wt/lib/main/src/index.ts'
const OWNER = {
  worktreeId: 'wt-lib',
  relativePath: 'src/index.ts',
  executionHostId: 'runtime:env-1'
}

function serverTab(overrides: Partial<OpenFile>): OpenFile {
  return {
    id: `${CLICKED}::${SHARED}`,
    filePath: SHARED,
    relativePath: SHARED,
    worktreeId: CLICKED,
    runtimeEnvironmentId: 'env-1',
    language: 'typescript',
    isDirty: false,
    mode: 'edit',
    ...overrides
  }
}

describe('editor load of a server file another workspace holds', () => {
  let container: HTMLDivElement
  let root: Root
  let load: EditorPanelFileContentLoader | null
  let openFiles: OpenFile[]

  beforeEach(() => {
    openFiles = []
    load = null
    mocks.findWorkspaceFileRoute.mockReset().mockReturnValue(OWNER)
    mocks.migrateRestoredEditorFileOwner.mockReset().mockResolvedValue({ ok: true })
    mocks.readEditorCsvFileContent.mockReset().mockResolvedValue({ content: '', isBinary: false })
    mocks.getState.mockReset().mockReturnValue({
      settings: {},
      openFiles: [],
      editorDrafts: {},
      setCsvPreviewOnly: vi.fn()
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    function LoaderHarness(): null {
      load = useEditorPanelFileContentLoader({
        fileLoadRetryAttemptsRef: { current: {} },
        fileReadGenerationCounterRef: { current: 0 },
        fileReadGenerationRef: { current: {} },
        openFilesRef: {
          get current() {
            return openFiles
          }
        },
        outstandingFileReadsRef: { current: {} },
        setFileContents: () => {}
      })
      return null
    }
    act(() => root.render(<LoaderHarness />))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('re-owns a restored absolute tab another workspace holds even when it was saved read-only', async () => {
    const tab = serverTab({ readOnly: true })
    openFiles = [tab]

    await act(async () => load!(SHARED, tab.id, CLICKED, SHARED))

    expect(mocks.migrateRestoredEditorFileOwner).toHaveBeenCalledWith(tab.id, OWNER, 'env-1')
    expect(mocks.readEditorCsvFileContent).not.toHaveBeenCalled()
  })
})

describe('a read-only tab saved by the removed cross-workspace view', () => {
  function tab(overrides: Partial<OpenFile>): OpenFile {
    return serverTab({ readOnly: true, ...overrides })
  }

  function released(files: OpenFile[], holder: string | null): OpenFile[] | null {
    return releaseStaleKeptHostFileReadOnly(files, () => holder)
  }

  it('drops the stale flag when another workspace holds the path', () => {
    const stale = tab({})
    const nested = tab({
      id: 'nested',
      filePath: SHARED,
      relativePath: 'src/index.ts'
    })

    const next = released([stale, nested], 'wt-lib')

    expect(next?.[0]).not.toHaveProperty('readOnly')
    expect(next?.[0]).toMatchObject({ filePath: SHARED, relativePath: SHARED, worktreeId: CLICKED })
    expect(next?.[1]).toMatchObject({ id: 'nested', readOnly: true, relativePath: 'src/index.ts' })
  })

  it('leaves a file no other workspace holds, a live tail, a grant, and a floating tab', () => {
    const outside = tab({})
    const tail = tab({ liveTail: true })
    const granted = tab({ terminalArtifactGrantId: 'g-1' })
    const floating = tab({ worktreeId: FLOATING_TERMINAL_WORKTREE_ID })

    expect(released([outside], null)).toBeNull()
    expect(released([outside], CLICKED)).toBeNull()
    expect(released([tail, granted, floating], 'wt-lib')).toBeNull()
  })

  it('does not clear a tab again after nested demotion puts the flag back', () => {
    const stale = tab({})
    const once = releaseStaleKeptHostFileReadOnly([stale], () => 'wt-lib')
    const demoted = { ...stale, readOnly: true as const }

    expect(
      releaseStaleKeptHostFileReadOnly([demoted], () => 'wt-lib', new Set([stale.id]))
    ).toBeNull()
    expect(once?.[0]).not.toHaveProperty('readOnly')
  })
})
