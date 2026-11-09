import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyBaseVersion,
  assertFullHistory,
  assertSamePin,
  chooseAlignedRelease,
  createGit,
  parseStableTag,
  planBaseUpdate,
  replacePackageVersion,
  stableTagsFromLsRemote
} from './upstream-aligned-version.mjs'

function gitEnv(dir) {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    HOME: dir
  }
}

function run(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    env: gitEnv(dir)
  }).trim()
}

describe('upstream aligned base version', () => {
  it('parses only stable vX.Y.Z tags and keeps the peeled commit', () => {
    assert.equal(parseStableTag('v1.4.254')?.version, '1.4.254')
    assert.equal(parseStableTag('v1.4.01'), null)
    assert.equal(parseStableTag('v1.4.2-rc.1'), null)
    assert.equal(parseStableTag('v1.4.2-hourly.1'), null)
    assert.equal(parseStableTag('1.4.2'), null)
    const tags = stableTagsFromLsRemote(
      [
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/tags/v1.4.2',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/tags/v1.4.2^{}',
        'cccccccccccccccccccccccccccccccccccccccc\trefs/tags/v1.4.10',
        'dddddddddddddddddddddddddddddddddddddddd\trefs/tags/v1.4.10-rc.1',
        'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\trefs/tags/v1.4.10-rc.1^{}',
        'ffffffffffffffffffffffffffffffffffffffff\trefs/tags/v1.4.9',
        '1111111111111111111111111111111111111111\trefs/heads/main'
      ].join('\n')
    )
    assert.deepEqual(
      tags.map((tag) => [tag.name, tag.version, tag.sha]),
      [
        ['v1.4.10', '1.4.10', 'cccccccccccccccccccccccccccccccccccccccc'],
        ['v1.4.9', '1.4.9', 'ffffffffffffffffffffffffffffffffffffffff'],
        ['v1.4.2', '1.4.2', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']
      ]
    )
  })

  it('picks 1.4.10 over 1.4.9 when both are contained', () => {
    const aligned = chooseAlignedRelease(
      [
        { name: 'v1.4.9', sha: 'a' },
        { name: 'v1.4.10', sha: 'b' },
        { name: 'v1.4.9-rc.1', sha: 'c' }
      ],
      'pin',
      () => 'mainline',
      () => true
    )
    assert.equal(aligned.version, '1.4.10')
  })

  it('refuses an empty tag list and a pin that contains nothing', () => {
    assert.throws(
      () =>
        chooseAlignedRelease(
          [{ name: 'v1.4.2-rc.1', sha: 'a' }],
          'pin',
          () => 'm',
          () => true
        ),
      /no upstream stable tags were listed/
    )
    assert.throws(
      () =>
        chooseAlignedRelease(
          [{ name: 'v1.4.2', sha: 'a'.repeat(40) }],
          'b'.repeat(40),
          () => null,
          () => false
        ),
      /no stable upstream tag is contained/
    )
  })

  it('keeps the base monotonic and rewrites only the version field', () => {
    assert.equal(planBaseUpdate('1.4.228', '1.4.254'), 'update')
    assert.equal(planBaseUpdate('1.4.99', '1.4.100'), 'update')
    assert.equal(planBaseUpdate('1.4.254', '1.4.254'), 'unchanged')
    assert.throws(() => planBaseUpdate('1.4.254', '1.4.200'), /backwards from 1.4.254 to 1.4.200/)
    assert.throws(() => planBaseUpdate('1.4.100', '1.4.99'), /backwards/)
    assert.throws(() => planBaseUpdate('1.4.228-local.1.abc', '1.4.254'), /X\.Y\.Z/)
    const source = '{\n  "name": "orca",\n  "version": "1.4.228",\n  "description": "keep"\n}\n'
    assert.equal(
      replacePackageVersion(source, '1.4.228', '1.4.254'),
      '{\n  "name": "orca",\n  "version": "1.4.254",\n  "description": "keep"\n}\n'
    )
    assert.throws(
      () => replacePackageVersion(`${source}${source}`, '1.4.228', '1.4.254'),
      /single match/
    )
    assert.throws(() => assertSamePin('a'.repeat(40), 'b'.repeat(40)), /skills pin/)
    assert.doesNotThrow(() => assertSamePin('a'.repeat(40), 'a'.repeat(40)))
  })

  it('selects the highest stable tag whose merge-base with main is an ancestor of the pin', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-ver-'))
    const shallow = mkdtempSync(join(tmpdir(), 'orca-ver-shallow-'))
    try {
      run(dir, ['init', '-q', '-b', 'main'])
      run(dir, ['commit', '--allow-empty', '-q', '-m', 'A'])
      const a = run(dir, ['rev-parse', 'HEAD'])
      run(dir, ['commit', '--allow-empty', '-q', '-m', 'B'])
      const b = run(dir, ['rev-parse', 'HEAD'])
      run(dir, ['commit', '--allow-empty', '-q', '-m', 'C'])
      const pin = run(dir, ['rev-parse', 'HEAD'])
      run(dir, ['commit', '--allow-empty', '-q', '-m', 'D'])
      const tip = run(dir, ['rev-parse', 'HEAD'])
      run(dir, ['update-ref', 'refs/remotes/upstream/main', tip])
      run(dir, ['tag', 'v1.4.1', a])
      run(dir, ['tag', 'v1.4.3', pin])
      run(dir, ['checkout', '-q', '-b', 'rel', b])
      run(dir, ['commit', '--allow-empty', '-q', '-m', 'cherry-1'])
      run(dir, ['commit', '--allow-empty', '-q', '-m', 'cherry-2'])
      run(dir, ['tag', 'v1.4.4'])
      const cherryParent = run(dir, ['rev-parse', 'v1.4.4^'])
      assert.throws(() =>
        run(dir, ['merge-base', '--is-ancestor', cherryParent, 'refs/remotes/upstream/main'])
      )
      run(dir, ['checkout', '-q', '-b', 'rel-new', tip])
      run(dir, ['commit', '--allow-empty', '-q', '-m', 'not-merged'])
      run(dir, ['tag', 'v1.4.5'])
      run(dir, ['tag', 'v1.4.9-rc.1', pin])
      run(dir, ['checkout', '-q', '--detach', pin])

      const git = createGit(dir)
      assert.equal(git(['merge-base', 'HEAD', 'refs/remotes/upstream/main']), pin)
      assert.equal(git(['merge-base', 'v1.4.4', 'refs/remotes/upstream/main']), b)
      assert.equal(git(['merge-base', 'v1.4.5', 'refs/remotes/upstream/main']), tip)
      const names = git(['tag', '--list']).split('\n').filter(Boolean)
      const tags = names.map((name) => ({ name, sha: git([`rev-parse`, `${name}^{}`]) }))
      const aligned = chooseAlignedRelease(
        tags,
        pin,
        (tag) => git(['merge-base', tag.name, 'refs/remotes/upstream/main'], { allowStatus: [1] }),
        (ancestor, descendant) =>
          git(['merge-base', '--is-ancestor', ancestor, descendant], { allowStatus: [1] }) !== null
      )
      assert.equal(aligned.version, '1.4.4')
      assert.equal(aligned.tag, 'v1.4.4')
      assert.equal(aligned.mainline, b)

      run(dir, ['checkout', '-q', 'main'])
      execFileSync('git', ['clone', '--depth', '1', `file://${dir}`, shallow], {
        env: gitEnv(shallow)
      })
      assert.throws(() => assertFullHistory(createGit(shallow)), /shallow clone/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
      rmSync(shallow, { recursive: true, force: true })
    }
  })

  it('writes a higher base, and refuses a downgrade or a stale pin without editing package.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-ver-pkg-'))
    const pin = 'a'.repeat(40)
    const packagePath = join(dir, 'package.json')
    const source = '{\n  "name": "orca",\n  "version": "1.4.1",\n  "description": "keep"\n}\n'
    writeFileSync(packagePath, source)
    const options = {
      git(args) {
        if (args[0] === 'rev-parse' && args[1] === '--is-shallow-repository') {
          return 'false'
        }
        throw new Error(`unexpected git ${args.join(' ')}`)
      },
      fetchMain() {},
      pin,
      readPin: () => pin,
      remote: 'https://example.invalid/orca.git',
      tags: [
        { name: 'v1.4.10', sha: 'b'.repeat(40) },
        { name: 'v1.4.9', sha: 'c'.repeat(40) }
      ],
      mainlineOf: () => 'e'.repeat(40),
      isAncestor: () => true
    }
    try {
      const updated = applyBaseVersion(dir, 'write', options)
      assert.equal(updated.version, '1.4.10')
      assert.equal(updated.plan, 'update')
      assert.equal(
        readFileSync(packagePath, 'utf8'),
        '{\n  "name": "orca",\n  "version": "1.4.10",\n  "description": "keep"\n}\n'
      )
      assert.equal(applyBaseVersion(dir, 'check', options).plan, 'unchanged')

      writeFileSync(
        packagePath,
        '{\n  "name": "orca",\n  "version": "1.4.12",\n  "description": "keep"\n}\n'
      )
      assert.throws(
        () => applyBaseVersion(dir, 'write', options),
        /backwards from 1.4.12 to 1.4.10/
      )
      assert.equal(JSON.parse(readFileSync(packagePath, 'utf8')).version, '1.4.12')

      writeFileSync(packagePath, source)
      assert.throws(() => applyBaseVersion(dir, 'check', options), /not the upstream release/)
      assert.equal(readFileSync(packagePath, 'utf8'), source)
      assert.throws(
        () => applyBaseVersion(dir, 'check', { ...options, readPin: () => 'b'.repeat(40) }),
        /skills pin/
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
