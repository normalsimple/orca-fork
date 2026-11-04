import { describe, expect, it } from 'vitest'
import { normalizeExecutionHostId, type ExecutionHostId } from '../../shared/execution-host'
import type { Worktree } from '../../shared/worktree/types'
import { hostDirectorySectionKey, looseHostSectionKey } from './section-keys'
import { buildWorktreeManualOrderCatalog } from '../../renderer/src/components/sidebar/worktree-list/drag/worktree-manual-order-catalog'
import {
  composeWorktreeHostIdentity,
  getWorktreeIdFromHostIdentity
} from '../../shared/worktree/host-qualified-identity'
import { buildGroupDropOrder } from './group-drop-order'
import { planGroupDropItems, type GroupDropState } from './workspace-group-drop-plan'

const HOST = normalizeExecutionHostId('ssh:devbox') as ExecutionHostId
const LOOSE = looseHostSectionKey(HOST)
const GROUP = hostDirectorySectionKey(HOST, 'g1')

// Drag groups list host identities, as the sidebar's drag groups do.
function keys(ids: readonly string[], host: ExecutionHostId = HOST): string[] {
  return ids.map((id) => composeWorktreeHostIdentity(host, id))
}

function row(id: string, extra: Partial<Worktree>): Worktree {
  return {
    id,
    repoId: 'r1',
    path: `/srv/${id}`,
    branch: 'refs/heads/main',
    head: 'abc',
    isBare: false,
    isMainWorktree: false,
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    comment: '',
    isUnread: false,
    isPinned: false,
    displayName: id,
    sortOrder: 0,
    lastActivityAt: 0,
    hostId: HOST,
    ...extra
  }
}

// The ungrouped rows have never been dragged: they sort by sortOrder and have no manual order.
const rows = [
  row('moved', { sidebarGroupId: 'g1', sortOrder: 900 }),
  row('a', { sortOrder: 800 }),
  row('b', { sortOrder: 500 }),
  row('c', { sortOrder: 100, manualOrder: 300 })
]

const state: GroupDropState = {
  worktreesByRepo: { r1: rows },
  repos: [],
  folderWorkspaces: [],
  projectGroups: [],
  getKnownWorktreeById: (id) => rows.find((entry) => entry.id === id)
}

const groups = [
  { key: GROUP, worktreeIds: keys(['moved']) },
  { key: LOOSE, worktreeIds: keys(['a', 'b', 'c']) }
]

function order(dropIndex: number) {
  return buildGroupDropOrder(
    state,
    groups,
    { groupId: null, key: LOOSE },
    ['moved'],
    dropIndex,
    () => false,
    10_000
  )
}

describe('group drop order', () => {
  it('writes only the moved row, between its new neighbours', () => {
    const updates = order(1)
    expect([...updates.keys()]).toEqual(['moved'])
    const rank = updates.get('moved')!.manualOrder
    // a sorts at 800 (sortOrder), b at 500: the moved row lands between them, nobody else moves.
    expect(rank).toBeLessThan(800)
    expect(rank).toBeGreaterThan(500)
  })

  it('uses a neighbour manual order when it has one', () => {
    const rank = order(3).get('moved')!.manualOrder
    expect(rank).toBeLessThan(300)
  })

  it('goes above the first row and below the last one', () => {
    expect(order(0).get('moved')!.manualOrder).toBeGreaterThan(800)
    expect(order(2).get('moved')!.manualOrder).toBeGreaterThan(300)
    expect(order(2).get('moved')!.manualOrder).toBeLessThan(500)
  })

  it('keeps several moved rows in order without renumbering the others', () => {
    const updates = buildGroupDropOrder(
      state,
      [
        { key: GROUP, worktreeIds: keys(['moved', 'a']) },
        { key: LOOSE, worktreeIds: keys(['b', 'c']) }
      ],
      { groupId: null, key: LOOSE },
      ['moved', 'a'],
      1,
      () => false,
      10_000
    )
    expect([...updates.keys()]).toEqual(['moved', 'a'])
    const [first, second] = [updates.get('moved')!.manualOrder, updates.get('a')!.manualOrder]
    expect(first).toBeLessThan(500)
    expect(first).toBeGreaterThan(second)
    expect(second).toBeGreaterThan(300)
  })

  it('ranks into an empty group', () => {
    const updates = buildGroupDropOrder(
      state,
      groups,
      { groupId: 'g2', key: hostDirectorySectionKey(HOST, 'g2') },
      ['a'],
      0,
      () => false,
      10_000
    )
    expect([...updates.entries()]).toEqual([['a', { manualOrder: 10_000 }]])
  })

  it('writes only the moved row when there is room (no section renumber)', () => {
    const updates = order(2)
    expect([...updates.keys()]).toEqual(['moved'])
    expect(
      planGroupDropItems(state, HOST, { groupId: null, key: LOOSE }, ['moved'], updates)
    ).toHaveLength(1)
  })
})

