// fork: 本地目录已不存在的工作区在权威扫描时自动清理会话引用与工作区元数据。
import type { GitWorktreeInfo } from '../worktree/types'

export type MissingRepoWorktreeScanFallback = (
  repoPath: string,
  error: unknown
) => Promise<{ ok: boolean; worktrees: GitWorktreeInfo[] } | null>

export type FilterLiveGitWorktrees = (gitWorktrees: readonly GitWorktreeInfo[]) => GitWorktreeInfo[]

export type PrepareMissingLocalWorktreeMetadataPrune = (
  store: unknown,
  missingMetadata: readonly { worktreeId: string }[]
) => void

type MissingWorktreeMetadataCleanupHooks = {
  resolveMissingRepoScan: MissingRepoWorktreeScanFallback
  filterLiveGitWorktrees: FilterLiveGitWorktrees
  prepareMissingMetadataPrune: PrepareMissingLocalWorktreeMetadataPrune
}

let registeredHooks: MissingWorktreeMetadataCleanupHooks | undefined

export function registerMissingWorktreeMetadataCleanup(
  hooks: MissingWorktreeMetadataCleanupHooks | undefined
): void {
  registeredHooks = hooks
}

export async function resolveRegisteredMissingRepoWorktreeScan(
  repoPath: string,
  error: unknown
): Promise<{ ok: boolean; worktrees: GitWorktreeInfo[] } | null> {
  return registeredHooks ? await registeredHooks.resolveMissingRepoScan(repoPath, error) : null
}

export function filterRegisteredLiveGitWorktrees<T extends readonly GitWorktreeInfo[]>(
  gitWorktrees: T
): T {
  return registeredHooks
    ? (registeredHooks.filterLiveGitWorktrees(gitWorktrees) as unknown as T)
    : gitWorktrees
}

export function allowRegisteredEmptyScanMetadataPrune(): boolean {
  return Boolean(registeredHooks)
}

export function selectRegisteredProbeableMetadataCandidates<
  TScan extends { metadata: readonly TMetadata[] },
  TMetadata
>(
  store: { selectProbeableLocalWorktreeMetadataCandidates?: (scan: TScan) => readonly TMetadata[] },
  scan: TScan
): readonly TMetadata[] {
  if (registeredHooks) {
    return scan.metadata
  }
  return store.selectProbeableLocalWorktreeMetadataCandidates?.(scan) ?? scan.metadata
}

export function prepareRegisteredMissingLocalWorktreeMetadataPrune(
  store: unknown,
  missingMetadata: readonly { worktreeId: string }[]
): void {
  registeredHooks?.prepareMissingMetadataPrune(store, missingMetadata)
}
