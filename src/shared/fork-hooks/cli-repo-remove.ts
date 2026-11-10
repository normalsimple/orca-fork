// fork: `orca repo rm`（F055）。打包的 CLI 只带 out/cli 和 out/shared，所以命令写在这里而不是 src/fork；
// 上游的 repo spec、handler、handler 清单和总帮助各展开一次。这里不引用 src/cli，CLI 的依赖由调用方传入。
import type { RuntimeRpcSuccess } from '../runtime-rpc-envelope'

type CliFlags = Map<string, string | boolean>

/** 上游 `CommandSpec` 里本命令用到的字段。 */
type RepoRmSpec = {
  path: string[]
  destructive: boolean
  summary: string
  usage: string
  allowedFlags: string[]
  notes: string[]
  examples: string[]
}

type RepoRmContext = {
  flags: CliFlags
  client: { call(method: string, params?: unknown): Promise<RuntimeRpcSuccess<unknown>> }
  json: boolean
}

type PrintResult = <T>(
  response: RuntimeRpcSuccess<T>,
  json: boolean,
  formatter: (value: T) => string
) => void

const SUMMARY = 'Remove a repo from Orca without deleting its files'
const USAGE = 'orca repo rm --repo <selector> [--json]'

export const FORK_REPO_HANDLER_KEYS: readonly string[] = ['repo rm']
export const FORK_REPO_HELP_SUMMARY = `  ${'repo rm'.padEnd(26)}${SUMMARY}`
export const FORK_REPO_HELP_USAGE = `  ${USAGE}`

export function forkRepoCommandSpecs(globalFlags: readonly string[]): RepoRmSpec[] {
  return [
    {
      path: ['repo', 'rm'],
      destructive: true,
      summary: SUMMARY,
      usage: USAGE,
      allowedFlags: [...globalFlags, 'repo'],
      // 只注销：repo.rm 走设置页同一条移除路径（RuntimeRepositorySettingsController.remove），不删磁盘上的任何东西。
      notes: [
        'Only unregisters the repo on this Orca host. The folder, its Git worktrees and its branches stay on disk.',
        "Orca also stops the repo's terminals and closes its agent chats on this host, and forgets the names, comments and links of its workspaces."
      ],
      examples: ['orca repo rm --repo path:/abs/path/to/repo --json']
    }
  ]
}

export function forkRepoHandlers(
  requiredFlag: (flags: CliFlags, name: string) => string,
  print: PrintResult
): Record<string, (ctx: RepoRmContext) => Promise<void>> {
  return {
    'repo rm': async ({ flags, client, json }) => {
      const repo = requiredFlag(flags, 'repo')
      // repo.rm 成功时返回 { removed: true }，输出只用选择器。
      const result = await client.call('repo.rm', { repo })
      print(result, json, () => `Removed ${repo} from Orca.`)
    }
  }
}
