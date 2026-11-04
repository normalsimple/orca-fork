// Fork F046: links in a managed SSH host's terminal to files outside the clicked workspace open in that
// workspace with the host's bytes (editor, Markdown with images, in-app HTML preview) and never switch away.
// Needs ORCA_E2E_SSH_DOCKER=1 and ORCA_E2E_ORCAD_CONVERT_TEMPLATE (a template built for the Docker host).
import { rmSync, writeFileSync } from 'node:fs'
import { expect, test } from './helpers/orca-app'
import {
  launchManagedWorkspace,
  openTerminalTab,
  skipUnlessManagedDockerHost,
  withManagedHost
} from './helpers/orcad-managed-workspace'
import { quotePosixShell } from '../../src/shared/shell/launch/shell-argument-quoting'
import { createPdfFindFixture } from './helpers/pdf-find-fixture'
import { toRuntimeExecutionHostId } from '../../src/shared/execution-host'
import { folderWorkspaceKey } from '../../src/shared/workspace-scope'
import {
  clickPrintedHostPath,
  expectEditorText,
  forkShot,
  readActiveWorkspace,
  readDesktopOpens,
  readDocPreviewGuest,
  readDocPreviewTabs,
  readOpenedFile,
  recordDesktopOpens,
  switchUiToEnglish
} from './fork-managed-host-links'

skipUnlessManagedDockerHost()
test.skip(process.platform === 'win32', 'The Docker SSH host uses POSIX tooling')

// A 48x48 checkerboard PNG: a loaded image proves the bytes arrived, and it shows in screenshots.
const CHECKERBOARD_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAAUElEQVR42u3XsQ0AIAgEQEZxBEZydEZxBCUx2lzy9XMdEJW5zZi1za2eAAICAgICaoJeDjvpAQICAgIC6oJseyAgICAgf5nzAwgICAjoK2gBvFTQpjZgKqQAAAAASUVORK5CYII='

