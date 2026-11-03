// fork: main-process registrations. Imported from the desktop and from orcad, before scans.

import { registerAiVaultServiceHeap } from '../../shared/fork-hooks/ai-vault'
import { registerDeferBrowserSessionProxy } from '../../shared/fork-hooks/startup'
import { aiVaultServiceHeapMiB } from './ai-vault/heap'
import { installAiVaultForkServicePolicy } from './ai-vault/service-policy'
import { getGitRepoRoot } from '../../main/git/repo-detection'
import { registerImportedWorktreePath } from '../../shared/fork-hooks/imported-worktree-path'
import { registerForkBuild } from '../../shared/fork-hooks/update-feed'
import { registerKeepFolderWorkspacesOnGroupDeleteInMain } from '../../shared/fork-hooks/project-group-delete'
import { registerReusedPathUnarchive } from '../../shared/fork-hooks/reused-path-unarchive'
import { registerAntigravityAcpLinuxArgs } from '../../shared/fork-hooks/antigravity-acp-args'
import { antigravityAcpIpv6BypassArgs } from './antigravity-acp-ipv6'
import { keepFolderWorkspacesOnGroupDelete } from './project-group-delete'
import { registerEgoLiteCookieBrowser } from '../ego-lite-cookie-browser'
import { registerEgoLiteCookieDetection } from './ego-lite-cookie-detection'

/** Desktop and orcad. The renderer must not import this file. */
export function registerForkMainModules(): void {
  // orcad 不走 registerForkModules，这里也登记，免得它去拉上游的 agent 状态规则。
  registerForkBuild()
  // orcad 不走 registerForkModules。远端导入在这台机器上发现浏览器，所以这里也登记。
  registerEgoLiteCookieBrowser()
  registerEgoLiteCookieDetection()
  installAiVaultForkServicePolicy()
  registerAiVaultServiceHeap(() => aiVaultServiceHeapMiB())
  registerDeferBrowserSessionProxy(true)
  registerImportedWorktreePath(getGitRepoRoot)
  registerKeepFolderWorkspacesOnGroupDeleteInMain(keepFolderWorkspacesOnGroupDelete)
  registerReusedPathUnarchive()
  // F052：没有 IPv6 的 Linux 内核不让 1.4.1 的 agy 在初始化时创建 AF_INET6。
  registerAntigravityAcpLinuxArgs(antigravityAcpIpv6BypassArgs())
}

/** orcad only, before upstream installs its host adapters. */
export function installForkOrcadHost(): void {
  registerForkMainModules()
}