// Applies a drop's updates and returns the loose section in the order manual sort shows it.
function applyAndList(
  current: Worktree[],
  updates: ReadonlyMap<string, { manualOrder: number }>,
  regrouped: readonly string[]
): { rows: Worktree[]; loose: string[] } {
  const rows = current.map((entry) => {
    const update = updates.get(entry.id)
    const moved = regrouped.includes(entry.id)
    return update || moved
      ? { ...entry, ...update, ...(moved ? { sidebarGroupId: null } : {}) }
      : entry
  })
  const catalog = buildWorktreeManualOrderCatalog({ worktrees: rows, folderWorkspaces: [] })
  const loose = catalog.orderedKeys
    .map(getWorktreeIdFromHostIdentity)
    .filter((id) => !rows.find((entry) => entry.id === id)!.sidebarGroupId)
  return { rows, loose }
}

function dropInto(
  rows: Worktree[],
  loose: readonly string[],
  dragged: readonly string[],
  dropIndex: number
) {
  const grouped = rows.filter((entry) => entry.sidebarGroupId).map((entry) => entry.id)
  return buildGroupDropOrder(
    {
      ...state,
      worktreesByRepo: { r1: rows },
      getKnownWorktreeById: (id) => rows.find((entry) => entry.id === id)
    },
    [
      { key: GROUP, worktreeIds: keys(grouped) },
      { key: LOOSE, worktreeIds: keys(loose) }
    ],
    { groupId: null, key: LOOSE },
    dragged,
    dropIndex,
    () => false,
    10_000
  )
}

