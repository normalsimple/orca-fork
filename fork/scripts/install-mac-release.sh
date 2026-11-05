#!/bin/bash
# Usage: ./fork/scripts/install-mac-release.sh [--fast] [--build-only]
# After acceptance: ./fork/scripts/install-mac-release.sh --cleanup-verified-backups <accepted-version>
# Thin wrapper around the macOS release job. Build commands match
# .github/workflows/release-mac-build.yml. Signing identity, the local version
# suffix, and backup/install/rollback are the only overrides. Skipped CI steps
# are listed in docs/fork/SYNC.md.
# --fast skips the two dependency installs. The build commands stay the same.
set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly APP_NAME='Orca.app'
readonly INSTALL_ROOT='/Applications'
readonly INSTALL_APP="$INSTALL_ROOT/$APP_NAME"
readonly OUTPUT_DIR='dist'
readonly CLEANUP_VERIFIED_BACKUPS='--cleanup-verified-backups'
readonly APP_BUNDLE_ID='com.stablyai.orca'

if [[ "$(uname -s)" != 'Darwin' ]]; then
  echo '此脚本仅用于 macOS 本机安装。' >&2
  exit 1
fi
if [[ "${1:-}" == "$CLEANUP_VERIFIED_BACKUPS" ]]; then
  # The version argument limits cleanup to the install that was just accepted.
  readonly INSTALLED_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INSTALL_APP/Contents/Info.plist")"
  if [[ "$#" != 2 || "$2" != "$INSTALLED_VERSION" ]]; then
    echo '请传入刚完成验收的当前安装版本号。' >&2
    exit 1
  fi
  codesign --verify --deep --strict "$INSTALL_APP"
  readonly RUNNING_EXECUTABLES="$(ps -axo comm=)"
  removed=0
  removed_kib=0
  for backup_dir in "$INSTALL_ROOT"/.orca-previous.*; do
    [[ -d "$backup_dir" && ! -L "$backup_dir" && -d "$backup_dir/$APP_NAME" && ! -L "$backup_dir/$APP_NAME" ]] || continue
    if [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$backup_dir/$APP_NAME/Contents/Info.plist" 2>/dev/null || true)" != "$APP_BUNDLE_ID" ]]; then
      continue
    fi
    # Skip a copy a process is still using, and do not touch extra files parked in the backup dir.
    if awk -v prefix="$backup_dir/" 'index($0, prefix) == 1 { found = 1 } END { exit !found }' <<< "$RUNNING_EXECUTABLES"; then
      echo "跳过正在使用的旧版：$backup_dir"
      continue
    fi
    size_kib="$(du -sk "$backup_dir/$APP_NAME" | awk '{print $1}')"
    rm -rf -- "$backup_dir/$APP_NAME"
    rmdir "$backup_dir" 2>/dev/null || true
    removed=$((removed + 1))
    removed_kib=$((removed_kib + size_kib))
  done
  echo "已清理 $removed 个旧版应用，合计 $removed_kib KiB；当前应用与用户数据保留。"
  exit 0
fi
FAST=false
BUILD_ONLY=false
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --fast) FAST=true; shift ;;
    --build-only) BUILD_ONLY=true; shift ;;
    *) echo "未知参数：$1" >&2; exit 1 ;;
  esac
done
cd "$REPO_ROOT"
if [[ "$(node -p 'process.versions.node.split(".")[0]')" != '24' ]]; then
  echo '请先切换到项目要求的 Node.js 24。' >&2
  exit 1
fi
xcode-select -p >/dev/null
# Fixed certificate. Stop if it is missing so the build cannot fall back to an ad-hoc signature.
readonly LOCAL_SIGNING_IDENTITY="$(node -p "require('./src/fork/packaging.cjs').localSigningIdentity")"
if ! security find-identity -v -p codesigning | awk -v identity="$LOCAL_SIGNING_IDENTITY" \
  'index($0, "\"" identity "\"") { found = 1 } END { exit !found }'; then
  echo "未找到有效的代码签名身份：${LOCAL_SIGNING_IDENTITY}；请在登录钥匙串中创建并信任该证书。" >&2
  exit 1
