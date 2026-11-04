// Fork AI Vault history: with this Mac and a managed SSH host, the history panel shows one collapsible
// row per host, and the managed host's row carries the name the SSH host was saved under (not its
// environment id). The host scans a synthetic Claude transcript written into its own home directory.
// Needs ORCA_E2E_SSH_DOCKER=1 and ORCA_E2E_ORCAD_CONVERT_TEMPLATE (a template built for the Docker host).
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import {
  launchManagedWorkspace,
  skipUnlessManagedDockerHost,
  withManagedHost
} from './helpers/orcad-managed-workspace'
import { quotePosixShell } from '../../src/shared/shell/launch/shell-argument-quoting'
import { forkShot, switchUiToEnglish } from './fork-managed-host-links'

skipUnlessManagedDockerHost()
test.skip(process.platform === 'win32', 'The Docker SSH host uses POSIX tooling')

function claudeTranscript(sessionId: string, cwd: string, prompt: string): string {
  const now = new Date().toISOString()
  return `${[
    {
      type: 'user',
      sessionId,
      cwd,
      timestamp: now,
      message: { role: 'user', content: prompt }
    },
    {
      type: 'assistant',
      sessionId,
      timestamp: now,
      message: { role: 'assistant', content: 'Synthetic reply.' }
    }
  ]
    .map((record) => JSON.stringify(record))
    .join('\n')}\n`
}

test('the history panel names the managed host row by its saved SSH name', async (// oxlint-disable-next-line no-empty-pattern -- Owns its app launch through a restart session.
{}, testInfo) => {
  // Why: the first connect deploys orcad into an emulated x86_64 container, which takes minutes.
  test.setTimeout(10 * 60_000)
  const stamp = String(Date.now())
  const serverPrompt = `Server history ${stamp}`
  const localPrompt = `Local history ${stamp}`
  await withManagedHost(testInfo, async (fixture) => {
    const exec = fixture.host.exec!
    exec(
      `mkdir -p /root/wt/lib && git clone --quiet ${quotePosixShell(fixture.host.remoteRepoPath)} /root/wt/app`
    )
    const serverSession = '11111111-2222-4333-8444-555555555555'
    exec(
      `mkdir -p /root/.claude/projects/-root-wt-app && printf '%s' ${quotePosixShell(
        claudeTranscript(serverSession, '/root/wt/app', serverPrompt)
      )} > /root/.claude/projects/-root-wt-app/${serverSession}.jsonl`
    )
    const { app, page, environmentId } = await launchManagedWorkspace(fixture, {
      repoPath: '/root/wt/app',
      folderPath: '/root/wt/lib',
      beforeSeed: switchUiToEnglish
    })
    const home = await app.evaluate(({ app }) => app.getPath('home'))
    const localSession = '66666666-7777-4888-9999-aaaaaaaaaaaa'
    const localProjects = path.join(home, '.claude', 'projects', '-local-history')
    mkdirSync(localProjects, { recursive: true })
    writeFileSync(
      path.join(localProjects, `${localSession}.jsonl`),
      claudeTranscript(localSession, home, localPrompt)
    )
    const savedName = fixture.host.input.label!
    // Both hosts must list their transcript before the panel can show a row per host.
    await expect
      .poll(
        async () => {
          const listed = await page.evaluate(() =>
            window.api.aiVault.listSessions({ executionHostScope: 'all', unlimited: true })
          )
          return JSON.stringify(listed)
        },
        { timeout: 120_000, message: 'the managed host never listed its transcript' }
      )
      .toContain(serverSession)

    await page.evaluate(() => {
      const state = window.__store!.getState()
      state.setRightSidebarOpen(true)
      state.setRightSidebarTab('vault')
      state.setRightSidebarWidth(420)
    })
    // Every workspace's sessions, so both hosts have history in the list.
    await page.getByRole('radio', { name: 'All', exact: true }).click()
    await page.getByRole('button', { name: 'Refresh Session History', exact: true }).click()
    // History group rows are the panel's only <button aria-expanded> elements that carry text.
    const groupRows = page.locator('button[aria-expanded]')
    const hostRow = groupRows.filter({ hasText: savedName })
    await expect(hostRow).toHaveCount(1, { timeout: 60_000 })
    await expect(hostRow).toContainText('1')
    await expect(groupRows.filter({ hasText: environmentId })).toHaveCount(0)
    // This Mac's row, named like the sidebar's local host header ("Local Mac" on macOS).
    await expect(groupRows.filter({ hasText: /^Local (Mac|Linux)\s*1$/ })).toHaveCount(1)
    if ((await hostRow.getAttribute('aria-expanded')) === 'false') {
      await hostRow.click()
    }
    // The transcript's folder is a known workspace, so its group carries that project's name.
    const directory = groupRows.filter({ hasText: 'orcad upgrade E2E' })
    await expect(directory).toBeVisible()
    if ((await directory.getAttribute('aria-expanded')) === 'false') {
      await directory.click()
    }
    await expect(page.getByText(serverPrompt, { exact: true })).toBeVisible({ timeout: 30_000 })
    await forkShot(page, testInfo, 'ai-vault-managed-host-row')
  })
})
