// F046: text outside every workspace whose grant went stale (a log still being written) opens in
// the editor, paged by absolute path. file_too_large and truncated go through upstream #38742
// (files.statTerminalArtifact / readTerminalArtifactChunk). A log that only grew while it loads
// opens as it was; a rewrite is refused. An image or PDF past the grant preview's reply, on a
// path that does not ask upstream to page (chat-image), is paged the same way; any other binary
// shows as one.
import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor/types/open-file'
import { readRuntimeTerminalArtifactContent } from '@/runtime/files/grants/runtime-terminal-artifact-read'
import { REMOTE_FILE_CHANGED_DURING_READ_MESSAGE } from '@/runtime/files/reads/runtime-paged-file-read'
import {
  installRuntimeFileClientEnvironment,
  runtimeEnvironmentCall
} from '@/runtime/files/runtime-file-client-test-harness'
import { RASTER_IMAGE_PREVIEW_TOO_LARGE_ERROR } from '../../shared/file-preview/raster-image-preview-limits'
import { registerLargeHostFileReads } from './large-host-file-read'

installRuntimeFileClientEnvironment()

const LOG = '/var/log/train/run.log'
const LOG_BYTES = Buffer.from('epoch 1 loss 0.5\n'.repeat(60_000))
const PNG_PREVIEW = { content: 'iVBO', isBinary: true, isImage: true, mimeType: 'image/png' }

type Refusal = 'file_too_large' | 'terminal_file_grant_stale' | 'binary_file' | 'truncated'
type HostFile = {
  bytes: Buffer
  fileId: string
  mtime: number
  refusal: Refusal
  /** The grant preview's reply: whole, or refused as past one reply or as a binary. */
  preview?: 'file_too_large' | 'binary_file'
}

let host = new Map<string, HostFile>()
let legacyHost = false
/** Upstream #38742 paging for a still-valid grant (file_too_large / truncated). */
let artifactPaging = false
let readChunks = 0
/** Runs after each ranged read, so a test can change the file while it loads. */
let afterChunk: (file: HostFile, count: number) => void = () => {}

function ok(result: unknown): unknown {
  return { id: 'call', ok: true, result, _meta: { runtimeId: 'remote-runtime' } }
}

function fail(message: string, code = 'runtime_error'): unknown {
  return { id: 'call', ok: false, error: { code, message } }
}

function pageFile(file: HostFile, args: Partial<Record<'offset' | 'length', unknown>>): unknown {
  const offset = Number(args.offset)
  const slice = file.bytes.subarray(offset, offset + Number(args.length))
  const reply = ok({
    contentBase64: slice.toString('base64'),
    bytesRead: slice.length,
    eof: offset + slice.length >= file.bytes.length
  })
  readChunks += 1
  afterChunk(file, readChunks)
  return reply
}

function respond(method: string, params: unknown): unknown {
  const args: Partial<Record<'absolutePath' | 'path' | 'offset' | 'length', unknown>> =
    typeof params === 'object' && params !== null ? params : {}
  const path = String(args.absolutePath ?? args.path)
  const file = host.get(path)
  if (!file) {
    return fail(method, 'method_not_found')
  }
  if (method === 'files.readTerminalArtifact') {
    return file.refusal === 'truncated'
      ? ok({ worktree: 'wt-1', relativePath: path, content: 'x', truncated: true, byteLength: 1 })
      : fail(file.refusal)
  }
  if (method === 'files.readTerminalArtifactPreview') {
    return file.preview ? fail(file.preview) : ok(PNG_PREVIEW)
  }
  if (legacyHost) {
    return fail(method, 'method_not_found')
  }
  if (artifactPaging && method === 'files.statTerminalArtifact') {
    const { bytes, mtime } = file
    return ok({ size: bytes.length, isDirectory: false, mtime, ctime: mtime })
  }
  if (artifactPaging && method === 'files.readTerminalArtifactChunk') {
    return pageFile(file, args)
  }
  if (method === 'files.hostFile.stat') {
    const { bytes, fileId, mtime } = file
    return ok({ size: bytes.length, isDirectory: false, mtime, ctime: mtime, fileId })
  }
  if (method === 'files.hostFile.readChunk') {
    return pageFile(file, args)
  }
  return fail(method, 'method_not_found')
}

function tab(filePath: string): OpenFile {
  return {
    id: `tab:${filePath}`,
    filePath,
    relativePath: filePath,
    worktreeId: 'wt-1',
    language: 'plaintext',
    isDirty: false,
    mode: 'edit'
  }
}

function read(absolutePath: string): ReturnType<typeof readRuntimeTerminalArtifactContent> {
  return readRuntimeTerminalArtifactContent(
    {
      target: { kind: 'environment', environmentId: 'env-1' },
      worktreeId: 'wt-1',
      absolutePath,
      grantId: 'g-1'
    },
    { pageOversizedBinary: false }
  )
}

