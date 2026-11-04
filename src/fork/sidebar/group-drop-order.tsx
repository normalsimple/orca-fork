// Manual-order values a cross-group drop writes. Kept apart from the write plan so each stays small.
import { normalizeExecutionHostId } from '../../shared/execution-host'
import { folderWorkspaceToWorktree } from '../../shared/folder-workspaces/folder-workspace-worktree'
import {
  getWorktreeHostIdentity,
  getWorktreeIdFromHostIdentity
} from '../../shared/worktree/host-qualified-identity'
import type { Worktree } from '../../shared/worktree/types'
import { folderWorkspaceKey } from '../../shared/workspace-scope'
import type { WorktreeDragGroup } from '../../renderer/src/components/sidebar/worktree-list/drag/worktree-manual-order'
import { manualOrderKey, manualOrderedRows } from './manual-order'
import { parseHostDirectorySectionKey } from './section-keys'
import type { GroupDropState, GroupDropTarget } from './workspace-group-drop-plan'

export const GROUP_DROP_ORDER_STRIDE = 1000
/** Smallest step kept between two ranks; below it the section is renumbered instead. */
export const GROUP_DROP_MIN_ORDER_STEP = 1e-6

type OrderUpdates = ReadonlyMap<string, { manualOrder: number }>

/** Every row's manual-sort key (manual-order.ts), the one the sidebar draws by, by host identity. */
function effectiveOrderKeys(rows: readonly Worktree[]): Map<string, number> {
  return new Map(rows.map((row) => [getWorktreeHostIdentity(row), manualOrderKey(row)]))
}

/** True when the keys explain the order: never rising from one row to the next. */
function keysFollowOrder(order: readonly string[], keys: ReadonlyMap<string, number>): boolean {
  for (let index = 1; index < order.length; index += 1) {
    const previous = keys.get(order[index - 1]!)
    const current = keys.get(order[index]!)
    if (previous === undefined || current === undefined || !(previous >= current)) {
      return false
    }
  }
  return true
}

// A step this small would round away or tie at the size of these keys (doubles near 1.7e12, a
// Date.now() rank, are only about 2e-4 apart), so it is not a real "strictly between".
function minStep(before: number, after: number): number {
  return Math.max(
    GROUP_DROP_MIN_ORDER_STEP,
    Math.max(Math.abs(before), Math.abs(after)) * Number.EPSILON * 16
  )
}

/** Ranks strictly between the neighbours, or null when they tie or the gap is used up. */
function ranksBetween(before: number, after: number, count: number): number[] | null {
  const step = (before - after) / (count + 1)
  if (!Number.isFinite(step) || step < minStep(before, after)) {
    return null
  }
  const ranks = Array.from({ length: count }, (_, index) => before - step * (index + 1))
  const chain = [before, ...ranks, after]
  const strict = chain.every((value, index) => index === 0 || chain[index - 1]! > value)
  return strict ? ranks : null
}

/**
 * The target section in the order it shows, with the dragged rows taken out. Rows the section
 * holds but does not show (`hidden`) keep their place after the visible row they follow now.
 */
function sectionOrder(
  orderedIds: readonly string[],
  visibleRest: readonly string[],
  hiddenRest: readonly string[]
): string[] {
  const visibleSet = new Set(visibleRest)
  const hiddenSet = new Set(hiddenRest)
  const anchored = new Map<string | null, string[]>()
  let previous: string | null = null
  for (const id of orderedIds) {
    if (visibleSet.has(id)) {
      previous = id
    } else if (hiddenSet.has(id)) {
      anchored.set(previous, [...(anchored.get(previous) ?? []), id])
    }
  }
  return [
    ...(anchored.get(null) ?? []),
    ...visibleRest.flatMap((id) => [id, ...(anchored.get(id) ?? [])])
  ]
}

function storedManualOrders(state: GroupDropState): Map<string, number | undefined> {
  const stored = new Map<string, number | undefined>()
  for (const row of Object.values(state.worktreesByRepo).flat()) {
    stored.set(getWorktreeHostIdentity(row), row.manualOrder)
  }
  for (const workspace of state.folderWorkspaces) {
    const row = folderWorkspaceToWorktree(workspace)
    stored.set(getWorktreeHostIdentity(row), row.manualOrder)
  }
  return stored
}

/** The host identity a dragged id has on the drop's host, the key drag groups use for that card. */
function draggedRowKey(state: GroupDropState, id: string, hostId: string): string | null {
  const folder = state.folderWorkspaces.find(
    (entry) => entry.id === id || folderWorkspaceKey(entry.id) === id
  )
  if (folder) {
    return getWorktreeHostIdentity(folderWorkspaceToWorktree(folder))
  }
  const host = normalizeExecutionHostId(hostId)
  const worktree = host ? state.getKnownWorktreeById(id, host) : undefined
  return worktree ? getWorktreeHostIdentity(worktree) : null
}

