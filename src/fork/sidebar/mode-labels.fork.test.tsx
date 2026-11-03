import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { i18n } from '@/i18n/i18n'
import { lookupSidebarGroupMode } from '../../shared/fork-hooks/sidebar-group-mode'
import { getDeleteProjectGroupDialogOption } from '../../shared/fork-hooks/project-group-delete'
import {
  registerSshTargetRemoveLabels,
  sshTargetRemoveLabels
} from '../../shared/fork-hooks/ssh-target-remove-labels'
import { installForkLocaleOverlays } from '../i18n/locale-overlay'
import { registerHostDirectoryMode } from './register-mode'
import { registerForkModeLabels } from './mode-labels'
import { HOST_DIRECTORY_GROUP_BY } from './section-keys'

const UPSTREAM_SSH = { actionLabel: 'Remove', busyLabel: 'Removing' }

describe('fork mode labels and the SSH remove dialog', () => {
  beforeAll(() => {
    installForkLocaleOverlays(i18n)
    registerHostDirectoryMode()
    registerForkModeLabels()
  })
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('shows the ungroup-only option and the host mode in Chinese', async () => {
    await i18n.changeLanguage('zh')
    const option = getDeleteProjectGroupDialogOption()
    expect(option?.label).toBe('仅取消分组')
    expect(option?.description).toBe('删除分组，工作区留在原处。')
    expect(lookupSidebarGroupMode(HOST_DIRECTORY_GROUP_BY)?.label).toBe('主机')
    expect(sshTargetRemoveLabels(UPSTREAM_SSH)).toEqual({
      actionLabel: '删除',
      busyLabel: '正在删除'
    })
  })

  it('keeps the original English in English', () => {
    const option = getDeleteProjectGroupDialogOption()
    expect(option?.label).toBe('Ungroup only')
    expect(option?.description).toBe('Remove the group and leave its workspaces in place.')
    expect(lookupSidebarGroupMode(HOST_DIRECTORY_GROUP_BY)?.label).toBe('Host')
    expect(sshTargetRemoveLabels(UPSTREAM_SSH)).toEqual(UPSTREAM_SSH)
  })

  it('follows a language change without registering again', async () => {
    const option = getDeleteProjectGroupDialogOption()
    await i18n.changeLanguage('zh')
    expect(option?.label).toBe('仅取消分组')
  })

  it('keeps the option behaviour and default', () => {
    const option = getDeleteProjectGroupDialogOption()
    expect(option?.defaultChecked).toBe(true)
    expect(option?.adjustRemoveContainedProjects?.(true, true)).toBe(false)
  })

  it("returns upstream's English when nothing is registered", () => {
    registerSshTargetRemoveLabels(undefined)
    try {
      expect(sshTargetRemoveLabels(UPSTREAM_SSH)).toBe(UPSTREAM_SSH)
    } finally {
      registerForkModeLabels()
    }
  })

  it("matches upstream's hardcoded dialog labels", () => {
    const source = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/settings/ssh/targets/SshTargetDestructiveActions.tsx'),
      'utf8'
    )
    expect(source).toContain(
      "sshTargetRemoveLabels({ actionLabel: 'Remove', busyLabel: 'Removing' })"
    )
  })
})
