import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ANTIGRAVITY_LAUNCH_SPEC, type AcpLaunchSpec } from '../../main/acp/acp-launch-specs'
import { probeAntigravityAcpServer } from '../../main/antigravity/antigravity-acp-runtime-probe'
import {
  antigravityAcpLinuxArgs,
  registerAntigravityAcpLinuxArgs
} from '../../shared/fork-hooks/antigravity-acp-args'
import {
  ANTIGRAVITY_ACP_SKIP_KERNEL_IPV6_ARG,
  antigravityAcpIpv6BypassArgs
} from './antigravity-acp-ipv6'

const launchInput = { fullAccess: false, pluginDir: null }
// satisfies 保留实现的零参推断；按规格类型调用才接受启动输入。
const launchSpec: AcpLaunchSpec = ANTIGRAVITY_LAUNCH_SPEC
const folders: string[] = []

function linuxArgs(registered: boolean): string[] {
  if (process.platform !== 'linux') {
    return []
  }
  return registered ? ['--uid=', ANTIGRAVITY_ACP_SKIP_KERNEL_IPV6_ARG] : ['--uid=']
}

afterEach(async () => {
  vi.unstubAllEnvs()
  registerAntigravityAcpLinuxArgs([])
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})

describe('Antigravity ACP on a Linux host without IPv6', () => {
  it('adds nothing until the fork registers, then only the Linux bypass', () => {
    expect(antigravityAcpLinuxArgs()).toEqual([])
    expect(antigravityAcpIpv6BypassArgs()).toEqual(
      process.platform === 'linux' ? [ANTIGRAVITY_ACP_SKIP_KERNEL_IPV6_ARG] : []
    )
    expect(launchSpec.args(launchInput)).toEqual(linuxArgs(false))

    registerAntigravityAcpLinuxArgs(antigravityAcpIpv6BypassArgs())
    expect(antigravityAcpLinuxArgs()).toEqual(antigravityAcpIpv6BypassArgs())
    expect(launchSpec.args(launchInput)).toEqual(linuxArgs(true))
  })

  it('is registered for the desktop and orcad', () => {
    const register = readFileSync('src/fork/main/register-main.ts', 'utf8')
    expect(register).toMatch(
      /function registerForkMainModules[^}]*registerAntigravityAcpLinuxArgs\(antigravityAcpIpv6BypassArgs\(\)\)/
    )
  })

  // 官方 par 在 CI 里不跑。假服务器只证明 probe 真正 spawn 时的 argv。
  it.skipIf(process.platform === 'win32')(
    'the install probe spawns with the same Linux arguments',
    async () => {
      vi.stubEnv('ELECTRON_RUN_AS_NODE', '1')
      const signal = new AbortController().signal
      const unregistered = await spawnProbe(signal)
      expect(unregistered).toEqual(linuxArgs(false))

      registerAntigravityAcpLinuxArgs(antigravityAcpIpv6BypassArgs())
      const registered = await spawnProbe(signal)
      expect(registered).toEqual(linuxArgs(true))
    }
  )
})

async function spawnProbe(signal: AbortSignal): Promise<unknown> {
  const recording = await readFile(
    new URL('../../main/acp/fixtures/antigravity-v1-question.jsonl', import.meta.url),
    'utf8'
  )
  const initialize = JSON.parse(recording.split('\n')[0]).message.result
  const folder = await mkdtemp(join(tmpdir(), 'orca-antigravity-ipv6-'))
  folders.push(folder)
  const server = join(folder, 'agy_acp_server.par')
  await writeFile(
    server,
    `#!${process.execPath}
const fs = require('node:fs')
const path = require('node:path')
fs.writeFileSync(path.join(path.dirname(process.argv[1]), 'argv.json'), JSON.stringify(process.argv.slice(2)))
const result = ${JSON.stringify(initialize)}
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method } = JSON.parse(line)
  if (method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n')
})
`
  )
  await chmod(server, 0o755)
  await probeAntigravityAcpServer(server, '1.3.0', signal)
  return JSON.parse(await readFile(join(folder, 'argv.json'), 'utf8'))
}
