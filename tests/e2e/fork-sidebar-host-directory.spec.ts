// Fork sidebar (host-directory) and F048 with this Mac plus a managed SSH host: each host gets a header
// with its directory groups under it, deleting a workspace keeps its folder by default, and "Remove from
// Orca" on the SSH host's workspace can be restored from the hidden-workspaces dialog.
// Needs ORCA_E2E_SSH_DOCKER=1 and ORCA_E2E_ORCAD_CONVERT_TEMPLATE (a template built for the Docker host).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Locator, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import {
  launchConvertedProfile,
  skipUnlessManagedDockerHost,
  withManagedHost
} from './helpers/orcad-managed-workspace'
import { dismissTransientAnnouncement } from './helpers/ssh-config-host-picker'
import { quotePosixShell } from '../../src/shared/shell/launch/shell-argument-quoting'
import { toRuntimeExecutionHostId, type ExecutionHostId } from '../../src/shared/execution-host'
import { getWorktreeHostIdentity } from '../../src/shared/worktree/host-qualified-identity'
import { forkShot, switchUiToEnglish } from './fork-managed-host-links'

skipUnlessManagedDockerHost()
test.skip(process.platform === 'win32', 'The Docker SSH host uses POSIX tooling')

const LOCAL_GROUP = 'Local projects'
const REMOTE_GROUP = 'orcad upgrade folders'

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args],
    {
      cwd,
      encoding: 'utf8'
    }
  )
}

function groupSection(page: Page, hostId: string, groupId: string): Locator {
  return page.locator(
    `[data-workspace-sidebar-group=${JSON.stringify(`hd:${JSON.stringify([hostId, groupId])}`)}]`
  )
}

function card(page: Page, worktreeId: string, hostId: ExecutionHostId): Locator {
  const identity = getWorktreeHostIdentity({ id: worktreeId, hostId })
  return page.locator(`[data-worktree-host-identity=${JSON.stringify(identity)}]:visible`)
}

/** Vertical order of the first match of each locator, top to bottom. */
async function topOf(locator: Locator): Promise<number> {
  const box = await locator.first().boundingBox()
  if (!box) {
    throw new Error('sidebar row has no layout box')
  }
  return box.y
}

function isArchived(page: Page, worktreeId: string, hostId: string): Promise<boolean | null> {
  return page.evaluate(
    ({ worktreeId, hostId }) => {
      const rows = Object.values(window.__store!.getState().worktreesByRepo).flat()
      const row = rows.find(
        (entry) => entry.id === worktreeId && (entry.hostId ?? 'local') === hostId
      )
      return row ? row.isArchived === true : null
    },
    { worktreeId, hostId }
  )
}