function methodsCalled(): string[] {
  return runtimeEnvironmentCall.mock.calls.map(([request]) => request.method)
}

function staleLog(bytes = LOG_BYTES, fileId = '1:7'): HostFile {
  return { bytes, fileId, mtime: 1, refusal: 'terminal_file_grant_stale' }
}

beforeEach(() => {
  host = new Map([[LOG, { bytes: LOG_BYTES, fileId: '1:7', mtime: 1, refusal: 'file_too_large' }]])
  legacyHost = false
  artifactPaging = false
  readChunks = 0
  afterChunk = () => {}
  runtimeEnvironmentCall.mockImplementation(({ method, params }) =>
    Promise.resolve(respond(method, params))
  )
  useAppStore.setState({ openFiles: [tab(LOG)] })
})

describe('before the fork registers', () => {
  it('keeps an older host refusal when a log or PDF cannot be paged', async () => {
    host.set('/home/me/paper.pdf', {
      bytes: Buffer.alloc(8),
      fileId: '1:14',
      mtime: 1,
      refusal: 'binary_file',
      preview: 'file_too_large'
    })

    await expect(read(LOG)).rejects.toThrow(
      'Remote file is larger than the 512 KB this Orca server can send. Update the server to open it.'
    )
    await expect(read('/home/me/paper.pdf')).rejects.toThrow('file_too_large')
    expect(methodsCalled()).not.toContain('files.hostFile.stat')
  })
})

