// fork: wire form for clearing a workspace's own sidebar group or manual order.
// Why: `null` already means "ungrouped" and JSON drops `undefined`, so a clear travels as a
// sibling `clearFields` list and the host turns it back into an absent field.

export const CLEARABLE_SIDEBAR_FIELDS = ['sidebarGroupId', 'manualOrder'] as const
export type ClearableSidebarField = (typeof CLEARABLE_SIDEBAR_FIELDS)[number]

/** The sidebar fields of a worktree's meta and of a folder workspace. */
export type SidebarFields = { sidebarGroupId?: string | null; manualOrder?: number }

/** Fields present on `updates` with the value `undefined`: the caller asked to clear them. */
export function sidebarFieldsToClear(updates: SidebarFields): ClearableSidebarField[] {
  return CLEARABLE_SIDEBAR_FIELDS.filter(
    (field) => Object.hasOwn(updates, field) && updates[field] === undefined
  )
}

/** 文件夹工作区更新的线协议：id 与清除字段放在同一条请求里。 */
export function folderWorkspaceUpdateRequest<T extends SidebarFields>(
  folderWorkspaceId: string,
  updates: T
): { folderWorkspaceId: string; updates: T; clearFields?: ClearableSidebarField[] } {
  return { folderWorkspaceId, ...encodeSidebarFieldClears(updates) }
}

/** Splits requested clears out of `updates` for the wire. */
export function encodeSidebarFieldClears<T extends SidebarFields>(
  updates: T
): { updates: T; clearFields?: ClearableSidebarField[] } {
  const clearFields = sidebarFieldsToClear(updates)
  if (clearFields.length === 0) {
    return { updates }
  }
  const rest = { ...updates }
  for (const field of clearFields) {
    Reflect.deleteProperty(rest, field)
  }
  return { updates: rest, clearFields }
}

/** For untyped IPC input: keeps only known field names. */
export function parseClearableSidebarFields(value: unknown): ClearableSidebarField[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  return CLEARABLE_SIDEBAR_FIELDS.filter((field) => value.includes(field))
}

/**
 * Host side, in place: each cleared field becomes an own `undefined` key on `updates`, which the
 * spread merge of the write removes.
 */
export function applySidebarFieldClears(
  updates: SidebarFields,
  clearFields: readonly ClearableSidebarField[] | undefined
): void {
  for (const field of clearFields ?? []) {
    updates[field] = undefined
  }
}

/** `worktrees:updateMeta` declares no `clearFields`, so its raw IPC args are parsed here. */
export function applySidebarFieldClearsFromIpcArgs(updates: SidebarFields, ipcArgs: unknown): void {
  if (typeof ipcArgs === 'object' && ipcArgs !== null && 'clearFields' in ipcArgs) {
    applySidebarFieldClears(updates, parseClearableSidebarFields(ipcArgs.clearFields))
  }
}

/** Host side, as an expression: `updates` with the cleared fields as own `undefined` keys. */
export function decodeSidebarFieldClears<T extends SidebarFields>(
  updates: T,
  clearFields: readonly ClearableSidebarField[] | undefined
): T {
  if (!clearFields || clearFields.length === 0) {
    return updates
  }
  const next = { ...updates }
  applySidebarFieldClears(next, clearFields)
  return next
}

/**
 * The worktree.set reply: each sidebar field this write set or cleared, as the store holds it after
 * the write. `show` may resolve a row whose projection lacks the field; echoing the request instead
 * would hide a store that did not apply it. An older host has no echo, so its reply still lacks a
 * group it dropped and the client reports it (fork/sidebar/sidebar-fields-applied).
 */
export function echoSidebarFields<T extends SidebarFields>(
  shown: T,
  updates: SidebarFields,
  written: SidebarFields | undefined
): T {
  const echoed = { ...shown }
  if (Object.hasOwn(updates, 'sidebarGroupId')) {
    if (written?.sidebarGroupId === undefined) {
      delete echoed.sidebarGroupId
    } else {
      echoed.sidebarGroupId = written.sidebarGroupId
    }
  }
  if (Object.hasOwn(updates, 'manualOrder')) {
    if (written?.manualOrder === undefined) {
      delete echoed.manualOrder
    } else {
      echoed.manualOrder = written.manualOrder
    }
  }
  return echoed
}

/**
 * True when a host answered without the requested group or clear, e.g. an older host whose schema
 * strips them. Folder writes reconcile; worktree writes fail (fork/sidebar/sidebar-fields-applied).
 */
export function folderSidebarFieldsNotApplied(
  updates: SidebarFields,
  updated: SidebarFields
): boolean {
  if (updates.sidebarGroupId !== undefined && updated.sidebarGroupId !== updates.sidebarGroupId) {
    return true
  }
  return sidebarFieldsToClear(updates).some((field) => updated[field] !== undefined)
}

/** 宿主回复丢掉了这次写入的字段：上游的可选字段，以及侧栏分组和清除。 */
export function folderWorkspaceUpdateNotApplied(
  updates: SidebarFields & { diffComments?: unknown; linkedItems?: unknown },
  updated: SidebarFields & { diffComments?: unknown; linkedItems?: unknown }
): boolean {
  return (
    (updates.diffComments !== undefined && updated.diffComments === undefined) ||
    (updates.linkedItems !== undefined && updated.linkedItems === undefined) ||
    folderSidebarFieldsNotApplied(updates, updated)
  )
}

/**
 * 把解码后的侧栏字段写进文件夹工作区。
 * 字段自己的 `undefined` 表示清除，不能和「这次没改」混在一起。
 */
export function applyFolderSidebarFieldUpdate(
  workspace: SidebarFields,
  updates: SidebarFields
): void {
  if (updates.sidebarGroupId !== undefined) {
    workspace.sidebarGroupId = updates.sidebarGroupId
  } else if (Object.hasOwn(updates, 'sidebarGroupId')) {
    delete workspace.sidebarGroupId
  }
  if (updates.manualOrder === undefined && Object.hasOwn(updates, 'manualOrder')) {
    delete workspace.manualOrder
  }
}
