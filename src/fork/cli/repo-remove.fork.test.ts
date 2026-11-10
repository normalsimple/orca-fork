// F055 `orca repo rm`：命令本身，以及上游 CLI 的 spec、handler 清单和总帮助里的展开行。
import { describe, expect, it, vi } from 'vitest'
import type { RuntimeRpcSuccess } from '../../shared/runtime-rpc-envelope'
import {
  FORK_REPO_HELP_SUMMARY,
  FORK_REPO_HELP_USAGE,
  forkRepoCommandSpecs,
  forkRepoHandlers
} from '../../shared/fork-hooks/cli-repo-remove'

type CliSpec = ReturnType<typeof forkRepoCommandSpecs>[number]
type RepoRmHandler = ReturnType<typeof forkRepoHandlers>[string]
type CliModules = {
  args: {
    GLOBAL_FLAGS: readonly string[]
    parseArgs: (argv: string[], paths: string[][], specs: CliSpec[]) => unknown
    specPaths: (spec: CliSpec) => string[][]
    validateCommandAndFlags: (specs: CliSpec[], parsed: unknown) => void
  }
  specs: { COMMAND_SPECS: CliSpec[] }
  manifest: {
    HANDLER_GROUPS: readonly {
      name: string
      keys: readonly string[]
      load: () => Promise<Record<string, RepoRmHandler>>
    }[]
  }
  help: { formatCommandHelp: (spec: CliSpec) => string }
  primary: { ROOT_HELP_TEXT_PRIMARY: string }
  secondary: { ROOT_HELP_TEXT_SECONDARY: string }
  agentContext: {
    buildAgentContext: (specs: CliSpec[]) => { commands: { command: string; flags: string[] }[] }
  }
  flags: { getRequiredStringFlag: (flags: Map<string, string | boolean>, name: string) => string }
}

// CLI 不在 fork 测试的 TypeScript 工程里（node 工程只收 src/cli/runtime 的几个文件）。
// 路径在运行时拼出来，tsc 不跟进去，vitest 照常转译。
async function loadCli(): Promise<CliModules> {
  const load = (path: string): Promise<unknown> => import(/* @vite-ignore */ `../../cli/${path}`)
  const [args, specs, manifest, help, primary, secondary, agentContext, flags] = await Promise.all(
    [
      'args.ts',
      'specs/index.ts',
      'handler-group-manifest.ts',
      'help.ts',
      'root-help-text-primary.ts',
      'root-help-text-secondary.ts',
      'agent-context.ts',
      'flags.ts'
    ].map(load)
  )
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: 这些是上面路径的真实模块，CliModules 只列出本测试读到的导出；读错名字时下面的断言会失败。
  return { args, specs, manifest, help, primary, secondary, agentContext, flags } as CliModules
}

// 返回值类型交给推断：vi.fn 的通用 Mock 类型对不上 handler 要的 call 签名。
function fakeClient() {
  return {
    call: vi.fn(async (): Promise<RuntimeRpcSuccess<{ removed: true }>> => ({
      id: 'rpc-1',
      ok: true,
      result: { removed: true },
      _meta: { runtimeId: 'runtime-1' }
    }))
  }
}

describe('orca repo rm', () => {
  it('unregisters the selected repo through repo.rm and prints a line', async () => {
    const { flags } = await loadCli()
    const print = vi.fn()
    const client = fakeClient()
    const handler = forkRepoHandlers(flags.getRequiredStringFlag, print)['repo rm']
    await handler({
      flags: new Map([['repo', 'path:/srv/wt/project']]),
      client,
      json: false
    })
    expect(client.call).toHaveBeenCalledWith('repo.rm', { repo: 'path:/srv/wt/project' })
    const [response, json, formatter] = print.mock.calls[0]
    expect(response.result).toEqual({ removed: true })
    expect(json).toBe(false)
    expect(formatter(response.result)).toBe('Removed path:/srv/wt/project from Orca.')
  })

  it('refuses a missing --repo before calling the runtime', async () => {
    const { flags } = await loadCli()
    const client = fakeClient()
    const handler = forkRepoHandlers(flags.getRequiredStringFlag, vi.fn())['repo rm']
    await expect(handler({ flags: new Map(), client, json: true })).rejects.toThrow(
      'Missing required --repo'
    )
    expect(client.call).not.toHaveBeenCalled()
  })

  it('says in its help that only the registration goes away', async () => {
    const { help, specs } = await loadCli()
    const spec = specs.COMMAND_SPECS.find((entry) => entry.path.join(' ') === 'repo rm')
    expect(spec).toBeDefined()
    const text = help.formatCommandHelp(spec!)
    expect(text).toContain('Usage: orca repo rm --repo <selector> [--json]')
    expect(text).toContain('stay on disk')
    expect(spec!.destructive).toBe(true)
  })

  it('is wired into the CLI registry, handler manifest, root help and agent-context', async () => {
    const { args, specs, manifest, primary, secondary, agentContext } = await loadCli()
    expect(specs.COMMAND_SPECS).toContainEqual(forkRepoCommandSpecs(args.GLOBAL_FLAGS)[0])

    const repoGroup = manifest.HANDLER_GROUPS.find((group) => group.name === 'repo')
    expect(repoGroup?.keys).toContain('repo rm')
    expect(Object.keys(await repoGroup!.load())).toContain('repo rm')

    const primaryLines = primary.ROOT_HELP_TEXT_PRIMARY.split('\n')
    expect(primaryLines).toContain(FORK_REPO_HELP_SUMMARY)
    expect(secondary.ROOT_HELP_TEXT_SECONDARY.split('\n')).toContain(FORK_REPO_HELP_USAGE)
    const showLine = primaryLines.find((line) => line.startsWith('  repo show '))
    expect(FORK_REPO_HELP_SUMMARY.indexOf('Remove')).toBe(showLine?.indexOf('Show'))

    const command = agentContext
      .buildAgentContext(specs.COMMAND_SPECS)
      .commands.find((entry) => entry.command === 'repo rm')
    expect(command?.flags).toEqual(expect.arrayContaining(['repo', 'json']))

    const parsed = args.parseArgs(
      ['repo', 'rm', '--repo', 'id:repo-1', '--json'],
      specs.COMMAND_SPECS.flatMap(args.specPaths),
      specs.COMMAND_SPECS
    )
    expect(() => args.validateCommandAndFlags(specs.COMMAND_SPECS, parsed)).not.toThrow()
  })
})
