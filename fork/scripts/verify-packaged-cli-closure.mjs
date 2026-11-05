import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(import.meta.dirname, '..', '..')
const forkOutPrefix = ['out', 'fork', ''].join('/')

/**
 * The packaged CLI is unpacked at out/cli and out/shared, not out/fork.
 * Walk the built closure and fail if it needs a fork module.
 */
export function findForkClosureLeaks(repoRoot = root) {
  const outDir = join(repoRoot, 'out')
  if (!existsSync(join(outDir, 'cli/index.js'))) {
    return null
  }
  const { collectRuntimeClosure } = require(
    join(repoRoot, 'config/scripts/runtime-verification/skills-cli/verify-skills-cli-runtime.cjs')
  )
  const closure = collectRuntimeClosure(outDir, repoRoot).map((file) =>
    relative(repoRoot, file).split(sep).join('/')
  )
  // 上游 CLI 改为拷贝内置技能，不再按提交克隆。技能 pin 仍由 tsc 发到 out/cli，安装脚本只检查文件在不在，闭包不必包含它。
  return closure.filter((file) => file.startsWith(forkOutPrefix))
}

function main() {
  let leaks
  try {
    leaks = findForkClosureLeaks()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
    return
  }
  if (!leaks) {
    console.error('out/cli/index.js is missing; run pnpm build:cli')
    process.exitCode = 2
    return
  }
  if (leaks.length > 0) {
    console.error(`CLI closure is missing an unpacked fork module:\n${leaks.join('\n')}`)
    process.exitCode = 1
    return
  }
  console.log('packaged CLI closure ok')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
