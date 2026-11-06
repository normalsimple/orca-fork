// 更深工作区打开同一路径后，把外层可写标签降为只读。只读标记随会话保存，重启后仍是只读。
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { OpenFile } from '@/store/slices/editor'
import { findWorkspaceFileRoute } from '@/lib/runtime-workspace-file-route'
import { getOpenFileExecutionHostId } from '@/lib/unified-tab-host-ownership'
import {
  demoteShallowerWritableCopies,
  terminalFileLinkCopyTouchedPaths
} from './file-link-nested-copy'

let unwatch: (() => void) | undefined

export function resetNestedCopyDemotionForTests(): void {
  unwatch?.()
  unwatch = undefined
}

function tabHasUnsavedEdits(state: AppState, file: OpenFile): boolean {
  if (state.editorDrafts?.[file.id] !== undefined) {
    return true
  }
  const recordId = state.editorBufferIdOf?.[file.id]
  return recordId !== undefined && state.editorBuffers?.[recordId]?.isDirty === true
}

// 工作区列表晚到时，两张可写标签都没变，仍要整表再查。
function workspaceCatalogChanged(state: AppState, previous: AppState): boolean {
  return (
    state.worktreesByRepo !== previous.worktreesByRepo ||
    state.folderWorkspaces !== previous.folderWorkspaces
  )
}

function ownerLookupPaths(
  recheckAll: boolean,
  previousFiles: readonly OpenFile[] | null,
  state: AppState,
  previousDrafts: Record<string, string> | undefined,
  unresolved: ReadonlySet<string>
): Set<string> | null {
  if (recheckAll || previousFiles === null) {
    return null
  }
  const touched = terminalFileLinkCopyTouchedPaths(
    previousFiles,
    state.openFiles,
    previousDrafts,
    state.editorDrafts
  )
  // 上次没解析出归属的路径，这次即使标签没变也再查。
  for (const filePath of unresolved) {
    touched.add(filePath)
  }
  return touched
}

function retainUnresolvedEditPaths(unresolved: Set<string>, openFiles: readonly OpenFile[]): void {
  const retryable = new Set(
    openFiles
      .filter((file) => file.readOnly !== true && (file.mode === undefined || file.mode === 'edit'))
      .map((file) => file.filePath)
  )
  for (const filePath of unresolved) {
    if (!retryable.has(filePath)) {
      unresolved.delete(filePath)
    }
  }
}

function shallowerCopyDemotion(
  state: AppState,
  previousFiles: readonly OpenFile[] | null,
  previousDrafts: Record<string, string> | undefined,
  unresolved: Set<string>,
  recheckAll: boolean
): OpenFile[] | null {
  retainUnresolvedEditPaths(unresolved, state.openFiles)
  if (state.worktreesByRepo == null && state.folderWorkspaces == null) {
    return null
  }
  const touched = ownerLookupPaths(recheckAll, previousFiles, state, previousDrafts, unresolved)
  return demoteShallowerWritableCopies(
    state.openFiles,
    (file) => {
      if (touched && !touched.has(file.filePath)) {
        return null
      }
      const route = findWorkspaceFileRoute(state, getOpenFileExecutionHostId(file), file.filePath)
      if (route) {
        unresolved.delete(file.filePath)
      } else {
        unresolved.add(file.filePath)
      }
      return route && route.worktreeId !== file.worktreeId ? route.worktreeId : null
    },
    getOpenFileExecutionHostId,
    (file) => tabHasUnsavedEdits(state, file)
  )
}

// 没有「留在当前工作区」开关。本地文件留在点击时的工作区，可写（上游 #37953）；这里只看外层标签。
export function registerNestedCopyDemotion(): void {
  if (unwatch) {
    return
  }
  const initial = useAppStore.getState()
  let openFiles: readonly OpenFile[] = initial.openFiles
  let drafts = initial.editorDrafts
  let catalog = initial
  const unresolved = new Set<string>()
  const initialDemoted = shallowerCopyDemotion(initial, null, undefined, unresolved, true)
  if (initialDemoted) {
    openFiles = initialDemoted
    useAppStore.setState({ openFiles: initialDemoted })
  }
  unwatch = useAppStore.subscribe((state) => {
    const recheckAll = workspaceCatalogChanged(state, catalog)
    catalog = state
    if (!recheckAll && state.openFiles === openFiles && state.editorDrafts === drafts) {
      return
    }
    const demoted = shallowerCopyDemotion(state, openFiles, drafts, unresolved, recheckAll)
    drafts = state.editorDrafts
    openFiles = demoted ?? state.openFiles
    if (demoted) {
      useAppStore.setState({ openFiles: demoted })
    }
  })
}
