import type { RuntimeFileReadResult } from '../../../../../shared/file-content/runtime-file-read'
import { BINARY_PROBE_BYTES } from '../../../../../shared/file-preview/binary-buffer'
import { remoteFileRequest } from '../../../../../shared/file-access/remote-file-locator'
import type { RuntimeReadableFileContent } from '../runtime-file-client-types'
import type { RuntimeRemoteFileAddress } from './runtime-file-range-client'
import { readRemoteRangePreview } from './runtime-file-range-preview'
import {
  REMOTE_FILE_PAGED_READ_UNSUPPORTED_MESSAGE,
  pagedTextFileResult,
  pinRemoteFileAddress,
  readRemoteBinaryFile,
  readRemoteFileInChunks,
  readRemoteFilePreview
} from './runtime-paged-file-read'
import { callRuntimeRpc } from '../../rpc/calls/runtime-rpc-call'
import { RuntimeRpcCallError } from '../../rpc/calls/runtime-rpc-result'
import {
  keepLargeGrantedHostFileReadOnly,
  pageLargeGrantedHostPreview,
  readLargeGrantedHostFile
} from '../../../../../shared/fork-hooks/host-file-doc-preview'

function isRpcRefusal(error: unknown, message: string): boolean {
  return error instanceof RuntimeRpcCallError && error.message === message
}

/** A paired runtime's file for the editor: streamed to a viewer by URL, previewed, or paged past one reply. */
export async function readRemoteFileContent(
  address: RuntimeRemoteFileAddress,
  { pageOversizedBinary }: { pageOversizedBinary: boolean }
): Promise<RuntimeReadableFileContent> {
  const remote = pinRemoteFileAddress(address)
  // Baseline checks discard binary content, so only readers that render bytes mint a stream.
  const rangePreview = pageOversizedBinary ? await readRemoteRangePreview(remote) : null
  if (rangePreview) {
    return rangePreview
  }
  const { method, params } = remoteFileRequest(remote.worktree, remote, 'read')
  let result: RuntimeFileReadResult | null
  try {
    result = await callRuntimeRpc<RuntimeFileReadResult>(remote.target, method, params, {
      timeoutMs: 15_000,
      expectedEnvironmentPairingRevision: remote.expectedEnvironmentPairingRevision
    })
  } catch (err) {
    // Why: a growing log stales its grant; fork pages the snapshot without renewing.
    // file_too_large stays here so upstream #38742 can page via files.statTerminalArtifact.
    const staleGrant = readLargeGrantedHostFile(remote, err)
    if (staleGrant) {
      return staleGrant
    }
    // Typed binary_file refusal permits base64 preview for PDFs/images; unrelated errors cannot spoof this fallback.
    if (isRpcRefusal(err, 'binary_file')) {
      // Why: the editor passes pageOversizedBinary, so #38742 pages the grant (range URL or
      // files.readTerminalArtifactChunk). Chat-image previews do not, and still need the fork.
      if (!pageOversizedBinary) {
        const pagedPreview = pageLargeGrantedHostPreview(remote, () =>
          readRemoteFilePreview(remote, { pageOversized: false })
        )
        if (pagedPreview) {
          return pagedPreview
        }
      }
      // Why: baseline checks call this too and discard binary content, so paging is opt-in.
      return readRemoteBinaryFile(remote, { pageOversized: pageOversizedBinary })
    }
    // Why: a granted file past one reply is refused whole rather than cut short.
    if (remote.grantId === undefined || !isRpcRefusal(err, 'file_too_large')) {
      throw err
    }
    result = null
  }
  // Hosts before content sniffing send an unlisted binary as text; NUL is git's binary signal.
  if (result?.content.slice(0, BINARY_PROBE_BYTES).includes('\0')) {
    return { content: '', isBinary: true }
  }
  if (!result || result.truncated) {
    // Replies stop at 512KiB; page the whole file or later editable saves truncate it.
    const paged = await readRemoteFileInChunks(remote)
    if (paged.kind === 'ok') {
      // Why: a grant cannot save past 512 KiB; mark the open tab the way the old hostFile pager did.
      keepLargeGrantedHostFileReadOnly(remote, paged.bytes.length)
      return pagedTextFileResult(paged.bytes)
    }
    throw new Error(
      paged.kind === 'unsupported'
        ? REMOTE_FILE_PAGED_READ_UNSUPPORTED_MESSAGE
        : `Remote file is too large to open in the editor (${paged.size} bytes)`
    )
  }
  return { content: result.content, isBinary: false }
}
