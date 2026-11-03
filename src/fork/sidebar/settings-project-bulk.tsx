// Settings project list: hover checkbox, select all, then confirm Remove N.
import React, { useSyncExternalStore } from 'react'
import { forkTranslate } from '../i18n/fork-translate'
import { Button } from '../../renderer/src/components/ui/button'
import { Checkbox } from '../../renderer/src/components/ui/checkbox'
import {
  buildSettingsProjectList,
  removeSettingsProjectFromAllHosts
} from '../../renderer/src/components/settings/navigation/settings-project-list'
import { useAppStore } from '../../renderer/src/store'
import { registerSettingsProjectBulk } from '../../shared/fork-hooks/sidebar-chrome'

type BulkState = { selected: ReadonlySet<string>; armed: boolean }

let state: BulkState = { selected: new Set(), armed: false }
const listeners = new Set<() => void>()

function emit(): void {
  state = { selected: new Set(state.selected), armed: state.armed }
  for (const listener of listeners) {
    listener()
  }
}

export function settingsBulkSnapshot(): BulkState {
  return state
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function toggleSettingsProject(sectionId: string): void {
  const selected = new Set(state.selected)
  if (selected.has(sectionId)) {
    selected.delete(sectionId)
  } else {
    selected.add(sectionId)
  }
  state = { selected, armed: false }
  emit()
}

export function toggleAllSettingsProjects(sectionIds: readonly string[]): void {
  const every = sectionIds.length > 0 && sectionIds.every((id) => state.selected.has(id))
  state = { selected: every ? new Set() : new Set(sectionIds), armed: false }
  emit()
}

export async function confirmSettingsProjectRemoval(sectionIds: readonly string[]): Promise<void> {
  if (!state.armed) {
    state = { ...state, armed: state.selected.size > 0 }
    emit()
    return
  }
  const selected = state.selected
  state = { selected: new Set(), armed: false }
  emit()
  const store = useAppStore.getState()
  const projects = buildSettingsProjectList(store.repos)
  for (const sectionId of sectionIds) {
    if (!selected.has(sectionId)) {
      continue
    }
    const project = projects.find((entry) => `repo-${entry.representativeRepoId}` === sectionId)
    if (!project) {
      continue
    }
    await removeSettingsProjectFromAllHosts(project.setups, store.removeProject)
  }
}

function useBulk(): BulkState {
  return useSyncExternalStore(subscribe, settingsBulkSnapshot, settingsBulkSnapshot)
}

function BulkHeader(): React.JSX.Element | null {
  const bulk = useBulk()
  const repos = useAppStore((store) => store.repos)
  const sectionIds = buildSettingsProjectList(repos).map(
    (project) => `repo-${project.representativeRepoId}`
  )
  if (sectionIds.length === 0) {
    return null
  }
  const all = sectionIds.every((id) => bulk.selected.has(id))
  const count = bulk.selected.size
  return (
    <div className="flex items-center gap-2 px-3">
      <Checkbox
        checked={all}
        onCheckedChange={() => toggleAllSettingsProjects(sectionIds)}
        aria-label={forkTranslate('fork.settings.selectAllProjects', 'Select all projects')}
      />
      {count > 0 ? (
        <Button
          type="button"
          variant={bulk.armed ? 'destructive' : 'outline'}
          size="sm"
          onClick={() => {
            void confirmSettingsProjectRemoval(sectionIds)
          }}
        >
          {bulk.armed
            ? forkTranslate('fork.settings.confirmRemove', 'Confirm')
            : forkTranslate('fork.settings.removeProjects', 'Remove {{value0}}', { value0: count })}
        </Button>
      ) : null}
    </div>
  )
}

function RowPrefix({ sectionId }: { sectionId: string }): React.JSX.Element {
  const bulk = useBulk()
  const checked = bulk.selected.has(sectionId)
  return (
    <Checkbox
      checked={checked}
      onCheckedChange={() => toggleSettingsProject(sectionId)}
      onClick={(event) => event.stopPropagation()}
      aria-label={forkTranslate('fork.settings.selectProject', 'Select project')}
      className={checked ? 'opacity-100' : 'opacity-0 group-hover/settings-project:opacity-100'}
    />
  )
}

export function registerSettingsProjectBulkSlot(): void {
  registerSettingsProjectBulk({
    active: true,
    header: () => <BulkHeader />,
    rowPrefix: (sectionId) => <RowPrefix sectionId={sectionId} />
  })
}
