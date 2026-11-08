// F046: the editor opens a file outside every workspace that its terminal grant will not send in one
// reply: text past 512 KiB, past the reply once decoded, or a log that changed since its grant; an
// image or PDF past the grant preview's reply (about 3 MB). It pages the file by absolute path
// through upstream's loop, up to the 50 MiB upstream pages (a desktop workspace PDF streams by range
// instead). Any other binary shows as one, as inside a workspace. .tsx because it imports renderer
// aliases.
import { useAppStore } from '@/store'
import { decodeBase64Bytes } from '@/lib/base64-bytes'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { RuntimeRpcCallError } from '@/runtime/rpc/calls/runtime-rpc-result'
import { toRuntimeWorktreeSelector } from '@/runtime/rpc/targets/runtime-worktree-selector'
import type { RuntimeFileSnapshot } from '@/runtime/files/reads/runtime-file-range-client'
import {
  pagedFilePreviewResult,
  pagedTextFileResult,
  previewableBinaryMimeType,
  readFileInChunks,
  type ChunkedFileReader
} from '@/runtime/files/reads/runtime-paged-file-read'
import { BINARY_PROBE_BYTES } from '../../shared/file-preview/binary-buffer'
import { rasterImageExceedsPreviewLimits } from '../../shared/file-preview/raster-image-prefix-limits'
import { RASTER_IMAGE_PREVIEW_TOO_LARGE_ERROR } from '../../shared/file-preview/raster-image-preview-limits'
import type {
  RuntimeFilePreviewResult,
  RuntimeFileReadChunkResult
} from '../../shared/file-content/runtime-file-read'
import {
  HOST_FILE_READ_CHUNK_METHOD,
  HOST_FILE_STAT_METHOD,
  registerLargeHostFileReader,
  registerLargeHostPreviewReader,
  type GrantedHostFile,
  type LargeHostFileRefusal
} from '../../shared/fork-hooks/host-file-doc-preview'

/** A grant saves at most this much; a tab read past it is a view. */
const GRANT_WRITE_MAX_BYTES = 512 * 1024
/** Under files.hostFile.readChunk's 512 KiB cap. */
const PREFIX_CHUNK_BYTES = 384 * 1024

type HostFileSnapshot = RuntimeFileSnapshot & { fileId?: string }
export type HostFile = Pick<
  GrantedHostFile,
  'target' | 'worktreeId' | 'absolutePath' | 'expectedEnvironmentPairingRevision'
>

function callHost<TResult>(
  file: HostFile,
  method: string,
  timeoutMs: number,
  range?: { offset: number; length: number }
): Promise<TResult> {
  return callRuntimeRpc<TResult>(
    file.target,
    method,
    { worktree: toRuntimeWorktreeSelector(file.worktreeId), path: file.absolutePath, ...range },
    { timeoutMs, expectedEnvironmentPairingRevision: file.expectedEnvironmentPairingRevision }
  )
}

export function statHostFile(file: HostFile): Promise<HostFileSnapshot> {
  return callHost(file, HOST_FILE_STAT_METHOD, 15_000)
}

export function readHostRange(
  file: HostFile,
  offset: number,
  length: number
): Promise<RuntimeFileReadChunkResult> {
  return length > 0
    ? callHost(file, HOST_FILE_READ_CHUNK_METHOD, 60_000, { offset, length })
    : Promise.resolve({ contentBase64: '', bytesRead: 0, eof: true })
}

/** Upstream's terms: a file that changes in any way while it loads is refused. */
function strictHostFileReader(file: HostFile): ChunkedFileReader {
  return {
    stat: () => statHostFile(file),
    readChunk: (offset, length) => readHostRange(file, offset, length)
  }
}

function unchanged(first: HostFileSnapshot, current: HostFileSnapshot): boolean {
  return (
    first.size === current.size && first.mtime === current.mtime && first.ctime === current.ctime
  )
}

type ReadRange = { offset: number; contentBase64: string; bytesRead: number }

/**
 * Text read as of the first stat. A file that only grew since (the same file, longer, its first and
 * last ranges read still holding the same bytes) passes the loop's final check, so a log being
 * written opens. Any other change, a same-size rewrite included, is refused as upstream refuses it.
 */
function snapshotHostFileReader(file: HostFile): ChunkedFileReader {
  let first: HostFileSnapshot | null = null
  const ranges: ReadRange[] = []
  const stillHolds = async (range: ReadRange): Promise<boolean> =>
    range.bytesRead === 0 ||
    (await readHostRange(file, range.offset, range.bytesRead)).contentBase64 === range.contentBase64
  const onlyGrew = async (before: HostFileSnapshot, after: HostFileSnapshot): Promise<boolean> => {
    // Why: appending always lengthens a file; the same size with a new mtime is a rewrite.
    if (after.size <= before.size || (before.fileId && after.fileId !== before.fileId)) {
      return false
    }
    const edges = new Set([ranges[0], ranges.at(-1)])
    for (const range of edges) {
      if (!range) {
        continue
      }
      if (!(await stillHolds(range))) {
        return false
      }
    }
    return true
  }
  return {
    stat: async () => {
      const current = await statHostFile(file)
      if (!first) {
        first = current
        return current
      }
      return !unchanged(first, current) && (await onlyGrew(first, current)) ? first : current
    },
    readChunk: async (offset, length) => {
      const size = first?.size ?? 0
      const chunk = await readHostRange(file, offset, Math.min(length, Math.max(0, size - offset)))
      ranges.push({ offset, contentBase64: chunk.contentBase64, bytesRead: chunk.bytesRead })
      return offset + chunk.bytesRead >= size ? { ...chunk, eof: true } : chunk
    }
  }
}

