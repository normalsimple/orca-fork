# Linux verification

Node 24 is required. `package.json` sets `"engines": { "node": "24" }`. Node 22.14 cannot import the `.ts` build plugins (`ERR_UNKNOWN_FILE_EXTENSION`), and `pnpm lint` / `pnpm test` / `pnpm build` must run on Node 24. Bun 1.4.4 (`config/.bun-version`) is what `pnpm test` uses to launch Vitest.

Run this on a Linux checkout of `develop` before treating a hook change as behavior-neutral. The scripts stay on this branch.

```bash
bash fork/scripts/verify/run-linux-verify.sh
```

It refreshes `upstream/main` (`fork/scripts/verify/fetch-upstream-main.sh`), runs `check-no-internal-refs.sh`, then takes the Electron screenshot below under `xvfb-run`. Without `xvfb-run` it writes `screenshot-skipped.txt` and exits 1. Outputs go to `$OUT_DIR` (default `/tmp/orca-fork-verify`).

The checks that gate a push and the daily merge:

```bash
python3 fork/scripts/generate-audit.py --check
node config/scripts/run-vitest.mjs run --config config/vitest.config.ts --maxWorkers=2 src/fork src/shared/fork-hooks
```

`fork/push_github.sh` runs both before it pushes; the daily job's full list is in [DAILY.md](./DAILY.md). After a hook change also run `pnpm tc`, `pnpm exec oxlint <changed files>`, the upstream tests next to each upstream file the change touched, and `pnpm check:max-lines-ratchet` when the change added a `max-lines` first line and its entry in the fork block at the end of `config/max-lines-baseline.txt` (the rules are in FORK-CHANGES.md, 上游文件规则). `pnpm lint` on the fork is expected to fail only where upstream `main` itself fails. Run them with `ORCA_BACKGROUND_LAUNCH=1`.

## Internal identifiers

`check-no-internal-refs.sh` scans `src/fork`, `src/shared/fork-hooks`, `docs/fork`, `fork/` (scripts and the push script), `FORK-CHANGES.md`, and every file added since the upstream base recorded in `src/fork/skills-source-commit.ts`, of any type. Without that commit it falls back to `*.fork.test.ts(x)` and `*-fork.test.ts(x)`. It fails when a pattern matches. Put one fixed string per line in `fork/scripts/verify/internal-ref-patterns.local` (gitignored) or in `ORCA_INTERNAL_REF_PATTERNS` (newline-separated). When neither is set, the script exits 2 without scanning. It does not scan itself. Files copied or renamed from upstream files count as added (`--no-renames`). After the content scan it runs `check-commit-identity.sh` on `ORCA_IDENTITY_REF` (default `HEAD`), which fails unless every commit after `upstream/main` and the floor fixed in the script (`8fd7c96acc`, not read from any file) is authored and committed by `quzard <30899719+quzard@users.noreply.github.com>`, and fails when `upstream/main` is missing. `run-linux-verify.sh` runs this check first, after `fetch-upstream-main.sh` refreshes `upstream/main`.

## What the scripts check

`screenshot-electron.mjs` builds `electron-vite build --mode e2e` when `out/main/index.js` is missing (or when `ORCA_FORK_VERIFY_REBUILD=1`, unless `ORCA_FORK_VERIFY_SKIP_BUILD=1` and `out/` exists), then launches Electron under Xvfb with `ORCA_BACKGROUND_LAUNCH=1` and `ORCA_E2E_HEADLESS=1`. It uses an isolated `HOME` and `ORCA_E2E_USER_DATA_DIR`, waits for the first window, and writes `fork-base-window.png` and `fork-base-window.txt` (title and URL). The window stays hidden.

## Checks only a Mac can do

These need macOS, a logged-in GUI session, or a Mac-only binary. Linux does not run them.

- Code signing with the local `Orca Local Signing` identity, and the signed-app install/rollback in the Mac install script (F002).
- macOS keychain prompts versus the file secret store, including a packaged app that must not call Safe Storage (F038). The file backend is registered for packaged macOS; Linux cannot prove the zero Safe Storage count.
- `electron-builder --mac dmg:arm64 zip:arm64` through `fork/scripts/install-mac-release.sh`, `mac.signIgnore`, and the Docker manylinux orcad slots (F002, F036). The installer refuses a non-arm64 Node. On Linux the fork tests run `bash -n` on that script and on `fork/scripts/build-orcad-linux-prebuilds.sh`, check `assertLocalTemplateTargets` against a manifest without the glibc 2.17 slot, and, when `out/cli/index.js` exists (after `pnpm build:cli`), run `node fork/scripts/verify-packaged-cli-closure.mjs`. A checkout without a Docker daemon does not compile the manylinux slots. The x64 PTY check is not executed because that package is not built.
- Dragging the computer-use app card into System Settings (`pnpm build:computer-macos`, F006). Linux only checks, in `src/fork/computer-use/permission-card.fork.test.ts`, that `ForkPermissionCard.swift` uses the same `--fork-drag-card` argument and that `main.swift` installs the card.
- Opening an SSH workspace, or a managed-server workspace whose files are on that SSH host, in Cursor, VS Code, or Zed. That is upstream #33877 (`cursor --new-window --remote ssh-remote+…`, not a `cursor://` URL) and needs the editor plus a reachable SSH host. The per-port Forward button on a managed workspace (F043) needs that host too.
- Seeing a host file from a terminal or chat link on a managed server (F046): a file outside every workspace, a file another workspace holds, and HTML in the doc preview. Linux covers the preview plan, the grant location, the host's absolute-path reads (any file, fonts, ranged reads past 512 KiB), the main-process read with its site-first paths and its fallback to host grants, the whole request base opening without a prompt (F051), text, images, PDFs and CSVs outside every workspace past one reply, the kept read-only view and the loader with `host-file-*.fork.test.*`, `large-host-file-read.fork.test.tsx` and `kept-host-file-view*.fork.test.tsx`. `tests/e2e/fork-f046-host-file-links.spec.ts` drives the same links against an x86_64 Docker host. The rendered page needs that server; see the manual list below.
- A signed Mac app. The deep link and the permission card are not a substitute for that check.