function changedOnly(
  ranked: readonly (readonly [string, number])[],
  moved: ReadonlySet<string>,
  stored: ReadonlyMap<string, number | undefined>
): OrderUpdates {
  const updates = new Map<string, { manualOrder: number }>()
  for (const [id, manualOrder] of ranked) {
    if (moved.has(id) || stored.get(id) !== manualOrder) {
      updates.set(id, { manualOrder })
    }
  }
  return updates
}

/**
 * Evenly renumbers the target section with the moved rows at the drop point, so the result is
 * exactly where the user dropped. Rows whose stored manual order already has the new value are
 * not written again; the moved rows always are. Values start at the section's own top key, so they
 * can pass rows of other sections: the last resort when renumberWithinList finds no room.
 */
function renumberSection(
  state: GroupDropState,
  order: readonly string[],
  moved: readonly string[],
  keys: ReadonlyMap<string, number>,
  now: number
): OrderUpdates {
  const finite = order.flatMap((id) => {
    const key = keys.get(id)
    return key !== undefined && Number.isFinite(key) ? [key] : []
  })
  const top = finite.length > 0 ? Math.max(...finite) : now
  return changedOnly(
    order.map((id, index) => [id, top - index * GROUP_DROP_ORDER_STRIDE] as const),
    new Set(moved),
    storedManualOrders(state)
  )
}

/**
 * Renumbers only the run of target-section rows around the drop, inside the gap its neighbours
 * from other sections leave in the full list. Every other row keeps its key, so the order across
 * all rows (what another group-by mode shows) is unchanged apart from the moved rows. Returns null
 * when `order` does not follow the full list or those neighbours leave no room.
 */
function renumberWithinList(
  state: GroupDropState,
  globalOrder: readonly string[],
  order: readonly string[],
  moved: readonly string[],
  keys: ReadonlyMap<string, number>,
  now: number
): OrderUpdates | null {
  const movedSet = new Set(moved)
  const first = order.findIndex((id) => movedSet.has(id))
  const prev = first > 0 ? order[first - 1] : undefined
  const next = order[first + moved.length]
  const section = new Set(order)
  const fixedAndSection = globalOrder.filter((id) => !movedSet.has(id) && keys.has(id))
  const inSection = fixedAndSection.filter((id) => section.has(id))
  const sectionRest = order.filter((id) => !movedSet.has(id))
  if (
    first === -1 ||
    inSection.length !== sectionRest.length ||
    inSection.some((id, index) => sectionRest[index] !== id)
  ) {
    return null
  }
  const full = [...fixedAndSection]
  const anchor = prev !== undefined ? full.indexOf(prev) + 1 : next ? full.indexOf(next) : -1
  if (anchor < 0) {
    return null
  }
  full.splice(anchor, 0, ...moved)
  let start = anchor
  while (start > 0 && section.has(full[start - 1]!)) {
    start -= 1
  }
  let end = anchor + moved.length
  while (end < full.length && section.has(full[end]!)) {
    end += 1
  }
  const run = full.slice(start, end)
  const upper = start > 0 ? keys.get(full[start - 1]!) : undefined
  const lower = end < full.length ? keys.get(full[end]!) : undefined
  let values: number[] | null
  if (upper !== undefined && lower !== undefined) {
    values = ranksBetween(upper, lower, run.length)
  } else if (upper !== undefined) {
    values = run.map((_, index) => upper - (index + 1) * GROUP_DROP_ORDER_STRIDE)
  } else if (lower !== undefined) {
    values = run.map((_, index) => lower + (run.length - index) * GROUP_DROP_ORDER_STRIDE)
  } else {
    const finite = run.flatMap((id) => {
      const key = keys.get(id)
      return key !== undefined && Number.isFinite(key) ? [key] : []
    })
    const top = finite.length > 0 ? Math.max(...finite) : now
    values = run.map((_, index) => top - index * GROUP_DROP_ORDER_STRIDE)
  }
  if (!values || values.some((value) => !Number.isFinite(value))) {
    return null
  }
  return changedOnly(
    run.map((id, index) => [id, values[index]!] as const),
    movedSet,
    storedManualOrders(state)
  )
}

