// Upstream renders the sidebar with react-dom/server in its tests. useSyncExternalStore without a
// getServerSnapshot throws there ("Missing getServerSnapshot"), so every fork call passes one.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SidebarGroupByToggle } from '../renderer/src/components/sidebar/worktree-list/controls/SidebarGroupByToggle'

const ROOT = resolve(__dirname, '../..')
// Upstream files where the fork added a useSyncExternalStore call (none: they call fork hooks).
const UPSTREAM_CALL_SITES: string[] = []

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      return sourceFiles(path)
    }
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

/** Top-level argument count of every `useSyncExternalStore(...)` call in the source. */
function callArgCounts(source: string): number[] {
  const counts: number[] = []
  const pattern = /\buseSyncExternalStore\(/g
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    let depth = 0
    let args = 1
    let empty = true
    for (let index = match.index + match[0].length; index < source.length; index += 1) {
      const char = source[index]!
      if ('([{'.includes(char)) {
        depth += 1
      } else if (')]}'.includes(char)) {
        if (depth === 0) {
          break
        }
        depth -= 1
      } else if (char === ',' && depth === 0) {
        args += 1
      }
      if (!/\s/.test(char) && char !== ',') {
        empty = false
      }
    }
    // A trailing comma before `)` is not another argument.
    const call = source.slice(match.index, source.indexOf(')', match.index) + 1)
    counts.push(empty ? 0 : /,\s*\)$/.test(call) ? args - 1 : args)
  }
  return counts
}

describe('fork useSyncExternalStore calls', () => {
  it('all pass getServerSnapshot', () => {
    const files = [
      ...sourceFiles(join(ROOT, 'src/fork')),
      ...UPSTREAM_CALL_SITES.map((file) => join(ROOT, file))
    ]
    const missing = files.flatMap((file) =>
      callArgCounts(readFileSync(file, 'utf8'))
        .filter((count) => count < 3)
        .map(() => relative(ROOT, file))
    )
    expect(missing).toEqual([])
  })

  it('counts arguments, so the check above can fail', () => {
    expect(callArgCounts('useSyncExternalStore(subscribe, read)')).toEqual([2])
    expect(callArgCounts('useSyncExternalStore(\n  a,\n  () => f(x, y),\n  b\n)')).toEqual([3])
  })

  it('render on the server', () => {
    expect(() =>
      renderToString(createElement(SidebarGroupByToggle, { groupBy: 'none', setGroupBy: () => {} }))
    ).not.toThrow()
  })
})
