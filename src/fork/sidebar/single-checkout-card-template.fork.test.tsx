// F054：规则的结果经上游三处钩子（controller 展开、ws 事实展开、标题后缀）进入真实的默认卡片模板。
// 模板零件换成只打标记的桩，看每种样式画出了哪些零件；标题零件用真实实现。
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorktreeCardController } from '../../renderer/src/components/sidebar/workspace-card/controller/use-worktree-card-controller'
import { buildWorkspaceCardFacts } from '../../renderer/src/components/sidebar/workspace-card/template/build-workspace-card-facts'
import { CARD_PRIMITIVES } from '../../renderer/src/components/sidebar/workspace-card/template/card-primitives'
import {
  cardElement,
  compileCardTemplate,
  type CardElementRegistry
} from '../../renderer/src/components/sidebar/workspace-card/template/card-template-compiler'
import { DEFAULT_WORKSPACE_CARD_TEMPLATE } from '../../renderer/src/components/sidebar/workspace-card/template/default-workspace-card'
import type { CardTemplateNode } from '../../shared/workspace-cards/card-template-schema'
import { registerWorktreeDirectoryPrefix } from '../../shared/fork-hooks/sidebar-chrome'
import {
  registeredWorktreeCardIdentity,
  registerWorktreeCardIdentity
} from '../../shared/fork-hooks/sidebar-card-identity'
import { registerCardIdentity } from './card-identity'

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span>{children}</span>
}))

vi.mock(
  '../../renderer/src/components/sidebar/workspace-card/identity/WorktreeTitleInlineRename',
  () => ({
    WorktreeTitleInlineRename: ({ displayName }: { displayName: string }) => (
      <span data-card-title="">{displayName}</span>
    )
  })
)

const { CARD_IDENTITY_PARTS } =
  await import('../../renderer/src/components/sidebar/workspace-card/template/card-identity-parts')

type Card = WorktreeCardController

// 默认模板里除了布局原语的每个零件，都换成 <i data-el="零件名">。
function markerRegistry(): CardElementRegistry<Card> {
  const props = new Map<string, Set<string>>()
  const collect = (node: CardTemplateNode): void => {
    const names = props.get(node.el) ?? new Set<string>()
    for (const name of Object.keys(node.props ?? {})) {
      names.add(name)
    }
    props.set(node.el, names)
    node.children?.forEach(collect)
  }
  collect(DEFAULT_WORKSPACE_CARD_TEMPLATE.root)
  Object.values(DEFAULT_WORKSPACE_CARD_TEMPLATE.defs ?? {}).forEach(collect)
  const registry: Record<string, CardElementRegistry<Card>[string]> = { ...CARD_PRIMITIVES }
  for (const [name, names] of props) {
    if (!(name in registry) && !Object.hasOwn(DEFAULT_WORKSPACE_CARD_TEMPLATE.defs ?? {}, name)) {
      registry[name] = cardElement<Card>([...names], (_props, children) =>
        React.createElement('i', { 'data-el': name }, ...children)
      )
    }
  }
  return registry
}

const TEMPLATE = compileCardTemplate(DEFAULT_WORKSPACE_CARD_TEMPLATE, markerRegistry())

type Scenario = {
  isMainWorktree: boolean
  isFolder: boolean
  displayName: string
  displayNameMode: 'fixed' | 'automatic'
  branch: string
  path: string
  directoryLabel?: string
  style: 'classic' | 'compact' | 'new'
}

const MAIN_CHECKOUT: Scenario = {
  isMainWorktree: true,
  isFolder: false,
  displayName: 'feature-x',
  displayNameMode: 'automatic',
  branch: 'feature-x',
  path: '/srv/wt/project',
  directoryLabel: 'project',
  style: 'classic'
}

