// F046: a CSV or TSV outside every workspace past upstream's paging threshold opens in upstream's paged
// preview, as one inside a workspace does: the preview stats it and reads its ranges by absolute path
// through files.hostFile.*. A smaller one, and any on a host without those, reads whole as before,
// through a grant (renewed for a restored tab). .tsx because it imports renderer aliases.
import { decodeBase64Bytes } from '@/lib/base64-bytes'
import { isHostFileOutsideWorkspaces } from '@/runtime/files/grants/runtime-terminal-artifact-read'
import { CSV_PAGED_PREVIEW_BYTES } from '@/components/editor/csv/csv-file-limits'
import {
  registerHostFileRanges,
  type HostCsvPreview,
  type HostFileReadArgs,
  type HostFileSnapshot
} from '../../shared/fork-hooks/host-file-ranges'
import { readHostRange, statHostFile, type HostFile } from './large-host-file-read'

function hostFile(args: HostFileReadArgs): HostFile | null {
  const { target, worktreeId, filePath } = args
  // Why: a direct SSH connection's tab names that machine's path; upstream's route refuses it.
  if (target.kind !== 'environment' || !worktreeId || args.expectedExternalSshTargetId) {
    return null
  }
  const outside = isHostFileOutsideWorkspaces({
    filePath,
    relativePath: args.relativePath,
    grantId: args.terminalArtifactGrantId
  })
  return outside
    ? {
        target,
        worktreeId,
        absolutePath: filePath,
        expectedEnvironmentPairingRevision: args.expectedEnvironmentPairingRevision
      }
    : null
}

async function pagedOrWhole<TArgs extends HostFileReadArgs, TContent>(
  file: HostFile,
  args: TArgs,
  readWhole: () => Promise<TContent>
): Promise<TContent | HostCsvPreview<TArgs>> {
  let snapshot: HostFileSnapshot
  try {
    snapshot = await statHostFile(file)
  } catch {
    // Why: an older host cannot stat by path, and a missing file should fail as upstream reports it.
    return readWhole()
  }
  return !snapshot.isDirectory && snapshot.size >= CSV_PAGED_PREVIEW_BYTES
    ? { content: '', isBinary: false, csvPreview: { readArgs: args, snapshot } }
    : readWhole()
}

function readCsv<TArgs extends HostFileReadArgs, TContent>(
  args: TArgs,
  readWhole: () => Promise<TContent>
): Promise<TContent | HostCsvPreview<TArgs>> | null {
  const file = /\.(csv|tsv)$/i.test(args.filePath) ? hostFile(args) : null
  return file ? pagedOrWhole(file, args, readWhole) : null
}

async function readRange(
  file: HostFile,
  offset: number,
  length: number
): Promise<Uint8Array<ArrayBuffer>> {
  const result = await readHostRange(file, offset, length)
  const bytes = decodeBase64Bytes(result.contentBase64)
  // Upstream's check on a files.readChunk range: a short or empty one means the file changed.
  if (bytes.length !== result.bytesRead || bytes.length > length || bytes.length === 0) {
    throw new Error('File changed or returned an invalid CSV chunk. Reload the preview.')
  }
  return bytes
}

export function registerHostCsvPreviews(): void {
  registerHostFileRanges({
    readCsv,
    stat: (args) => {
      const file = hostFile(args)
      return file ? statHostFile(file) : null
    },
    read: (args, offset, length) => {
      const file = hostFile(args)
      return file ? readRange(file, offset, length) : null
    }
  })
}
