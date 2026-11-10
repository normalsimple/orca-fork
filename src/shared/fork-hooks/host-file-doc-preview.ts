// fork: F046. A paired host's files outside the clicked workspace: HTML renders in the doc preview,
// read by absolute path on the host, and the editor pages a grant that went stale because the file
// is still being written. file_too_large and truncated stay with upstream #38742. Unregistered,
// previews and reads stay upstream.
import type { DocPreviewFileFailureReason } from '../document-preview/doc-preview-scheme'
import type { LocalFileAccess } from '../file-access/local-file-access'
import type { RuntimeClientTarget } from '../runtime-client-target'
import type { RuntimeFilePreviewResult } from '../file-content/runtime-file-read'

/** Host RPC: one file of such a preview, with upstream's files.readDocPreview limits and checks. */
export const HOST_DOC_PREVIEW_READ_METHOD = 'files.hostDocPreview.read'
/** Host RPC: a byte range of a file too large for one reply, as files.readDocPreviewChunk. */
export const HOST_DOC_PREVIEW_READ_CHUNK_METHOD = 'files.hostDocPreview.readChunk'
/** Host RPC: files.stat for an absolute path. */
export const HOST_FILE_STAT_METHOD = 'files.hostFile.stat'
/** Host RPC: files.readChunk for an absolute path. */
export const HOST_FILE_READ_CHUNK_METHOD = 'files.hostFile.readChunk'

/** Ranged reads share upstream's bulk lane, so a large file does not hold terminal or workspace slots. */
export function isHostFileBulkRead(method: string): boolean {
  return method === HOST_DOC_PREVIEW_READ_CHUNK_METHOD || method === HOST_FILE_READ_CHUNK_METHOD
}

export type HostFileDocLocation = {
  owner: { kind: 'runtime'; environmentId: string; worktreeSelector: string; worktreeRoot: string }
  requestBase: string
  root: string
  entryRelativePath: string
}

type HostFileDocPreviewRenderer = {
  location: (args: {
    environmentId: string
    worktreeId: string
    worktreeRoot: string
    filePath: string
  }) => HostFileDocLocation
  readDocumentResource: (
    target: RuntimeClientTarget & { kind: 'environment' },
    worktreeId: string,
    filePath: string
  ) => Promise<RuntimeFilePreviewResult>
}

export type HostFileDocPreviewOutcome =
  | { ok: true; bytes: Buffer; contentType: string }
  | { ok: false; status: number; reason: DocPreviewFileFailureReason; message: string }

type HostFileDocPreviewReader = (
  grantId: string,
  absolutePath: string,
  contentType: string
) => Promise<HostFileDocPreviewOutcome>

/** A host file outside every workspace as the editor reads it, through its terminal grant. */
export type GrantedHostFile = {
  target: RuntimeClientTarget & { kind: 'environment' }
  worktreeId: string
  absolutePath: string
  grantId: string
  expectedEnvironmentPairingRevision?: number
}

/** A grant read's refusal. Only a stale grant still needs the fork's absolute-path page. */
export type LargeHostFileRefusal = Error

type LargeHostFileReader = (
  file: GrantedHostFile,
  refusal: LargeHostFileRefusal
) => Promise<RuntimeFilePreviewResult>

type LargeHostPreviewReader = (
  file: GrantedHostFile,
  refusal: unknown
) => Promise<RuntimeFilePreviewResult>

// A log still being written stales its grant; file_too_large and truncated page upstream (#38742).
const PAGED_REFUSALS = new Set(['terminal_file_grant_stale'])

let renderer: HostFileDocPreviewRenderer | null = null
let reader: HostFileDocPreviewReader | null = null
let largeFileReader: LargeHostFileReader | null = null
let largePreviewReader: LargeHostPreviewReader | null = null

export function registerHostFileDocPreview(next: HostFileDocPreviewRenderer): void {
  renderer = next
}

/** Main process: serves grants whose document lies outside the owner's worktree. */
export function registerHostFileDocPreviewRead(next: HostFileDocPreviewReader): void {
  reader = next
}

/** Renderer: pages a grant that went stale because the file changed (a log still being written). */
export function registerLargeHostFileReader(next: LargeHostFileReader): void {
  largeFileReader = next
}

/** Renderer: answers a grant's binary preview refusal (an image or PDF past one reply, any other binary). */
export function registerLargeHostPreviewReader(next: LargeHostPreviewReader): void {
  largePreviewReader = next
}

