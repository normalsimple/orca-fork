// F046: one call to the host that owns a doc preview outside its worktree, and how the host's reply
// becomes the preview's outcome.
import type { HostFileDocPreviewOutcome } from '../../shared/fork-hooks/host-file-doc-preview'
import { callRuntimeEnvironment } from '../../main/ipc/runtime-environments/runtime-environment-transport-routing'
import { getRuntimeEnvironmentRegistryRoot } from '../../main/ipc/runtime-environments/runtime-environment-registry-root'
import type { DocPreviewGrant } from '../../main/browser/document-preview/doc-preview-grant-registry'
import type { HostDocPreviewReadParams } from './host-file-methods'

const READ_TIMEOUT_MS = 15_000
export const TOO_LARGE_ERROR = 'file_too_large'

export const TOO_LARGE: HostFileDocPreviewOutcome = {
  ok: false,
  status: 413,
  reason: 'too-large',
  message: 'This document is too large for the server to send in full.'
}

export const UNSUPPORTED: HostFileDocPreviewOutcome = {
  ok: false,
  status: 415,
  reason: 'unsupported-asset',
  message: 'This workspace cannot send this file type to a preview.'
}

export function notFound(message = 'Not found'): HostFileDocPreviewOutcome {
  return { ok: false, status: 404, reason: 'unreadable', message }
}

/** The host has no file there: a confirmed miss, unlike a timeout, a denial or a rewrite. */
export class MissingHostFile extends Error {}

export function isMissing(error: unknown): boolean {
  return (
    error instanceof MissingHostFile ||
    (error instanceof Error && /^(ENOENT|ENOTDIR)\b/.test(error.message))
  )
}

type HostOwner = Extract<DocPreviewGrant['owner'], { kind: 'runtime' }>

/** A grant minted for a document outside its runtime worktree. */
export type OutsideDocument = { grant: DocPreviewGrant; owner: HostOwner; entryPath: string }

class HostCallError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

/** What a reader sends the host, besides the clicked workspace each call carries. */
type HostCallParams =
  | (Omit<HostDocPreviewReadParams, 'worktree'> & { offset?: number; length?: number })
  | { pathText: string }
  | { absolutePath: string; grantId: string }

export async function callHost(
  owner: HostOwner,
  method: string,
  params: HostCallParams
): Promise<unknown> {
  const response = await callRuntimeEnvironment(
    getRuntimeEnvironmentRegistryRoot(),
    owner.environmentId,
    method,
    { worktree: owner.worktreeSelector, ...params },
    READ_TIMEOUT_MS
  )
  if (!response.ok) {
    throw new HostCallError(response.error.code, response.error.message)
  }
  return response.result
}

export function isMissingMethod(error: unknown): boolean {
  return error instanceof HostCallError && error.code === 'method_not_found'
}

export function isTooLarge(error: unknown): boolean {
  return error instanceof Error && error.message === TOO_LARGE_ERROR
}

export function toOutcome(preview: unknown, contentType: string): HostFileDocPreviewOutcome {
  if (typeof preview !== 'object' || preview === null) {
    return notFound()
  }
  const fields: Partial<Record<'content' | 'isBinary' | 'mimeType', unknown>> = preview
  if (typeof fields.content !== 'string' || typeof fields.isBinary !== 'boolean') {
    return notFound()
  }
  if (!fields.isBinary) {
    return { ok: true, bytes: Buffer.from(fields.content, 'utf8'), contentType }
  }
  if (fields.content) {
    return { ok: true, bytes: Buffer.from(fields.content, 'base64'), contentType }
  }
  // Same rule as upstream's reader: an empty binary without a type is an unsupported format.
  return typeof fields.mimeType === 'string'
    ? { ok: true, bytes: Buffer.alloc(0), contentType }
    : UNSUPPORTED
}
