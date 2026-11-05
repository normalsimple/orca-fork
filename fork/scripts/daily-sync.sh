#!/bin/bash
# 云端每日上游同步。在干净的 Linux 检出上运行：
#   bash fork/scripts/daily-sync.sh
# 合并成功且检查通过时，只快进推送 origin/develop（不强推），不推标签、不推其他分支。
# 冲突或检查失败时不改 origin/develop，把现场推到 sync/upstream-YYYYMMDD（时区取 ORCA_SYNC_TZ，默认 UTC）后以非 0 退出。
# 不调用 GitHub Actions。仓库的 Actions 必须保持关闭。
set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

export GIT_TERMINAL_PROMPT=0
export GIT_EDITOR=true
export TZ="${ORCA_SYNC_TZ:-UTC}"
# 合并提交、pin 提交和冲突提交都用 fork 的公开身份，由脚本自己设置，机器上不用配 git 身份。
# 推送前的身份检查仍然会核对每个提交。
export GIT_AUTHOR_NAME="quzard"
export GIT_AUTHOR_EMAIL="30899719+quzard@users.noreply.github.com"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"

ATTEMPT_BRANCH="sync/upstream-$(date +%Y%m%d)"
ATTEMPT_SHA=""
ORIGIN_DEVELOP=""
UPSTREAM_SHA=""
PUSH_ATTEMPT=0

summary() {
  printf '%s\n' "$@"
}

die() {
  summary "$@"
  exit 1
}

# 每次推送前：upstream/main 之后的每个提交（含合并提交）作者和提交者都必须是 quzard 的 noreply 身份。
require_commit_identity() {
  local ref="$1"
  if ! bash "${REPO_ROOT}/fork/scripts/verify/check-commit-identity.sh" "$ref"; then
    die "daily-sync: FAILED" "reason: commit identity check failed for ${ref}" "develop: not pushed (${ORIGIN_DEVELOP})"
  fi
}

require_fork_origin() {
  local url
  url="$(git remote get-url origin)"
  case "$url" in
    *[:/]quzard/orca-fork | *[:/]quzard/orca-fork.git | *[:/]quzard/orca-fork/) ;;
    *) die "daily-sync: FAILED" "reason: origin is not quzard/orca-fork ($url)" "develop: not pushed" ;;
  esac
}

ensure_upstream() {
  if ! git remote get-url upstream >/dev/null 2>&1; then
    git remote add upstream https://github.com/stablyai/orca.git
  fi
}

# 冲突现场提交成一个带两个父提交的合并对象，再退出合并，避免本地 develop 停在冲突中间。
publish_conflict() {
  local files tree parent commit
  files="$(git diff --name-only --diff-filter=U || true)"
  git add -u
  tree="$(git write-tree)"
  parent="$(git rev-parse HEAD)"
  commit="$(
    git commit-tree "$tree" -p "$parent" -p "$UPSTREAM_SHA" -m "$(
      cat <<EOF
sync: merge of upstream stopped with conflict markers

Upstream: ${UPSTREAM_SHA}
Conflicted files:
${files}

Modify/delete conflicts have no markers; check each listed file against both parents.

Resolve the markers on this branch, then open a PR against develop.
EOF
    )"
  )"
  git merge --abort
  push_attempt_commit "$commit"
  summary \
    "daily-sync: FAILED" \
    "reason: merge conflict" \
    "upstream: ${UPSTREAM_SHA}" \
    "develop: not pushed (${ORIGIN_DEVELOP})" \
    "attempt: ${ATTEMPT_BRANCH} (${ATTEMPT_SHA})" \
    "files:" \
    "${files}"
  exit 1
}

# 从 tip 沿第一父提交走回 base（ORIGIN_DEVELOP），每个提交输出一行：树，和第一父以外的父提交（合并进来的上游）。
# 走不回 base 时失败。提交 SHA 和时间戳不进结果，所以重跑生成的合并和 pin 提交能和上次比对。
attempt_shape() {
  local current="$1"
  local base="$2"
  local steps=0 parents
  while [[ "$current" != "$base" ]]; do
    [[ "$steps" -lt 20 ]] || return 1
    parents="$(git rev-parse "${current}^@")" || return 1
    [[ -n "$parents" ]] || return 1
    printf '%s %s\n' "$(git rev-parse "${current}^{tree}")" "$(printf '%s\n' "$parents" | sed 1d | tr '\n' ' ')"
    current="$(printf '%s\n' "$parents" | sed -n 1p)"
    steps=$((steps + 1))
  done
}

