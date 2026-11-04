// F046: a terminal or chat link to a server file another workspace holds, or no workspace holds,
// opens in the clicked workspace: source read-only through a host grant, HTML in the doc preview.
import { describe, expect, it, vi } from 'vitest'
import { openDetectedFilePath } from '@/components/terminal-pane/terminal-file-open-routing'
import { createTerminalLinkTestDoubles } from '@/components/terminal-pane/terminal-link-handlers-test-fixtures'
import {
  flushDoubleRaf,
  installTerminalLinkTestEnvironment
} from '@/components/terminal-pane/terminal-link-handlers-test-harness'
import * as filePreview from '@/lib/file-preview'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import {
  createCompatibleRuntimeStatusResponseIfNeeded,
  type RuntimeEnvironmentCallRequest
} from '@/runtime/runtime-compatibility-test-fixture'
import { TERMINAL_PATH_ABSOLUTE_FILES_RUNTIME_CAPABILITY } from '../../shared/runtime-file-contracts'
import { registerHostFileDocPreviews } from './host-file-doc-preview'
import { registerKeptHostFileViewHooks } from './kept-host-file-view'

const doubles = createTerminalLinkTestDoubles()
const { openFileMock, runtimeEnvironmentCallMock, runtimeEnvironmentTransportCallMock } = doubles

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => doubles.storeState
  }
}))
vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorkspace: vi.fn(),
  activateAndRevealWorktree: vi.fn()
}))
vi.mock('@/lib/connection-context', () => ({
  getConnectionId: vi.fn(() => null)
}))
vi.mock('@/components/terminal-pane/terminal-remote-file-download-open', () => ({
  downloadAndOpenRemoteTerminalFile: vi.fn()
}))

installTerminalLinkTestEnvironment(doubles)
registerHostFileDocPreviews()
registerKeptHostFileViewHooks()

const clicked = {
  worktreeId: 'wt-feat',
  worktreePath: '/srv/wt/app/feature',
  runtimeEnvironmentId: 'env-1'
}
const SHARED = '/srv/wt/lib/main/src/index.ts'

type ResolveParams = { pathText: string; crossWorkspace?: boolean }

/** The host answers both lookups: the owning workspace first, then the grant for this one. */
function hostHolds(owner: { worktree: string; relativePath: string }, absolutePath: string): void {
  runtimeEnvironmentCallMock.mockImplementation(
    (args: { method: string; params: ResolveParams }) => {
      if (args.method !== 'files.resolveTerminalPath') {
        return Promise.reject(new Error(`unexpected ${args.method}`))
      }
      const result = args.params.crossWorkspace
        ? { ...owner, absolutePath, exists: true, isDirectory: false }
        : {
            worktree: clicked.worktreeId,
            relativePath: null,
            absolutePath,
            exists: true,
            isDirectory: false,
            openTarget: { kind: 'absolute-file', provider: 'local', absolutePath, grantId: 'g-1' }
          }
      return Promise.resolve({ id: 'rpc', ok: true, result, _meta: { runtimeId: 'remote' } })
    }
  )
}

function previewPlanned() {
  const plan = { status: 'doc-preview' } as const
  return {
    plan: vi.spyOn(filePreview, 'getWorkspaceFilePreviewPlan').mockReturnValue(plan),
    open: vi.spyOn(filePreview, 'openFileInBrowserTab').mockReturnValue(plan)
  }
}

