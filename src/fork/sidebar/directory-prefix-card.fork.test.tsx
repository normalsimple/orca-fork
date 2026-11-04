// 卡片模板（#37647）替换 WorktreeCardHeader 后，主机目录行的项目名不再画出来。
// 工作区标题仍是分支名时，标题行必须先画出仓库显示名，例如 work-log · master。
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerWorktreeDirectoryPrefix } from '../../shared/fork-hooks/sidebar-chrome'
import type { WorktreeCardController } from '../../renderer/src/components/sidebar/workspace-card/controller/use-worktree-card-controller'
import { registerDirectoryPrefix } from './directory-prefix'
import { DIRECTORY_TITLE_SEPARATOR } from './section-keys'

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span>{children}</span>
}))

vi.mock('../../renderer/src/components/sidebar/workspace-card/identity/WorktreeTitleInlineRename', () => ({
  WorktreeTitleInlineRename: ({ displayName }: { displayName: string }) => (
    <span data-card-title="">{displayName}</span>
  )
}))

const { CARD_IDENTITY_PARTS } =
  await import('../../renderer/src/components/sidebar/workspace-card/template/card-identity-parts')

const WORKTREE_PATH = '/tmp/orca-fixture/work-log'

function drawTitle(overrides: { directoryLabel?: string; titleRenaming?: boolean }): string {
  const fields = {
    affiliateListMode: false,
    directoryLabel: overrides.directoryLabel,
    titleRenaming: overrides.titleRenaming === true,
    visibleCardTitle: 'master',
    isDeleting: false,
    showUnreadEmphasis: false,
    setTitleRenaming: vi.fn(),
    handleRenameTitle: vi.fn(),
    renamingWorktreeId: null,
    renameRowKey: undefined,
    setRenamingWorktreeId: vi.fn(),
    worktree: { id: 'repo::work-log', path: WORKTREE_PATH }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: 标题零件只读这些字段。卡片元素的上下文类型是完整 controller，这个夹具不挂整张卡。
  const card = fields as unknown as WorktreeCardController
  return renderToStaticMarkup(
    <>{CARD_IDENTITY_PARTS.Title.render({ dimWhenRead: true, tooltip: false }, [], card)}</>
  )
}

describe('host-directory project name on the workspace card', () => {
  afterEach(() => {
    // 这个钩子是进程内单例。测完卸掉，避免后面的卡片用例画上前缀。
    registerWorktreeDirectoryPrefix(() => null)
  })

  it('paints the repo name before a branch title', () => {
    registerDirectoryPrefix()
    const html = drawTitle({ directoryLabel: 'work-log' })
    expect(html).toContain('work-log')
    expect(html).toContain('data-card-title=""')
    expect(html.indexOf('work-log')).toBeLessThan(html.indexOf('data-card-title'))
    expect(html).toContain(DIRECTORY_TITLE_SEPARATOR)
    expect(html).toContain(WORKTREE_PATH)
    expect(html).toContain('>master<')
  })

  it('omits the prefix while the title is being renamed', () => {
    registerDirectoryPrefix()
    const html = drawTitle({ directoryLabel: 'work-log', titleRenaming: true })
    expect(html).not.toContain('work-log')
    expect(html).toContain('>master<')
  })

  it('leaves a card with no directory label unchanged', () => {
    registerDirectoryPrefix()
    const html = drawTitle({})
    expect(html).not.toContain('work-log')
    expect(html).not.toContain(DIRECTORY_TITLE_SEPARATOR)
    expect(html).toContain('>master<')
  })
})
