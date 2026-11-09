#!/bin/bash
# 把 quzard/orca-fork 的 mac 预发布分成两段上传。
# electron-updater 会把 latest-mac.yml 里 files 列出的每一个文件当成 release 资产，
# 缺一个就整次下载失败。
# MacUpdater 真正下载的是 zip；差分还要同名的 zip.blockmap。dmg 只给手动安装。
# 因此公开时的 latest-mac.yml 只写 zip。dmg 在 release 已经公开之后再补。
# 用法: publish-mac-release.sh --dist DIR --sha SHA
# stdout 只有 release= / version= / error= 三行。进度在 stderr。
set -euo pipefail

readonly GH_REPO="quzard/orca-fork"
readonly CHANNEL_FILE="latest-mac.yml"
readonly EXIT_DMG_PENDING=20
readonly RELEASE_COMPLETE="published"
readonly RELEASE_DMG_PENDING="published-dmg-pending"

RELEASE="failed"
VERSION=""
ERROR=""
FINISHED=0
WORKDIR=""
HAVE_RELEASE=0
IS_DRAFT=0
TAG=""
SHA_ARG=""
DIST=""
ASSET_TSV=""
MANIFEST_PY=""
FILTERED_YML=""
UPDATER_FILES=()
DEFERRED_FILES=()
MISSING_DEFERRED=()

finish() {
  local code="$1"
  FINISHED=1
  printf 'release=%s\n' "$RELEASE"
  printf 'version=%s\n' "$VERSION"
  printf 'error=%s\n' "$ERROR"
  exit "$code"
}

cleanup() {
  local code=$?
  if [[ -n "$WORKDIR" && -d "$WORKDIR" ]]; then
    rm -rf "$WORKDIR"
  fi
  if [[ "$FINISHED" != 1 ]]; then
    printf 'release=%s\n' "${RELEASE:-failed}"
    printf 'version=%s\n' "$VERSION"
    printf 'error=%s\n' "${ERROR:-publish failed}"
  fi
  exit "$code"
}
trap cleanup EXIT

# gh 的报错原样转发。出现令牌样式时改成一句固定说明，避免写进 launchd 日志。
note_gh_failure() {
  local errfile="$1"
  if grep -E -q 'ghp_|github_pat_|gho_' "$errfile"; then
    printf 'publish-mac-release: gh failed (details omitted)\n' >&2
    printf '%s\n' token-redacted
    return 0
  fi
  if grep -E -q -i 'not found|HTTP 404' "$errfile"; then
    printf '%s\n' not-found
    return 0
  fi
  cat "$errfile" >&2
  printf '%s\n' error
}

run_gh() {
  local outfile="$1"
  shift
  local errfile class
  errfile="$(mktemp "${TMPDIR:-/tmp}/orca-gh-err.XXXXXX")"
  command gh "$@" >"$outfile" 2>"$errfile" && class=0 || class=$?
  if [[ "$class" -ne 0 ]]; then
    note_gh_failure "$errfile" >"${outfile}.errclass"
    rm -f "$errfile"
    return "$class"
  fi
  rm -f "$errfile" "${outfile}.errclass"
  return 0
}

file_size() {
  python3 -c 'import os, sys; print(os.path.getsize(sys.argv[1]))' "$1"
}

