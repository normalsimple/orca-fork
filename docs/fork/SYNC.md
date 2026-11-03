# Syncing develop with upstream

`develop` is the integration branch (upstream's branch stays `main`). Its history is upstream `17a2bced1115f064e834e397c2b949d9e150d275` plus the fork commits, followed by merges of upstream `main`. `fork/base` remains an alias of the commit that became the integration branch; the daily jobs do not move it. `fork/base-upstream` remains the upstream pointer a human last pushed. The daily cloud job creates that ref locally from `upstream/main` before rewriting the skill pin, and does not push it. Feature work lands in `src/fork/` and touches upstream files only through the hooks in [HOOKS.md](./HOOKS.md), following the upstream-file rules in [FORK-CHANGES.md](../../FORK-CHANGES.md) (上游文件规则): hook calls only, no moved or re-indented upstream code, fork tests only in `src/fork`, and fork code deleted once upstream covers it.

The unattended jobs are documented in [DAILY.md](./DAILY.md). GitHub Actions on this fork stay disabled.

## One-time git config

```bash
git config rerere.enabled true
git config merge.ours.driver true
```

`rerere` remembers hook conflict resolutions on a machine that keeps its `.git` directory. `.gitattributes` adds one fork line at the end: `src/shared/rpc-contract/rpc-params-catalog.generated.ts merge=ours`. Both sides add RPC methods to that generated file, so a text merge would conflict; with `git config merge.ours.driver true` the merge keeps the fork's copy, and `daily-sync.sh` then runs `pnpm generate:rpc-params-catalog` and commits the result. Run the same command after a manual merge. Every other generated file only changes upstream and merges as text.

## Merge

```bash
git fetch https://github.com/stablyai/orca.git main
git checkout develop
git merge --no-ff <upstream-main-sha>
```

Do not rebase `develop` onto upstream: that rewrites every fork commit and would need a force push.

Conflicts should be limited to the hook lines listed in HOOKS.md. Keep the upstream side, then re-apply the hook call as one line next to the code it belongs to; do not move, wrap or re-indent upstream code to make it fit. When upstream now covers a fork behavior, delete the fork code instead of re-applying its hook, and mark the feature removed in FORK-CHANGES.md. On a machine that keeps its `.git` directory, `git rerere` replays a resolution on the next sync. The daily cloud job starts from a fresh checkout every time, so it does not benefit from rerere.

```bash
git rerere status
# fix the file, then
git add <file>
git commit
```

`config/max-lines-baseline.txt` ends with one fork block: the comment line `# fork: hook lines in upstream files at the cap`, then an `inline <path>` entry for each upstream file whose first line is `/* oxlint-disable max-lines -- fork: hook call only */` (`orcad-entry.ts`, `useEditorPanelFileContentLoader.ts`, `DeleteWorktreeDialog.tsx`, `useAddRepoNestedImportFlow.ts`). When upstream changes its last baseline entry, the merge conflicts next to that block: keep upstream's lines, with the fork block still at the end. Never run `pnpm check:max-lines-ratchet --prune` blindly on the fork: it rewrites the file sorted, drops the fork comment, and mixes the fork entries into upstream's. Remove a fork entry only when its file no longer needs the disable. `pnpm lint` on the fork is expected to fail only where upstream `main` itself fails.

A conflicted generated file takes upstream's side and is regenerated from the merged sources: `pnpm generate:rpc-params-catalog` (it reads `ALL_RPC_METHODS`, so the fork's `files.hostFile.*` and `files.hostDocPreview.*` names come back by themselves), `pnpm generate:bundled-skill-guides`, `pnpm generate:skill-bundle-manifest`, `pnpm sync:localization-runtime-catalog`. Then run the verifies in `package.json` (`verify:rpc-params-catalog`, `verify:bundled-skill-guides`, `verify:skill-bundle-manifest`, `verify:localization-runtime-catalog`).

Rewrite the skill clone ref and commit that file with the sync:

```bash
node fork/scripts/sync-skills-source-commit.mjs
```

