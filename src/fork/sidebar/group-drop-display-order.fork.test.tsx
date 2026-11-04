// What the sidebar shows under manual sort and what a group drop writes come from one order
// (manual-order.ts): draw, drop, draw again, and the row is where the insertion line was.
import { describe, expect, it } from 'vitest'
import { buildWorktreeManualOrderCatalog } from '../../renderer/src/components/sidebar/worktree-list/drag/worktree-manual-order-catalog'
import { getWorktreeIdFromHostIdentity } from '../../shared/worktree/host-qualified-identity'
import { manualOrderedRows } from './manual-order'
import { draw, dropAndRedraw, insert, keyOf, shownIn, wt } from './group-drop-display.test-fixture'

describe('one manual order for the sidebar and a group drop', () => {
  it('draws rows in the order upstream manual sort uses, unset rows by sortOrder', () => {
    const rows = [
      wt('a', { manualOrder: 500 }),
      wt('b', { sortOrder: 700 }),
      wt('c', { manualOrder: 300 }),
      wt('d', { sortOrder: 300 }),
      wt('e', { sortOrder: 100 })
    ]
    expect(manualOrderedRows(rows, []).map((row) => row.id)).toEqual(
      buildWorktreeManualOrderCatalog({ worktrees: rows, folderWorkspaces: [] }).orderedKeys.map(
        getWorktreeIdFromHostIdentity
      )
    )
    expect(shownIn(draw({ rows }), keyOf(null))).toEqual(['b', 'a', 'c', 'd', 'e'])
  })

  it('lands below two rows that have no manual order (d1, d2, then c1)', () => {
    // d1 and d2 were just created: no manualOrder, sortOrder is their creation time.
    const rows = [
      wt('c1', { sidebarGroupId: 'g2', manualOrder: 5_000 }),
      wt('d1', { sidebarGroupId: 'g1', sortOrder: 9_000 }),
      wt('d2', { sidebarGroupId: 'g1', sortOrder: 8_000 })
    ]
    expect(shownIn(draw({ rows }), keyOf('g1'))).toEqual(['d1', 'd2'])
    const result = dropAndRedraw({ rows }, 'c1', 'g1', 2)
    expect(result.shown).toEqual(['d1', 'd2', 'c1'])
    expect(result.written).toEqual(['c1'])
  })

  it('lands at the end of a group whose rows have no manual order', () => {
    const rows = [
      wt('a4', { manualOrder: 99_000 }),
      wt('b1', { sidebarGroupId: 'g2', sortOrder: 3_000 }),
      wt('b3', { sidebarGroupId: 'g2', sortOrder: 2_000 }),
      wt('b4', { sidebarGroupId: 'g2', sortOrder: 2_000 })
    ]
    const before = shownIn(draw({ rows }), keyOf('g2'))
    const result = dropAndRedraw({ rows }, 'a4', 'g2', before.length)
    expect(result.shown).toEqual([...before, 'a4'])
  })

  it('lands exactly where it was dropped among valued, unset and tied rows', () => {
    // Deterministic pseudo-random sections: every drop index, mixed keys, ties included.
    let seed = 7
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    for (let round = 0; round < 60; round += 1) {
      const count = 2 + Math.floor(random() * 5)
      const rows = [
        wt('moved', { sidebarGroupId: 'g2', manualOrder: Math.floor(random() * 10) * 100 }),
        ...Array.from({ length: count }, (_, index) => {
          const valued = random() < 0.5
          const key = Math.floor(random() * 6) * 100
          return wt(`r${index}`, {
            sidebarGroupId: 'g1',
            sortOrder: valued ? 0 : key,
            ...(valued ? { manualOrder: key } : {})
          })
        }),
        wt('other', { sortOrder: Math.floor(random() * 6) * 100 })
      ]
      const before = shownIn(draw({ rows }), keyOf('g1'))
      for (let index = 0; index <= before.length; index += 1) {
        const result = dropAndRedraw({ rows }, 'moved', 'g1', index)
        expect(result.shown, `round ${round}, index ${index}`).toEqual(
          insert(before, index, 'moved')
        )
      }
    }
  })
})