/**
 * Manual-order values for a drop under manual sort, computed from the order the sidebar shows (the
 * target group's rows as drawn, plus rows it holds but does not show, each after the shown row it
 * follows in manual order), so the drop lands where the insertion line was. Normally only the
 * dragged rows are written, placed between their new neighbours' manual-sort keys: upstream's
 * group-drop ranking renumbers every row as soon as one still sorts by sortOrder, which reshuffled
 * the whole ungrouped list. When the neighbours tie, or the gap between them has no room left for
 * a value strictly between, or the keys do not explain the shown order (a lineage child drawn
 * under its parent), the target section's rows around the drop are renumbered in their shown
 * order, the moved rows at the drop point. Those values stay inside the gap left by rows of other
 * sections, so the order across the full list is kept; only when that gap has no room either is
 * the whole section renumbered from its own top. Only the returned rows change.
 *
 * Rows are told apart by host identity: a same-id workspace on another host keeps its own key and
 * place. `belongsToTarget` gets host identities; the result is keyed by workspace id, since every
 * written row is on the target section's host.
 */
export function buildGroupDropOrder(
  state: GroupDropState,
  groups: readonly WorktreeDragGroup[],
  target: GroupDropTarget,
  draggedIds: readonly string[],
  dropIndex: number,
  belongsToTarget: (key: string) => boolean,
  now = Date.now()
): OrderUpdates {
  const hostId = parseHostDirectorySectionKey(target.key)?.hostId ?? ''
  const draggedKeys = draggedIds.flatMap((id) => draggedRowKey(state, id, hostId) ?? [])
  const byKey = buildGroupDropOrderByKey(
    state,
    groups.find((group) => group.key === target.key)?.worktreeIds ?? [],
    groups.flatMap((group) => group.worktreeIds),
    draggedKeys,
    dropIndex,
    belongsToTarget,
    now
  )
  return new Map(
    [...byKey].map(([key, update]) => [getWorktreeIdFromHostIdentity(key), update] as const)
  )
}

function buildGroupDropOrderByKey(
  state: GroupDropState,
  visible: readonly string[],
  shownKeys: readonly string[],
  draggedKeys: readonly string[],
  dropIndex: number,
  belongsToTarget: (key: string) => boolean,
  now: number
): OrderUpdates {
  const rows = manualOrderedRows(
    Object.values(state.worktreesByRepo).flat(),
    state.folderWorkspaces
  )
  const orderedIds = rows.map((row) => getWorktreeHostIdentity(row))
  const keys = effectiveOrderKeys(rows)
  const visibleSet = new Set(visible)
  const dragged = new Set(draggedKeys)
  const hidden = orderedIds.filter(
    (id) => !visibleSet.has(id) && !dragged.has(id) && belongsToTarget(id)
  )
  const shown = shownKeys.filter((id) => dragged.has(id))
  const moved = [...new Set([...shown, ...draggedKeys])]
  // The drop index counts the rows the target group shows.
  const bounded = Math.max(0, Math.min(dropIndex, visible.length))
  const removedBefore = visible.slice(0, bounded).filter((id) => dragged.has(id)).length
  const visibleRest = visible.filter((id) => !dragged.has(id))
  const at = Math.max(0, Math.min(visibleRest.length, bounded - removedBefore))
  // Hidden rows sit where manual order puts them, so a drop after the last shown row is a real end
  // drop, not a gap before every hidden row.
  const section = sectionOrder(orderedIds, visibleRest, hidden)
  const insertAt =
    at > 0
      ? section.indexOf(visibleRest[at - 1]!) + 1
      : visibleRest.length > 0
        ? section.indexOf(visibleRest[0]!)
        : section.length
  const order = [...section.slice(0, insertAt), ...moved, ...section.slice(insertAt)]
  const renumber = (): OrderUpdates =>
    renumberWithinList(state, orderedIds, order, moved, keys, now) ??
    renumberSection(state, order, moved, keys, now)
  const before = insertAt > 0 ? keys.get(section[insertAt - 1]!) : undefined
  const after = insertAt < section.length ? keys.get(section[insertAt]!) : undefined
  const count = moved.length
  if (before === undefined && after === undefined) {
    return new Map(
      moved.map((id, index) => [id, { manualOrder: now - index * GROUP_DROP_ORDER_STRIDE }])
    )
  }
  if (!keysFollowOrder(section, keys)) {
    return renumber()
  }
  if (before === undefined) {
    return new Map(
      moved.map((id, index) => [
        id,
        { manualOrder: after! + (count - index) * GROUP_DROP_ORDER_STRIDE }
      ])
    )
  }
  if (after === undefined) {
    return new Map(
      moved.map((id, index) => [
        id,
        { manualOrder: before - (index + 1) * GROUP_DROP_ORDER_STRIDE }
      ])
    )
  }
  const between = ranksBetween(before, after, count)
  return between
    ? new Map(moved.map((id, index) => [id, { manualOrder: between[index]! }]))
    : renumber()
}
