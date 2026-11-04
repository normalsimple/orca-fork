// F046: a doc preview whose document lies outside its runtime worktree. Its grant is rooted at the
// host's filesystem root, so the page resolves paths as it would from file:// (F051 lets it read
// them all). The host reads each file by absolute path (files.hostDocPreview.*, ranged past one
// reply); a host without those methods serves it through terminal grants.
import { posix, win32 } from 'node:path'
import { isBinaryBuffer } from '../../shared/binary-buffer'
import { isWindowsAbsolutePathLike } from '../../shared/cross-platform-path'
import {
  DOC_PREVIEW_FILE_CHANGED_MESSAGE,
  type DocPreviewFileChunk
} from '../../shared/doc-preview-file-access'
import {
  HOST_DOC_PREVIEW_READ_CHUNK_METHOD,
  HOST_DOC_PREVIEW_READ_METHOD,
  type HostFileDocPreviewOutcome
} from '../../shared/fork-hooks/host-file-doc-preview'
import {
  getDocPreviewGrant,
  resolveDocPreviewAuthorityPaths,
  toRuntimeWorktreeRelativePath,
  type DocPreviewGrant
} from '../../main/browser/document-preview/doc-preview-grant-registry'
import type { HostDocPreviewReadParams } from './host-file-methods'
import {
  callHost,
  isMissing,
  isMissingMethod,
  isTooLarge,
  notFound,
  toOutcome,
  TOO_LARGE,
  TOO_LARGE_ERROR,
  UNSUPPORTED,
  type OutsideDocument
} from './host-file-doc-preview-host-call'
import { readThroughTerminalGrants } from './host-file-doc-preview-terminal-grants'

// Why: under the chunk method's 512 KiB cap, and a multiple of 3 so its base64 has no padding.
const CHUNK_BYTES = 384 * 1024

/** A grant minted for a document outside its runtime worktree, else null. */
function outsideWorkspaceDocument(grant: DocPreviewGrant | null): OutsideDocument | null {
  if (!grant || grant.owner.kind !== 'runtime') {
    return null
  }
  const entryPath = resolveDocPreviewAuthorityPaths(grant).entryPath
  return entryPath && toRuntimeWorktreeRelativePath(grant.owner.worktreeRoot, entryPath) === null
    ? { grant, owner: grant.owner, entryPath }
    : null
}

function isDocPreviewFileChunk(value: unknown): value is DocPreviewFileChunk {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const chunk: Partial<Record<keyof DocPreviewFileChunk, unknown>> = value
  return (
    typeof chunk.contentBase64 === 'string' &&
    typeof chunk.size === 'number' &&
    typeof chunk.mtimeMs === 'number' &&
    typeof chunk.ctimeMs === 'number' &&
    (chunk.mimeType === undefined || typeof chunk.mimeType === 'string')
  )
}

/** As upstream's ranged doc-preview read: every chunk must report the version the first one opened. */
async function readInChunks(
  document: OutsideDocument,
  params: Omit<HostDocPreviewReadParams, 'worktree'>
): Promise<{ bytes: Buffer; mimeType?: string }> {
  const chunks: Buffer[] = []
  let first: DocPreviewFileChunk | null = null
  let offset = 0
  do {
    // Why: a closed preview revokes its grant; stop paging a file nobody will see.
    if (!getDocPreviewGrant(document.grant.id)) {
      throw new Error('Not found')
    }
    let chunk: unknown
    try {
      chunk = await callHost(document.owner, HOST_DOC_PREVIEW_READ_CHUNK_METHOD, {
        ...params,
        offset,
        length: CHUNK_BYTES
      })
    } catch (error) {
      throw isMissingMethod(error) ? new Error(TOO_LARGE_ERROR) : error
    }
    if (!isDocPreviewFileChunk(chunk)) {
      throw new Error('The paired machine returned an unreadable file chunk.')
    }
    first ??= chunk
    const bytes = Buffer.from(chunk.contentBase64, 'base64')
    if (
      bytes.length === 0 ||
      offset + bytes.length > first.size ||
      chunk.size !== first.size ||
      chunk.mtimeMs !== first.mtimeMs ||
      chunk.ctimeMs !== first.ctimeMs
    ) {
      throw new Error(DOC_PREVIEW_FILE_CHANGED_MESSAGE)
    }
    chunks.push(bytes)
    offset += bytes.length
  } while (offset < first.size)
  return { bytes: Buffer.concat(chunks), mimeType: first.mimeType }
}

