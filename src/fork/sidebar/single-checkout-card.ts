// 主机目录卡片去掉只重复卡片名字的部分（F054）：目录前缀、主要徽标、分支行和文件夹路径行。
import { getRuntimePathBasename } from '../../shared/cross-platform-path'
import type {
  CardIdentityFacts,
  WorktreeCardIdentityInput,
  WorktreeCardIdentityOverrides
} from '../../shared/fork-hooks/sidebar-card-identity'

const DEFAULT_BRANCHES = new Set(['main', 'master'])
const UNCHANGED: WorktreeCardIdentityOverrides = Object.freeze({})
// 空分支藏起经典和紧凑样式的分支行；identity 为 null 藏起新样式的同一行。
const NO_BRANCH_ROW: CardIdentityFacts = Object.freeze({ branch: '', identity: null })

export function singleCheckoutCardIdentity(
  input: WorktreeCardIdentityInput
): WorktreeCardIdentityOverrides {
  const label = input.directoryLabel
  // 只有主机目录行带 directoryLabel；空串是不画前缀的同项目子工作区。
  if (label === undefined) {
    return UNCHANGED
  }
  const title = input.visibleCardTitle.trim()
  if (!title) {
    return UNCHANGED
  }
  if (input.isFolder) {
    return folderCardIdentity(input, label, title)
  }
  if (input.worktree.isMainWorktree && label && hasAutomaticTitle(input, title)) {
    return mainCheckoutIdentity(input.branch, label)
  }
  if (input.branch && title === input.branch) {
    return { forkCardIdentity: { facts: NO_BRANCH_ROW } }
  }
  return UNCHANGED
}

// 名字没有固定（跟随分支），新样式也没有换成议题或 PR 的标题。
function hasAutomaticTitle(input: WorktreeCardIdentityInput, title: string): boolean {
  if (title !== input.worktree.displayName.trim()) {
    return false
  }
  const mode = input.worktree.displayNameMode
  // 配对服务器的行不带 displayNameMode；名字等于分支时就是自动名。
  return mode === undefined ? input.branch !== '' && title === input.branch : mode === 'automatic'
}

// 主检出的标题换成目录名，正常字号占满一行；不是 main/master 的分支淡色跟在后面。
function mainCheckoutIdentity(branch: string, label: string): WorktreeCardIdentityOverrides {
  const trailing = branch && !DEFAULT_BRANCHES.has(branch) && branch !== label ? branch : ''
  return {
    visibleCardTitle: label,
    directoryLabel: '',
    forkCardIdentity: {
      facts: { ...NO_BRANCH_ROW, isMain: false },
      ...(trailing ? { trailingBranch: trailing } : {})
    }
  }
}

// 名字等于目录名的文件夹项目只画一次名字。第二行只剩同名的文件夹路径时也去掉：
// 模板只给 kind 为 folder 的卡片画路径行，所以改报 git；git 卡片才画的主要徽标同时关掉。
// 行上有仓库徽标（hideRepoBadge 为 false）时第二行不只是重复，保留。
function folderCardIdentity(
  input: WorktreeCardIdentityInput,
  label: string,
  title: string
): WorktreeCardIdentityOverrides {
  if (title !== label) {
    return UNCHANGED
  }
  if (!input.hideRepoBadge || getRuntimePathBasename(input.worktree.path) !== title) {
    return { directoryLabel: '' }
  }
  return {
    directoryLabel: '',
    forkCardIdentity: { facts: { kind: 'git', isMain: false, identity: null } }
  }
}
