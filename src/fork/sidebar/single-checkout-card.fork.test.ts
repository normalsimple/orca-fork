// F054：主机目录卡片只画一次名字。规则输入就是卡片 controller 的字段，这里按场景列出替换结果。
import { describe, expect, it } from 'vitest'
import type { WorktreeCardIdentityInput } from '../../shared/fork-hooks/sidebar-card-identity'
import { singleCheckoutCardIdentity } from './single-checkout-card'

type Fixture = Partial<Omit<WorktreeCardIdentityInput, 'worktree'>> & {
  worktree?: Partial<WorktreeCardIdentityInput['worktree']>
}

// 默认是 /srv/wt/project 的主检出，自动名，停在 main。
function identity({ worktree, ...rest }: Fixture = {}): ReturnType<
  typeof singleCheckoutCardIdentity
> {
  return singleCheckoutCardIdentity({
    worktree: {
      isMainWorktree: true,
      path: '/srv/wt/project',
      displayName: 'main',
      displayNameMode: 'automatic',
      ...worktree
    },
    directoryLabel: 'project',
    hideRepoBadge: true,
    isFolder: false,
    branch: 'main',
    visibleCardTitle: 'main',
    ...rest
  })
}

const NO_BRANCH_ROW = { forkCardIdentity: { facts: { branch: '', identity: null } } }
const DIRECTORY_TITLE = {
  visibleCardTitle: 'project',
  directoryLabel: '',
  forkCardIdentity: { facts: { branch: '', identity: null, isMain: false } }
}

describe('main checkout with an automatic name', () => {
  it('shows only the directory name on main or master', () => {
    expect(identity()).toEqual(DIRECTORY_TITLE)
    expect(
      identity({
        branch: 'master',
        visibleCardTitle: 'master',
        worktree: { displayName: 'master' }
      })
    ).toEqual(DIRECTORY_TITLE)
  })

  it('keeps another branch dimmed after the directory name', () => {
    expect(
      identity({
        branch: 'feature-x',
        visibleCardTitle: 'feature-x',
        worktree: { displayName: 'feature-x' }
      })
    ).toEqual({
      ...DIRECTORY_TITLE,
      forkCardIdentity: { ...DIRECTORY_TITLE.forkCardIdentity, trailingBranch: 'feature-x' }
    })
  })

  it('does not repeat a branch that has the directory name', () => {
    expect(
      identity({
        branch: 'project',
        visibleCardTitle: 'project',
        worktree: { displayName: 'project' }
      })
    ).toEqual(DIRECTORY_TITLE)
  })

  it('uses the directory name on a detached HEAD', () => {
    expect(
      identity({ branch: '', visibleCardTitle: 'Project', worktree: { displayName: 'Project' } })
    ).toEqual(DIRECTORY_TITLE)
  })

  it('treats a row without a name mode as automatic only when the name is the branch', () => {
    expect(identity({ worktree: { displayNameMode: undefined } })).toEqual(DIRECTORY_TITLE)
    expect(
      identity({
        visibleCardTitle: 'console',
        worktree: { displayNameMode: undefined, displayName: 'console' }
      })
    ).toEqual({})
  })
})

describe('cards that keep their name', () => {
  it('leaves a fixed name alone', () => {
    expect(
      identity({
        visibleCardTitle: 'console',
        worktree: { displayNameMode: 'fixed', displayName: 'console' }
      })
    ).toEqual({})
  })

  it('only drops the branch row when a fixed name equals the branch', () => {
    expect(identity({ worktree: { displayNameMode: 'fixed' } })).toEqual(NO_BRANCH_ROW)
  })

  it('leaves an issue title from the new card style alone', () => {
    expect(
      identity({
        branch: 'feature-x',
        visibleCardTitle: 'Fix login',
        worktree: { displayName: 'feature-x' }
      })
    ).toEqual({})
  })
})

describe('linked worktrees', () => {
  const linked = { isMainWorktree: false, path: '/srv/wt/project-feature' }

  it('drops the branch row when the name is the branch', () => {
    expect(
      identity({
        branch: 'feature-x',
        visibleCardTitle: 'feature-x',
        worktree: { ...linked, displayName: 'feature-x' }
      })
    ).toEqual(NO_BRANCH_ROW)
  })

  it('keeps the branch row under another name', () => {
    expect(
      identity({
        branch: 'feature-x',
        visibleCardTitle: 'login fix',
        worktree: { ...linked, displayName: 'login fix', displayNameMode: 'fixed' }
      })
    ).toEqual({})
  })

  it('still drops a repeated branch row on a nested child without a prefix', () => {
    expect(
      identity({
        directoryLabel: '',
        branch: 'feature-x',
        visibleCardTitle: 'feature-x',
        worktree: { ...linked, displayName: 'feature-x' }
      })
    ).toEqual(NO_BRANCH_ROW)
  })

  it('does not rename a main checkout that has no prefix', () => {
    expect(identity({ directoryLabel: '' })).toEqual(NO_BRANCH_ROW)
  })
})

describe('folder projects', () => {
  const folder = {
    isFolder: true,
    branch: '',
    visibleCardTitle: 'project',
    worktree: { displayName: 'project' }
  }

  it('shows a name that equals the directory once, on one row', () => {
    expect(identity(folder)).toEqual({
      directoryLabel: '',
      forkCardIdentity: { facts: { kind: 'git', isMain: false, identity: null } }
    })
  })

  it('keeps a folder path that adds information', () => {
    expect(
      identity({ ...folder, worktree: { ...folder.worktree, path: '/srv/wt/other' } })
    ).toEqual({ directoryLabel: '' })
    expect(identity({ ...folder, hideRepoBadge: false })).toEqual({ directoryLabel: '' })
  })

  it('keeps the prefix before another name', () => {
    expect(identity({ ...folder, visibleCardTitle: 'Docs' })).toEqual({})
  })
})

describe('outside host-directory rows', () => {
  it('changes nothing without a directory label', () => {
    expect(identity({ directoryLabel: undefined })).toEqual({})
    expect(
      identity({
        directoryLabel: undefined,
        isFolder: true,
        branch: '',
        visibleCardTitle: 'project'
      })
    ).toEqual({})
  })

  it('changes nothing for an empty title', () => {
    expect(identity({ visibleCardTitle: '  ', worktree: { displayName: '' } })).toEqual({})
  })
})
