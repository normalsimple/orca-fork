// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { ManagedPane } from '@/lib/pane-manager/pane-manager-types'
import { NativeChatPaneCover } from '../../renderer/src/components/terminal-pane/chat/NativeChatPaneCover'
import { RetainedPaneHost } from '../../renderer/src/components/tab-group/RetainedPaneHost'
import {
  RETAINED_PANE_GROUP_ATTRIBUTE,
  resetCoveredTerminalGroupsForTests
} from '../../shared/fork-hooks/covered-terminal-group'
import {
  installCoveredTerminalCanvasStyle,
  registerCoveredTerminalGroupRules,
  resetCoveredTerminalGroupRulesForTests
} from './covered-terminal-canvas'

type Pane = Pick<ManagedPane, 'container' | 'terminal'> & { canvas: HTMLCanvasElement }

// The DOM createPaneDOM and xterm's open() build: .pane > .xterm-container > .xterm > .xterm-screen.
function pane({ wrapped = true }: { wrapped?: boolean } = {}): Pane {
  const container = document.createElement('div')
  container.className = 'pane'
  const element = document.createElement('div')
  element.className = 'xterm'
  const screen = document.createElement('div')
  screen.className = 'xterm-screen'
  const canvas = document.createElement('canvas')
  canvas.className = 'xterm-link-layer'
  screen.append(canvas)
  element.append(screen)
  if (wrapped) {
    const xtermContainer = document.createElement('div')
    xtermContainer.className = 'xterm-container'
    xtermContainer.append(element)
    container.append(xtermContainer)
  } else {
    container.append(element)
  }
  document.body.append(container)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the cover reads only element and focus.
  const terminal = { element, focus: () => undefined } as unknown as ManagedPane['terminal']
  return { container, terminal, canvas }
}

function cover(target: Pane, children: React.ReactNode = null): () => void {
  const view = render(
    createPortal(
      <NativeChatPaneCover pane={target}>{children}</NativeChatPaneCover>,
      target.container
    )
  )
  return view.unmount
}

const visibility = (element: Element): string => getComputedStyle(element).visibility
const pointerEvents = (element: Element): string => getComputedStyle(element).pointerEvents

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  document.head.replaceChildren()
  resetCoveredTerminalGroupsForTests()
  resetCoveredTerminalGroupRulesForTests()
})

describe('xterm canvases under a native chat cover', () => {
  it('hides the covered pane canvases and hit target until the cover goes away', () => {
    installCoveredTerminalCanvasStyle()
    const covered = pane()
    const uncover = cover(covered)
    expect(visibility(covered.canvas)).toBe('hidden')
    expect(pointerEvents(covered.canvas)).toBe('none')
    expect(pointerEvents(covered.terminal.element!)).toBe('none')
    // xterm recreates its canvases (WebGL attach, context loss) while the cover is up.
    const late = document.createElement('canvas')
    covered.terminal.element!.querySelector('.xterm-screen')!.append(late)
    expect(visibility(late)).toBe('hidden')
    uncover()
    expect(visibility(covered.canvas)).not.toBe('hidden')
    expect(pointerEvents(covered.terminal.element!)).not.toBe('none')
  })

  it('leaves split siblings and the chat content alone', () => {
    installCoveredTerminalCanvasStyle()
    const covered = pane()
    const sibling = pane()
    cover(
      covered,
      <div className="xterm">
        <canvas data-testid="chat-canvas" />
      </div>
    )
    expect(visibility(covered.canvas)).toBe('hidden')
    expect(visibility(sibling.canvas)).not.toBe('hidden')
    expect(visibility(document.querySelector('[data-testid="chat-canvas"]')!)).not.toBe('hidden')
  })

  it('also covers an xterm placed directly in the pane', () => {
    installCoveredTerminalCanvasStyle()
    const covered = pane({ wrapped: false })
    cover(covered)
    expect(visibility(covered.canvas)).toBe('hidden')
  })

  it('changes nothing until the renderer installs it, and installs once', () => {
    const covered = pane()
    cover(covered)
    expect(visibility(covered.canvas)).not.toBe('hidden')
    installCoveredTerminalCanvasStyle()
    installCoveredTerminalCanvasStyle()
    expect(document.head.querySelectorAll('style')).toHaveLength(1)
    expect(visibility(covered.canvas)).toBe('hidden')
  })
})