// 和上游 controller 一样：先放上游字段，再展开登记的规则。
function cardFor(scenario: Scenario): Card {
  const upstream = {
    worktree: {
      id: `repo-1::${scenario.path}`,
      displayName: scenario.displayName,
      displayNameMode: scenario.displayNameMode,
      path: scenario.path,
      isMainWorktree: scenario.isMainWorktree,
      isPinned: false,
      isUnread: false,
      comment: '',
      linkedIssue: null,
      linkedPR: null
    },
    repo: { id: 'repo-1', displayName: 'project', connectionId: null },
    directoryLabel: scenario.directoryLabel,
    hideRepoBadge: true,
    showProjectName: false,
    isFolder: scenario.isFolder,
    branch: scenario.branch,
    identityDisplay: scenario.isFolder ? undefined : scenario.branch || undefined,
    visibleCardTitle: scenario.displayName,
    detachedHeadDisplay: null,
    hoverReview: null,
    hoverIssue: null,
    hoverLinearIssue: null,
    hoverJiraIssue: null,
    reviewChecks: { total: 0, passed: 0, failed: 0, pending: 0 },
    workspacePorts: [],
    lineageChildCount: 0,
    lineageCollapsed: false,
    showLineageChildChip: false,
    isActive: false,
    inPinnedSection: false,
    affiliateListMode: false,
    showDeleteQuickAction: false,
    isDeleting: false,
    titleRenaming: false,
    isRuntimeDisconnected: false,
    hostContextLabel: '',
    conflictOperation: null,
    remoteBranchConflict: null,
    cacheStartedAt: null,
    newCardStyle: scenario.style === 'new',
    compactCards: scenario.style === 'compact',
    cardProps: ['status', 'branch'],
    agentActivityDisplayMode: 'full',
    projectGroups: []
  }
  const fields = {
    ...upstream,
    ...registeredWorktreeCardIdentity(upstream, upstream, upstream)
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: 事实构建和模板只读这些字段。卡片的上下文类型是完整 controller，这个夹具不挂整张卡。
  return fields as unknown as Card
}

function drawnParts(scenario: Scenario): string[] {
  const card = cardFor(scenario)
  const html = renderToStaticMarkup(
    <>{TEMPLATE.render(buildWorkspaceCardFacts(card), card).content}</>
  )
  return [...html.matchAll(/data-el="([A-Za-z]+)"/g)].map((match) => match[1])
}

function drawnTitle(scenario: Scenario, titleRenaming = false): string {
  const card = { ...cardFor(scenario), titleRenaming }
  return renderToStaticMarkup(
    <>{CARD_IDENTITY_PARTS.Title.render({ dimWhenRead: false, tooltip: true }, [], card)}</>
  )
}

function unregister(): void {
  // 钩子是进程内单例。测完换回什么都不改的规则，避免影响后面的卡片用例。
  registerWorktreeCardIdentity({ resolve: () => ({}), renderTrailingBranch: () => null })
}

describe('host-directory card identity in the default card template', () => {
  // 共用 worker 时别的文件可能已登记真实前缀（带 Radix Tooltip）；这里换成只打标记的前缀。
  beforeEach(() => {
    registerWorktreeDirectoryPrefix((label) => <span data-prefix="">{label}</span>)
  })
  afterEach(() => {
    unregister()
    registerWorktreeDirectoryPrefix(() => null)
  })

  it('leaves the upstream card unchanged while nothing is registered', () => {
    unregister()
    expect(drawnParts(MAIN_CHECKOUT)).toEqual(expect.arrayContaining(['PrimaryBadge', 'Branch']))
    expect(drawnParts({ ...MAIN_CHECKOUT, style: 'compact' })).toContain('PrimaryStar')
    expect(drawnParts({ ...MAIN_CHECKOUT, style: 'new' })).toContain('IdentityLabel')
    expect(drawnTitle(MAIN_CHECKOUT)).toContain('<span data-prefix="">project</span>')
    expect(drawnTitle(MAIN_CHECKOUT)).toContain('<span data-card-title="">feature-x</span>')
  })

  it('draws a main checkout as its directory name with the branch after it', () => {
    registerCardIdentity()
    for (const style of ['classic', 'compact', 'new'] as const) {
      const parts = drawnParts({ ...MAIN_CHECKOUT, style })
      expect(parts, style).not.toContain('PrimaryBadge')
      expect(parts, style).not.toContain('PrimaryStar')
      expect(parts, style).not.toContain('Branch')
      expect(parts, style).not.toContain('IdentityLabel')
    }
    const title = drawnTitle(MAIN_CHECKOUT)
    expect(title).toContain('<span data-card-title="">project</span>')
    expect(title).toContain('>feature-x<')
    expect(title.indexOf('data-card-title')).toBeLessThan(title.indexOf('>feature-x<'))
    expect(title).not.toContain('data-prefix')
  })

  it('drops the trailing branch while the title is being renamed', () => {
    registerCardIdentity()
    expect(drawnTitle(MAIN_CHECKOUT, true)).not.toContain('feature-x')
  })

  it('drops only the branch row of a linked worktree named after its branch', () => {
    registerCardIdentity()
    const linked = { ...MAIN_CHECKOUT, isMainWorktree: false, path: '/srv/wt/project-feature' }
    expect(drawnParts(linked)).not.toContain('Branch')
    expect(drawnTitle(linked)).toContain('<span data-card-title="">feature-x</span>')
    expect(drawnParts({ ...linked, displayName: 'login fix', displayNameMode: 'fixed' })).toContain(
      'Branch'
    )
  })

  it('draws a folder project named like its directory on one row', () => {
    const folder: Scenario = {
      ...MAIN_CHECKOUT,
      isFolder: true,
      displayName: 'project',
      branch: ''
    }
    unregister()
    expect(drawnParts(folder)).toContain('FolderPath')
    registerCardIdentity()
    const parts = drawnParts(folder)
    expect(parts).not.toContain('FolderPath')
    expect(parts).not.toContain('PrimaryBadge')
    expect(parts).not.toContain('RepoChip')
  })

  it('keeps cards outside host-directory rows unchanged', () => {
    registerCardIdentity()
    const plain = { ...MAIN_CHECKOUT, directoryLabel: undefined }
    expect(drawnParts(plain)).toEqual(expect.arrayContaining(['PrimaryBadge', 'Branch']))
  })
})