write_manifest_tool() {
  cat >"$MANIFEST_PY" <<'PY'
# 只解析 electron-builder 写出的 latest-mac.yml，不依赖 PyYAML。
import os
import sys


def unquote(value):
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        body = value[1:-1]
        if value[0] == "'":
            return body.replace("''", "'")
        return body
    return value


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def clean_name(value):
    text = unquote(value.strip())
    text = text.split("?", 1)[0]
    text = text.split("/")[-1]
    if text in ("", ".", "..") or text != os.path.basename(text):
        raise SystemExit("latest-mac.yml has an unsafe file name")
    return text


def parse_manifest(text):
    version = ""
    release_date = ""
    top_path = ""
    files = []
    current = None
    in_files = False
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        line = raw.strip()
        if indent == 0:
            current = None
            if line.startswith("version:"):
                in_files = False
                version = unquote(line.split(":", 1)[1].strip())
            elif line == "files:" or line.startswith("files:"):
                in_files = True
            elif line.startswith("path:"):
                in_files = False
                top_path = unquote(line.split(":", 1)[1].strip())
            elif line.startswith("releaseDate:"):
                in_files = False
                release_date = unquote(line.split(":", 1)[1].strip())
            else:
                in_files = False
            continue
        if not in_files:
            continue
        if line.startswith("- "):
            line = line[2:].strip()
            current = {}
            files.append(current)
        if current is None or ":" not in line:
            continue
        key, value = line.split(":", 1)
        current[key.strip()] = unquote(value.strip())
    return version, release_date, top_path, files


def entry_name(entry):
    raw = entry.get("url") or entry.get("path") or ""
    if not raw:
        return ""
    return clean_name(raw)


def referenced_names(top_path, files):
    names = []
    for entry in files:
        name = entry_name(entry)
        if name and name not in names:
            names.append(name)
    if top_path:
        name = clean_name(top_path)
        if name and name not in names:
            names.append(name)
    return names


def is_zip(name):
    return name.endswith(".zip")


def emit_filtered(path, version, release_date, chosen, zip_entries):
    lines = ["version: " + quote(version), "files:"]
    ordered_keys = ("url", "sha512", "size", "blockMapSize")
    for entry in zip_entries:
        keys = [key for key in ordered_keys if key in entry]
        for key in entry:
            if key not in keys and key != "path":
                keys.append(key)
        first = True
        for key in keys:
            value = entry[key]
            if key in ("size", "blockMapSize") and str(value).isdigit():
                rendered = str(value)
            else:
                rendered = quote(value)
            if first:
                lines.append("  - " + key + ": " + rendered)
                first = False
            else:
                lines.append("    " + key + ": " + rendered)
    lines.append("path: " + quote(entry_name(chosen)))
    sha = chosen.get("sha512") or ""
    if not sha:
        raise SystemExit("latest-mac.yml zip has no sha512")
    lines.append("sha512: " + quote(sha))
    if release_date:
        lines.append("releaseDate: " + quote(release_date))
    lines.append("")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines))


def split_manifest(yml_path, dist, filtered_path, plan_path):
    if not os.path.isfile(yml_path):
        raise SystemExit("dist/latest-mac.yml is missing")
    with open(yml_path, encoding="utf-8") as handle:
        version, release_date, top_path, files = parse_manifest(handle.read())
    if not version:
        raise SystemExit("latest-mac.yml has no version")
    zip_entries = []
    deferred = []
    missing = []
    seen = set()
    for entry in files:
        name = entry_name(entry)
        if not name or name in seen:
            continue
        seen.add(name)
        path = os.path.join(dist, name)
        if is_zip(name):
            if not os.path.isfile(path):
                raise SystemExit("release asset missing: " + name)
            block = path + ".blockmap"
            if not os.path.isfile(block):
                raise SystemExit("release asset missing: " + name + ".blockmap")
            copied = dict(entry)
            copied["url"] = name
            zip_entries.append(copied)
        else:
            if os.path.isfile(path):
                deferred.append(path)
            else:
                missing.append(name)
            # dmg 的 blockmap 不在 yml 里，但要和 dmg 一起补传。
            if name.endswith(".dmg") or os.path.isfile(path + ".blockmap"):
                block_name = name + ".blockmap"
                if os.path.isfile(path + ".blockmap"):
                    deferred.append(path + ".blockmap")
                elif name.endswith(".dmg"):
                    missing.append(block_name)
    if not zip_entries:
        raise SystemExit("latest-mac.yml has no zip")
    chosen = zip_entries[0]
    if top_path:
        top_name = clean_name(top_path)
        for entry in zip_entries:
            if entry_name(entry) == top_name:
                chosen = entry
                break
    emit_filtered(filtered_path, version, release_date, chosen, zip_entries)
    with open(plan_path, "w", encoding="utf-8") as handle:
        handle.write("version\t" + version + "\n")
        for entry in zip_entries:
            handle.write("updater\t" + os.path.join(dist, entry_name(entry)) + "\n")
            handle.write("updater\t" + os.path.join(dist, entry_name(entry)) + ".blockmap\n")
        for path in deferred:
            handle.write("defer\t" + path + "\n")
        for name in missing:
            handle.write("missing\t" + name + "\n")


