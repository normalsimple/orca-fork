// Turns a host-directory occurrence plan into sidebar rows.
import type { ExecutionHostId } from '../../shared/execution-host'
import type { ProjectGroup } from '../../shared/project-group-types'
import { getWorktreeHostIdentity } from '../../shared/worktree/host-qualified-identity'
import type { Worktree } from '../../shared/worktree/types'
import {
  getExpandedWorktreeOccurrences,
  type WorktreeOccurrence
} from '../../shared/worktree-occurrence-plan'
import type { Row } from '../../shared/sidebar-list/row-types'
import { directoryLabelsForHost, groupedCardDirectoryLabel } from './directory-label'
import type { HostDirectoryRenderArgs } from './host-directory-render-args'
import { projectGroupHostId } from './membership'
import {
  appendLooseAndPlaceholders,
  collectHostIds,
  folderMembers,
  groupsByIdOf,
  reposOnHost,
  worktreeMembers,
  workspaceHost
} from './host-directory-sections'
import { PINNED_SECTION_KEY, hostDirectorySectionKey } from './section-keys'
import type { OrderedWorkspace } from './workspace-order'

export type { HostDirectoryRenderArgs } from './host-directory-render-args'

function lineageKey(worktree: Pick<Worktree, 'id' | 'hostId'>): string {
  return `lineage:${worktree.hostId ? getWorktreeHostIdentity(worktree) : worktree.id}`
}

function compareGroups(left: ProjectGroup, right: ProjectGroup): number {
  return left.tabOrder - right.tabOrder || left.name.localeCompare(right.name)
}

export function renderHostDirectoryRows(args: HostDirectoryRenderArgs): Row[] {
  const rows: Row[] = []
  appendPinned(rows, args)
  for (const hostId of collectHostIds(args)) {
    appendHost(rows, args, hostId)
  }
  return rows
}

function appendPinned(rows: Row[], args: HostDirectoryRenderArgs): void {
  const pinned = args.occurrencePlan.sections.find((section) => section.key === PINNED_SECTION_KEY)
  if (!pinned || pinned.items.length === 0) {
    return
  }
  const hostWorktreeCounts = new Map<ExecutionHostId, number>()
  const hostWorktreeIds = new Map<ExecutionHostId, string[]>()
  for (const worktree of pinned.items) {
    const hostId = workspaceHost(worktree, args)
    hostWorktreeCounts.set(hostId, (hostWorktreeCounts.get(hostId) ?? 0) + 1)
    const ids = hostWorktreeIds.get(hostId) ?? []
    ids.push(worktree.id)
    hostWorktreeIds.set(hostId, ids)
  }
  rows.push({
    type: 'header',
    key: PINNED_SECTION_KEY,
    // No label: like upstream's pinned header, the window names it from the icon when it paints,
    // so it follows the UI language.
    count: pinned.items.length,
    icon: { kind: 'pinned' },
    hostWorktreeCounts,
    hostWorktreeIds,
    worktreeIds: pinned.items.map((worktree) => worktree.id)
  })
  if (args.collapsedGroups.has(PINNED_SECTION_KEY)) {
    return
  }
  const labels = new Map<string, string>()
  for (const hostId of new Set(pinned.items.map((worktree) => workspaceHost(worktree, args)))) {
    for (const [key, value] of directoryLabelsForHost(reposOnHost(args, hostId), hostId)) {
      labels.set(key, value)
    }
  }
  appendMemberRows(
    rows,
    args,
    pinned.items.map((worktree) => ({
      kind: 'worktree' as const,
      worktree,
      repo: args.repoOf(worktree)
    })),
    PINNED_SECTION_KEY,
    labels,
    args.defaultHostId,
    0
  )
}

function appendHost(rows: Row[], args: HostDirectoryRenderArgs, hostId: ExecutionHostId): void {
  const labels = directoryLabelsForHost(reposOnHost(args, hostId), hostId)
  const onHost = args.projectGroups
    .filter((group) => projectGroupHostId(group, args.defaultHostId) === hostId)
    .sort(compareGroups)
  const ids = new Set(onHost.map((group) => group.id))
  for (const group of onHost) {
    if (group.parentGroupId && ids.has(group.parentGroupId)) {
      continue
    }
    appendGroup(rows, args, group, hostId, labels, 0, onHost)
  }
  appendLooseAndPlaceholders(
    rows,
    args,
    hostId,
    labels,
    (target, members, key, memberLabels, memberHost, depth) =>
      appendMemberRows(target, args, members, key, memberLabels, memberHost, depth)
  )
}

