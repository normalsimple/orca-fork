import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readCheckedInSkillsSourceCommit } from './sync-skills-source-commit.mjs'

// 基线 X.Y.Z 是「当前 pin 已经包含其 main 线」的最高上游稳定版。
// 稳定 tag 在发布分支上，merge-base(tag, upstream/main) 才是 main 上的那个点；
// 用 pin 做 merge-base 会把「从 pin 之后的 main 切出去」的新发布也算进来。
// 必须和 fetch-upstream-main.sh、daily-sync.sh 里的地址一致。
const UPSTREAM_URL = 'https://github.com/stablyai/orca.git'
const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const SHA = /^[0-9a-f]{40}$/
const TAG_PREFIX = 'refs/fork-upstream-tags/'
const root = join(import.meta.dirname, '..', '..')

export function parseStableTag(name) {
  const match = STABLE_TAG.exec(name)
  if (!match) {
    return null
  }
  const core = [Number(match[1]), Number(match[2]), Number(match[3])]
  return { name, version: core.join('.'), core }
}

function compareStableCore(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index]
    }
  }
  return 0
}

export function stableTagsFromLsRemote(text) {
  const peeled = new Map()
  const tagged = new Map()
  for (const line of text.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab === -1) {
      continue
    }
    const sha = line.slice(0, tab)
    const ref = line.slice(tab + 1)
    if (!ref.startsWith('refs/tags/')) {
      continue
    }
    if (ref.endsWith('^{}')) {
      peeled.set(ref.slice('refs/tags/'.length, -3), sha)
    } else {
      tagged.set(ref.slice('refs/tags/'.length), sha)
    }
  }
  const tags = []
  for (const [name, tagSha] of tagged) {
    const parsed = parseStableTag(name)
    if (!parsed) {
      continue
    }
    tags.push({ ...parsed, sha: peeled.get(name) ?? tagSha })
  }
  tags.sort((left, right) => compareStableCore(right.core, left.core))
  return tags
}

export function chooseAlignedRelease(tags, pin, mainlineOf, isAncestor) {
  const stable = []
  for (const tag of tags) {
    const parsed = parseStableTag(tag.name)
    if (parsed) {
      stable.push({ ...tag, ...parsed })
    }
  }
  stable.sort((left, right) => compareStableCore(right.core, left.core))
  if (stable.length === 0) {
    throw new Error('no upstream stable tags were listed')
  }
  for (const tag of stable) {
    const mainline = mainlineOf(tag)
    if (mainline && isAncestor(mainline, pin)) {
      return { version: tag.version, tag: tag.name, mainline, pin }
    }
  }
  throw new Error(`no stable upstream tag is contained in ${pin}`)
}

function stableTagNamed(tags, version) {
  for (const tag of tags) {
    const parsed = parseStableTag(tag.name)
    if (parsed?.version === version) {
      return { ...tag, ...parsed }
    }
  }
  return null
}

// --check 只拒绝「把对齐说得比 pin 更新」。更高的、已经含在 pin 里的 tag 只警告：
// 打包出去的版本仍然是真的（至少包含 package.json 这个基线），不必等下一次同步。
export function assessCheckedBase(current, aligned, tags, pin, mainlineOf, isAncestor) {
  const parsed = parseStableTag(`v${current}`)
  if (!parsed) {
    throw new Error(`base version must be X.Y.Z, got ${current}`)
  }
  const tag = stableTagNamed(tags, current)
  if (!tag) {
    throw new Error(`package.json ${current} is not an upstream stable tag`)
  }
  const mainline = mainlineOf(tag)
  if (!mainline || !isAncestor(mainline, pin)) {
    throw new Error(`package.json ${current} overstates the upstream release contained in ${pin}`)
  }
  if (planBaseUpdate(current, aligned.version) === 'update') {
    return `upstream ${aligned.version} (${aligned.tag}) is contained in ${pin} and is newer than package.json ${current}; run node fork/scripts/upstream-aligned-version.mjs --write on the next sync`
  }
  return null
}

export function planBaseUpdate(current, aligned) {
  const currentTag = parseStableTag(`v${current}`)
  const alignedTag = parseStableTag(`v${aligned}`)
  if (!currentTag || !alignedTag) {
    throw new Error(`base version must be X.Y.Z, got ${current} -> ${aligned}`)
  }
  const comparison = compareStableCore(alignedTag.core, currentTag.core)
  if (comparison < 0) {
    throw new Error(`refusing to move the base version backwards from ${current} to ${aligned}`)
  }
  return comparison === 0 ? 'unchanged' : 'update'
}

export function replacePackageVersion(source, from, to) {
  const needle = `"version": "${from}"`
  const at = source.indexOf(needle)
  if (at === -1 || source.includes(needle, at + needle.length)) {
    throw new Error(`package.json version field ${from} was not a single match`)
  }
  return `${source.slice(0, at)}"version": "${to}"${source.slice(at + needle.length)}`
}

export function assertSamePin(committed, resolved) {
  if (committed !== resolved) {
    throw new Error(
      `skills pin ${committed} is not the upstream commit contained in HEAD (${resolved})`
    )
  }
}