def main():
    command = sys.argv[1]
    if command == "split":
        split_manifest(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
        return
    if command == "names":
        with open(sys.argv[2], encoding="utf-8") as handle:
            _, _, top_path, files = parse_manifest(handle.read())
        for name in referenced_names(top_path, files):
            print(name)
        return
    raise SystemExit("unknown manifest command")


if __name__ == "__main__":
    main()
PY
}

load_plan() {
  local kind path
  while IFS="$(printf '\t')" read -r kind path; do
    [[ -z "${kind:-}" ]] && continue
    case "$kind" in
      version) VERSION="$path" ;;
      updater) UPDATER_FILES+=("$path") ;;
      defer) DEFERRED_FILES+=("$path") ;;
      missing) MISSING_DEFERRED+=("$path") ;;
      *) ERROR="bad publish plan"; finish 1 ;;
    esac
  done <"$1"
  if [[ -z "$VERSION" || ${#UPDATER_FILES[@]} -eq 0 ]]; then
    ERROR="latest-mac.yml has no zip"
    finish 1
  fi
  TAG="v${VERSION}"
}

load_assets() {
  python3 - "$1" "$ASSET_TSV" <<'PY'
import json
import sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
draft = "1" if data.get("isDraft") else "0"
with open(sys.argv[2], "w", encoding="utf-8") as handle:
    handle.write("draft\t" + draft + "\n")
    for asset in data.get("assets") or []:
        name = asset.get("name") or ""
        if not name:
            continue
        size = asset.get("size")
        size_text = "" if size is None else str(size)
        state = asset.get("state") or ""
        handle.write("asset\t" + name + "\t" + size_text + "\t" + state + "\n")
PY
  local kind name size state
  : >"${ASSET_TSV}.body"
  while IFS="$(printf '\t')" read -r kind name size state; do
    if [[ "$kind" == draft ]]; then
      IS_DRAFT="$name"
    elif [[ "$kind" == asset ]]; then
      printf '%s\t%s\t%s\n' "$name" "$size" "$state" >>"${ASSET_TSV}.body"
    fi
  done <"$ASSET_TSV"
  mv "${ASSET_TSV}.body" "$ASSET_TSV"
}

asset_row() {
  awk -F '\t' -v name="$1" 'BEGIN { OFS="\t" } $1 == name { print; found = 1; exit } END { if (!found) exit 1 }' "$ASSET_TSV"
}

remember_asset() {
  local name="$1" size="$2" tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/orca-assets.XXXXXX")"
  awk -F '\t' -v name="$name" 'BEGIN { OFS="\t" } $1 != name { print }' "$ASSET_TSV" >"$tmp"
  printf '%s\t%s\tuploaded\n' "$name" "$size" >>"$tmp"
  mv "$tmp" "$ASSET_TSV"
}

forget_asset() {
  local name="$1" tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/orca-assets.XXXXXX")"
  awk -F '\t' -v name="$name" 'BEGIN { OFS="\t" } $1 != name { print }' "$ASSET_TSV" >"$tmp"
  mv "$tmp" "$ASSET_TSV"
}

# missing: 远端没有。replace: 有，但大小或状态对不上，需要 --clobber。ready: 不用再传。
upload_mode() {
  local name="$1" size="$2" row remote state
  if ! row="$(asset_row "$name")"; then
    printf '%s\n' missing
    return 0
  fi
  remote="$(printf '%s\n' "$row" | awk -F '\t' '{ print $2 }')"
  state="$(printf '%s\n' "$row" | awk -F '\t' '{ print $3 }')"
  if [[ -n "$state" && "$state" != uploaded ]]; then
    printf '%s\n' replace
    return 0
  fi
  if [[ -n "$remote" && "$remote" != "$size" ]]; then
    printf '%s\n' replace
    return 0
  fi
  printf '%s\n' ready
}

asset_present() {
  local name="$1" row state remote
  if ! row="$(asset_row "$name")"; then
    return 1
  fi
  remote="$(printf '%s\n' "$row" | awk -F '\t' '{ print $2 }')"
  state="$(printf '%s\n' "$row" | awk -F '\t' '{ print $3 }')"
  if [[ -n "$state" && "$state" != uploaded ]]; then
    return 1
  fi
  if [[ -z "$remote" || "$remote" == 0 ]]; then
    return 1
  fi
  return 0
}

# force: 不管远端那份是否完整都重传（有就 --clobber），用于盖掉不安全的 latest-mac.yml。
upload_one() {
  local file="$1" force="${2:-}" name size mode outfile
  name="$(basename "$file")"
  size="$(file_size "$file")"
  if [[ "$force" != force ]]; then
    mode="$(upload_mode "$name" "$size")"
  elif asset_row "$name" >/dev/null 2>&1; then
    mode=replace
  else
    mode=missing
  fi
  if [[ "$mode" == ready ]]; then
    printf 'publish-mac-release: keep %s\n' "$name" >&2
    return 0
  fi
  printf 'publish-mac-release: upload %s\n' "$name" >&2
  outfile="$(mktemp "${TMPDIR:-/tmp}/orca-gh-out.XXXXXX")"
  if [[ "$mode" == replace ]]; then
    # --clobber 会先删掉同名资产。只在远端那份不可用时才替换。
    if ! run_gh "$outfile" release upload "$TAG" --repo "$GH_REPO" --clobber "$file"; then
      forget_asset "$name"
      rm -f "$outfile" "${outfile}.errclass"
      fail_upload "$name"
    fi
  else
    if ! run_gh "$outfile" release upload "$TAG" --repo "$GH_REPO" "$file"; then
      rm -f "$outfile" "${outfile}.errclass"
      fail_upload "$name"
    fi
  fi
  rm -f "$outfile" "${outfile}.errclass"
  remember_asset "$name" "$size"
}

fail_upload() {
  local name="$1"
  if [[ "$IS_DRAFT" == 1 ]]; then
    ERROR="gh release upload failed: ${name}"
    RELEASE="failed"
    finish 1
  fi
  ERROR="published, dmg pending: gh release upload failed: ${name}"
  RELEASE="$RELEASE_DMG_PENDING"
  printf 'publish-mac-release: %s\n' "$ERROR" >&2
  finish "$EXIT_DMG_PENDING"
}

# 公开之前再核对一次：清单里只能有 .zip，不能点到还没上传的 dmg。
assert_filtered_yml() {
  local name found=0
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    found=1
    case "$name" in
      *.zip) ;;
      *)
        ERROR="refusing to publish latest-mac.yml that names ${name}"
        finish 1
        ;;
    esac
  done < <(python3 "$MANIFEST_PY" names "$FILTERED_YML")
  if [[ "$found" != 1 ]]; then
    ERROR="filtered latest-mac.yml has no zip"
    finish 1
  fi
}

