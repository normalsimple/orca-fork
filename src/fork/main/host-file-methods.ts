// F046: a paired host's files outside the clicked workspace, read by absolute path. Doc previews go
// through upstream's doc-preview access (containment in the grant's base, fonts, PDF, ranged reads);
// the editor stats and reads ranges like files.stat and files.readChunk, past a grant's 512 KiB.
// The clicked workspace only picks the route: a caller with this permission already runs commands
// as this host's user.
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import type { OrcaRuntimeService } from '../../main/runtime/orca-runtime'
import { defineMethod } from '../../main/runtime/rpc/core'
import { remoteFileContentBudget } from '../../main/runtime/rpc/methods/files/files-remote-content-budget'
import { requireLocalRuntimeFileRoute } from '../../main/runtime/files/file-target'
import {
  assertPreviewWithinTransportBudget,
  LOCAL_PREVIEWABLE_BINARY_MAX_BYTES,
  MOBILE_FILE_READ_MAX_BYTES,
  previewableBinaryByteLimit
} from '../../main/runtime/files/file-preview-budget'
import { readLocalFileRange } from '../../main/ipc/filesystem/local-file-range-read'
import {
  readAuthorizedDocPreviewFile,
  readAuthorizedDocPreviewFileChunk
} from '../../shared/doc-preview-file-access'
import { WorktreeSelector } from '../../shared/rpc-contract/files-target-params'
import {
  HOST_DOC_PREVIEW_READ_CHUNK_METHOD,
  HOST_DOC_PREVIEW_READ_METHOD,
  HOST_FILE_READ_CHUNK_METHOD,
  HOST_FILE_STAT_METHOD
} from '../../shared/fork-hooks/host-file-doc-preview'

const HostPath = z.string().min(1).refine(isAbsolute, 'Expected an absolute path')

const ChunkRange = {
  offset: z.number().int().nonnegative(),
  length: z
    .number()
    .int()
    .positive()
    .max(512 * 1024)
}

const HostDocPreviewRead = WorktreeSelector.extend({
  boundaryPath: HostPath,
  entryPath: HostPath,
  implicitRootPath: HostPath.nullable(),
  authorizedRootPaths: z.array(HostPath),
  targetPath: HostPath
})

const HostFilePath = WorktreeSelector.extend({ path: HostPath })

export type HostDocPreviewReadParams = z.input<typeof HostDocPreviewRead>

/** A workspace this host reaches over SSH names another machine's paths. */
async function requireLocalHost(
  runtime: Pick<OrcaRuntimeService, 'resolveRuntimeFileTarget'>,
  worktreeSelector: string
): Promise<void> {
  requireLocalRuntimeFileRoute(await runtime.resolveRuntimeFileTarget(worktreeSelector))
}

// Desktop, orcad and `orca serve` share this table (src/fork/main/rpc-methods.ts).
export const HOST_FILE_METHODS = [
  defineMethod({
    name: HOST_DOC_PREVIEW_READ_METHOD,
    permission: 'workspace',
    params: HostDocPreviewRead,
    handler: async ({ worktree, ...target }, { runtime, clientKind, requestId }) => {
      await requireLocalHost(runtime, worktree)
      const budget = remoteFileContentBudget(clientKind, requestId)
      return assertPreviewWithinTransportBudget(
        await readAuthorizedDocPreviewFile({
          ...target,
          maxTextBytes: MOBILE_FILE_READ_MAX_BYTES,
          maxBinaryBytes:
            budget === undefined
              ? LOCAL_PREVIEWABLE_BINARY_MAX_BYTES
              : previewableBinaryByteLimit(budget)
        }),
        budget
      )
    }
  }),
  defineMethod({
    name: HOST_DOC_PREVIEW_READ_CHUNK_METHOD,
    permission: 'workspace',
    params: HostDocPreviewRead.extend(ChunkRange),
    handler: async ({ worktree, offset, length, ...target }, { runtime }) => {
      await requireLocalHost(runtime, worktree)
      return readAuthorizedDocPreviewFileChunk(target, offset, length)
    }
  }),
  defineMethod({
    name: HOST_FILE_STAT_METHOD,
    permission: 'workspace',
    params: HostFilePath,
    handler: async (params, { runtime }) => {
      await requireLocalHost(runtime, params.worktree)
      // bigint: an inode past 2^53 must still compare exactly.
      const stats = await stat(params.path, { bigint: true })
      return {
        size: Number(stats.size),
        isDirectory: stats.isDirectory(),
        mtime: Number(stats.mtimeNs) / 1e6,
        ctime: Number(stats.ctimeNs) / 1e6,
        // Why: tells a log that grew from a file replaced under the same path.
        fileId: `${stats.dev}:${stats.ino}`
      }
    }
  }),
  defineMethod({
    name: HOST_FILE_READ_CHUNK_METHOD,
    permission: 'workspace',
    params: HostFilePath.extend(ChunkRange),
    handler: async (params, { runtime }) => {
      await requireLocalHost(runtime, params.worktree)
      return readLocalFileRange(params.path, params.offset, params.length)
    }
  })
]

export type HostFileMethodName = (typeof HOST_FILE_METHODS)[number]['name']