/** Whether a paired host's preview plan and HTML links cover files outside the workspace. */
export function previewsHostFiles(): boolean {
  return renderer !== null
}

/** The grant for a document outside the clicked workspace; null keeps upstream's refusal. */
export function hostFileDocLocation(
  environmentId: string | null,
  worktreeId: string,
  worktreeRoot: string | null,
  filePath: string
): HostFileDocLocation | null {
  if (!renderer || !environmentId || !worktreeRoot) {
    return null
  }
  return renderer.location({ environmentId, worktreeId, worktreeRoot, filePath })
}

/** An image a document outside the workspace names; null keeps upstream's error. */
export function readHostDocumentResource(
  target: RuntimeClientTarget,
  worktreeId: string | null | undefined,
  filePath: string,
  access: LocalFileAccess | undefined
): Promise<RuntimeFilePreviewResult> | null {
  if (!renderer || access?.kind !== 'document-resource' || target.kind !== 'environment') {
    return null
  }
  return worktreeId ? renderer.readDocumentResource(target, worktreeId, filePath) : null
}

/** Main process, where upstream's reader gives up outside the worktree; null keeps its 404. */
export function readHostDocPreview(
  grantId: string,
  absolutePath: string,
  contentType: string
): Promise<HostFileDocPreviewOutcome> | null {
  return reader ? reader(grantId, absolutePath, contentType) : null
}

/**
 * Renderer, where a grant read refuses text because the file changed since its grant
 * (`terminal_file_grant_stale`). file_too_large and truncated stay with upstream's
 * files.statTerminalArtifact / readTerminalArtifactChunk paging (#38742). Null keeps
 * upstream's handling.
 */
export function readLargeHostFile(
  file: GrantedHostFile,
  refusal: unknown
): Promise<RuntimeFilePreviewResult> | null {
  if (!largeFileReader || !(refusal instanceof Error) || !PAGED_REFUSALS.has(refusal.message)) {
    return null
  }
  return largeFileReader(file, refusal)
}

/**
 * Renderer, around a grant's binary preview: an image or PDF past one reply (about 3 MB) is paged,
 * another binary shows as one. Null when unregistered, so upstream returns its own call untouched.
 */
export function pageLargeHostPreview(
  file: GrantedHostFile,
  preview: Promise<RuntimeFilePreviewResult>
): Promise<RuntimeFilePreviewResult> | null {
  const reader = largePreviewReader
  return reader ? preview.catch((refusal: unknown) => reader(file, refusal)) : null
}

/** A paired read that may name a terminal grant. Only a grant is outside every workspace. */
type GrantedRemoteRead = {
  target: RuntimeClientTarget & { kind: 'environment' }
  worktree: string
  grantId?: string
  absolutePath?: string
  expectedEnvironmentPairingRevision?: number
}

function grantedHostFile(remote: GrantedRemoteRead): GrantedHostFile | null {
  if (remote.grantId === undefined || remote.absolutePath === undefined) {
    return null
  }
  // The address stores an `id:` selector; the tab and the reader use the raw worktree id.
  const worktreeId = remote.worktree.startsWith('id:') ? remote.worktree.slice(3) : remote.worktree
  return {
    target: remote.target,
    worktreeId,
    absolutePath: remote.absolutePath,
    grantId: remote.grantId,
    expectedEnvironmentPairingRevision: remote.expectedEnvironmentPairingRevision
  }
}

/** A stale-grant refusal. file_too_large and truncated return null so upstream can page. */
export function readLargeGrantedHostFile(
  remote: GrantedRemoteRead,
  refusal: unknown
): Promise<RuntimeFilePreviewResult> | null {
  const file = grantedHostFile(remote)
  return file ? readLargeHostFile(file, refusal) : null
}

/**
 * A grant's binary preview, started only when a reader is registered. Null leaves the caller's
 * preview untouched and does not start `preview`.
 */
export function pageLargeGrantedHostPreview(
  remote: GrantedRemoteRead,
  preview: () => Promise<RuntimeFilePreviewResult>
): Promise<RuntimeFilePreviewResult> | null {
  const file = grantedHostFile(remote)
  if (!file || largePreviewReader === null) {
    return null
  }
  return pageLargeHostPreview(file, preview())
}
