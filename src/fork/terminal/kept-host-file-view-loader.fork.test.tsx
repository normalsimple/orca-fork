// @vitest-environment happy-dom
// F046: a kept view stays in the clicked workspace when the editor loads it; upstream would re-own
// any absolute server path into the workspace that holds it.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@/store/slices/editor'
import {
  useEditorPanelFileContentLoader,
  type EditorPanelFileContentLoader
} from '@/components/editor/useEditorPanelFileContentLoader'
import { registerKeptHostFileViewHooks } from './kept-host-file-view'

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

  it('reads a kept read-only view from the clicked workspace instead of moving it', async () => {
    const tab = serverTab({ readOnly: true, terminalArtifactGrantId: 'g-1' })
    openFiles = [tab]

    await act(async () => load!(SHARED, tab.id, CLICKED, SHARED))

    expect(mocks.migrateRestoredEditorFileOwner).not.toHaveBeenCalled()
    expect(mocks.readEditorCsvFileContent).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: 'environment', environmentId: 'env-1' },
        filePath: SHARED,
        relativePath: SHARED,
        worktreeId: CLICKED,
        terminalArtifactGrantId: 'g-1'
      }),
      expect.anything()
    )
  })

  it('still re-owns a writable absolute tab into the workspace that holds it', async () => {
    const tab = serverTab({})
    openFiles = [tab]

    await act(async () => load!(SHARED, tab.id, CLICKED, SHARED))

    expect(mocks.migrateRestoredEditorFileOwner).toHaveBeenCalledWith(tab.id, OWNER, 'env-1')
    expect(mocks.readEditorCsvFileContent).not.toHaveBeenCalled()
  })
})
