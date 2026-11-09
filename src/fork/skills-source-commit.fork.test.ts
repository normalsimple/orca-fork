import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { electronViteConfig } from '../../electron.vite.config'
import { buildAgentFeatureSkillInstallCommand } from '../shared/agent-feature-install-commands'
import { FORK_SKILLS_SOURCE_COMMIT } from './skills-source-commit'
import {
  readCheckedInSkillsSourceCommit,
  renderSkillsSourceCommitModule,
  resolveForkSkillsSourceCommit
} from '../../fork/scripts/sync-skills-source-commit.mjs'

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8' }).trim()
}

const UPSTREAM_REFS = [
  'fork/base-upstream',
  'origin/fork/base-upstream',
  'upstream/main',
  'origin/upstream/main'
]

function hasRef(ref: string): boolean {
  try {
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    return true
  } catch {
    return false
  }
}

function cliProductionSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return cliProductionSources(path)
    }
    if (!entry.isFile() || !path.endsWith('.ts') || path.endsWith('.test.ts')) {
      return []
    }
    return [path]
  })
}

function rendererSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return rendererSources(path)
    }
    return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) ? [path] : []
  })
}

function rendererSkillCommit(): string {
  const define: unknown = electronViteConfig.renderer?.define?.ORCA_BUILD_COMMIT
  return typeof define === 'string' ? JSON.parse(define) : ''
}

function runtimeSpecifiers(source: string): string[] {
  const code = source.replace(/import\s+type\s+[\s\S]*?\sfrom\s+['"][^'"]+['"]/g, '')
  return [...code.matchAll(/(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
    (match) => match[1] ?? ''
  )
}

describe('fork skill source commit', () => {
  // The pin is checked against whichever upstream refs this clone has. A clone with none of them
  // (no fork/base-upstream, no upstream/main) cannot say what the base is, so it skips by name.
  const upstreamRefs = UPSTREAM_REFS.filter((ref) => hasRef(ref))

  const pinTestName =
    upstreamRefs.length === 0
      ? 'pins a fork build to the upstream base (skipped: no upstream ref in this clone)'
      : `pins a fork build to the upstream base, never this fork commit (checked against ${upstreamRefs.join(', ')})`

  it.skipIf(upstreamRefs.length === 0)(pinTestName, () => {
    const head = git(['rev-parse', 'HEAD'])
    const pin = resolveForkSkillsSourceCommit(head)
    expect(FORK_SKILLS_SOURCE_COMMIT).toBe(pin)
    expect(pin).not.toBe(head)
    // The pin is the base the resolver found from the first ref present, and every ref present
    // contains it: a fork/base-upstream-less Mac uses merge-base with upstream/main, not its tip.
    expect(pin).toBe(git(['merge-base', 'HEAD', upstreamRefs[0]!]))
    for (const ref of upstreamRefs) {
      expect(() => git(['merge-base', '--is-ancestor', pin!, ref])).not.toThrow()
    }
    expect(rendererSkillCommit()).toBe(pin)
  })

  it('uses the merge-base with upstream main, not its tip, when the fork base ref is missing', () => {
    const base = 'a'.repeat(40)
    const run = (args: string[]) => {
      if (args[0] === 'merge-base' && args[2]?.includes('fork/base-upstream')) {
        throw new Error('missing ref')
      }
      if (args.join(' ') === 'merge-base HEAD upstream/main') {
        return base
      }
      throw new Error(`unexpected ${args.join(' ')}`)
    }
    expect(resolveForkSkillsSourceCommit('b'.repeat(40), { run, readPin: () => null })).toBe(base)
  })

  it('feeds the pin to the renderer build, whose only ORCA_BUILD_COMMIT use is the skill command', () => {
    const commit = rendererSkillCommit()
    expect(commit).toBe(FORK_SKILLS_SOURCE_COMMIT)
    expect(buildAgentFeatureSkillInstallCommand(['orca-cli'], { sourceCommit: commit })).toContain(
      `https://github.com/stablyai/orca/tree/${FORK_SKILLS_SOURCE_COMMIT}`
    )
    // A new upstream renderer use of the define would silently read the upstream base: decide first.
    const readers = rendererSources('src/renderer/src').filter((path) =>
      /\bORCA_BUILD_COMMIT\b/.test(readFileSync(path, 'utf8'))
    )
    expect(readers).toEqual([
      'src/renderer/src/env.d.ts',
      'src/renderer/src/lib/skills/installation/agent-feature-install-commands.ts'
    ])
  })

  it('rewrites the pin module byte for byte from the sync script', () => {
    const source = readFileSync('src/fork/skills-source-commit.ts', 'utf8')
    expect(renderSkillsSourceCommitModule(readCheckedInSkillsSourceCommit(source))).toBe(source)
  })

  it('keeps production CLI code off src/fork', () => {
    expect(readFileSync('src/cli/index.ts', 'utf8')).not.toContain('../fork/')
    const leaks = cliProductionSources('src/cli').flatMap((path) =>
      runtimeSpecifiers(readFileSync(path, 'utf8'))
        .filter((specifier) => /(?:^|\/)fork(?:\/|$)/.test(specifier))
        .map((specifier) => `${path} -> ${specifier}`)
    )
    expect(leaks).toEqual([])
  })

  it.skipIf(!existsSync('out/cli/index.js'))(
    'resolves the packaged CLI closure without src/fork or the skill pin',
    () => {
      execFileSync(process.execPath, ['fork/scripts/verify-packaged-cli-closure.mjs'], {
        stdio: 'inherit'
      })
    }
  )

  it('keeps the checked-in pin when no upstream ref is available', () => {
    const pinned = 'c'.repeat(40)
    const run = () => {
      throw new Error('no git')
    }
    expect(resolveForkSkillsSourceCommit('d'.repeat(40), { run, readPin: () => pinned })).toBe(
      pinned
    )
    expect(resolveForkSkillsSourceCommit('d'.repeat(40), { run, readPin: () => pinned })).not.toBe(
      'd'.repeat(40)
    )
  })
})
