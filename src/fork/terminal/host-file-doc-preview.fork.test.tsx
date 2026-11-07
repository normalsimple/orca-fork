// F046: a server document outside the clicked workspace is previewable: outside every workspace its
// grant is rooted at the host's filesystem root, so the page resolves paths as from file://; inside
// another workspace at that workspace. Images it names are read from the host through grants.
import { describe, expect, it, vi } from 'vitest'
import { getWorkspaceFilePreviewPlan } from '@/lib/file-preview'
import { buildDocPreviewGrantRequest } from '@/lib/doc-preview-grants'
import { readRuntimeFilePreview } from '@/runtime/files/reads/runtime-file-read-client'
import {
  fsReadFile,
  installRuntimeFileClientEnvironment,
  runtimeEnvironmentCall
} from '@/runtime/files/runtime-file-client-test-harness'
import { registerHostFileDocPreviews } from './host-file-doc-preview'
import { registerLargeHostFileReads } from './large-host-file-read'

vi.mock('@/store', () => ({ useAppStore: { getState: () => state } }))
vi.mock('@/lib/connection-owner-resolution', () => ({
  getConnectionIdForFileFromState: () => null
}))
vi.mock('@/lib/workspace/ownership/worktree-runtime-owner', () => ({
  runtimeEnvironmentIdOrLocalUnlessTwin: () => 'env-1'
}))

installRuntimeFileClientEnvironment()

const WORKTREE = '/srv/app'
const LIBRARY = '/srv/lib'
const PAGES = '/home/me/.answer-me-with-html/pages'
const REPORT = `${PAGES}/report.html`
const NOTES = '/home/me/notes/plan.md'
const IMAGE = '/home/me/notes/img/chart.png'
const worktrees = [
  { id: 'wt-1', repoId: 'repo-1', path: WORKTREE, hostId: 'runtime:env-1' },
  { id: 'wt-lib', repoId: 'repo-1', path: LIBRARY, hostId: 'runtime:env-1' }
]
const state = {
  repos: [{ id: 'repo-1', path: WORKTREE, connectionId: null, executionHostId: 'runtime:env-1' }],
  worktreesByRepo: { 'repo-1': worktrees },
  folderWorkspaces: [],
  projectGroups: [],
  getKnownWorktreeById: (id: string) => worktrees.find((worktree) => worktree.id === id)
} as never

const imageContext = {
  target: { kind: 'environment' as const, environmentId: 'env-1' },
  worktreeId: 'wt-1',
  worktreePath: WORKTREE
}
const imageAccess = { kind: 'document-resource' as const, documentPath: NOTES }
const preview = { content: 'iVBO', isBinary: true, isImage: true, mimeType: 'image/png' }

function serveImageThroughGrant(): void {
  const meta = { runtimeId: 'remote-runtime' }
  runtimeEnvironmentCall.mockImplementation((args: { method: string }) =>
    Promise.resolve(
      args.method === 'files.resolveTerminalPath'
        ? {
            id: 'resolve',
            ok: true,
            result: {
              exists: true,
              openTarget: { kind: 'absolute-file', absolutePath: IMAGE, grantId: 'g-img' }
            },
            _meta: meta
          }
        : args.method === 'files.readTerminalArtifact'
          ? { id: 'read', ok: false, error: { code: 'runtime_error', message: 'binary_file' } }
          : { id: 'preview', ok: true, result: preview, _meta: meta }
    )
  )
}

describe('before the fork registers', () => {
  it('keeps upstream: a terminal-artifact preview grant, and no outside image read', async () => {
    expect(getWorkspaceFilePreviewPlan(state, 'wt-1', REPORT)).toEqual({ status: 'doc-preview' })
    expect(buildDocPreviewGrantRequest(state, 'wt-1', REPORT)).toEqual({
      owner: {
        kind: 'runtime',
        environmentId: 'env-1',
        worktreeSelector: 'id:wt-1',
        worktreeRoot: WORKTREE,
        fileAccess: 'terminal-artifact'
      },
      requestBase: PAGES,
      root: PAGES,
      entryRelativePath: 'report.html'
    })
    await expect(readRuntimeFilePreview(imageContext, IMAGE, imageAccess)).rejects.toThrow(
      'Remote file is outside the owning runtime worktree'
    )
    expect(runtimeEnvironmentCall).not.toHaveBeenCalled()
  })
})

