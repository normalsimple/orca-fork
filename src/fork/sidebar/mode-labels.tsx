// Translations for fork labels registered from node-safe code (register-mode.ts). register-mode.ts
// keeps the English: it runs where no translator exists. Here, in the renderer, the same
// registrations get getters, so the label follows the current language each time it is rendered.
import { useSyncExternalStore } from 'react'
import { i18n } from '../../renderer/src/i18n/i18n'
import { forkTranslate } from '../i18n/fork-translate'
import type { WorktreeGroupBy } from '../../shared/sidebar-list/row-types'
import {
  getSidebarGroupModeLabelsVersion,
  listSidebarGroupModes,
  lookupSidebarGroupMode,
  notifySidebarGroupModeLabelsChanged,
  registerSidebarGroupMode,
  registeredReplacementForBuiltinGroupBy,
  subscribeSidebarGroupModeLabels
} from '../../shared/fork-hooks/sidebar-group-mode'
import {
  getDeleteProjectGroupDialogOption,
  registerDeleteProjectGroupDialogOption
} from '../../shared/fork-hooks/project-group-delete'
import { HOST_DIRECTORY_GROUP_BY, UNGROUP_ONLY_OPTION_ID } from './section-keys'

// The group-by menu reads the getter only when it renders; this makes a language switch render it.
function onLanguageChanged(): void {
  notifySidebarGroupModeLabelsChanged()
}

export function registerForkModeLabels(): void {
  // Same function every time, so registering again never adds a second listener.
  i18n.off('languageChanged', onLanguageChanged)
  i18n.on('languageChanged', onLanguageChanged)
  const mode = lookupSidebarGroupMode(HOST_DIRECTORY_GROUP_BY)
  if (mode) {
    registerSidebarGroupMode({
      ...mode,
      get label() {
        return forkTranslate('fork.sidebar.hostMode', 'Host')
      },
      get description() {
        return forkTranslate(
          'fork.sidebar.hostModeDescription',
          'Group workspaces by execution host, then by directory.'
        )
      }
    })
  }
  const option = getDeleteProjectGroupDialogOption()
  if (option?.id === UNGROUP_ONLY_OPTION_ID) {
    registerDeleteProjectGroupDialogOption({
      ...option,
      get label() {
        return forkTranslate('fork.sidebar.ungroupOnly', 'Ungroup only')
      },
      get description() {
        return forkTranslate(
          'fork.sidebar.ungroupOnlyDescription',
          'Remove the group and leave its workspaces in place.'
        )
      }
    })
  }
}

/** Changes when a registered mode label changes language; constant while unregistered. */
export function useSidebarGroupModeLabelsVersion(): number {
  // The third argument is for react-dom/server, which the sidebar tests render with.
  return useSyncExternalStore(
    subscribeSidebarGroupModeLabels,
    getSidebarGroupModeLabelsVersion,
    getSidebarGroupModeLabelsVersion
  )
}

/**
 * The group-by menu's options: built-ins a registered mode replaces give way to the registered
 * modes. Re-renders when a registered label changes language. Unregistered: the built-ins as given.
 */
export function useSidebarGroupByOptions(
  builtins: readonly { id: WorktreeGroupBy; label: string }[]
): { id: WorktreeGroupBy; label: string }[] {
  useSidebarGroupModeLabelsVersion()
  const modes = listSidebarGroupModes()
  if (modes.length === 0) {
    return [...builtins]
  }
  return [
    ...builtins.filter((option) => !registeredReplacementForBuiltinGroupBy(option.id)),
    ...modes.map((mode) => ({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a registered mode id is a persisted groupBy (normalizeGroupBy keeps it); the closed union cannot list it.
      id: mode.id as WorktreeGroupBy,
      label: mode.label
    }))
  ]
}
