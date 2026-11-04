// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { i18n } from '@/i18n/i18n'
import { subscribeSidebarGroupModeLabels } from '../../shared/fork-hooks/sidebar-group-mode'
import { SidebarGroupByToggle } from '../../renderer/src/components/sidebar/worktree-list/controls/SidebarGroupByToggle'
import { installForkLocaleOverlays } from '../i18n/locale-overlay'
import { registerForkModeLabels } from './mode-labels'
import { registerHostDirectoryMode } from './register-mode'

let root: Root | null = null

function labels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('button')).map((button) => button.textContent ?? '')
}

describe('group-by menu labels follow the UI language', () => {
  beforeAll(() => {
    installForkLocaleOverlays(i18n)
    registerHostDirectoryMode()
    registerForkModeLabels()
  })
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(async () => {
    act(() => root?.unmount())
    root = null
    document.body.replaceChildren()
    await i18n.changeLanguage('en')
  })

  it('relabels the Host mode on a language switch without being rendered again', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      // Rendered once; nothing below renders it again or changes its props.
      root!.render(<SidebarGroupByToggle groupBy="none" setGroupBy={() => undefined} />)
    })
    expect(labels(container)).toContain('Host')

    await act(async () => {
      await i18n.changeLanguage('zh')
    })
    expect(labels(container)).toContain('主机')
    expect(labels(container)).not.toContain('Host')

    await act(async () => {
      await i18n.changeLanguage('en')
    })
    expect(labels(container)).toContain('Host')
  })

  it('adds no second listener when the labels are registered again', async () => {
    registerForkModeLabels()
    let calls = 0
    const unsubscribe = subscribeSidebarGroupModeLabels(() => {
      calls += 1
    })
    try {
      await i18n.changeLanguage('zh')
    } finally {
      unsubscribe()
    }
    expect(calls).toBe(1)
  })
})
