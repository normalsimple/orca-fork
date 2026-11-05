#!/bin/bash
# Linux orcad slots for a Mac package. Images and the compile/smoke commands match
# linux_glibc_floor and linux_glibc217_compat in .github/workflows/node-server-tests.yml.
# The host fetches the pinned Node. The container only compiles and smokes.
# Do not pnpm install here: that would replace the Mac node_modules.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly REPO_ROOT
cd "$REPO_ROOT"

# Digests are the workflow image lines. packaging.fork.test.ts compares them.
readonly IMAGE_LINUX_X64_GLIBC='quay.io/pypa/manylinux_2_28_x86_64@sha256:407f771c51a2c3e83ebe5a7970b4289ead3a6db21d9b9c089168775cad11d328'
readonly IMAGE_LINUX_ARM64_GLIBC='quay.io/pypa/manylinux_2_28_aarch64@sha256:c22ffd129ac99a8a42d1f2c2f4e88a9089288dd9ee987a7092da1c7dc48f27a9'
readonly IMAGE_LINUX_X64_GLIBC217='quay.io/pypa/manylinux2014_x86_64@sha256:6f74cabeac2432570aa4bfdb29f7c1f30313d4d6654d764c44e574b6ffdd4ed5'

# 家里的 Mac 把缓存放在仓库外（~/Projects/orca-verify/node-runtime-cache），避免 git clean 删掉。
# 容器只挂仓库。仓库外的缓存要另外挂到 /node-runtime-cache，并改写 Node 路径。
# pwd -P 消掉 ..、重复斜杠和符号链接，避免把仓库外的目录当成 /work 里的路径。
physical_dir() {
  mkdir -p -- "$1"
  (cd -- "$1" && pwd -P)
}

physical_file() {
  local dir base resolved
  dir="$(dirname -- "$1")"
  base="$(basename -- "$1")"
  # 目录不存在就失败。错误路径不要先 mkdir 出空目录。
  resolved="$(cd -- "$dir" && pwd -P)" || return 1
  printf '%s/%s\n' "$resolved" "$base"
}

cache_dir="${ORCA_NODE_RUNTIME_CACHE_DIR:-${REPO_ROOT}/out/node-runtime-cache}"
cache_dir="$(physical_dir "$cache_dir")"