# 远端 attempt 分支已经是这次要推的结果时返回 0，并把远端提交写进 ATTEMPT_SHA。
# 同一个提交直接命中。否则从 ORIGIN_DEVELOP 起逐个比较：提交数、每个提交的树、合并进来的上游父提交都相同才算。
# 检查失败后重跑时，合并和 pin 提交每次 SHA 都不同，但结构一样，可以复用。
# 分支上多了手工提交（哪怕树没变）时提交数不同，不复用，改开 -n；手工提交不会被覆盖。
attempt_matches() {
  local branch="$1"
  local commit="$2"
  local remote remote_shape commit_shape
  remote="$(git ls-remote origin "refs/heads/${branch}" 2>/dev/null | awk 'NR == 1 { print $1 }')" || return 1
  [[ -n "$remote" ]] || return 1
  if [[ "$remote" != "$commit" ]]; then
    [[ -n "${ORIGIN_DEVELOP:-}" ]] || return 1
    git fetch -q --no-tags origin "refs/heads/${branch}" 2>/dev/null || return 1
    remote="$(git rev-parse -q --verify FETCH_HEAD)" || return 1
    [[ "$(git rev-parse "${remote}^{tree}")" == "$(git rev-parse "${commit}^{tree}")" ]] || return 1
    remote_shape="$(attempt_shape "$remote" "$ORIGIN_DEVELOP")" || return 1
    commit_shape="$(attempt_shape "$commit" "$ORIGIN_DEVELOP")" || return 1
    [[ -n "$commit_shape" && "$remote_shape" == "$commit_shape" ]] || return 1
  fi
  ATTEMPT_SHA="$remote"
}

push_attempt_commit() {
  local commit="$1"
  local base="$ATTEMPT_BRANCH"
  local n=2
  ATTEMPT_SHA="$commit"
  # attempt 分支永远不强推。当天已有同名分支（可能带着手工解法）时，改用 -2、-3 … 后缀。
  # 已有分支正好是同一次尝试时直接复用，不再多开一个 -n。
  while git ls-remote --exit-code origin "refs/heads/${ATTEMPT_BRANCH}" >/dev/null 2>&1; do
    if attempt_matches "$ATTEMPT_BRANCH" "$commit"; then
      echo "daily-sync: ${ATTEMPT_BRANCH} already holds this attempt (${ATTEMPT_SHA}); not pushing again"
      return 0
    fi
    ATTEMPT_BRANCH="${base}-${n}"
    n=$((n + 1))
  done
  require_commit_identity "$commit"
  if ! git push origin "${commit}:refs/heads/${ATTEMPT_BRANCH}"; then
    die "daily-sync: FAILED" "reason: could not push ${ATTEMPT_BRANCH}" "commit: ${commit}" "develop: not pushed (${ORIGIN_DEVELOP})"
  fi
}

# 检查失败时推送已经合并的 HEAD。origin/develop 不动。
fail_checks() {
  local reason="$1"
  local head
  head="$(git rev-parse HEAD)"
  if [[ "$PUSH_ATTEMPT" == 1 && "$head" != "$ORIGIN_DEVELOP" ]]; then
    push_attempt_commit "$head"
    summary \
      "daily-sync: FAILED" \
      "reason: ${reason}" \
      "upstream: ${UPSTREAM_SHA}" \
      "develop: not pushed (${ORIGIN_DEVELOP})" \
      "attempt: ${ATTEMPT_BRANCH} (${ATTEMPT_SHA})"
  else
    summary \
      "daily-sync: FAILED" \
      "reason: ${reason}" \
      "upstream: ${UPSTREAM_SHA}" \
      "develop: not pushed (${ORIGIN_DEVELOP})" \
      "attempt: none"
  fi
  exit 1
}

run_check() {
  local name="$1"
  shift
  echo "daily-sync: ${name}"
  if ! "$@"; then
    fail_checks "${name} failed"
  fi
}

require_fork_origin
if [[ -n "$(git status --porcelain)" ]]; then
  die "daily-sync: FAILED" "reason: worktree is dirty" "develop: not pushed"
fi

ensure_upstream
git config rerere.enabled true
# .gitattributes 让 RPC 目录按 merge=ours 留 fork 一侧，合并后在下面重新生成。
git config merge.ours.driver true

git fetch --no-tags origin refs/heads/develop:refs/remotes/origin/develop
git fetch --no-tags upstream main
ORIGIN_DEVELOP="$(git rev-parse origin/develop)"
UPSTREAM_SHA="$(git rev-parse upstream/main)"

git checkout -B develop origin/develop

if git merge-base --is-ancestor "$UPSTREAM_SHA" HEAD; then
  echo "daily-sync: develop already contains upstream/main"
else
  count="$(git rev-list --count "HEAD..${UPSTREAM_SHA}")"
  if ! HUSKY=0 git merge --no-ff --no-edit -m "Merge upstream main through ${UPSTREAM_SHA:0:10} (${count} commits)" "$UPSTREAM_SHA"; then
    if git rev-parse -q --verify MERGE_HEAD >/dev/null; then
      publish_conflict
    fi
    die "daily-sync: FAILED" "reason: merge failed" "upstream: ${UPSTREAM_SHA}" "develop: not pushed (${ORIGIN_DEVELOP})"
  fi
  PUSH_ATTEMPT=1
fi

