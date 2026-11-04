// fork: 删除项目群组对话框的附加选项。未注册时不渲染，删除参数保持原值。

import type { ReactNode } from 'react'
import type { FolderWorkspace } from '../folder-workspaces/folder-workspace-types'
import type { PersistedState } from '../persisted-state-types'
import type { ProjectGroup } from '../project-group-types'

export type DeleteProjectGroupDialogOption = {
  id: string
  label: string
  description?: string
  defaultChecked?: boolean
  adjustRemoveContainedProjects?: (removeContainedProjects: boolean, checked: boolean) => boolean
}

let option: DeleteProjectGroupDialogOption | undefined
let optionChecked = false
let renderOption: ((disabled: boolean) => ReactNode) | undefined

export function registerDeleteProjectGroupDialogOption(next: DeleteProjectGroupDialogOption): void {
  option = next
  optionChecked = next.defaultChecked === true
}

export function getDeleteProjectGroupDialogOption(): DeleteProjectGroupDialogOption | undefined {
  return option
}

export function setDeleteProjectGroupDialogOptionChecked(checked: boolean): void {
  optionChecked = checked
}

export function registerDeleteProjectGroupOptionRenderer(
  render: (disabled: boolean) => ReactNode
): void {
  renderOption = render
}

/** The option's checkbox in the delete dialog; mounted with the dialog content. */
export function renderDeleteProjectGroupOption(disabled: boolean): ReactNode {
  return option && renderOption ? renderOption(disabled) : null
}

export function resolveDeleteProjectGroupRemoveContainedProjects(
  removeContainedProjects: boolean
): boolean {
  if (!option?.adjustRemoveContainedProjects) {
    return removeContainedProjects
  }
  return option.adjustRemoveContainedProjects(removeContainedProjects, optionChecked)
}

let keepFolderWorkspaces = false

export function registerKeepFolderWorkspacesOnProjectGroupDelete(): void {
  keepFolderWorkspaces = true
}

export function projectGroupDeleteKeepsFolderWorkspaces(): boolean {
  return keepFolderWorkspaces
}

// Main process: what deleting a group does to its folder workspaces. Unregistered, upstream deletes
// them with the group.
type KeepFolderWorkspacesOnGroupDelete = (
  state: PersistedState,
  deletedGroupIds: ReadonlySet<string>
) => () => void

let keepOnGroupDelete: KeepFolderWorkspacesOnGroupDelete | undefined

export function registerKeepFolderWorkspacesOnGroupDeleteInMain(
  next: KeepFolderWorkspacesOnGroupDelete
): void {
  keepOnGroupDelete = next
}

/**
 * Called before the groups leave `state`. Returns the step that keeps their folder workspaces
 * (run it once the groups are gone, instead of upstream's removal), or null when unregistered.
 */
export function prepareKeepFolderWorkspacesOnGroupDelete(
  state: PersistedState,
  deletedGroupIds: ReadonlySet<string>
): (() => void) | null {
  return keepOnGroupDelete ? keepOnGroupDelete(state, deletedGroupIds) : null
}

/**
 * True when a folder workspace may outlive its owning group: loading keeps it, an orcad migration
 * accepts it, and agent hosts resolve from its own fields. Main registers the delete handler; the
 * renderer registers registerKeepFolderWorkspacesOnProjectGroupDelete.
 */
export function folderWorkspacesMayOutliveTheirGroup(): boolean {
  return keepOnGroupDelete !== undefined || keepFolderWorkspaces
}

/**
 * The owner to render a folder workspace with when its group was deleted and it was ungrouped
 * (`sidebarGroupId: null`): a stand-in with its own path and host, so modes that pair every folder
 * workspace with its group still list it. Null otherwise, so a group hidden for host visibility
 * still hides its workspaces.
 */
export function standInGroupForGroupLessFolderWorkspace(
  workspace: Pick<FolderWorkspace, 'projectGroupId'> & Partial<FolderWorkspace>
): ProjectGroup | null {
  if (!folderWorkspacesMayOutliveTheirGroup() || workspace.sidebarGroupId !== null) {
    return null
  }
  return {
    id: workspace.projectGroupId,
    name: workspace.name ?? '',
    parentPath: workspace.folderPath ?? null,
    connectionId: workspace.connectionId ?? null,
    executionHostId: workspace.executionHostId ?? null,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 0,
    updatedAt: 0
  }
}