fi
if [[ "$(node -p 'process.arch')" != 'arm64' ]]; then
  echo '本机需要 Apple Silicon（arm64）。' >&2
  exit 1
fi
readonly BUILT_APP="$OUTPUT_DIR/mac-arm64/$APP_NAME"

assert_packaged_artifacts() {
  local resources="$BUILT_APP/Contents/Resources"
  local template="$resources/orcad-template/orcad-template.json"
  if [[ ! -f "$template" ]]; then
    echo "打包结果缺少 orcad-template：$template" >&2
    exit 1
  fi
  ORCA_TEMPLATE_MANIFEST="$template" node -e \
    "require('./src/fork/packaging.cjs').assertLocalTemplateTargets(process.env.ORCA_TEMPLATE_MANIFEST)"
  # Same check electron-builder afterPack runs. The host slice can execute it.
  ORCA_PACKAGED_RESOURCES="$resources" node --input-type=commonjs -e '
    const { verifySkillsCliRuntime } = require("./config/scripts/runtime-verification/skills-cli/verify-skills-cli-runtime.cjs")
    const resources = process.env.ORCA_PACKAGED_RESOURCES
    verifySkillsCliRuntime(`${resources}/app.asar.unpacked/out`, resources)
  '
}

# Upstream's pnpmfile links dependencies from a store outside the repo unless this is 0. The
# Linux orcad containers mount only the repo, so node-pty must live in the repo's node_modules.
export ORCA_PNPM_GLOBAL_VIRTUAL_STORE=0

if [[ "$FAST" == false ]]; then
  # These Macs are Apple Silicon. The release job also installs x64 for the other package.
  pnpm install --frozen-lockfile --cpu=arm64
  pnpm --dir mobile install --frozen-lockfile
  git diff --exit-code -- mobile/package.json mobile/pnpm-lock.yaml mobile/pnpm-workspace.yaml
else
  echo '快速安装：跳过依赖安装。'
fi

# Production optimizations are unrelated to Apple distribution signing.
export NODE_ENV=production
export NODE_OPTIONS='--max-old-space-size=4096'
export ORCA_DIAGNOSTICS_TOKEN_URL='https://www.onorca.dev/diagnostics/token'
# Notarization stays off. verify-macos-release-env.mjs needs Apple secrets; do not run it.
export ORCA_MAC_RELEASE=0 ORCA_MAC_HOURLY=0 ORCA_MAC_DAILY=0 ORCA_MAC_ADHOC=0
unset CSC_LINK CSC_KEY_PASSWORD APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID
export CSC_IDENTITY_AUTO_DISCOVERY=false
export CSC_NAME="$LOCAL_SIGNING_IDENTITY" ORCA_COMPUTER_MACOS_SIGN_IDENTITY="$LOCAL_SIGNING_IDENTITY"

# release-mac-build.yml "Build app" when no prebuilt JavaScript artifact is downloaded.
pnpm run build:release

# The release job downloads a merged template. This fork's orcad.js bundles
# registerForkMainModules, so an upstream template cannot be reused.
# darwin-arm64 is compiled here. Linux glibc slots use the CI manylinux images.
pnpm build:orcad-prebuilds
SLOT="$(node config/scripts/orcad-distribution/prebuilds/build-orcad-prebuilds.mjs --print-slot)"
if [[ "$SLOT" != darwin-arm64 ]]; then
  echo "本机 orcad 槽是 ${SLOT}；Linux SSH 包需要在 Apple Silicon 上编 darwin-arm64。" >&2
  exit 1
fi
pnpm build:orcad-prebuilds --require-slots "$SLOT"
pnpm build:orcad-prebuilds --smoke
FAST="$FAST" bash fork/scripts/build-orcad-linux-prebuilds.sh
# linux-x64-glibc217 is staged by the template script when that prebuild exists.
# Leave it out of this list so the packager does not count the compat target twice.
TEMPLATE_TARGETS='darwin-arm64,linux-x64-glibc,linux-arm64-glibc'
node config/scripts/orcad-distribution/template/build-orcad-template.mjs --targets "$TEMPLATE_TARGETS"
# Fail before electron-builder if a slot (glibc 2.17 included) did not make it into the template.
node -e "require('./src/fork/packaging.cjs').assertLocalTemplateTargets('out/orcad-template/orcad-template.json')"
export ORCA_ORCAD_TEMPLATE_TARGETS="$TEMPLATE_TARGETS"
export ORCA_REQUIRE_ORCAD_TEMPLATE=1