## Manual checks with a Linux host

Install this build on the Mac and connect an x86_64 Linux host over SSH; let the app deploy or update the host's managed server (orcad) to the same build.

### F046 host file links

An older fork orcad does not grant paths outside the workspace without `crossWorkspace`: HTML outside every workspace 404s and another workspace's file switches workspaces. A host without `files.hostDocPreview.*` and `files.hostFile.*` (a fork orcad from before them, or upstream `orca serve`) reads such files through terminal grants: text and CSVs stop at 512 KiB, images and PDFs at about 3 MB, and fonts fail. Those are the expected degradations. On the host, create workspaces A (`~/wt/app`) and B (`~/wt/lib`), and outside them `~/notes/plain.txt`, `~/notes/doc.md` (with `![](img/chart.png)`) and `~/notes/img/chart.png`, `~/pages/report.html` (styles inline), `~/pages/site.html` (linking `style.css`, `img/a.png`, `../shared/theme.css`, `/assets/app.js` kept at `~/pages/assets/app.js`, a script over 512 KiB and a web font) and those files, `~/pages/huge.html` (over 512 KiB), `~/top.html` (linking `~/top.css`), `~/wt/app/page.html` (linking `page.css` beside it), `~/logs/train.log` (a few MB), `~/data/big.png` and `~/data/paper.pdf` (each over 3 MB), `~/data/results.csv` (a few MB), and `/tmp/same.txt` (different content on the Mac and on the host).

1. Print the absolute path of `~/notes/plain.txt` in A's terminal and Cmd-click it: A's editor opens the host's content, A stays active, and the file saves (newer hosts grant write).
2. `/tmp/same.txt` shows the host's content, not the Mac's.
3. After `cd ~/notes && ls`, click `plain.txt` (relative to the cwd), and an OSC 8 link (`printf '\e]8;;file:///home/<u>/notes/plain.txt\e\\link\e]8;;\e\\\n'`): same as 1. Note whether a bare `~/notes/plain.txt` becomes a link and opens the host file (upstream behavior).
4. `doc.md` opens in the editor; its Markdown preview renders and shows `img/chart.png`.
5. `report.html` opens a doc preview tab in A that renders the page: no editor source, no system browser, no workspace switch.
6. `site.html` loads every stylesheet, image, script and font, beside it, above it and root-absolute, with no folder prompt.
7. `huge.html` renders.
8. `~/top.html` (directly in the home folder) and `~/wt/app/page.html` (at A's root) style with no folder prompt.
9. `~/logs/train.log` opens whole and read-only in A's editor; so does it while `while true; do date >> ~/logs/train.log; sleep 0.1; done` runs. A large binary such as `~/model.bin` shows as binary at once. `~/data/big.png` and `~/data/paper.pdf` render in A's editor, and `~/data/results.csv` opens in the paged CSV preview.
10. In A's terminal, click a text file of B (`~/wt/lib/src/index.ts`): it opens read-only in A and B does not activate. After an app restart the tab is still in A and readable.
11. From A, click an HTML file of B: a doc preview opens in A, B does not activate, and the files beside it load without a folder prompt.
12. Click B's root directory: B activates (upstream behavior).
13. The same absolute-path links in A's native agent chat behave like 1, 4, 5 and 10.
14. Paste the absolute path of `~/pages/report.html`, or `file:///home/<u>/pages/report.html`, into the address bar of a browser page in A: it becomes a doc preview read from the host.
15. Click `~/notes` (a folder): the hint names a folder outside the host's workspaces and nothing on the Mac opens. Click a missing `~/nope.txt`: the hint says the host has no such file.
16. Restart the app with the `report.html` preview open: it reads from the host again.
17. In a local Mac workspace, local HTML follows the link-routing setting (system browser or in-app page), and a file of another local workspace still switches to it (upstream behavior).
18. With a paired client or phone, if available: files outside every workspace open (upstream #33958).

### F047 workspace repositories (removed)

Source Control is the upstream single-repo view. There is no Current repo / Workspace repos switch, and nested repositories in the workspace are not listed.
