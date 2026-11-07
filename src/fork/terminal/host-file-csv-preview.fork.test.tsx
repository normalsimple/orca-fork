// F046: a CSV or TSV outside every workspace past upstream's paging threshold opens in the paged
// preview, its stat and ranges read by absolute path; a smaller one, one with a draft, or one on an
// older host reads whole as before.
import { beforeEach, describe, expect, it } from 'vitest'
import { readEditorCsvFileContent } from '@/components/editor/csv/csv-file-content'
import { CSV_PAGED_PREVIEW_BYTES } from '@/components/editor/csv/csv-file-limits'
import { readRuntimeFileRange, statRuntimeReadTarget } from '@/runtime/files/reads/runtime-file-range-client'
import type { RuntimeFileReadArgs } from '@/runtime/files/runtime-file-client-types'
import {
  installRuntimeFileClientEnvironment,
  runtimeEnvironmentCall
} from '@/runtime/files/runtime-file-client-test-harness'
import { registerHostCsvPreviews } from './host-file-csv-preview'
import { registerLargeHostFileReads } from './large-host-file-read'

installRuntimeFileClientEnvironment()

const RESULTS = '/data/runs/results.csv'
const SUMMARY = '/data/runs/summary.tsv'
const RESULTS_BYTES = Buffer.from(
  `step\tloss\n${'1\t0.5\n'.repeat(CSV_PAGED_PREVIEW_BYTES / 6 + 1)}`
)
const SUMMARY_TEXT = 'step\tloss\n1\t0.5\n'
/** A host refuses a grant read past this, as local-artifact-read does. */
const GRANT_READ_MAX_BYTES = 512 * 1024

let host = new Map<string, Buffer>()
let legacyHost = false

function ok(result: unknown): unknown {
  return { id: 'call', ok: true, result, _meta: { runtimeId: 'remote-runtime' } }
}

function fail(message: string, code = 'runtime_error'): unknown {
  return { id: 'call', ok: false, error: { code, message } }
}

function respond(method: string, params: unknown): unknown {
  const args: Partial<Record<'absolutePath' | 'path' | 'pathText' | 'offset' | 'length', unknown>> =
    typeof params === 'object' && params !== null ? params : {}
  const path = String(args.absolutePath ?? args.path ?? args.pathText)
  const bytes = host.get(path)
  if (!bytes) {
    return fail('ENOENT')
  }
  if (method === 'files.resolveTerminalPath') {
    return ok({
      exists: true,
      openTarget: { kind: 'absolute-file', absolutePath: path, grantId: 'g-2' }
    })
  }
  if (method === 'files.readTerminalArtifact') {
    return bytes.length > GRANT_READ_MAX_BYTES
      ? fail('file_too_large')
      : ok({
          worktree: 'wt-1',
          relativePath: path,
          content: bytes.toString('utf8'),
          byteLength: bytes.length
        })
  }
  if (legacyHost) {
    return fail(method, 'method_not_found')
  }
  if (method === 'files.hostFile.stat') {
    return ok({ size: bytes.length, isDirectory: false, mtime: 1, ctime: 1, fileId: '1:2' })
  }
  if (method === 'files.hostFile.readChunk') {
    const offset = Number(args.offset)
    const slice = bytes.subarray(offset, offset + Number(args.length))
    const eof = offset + slice.length >= bytes.length
    return ok({ contentBase64: slice.toString('base64'), bytesRead: slice.length, eof })
  }
  return fail(method, 'method_not_found')
}

function hostCsv(filePath: string): RuntimeFileReadArgs {
  return {
    target: { kind: 'environment', environmentId: 'env-1' },
    filePath,
    relativePath: filePath,
    worktreeId: 'wt-1',
    terminalArtifactGrantId: 'g-1'
  }
}

function methodsCalled(): string[] {
  return runtimeEnvironmentCall.mock.calls.map(([request]) => request.method)
}