# force: 草稿或已公开但清单点到了未上传的文件时，盖成只含 zip 的 latest-mac.yml。
upload_filtered_yml() {
  assert_filtered_yml
  upload_one "$FILTERED_YML" "$1"
}

channel_is_unsafe() {
  local remote="$1" name found=0
  if [[ ! -f "$remote" ]]; then
    return 0
  fi
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    found=1
    # 已公开的清单不能点到还没上传的 dmg，否则 resolveFiles 会让更新下载失败。
    if ! asset_present "$name"; then
      return 0
    fi
  done < <(python3 "$MANIFEST_PY" names "$remote")
  if [[ "$found" != 1 ]]; then
    return 0
  fi
  return 1
}

ensure_channel_yml() {
  local outfile remote
  if [[ "$IS_DRAFT" == 1 ]]; then
    # 草稿对外不可见。这里固定盖成只含 zip 的清单，再公开。
    upload_filtered_yml force
    return 0
  fi
  if ! asset_present "$CHANNEL_FILE"; then
    upload_filtered_yml once
    return 0
  fi
  remote="${WORKDIR}/remote/${CHANNEL_FILE}"
  mkdir -p "${WORKDIR}/remote"
  outfile="$(mktemp "${TMPDIR:-/tmp}/orca-gh-out.XXXXXX")"
  if ! run_gh "$outfile" release download "$TAG" --repo "$GH_REPO" --pattern "$CHANNEL_FILE" --dir "${WORKDIR}/remote" --clobber; then
    rm -f "$outfile" "${outfile}.errclass"
    # 下不到现有清单时，只要还有未完成的补传，就先换成只含 zip 的版本。
    if deferred_incomplete; then
      upload_filtered_yml force
    fi
    return 0
  fi
  rm -f "$outfile" "${outfile}.errclass"
  if channel_is_unsafe "$remote"; then
    upload_filtered_yml force
  else
    printf 'publish-mac-release: keep %s\n' "$CHANNEL_FILE" >&2
  fi
}