describe('group drop order without room between the neighbours', () => {
  // x and y tie at 50; by name "zeta" would sort after both, so a shared key would misplace it.
  const tied = [
    row('zeta', { sidebarGroupId: 'g1', sortOrder: 1 }),
    row('w', { sortOrder: 90 }),
    row('x', { sortOrder: 50 }),
    row('y', { sortOrder: 50 }),
    row('z', { sortOrder: 10, manualOrder: 10 })
  ]

  it('renumbers the target section when the neighbours tie, landing exactly at the drop', () => {
    const updates = dropInto(tied, ['w', 'x', 'y', 'z'], ['zeta'], 2)
    const { loose } = applyAndList(tied, updates, ['zeta'])
    expect(loose).toEqual(['w', 'x', 'zeta', 'y', 'z'])
    // Only rows of the target section are written; all keys are now distinct.
    expect(new Set(updates.keys())).toEqual(new Set(['w', 'x', 'zeta', 'y', 'z']))
    const values = [...updates.values()].map((entry) => entry.manualOrder)
    expect(new Set(values).size).toBe(values.length)
  })

  it('writes the renumbered neighbours as order-only items, the moved row with its group', () => {
    const updates = dropInto(tied, ['w', 'x', 'y', 'z'], ['zeta'], 2)
    const items = planGroupDropItems(
      {
        ...state,
        worktreesByRepo: { r1: tied },
        getKnownWorktreeById: (id) => tied.find((e) => e.id === id)
      },
      HOST,
      { groupId: null, key: LOOSE },
      ['zeta'],
      updates
    )
    if ('error' in items) {
      throw new Error(items.error)
    }
    expect(items[0]).toMatchObject({ storeId: 'zeta', next: { sidebarGroupId: null } })
    for (const item of items.slice(1)) {
      expect(Object.keys(item.next)).toEqual(['manualOrder'])
      expect(Object.keys(item.previous)).toEqual(['manualOrder'])
    }
    // z already sat at 10 with a manual order; a rollback puts that value back, others clear.
    expect(items.find((item) => item.storeId === 'z')?.previous).toEqual({ manualOrder: 10 })
    expect(items.find((item) => item.storeId === 'x')?.previous).toEqual({ manualOrder: undefined })
  })

  it('places a multi-row drop into a tie exactly, in drag order', () => {
    const rows = [
      row('m1', { sidebarGroupId: 'g1', sortOrder: 2 }),
      row('m2', { sidebarGroupId: 'g1', sortOrder: 1 }),
      ...tied.slice(1)
    ]
    const updates = dropInto(rows, ['w', 'x', 'y', 'z'], ['m1', 'm2'], 2)
    const { loose } = applyAndList(rows, updates, ['m1', 'm2'])
    expect(loose).toEqual(['w', 'x', 'm1', 'm2', 'y', 'z'])
  })

  it('stays exact over 60 drops into the same gap and renumbers only when it must', () => {
    let rows = [
      row('a', { sortOrder: 2000 }),
      row('b', { sortOrder: 1000 }),
      ...Array.from({ length: 60 }, (_, index) =>
        row(`n${String(index).padStart(2, '0')}`, { sidebarGroupId: 'g1', sortOrder: 1 })
      )
    ]
    let loose = ['a', 'b']
    let renumbered = 0
    for (let index = 0; index < 60; index += 1) {
      const id = `n${String(index).padStart(2, '0')}`
      // Always dropped right under "a": the gap above the previous drop keeps halving.
      const updates = dropInto(rows, loose, [id], 1)
      if (updates.size > 1) {
        renumbered += 1
      }
      const next = applyAndList(rows, updates, [id])
      expect(next.loose[1]).toBe(id)
      expect(next.loose).toEqual(['a', id, ...loose.slice(1)])
      const keys = next.rows
        .filter((entry) => !entry.sidebarGroupId)
        .map((entry) => entry.manualOrder ?? entry.sortOrder)
      expect(new Set(keys).size).toBe(keys.length)
      rows = next.rows
      loose = next.loose
    }
    // Most drops write one row; the section is renumbered only once the gap is used up.
    expect(renumbered).toBeGreaterThan(0)
    expect(renumbered).toBeLessThan(10)
  })
})

