// 各台主机的工作区行。配对机器只挂在 runtime 主机上，一台失败不影响其它主机。
import { z } from 'zod'
import {
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../shared/execution-host'
import { folderWorkspaceKey } from '../../shared/workspace-scope'
import { FORK_WORKSPACE_LIST_LIMIT } from '../plugins/host-api-spec'
import type { ForkHostRow, ForkWorkspaceRow } from './plugin-host-catalog'

const worktreeListAnswer = z.object({
  worktrees: z.array(
    z.object({
      id: z.string(),
      repoId: z.string(),
      displayName: z.string(),
      path: z.string(),
      branch: z.string().optional(),
      hostId: z.string().optional(),
      identity: z.object({ key: z.string() }).optional()
    })
  ),
  totalCount: z.number().optional(),
  truncated: z.boolean().optional()
})
const repoListAnswer = z.object({
  repos: z.array(z.object({ id: z.string(), kind: z.string().optional() }))
})
const folderListAnswer = z.object({
  folderWorkspaces: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      folderPath: z.string(),
      executionHostId: z.string().nullable().optional()
    })
  )
})

function branchName(branch: string | undefined): string | null {
  const name = branch?.replace(/^refs\/heads\//, '') ?? ''
  return name || null
}

/** 把一台主机的 worktree.list / repo.list / folderWorkspace.list 收成插件行。 */
export function projectForkWorkspaces(
  listed: unknown,
  repos: unknown,
  folders: unknown,
  serveAs?: { hostId: string; envId?: string }
): { rows: ForkWorkspaceRow[]; truncated: boolean } {
  const parsed = worktreeListAnswer.parse(listed)
  const folderRepos = new Set(
    repoListAnswer
      .parse(repos)
      .repos.filter((repo) => repo.kind === 'folder')
      .map((repo) => repo.id)
  )
  const rows: ForkWorkspaceRow[] = []
  for (const worktree of parsed.worktrees) {
    if (serveAs && !isLocalToServer(worktree.hostId)) {
      continue
    }
    const folder = folderRepos.has(worktree.repoId)
    rows.push(
      place(
        {
          id: worktree.identity ? `identity:${worktree.identity.key}` : worktree.id,
          kind: folder ? 'folder' : 'worktree',
          name: worktree.displayName,
          path: worktree.path,
          branch: folder ? null : branchName(worktree.branch),
          hostId: worktree.hostId || LOCAL_EXECUTION_HOST_ID
        },
        serveAs
      )
    )
  }
  for (const folder of folderListAnswer.parse(folders).folderWorkspaces) {
    const hostId = folder.executionHostId || LOCAL_EXECUTION_HOST_ID
    if (serveAs && !isLocalToServer(folder.executionHostId ?? undefined)) {
      continue
    }
    rows.push(
      place(
        {
          id: folderWorkspaceKey(folder.id),
          kind: 'folder',
          name: folder.name,
          path: folder.folderPath,
          branch: null,
          hostId
        },
        serveAs
      )
    )
  }
  const truncated =
    parsed.truncated === true ||
    (parsed.totalCount ?? parsed.worktrees.length) > parsed.worktrees.length
  return { rows, truncated }
}

function isLocalToServer(hostId: string | null | undefined): boolean {
  return !hostId || hostId === LOCAL_EXECUTION_HOST_ID
}

function place(
  row: Omit<ForkWorkspaceRow, 'envId'>,
  serveAs: { hostId: string; envId?: string } | undefined
): ForkWorkspaceRow {
  if (!serveAs) {
    return row
  }
  return serveAs.envId
    ? { ...row, hostId: serveAs.hostId, envId: serveAs.envId }
    : { ...row, hostId: serveAs.hostId }
}

export function forkWorkspaceSelector(workspaceId: string): string {
  if (
    workspaceId.startsWith('identity:') ||
    workspaceId.startsWith('folder:') ||
    workspaceId.startsWith('id:') ||
    workspaceId.startsWith('path:')
  ) {
    return workspaceId
  }
  return `id:${workspaceId}`
}

function claimedByRuntime(hostId: string, hosts: readonly ForkHostRow[]): boolean {
  return hosts.some(
    (host) =>
      host.kind === 'runtime' && (host.hostId === hostId || host.aliasHostIds.includes(hostId))
  )
}

function queryHosts(hosts: readonly ForkHostRow[], hostId: string | undefined): ForkHostRow[] {
  const serving = hosts.filter((host) => host.kind === 'local' || host.kind === 'runtime')
  if (!hostId) {
    return serving
  }
  const parsed = parseExecutionHostId(hostId)
  if (!parsed) {
    return []
  }
  if (parsed.kind === 'local') {
    return serving.filter((host) => host.kind === 'local')
  }
  if (parsed.kind === 'runtime') {
    return serving.filter((host) => host.hostId === parsed.id)
  }
  const runtime = serving.find(
    (host) => host.kind === 'runtime' && host.aliasHostIds.includes(parsed.id)
  )
  if (runtime) {
    return [runtime]
  }
  return serving.filter((host) => host.kind === 'local')
}

/** 一台失败不影响其它主机。问 ssh 别名时，行仍挂在 runtime 主机上。 */
export async function collectForkWorkspaces(input: {
  hostId?: string
  hosts: readonly ForkHostRow[]
  listOnHost: (host: ForkHostRow) => Promise<{ rows: ForkWorkspaceRow[]; truncated: boolean }>
}): Promise<{ workspaces: ForkWorkspaceRow[]; truncated: boolean; unreachable: string[] }> {
  const query = queryHosts(input.hosts, input.hostId)
  if (input.hostId && query.length === 0) {
    return { workspaces: [], truncated: false, unreachable: [input.hostId] }
  }
  const bareSsh = bareSshFilter(input.hostId, input.hosts)
  const workspaces: ForkWorkspaceRow[] = []
  const unreachable: string[] = []
  let truncated = false
  for (const host of query) {
    if (workspaces.length >= FORK_WORKSPACE_LIST_LIMIT) {
      truncated = true
      break
    }
    try {
      const listed = await input.listOnHost(host)
      let rows = listed.rows
      if (host.kind === 'local') {
        rows = rows.filter((row) => !claimedByRuntime(row.hostId, input.hosts))
        if (bareSsh) {
          rows = rows.filter((row) => row.hostId === bareSsh)
        } else if (input.hostId === LOCAL_EXECUTION_HOST_ID) {
          rows = rows.filter((row) => row.hostId === LOCAL_EXECUTION_HOST_ID)
        }
      }
      if (listed.truncated) {
        truncated = true
      }
      const room = FORK_WORKSPACE_LIST_LIMIT - workspaces.length
      if (rows.length > room) {
        workspaces.push(...rows.slice(0, room))
        truncated = true
      } else {
        workspaces.push(...rows)
      }
    } catch {
      unreachable.push(bareSsh ?? host.hostId)
    }
  }
  return { workspaces, truncated, unreachable }
}

function bareSshFilter(
  hostId: string | undefined,
  hosts: readonly ForkHostRow[]
): ExecutionHostId | null {
  const parsed = parseExecutionHostId(hostId)
  if (parsed?.kind !== 'ssh') {
    return null
  }
  const paired = hosts.some(
    (host) => host.kind === 'runtime' && host.aliasHostIds.includes(parsed.id)
  )
  return paired ? null : parsed.id
}