/** Null when the host predates files.hostDocPreview.*. */
async function readByHostPath(
  document: OutsideDocument,
  absolutePath: string,
  contentType: string
): Promise<HostFileDocPreviewOutcome | null> {
  const authority = resolveDocPreviewAuthorityPaths(document.grant)
  const params = {
    boundaryPath: document.grant.requestBase,
    entryPath: document.entryPath,
    implicitRootPath: authority.implicitRootPath,
    authorizedRootPaths: authority.authorizedRootPaths,
    targetPath: absolutePath
  }
  try {
    return toOutcome(
      await callHost(document.owner, HOST_DOC_PREVIEW_READ_METHOD, params),
      contentType
    )
  } catch (error) {
    if (isMissingMethod(error)) {
      return null
    }
    if (!isTooLarge(error)) {
      throw error
    }
  }
  const paged = await readInChunks(document, params)
  // The sniff the host applies to a whole text read.
  return !paged.mimeType && isBinaryBuffer(paged.bytes)
    ? UNSUPPORTED
    : { ok: true, bytes: paged.bytes, contentType }
}

async function readOutsideFile(
  document: OutsideDocument,
  absolutePath: string,
  contentType: string
): Promise<{ outcome: HostFileDocPreviewOutcome; missing: boolean }> {
  try {
    const outcome =
      (await readByHostPath(document, absolutePath, contentType)) ??
      (await readThroughTerminalGrants(document, absolutePath, contentType))
    return { outcome, missing: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : undefined
    if (message === TOO_LARGE_ERROR) {
      return { outcome: TOO_LARGE, missing: false }
    }
    if (message === 'binary_file') {
      return { outcome: UNSUPPORTED, missing: false }
    }
    return { outcome: notFound(message), missing: isMissing(error) }
  }
}

/**
 * A path outside the document's folder spelled under it instead: a root-absolute URL
 * (`/assets/app.js`) means the page's own site, as when its folder is served (a built single-page
 * app). Null for a path already in that folder.
 */
function siteRootPath(grant: DocPreviewGrant, absolutePath: string): string | null {
  const flavor = isWindowsAbsolutePathLike(grant.root) ? win32 : posix
  const fromFolder = flavor.relative(grant.root, absolutePath)
  const outside =
    fromFolder === '..' || fromFolder.startsWith(`..${flavor.sep}`) || flavor.isAbsolute(fromFolder)
  if (!outside) {
    return null
  }
  return flavor.join(grant.root, flavor.relative(grant.requestBase, absolutePath))
}

/** Called only where upstream's reader gives up; a document inside the worktree stays its 404. */
export async function readGrantedHostDocPreview(
  grantId: string,
  absolutePath: string,
  contentType: string
): Promise<HostFileDocPreviewOutcome> {
  const document = outsideWorkspaceDocument(getDocPreviewGrant(grantId))
  if (!document) {
    return notFound()
  }
  // The site's own file first; only a confirmed miss there falls to the host path, where `..` lands.
  const sitePath = siteRootPath(document.grant, absolutePath)
  if (sitePath) {
    const site = await readOutsideFile(document, sitePath, contentType)
    if (!site.missing || !getDocPreviewGrant(grantId)) {
      return site.outcome
    }
  }
  return (await readOutsideFile(document, absolutePath, contentType)).outcome
}
