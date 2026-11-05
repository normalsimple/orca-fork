// fork (F041): a folder workspace is not in the resolved worktree map, so exact stop (sleeping
// one pane) must add the selector's result to the liveness refresh, as upstream's sleep paths do.
import {
  includeTargetResolvedWorktree,
  type ResolvedWorktree
} from '../../main/runtime/workspaces/catalog/runtime-worktree-path-identity'

export function appendMissingTargetWorktree(
  worktrees: ResolvedWorktree[],
  target: ResolvedWorktree
): void {
  if (includeTargetResolvedWorktree(worktrees, target) !== worktrees) {
    worktrees.push(target)
  }
}