node config/scripts/diagnostics/runtime-watchers/runtime-file-watcher-fault-harness.mjs
ELECTRON_RUN_AS_NODE=1 pnpm exec electron config/scripts/diagnostics/runtime-watchers/runtime-file-watcher-fault-harness.mjs

# Local packager. It sets the version suffix and runs electron-builder for macOS.
# Apple notarization and GitHub artifact upload stay off.
# A bare --arm64 flag does not drop the x64 package: the config lists both arches,
# and an empty target list keeps them. Naming dmg:arm64 and zip:arm64 builds one arch,
# so afterPack never runs the x64 PTY check. That check starts the interactive shell
# under Rosetta and timed out waiting for OK 42.
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON config/scripts/orcad-distribution/prebuilds/pinned-node-downloads.mjs darwin-arm64
pnpm run ensure:electron-runtime
node config/scripts/desktop-distribution/macos/build-mac-local.mjs dmg:arm64 zip:arm64

ORCA_LOCAL_BUILD_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$BUILT_APP/Contents/Info.plist")"
assert_packaged_artifacts
codesign --verify --deep --strict "$BUILT_APP"
if [[ "$BUILD_ONLY" == true ]]; then
  echo "构建已完成，尚未安装：${BUILT_APP}（${ORCA_LOCAL_BUILD_VERSION}）"
  exit 0
fi

# Do not replace a running app, and do not kill by name. That would drop the user's terminals and agents.
if ps -axo comm= | awk -v executable="$INSTALL_APP/Contents/MacOS/Orca" \
  '$0 == executable { found = 1 } END { exit !found }'; then
  echo "构建已完成：${REPO_ROOT}/${BUILT_APP}；请退出 Orca 后重跑脚本安装。" >&2
  exit 1
fi

# Copy and verify on the same volume, then swap. Keep the previous app until acceptance. User data stays.
readonly STAGE_DIR="$(mktemp -d "$INSTALL_ROOT/.orca-install.XXXXXX")"
ditto "$BUILT_APP" "$STAGE_DIR/$APP_NAME"
codesign --verify --deep --strict "$STAGE_DIR/$APP_NAME"
# The app creates its own file key. The per-build signature hash does not change that key.
# A partition list does not parse a certificate expression, so install no longer edits keychain ACLs.
BACKUP_DIR=''
if [[ -e "$INSTALL_APP" ]]; then
  BACKUP_DIR="$(mktemp -d "$INSTALL_ROOT/.orca-previous.XXXXXX")"
  mv "$INSTALL_APP" "$BACKUP_DIR/$APP_NAME"
fi
if ! mv "$STAGE_DIR/$APP_NAME" "$INSTALL_APP"; then
  if [[ -n "$BACKUP_DIR" ]]; then
    mv "$BACKUP_DIR/$APP_NAME" "$INSTALL_APP"
    rmdir "$BACKUP_DIR"
  fi
  exit 1
fi
rmdir "$STAGE_DIR"
echo "已安装：${INSTALL_APP}（${ORCA_LOCAL_BUILD_VERSION}）"
if [[ -n "$BACKUP_DIR" ]]; then
  echo "旧版备份：$BACKUP_DIR/$APP_NAME"
fi
echo "完成新版功能与 SSH 验收后清理旧版：bash fork/scripts/install-mac-release.sh $CLEANUP_VERIFIED_BACKUPS $ORCA_LOCAL_BUILD_VERSION"
if [[ "${ORCA_BACKGROUND_LAUNCH:-}" == '1' ]]; then
  # LaunchServices does not inherit this shell. Pass the background policy so the window stays hidden.
  open -gj --env ORCA_BACKGROUND_LAUNCH=1 "$INSTALL_APP"
else
  open "$INSTALL_APP"
fi
