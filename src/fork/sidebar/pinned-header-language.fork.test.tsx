// @vitest-environment happy-dom
// The pinned header of the host-directory sidebar follows a UI language switch without anything
// else rebuilding the list: the header has no baked label, and the row list is rebuilt when the
// fork's label version moves on languageChanged.
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { i18n } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { useSidebarSectionRows } from '../../renderer/src/components/sidebar/worktree-list/listing/use-section-rows'
import { getSidebarHeaderVisual } from '../../renderer/src/components/sidebar/worktree-list/rows/header-visuals'
import type { Repo } from '../../shared/repo-types'
import type { HostSectionRow } from '../../shared/sidebar-list/host-section-rows'
import type { WorktreeGroupBy } from '../../shared/sidebar-list/row-types'
import type { Worktree } from '../../shared/worktree/types'
import { cloneDefaultWorkspaceStatuses } from '../../shared/workspace-statuses'
import { registerForkModules } from '../register'
import { registerForkRendererModules } from '../register-renderer'
import { HOST_DIRECTORY_GROUP_BY, PINNED_SECTION_KEY } from './section-keys'
import { draw, wt } from './group-drop-display.test-fixture'

const repo: Repo = {
  id: 'r1',
  path: '/w/r1',
  displayName: 'alpha',
  badgeColor: '#737373',
  addedAt: 0
}
const pinned: Worktree = {
  id: 'p',
  repoId: repo.id,
  path: '/w/r1/p',
  branch: 'refs/heads/p',
  head: 'abc',
  isBare: false,
  isMainWorktree: false,
  linkedIssue: null,
  linkedPR: null,
  linkedLinearIssue: null,
  isArchived: false,
  comment: '',
  isUnread: false,
  isPinned: true,
  displayName: 'p',
  sortOrder: 0,
  lastActivityAt: 0
}
const worktrees = [pinned]
const repoMap = new Map([[repo.id, repo]])
const worktreeMap = new Map([[pinned.id, pinned]])
const collapsed = new Set<string>()
const workspaceStatuses = cloneDefaultWorkspaceStatuses()
const empty = new Map()

function pinnedLabel(rows: readonly HostSectionRow[]): string | undefined {
  const header = rows.find((row) => row.type === 'header' && row.key === PINNED_SECTION_KEY)
  if (!header || header.type !== 'header') {
    return undefined
  }
  return header.label ?? getSidebarHeaderVisual(header.icon, workspaceStatuses).label
}

describe('pinned header label on a language switch', () => {
  beforeAll(() => {
    registerForkModules()
    registerForkRendererModules()
  })
  afterEach(async () => {
    cleanup()
    await i18n.changeLanguage('en')
  })

  it('relabels when only the UI language changes', async () => {
    const settings = useAppStore.getState().settings
    const { result } = renderHook(() =>
      useSidebarSectionRows({
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: host-directory is a registered mode id, not one of the built-in literals.
        groupBy: HOST_DIRECTORY_GROUP_BY as WorktreeGroupBy,
        sortBy: 'recent',
        projectOrderBy: 'manual',
        pinnedDisplayPolicy: 'single-location',
        defaultHostId: 'local',
        worktrees,
        repos: [repo],
        repoMap,
        worktreeMap,
        worktreeLineageById: {},
        prCache: null,
        settings,
        workspaceStatuses,
        effectiveCollapsedGroups: collapsed,
        projectGrouping: { projects: [], projectHostSetups: [] },
        visibleReposForRows: [repo],
        visibleProjectGroupsForRows: [],
        visibleFolderWorkspacesForRows: [],
        importedWorktreesByRepo: empty,
        newExternalWorktreesInboxByRepo: empty,
        filterRepoIds: [],
        visibleWorkspaceHostIds: null,
        workspaceHostScope: 'all'
      })
    )
    const first = result.current.sectionRows
    expect(pinnedLabel(first)).toBe('Pinned')

    await act(async () => {
      await i18n.changeLanguage('zh')
    })
    // Same inputs; only the language changed. The rows are new, so the headers paint again.
    expect(result.current.sectionRows).not.toBe(first)
    expect(pinnedLabel(result.current.sectionRows)).toBe('已固定')
  })
})

describe('the pinned header row', () => {
  it('carries no label, so the window names it from its icon in the current language', () => {
    const header = draw({ rows: [wt('p', { isPinned: true, manualOrder: 1 })] }).find(
      (row) => row.type === 'header' && row.key === PINNED_SECTION_KEY
    )
    expect(header).toMatchObject({ type: 'header', icon: { kind: 'pinned' } })
    expect(header && 'label' in header ? header.label : undefined).toBeUndefined()
  })
})
