// F046：别的工作区认领的 HTML 留在点击时的工作区做文档预览，不激活归属工作区。
// 普通文件不再改成只读，走上游 #38072。
// .tsx 才能引用渲染进程别名；node 工程只包含 src/fork/**/*.ts。
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { OpenFile } from '@/store/slices/editor'
import {
  acquireTerminalArtifactGrant,
  pinTerminalArtifactGrantTarget
} from '@/runtime/runtime-terminal-artifact-grant'
import { isHtmlFilePath } from '@/components/terminal-pane/local-html-file-destinations'
import { findWorkspaceFileRoute } from '@/lib/runtime-workspace-file-route'
import { getOpenFileExecutionHostId } from '@/lib/unified-tab-host-ownership'
import { isFloatingWorkspaceId } from '../../shared/floating-workspace-worktree'
import type { RuntimeTerminalPathResolution } from '../../shared/runtime-file-contracts'
import {
  registerKeptHostFileViews,
  type KeptHostFile,
  type KeptHostFileSource
} from '../../shared/fork-hooks/kept-host-file-view'

async function keepHtmlInClickedWorkspace(
  { target, worktreeId }: KeptHostFileSource,
  resolved: RuntimeTerminalPathResolution
): Promise<KeptHostFile | null> {
  // 调用点已经按 HTML 过滤；这里再挡一次，避免非 HTML 重新变成只读授权。
  if (!resolved.absolutePath || !isHtmlFilePath(resolved.absolutePath)) {
    return null
  }
  if (target.kind !== 'environment' || !worktreeId || isFloatingWorkspaceId(worktreeId)) {
    return null
  }
  // 目录和工作区根仍激活归属工作区。点在自己工作区里的 HTML 也不拦。
  if (resolved.isDirectory || !resolved.relativePath || resolved.worktree === worktreeId) {
    return null
  }
  try {
    // 不带 crossWorkspace：授权发给点击时的工作区，路由就把它当成工作区外文件，预览不切走。
    const granted = await acquireTerminalArtifactGrant(
      pinTerminalArtifactGrantTarget({ target, worktreeId, absolutePath: resolved.absolutePath })
    )
    return granted
      ? {
          kind: 'grant',
          absolutePath: granted.absolutePath,
          grantId: granted.grantId,
          isDirectory: false,
          readOnly: true
        }
      : null
  } catch {
    // #33958 之前的主机只授权终端打印过的路径，拿不到就保持上游的切换。
    return null
  }
}

/**
 * 这一层以前把非 HTML 存成只读：relativePath 就是绝对路径，带 runtimeEnvironmentId，授权 id 不进会话。
 * 实时日志、浮动工作区、已经挂上授权的标签都不是它。
 */
function isStaleKeptHostFileTab(file: OpenFile): boolean {
  return (
    file.readOnly === true &&
    file.liveTail !== true &&
    file.relativePath === file.filePath &&
    Boolean(file.runtimeEnvironmentId?.trim()) &&
    !file.terminalArtifactGrantId &&
    !isFloatingWorkspaceId(file.worktreeId)
  )
}

/**
 * 别的工作区认领、且这次还没挂授权的旧标签，去掉只读。
 * 加载器随后走上游：小文本在当前工作区可写打开，更大或二进制重挂到归属工作区。
 * 重挂会抄走当时的字段，所以只读要先去掉。
 * 没有别的工作区认领的不动：工作区外超过 512 KiB 的只读、相对路径还在的嵌套降级只读，都不是这一层留下的。
 * 已经挂上授权的也不动，避免把这次分段读刚标上的只读清掉；授权不进会话，下次启动授权不在了再按上面的规则走。
 * skip 里的标签不再清：嵌套降级可能刚把只读加回去，再清就会和它来回改。
 * 没有要改的标签时返回 null。
 */
const noSkippedTabs = new Set<string>()

/** holderWorktreeId 返回认领该路径的工作区；没有别的工作区认领时返回 null。 */
export function releaseStaleKeptHostFileReadOnly(
  openFiles: readonly OpenFile[],
  holderWorktreeId: (file: OpenFile) => string | null,
  skip: ReadonlySet<string> = noSkippedTabs
): OpenFile[] | null {
  let changed = false
  const next = openFiles.map((file) => {
    if (skip.has(file.id) || !isStaleKeptHostFileTab(file)) {
      return file
    }
    const holder = holderWorktreeId(file)
    if (!holder || holder === file.worktreeId) {
      return file
    }
    changed = true
    const { readOnly: _staleReadOnly, ...released } = file
    return released
  })
  return changed ? next : null
}

let unwatch: (() => void) | undefined

/** 会话恢复时工作区列表往往已经在；列表后到也再查一次。 */
export function registerStaleKeptHostFileReadOnlyRelease(): void {
  if (unwatch) {
    return
  }
  let openFiles = useAppStore.getState().openFiles
  let worktreesByRepo = useAppStore.getState().worktreesByRepo
  let folderWorkspaces = useAppStore.getState().folderWorkspaces
  const alreadyReleased = new Set<string>()
  const apply = (state: AppState): void => {
    const catalogChanged =
      state.worktreesByRepo !== worktreesByRepo || state.folderWorkspaces !== folderWorkspaces
    worktreesByRepo = state.worktreesByRepo
    folderWorkspaces = state.folderWorkspaces
    if (!catalogChanged && state.openFiles === openFiles) {
      return
    }
    const released = releaseStaleKeptHostFileReadOnly(
      state.openFiles,
      (file) =>
        findWorkspaceFileRoute(state, getOpenFileExecutionHostId(file), file.filePath)
          ?.worktreeId ?? null,
      alreadyReleased
    )
    if (!released) {
      openFiles = state.openFiles
      return
    }
    for (let index = 0; index < released.length; index += 1) {
      if (released[index] !== state.openFiles[index]) {
        alreadyReleased.add(released[index].id)
      }
    }
    openFiles = released
    useAppStore.setState({ openFiles: released })
  }
  unwatch = useAppStore.subscribe(apply)
  apply(useAppStore.getState())
}

export function resetStaleKeptHostFileReadOnlyReleaseForTests(): void {
  unwatch?.()
  unwatch = undefined
}

export function registerKeptHostFileViewHooks(): void {
  registerKeptHostFileViews(keepHtmlInClickedWorkspace)
}