deferred_incomplete() {
  local path name
  if [[ ${#MISSING_DEFERRED[@]} -gt 0 ]]; then
    return 0
  fi
  if [[ ${#DEFERRED_FILES[@]} -eq 0 ]]; then
    return 1
  fi
  for path in "${DEFERRED_FILES[@]}"; do
    name="$(basename "$path")"
    if ! asset_present "$name"; then
      return 0
    fi
  done
  return 1
}

upload_many() {
  local path
  for path in "$@"; do
    upload_one "$path"
  done
}

create_release() {
  local outfile notes pin pin_file
  pin_file="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/src/fork/skills-source-commit.ts"
  pin="$(
    python3 - "$pin_file" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
match = re.search(r"FORK_SKILLS_SOURCE_COMMIT = '([0-9a-f]{40})'", text)
print(match.group(1) if match else "", end="")
PY
  )" || pin=""
  if [[ ! "$pin" =~ ^[0-9a-f]{40}$ ]]; then
    ERROR="upstream pin is missing"
    finish 1
  fi
  notes="Fork build ${VERSION} (${SHA_ARG})
Upstream ${pin}"
  printf 'publish-mac-release: create draft %s\n' "$TAG" >&2
  outfile="$(mktemp "${TMPDIR:-/tmp}/orca-gh-out.XXXXXX")"
  if ! run_gh "$outfile" release create "$TAG" --repo "$GH_REPO" --draft --prerelease --target "$SHA_ARG" --title "$TAG" --notes "$notes"; then
    rm -f "$outfile" "${outfile}.errclass"
    ERROR="gh release create failed"
    finish 1
  fi
  rm -f "$outfile" "${outfile}.errclass"
  HAVE_RELEASE=1
  IS_DRAFT=1
  : >"$ASSET_TSV"
}

publish_draft() {
  local outfile
  if [[ "$IS_DRAFT" != 1 ]]; then
    return 0
  fi
  assert_filtered_yml
  printf 'publish-mac-release: publish %s\n' "$TAG" >&2
  outfile="$(mktemp "${TMPDIR:-/tmp}/orca-gh-out.XXXXXX")"
  if ! run_gh "$outfile" release edit "$TAG" --repo "$GH_REPO" --draft=false --prerelease; then
    rm -f "$outfile" "${outfile}.errclass"
    ERROR="gh release edit failed"
    RELEASE="failed"
    finish 1
  fi
  rm -f "$outfile" "${outfile}.errclass"
  IS_DRAFT=0
}

pending_names() {
  local text="" name path
  if [[ ${#MISSING_DEFERRED[@]} -gt 0 ]]; then
    for name in "${MISSING_DEFERRED[@]}"; do
      if [[ -n "$text" ]]; then
        text="${text}, ${name}"
      else
        text="$name"
      fi
    done
  fi
  if [[ ${#DEFERRED_FILES[@]} -gt 0 ]]; then
    for path in "${DEFERRED_FILES[@]}"; do
      name="$(basename "$path")"
      if ! asset_present "$name"; then
        if [[ -n "$text" ]]; then
          text="${text}, ${name}"
        else
          text="$name"
        fi
      fi
    done
  fi
  printf '%s\n' "$text"
}

finish_pending() {
  local names
  names="$(pending_names)"
  if [[ -z "$names" ]]; then
    return 1
  fi
  ERROR="published, dmg pending: ${names}"
  RELEASE="$RELEASE_DMG_PENDING"
  printf 'publish-mac-release: %s\n' "$ERROR" >&2
  finish "$EXIT_DMG_PENDING"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dist)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        ERROR="missing --dist"
        finish 1
      fi
      DIST="$2"
      shift 2
      ;;
    --sha)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        ERROR="missing --sha"
        finish 1
      fi
      SHA_ARG="$2"
      shift 2
      ;;
    *)
      ERROR="unknown argument"
      finish 1
      ;;
  esac
done

if [[ -z "$DIST" || -z "$SHA_ARG" ]]; then
  ERROR="missing --dist or --sha"
  finish 1
fi
if [[ ! -f "${DIST}/${CHANNEL_FILE}" ]]; then
  ERROR="dist/latest-mac.yml is missing"
  finish 1
fi

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/orca-publish.XXXXXX")"
ASSET_TSV="${WORKDIR}/assets.tsv"
MANIFEST_PY="${WORKDIR}/manifest.py"
FILTERED_YML="${WORKDIR}/channel/${CHANNEL_FILE}"
mkdir -p "${WORKDIR}/channel" "${WORKDIR}/remote"
: >"$ASSET_TSV"
write_manifest_tool

plan_err="$(mktemp "${TMPDIR:-/tmp}/orca-plan-err.XXXXXX")"
if ! python3 "$MANIFEST_PY" split "${DIST}/${CHANNEL_FILE}" "$DIST" "$FILTERED_YML" "${WORKDIR}/plan" 2>"$plan_err"; then
  ERROR="$(head -n 1 "$plan_err")"
  rm -f "$plan_err"
  if [[ -z "$ERROR" ]]; then
    ERROR="latest-mac.yml is missing"
  fi
  finish 1
fi
rm -f "$plan_err"
load_plan "${WORKDIR}/plan"

view_out="$(mktemp "${TMPDIR:-/tmp}/orca-gh-out.XXXXXX")"
if run_gh "$view_out" release view "$TAG" --repo "$GH_REPO" --json isDraft,assets; then
  HAVE_RELEASE=1
  load_assets "$view_out"
else
  class="$(cat "${view_out}.errclass" 2>/dev/null || true)"
  rm -f "$view_out" "${view_out}.errclass"
  if [[ "$class" == not-found ]]; then
    HAVE_RELEASE=0
  else
    ERROR="gh release view failed"
    finish 1
  fi
fi
rm -f "$view_out" "${view_out}.errclass"

if [[ "$HAVE_RELEASE" != 1 ]]; then
  create_release
fi

upload_many "${UPDATER_FILES[@]}"
ensure_channel_yml
publish_draft

if [[ ${#DEFERRED_FILES[@]} -gt 0 ]]; then
  upload_many "${DEFERRED_FILES[@]}"
fi
if ! finish_pending; then
  RELEASE="$RELEASE_COMPLETE"
  ERROR=""
  printf 'publish-mac-release: complete\n' >&2
  finish 0
fi