beforeEach(() => {
  host = new Map([
    [RESULTS, RESULTS_BYTES],
    [SUMMARY, Buffer.from(SUMMARY_TEXT)]
  ])
  legacyHost = false
  runtimeEnvironmentCall.mockImplementation(({ method, params }) =>
    Promise.resolve(respond(method, params))
  )
})

describe('before the fork registers', () => {
  it('reads a host CSV whole through its grant, and refuses one past the reply cap', async () => {
    await expect(readEditorCsvFileContent(hostCsv(SUMMARY))).resolves.toEqual({
      content: SUMMARY_TEXT,
      isBinary: false,
      terminalArtifactGrantId: 'g-1'
    })
    await expect(readEditorCsvFileContent(hostCsv(RESULTS))).rejects.toThrow(
      'Remote file is larger than the 512 KB this Orca server can send. Update the server to open it.'
    )
    expect(methodsCalled()).toEqual([
      'files.readTerminalArtifact',
      'files.readTerminalArtifact',
      'files.statTerminalArtifact'
    ])
  })
})

describe('a host CSV outside every workspace', () => {
  beforeEach(() => {
    registerHostCsvPreviews()
    registerLargeHostFileReads()
  })

  it('opens past the paging threshold in the paged preview, its ranges read by path', async () => {
    const args = hostCsv(RESULTS)

    await expect(readEditorCsvFileContent(args)).resolves.toEqual({
      content: '',
      isBinary: false,
      csvPreview: {
        readArgs: args,
        snapshot: expect.objectContaining({ size: RESULTS_BYTES.length, isDirectory: false })
      }
    })
    await expect(statRuntimeReadTarget(args)).resolves.toMatchObject({ size: RESULTS_BYTES.length })
    await expect(readRuntimeFileRange(args, 10, 6)).resolves.toEqual(
      new Uint8Array(RESULTS_BYTES.subarray(10, 16))
    )
    expect(methodsCalled()).not.toContain('files.readTerminalArtifact')
    expect(runtimeEnvironmentCall).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'files.hostFile.readChunk',
        params: { worktree: 'id:wt-1', path: RESULTS, offset: 10, length: 6 }
      })
    )
  })

  it('reads a smaller one whole, and one with a draft whole past the grant reply', async () => {
    await expect(readEditorCsvFileContent(hostCsv(SUMMARY))).resolves.toEqual({
      content: SUMMARY_TEXT,
      isBinary: false,
      terminalArtifactGrantId: 'g-1'
    })
    await expect(readEditorCsvFileContent(hostCsv(RESULTS), false)).resolves.toEqual({
      content: RESULTS_BYTES.toString('utf8'),
      isBinary: false,
      readOnly: true,
      terminalArtifactGrantId: 'g-1'
    })
  })

  it('on a host without path reads, reads up to the grant reply, renewing a restored tab grant', async () => {
    legacyHost = true
    const restored = { ...hostCsv(SUMMARY), terminalArtifactGrantId: undefined }

    await expect(readEditorCsvFileContent(restored)).resolves.toEqual({
      content: SUMMARY_TEXT,
      isBinary: false,
      terminalArtifactGrantId: 'g-2'
    })
    expect(methodsCalled()).toContain('files.resolveTerminalPath')
    await expect(readEditorCsvFileContent(hostCsv(RESULTS))).rejects.toThrow('file_too_large')
  })

  it("keeps upstream's refusal for a direct SSH connection's tab on a changed host", async () => {
    const sshTab = {
      ...hostCsv(RESULTS),
      terminalArtifactGrantId: undefined,
      expectedExternalSshTargetId: 'ssh-old'
    }

    await expect(readEditorCsvFileContent(sshTab)).rejects.toThrow('External SSH files')
    await expect(readRuntimeFileRange(sshTab, 0, 6)).rejects.toThrow('External SSH files')
    expect(methodsCalled()).toEqual([])
  })
})
