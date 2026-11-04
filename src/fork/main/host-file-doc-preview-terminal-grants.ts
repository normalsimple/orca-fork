// F046: how a host before files.hostDocPreview.* serves a doc preview outside its worktree: one
// terminal grant per file (files.resolveTerminalPath, then files.readTerminalArtifactPreview),
// 512 KiB of text, no fonts.
import type { HostFileDocPreviewOutcome } from '../../shared/fork-hooks/host-file-doc-preview'
import { resolveCanonicalDocPreviewPath } from '../../main/browser/document-preview/doc-preview-grant-registry'
import {
  callHost,
  MissingHostFile,
  toOutcome,
  type OutsideDocument
} from './host-file-doc-preview-host-call'

function hostCanonicalPath(resolution: unknown): string | null {
  if (typeof resolution !== 'object' || resolution === null) {
    return null
  }
  const fields: Partial<Record<'exists' | 'absolutePath', unknown>> = resolution
  return fields.exists === true && typeof fields.absolutePath === 'string'
    ? fields.absolutePath
    : null
}

function hostGrant(resolution: unknown): { absolutePath: string; grantId: string } | null {
  if (typeof resolution !== 'object' || resolution === null) {
    return null
  }
  const { openTarget }: Partial<Record<'openTarget', unknown>> = resolution
  if (typeof openTarget !== 'object' || openTarget === null) {
    return null
  }
  const target: Partial<Record<'kind' | 'absolutePath' | 'grantId', unknown>> = openTarget
  return target.kind === 'absolute-file' &&
    typeof target.absolutePath === 'string' &&
    typeof target.grantId === 'string'
    ? { absolutePath: target.absolutePath, grantId: target.grantId }
    : null
}

export async function readThroughTerminalGrants(
  document: OutsideDocument,
  absolutePath: string,
  contentType: string
): Promise<HostFileDocPreviewOutcome> {
  const resolutions = new Map<string, Promise<unknown>>()
  const resolve = (path: string): Promise<unknown> => {
    let pending = resolutions.get(path)
    if (!pending) {
      pending = callHost(document.owner, 'files.resolveTerminalPath', { pathText: path })
      resolutions.set(path, pending)
    }
    return pending
  }
  // Why canonical on the host: the registry checks the resolved path against the grant's roots.
  const canonical = await resolveCanonicalDocPreviewPath(
    document.grant,
    absolutePath,
    async (path) => {
      const hostPath = hostCanonicalPath(await resolve(path))
      if (!hostPath) {
        throw new Error('Not found')
      }
      return hostPath
    }
  )
  const granted = canonical ? hostGrant(await resolve(absolutePath)) : null
  if (!granted) {
    throw new MissingHostFile('Not found')
  }
  return toOutcome(
    await callHost(document.owner, 'files.readTerminalArtifactPreview', granted),
    contentType
  )
}