function appendGroup(
  rows: Row[],
  args: HostDirectoryRenderArgs,
  group: ProjectGroup,
  hostId: ExecutionHostId,
  labels: Map<string, string>,
  depth: number,
  onHost: readonly ProjectGroup[]
): void {
  const key = hostDirectorySectionKey(hostId, group.id)
  const members = args.orderMembers([
    ...worktreeMembers(args, key),
    ...folderMembers(args, hostId, group.id)
  ])
  rows.push({
    type: 'header',
    key,
    label: group.name,
    count: members.length,
    icon: { kind: 'project' },
    projectGroup: group,
    projectGroupDepth: depth,
    hostId,
    worktreeIds: members.flatMap((member) =>
      member.kind === 'worktree' ? [member.worktree.id] : []
    )
  })
  if (args.collapsedGroups.has(key)) {
    return
  }
  appendMemberRows(rows, args, members, key, labels, hostId, depth + 1, group)
  for (const child of onHost) {
    if (child.parentGroupId === group.id) {
      appendGroup(rows, args, child, hostId, labels, depth + 1, onHost)
    }
  }
}

function appendMemberRows(
  rows: Row[],
  args: HostDirectoryRenderArgs,
  members: readonly OrderedWorkspace[],
  sectionKey: string,
  labels: Map<string, string>,
  hostId: ExecutionHostId,
  depth: number,
  group?: ProjectGroup
): void {
  // A lineage child is drawn right under its parent (indented), never at its own sorted place, or
  // it would sit indented under an unrelated row. The plan lists each parent's subtree in order.
  // Keyed by host identity: the pinned section can hold same-id workspaces of two hosts.
  const subtreeById = new Map<string, WorktreeOccurrence<Worktree>[]>()
  let currentRoot: WorktreeOccurrence<Worktree>[] | undefined
  for (const occurrence of getExpandedWorktreeOccurrences(
    args.occurrencePlan.bySection.get(sectionKey) ?? [],
    (worktree) => args.collapsedGroups.has(lineageKey(worktree))
  )) {
    if (occurrence.parent && currentRoot) {
      currentRoot.push(occurrence)
    } else {
      currentRoot = [occurrence]
      subtreeById.set(getWorktreeHostIdentity(occurrence.row), currentRoot)
    }
  }
  const groupsById = groupsByIdOf(args)
  const repoCounts = new Map<string, number>()
  for (const member of members) {
    if (member.kind === 'worktree') {
      repoCounts.set(member.worktree.repoId, (repoCounts.get(member.worktree.repoId) ?? 0) + 1)
    }
  }
  const pendingRepoIds = new Set(args.pendingCreations.map((creation) => creation.repoId))
  const context: ItemRowContext = {
    args,
    labels,
    repoCounts,
    pendingRepoIds,
    groupDepth: depth,
    group
  }
  for (const member of members) {
    if (member.kind === 'folder') {
      rows.push({
        type: 'folder-workspace',
        key: `folder-workspace:${member.folder.id}`,
        folderWorkspace: member.folder,
        projectGroup: groupsById.get(member.folder.projectGroupId) ?? {
          id: member.folder.projectGroupId,
          name: member.folder.name,
          parentPath: null,
          executionHostId: hostId,
          parentGroupId: null,
          createdFrom: 'manual',
          tabOrder: 0,
          isCollapsed: false,
          color: null,
          createdAt: 0,
          updatedAt: 0
        },
        depth: 0,
        groupDepth: depth
      })
      continue
    }
    for (const occurrence of subtreeById.get(getWorktreeHostIdentity(member.worktree)) ?? []) {
      pushItemRow(rows, context, occurrence)
    }
  }
}

type ItemRowContext = {
  args: HostDirectoryRenderArgs
  labels: Map<string, string>
  repoCounts: ReadonlyMap<string, number>
  pendingRepoIds: ReadonlySet<string>
  groupDepth: number
  group: ProjectGroup | undefined
}

function pushItemRow(
  rows: Row[],
  context: ItemRowContext,
  occurrence: WorktreeOccurrence<Worktree>
): void {
  const { args } = context
  const worktree = occurrence.row
  const repo = args.repoOf(worktree)
  // 同项目的子工作区缩进在父卡片下面，目录前缀只是重复父卡片（F054）。空串仍标明这是主机目录行。
  const directoryLabel =
    occurrence.parent?.row.repoId === worktree.repoId
      ? ''
      : groupedCardDirectoryLabel({
          repo,
          worktreePath: worktree.path,
          labels: context.labels,
          hostId: workspaceHost(worktree, args),
          parentPath: context.group?.parentPath,
          sameRepoCount: context.repoCounts.get(worktree.repoId) ?? 0,
          pending: context.pendingRepoIds.has(worktree.repoId)
        })
  rows.push({
    type: 'item',
    occurrence,
    rowKey: occurrence.key,
    sectionKey: occurrence.sectionKey,
    worktree,
    repo,
    depth: occurrence.depth,
    groupDepth: context.groupDepth,
    isLastLineageChild: occurrence.isLastChild,
    lineageChildCount: occurrence.childCount,
    showProjectName: occurrence.showProjectName,
    ...(directoryLabel !== undefined ? { directoryLabel } : {}),
    ...(occurrence.childCount > 0
      ? {
          lineageGroupKey: lineageKey(worktree),
          lineageCollapsed: args.collapsedGroups.has(lineageKey(worktree))
        }
      : {})
  })
}
