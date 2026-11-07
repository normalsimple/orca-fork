// F046: documents a paired host keeps outside the clicked workspace render in the doc preview.
// .tsx because it imports renderer aliases; the node project only includes src/fork/**/*.ts.
import { dirname } from '@/lib/path'
import { findWorkspaceFileRoute } from '@/lib/runtime-workspace-file-route'
import { readHostFilePreview } from '@/runtime/files/grants/runtime-terminal-artifact-read'
import { toRuntimeWorktreeSelector } from '@/runtime/runtime-worktree-selector'
import { useAppStore } from '@/store'
import { toRuntimeExecutionHostId } from '../../shared/execution-host'
import { isWindowsAbsolutePathLike, normalizeRelativePath } from '../../shared/cross-platform-path'
import {
  registerHostFileDocPreview,
  type HostFileDocLocation
} from '../../shared/fork-hooks/host-file-doc-preview'

const DRIVE_ROOT = /^[A-Za-z]:[\\/]/

/** The filesystem root a host path hangs from: `/`, or a drive root. Null for a UNC share. */
function filesystemRoot(filePath: string): string | null {
  const drive = DRIVE_ROOT.exec(filePath)?.[0]
  if (drive) {
    return `${drive.slice(0, 2)}\\`
  }
  return filePath.startsWith('/') && !isWindowsAbsolutePathLike(filePath) ? '/' : null
}

/** A drive's root keeps its separator: `C:` alone names the drive's current folder. */
function documentFolder(filePath: string): string {
  const folder = dirname(filePath)
  return /^[A-Za-z]:$/.test(folder) ? `${folder}\\` : folder
}

function documentLocation(args: {
  environmentId: string
  worktreeId: string
  worktreeRoot: string
  filePath: string
}): HostFileDocLocation {
  const { environmentId, filePath } = args
  const state = useAppStore.getState()
  const holder = findWorkspaceFileRoute(state, toRuntimeExecutionHostId(environmentId), filePath)
  const holderRoot = holder ? state.getKnownWorktreeById(holder.worktreeId)?.path : undefined
  const root = documentFolder(filePath)
  // Another workspace's document reads through that workspace, as upstream previews it there.
  if (holder && holderRoot) {
    return {
      owner: {
        kind: 'runtime',
        environmentId,
        worktreeSelector: toRuntimeWorktreeSelector(holder.worktreeId),
        worktreeRoot: holderRoot
      },
      requestBase: holderRoot,
      root,
      entryRelativePath: holder.relativePath
    }
  }
  // Outside every workspace the page resolves paths as from file://: `..`, other folders, any file.
  const base = filesystemRoot(filePath) ?? root
  return {
    owner: {
      kind: 'runtime',
      environmentId,
      worktreeSelector: toRuntimeWorktreeSelector(args.worktreeId),
      worktreeRoot: args.worktreeRoot
    },
    requestBase: base,
    root,
    // The '/'-joined form the preview's URLs come back in; a doubled separator would name nothing.
    entryRelativePath: normalizeRelativePath(filePath.slice(base.length), base)
  }
}

export function registerHostFileDocPreviews(): void {
  registerHostFileDocPreview({
    location: documentLocation,
    // Past one reply, the grant preview's image is paged by large-host-file-read.
    readDocumentResource: (target, worktreeId, absolutePath) =>
      readHostFilePreview({ target, worktreeId, absolutePath })
  })
}