describe('text a grant will not send', () => {
  beforeEach(() => {
    registerLargeHostFileReads()
  })

  it('lets upstream page text past one grant reply, without files.hostFile.*', async () => {
    artifactPaging = true

    await expect(read(LOG)).resolves.toEqual({
      content: LOG_BYTES.toString('utf8'),
      isBinary: false,
      readOnly: true,
      terminalArtifactGrantId: 'g-1'
    })
    expect(methodsCalled()).toContain('files.statTerminalArtifact')
    expect(methodsCalled()).toContain('files.readTerminalArtifactChunk')
    expect(methodsCalled()).not.toContain('files.hostFile.stat')
    expect(methodsCalled()).not.toContain('files.hostFile.readChunk')
    expect(useAppStore.getState().openFiles[0]?.readOnly).toBe(true)
  })

  it('lets upstream page a truncated grant reply, without files.hostFile.*', async () => {
    artifactPaging = true
    const small = Buffer.from('tail -f me\n')
    host.set('/var/log/latin1.log', {
      bytes: small,
      fileId: '1:10',
      mtime: 1,
      refusal: 'truncated'
    })

    useAppStore.setState({ openFiles: [tab('/var/log/latin1.log')] })
    await expect(read('/var/log/latin1.log')).resolves.toEqual({
      content: 'tail -f me\n',
      isBinary: false,
      terminalArtifactGrantId: 'g-1'
    })
    expect(methodsCalled()).toContain('files.statTerminalArtifact')
    expect(methodsCalled()).not.toContain('files.hostFile.stat')
    // Small enough to save through the grant, so the tab stays writable.
    expect(useAppStore.getState().openFiles[0]?.readOnly).toBeUndefined()
  })

  it('opens a log whose grant went stale as a read-only tab when it is past 512 KiB', async () => {
    host.set(LOG, staleLog())

    await expect(read(LOG)).resolves.toEqual({
      content: LOG_BYTES.toString('utf8'),
      isBinary: false,
      readOnly: true,
      terminalArtifactGrantId: 'g-1'
    })
    expect(useAppStore.getState().openFiles[0]?.readOnly).toBe(true)
    expect(methodsCalled()).toContain('files.hostFile.stat')
    expect(methodsCalled()).not.toContain('files.resolveTerminalPath')
    expect(methodsCalled()).not.toContain('files.statTerminalArtifact')
  })

  it('opens a log that grows while it loads, as it was when the read began', async () => {
    host.set(LOG, staleLog())
    afterChunk = (file, count) => {
      if (count === 2) {
        file.bytes = Buffer.concat([file.bytes, Buffer.from('epoch 2 loss 0.4\n')])
        file.mtime += 1
      }
    }

    await expect(read(LOG)).resolves.toMatchObject({ content: LOG_BYTES.toString('utf8') })
  })

  it('refuses a file rewritten in place, or replaced, while it loads', async () => {
    host.set(LOG, staleLog())
    afterChunk = (file, count) => {
      if (count === 2) {
        file.bytes = Buffer.alloc(LOG_BYTES.length, 0x7a)
        file.mtime += 1
      }
    }
    await expect(read(LOG)).rejects.toThrow(REMOTE_FILE_CHANGED_DURING_READ_MESSAGE)

    readChunks = 0
    host.set(LOG, staleLog())
    afterChunk = (file, count) => {
      if (count === 2) {
        file.bytes = Buffer.concat([LOG_BYTES, Buffer.from('new file\n')])
        file.fileId = '1:8'
        file.mtime += 1
      }
    }
    await expect(read(LOG)).rejects.toThrow(REMOTE_FILE_CHANGED_DURING_READ_MESSAGE)
  })

  it('reads a small log whose grant went stale without renewing', async () => {
    const small = Buffer.from('tail -f me\n')
    host.set('/var/log/small.log', staleLog(small, '1:9'))

    await expect(read('/var/log/small.log')).resolves.toEqual({
      content: 'tail -f me\n',
      isBinary: false,
      terminalArtifactGrantId: 'g-1'
    })
    expect(methodsCalled()).not.toContain('files.resolveTerminalPath')
    // Small enough to save through the grant, so the tabs stay writable.
    expect(useAppStore.getState().openFiles[0]?.readOnly).toBeUndefined()
  })

  it('tells a large binary from its first bytes, without paging it', async () => {
    host.set('/data/model.safetensors', {
      bytes: Buffer.concat([Buffer.from([0x7b, 0, 0, 0]), Buffer.alloc(2 * 1024 * 1024, 1)]),
      fileId: '1:11',
      mtime: 1,
      refusal: 'terminal_file_grant_stale'
    })

    await expect(read('/data/model.safetensors')).resolves.toEqual({
      content: '',
      isBinary: true,
      readOnly: true,
      terminalArtifactGrantId: 'g-1'
    })
    expect(readChunks).toBe(1)
  })

  it('leaves binaries to upstream, and keeps the refusal on a host without these reads', async () => {
    host.set('/home/me/shot.png', {
      bytes: Buffer.alloc(8),
      fileId: '1:13',
      mtime: 1,
      refusal: 'binary_file'
    })
    await expect(read('/home/me/shot.png')).resolves.toEqual({
      ...PNG_PREVIEW,
      readOnly: true,
      terminalArtifactGrantId: 'g-1'
    })

    legacyHost = true
    await expect(read(LOG)).rejects.toThrow(
      'Remote file is larger than the 512 KB this Orca server can send. Update the server to open it.'
    )
  })

  it('pages an image or PDF past the grant preview reply, and shows any other binary as one', async () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(900 * 1024, 0x20)])
    host.set('/home/me/paper.pdf', {
      bytes: pdf,
      fileId: '1:14',
      mtime: 1,
      refusal: 'binary_file',
      preview: 'file_too_large'
    })
    host.set('/data/weights.zip', {
      bytes: Buffer.alloc(900 * 1024, 1),
      fileId: '1:15',
      mtime: 1,
      refusal: 'binary_file',
      preview: 'file_too_large'
    })

    await expect(read('/home/me/paper.pdf')).resolves.toEqual({
      content: pdf.toString('base64'),
      isBinary: true,
      isImage: true,
      mimeType: 'application/pdf',
      readOnly: true,
      terminalArtifactGrantId: 'g-1'
    })
    const pdfChunks = readChunks
    expect(pdfChunks).toBeGreaterThan(1)
    host.set('/data/small.zip', {
      bytes: Buffer.alloc(64, 1),
      fileId: '1:16',
      mtime: 1,
      refusal: 'binary_file',
      preview: 'binary_file'
    })
    const binary = {
      content: '',
      isBinary: true,
      readOnly: true,
      terminalArtifactGrantId: 'g-1'
    }
    await expect(read('/data/weights.zip')).resolves.toEqual(binary)
    await expect(read('/data/small.zip')).resolves.toEqual(binary)
    expect(readChunks).toBe(pdfChunks)

    legacyHost = true
    await expect(read('/home/me/paper.pdf')).rejects.toThrow('file_too_large')
  })

  it('refuses an image whose header proves it too large to decode, before paging it', async () => {
    const header = Buffer.alloc(33)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header)
    header.writeUInt32BE(13, 8)
    header.write('IHDR', 12, 'latin1')
    header.writeUInt32BE(20_000, 16)
    header.writeUInt32BE(20_000, 20)
    header.writeUInt8(8, 24)
    header.writeUInt8(6, 25)
    host.set('/home/me/scan.png', {
      bytes: Buffer.concat([header, Buffer.alloc(900 * 1024)]),
      fileId: '1:17',
      mtime: 1,
      refusal: 'binary_file',
      preview: 'file_too_large'
    })

    await expect(read('/home/me/scan.png')).rejects.toThrow(RASTER_IMAGE_PREVIEW_TOO_LARGE_ERROR)
    expect(readChunks).toBe(1)
    expect(methodsCalled()).not.toContain('files.hostFile.stat')
  })
})
