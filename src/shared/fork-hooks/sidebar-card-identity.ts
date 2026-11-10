// fork: 主机目录卡片的名字只画一次（F054）。未登记时每张卡片的标题、目录前缀、主要徽标和分支行都与上游相同。
import type { ReactNode } from 'react'
import type { WorkspaceCardFacts } from '../workspace-cards/workspace-card-facts'
import type { Worktree } from '../worktree/types'

/** 卡片模板改读的 `ws` 事实，代替上游的值。 */
export type CardIdentityFacts = Partial<
  Pick<WorkspaceCardFacts['ws'], 'kind' | 'branch' | 'identity' | 'isMain'>
>

export type WorktreeCardIdentity = {
  facts: CardIdentityFacts
  /** 淡色画在标题后面的分支。 */
  trailingBranch?: string
}

/** 登记的规则替换的卡片 controller 字段。没有的键保留上游的值。 */
export type WorktreeCardIdentityOverrides = {
  visibleCardTitle?: string
  directoryLabel?: string
  forkCardIdentity?: WorktreeCardIdentity
}

export type WorktreeCardIdentityInput = {
  worktree: Pick<Worktree, 'isMainWorktree' | 'path' | 'displayName' | 'displayNameMode'>
  /** 只有主机目录行设置它。 */
  directoryLabel: string | undefined
  hideRepoBadge: boolean
  isFolder: boolean
  /** 短分支名；文件夹和分离 HEAD 为空。 */
  branch: string
  visibleCardTitle: string
}

type ResolveCardIdentity = (input: WorktreeCardIdentityInput) => WorktreeCardIdentityOverrides
type RenderTrailingBranch = (branch: string, tooltip: boolean) => ReactNode

const NO_OVERRIDES: WorktreeCardIdentityOverrides = Object.freeze({})
const NO_FACTS: CardIdentityFacts = Object.freeze({})

let resolveIdentity: ResolveCardIdentity | undefined
let renderTrailingBranch: RenderTrailingBranch | undefined

export function registerWorktreeCardIdentity(args: {
  resolve: ResolveCardIdentity
  renderTrailingBranch: RenderTrailingBranch
}): void {
  resolveIdentity = args.resolve
  renderTrailingBranch = args.renderTrailingBranch
}

/** 展开在卡片 controller 里上游字段的后面。 */
export function registeredWorktreeCardIdentity(
  props: {
    worktree: WorktreeCardIdentityInput['worktree']
    directoryLabel?: string
    hideRepoBadge?: boolean
  },
  review: { isFolder: boolean; branch: string },
  linked: { visibleCardTitle: string }
): WorktreeCardIdentityOverrides {
  if (!resolveIdentity) {
    return NO_OVERRIDES
  }
  return resolveIdentity({
    worktree: props.worktree,
    directoryLabel: props.directoryLabel,
    hideRepoBadge: props.hideRepoBadge === true,
    isFolder: review.isFolder,
    branch: review.branch,
    visibleCardTitle: linked.visibleCardTitle
  })
}

/** 展开在卡片 `ws` 事实里上游字段的后面。 */
export function registeredCardIdentityFacts(card: {
  forkCardIdentity?: WorktreeCardIdentity
}): CardIdentityFacts {
  return card.forkCardIdentity?.facts ?? NO_FACTS
}

/** 画在卡片标题的正后方。`tooltip` 是标题零件的同名属性，为 false 时不另开提示。 */
export function renderRegisteredCardTitleTrailing(
  card: { forkCardIdentity?: WorktreeCardIdentity },
  tooltip: unknown
): ReactNode {
  const branch = card.forkCardIdentity?.trailingBranch
  return branch && renderTrailingBranch ? renderTrailingBranch(branch, tooltip !== false) : null
}