function TerminalXterm({ testId }: { testId?: string }) {
  return (
    <div className="pane">
      <div className="xterm-container">
        <div className="xterm">
          <canvas className="xterm-link-layer" data-testid={testId} />
        </div>
      </div>
    </div>
  )
}

function AgentSessionSurface({ agentVisible }: { agentVisible: boolean }) {
  return (
    <div data-workspace-surface-id="wt-1">
      <RetainedPaneHost groupId="left" isVisible data-terminal-overlay-tab-id="term-visible">
        <TerminalXterm testId="covered-terminal" />
      </RetainedPaneHost>
      <RetainedPaneHost
        groupId="left"
        isVisible={false}
        measureWhileHidden
        data-terminal-overlay-tab-id="term-measured"
      >
        <TerminalXterm testId="measured-terminal" />
      </RetainedPaneHost>
      <RetainedPaneHost groupId="right" isVisible data-terminal-overlay-tab-id="term-other">
        <TerminalXterm testId="other-group" />
      </RetainedPaneHost>
      <RetainedPaneHost
        groupId="left"
        isVisible={agentVisible}
        data-structured-agent-session-overlay-tab-id="session-1"
      >
        <div className="xterm">
          <canvas data-testid="chat-canvas" />
        </div>
      </RetainedPaneHost>
    </div>
  )
}

describe('xterm canvases under a structured agent-session host', () => {
  it('hides same-group sibling canvases while the session host is visible', () => {
    installCoveredTerminalCanvasStyle()
    registerCoveredTerminalGroupRules()
    const view = render(<AgentSessionSurface agentVisible />)
    const covered = view.getByTestId('covered-terminal')
    const measured = view.getByTestId('measured-terminal')
    const other = view.getByTestId('other-group')
    const chat = view.getByTestId('chat-canvas')
    const coveredHost = covered.closest('[data-retained-pane-host]')
    expect(coveredHost?.getAttribute(RETAINED_PANE_GROUP_ATTRIBUTE)).toBe('left')
    expect(visibility(covered)).toBe('hidden')
    expect(pointerEvents(covered)).toBe('none')
    expect(pointerEvents(covered.closest('.xterm')!)).toBe('none')
    // 还在测量、display 不是 none 的隐藏终端也会被盖住。
    expect(measured.closest('[data-retained-pane-host]')?.hasAttribute('inert')).toBe(true)
    expect(visibility(measured)).toBe('hidden')
    expect(visibility(other)).not.toBe('hidden')
    expect(pointerEvents(other.closest('.xterm')!)).not.toBe('none')
    expect(visibility(chat)).not.toBe('hidden')
    const late = document.createElement('canvas')
    covered.closest('.xterm')!.append(late)
    expect(visibility(late)).toBe('hidden')

    view.rerender(<AgentSessionSurface agentVisible={false} />)
    const restored = view.getByTestId('covered-terminal')
    const agent = view.container.querySelector('[data-structured-agent-session-overlay-tab-id]')
    expect(agent?.hasAttribute('inert')).toBe(true)
    // 盖层变成 inert 之后新画出来的 xterm 不再被这条规则命中。
    const fresh = document.createElement('div')
    fresh.className = 'xterm'
    const freshCanvas = document.createElement('canvas')
    fresh.append(freshCanvas)
    restored.closest('[data-retained-pane-host]')!.append(fresh)
    expect(visibility(freshCanvas)).not.toBe('hidden')
    expect(pointerEvents(fresh)).not.toBe('none')
  })

  it('leaves sibling xterms alone until the group marker is registered', () => {
    installCoveredTerminalCanvasStyle()
    const view = render(<AgentSessionSurface agentVisible />)
    const covered = view.getByTestId('covered-terminal')
    expect(
      covered.closest('[data-retained-pane-host]')?.hasAttribute(RETAINED_PANE_GROUP_ATTRIBUTE)
    ).toBe(false)
    expect(visibility(covered)).not.toBe('hidden')
  })
})