function isMissingMethod(error: unknown): boolean {
  return error instanceof RuntimeRpcCallError && error.code === 'method_not_found'
}

function tooLargeError(size: number): Error {
  return new Error(`Remote file is too large to open in the editor (${size} bytes)`)
}

/** What upstream would have thrown, for a host without files.hostFile.*. */
function upstreamRefusal(refusal: LargeHostFileRefusal): Error {
  return refusal instanceof Error ? refusal : tooLargeError(refusal.byteLength)
}

/** No save of this size can reach the host, so the tab says so instead of failing at save time. */
function keepReadOnly(file: HostFile): void {
  const { openFiles } = useAppStore.getState()
  const matches = (open: (typeof openFiles)[number]): boolean =>
    open.worktreeId === file.worktreeId && open.filePath === file.absolutePath && !open.readOnly
  if (openFiles.some(matches)) {
    useAppStore.setState({
      openFiles: openFiles.map((open) => (matches(open) ? { ...open, readOnly: true } : open))
    })
  }
}

async function readLargeHostFile(
  file: GrantedHostFile,
  refusal: LargeHostFileRefusal
): Promise<RuntimeFilePreviewResult> {
  let probe: RuntimeFileReadChunkResult
  try {
    probe = await readHostRange(file, 0, BINARY_PROBE_BYTES)
  } catch (error) {
    throw isMissingMethod(error) ? upstreamRefusal(refusal) : error
  }
  // A binary without an image or PDF extension: say so without paging megabytes first.
  if (decodeBase64Bytes(probe.contentBase64).includes(0)) {
    return { content: '', isBinary: true }
  }
  const paged = await readFileInChunks(snapshotHostFileReader(file))
  if (paged.kind === 'unsupported') {
    throw upstreamRefusal(refusal)
  }
  if (paged.kind === 'too_large') {
    throw tooLargeError(paged.size)
  }
  if (paged.bytes.length > GRANT_WRITE_MAX_BYTES) {
    keepReadOnly(file)
  }
  return pagedTextFileResult(paged.bytes)
}

/** A file's first bytes for the shared raster header check, each wider probe reading only its tail. */
function hostPrefixReader(file: HostFile): (bytes: number) => Promise<Uint8Array> {
  let prefix = new Uint8Array(0)
  let atEnd = false
  return async (bytes) => {
    while (!atEnd && prefix.length < bytes) {
      const length = Math.min(PREFIX_CHUNK_BYTES, bytes - prefix.length)
      const chunk = await readHostRange(file, prefix.length, length)
      const tail = decodeBase64Bytes(chunk.contentBase64)
      const grown = new Uint8Array(prefix.length + tail.length)
      grown.set(prefix)
      grown.set(tail, prefix.length)
      prefix = grown
      atEnd = chunk.eof || tail.length === 0
    }
    return prefix.subarray(0, Math.min(bytes, prefix.length))
  }
}

/**
 * A grant's binary preview refusal, for the editor, a chat or a Markdown file. Past one reply an image
 * or PDF pages, unless an image's header already proves it too large to decode; any other binary
 * shows as one, as upstream shows it inside a workspace.
 */
async function readRefusedHostPreview(
  file: HostFile,
  refusal: unknown
): Promise<RuntimeFilePreviewResult> {
  const reason = refusal instanceof RuntimeRpcCallError ? refusal.message : null
  const mimeType = previewableBinaryMimeType(file.absolutePath)
  if (!mimeType && (reason === 'binary_file' || reason === 'file_too_large')) {
    return { content: '', isBinary: true }
  }
  if (!mimeType || reason !== 'file_too_large') {
    throw refusal
  }
  let oversized: boolean
  try {
    oversized = await rasterImageExceedsPreviewLimits(hostPrefixReader(file), mimeType)
  } catch (error) {
    throw isMissingMethod(error) ? refusal : error
  }
  if (oversized) {
    throw new Error(RASTER_IMAGE_PREVIEW_TOO_LARGE_ERROR)
  }
  const paged = await readFileInChunks(strictHostFileReader(file))
  if (paged.kind !== 'ok') {
    throw refusal
  }
  return pagedFilePreviewResult(file.absolutePath, paged.bytes)
}

export function registerLargeHostFileReads(): void {
  registerLargeHostFileReader(readLargeHostFile)
  registerLargeHostPreviewReader(readRefusedHostPreview)
}