The script writes the one pin, `src/fork/skills-source-commit.ts`. `electron.vite.config.ts` feeds it to the renderer as `ORCA_BUILD_COMMIT`, the only build constant upstream's `npx skills add` command reads, and the audit generator and the internal-ref scan read it as the upstream base. It uses `git merge-base HEAD fork/base-upstream`, then `origin/fork/base-upstream`. If that ref is missing, it uses `git merge-base HEAD upstream/main`, then `origin/upstream/main` (the upstream commit this branch contains, never the upstream tip). If those are missing too, it keeps the checked-in pin. A fork build must not clone `stablyai/orca` at its own commit.

Then regenerate the audit table and commit it with the sync:

```bash
python3 fork/scripts/generate-audit.py           # rewrites docs/fork/AUDIT.md
python3 fork/scripts/generate-audit.py --check   # only compares; exit 1 when stale
```

The table has one row for every tracked file that differs from the pinned upstream base, upstream files included, so a new pin or a new fork file changes it. It reads tracked files only (`git add` a new file first) and needs git, python3 and `node_modules` (it formats with the repo's oxfmt). `src/fork/audit-table.fork.test.ts` recomputes the file set with git and fails on a stale table. Finally run the checks the daily job runs (DAILY.md) and the ones in [VERIFY.md](./VERIFY.md).

## Local Mac package

`fork/scripts/install-mac-release.sh` runs the macOS release job's commands. It does not keep a second electron-builder config. The overrides are the signing identity (`CSC_NAME` and `ORCA_COMPUTER_MACOS_SIGN_IDENTITY` set to `Orca Local Signing`, `CSC_IDENTITY_AUTO_DISCOVERY=false`), the version suffix from `config/scripts/build-mac-local.mjs`, an Apple Silicon-only Electron package, the orcad template targets this Mac package must carry, and the backup/install/rollback at the end of the script. The identity and the targets come from `src/fork/packaging.cjs`.

Every fork Mac is Apple Silicon. The x64 package's afterPack check starts the user's interactive shell under Rosetta and timed out waiting for `OK 42` (`the x64 terminal host did not serve a PTY`). `electron-builder --arm64` does not remove that package: `config/electron-builder.config.cjs` lists `arch: ['x64', 'arm64']` on the dmg and zip targets, and an empty CLI target list keeps those arches (`computeArchToTargetNamesMap` uses the config arch when the CLI target names are empty). `electron-builder --mac dmg:arm64 zip:arm64` names the targets, so the config arch list is not applied and afterPack runs only for arm64. `config/scripts/build-mac-local.mjs` appends its extra arguments after `--mac` so the installer can pass those two targets. `verify-packaged-daemon-entry.cjs` is unchanged. `pnpm build:mac` still follows the config and can build both arches; the fork installer does not call it.

Commands it runs, in order:

1. `pnpm install --frozen-lockfile --cpu=arm64` and `pnpm --dir mobile install --frozen-lockfile` (`--fast` skips both). The host Node must be 24 and arm64.
2. `pnpm run build:release`.
3. Host `darwin-arm64` orcad lane: `pnpm build:orcad-prebuilds`, `--require-slots` of `node config/scripts/build-orcad-prebuilds.mjs --print-slot`, `--smoke`. The host slot must be `darwin-arm64`. Linux slots: `bash fork/scripts/build-orcad-linux-prebuilds.sh` (`--fast` skips a slot that already passes `--require-slots`). Then `node config/scripts/build-orcad-template.mjs --targets darwin-arm64,linux-x64-glibc,linux-arm64-glibc`, and `assertLocalTemplateTargets` on `out/orcad-template/orcad-template.json`, so a missing slot (glibc 2.17 included) fails before electron-builder. `ORCA_ORCAD_TEMPLATE_TARGETS` is that list and `ORCA_REQUIRE_ORCAD_TEMPLATE=1`. `linux-x64-glibc217` is not in the list; the template script stages it when the `linux-x64-glibc` prebuild's compat slot is present.
4. `node config/scripts/runtime-file-watcher-fault-harness.mjs`, then the same file under `ELECTRON_RUN_AS_NODE=1` via `pnpm exec electron`.
5. `node config/scripts/pinned-node-downloads.mjs darwin-arm64`, `pnpm run ensure:electron-runtime`, and `node config/scripts/build-mac-local.mjs dmg:arm64 zip:arm64`. The built app is `dist/mac-arm64/Orca.app`.

After packaging, the script fails unless `Contents/Resources/orcad-template/orcad-template.json` exists and `assertLocalTemplateTargets` finds `darwin-arm64`, `linux-x64-glibc`, `linux-arm64-glibc` and `linux-x64-glibc217` in its `targets` (`LOCAL_TEMPLATE_TARGETS` in `src/fork/packaging.cjs`). It then runs upstream's `verifySkillsCliRuntime` on the unpacked tree, the same check electron-builder's afterPack runs, and `codesign --verify --deep --strict` on the app.

Skipped, because the upstream step needs a CI secret or an artifact this machine cannot produce:

- `node config/scripts/verify-macos-release-env.mjs`. It requires `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK`, and `CSC_KEY_PASSWORD`. The script forces `ORCA_MAC_RELEASE`, `ORCA_MAC_HOURLY`, `ORCA_MAC_DAILY`, and `ORCA_MAC_ADHOC` to `0` and unsets `CSC_LINK` plus the Apple variables, so notarization stays off. Upstream's own message for this case is to use the local packager (`build-mac-local.mjs`) instead of the notarized release command.
- Downloading the `orcad-template` artifact from the parent release-cut run. That needs `release_run_id` and `GITHUB_TOKEN`, and the published template cannot be reused: `orcad.js` is the esbuild bundle of `src/main/orcad/main.ts`, which imports `orcad-entry.ts`, whose `startOrcad` calls `installForkOrcadHost()` to register the fork's main-process hooks. Shipping the upstream artifact would drop those hooks on SSH hosts. `fork/scripts/build-orcad-linux-prebuilds.sh` instead runs the CI images from `linux_glibc_floor` and `linux_glibc217_compat` (`manylinux_2_28` x86_64 and aarch64, and `manylinux2014_x86_64`). The host downloads the pinned Node; the container compiles with `--slot` and smokes. A cache outside the checkout (`ORCA_NODE_RUNTIME_CACHE_DIR`; on the home Mac the default is `~/Projects/orca-verify/node-runtime-cache`) is mounted at `/node-runtime-cache`. A cache inside the checkout is reached through the repo mount at `/work`. The script does not `pnpm install` inside the image. The container sees only the repo, so `install-mac-release.sh` exports `ORCA_PNPM_GLOBAL_VIRTUAL_STORE=0` before installing (upstream's `config/pnpmfile.cjs` otherwise links every dependency from pnpm's global store outside the checkout), and the script stops before the first slot if `node-pty` or one of its dependencies still resolves outside the repo. Docker must be able to run `linux/amd64` and `linux/arm64`. musl, win32, and `darwin-x64` are still absent: the prebuild script only labels the machine it is actually running on, and an Apple Silicon Mac cannot emit the `darwin-x64` slot. SSH to one of those hosts still fails later. The full matrix remains the `desktop_template` job.
- The parent-run conclusion check (`gh api .../actions/runs/<id>`). It needs `GH_TOKEN` and a parent run, and it only guards a GitHub publish.
- `electron-builder --mac` with GitHub publish. That would upload to `stablyai/orca` and needs `GH_TOKEN`. `build-mac-local.mjs` is the upstream command that packages macOS without publishing and stamps `ORCA_LOCAL_BUILD_VERSION`. Do not set that variable in the shell; the script reads `CFBundleShortVersionString` from the built app. The installer adds `dmg:arm64 zip:arm64` after `--mac`.
- `assert-github-release-is-draft.mjs`. There is no GitHub release.
- `verify-telemetry-constants.mjs`. It needs `ORCA_POSTHOG_WRITE_KEY` compiled into the app. That secret is not set, so a local build has no PostHog write key. `ORCA_DIAGNOSTICS_TOKEN_URL` is the public release URL and is set.
- Restoring `release-javascript` from a parent run (`ORCA_RELEASE_JAVASCRIPT_SOURCE_SHA`). The wrapper always takes the workflow's other branch, `pnpm run build:release`.

`pnpm build:mac` is not used. It typechecks and rebuilds the desktop assets that `build:release` already built, and it does not build the orcad template.