# 先把本地上游指针拨到本次 main。pin 脚本优先读这个本地引用，不会退回旧的 origin/fork/base-upstream。
# 不推送 fork/base-upstream。
git branch -f fork/base-upstream "$UPSTREAM_SHA"
node fork/scripts/sync-skills-source-commit.mjs
if ! git diff --quiet -- src/fork/skills-source-commit.ts; then
  git add -- src/fork/skills-source-commit.ts
  HUSKY=0 git commit -m "$(cat <<'EOF'
fix(fork): pin skill installs to the upstream base

EOF
)"
  PUSH_ATTEMPT=1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  fail_checks "pin script left extra changes"
fi

run_check "company-info" bash fork/scripts/verify/check-no-internal-refs.sh
run_check "install" pnpm install --frozen-lockfile
# 新的上游基点（pin）改变审计表；PR 带进来的旧表也在这里修好。生成器需要 node_modules 里的 oxfmt。
run_check "audit table" python3 fork/scripts/generate-audit.py
if ! git diff --quiet -- docs/fork/AUDIT.md; then
  git add -- docs/fork/AUDIT.md
  HUSKY=0 git commit -m "$(cat <<'EOF'
docs(fork): regenerate the audit table

EOF
)"
  PUSH_ATTEMPT=1
fi
# RPC 目录是生成文件，fork 和上游都会加方法。合并时留 fork 一侧（不会冲突），这里按合并后的源码重新生成。
run_check "rpc catalog regenerate" pnpm run generate:rpc-params-catalog
if ! git diff --quiet -- src/shared/rpc-contract/rpc-params-catalog.generated.ts; then
  git add -- src/shared/rpc-contract/rpc-params-catalog.generated.ts
  HUSKY=0 git commit -m "fix(fork): regenerate the RPC params catalog"
  PUSH_ATTEMPT=1
fi
run_check "lint" pnpm exec oxlint
run_check "rpc catalog" pnpm run verify:rpc-params-catalog
run_check "skill guides" pnpm run verify:bundled-skill-guides
run_check "skill manifest" pnpm run verify:skill-bundle-manifest
run_check "localization catalog" pnpm run verify:localization-runtime-catalog
run_check "fork tests" node config/scripts/test-runtime/execution-policy/run-vitest.mjs run --config config/vitest.config.ts --maxWorkers=2 src/fork src/shared/fork-hooks
run_check "typecheck" pnpm tc

echo "daily-sync: linux orcad template"
slot="$(node config/scripts/orcad-distribution/prebuilds/build-orcad-prebuilds.mjs --print-slot)"
case "$slot" in
  linux-*) ;;
  *) fail_checks "orcad host slot is ${slot}; this check runs on Linux" ;;
esac
run_check "orcad prebuild" pnpm build:orcad-prebuilds
run_check "orcad require slot" pnpm build:orcad-prebuilds --require-slots "$slot"
run_check "orcad smoke" pnpm build:orcad-prebuilds --smoke
# 上游打包 orcad 时会装入手机页面。mobile 是独立锁文件，根安装不会带上它。
run_check "mobile install" pnpm install --frozen-lockfile --dir mobile
run_check "mobile web" pnpm build:mobile-web
template_targets="$slot"
# 跨架构槽由家里的 Mac 打包。云端默认只编当前 Linux 槽并打进模板。
if [[ "${ORCA_SYNC_DOCKER_SLOTS:-}" == 1 ]]; then
  run_check "orcad linux slots" bash fork/scripts/build-orcad-linux-prebuilds.sh
  template_targets="linux-x64-glibc,linux-arm64-glibc"
fi
run_check "orcad template" node config/scripts/orcad-distribution/template/build-orcad-template.mjs --targets "$template_targets"
node --input-type=commonjs -e '
  const { readFileSync } = require("node:fs")
  const manifest = JSON.parse(readFileSync("out/orcad-template/orcad-template.json", "utf8"))
  const names = manifest.targets ?? {}
  const required = process.argv[1].split(",")
  const missing = required.filter((name) => !Object.hasOwn(names, name))
  if (missing.length > 0) {
    console.error(`orcad template missing ${missing.join(", ")}`)
    process.exit(1)
  }
' "$template_targets" || fail_checks "orcad template manifest"

head="$(git rev-parse HEAD)"
if [[ "$head" == "$ORIGIN_DEVELOP" ]]; then
  summary \
    "daily-sync: OK" \
    "upstream: ${UPSTREAM_SHA}" \
    "develop: ${head} (unchanged)"
  exit 0
fi

# 普通推送：develop 只会快进。别人先推了新提交时推送被拒，develop 不会被覆盖，合并结果改推到 attempt 分支。
require_commit_identity HEAD
if ! git push origin "HEAD:refs/heads/develop"; then
  PUSH_ATTEMPT=1
  fail_checks "develop push rejected (develop moved since ${ORIGIN_DEVELOP})"
fi
summary \
  "daily-sync: OK" \
  "upstream: ${UPSTREAM_SHA}" \
  "develop: ${head}"