test('host terminal links to files outside the workspace stay in the clicked workspace', async (// oxlint-disable-next-line no-empty-pattern -- Owns its app launch through a restart session.
{}, testInfo) => {
  // Why: the first connect deploys orcad into an emulated x86_64 container, which takes minutes.
  test.setTimeout(10 * 60_000)
  const stamp = String(Date.now())
  const appPath = '/root/wt/app'
  const libPath = '/root/wt/lib'
  const files = {
    plain: '/root/notes/plain.txt',
    markdown: '/root/notes/doc.md',
    report: '/root/pages/report.html',
    site: '/root/pages/site.html',
    huge: '/root/pages/huge.html',
    // Directly in the host user's home.
    top: '/root/top.html',
    // At workspace A's root, beside its stylesheet (F051).
    appPage: `${appPath}/page.html`,
    // Past one reply: a finished log, and one still being written while it opens.
    log: '/root/logs/train.log',
    liveLog: '/root/logs/live.log',
    // Past any one preview reply (about 3 MB remote, 10 MiB local), and past the 1 MiB CSV paging threshold.
    bigImage: '/root/data/big.png',
    bigPdf: '/root/data/paper.pdf',
    csv: '/root/data/results.csv',
    owned: `${libPath}/src/index.ts`,
    ownedPage: `${libPath}/page.html`,
    // Same path on this Mac and on the host, with different contents.
    same: `/tmp/orca-fork-e2e-same-${stamp}.txt`
  }
  writeFileSync(files.same, `MAC_SAME_${stamp}\n`)
  try {
    await withManagedHost(testInfo, async (fixture) => {
      const exec = fixture.host.exec!
      const write = (filePath: string, contents: string): string =>
        exec(
          `mkdir -p ${quotePosixShell(filePath.slice(0, filePath.lastIndexOf('/')))} && printf '%s' ${quotePosixShell(contents)} > ${quotePosixShell(filePath)}`
        )
      exec(
        `mkdir -p /root/wt && git clone --quiet ${quotePosixShell(fixture.host.remoteRepoPath)} ${appPath}`
      )
      write(files.plain, `SERVER_PLAIN_${stamp}\n`)
      write(files.markdown, `# Server notes ${stamp}\n\n![chart](img/chart.png)\n`)
      exec(
        `mkdir -p /root/notes/img && printf '%s' ${quotePosixShell(CHECKERBOARD_PNG)} | base64 -d > /root/notes/img/chart.png`
      )
      write(
        files.report,
        `<!doctype html><html><head><title>Report</title><style>h1{color:rgb(0, 128, 0)}</style></head>` +
          `<body><h1 id="title">Server report ${stamp}</h1></body></html>\n`
      )
      write(
        files.site,
        `<!doctype html><html><head><title>Site</title><link rel="stylesheet" href="style.css">` +
          `<link rel="stylesheet" href="../shared/theme.css">` +
          `<script src="js/bundle.js"></script><script src="/assets/app.js"></script></head>` +
          `<body><h1 id="title">Server site ${stamp}</h1></body></html>\n`
      )
      write('/root/pages/style.css', 'h1 { color: rgb(200, 30, 30); }\n')
      // Above the page's folder, and at a root-absolute path a built single-page app uses.
      write('/root/shared/theme.css', 'body { background-color: rgb(1, 2, 3); }\n')
      write('/root/pages/assets/app.js', 'window.__spaLoaded = "ok"\n')
      // Past the 512 KiB one host reply carries; generated on the host, too long for one argument.
      exec(
        `mkdir -p /root/pages/js /root/pages/fonts && ` +
          `{ printf 'window.__bundleLoaded = "ok";\\n/*'; head -c 700000 /dev/zero | tr '\\0' x; printf '*/\\n'; } > /root/pages/js/bundle.js && ` +
          `head -c 2048 /dev/urandom > /root/pages/fonts/icons.woff2 && ` +
          `{ printf '<!doctype html><html><body><h1 id="title">Huge page ${stamp}</h1><!--'; head -c 900000 /dev/zero | tr '\\0' x; printf -- '--></body></html>\\n'; } > ${files.huge}`
      )
      write(
        files.top,
        `<!doctype html><html><head><title>Top</title><link rel="stylesheet" href="top.css"></head>` +
          `<body><h1 id="title">Top page ${stamp}</h1></body></html>\n`
      )
      write('/root/top.css', 'h1 { color: rgb(30, 30, 200); }\n')
      write(
        files.appPage,
        `<!doctype html><html><head><link rel="stylesheet" href="page.css"></head>` +
          `<body><h1 id="title">App page ${stamp}</h1></body></html>\n`
      )
      write(`${appPath}/page.css`, 'h1 { color: rgb(10, 120, 10); }\n')
      exec(
        `mkdir -p /root/logs && seq 1 200000 | sed 's/^/line /' > ${files.log} && cp ${files.log} ${files.liveLog}`
      )
      const logBytes = Number(exec(`stat -c %s ${files.log}`).trim())
      // A decoder stops at the PNG's end chunk, so the trailing bytes only make the file large.
      exec(
        `mkdir -p /root/data && { printf '%s' ${quotePosixShell(CHECKERBOARD_PNG)} | base64 -d; head -c 12000000 /dev/zero; } > ${files.bigImage}`
      )
      const pdf = createPdfFindFixture({ title: `Server PDF ${stamp}` }).toString('base64')
      // pdf.js finds the cross-reference table back past the padding, as it does past any trailing bytes.
      exec(
        `{ printf '%s' ${quotePosixShell(pdf)} | base64 -d; head -c 12000000 /dev/zero; } > ${files.bigPdf}`
      )
      exec(`{ echo 'step,loss'; seq 1 150000 | awk '{ print $1 ",0." $1 }'; } > ${files.csv}`)
      write(files.owned, `export const ownedByLib = 'LIB_OWNED_${stamp}'\n`)
      write(
        files.ownedPage,
        `<!doctype html><html><body><h1 id="title">Lib page ${stamp}</h1></body></html>\n`
      )
      write(files.same, `SERVER_SAME_${stamp}\n`)

      const { app, page, seeded, environmentId } = await launchManagedWorkspace(fixture, {
        repoPath: appPath,
        folderPath: libPath,
        beforeSeed: switchUiToEnglish
      })
      await recordDesktopOpens(app)
      const hostId = toRuntimeExecutionHostId(environmentId)
      const workspaceA = seeded.worktreeId
      const folderId = await page.evaluate(
        (folderPath) =>
          window.__store!.getState().folderWorkspaces.find((f) => f.folderPath === folderPath)?.id,
        libPath
      )
      expect(folderId, 'the folder workspace B converted onto the managed host').toBeTruthy()
      const workspaceB = folderWorkspaceKey(folderId!)
      const terminal = await openTerminalTab(page, workspaceA)
      const stayedInA = async (): Promise<void> => {
        await expect
          .poll(() => readActiveWorkspace(page), { timeout: 10_000 })
          .toEqual({ worktreeId: workspaceA, hostId })
      }

      await test.step('plain text outside every workspace opens in A with the host bytes', async () => {
        await clickPrintedHostPath(page, testInfo, terminal, files.plain)
        await expect
          .poll(() => readOpenedFile(page, files.plain), { timeout: 30_000 })
          .toMatchObject({ worktreeId: workspaceA, granted: true })
        await expectEditorText(page, `SERVER_PLAIN_${stamp}`)
        await stayedInA()
        await forkShot(page, testInfo, 'f046-plain-txt-in-A')
      })

      await test.step('a path that also exists on this Mac shows the host file', async () => {
        await clickPrintedHostPath(page, testInfo, terminal, files.same)
        await expect
          .poll(() => readOpenedFile(page, files.same), { timeout: 30_000 })
          .toMatchObject({ worktreeId: workspaceA, granted: true })
        await expectEditorText(page, `SERVER_SAME_${stamp}`)
        await expect(page.locator('.monaco-editor .view-lines:visible').first()).not.toContainText(
          `MAC_SAME_${stamp}`
        )
        await stayedInA()
        await forkShot(page, testInfo, 'f046-same-path-shows-server')
      })

      await test.step('Markdown outside the workspace renders with its relative image', async () => {
        await clickPrintedHostPath(page, testInfo, terminal, files.markdown)
        await expect
          .poll(() => readOpenedFile(page, files.markdown), { timeout: 30_000 })
          .toMatchObject({ worktreeId: workspaceA })
        const rendered = page.locator('.rich-markdown-editor:visible').first()
        await expect(rendered).toContainText(`Server notes ${stamp}`, { timeout: 30_000 })
        const image = rendered.locator('img').first()
        await expect
          .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth), {
            timeout: 30_000,
            message: 'the image beside the Markdown file never loaded from the host'
          })
          .toBe(48)
        await stayedInA()
        await forkShot(page, testInfo, 'f046-markdown-image')
      })

      await test.step('self-contained HTML renders in the in-app preview in A', async () => {
        await clickPrintedHostPath(page, testInfo, terminal, files.report)
        await expect
          .poll(
            async () => (await readDocPreviewTabs(page, files.report)).map((t) => t.worktreeId),
            {
              timeout: 30_000
            }
          )
          .toEqual([workspaceA])
        await expect
          .poll(() => readDocPreviewGuest(page, `document.querySelector('#title')?.textContent`), {
            timeout: 60_000,
            message: 'the host HTML never rendered in the document preview'
          })
          .toBe(`Server report ${stamp}`)
        expect(
          await readDocPreviewGuest(
            page,
            `getComputedStyle(document.querySelector('#title')).color`
          )
        ).toBe('rgb(0, 128, 0)')
        expect(await readOpenedFile(page, files.report), 'no editor source tab').toBeNull()
        expect(await readDesktopOpens(app), 'no system browser or default app').toEqual([])
        await stayedInA()
        await forkShot(page, testInfo, 'f046-html-doc-preview')
      })

      await test.step('HTML with its stylesheets, scripts and font, beside it, above it and root-absolute, loads without a prompt', async () => {
        await clickPrintedHostPath(page, testInfo, terminal, files.site)
        await expect
          .poll(async () => (await readDocPreviewTabs(page, files.site)).map((t) => t.worktreeId), {
            timeout: 30_000
          })
          .toEqual([workspaceA])
        await expect
          .poll(() => readDocPreviewGuest(page, `document.querySelector('#title')?.textContent`), {
            timeout: 60_000
          })
          .toBe(`Server site ${stamp}`)
        await expect
          .poll(
            () =>
              readDocPreviewGuest(page, `getComputedStyle(document.querySelector('#title')).color`),
            { timeout: 60_000, message: 'the stylesheet beside the HTML never applied' }
          )
          .toBe('rgb(200, 30, 30)')
        await expect
          .poll(() => readDocPreviewGuest(page, `window.__bundleLoaded ?? null`), {
            timeout: 60_000,
            message: 'the script past 512 KiB never ran'
          })
          .toBe('ok')
        expect(
          await readDocPreviewGuest(
            page,
            `fetch('fonts/icons.woff2').then((r) => [r.status, r.headers.get('content-type')])`
          ),
          'fonts are served, as terminal grants did not'
        ).toEqual([200, 'font/woff2'])
        expect(
          await readDocPreviewGuest(page, `getComputedStyle(document.body).backgroundColor`),
          'the stylesheet above the page folder applied'
        ).toBe('rgb(1, 2, 3)')
        expect(
          await readDocPreviewGuest(page, `window.__spaLoaded ?? null`),
          'a root-absolute script resolved under the page folder'
        ).toBe('ok')
        await expect(page.getByText(/This preview wants to read files/)).toHaveCount(0)
        expect(await readDesktopOpens(app)).toEqual([])
        await stayedInA()
        await forkShot(page, testInfo, 'f046-html-folder-no-prompt')
      })

      await test.step('HTML larger than one host reply renders', async () => {
        await clickPrintedHostPath(page, testInfo, terminal, files.huge)
        await expect
          .poll(() => readDocPreviewGuest(page, `document.querySelector('#title')?.textContent`), {
            timeout: 60_000,
            message: 'the HTML past 512 KiB never rendered'
          })
          .toBe(`Huge page ${stamp}`)
        await stayedInA()
        await forkShot(page, testInfo, 'f046-huge-html')
      })

      await test.step('a page directly in the home folder styles without a prompt', async () => {
        await clickPrintedHostPath(page, testInfo, terminal, files.top)
        await expect
          .poll(
            () =>
              readDocPreviewGuest(page, `getComputedStyle(document.querySelector('#title')).color`),
            { timeout: 60_000, message: 'the stylesheet beside the home-folder page never applied' }
          )
          .toBe('rgb(30, 30, 200)')
        await expect(page.getByText(/This preview wants to read files/)).toHaveCount(0)
        await stayedInA()
        await forkShot(page, testInfo, 'f046-home-folder-no-prompt')
      })

      await test.step("a page at workspace A's root styles without a prompt (F051)", async () => {
        await clickPrintedHostPath(page, testInfo, terminal, files.appPage)
        await expect
          .poll(
            () =>
              readDocPreviewGuest(page, `getComputedStyle(document.querySelector('#title')).color`),
            {
              timeout: 60_000,
              message: 'the stylesheet beside the workspace-root page never applied'
            }
          )
          .toBe('rgb(10, 120, 10)')
        await expect(page.getByText(/This preview wants to read files/)).toHaveCount(0)
        await stayedInA()
      })

      await test.step('a log past 512 KiB opens in the editor, whole and read-only', async () => {
        await clickPrintedHostPath(page, testInfo, terminal, files.log)
        await expect
          .poll(() => readOpenedFile(page, files.log), { timeout: 30_000 })
          .toMatchObject({ worktreeId: workspaceA, granted: true })
        await expect
          .poll(
            () =>
              page.evaluate((target) => {
                const probe = window.__monacoEditorE2E
                return probe?.filePath === target ? probe.snapshot().valueLength : null
              }, files.log),
            { timeout: 60_000, message: 'the log never loaded whole' }
          )
          .toBe(logBytes)
        // A grant saves at most 512 KiB, so the tab is a view rather than a save that fails later.
        await expect
          .poll(() => readOpenedFile(page, files.log), { timeout: 10_000 })
          .toMatchObject({ readOnly: true })
        await stayedInA()
        await forkShot(page, testInfo, 'f046-large-log')
      })

      await test.step('a log still being written opens as it was when the read began', async () => {
        exec(
          `nohup sh -c 'i=0; while [ $i -lt 600 ]; do echo "grow $i" >> ${files.liveLog}; i=$((i+1)); sleep 0.05; done' >/dev/null 2>&1 &`
        )
        await clickPrintedHostPath(page, testInfo, terminal, files.liveLog)
        await expect
          .poll(
            () =>
              page.evaluate((target) => {
                const probe = window.__monacoEditorE2E
                return probe?.filePath === target ? probe.snapshot().valueLength : null
              }, files.liveLog),
            { timeout: 60_000, message: 'the growing log never loaded' }
          )
          .toBeGreaterThanOrEqual(logBytes)
        await expect(page.getByText('File changed on disk while it was loading')).toHaveCount(0)
        await stayedInA()
      })

      await test.step('an image and a PDF past one preview reply render in the editor', async () => {
        await clickPrintedHostPath(page, testInfo, terminal, files.bigImage)
        await expect
          .poll(() => readOpenedFile(page, files.bigImage), { timeout: 30_000 })
          .toMatchObject({ worktreeId: workspaceA, granted: true })
        const image = page.locator('img[alt="big.png"]:visible').first()
        await expect
          .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth), {
            timeout: 60_000,
            message: 'the image past one preview reply never loaded'
          })
          .toBe(48)
        await stayedInA()
        await forkShot(page, testInfo, 'f046-large-image')

        await clickPrintedHostPath(page, testInfo, terminal, files.bigPdf)
        await expect
          .poll(() => readOpenedFile(page, files.bigPdf), { timeout: 30_000 })
          .toMatchObject({ worktreeId: workspaceA, granted: true })
        await expect(page.locator('.pdfViewer:visible .textLayer').first()).toContainText(
          `Server PDF ${stamp}`,
          { timeout: 60_000 }
        )
        await stayedInA()
        await forkShot(page, testInfo, 'f046-large-pdf')
      })

      await test.step('a CSV past the paging threshold opens in the paged preview', async () => {
        await clickPrintedHostPath(page, testInfo, terminal, files.csv)
        await expect
          .poll(() => readOpenedFile(page, files.csv), {
            timeout: 30_000,
            message: 'the CSV never opened in the paged preview'
          })
          .toMatchObject({ worktreeId: workspaceA, granted: true, csvPreviewOnly: true })
        await expect(page.getByText('Large file preview · Read-only')).toBeVisible()
        await expect(page.getByText('loss', { exact: true }).first()).toBeVisible({
          timeout: 60_000
        })
        await expect(page.getByText('0.2', { exact: true }).first()).toBeVisible({
          timeout: 60_000
        })
        await expect(page.getByText(/too large to open/i)).toHaveCount(0)
        await stayedInA()
        await forkShot(page, testInfo, 'f046-large-csv')
      })

      await test.step("workspace B's file opens read-only in A without activating B", async () => {
        await clickPrintedHostPath(page, testInfo, terminal, files.owned)
        await expect
          .poll(() => readOpenedFile(page, files.owned), { timeout: 30_000 })
          .toMatchObject({ worktreeId: workspaceA, readOnly: true, granted: true })
        await expectEditorText(page, `LIB_OWNED_${stamp}`)
        await expect
          .poll(() => page.evaluate(() => window.__monacoEditorE2E?.filePath))
          .toBe(files.owned)
        await page.locator('.monaco-editor .view-lines:visible').first().click()
        await page.keyboard.type('EDIT_ATTEMPT')
        await expect(page.locator('.monaco-editor .view-lines:visible').first()).not.toContainText(
          'EDIT_ATTEMPT'
        )
        expect(await page.evaluate(() => window.__monacoEditorE2E?.snapshot().canUndo)).toBe(false)
        await stayedInA()
        expect((await readActiveWorkspace(page)).worktreeId).not.toBe(workspaceB)
        await forkShot(page, testInfo, 'f046-b-owned-read-only-in-A')
      })

      await test.step("workspace B's HTML previews in A without activating B", async () => {
        await clickPrintedHostPath(page, testInfo, terminal, files.ownedPage)
        await expect
          .poll(
            async () => (await readDocPreviewTabs(page, files.ownedPage)).map((t) => t.worktreeId),
            { timeout: 30_000 }
          )
          .toEqual([workspaceA])
        await expect
          .poll(() => readDocPreviewGuest(page, `document.querySelector('#title')?.textContent`), {
            timeout: 60_000
          })
          .toBe(`Lib page ${stamp}`)
        expect(await readDesktopOpens(app)).toEqual([])
        await stayedInA()
        await forkShot(page, testInfo, 'f046-b-owned-html-in-A')
      })
    })
  } finally {
    rmSync(files.same, { force: true })
  }
})