export function assertFullHistory(git) {
  if (git(['rev-parse', '--is-shallow-repository']) === 'true') {
    throw new Error(
      'shallow clone cannot tell which upstream release this pin contains; use a full history'
    )
  }
}

export function createGit(repo) {
  return function git(args, options = {}) {
    try {
      return execFileSync('git', ['-C', repo, ...args], {
        encoding: 'utf8',
        timeout: options.timeout ?? 120_000,
        stdio: ['ignore', 'pipe', 'pipe']
      }).trim()
    } catch (error) {
      const status = typeof error.status === 'number' ? error.status : null
      if (options.allowStatus?.includes(status)) {
        return null
      }
      const stderr = error.stderr ? String(error.stderr).trim() : ''
      throw new Error(`git ${args.join(' ')} failed: ${stderr || error.message}`)
    }
  }
}

function requireSha(value, label) {
  if (!value || !SHA.test(value)) {
    throw new Error(`${label} is not a commit: ${value ?? ''}`)
  }
  return value
}

function fetchUpstreamMain(repo) {
  execFileSync('bash', [join(import.meta.dirname, 'verify/fetch-upstream-main.sh')], {
    cwd: repo,
    stdio: 'inherit'
  })
}

function upstreamRemote(git) {
  return git(['remote', 'get-url', 'upstream'], { allowStatus: [2, 128] }) || UPSTREAM_URL
}

function materializeTag(git, remote, tag) {
  const dest = `${TAG_PREFIX}${tag.name}`
  const have = git(['rev-parse', `${dest}^{}`], { allowStatus: [128] })
  if (have !== tag.sha) {
    console.error(`upstream version: fetch ${tag.name}`)
    git(['fetch', '--no-tags', remote, `+refs/tags/${tag.name}:${dest}`], { timeout: 180_000 })
    const got = requireSha(git(['rev-parse', `${dest}^{}`]), tag.name)
    if (got !== tag.sha) {
      throw new Error(`tag ${tag.name} peeled to ${got}, ls-remote said ${tag.sha}`)
    }
  }
  return dest
}

export function applyBaseVersion(repo, mode, options = {}) {
  if (mode !== 'write' && mode !== 'check' && mode !== 'print') {
    throw new Error(`unknown mode ${mode}`)
  }
  const git = options.git ?? createGit(repo)
  assertFullHistory(git)
  const fetchMain = options.fetchMain ?? (() => fetchUpstreamMain(repo))
  fetchMain()
  const pin =
    options.pin ?? requireSha(git(['merge-base', 'HEAD', 'upstream/main']), 'upstream pin')
  const committed = options.readPin
    ? options.readPin()
    : readCheckedInSkillsSourceCommit(
        readFileSync(join(repo, 'src/fork/skills-source-commit.ts'), 'utf8')
      )
  if (!committed) {
    throw new Error('skills pin is missing')
  }
  assertSamePin(committed, pin)
  const remote = options.remote ?? upstreamRemote(git)
  const tags =
    options.tags ??
    stableTagsFromLsRemote(git(['ls-remote', '--tags', remote], { timeout: 180_000 }))
  const mainlineOf =
    options.mainlineOf ??
    ((tag) => {
      const ref = materializeTag(git, remote, tag)
      return git(['merge-base', ref, 'upstream/main'], { allowStatus: [1] })
    })
  const isAncestor =
    options.isAncestor ??
    ((ancestor, descendant) =>
      git(['merge-base', '--is-ancestor', ancestor, descendant], { allowStatus: [1] }) !== null)
  const aligned = chooseAlignedRelease(tags, pin, mainlineOf, isAncestor)
  const packagePath = join(repo, 'package.json')
  const source = readFileSync(packagePath, 'utf8')
  const current = JSON.parse(source).version
  if (mode === 'check') {
    const warning = assessCheckedBase(current, aligned, tags, pin, mainlineOf, isAncestor)
    return { ...aligned, current, plan: warning ? 'update' : 'unchanged', warning }
  }
  const plan = planBaseUpdate(current, aligned.version)
  if (mode === 'write' && plan === 'update') {
    writeFileSync(packagePath, replacePackageVersion(source, current, aligned.version))
  }
  return { ...aligned, current, plan, warning: null }
}

function main() {
  const flag = process.argv[2]
  const mode = flag?.startsWith('--') ? flag.slice(2) : ''
  if (mode !== 'write' && mode !== 'check' && mode !== 'print') {
    console.error('usage: upstream-aligned-version.mjs --write|--check|--print')
    process.exit(1)
  }
  try {
    const result = applyBaseVersion(root, mode)
    if (result.warning) {
      console.error(result.warning)
    }
    if (mode === 'print') {
      console.log(
        `${result.version} tag ${result.tag} pin ${result.pin} mainline ${result.mainline} package ${result.current} (${result.plan})`
      )
    } else if (mode === 'write' && result.plan === 'update') {
      console.log(`base version ${result.current} -> ${result.version} (${result.tag})`)
    } else if (result.warning) {
      console.log(
        `base version ${result.current} is an upstream release contained in ${result.pin}`
      )
    } else {
      console.log(`base version unchanged ${result.version} (${result.tag}, pin ${result.pin})`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