describe('a server document outside the clicked workspace', () => {
  it('plans a doc preview whose grant is rooted at the filesystem root', () => {
    registerHostFileDocPreviews()

    expect(getWorkspaceFilePreviewPlan(state, 'wt-1', REPORT)).toEqual({ status: 'doc-preview' })
    expect(buildDocPreviewGrantRequest(state, 'wt-1', REPORT)).toEqual({
      owner: {
        kind: 'runtime',
        environmentId: 'env-1',
        worktreeSelector: 'id:wt-1',
        worktreeRoot: WORKTREE
      },
      requestBase: '/',
      root: PAGES,
      entryRelativePath: REPORT.slice(1)
    })
  })

  it('spells the entry the way the preview URLs come back, on any host path form', () => {
    registerHostFileDocPreviews()
    const locate = (filePath: string) => buildDocPreviewGrantRequest(state, 'wt-1', filePath)

    expect(locate('/home/me//pages/report.html')).toMatchObject({
      requestBase: '/',
      entryRelativePath: 'home/me/pages/report.html'
    })
    expect(locate('C:\\Users\\me\\pages\\report.html')).toMatchObject({
      requestBase: 'C:\\',
      entryRelativePath: 'Users/me/pages/report.html'
    })
    expect(locate('C:\\report.html')).toMatchObject({
      requestBase: 'C:\\',
      root: 'C:\\',
      entryRelativePath: 'report.html'
    })
    // A share has no filesystem root to hang from: the document's folder stands in, as before.
    expect(locate('//srv/share/report.html')).toMatchObject({
      requestBase: '//srv/share',
      root: '//srv/share',
      entryRelativePath: 'report.html'
    })
  })

  it('still serves a workspace document through upstream files.readDocPreview', () => {
    registerHostFileDocPreviews()

    const location = buildDocPreviewGrantRequest(state, 'wt-1', `${WORKTREE}/docs/a.html`)
    expect(location).toMatchObject({ requestBase: WORKTREE, entryRelativePath: 'docs/a.html' })
  })

  it('reads a document another workspace holds through that workspace', () => {
    registerHostFileDocPreviews()

    expect(buildDocPreviewGrantRequest(state, 'wt-1', `${LIBRARY}/docs/b.html`)).toEqual({
      owner: {
        kind: 'runtime',
        environmentId: 'env-1',
        worktreeSelector: 'id:wt-lib',
        worktreeRoot: LIBRARY
      },
      requestBase: LIBRARY,
      root: `${LIBRARY}/docs`,
      entryRelativePath: 'docs/b.html'
    })
  })

  it('reads an image a Markdown file outside the workspace names through a host grant', async () => {
    registerHostFileDocPreviews()
    serveImageThroughGrant()

    await expect(readRuntimeFilePreview(imageContext, IMAGE, imageAccess)).resolves.toEqual({
      ...preview,
      readOnly: true,
      terminalArtifactGrantId: 'g-img'
    })
    expect(runtimeEnvironmentCall).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'files.readTerminalArtifactPreview',
        params: { worktree: 'id:wt-1', grantId: 'g-img', absolutePath: IMAGE }
      })
    )
    expect(fsReadFile).not.toHaveBeenCalled()
  })

  it('pages an image past the grant preview reply through the host reads', async () => {
    registerHostFileDocPreviews()
    registerLargeHostFileReads()
    const image = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(9000, 7)])
    const meta = { runtimeId: 'remote-runtime' }
    runtimeEnvironmentCall.mockImplementation((args: { method: string; params?: unknown }) => {
      const params: Partial<Record<'offset' | 'length', unknown>> =
        typeof args.params === 'object' && args.params !== null ? args.params : {}
      if (args.method === 'files.resolveTerminalPath') {
        return Promise.resolve({
          id: 'resolve',
          ok: true,
          result: {
            exists: true,
            openTarget: { kind: 'absolute-file', absolutePath: IMAGE, grantId: 'g-img' }
          },
          _meta: meta
        })
      }
      if (args.method === 'files.hostFile.stat') {
        const stat = { size: image.length, isDirectory: false, mtime: 1, ctime: 1, fileId: '1:2' }
        return Promise.resolve({ id: 'stat', ok: true, result: stat, _meta: meta })
      }
      if (args.method === 'files.hostFile.readChunk') {
        const offset = Number(params.offset)
        const slice = image.subarray(offset, offset + Number(params.length))
        const chunk = {
          contentBase64: slice.toString('base64'),
          bytesRead: slice.length,
          eof: offset + slice.length >= image.length
        }
        return Promise.resolve({ id: 'chunk', ok: true, result: chunk, _meta: meta })
      }
      const message =
        args.method === 'files.readTerminalArtifact' ? 'binary_file' : 'file_too_large'
      return Promise.resolve({ id: 'read', ok: false, error: { code: 'runtime_error', message } })
    })

    await expect(readRuntimeFilePreview(imageContext, IMAGE, imageAccess)).resolves.toEqual({
      content: image.toString('base64'),
      isBinary: true,
      isImage: true,
      mimeType: 'image/png',
      readOnly: true,
      terminalArtifactGrantId: 'g-img'
    })
  })
})
