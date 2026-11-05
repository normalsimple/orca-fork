#!/usr/bin/env bash
# Fast-forward a checkout, then push that branch to a GitHub remote.
# Run on the checkout host, or from another machine which ssh's there.
# --dry-run prints the push and does not update the remote.
# Before pushing it checks docs/fork/AUDIT.md against the generator, runs the fork tests, fetches
# upstream main and runs fork/scripts/verify/check-commit-identity.sh on the branch. The checkout
# needs node_modules (pnpm install) for the tests.
# Example:
#   PUSH_GITHUB_HOST=build-host \
#   PUSH_GITHUB_REPO=/srv/wt/project \
#   PUSH_GITHUB_URL=git@github.com:example/orca.git \
#   PUSH_GITHUB_BRANCH=your-branch \
#   fork/push_github.sh --dry-run
set -euo pipefail

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "缺少 ${name}。需要 PUSH_GITHUB_HOST、PUSH_GITHUB_REPO、PUSH_GITHUB_URL、PUSH_GITHUB_BRANCH。" >&2
    exit 2
  fi
}

require_env PUSH_GITHUB_HOST
require_env PUSH_GITHUB_REPO
require_env PUSH_GITHUB_URL
require_env PUSH_GITHUB_BRANCH

readonly REMOTE_HOST="$PUSH_GITHUB_HOST"
readonly REPO="$PUSH_GITHUB_REPO"
readonly GITHUB_URL="$PUSH_GITHUB_URL"
readonly BRANCH="$PUSH_GITHUB_BRANCH"

DRY_RUN=false
if [[ "${1:-}" == '--dry-run' ]]; then
  DRY_RUN=true
  shift
fi
if [[ $# -gt 0 ]]; then
  echo "未知参数: $*" >&2
  exit 2
fi

host_label() {
  printf '%s %s' "$(uname -s)" "$(hostname -s 2>/dev/null || hostname)"
}

on_checkout_host() {
  [[ -d "${REPO}/.git" ]]
}

if ! on_checkout_host; then
  echo "host=$(host_label) → ssh ${REMOTE_HOST} 上执行 push"
  remote_env="$(printf 'PUSH_GITHUB_HOST=%q PUSH_GITHUB_REPO=%q PUSH_GITHUB_URL=%q PUSH_GITHUB_BRANCH=%q' \
    "$REMOTE_HOST" "$REPO" "$GITHUB_URL" "$BRANCH")"
  if [[ "$DRY_RUN" == true ]]; then
    exec ssh -o BatchMode=yes -o ConnectTimeout=15 "$REMOTE_HOST" \
      "export ${remote_env}; bash -s -- --dry-run" <"$0"
  fi
  exec ssh -o BatchMode=yes -o ConnectTimeout=15 "$REMOTE_HOST" "export ${remote_env}; bash -s" <"$0"
fi

echo "host=$(host_label) repo=${REPO}"
cd "$REPO"
export GIT_TERMINAL_PROMPT=0

current="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$current" != "$BRANCH" ]]; then
  echo "当前分支是 ${current}，需要 ${BRANCH}" >&2
  exit 1
fi

before="$(git rev-parse HEAD)"
git fetch -q origin "$BRANCH"
git merge --ff-only -q "origin/${BRANCH}"
local_sha="$(git rev-parse "$BRANCH")"
if [[ "$before" != "$local_sha" ]]; then
  echo "pulled:${before}..${local_sha}"
fi
github_sha="$(git ls-remote "$GITHUB_URL" "refs/heads/${BRANCH}" | awk '{print $1}')"
echo "local:${local_sha}"
echo "github:${github_sha:-<missing>}"

if [[ -n "$github_sha" && "$local_sha" == "$github_sha" ]]; then
  echo "GitHub ${BRANCH} 已是 ${local_sha}，跳过 push"
  exit 0
fi

# 推送前：审计表和 fork 测试（含审计表测试）必须通过，旧的审计表不能进 develop。
if ! python3 fork/scripts/generate-audit.py --check; then
  echo "docs/fork/AUDIT.md 已过期：运行 python3 fork/scripts/generate-audit.py 并提交，不推送" >&2
  exit 1
fi
if ! ORCA_BACKGROUND_LAUNCH=1 node config/scripts/test-runtime/execution-policy/run-vitest.mjs run --config config/vitest.config.ts \
  --maxWorkers=2 src/fork src/shared/fork-hooks; then
  echo "fork 测试失败，不推送" >&2
  exit 1
fi

# 推送前：upstream/main 和身份下限（脚本里写死的 8fd7c96acc）之后的每个提交（含合并提交）作者和提交者都必须是 quzard 的 noreply 身份。
# 用仓库里的检查脚本；没有它或没有 upstream/main 都直接失败。
identity_check="fork/scripts/verify/check-commit-identity.sh"
if [[ ! -f "$identity_check" ]]; then
  echo "缺少 ${identity_check}，不推送" >&2
  exit 1
fi
# 先拉最新的上游 main，否则已合进来的上游提交会被当成 fork 提交。拉取失败就不推送。
bash fork/scripts/verify/fetch-upstream-main.sh
bash "$identity_check" "$BRANCH"

push_args=(push)
if [[ "$DRY_RUN" == true ]]; then
  echo "dry-run push ${BRANCH} -> ${GITHUB_URL}"
  push_args+=(--dry-run)
else
  echo "push ${BRANCH} -> ${GITHUB_URL}"
fi
push_args+=("$GITHUB_URL" "${BRANCH}:${BRANCH}")
git "${push_args[@]}"