# 把宿主机上的 pinned Node 改写成容器里的路径。--print-container-node 只给测试用。
translate_runtime_path() {
  local runtime
  runtime="$(physical_file "$1")"
  case "$runtime" in
    "$REPO_ROOT"/*)
      printf '%s\n' "/work/${runtime#"$REPO_ROOT"/}"
      ;;
    "$cache_dir"/*)
      printf '%s\n' "/node-runtime-cache/${runtime#"$cache_dir"/}"
      ;;
    *)
      echo "pinned Node is outside the workspace and the runtime cache: ${runtime}" >&2
      return 1
      ;;
  esac
}

# 缓存目录本身在容器里的位置。仓库内走 /work，仓库外走单独挂载。
container_cache_path() {
  case "$cache_dir" in
    "$REPO_ROOT"/*)
      printf '%s\n' "/work/${cache_dir#"$REPO_ROOT"/}"
      ;;
    "$REPO_ROOT")
      printf '%s\n' "/work"
      ;;
    *)
      printf '%s\n' "/node-runtime-cache"
      ;;
  esac
}

# 容器只挂仓库。pnpm 的全局依赖存储会把 node-pty 链到仓库外，容器里就解析不到。
# 编译前在宿主机上确认 node-pty 和它的依赖实际都在仓库里。
check_node_pty_in_repo() {
  local outside
  if ! outside="$(node --input-type=commonjs -e '
    const { realpathSync } = require("fs")
    const { dirname, join } = require("path")
    const root = process.argv[1]
    const from = join(root, "config", "scripts")
    const locate = (name, base) => {
      try {
        return realpathSync(require.resolve(`${name}/package.json`, { paths: [base] }))
      } catch {
        console.error(`解析不到 ${name}。先在仓库里 pnpm install --frozen-lockfile。`)
        process.exit(1)
      }
    }
    const pkg = locate("node-pty", from)
    const deps = Object.keys(require(pkg).dependencies || {})
    const paths = [pkg, ...deps.map((dep) => locate(dep, dirname(pkg)))]
    process.stdout.write(paths.filter((p) => !p.startsWith(`${root}/`)).join("\n"))
  ' "$REPO_ROOT")"; then
    return 1
  fi
  if [[ -n "$outside" ]]; then
    printf '%s\n' 'node-pty 不在仓库里，容器只挂载仓库，编译会失败：' "$outside" >&2
    echo '请用 ORCA_PNPM_GLOBAL_VIRTUAL_STORE=0 重新 pnpm install --frozen-lockfile。' >&2
    return 1
  fi
}

run_slot() {
  local slot="$1"
  local platform="$2"
  local image="$3"
  local floor_tools="$4"
  local unset_smoke_libs="$5"
  if [[ "${FAST:-false}" == true ]] && node config/scripts/orcad-distribution/prebuilds/build-orcad-prebuilds.mjs --require-slots "$slot"; then
    echo "已有 ${slot}，快速安装跳过。"
    return
  fi
  local runtime container_node container_cache
  runtime="$(node config/scripts/orcad-distribution/prebuilds/build-orcad-prebuilds.mjs --slot="$slot" --print-runtime)"
  container_node="$(translate_runtime_path "$runtime")"
  container_cache="$(container_cache_path)"
  # macOS 自带 bash 3.2。set -u 时不能展开空数组，可选的 docker 参数放在 $@。
  # --mount 的 source= 不会把路径里的冒号当成分隔符。
  if [[ "$container_cache" == /node-runtime-cache ]]; then
    set -- \
      --mount "type=bind,source=${cache_dir},target=/node-runtime-cache" \
      -e ORCA_NODE_RUNTIME_CACHE_DIR=/node-runtime-cache
  elif [[ "$container_cache" != /work/out/node-runtime-cache ]]; then
    set -- -e "ORCA_NODE_RUNTIME_CACHE_DIR=${container_cache}"
  else
    set --
  fi
  echo "正在用上游镜像编译 ${slot}（${platform}）。"
  docker run --rm --init -i --platform "$platform" \
    -e ORCA_BACKGROUND_LAUNCH=1 \
    -e COMPAT_NODE="$container_node" \
    -e ORCAD_SLOT="$slot" \
    -e FLOOR_TOOLS="$floor_tools" \
    -e UNSET_SMOKE_LIBS="$unset_smoke_libs" \
    -e HOST_UID="$(id -u)" \
    -e HOST_GID="$(id -g)" \
    -e CC=gcc \
    -e CXX=g++ \
    -e PYTHON=/opt/python/cp312-cp312/bin/python3 \
    "$@" \
    --mount "type=bind,source=${REPO_ROOT},target=/work" \
    -w /work \
    "$image" bash -s <<'SLOT'
set -eu
if [ "$FLOOR_TOOLS" = 1 ]; then
  missing_tool=false
  for tool in git ps unzip which xz; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      missing_tool=true
    fi
  done
  if [ "$missing_tool" = true ]; then
    dnf --disablerepo='epel*' install -y git procps-ng unzip which xz
  fi
fi
export PATH="$(dirname "$COMPAT_NODE"):$PATH"
node config/scripts/orcad-distribution/prebuilds/build-orcad-prebuilds.mjs --slot="$ORCAD_SLOT"
node config/scripts/orcad-distribution/prebuilds/build-orcad-prebuilds.mjs --require-slots "$ORCAD_SLOT"
if [ "$UNSET_SMOKE_LIBS" = 1 ]; then
  # The image's devtoolset LD_LIBRARY_PATH must not stand in for a host C++ runtime.
  env -u LD_LIBRARY_PATH node config/scripts/orcad-distribution/prebuilds/build-orcad-prebuilds.mjs --slot="$ORCAD_SLOT" --smoke
else
  node config/scripts/orcad-distribution/prebuilds/build-orcad-prebuilds.mjs --slot="$ORCAD_SLOT" --smoke
fi
for dir in out/orcad-prebuilds out/orcad-prebuild-work out/node-runtime-cache; do
  if [ -d "$dir" ]; then
    chown -R "$HOST_UID:$HOST_GID" "$dir"
  fi
done
# 只交回容器里 root 新建的文件。宿主机事先放进缓存的 Node 包不要整棵改所有者。
if [ -n "${ORCA_NODE_RUNTIME_CACHE_DIR:-}" ] && [ -d "$ORCA_NODE_RUNTIME_CACHE_DIR" ]; then
  find "$ORCA_NODE_RUNTIME_CACHE_DIR" -uid 0 -exec chown -h "$HOST_UID:$HOST_GID" {} +
fi
SLOT
}

if [[ "${1:-}" == --print-container-node ]]; then
  translate_runtime_path "${2:?missing runtime path}"
  exit 0
fi
if [[ "${1:-}" == --print-container-cache ]]; then
  container_cache_path
  exit 0
fi
if [[ "${1:-}" == --check-node-pty ]]; then
  check_node_pty_in_repo
  exit 0
fi

# launchd 没有登录 shell 的 PATH。OrbStack 的 docker 在应用包的 xbin，不一定有 ~/.orbstack/bin。
if ! command -v docker >/dev/null 2>&1; then
  for dir in /opt/homebrew/bin /usr/local/bin "${HOME:-}/.orbstack/bin" /Applications/OrbStack.app/Contents/MacOS/xbin; do
    if [[ -x "${dir}/docker" ]]; then
      export PATH="${dir}:${PATH}"
      break
    fi
  done
fi
if ! command -v docker >/dev/null 2>&1; then
  echo '未找到 docker 可执行文件。Linux SSH 槽需要本机 Docker 运行上游的 manylinux 镜像。' >&2
  exit 1
fi
docker_err=""
if ! docker_err="$(docker info 2>&1 >/dev/null)"; then
  echo 'Docker 不可用。Linux SSH 槽需要本机 Docker 运行上游的 manylinux 镜像。' >&2
  if [[ -n "$docker_err" ]]; then
    printf '%s\n' "$docker_err" >&2
  fi
  exit 1
fi

check_node_pty_in_repo
run_slot linux-x64-glibc linux/amd64 "$IMAGE_LINUX_X64_GLIBC" 1 0
run_slot linux-arm64-glibc linux/arm64 "$IMAGE_LINUX_ARM64_GLIBC" 1 0
run_slot linux-x64-glibc217 linux/amd64 "$IMAGE_LINUX_X64_GLIBC217" 0 1