describe('a server file another workspace holds', () => {
  it('opens read-only in the clicked workspace through a grant, without switching', async () => {
    hostHolds({ worktree: 'wt-lib', relativePath: 'src/index.ts' }, SHARED)

    openDetectedFilePath(SHARED, 12, null, clicked)
    await flushDoubleRaf()

    expect(runtimeEnvironmentCallMock.mock.calls.map((call) => call[0].params)).toEqual([
      { worktree: 'id:wt-feat', pathText: SHARED, crossWorkspace: true },
      // 上游先在当前工作区探一次授权；探不到能直接打开的授权时，fork 再要只读授权。
      { worktree: 'id:wt-feat', pathText: SHARED },
      { worktree: 'id:wt-feat', pathText: SHARED }
    ])
    expect(activateAndRevealWorkspace).toHaveBeenCalledWith('wt-feat', {
      providesInitialSurface: true,
      executionHostId: 'runtime:env-1'
    })
    expect(activateAndRevealWorkspace).not.toHaveBeenCalledWith('wt-lib', expect.anything())
    expect(openFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: SHARED,
        relativePath: SHARED,
        worktreeId: 'wt-feat',
        runtimeEnvironmentId: 'env-1',
        terminalArtifactGrantId: 'g-1',
        readOnly: true
      }),
      { forceContentReload: true }
    )
  })

  it('renders its HTML in the clicked workspace doc preview', async () => {
    const report = '/srv/wt/lib/main/docs/report.html'
    hostHolds({ worktree: 'wt-lib', relativePath: 'docs/report.html' }, report)
    const { plan, open } = previewPlanned()
    try {
      openDetectedFilePath(report, null, null, clicked)
      await flushDoubleRaf()

      expect(plan).toHaveBeenCalledWith(expect.anything(), 'wt-feat', report)
      expect(open).toHaveBeenCalledWith({ filePath: report, worktreeId: 'wt-feat' })
      expect(openFileMock).not.toHaveBeenCalled()
      expect(activateAndRevealWorkspace).not.toHaveBeenCalledWith('wt-lib', expect.anything())
    } finally {
      plan.mockRestore()
      open.mockRestore()
    }
  })

  it('still switches to the owner when the host grants only what its terminals printed', async () => {
    runtimeEnvironmentTransportCallMock.mockImplementation(
      (args: RuntimeEnvironmentCallRequest) => {
        const status = createCompatibleRuntimeStatusResponseIfNeeded(args)
        if (!status?.ok) {
          return runtimeEnvironmentCallMock(args)
        }
        const capabilities = status.result.capabilities?.filter(
          (capability) => capability !== TERMINAL_PATH_ABSOLUTE_FILES_RUNTIME_CAPABILITY
        )
        return { ...status, result: { ...status.result, capabilities } }
      }
    )
    runtimeEnvironmentCallMock.mockImplementation(
      (args: { method: string; params: ResolveParams }) =>
        Promise.resolve({
          id: 'rpc',
          ok: true,
          result: args.params.crossWorkspace
            ? {
                worktree: 'wt-lib',
                relativePath: 'src/index.ts',
                absolutePath: SHARED,
                exists: true,
                isDirectory: false
              }
            : {
                worktree: clicked.worktreeId,
                relativePath: null,
                absolutePath: null,
                exists: false,
                isDirectory: false
              },
          _meta: { runtimeId: 'remote' }
        })
    )

    openDetectedFilePath(SHARED, null, null, clicked)
    await flushDoubleRaf()

    expect(activateAndRevealWorkspace).toHaveBeenCalledWith('wt-lib', {
      providesInitialSurface: true,
      executionHostId: 'runtime:env-1'
    })
    expect(openFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: 'src/index.ts', worktreeId: 'wt-lib' }),
      { forceContentReload: true }
    )
  })
})

describe('a server HTML file no workspace holds', () => {
  it('renders in the clicked workspace doc preview instead of the editor', async () => {
    const page = '/home/me/.answer-me-with-html/pages/report.html'
    runtimeEnvironmentCallMock.mockResolvedValue({
      id: 'rpc',
      ok: true,
      result: {
        worktree: clicked.worktreeId,
        relativePath: null,
        absolutePath: page,
        exists: true,
        isDirectory: false,
        openTarget: { kind: 'absolute-file', provider: 'local', absolutePath: page, grantId: 'g-2' }
      },
      _meta: { runtimeId: 'remote' }
    })
    const { plan, open } = previewPlanned()
    try {
      openDetectedFilePath(page, null, null, clicked)
      await flushDoubleRaf()

      expect(open).toHaveBeenCalledWith({ filePath: page, worktreeId: 'wt-feat' })
      expect(openFileMock).not.toHaveBeenCalled()
    } finally {
      plan.mockRestore()
      open.mockRestore()
    }
  })
})
