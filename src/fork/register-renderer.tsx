import { i18n } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { registerPostImportHook } from '../shared/fork-hooks/post-import'
import { registerHiddenWorktreeSearch } from '../shared/fork-hooks/sidebar-chrome'
import {
  registerTerminalPaneShownHook,
  registerTerminalReconnectFitHook
} from '../shared/fork-hooks/terminal-lifecycle'
import {
  registerDurableWorkspaceArchive,
  registerDurableWorkspaceArchiveRelease,
  registerImportedWorktreeReactivate,
  registerRemovedWorkspaceArchiveRelease
} from '../shared/fork-hooks/workspace-durable-archive'
import { registerForkRendererModules as registerAiVaultRendererModules } from './ai-vault/register-renderer'
import { enableWorkspacePortForward } from './ports/workspace-port-forward-flag'
import { registerArchivedWorkspaceSlot } from './sidebar/archived-workspaces'
import {
  releaseDurableArchiveForWorkspace,
  stampWorkspaceArchive
} from './sidebar/durable-workspace-archive'
import {
  reactivateImportedWorktrees,
  releaseRemovedWorkspaceArchive
} from './sidebar/workspace-archive-release'
import { installHostDirectoryRowPlan } from './sidebar/install-row-plan'
import { registerHostDirectorySortReader } from './sidebar/section-keys'
import { registerSettingsProjectBulkSlot } from './sidebar/settings-project-bulk'
import { registerSidebarMenuSlots } from './sidebar/sidebar-menu-slots'
import { registerDirectoryPrefix } from './sidebar/directory-prefix'
import { registerDeleteProjectGroupOptionCheckbox } from './sidebar/project-group-delete-option'
import { registerWorkspaceChoice } from './sidebar/workspace-choice'
import { registerWorkspaceGroupDropHandler } from './sidebar/workspace-group-drop'
import { registerWorkspaceMenuGroups } from './sidebar/menu-groups'
import { registerForkModeLabels } from './sidebar/mode-labels'
import { registerForkWorkspaceFolderDelete } from './sidebar/workspace-folder-delete'
import {
  consumeDeferredSshReconnectTui,
  pulseSshReconnectTui
} from './terminal/reconnect-tui-pulse'
import { registerComposerSeed } from './sidebar/register-composer-seed'
import { installForkLocaleOverlays } from './i18n/locale-overlay'
import {
  installCoveredTerminalCanvasStyle,
  registerCoveredTerminalGroupRules
} from './terminal/covered-terminal-canvas'
import { registerNestedCopyDemotion } from './terminal/file-link-nested-demotion'
import { registerHostFileDocPreviews } from './terminal/host-file-doc-preview'
import { registerLargeHostFileReads } from './terminal/large-host-file-read'
import { registerHostCsvPreviews } from './terminal/host-file-csv-preview'
import { registerKeptHostFileViewHooks } from './terminal/kept-host-file-view'
import { registerForkModules } from './register'

/** Renderer hooks. Kept out of the node program so it can read the app store. */
export function registerForkRendererModules(): void {
  installForkLocaleOverlays(i18n)
  installHostDirectoryRowPlan()
  registerHostDirectorySortReader(() => useAppStore.getState().sortBy)
  registerSidebarMenuSlots()
  registerDirectoryPrefix()
  registerDeleteProjectGroupOptionCheckbox()
  registerArchivedWorkspaceSlot()
  registerWorkspaceChoice()
  registerSettingsProjectBulkSlot()
  registerWorkspaceGroupDropHandler()
  registerWorkspaceMenuGroups()
  registerForkModeLabels()
  registerForkWorkspaceFolderDelete()
  registerDurableWorkspaceArchive(stampWorkspaceArchive)
  registerDurableWorkspaceArchiveRelease(releaseDurableArchiveForWorkspace)
  registerRemovedWorkspaceArchiveRelease(releaseRemovedWorkspaceArchive)
  registerImportedWorktreeReactivate(reactivateImportedWorktrees)
  registerHiddenWorktreeSearch({
    minimum: 1,
    matches: (worktree, query) => (worktree.branch ?? '').toLocaleLowerCase().includes(query)
  })
  const resizePty = (ptyId: string, cols: number, rows: number): void => {
    window.api.pty.resize(ptyId, cols, rows)
  }
  registerTerminalReconnectFitHook((info) => {
    pulseSshReconnectTui(info, resizePty)
  })
  registerTerminalPaneShownHook((info) => {
    consumeDeferredSshReconnectTui(info, resizePty)
  })
  installCoveredTerminalCanvasStyle()
  registerCoveredTerminalGroupRules()
  registerNestedCopyDemotion()
  registerComposerSeed()
  registerHostFileDocPreviews()
  registerLargeHostFileReads()
  registerHostCsvPreviews()
  registerKeptHostFileViewHooks()
  registerPostImportHook((details) =>
    import('./import/apply-post-import').then((module) => module.applyForkPostImport(details))
  )
  enableWorkspacePortForward()
  registerAiVaultRendererModules()
}

/** Renderer entry (src/renderer/src/main.tsx): grouping modes first, then the render slots. */
export function registerForkRenderer(): void {
  registerForkModules()
  registerForkRendererModules()
}