describe('group drop order keeps the order across the full list when it renumbers', () => {
  function fullOrder(rows: Worktree[]): string[] {
    return buildWorktreeManualOrderCatalog({
      worktrees: rows,
      folderWorkspaces: []
    }).orderedKeys.map(getWorktreeIdFromHostIdentity)
  }

  it('renumbers inside the gap other sections leave, so merged views keep their order', () => {
    // x and y tie; f (another group) sits below them and above z in the full list.
    const rows = [
      row('zeta', { sidebarGroupId: 'g1', sortOrder: 1 }),
      row('w', { sortOrder: 90 }),
      row('x', { sortOrder: 50 }),
      row('y', { sortOrder: 50 }),
      row('f', { sidebarGroupId: 'g1', sortOrder: 20 }),
      row('z', { sortOrder: 10, manualOrder: 10 })
    ]
    const before = fullOrder(rows).filter((id) => id !== 'zeta')
    const updates = dropInto(rows, ['w', 'x', 'y', 'z'], ['zeta'], 2)
    const { rows: after, loose } = applyAndList(rows, updates, ['zeta'])
    expect(loose).toEqual(['w', 'x', 'zeta', 'y', 'z'])
    // The order of every other row across all sections is what it was.
    expect(fullOrder(after).filter((id) => id !== 'zeta')).toEqual(before)
    // Only the run around the drop is written; z (below f) and f keep their keys.
    expect(new Set(updates.keys())).toEqual(new Set(['w', 'x', 'zeta', 'y']))
    for (const value of [...updates.values()].map((entry) => entry.manualOrder)) {
      expect(value).toBeGreaterThan(20)
    }
  })

  it('stays between two rows of another section that bound the run', () => {
    const rows = [
      row('moved', { sidebarGroupId: 'g1', sortOrder: 1 }),
      row('top', { sidebarGroupId: 'g1', sortOrder: 100, manualOrder: 100 }),
      row('x', { sortOrder: 50 }),
      row('y', { sortOrder: 50 }),
      row('bottom', { sidebarGroupId: 'g1', sortOrder: 40, manualOrder: 40 }),
      row('z', { sortOrder: 10 })
    ]
    const before = fullOrder(rows).filter((id) => id !== 'moved')
    const updates = dropInto(rows, ['x', 'y', 'z'], ['moved'], 1)
    const { rows: after, loose } = applyAndList(rows, updates, ['moved'])
    expect(loose).toEqual(['x', 'moved', 'y', 'z'])
    expect(fullOrder(after).filter((id) => id !== 'moved')).toEqual(before)
    for (const value of [...updates.values()].map((entry) => entry.manualOrder)) {
      expect(value).toBeGreaterThan(40)
      expect(value).toBeLessThan(100)
    }
  })

  it('falls back to the section renumber when the rows around it tie too', () => {
    // Every row shares one key, so no value fits between other-section rows: inherent.
    const rows = [
      row('moved', { sidebarGroupId: 'g1', sortOrder: 1 }),
      row('a0', { sidebarGroupId: 'g1', sortOrder: 50 }),
      row('b1', { sortOrder: 50 }),
      row('b2', { sortOrder: 50 }),
      row('c0', { sidebarGroupId: 'g1', sortOrder: 50 })
    ]
    const updates = dropInto(rows, ['b1', 'b2'], ['moved'], 1)
    const { loose } = applyAndList(rows, updates, ['moved'])
    expect(loose).toEqual(['b1', 'moved', 'b2'])
  })
})

describe('group drop order with a same-id workspace on another host', () => {
  const OTHER = normalizeExecutionHostId('ssh:other') as ExecutionHostId

  it('ranks against the target host row, not its twin', () => {
    // The twin of "a" on another host sorts first in the full list (2000 > 800).
    const twins = [
      row('moved', { sidebarGroupId: 'g1', sortOrder: 900 }),
      row('a', { sortOrder: 800 }),
      row('b', { sortOrder: 500 }),
      row('a', { hostId: OTHER, sortOrder: 2000 })
    ]
    const twinState: GroupDropState = {
      ...state,
      worktreesByRepo: { r1: twins },
      getKnownWorktreeById: (id, hostId) =>
        twins.find((entry) => entry.id === id && (!hostId || entry.hostId === hostId))
    }
    const updates = buildGroupDropOrder(
      twinState,
      [
        { key: GROUP, worktreeIds: keys(['moved']) },
        { key: LOOSE, worktreeIds: keys(['a', 'b']) },
        { key: looseHostSectionKey(OTHER), worktreeIds: keys(['a'], OTHER) }
      ],
      { groupId: null, key: LOOSE },
      ['moved'],
      1,
      () => false,
      10_000
    )
    expect([...updates.keys()]).toEqual(['moved'])
    const rank = updates.get('moved')!.manualOrder
    // Between this host's a (800) and b (500): the twin's 2000 must not stand in for a.
    expect(rank).toBeLessThan(800)
    expect(rank).toBeGreaterThan(500)
  })
})
