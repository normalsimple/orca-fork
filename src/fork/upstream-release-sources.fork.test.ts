import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// 这些地方会拼出上游发布地址或上游站点地址。每一处都必须在 fork 构建里被 isForkBuild() 挡住。
// 上游新加了一处时这个测试会失败：先加门，再把文件加进清单。
const GATED_SOURCES = [
  'src/main/runtime/agent-state-rules/agent-state-rules-live-update.ts',
  'src/main/updater/lifecycle/updater-setup.ts',
  'src/main/updater/nudges/nudge-campaign.ts',
  'src/main/updater/releases/updater-changelog.ts',
  'src/main/updater/releases/updater-prerelease-feed.ts',
  'src/main/updater/releases/updater-release-builds.ts',
  'src/main/updater/releases/updater-release-readiness.ts',
  'src/main/wsl/host-lifecycle/wsl-hosts-policy-live-update.ts',
  'src/shared/release-channel.ts'
]

const UPSTREAM_RELEASE_SOURCE =
  /stablyai\/orca[\w-]*\/releases|stablyai\\\/orca\\\/releases|onorca\.dev\/whats-new|\b\w*RELEASE_REPO\b|getReleaseRepoForChannel\(/

const ROOTS = ['src/main', 'src/shared', 'src/renderer/src', 'src/preload', 'src/cli', 'src/fork']
const SKIP = /\.(test|spec)\.tsx?$|__fixtures__|\/i18n\/locales\/|updater-test-harness\.ts$/

// A guard that survives only in a comment does not count.
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      walk(path, out)
    } else if (/\.(ts|tsx|mts|cts)$/.test(name) && !SKIP.test(path)) {
      out.push(path)
    }
  }
}

describe('upstream release URL sources', () => {
  it('lists every source file and each one checks isForkBuild()', () => {
    const files: string[] = []
    for (const root of ROOTS) {
      walk(root, files)
    }
    const hits = files
      .filter((file) => UPSTREAM_RELEASE_SOURCE.test(readFileSync(file, 'utf8')))
      .map((file) => relative(process.cwd(), file))
      .sort()
    expect(hits).toEqual(GATED_SOURCES)
    for (const file of GATED_SOURCES) {
      expect(code(file), file).toContain('isForkBuild()')
    }
  })
})