async function openHostHiddenWorkspaces(page: Page, hostId: string): Promise<Locator> {
  const header = page.locator(`[data-host-header-drag-id=${JSON.stringify(hostId)}]`)
  await header.hover()
  await header.locator('[data-host-header-action] button').click()
  await page.getByRole('menuitem', { name: 'Hidden workspaces', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('menu')).toHaveCount(0)
  // Let the dialog's open animation settle so screenshots show it, not the fade.
  await expect.poll(() => dialog.evaluate((element) => getComputedStyle(element).opacity)).toBe('1')
  return dialog
}

test('host headers and directory groups for this Mac and a managed host; delete keeps the folder', async (// oxlint-disable-next-line no-empty-pattern -- Owns its app launch through a restart session.
{}, testInfo) => {
  // Why: the first connect deploys orcad into an emulated x86_64 container, which takes minutes.
  test.setTimeout(10 * 60_000)
  const localRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'orca-fork-sidebar-')))
  const projects = path.join(localRoot, 'projects')
  const localRepo = path.join(projects, 'app')
  mkdirSync(localRepo, { recursive: true })
  git(localRepo, 'init', '-q', '-b', 'main')
  writeFileSync(path.join(localRepo, 'README.md'), '# local app\n')
  git(localRepo, 'add', 'README.md')
  git(localRepo, '-c', 'user.email=e2e@test.local', '-c', 'user.name=e2e', 'commit', '-qm', 'init')
  try {
    await withManagedHost(testInfo, async (fixture) => {
      fixture.host.exec!(
        `mkdir -p /root/wt/lib && git clone --quiet ${quotePosixShell(fixture.host.remoteRepoPath)} /root/wt/app`
      )
      let localGroupId = ''
      // Created through Orca: worktrees added outside it stay hidden until the user shows them.
      let feature = { id: '', path: '' }
      const { page, seeded, environmentId } = await launchConvertedProfile(fixture, {
        repoPath: '/root/wt/app',
        folderPath: '/root/wt/lib',
        beforeSeed: async (page) => {
          await switchUiToEnglish(page)
          const localRepoId = await page.evaluate(async (repoPath) => {
            const added = await window.api.repos.add({ path: repoPath })
            if ('error' in added) {
              throw new Error(added.error)
            }
            return added.repo.id
          }, localRepo)
          await expect
            .poll(() =>
              page.evaluate(
                (id) => window.__store!.getState().repos.some((repo) => repo.id === id),
                localRepoId
              )
            )
            .toBe(true)
          localGroupId = await page.evaluate(
            async ({ repoId, groupName }) => {
              const state = window.__store!.getState()
              const repo = state.repos.find((entry) => entry.id === repoId)
              const group = await state.createProjectGroup(groupName, 'local')
              if (!repo || !group || !(await state.moveProjectToGroup(repo, group.id))) {
                throw new Error(`could not group the local project (group ${group?.id})`)
              }
              return group.id
            },
            { repoId: localRepoId, groupName: LOCAL_GROUP }
          )
          feature = await page.evaluate(async (repoId) => {
            const created = await window
              .__store!.getState()
              .createWorktree(repoId, 'fork-feature', undefined, 'skip')
            return { id: created.worktree.id, path: created.worktree.path }
          }, localRepoId)
        }
      })
      const hostId = toRuntimeExecutionHostId(environmentId)
      await dismissTransientAnnouncement(page)
      await page.evaluate((hostId) => {
        window.__store!.setState({ visibleWorkspaceHostIds: ['local', hostId] })
      }, hostId)

      await test.step('each host has a header with its directory groups under it', async () => {
        expect(await page.evaluate(() => window.__store!.getState().groupBy)).toBe('host-directory')
        const remoteGroupId = await page.evaluate(
          (name) => window.__store!.getState().projectGroups.find((g) => g.name === name)?.id,
          REMOTE_GROUP
        )
        expect(remoteGroupId).toBeTruthy()
        const localHeader = page.locator('[data-host-header-drag-id="local"]')
        const remoteHeader = page.locator(`[data-host-header-drag-id=${JSON.stringify(hostId)}]`)
        await expect(localHeader).toBeVisible({ timeout: 30_000 })
        await expect(remoteHeader).toBeVisible()
        await expect(remoteHeader).toContainText(fixture.host.input.label!)
        const localGroup = groupSection(page, 'local', localGroupId)
        const remoteGroup = groupSection(page, hostId, remoteGroupId!)
        await expect(localGroup.first()).toContainText(LOCAL_GROUP)
        await expect(remoteGroup.first()).toContainText(REMOTE_GROUP)
        await expect(card(page, feature.id, 'local')).toBeVisible()
        await expect(card(page, seeded.worktreeId, hostId)).toBeVisible()
        await expect(page.getByText('orcad upgrade folder', { exact: true })).toBeVisible()
        // This Mac first, each group under its own host.
        const order = [
          await topOf(localHeader),
          await topOf(localGroup),
          await topOf(card(page, feature.id, 'local')),
          await topOf(remoteHeader),
          await topOf(remoteGroup)
        ]
        expect(order).toEqual([...order].sort((a, b) => a - b))
        await forkShot(page, testInfo, 'sidebar-host-directory-two-hosts')
      })

      await test.step('deleting a git workspace keeps its folder by default', async () => {
        const featureCard = card(page, feature.id, 'local')
        await featureCard.click({ button: 'right' })
        await page.getByRole('menuitem', { name: /^Delete/ }).click()
        const dialog = page.getByRole('dialog', { name: 'Delete Workspace' })
        await expect(dialog).toBeVisible()
        const alsoDelete = dialog.getByRole('checkbox', { name: 'Also delete folder' })
        await expect(alsoDelete).not.toBeChecked()
        await expect(dialog).toContainText('The workspace folder on disk will not be deleted.')
        await forkShot(page, testInfo, 'sidebar-delete-dialog-keeps-folder')
        await dialog
          .getByRole('button', { name: /^(Delete|Remove)/ })
          .last()
          .click()
        await expect(dialog).toBeHidden()
        await expect(featureCard).toHaveCount(0)
        await expect.poll(() => isArchived(page, feature.id, 'local')).toBe(true)
        expect(existsSync(path.join(feature.path, 'README.md'))).toBe(true)
        expect(git(localRepo, 'worktree', 'list')).toContain(feature.path)
      })

      await test.step('the removed workspace is restored from Hidden workspaces', async () => {
        const dialog = await openHostHiddenWorkspaces(page, 'local')
        await expect(dialog.getByText('Removed from Orca (1)')).toBeVisible()
        await forkShot(page, testInfo, 'sidebar-removed-from-orca-list')
        await dialog.getByRole('button', { name: 'Restore', exact: true }).click()
        await expect.poll(() => isArchived(page, feature.id, 'local')).toBe(false)
        await page.keyboard.press('Escape')
        await expect(card(page, feature.id, 'local')).toBeVisible()
      })

      await test.step("Remove from Orca on the SSH host's workspace, then restore it", async () => {
        const remoteCard = card(page, seeded.worktreeId, hostId)
        await remoteCard.click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Remove from Orca', exact: true }).click()
        await expect(remoteCard).toHaveCount(0, { timeout: 30_000 })
        await expect.poll(() => isArchived(page, seeded.worktreeId, hostId)).toBe(true)
        expect(fixture.host.exec!('test -d /root/wt/app/.git && echo kept')).toBe('kept')
        const dialog = await openHostHiddenWorkspaces(page, hostId)
        await expect(dialog.getByText('Removed from Orca (1)')).toBeVisible()
        await forkShot(page, testInfo, 'sidebar-ssh-host-removed-from-orca')
        await dialog.getByRole('button', { name: 'Restore', exact: true }).click()
        await expect.poll(() => isArchived(page, seeded.worktreeId, hostId)).toBe(false)
        await page.keyboard.press('Escape')
        await expect(card(page, seeded.worktreeId, hostId)).toBeVisible({ timeout: 30_000 })
        await forkShot(page, testInfo, 'sidebar-ssh-host-restored')
      })
    })
  } finally {
    rmSync(localRoot, { recursive: true, force: true })
  }
})
