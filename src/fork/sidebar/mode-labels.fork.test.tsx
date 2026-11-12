import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { i18n } from '@/i18n/i18n'
import { lookupSidebarGroupMode } from '../../shared/fork-hooks/sidebar-group-mode'
import { getDeleteProjectGroupDialogOption } from '../../shared/fork-hooks/project-group-delete'
import { installForkLocaleOverlays } from '../i18n/locale-overlay'
import { registerHostDirectoryMode } from './register-mode'
import { registerForkModeLabels } from './mode-labels'
import { HOST_DIRECTORY_GROUP_BY } from './section-keys'

describe('fork mode labels', () => {
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
  })

  it('keeps the original English in English', () => {
    const option = getDeleteProjectGroupDialogOption()
    expect(option?.label).toBe('Ungroup only')
    expect(option?.description).toBe('Remove the group and leave its workspaces in place.')
    expect(lookupSidebarGroupMode(HOST_DIRECTORY_GROUP_BY)?.label).toBe('Host')
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
})
