#!/usr/bin/env python3
"""docs/fork/AUDIT.md: one row for every file that differs from the pinned upstream base.

  python3 fork/scripts/generate-audit.py           rewrite docs/fork/AUDIT.md (formatted with oxfmt)
  python3 fork/scripts/generate-audit.py --check   exit 1 when the committed table is stale

The base is the upstream commit src/fork/skills-source-commit.ts pins; the daily sync moves it to
each merged upstream and reruns this script. The main table is `git diff --no-renames <base>`
against the working tree: every changed, added or deleted tracked file, upstream files included,
and nothing else. Rows get a generic reason from their diff unless REASONS has a note; HISTORY
lists files a past rework put back to upstream or deleted, and each must still not differ.
A note or history entry that no longer matches the tree is an error, so neither can go stale.
Needs git, python3 and the repo's node_modules (oxfmt).
"""
import collections
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TABLE = 'docs/fork/AUDIT.md'
PIN = 'src/fork/skills-source-commit.ts'
FORK_ROOT = re.compile(r'^(src/fork/|src/shared/fork-hooks/|fork/|docs/fork/|FORK-CHANGES\.md$)')

# Ordered: the first matching substring names the feature.
FEATURES = [
    ('antigravity-acp', 'F052 无 IPv6 的 Antigravity'),
    ('acp-launch-specs.ts', 'F052 无 IPv6 的 Antigravity'),
    ('ego-lite', 'F049 Cookie 导入'),
    ('cookie', 'F049 Cookie 导入'),
    ('browser-workspace-types', 'F049 Cookie 导入'),
    ('doc-preview-access', 'F051 文档预览免授权'),
    ('doc-preview-open-access', 'F051 文档预览免授权'),
    ('HtmlDocPreview', 'F051 文档预览免授权'),
    ('doc-preview-grant-ipc', 'F051 文档预览免授权'),
    ('doc-preview', 'F046 终端文件链接'),
    ('host-file', 'F046 终端文件链接'),
    ('csv-file-content', 'F046 终端文件链接'),
    ('runtime-file-range-client', 'F046 终端文件链接'),
    ('runtime-rpc-call-queue', 'F046 终端文件链接'),
    ('html-preview', 'F046 终端文件链接'),
    ('workspace-doc-address', 'F046 终端文件链接'),
    ('open-html-file-preview', 'F046 终端文件链接'),
    ('lib/file-preview.ts', 'F046 终端文件链接'),
    ('file-link', 'F046 终端文件链接'),
    ('disowned-host', 'F046 终端文件链接'),
    ('terminal-path-resolver', 'F046 终端文件链接'),
    ('terminal-file', 'F046 终端文件链接'),
    ('artifact', 'F046 终端文件链接'),
    ('file-command-host', 'F046 终端文件链接'),
    ('orca-runtime-files-test-harness', 'F046 终端文件链接'),
    ('covered-terminal', 'F050 聊天盖层画布'),
    ('RetainedPaneHost.tsx', 'F050 聊天盖层画布'),
    ('reconnect-tui', 'F010 SSH 重连重绘'),
    ('terminal-lifecycle', 'F010 SSH 重连重绘'),
    ('pty-connection/', 'F010 SSH 重连重绘'),
    ('src/fork/git-workspace/', 'F047 工作区仓库（已移除）'),
    ('src/fork/main/git-workspace/', 'F047 工作区仓库（已移除）'),
    ('src/fork/source-control/', 'F047 工作区仓库（已移除）'),
    ('fork-f047', 'F047 工作区仓库（已移除）'),
    ('fork-hooks/git-workspace-capability.ts', 'F047 工作区仓库（已移除）'),
    ('fork-hooks/source-control-scope.ts', 'F047 工作区仓库（已移除）'),
    ('fork-hooks/workspace-repository-diff.ts', 'F047 工作区仓库（已移除）'),
    ('useEditorPanelDiffContentLoader.ts', 'F047 工作区仓库（已移除）'),
    ('source-control/panel/panel.tsx', 'F047 工作区仓库（已移除）'),
    ('src/shared/protocol-version.ts', 'F047 工作区仓库（已移除）'),
    ('rpc-params', 'INFRA 登记/工程/文档'),
    ('rpc/methods/index.ts', 'INFRA 登记/工程/文档'),
    ('src/fork/main/rpc-methods.ts', 'INFRA 登记/工程/文档'),
    ('ai-vault', 'AIV 历史会话'),
    ('AiVault', 'AIV 历史会话'),
    ('session-scanner', 'AIV 历史会话'),
    ('session-search', 'AIV 历史会话'),
    ('browser-session-proxy', 'AIV 历史会话'),
    ('main-process-ready-foundation', 'AIV 历史会话'),
    ('computer-use', 'F006 权限窗口'),
    ('ForkPermissionCard', 'F006 权限窗口'),
    ('main.swift', 'F006 权限窗口'),
    ('secret', 'F038 密钥存储'),
    ('safe-storage', 'F038 密钥存储'),
    ('main-process-preflight', 'F038 密钥存储'),
    ('ports/', 'F021/F043 端口转发'),
    ('local-port', 'F021/F043 端口转发'),
    ('local-workspace-ports', 'F021/F043 端口转发'),
    ('updater', 'UPD 应用内更新'),
    ('update-feed', 'UPD 应用内更新'),
    ('release-channel', 'UPD 应用内更新'),
    ('release-reads', 'UPD 应用内更新'),
    ('release-sources', 'UPD 应用内更新'),
    ('live-update', 'UPD 应用内更新'),
    ('i18n', 'I18N 界面中文'),
    ('Ssh', 'SSH 状态'),
    ('ssh', 'SSH 状态'),
    ('skills-source-commit', 'SKL 技能 pin'),
    ('skill', 'SKL 技能 pin'),
    ('Skill', 'SKL 技能 pin'),
    ('orcad', 'F036 orcad 模板'),
    ('packaging', 'F002/F036 打包'),
    ('build-mac-local', 'F002 macOS 本地安装'),
    ('install-mac', 'F002 macOS 本地安装'),
    ('mac-auto-update', 'F040 自用发布'),
    ('publish-', 'F040 自用发布'),
    ('daily-sync', 'F040 每日同步'),
    ('sync-', 'F040 每日同步'),
    ('directory-browse', 'F007（已移除，守护测试）'),
    ('import/', 'F003/F025 批量导入'),
    ('post-import', 'F003/F025 批量导入'),
    ('NestedImport', 'F003/F025 批量导入'),
    ('external-worktrees', 'F003/F025 批量导入'),
    ('folder-delete', 'F048 删除工作区'),
    ('durable-archive', 'F048 删除工作区'),
    ('durable-workspace-archive', 'F048 删除工作区'),
    ('reused-path', 'F048 删除工作区'),
    ('DeleteWorktree', 'F048 删除工作区'),
    ('delete-worktree', 'F048 删除工作区'),
    ('project-group', 'SB 侧栏/项目组'),
    ('ProjectGroup', 'SB 侧栏/项目组'),
    ('sidebar', 'SB 侧栏'),
    ('Sidebar', 'SB 侧栏'),
    ('worktree', 'SB 侧栏/工作区'),
    ('Worktree', 'SB 侧栏/工作区'),
    ('workspace', 'SB 侧栏/工作区'),
    ('Workspace', 'SB 侧栏/工作区'),
    ('folder', 'SB 侧栏/工作区'),
    ('composer', 'SB 侧栏/工作区'),
]

# Optional notes for rows whose generic reason says too little. Keys must differ from the base.
REASONS = {
    'src/main/orcad/orcad-entry.ts': '一行 installForkOrcadHost()（在上游 host adapters 之前）；为这行加了文件首行的 max-lines 豁免',
    'src/main/startup/main-process-preflight.ts': 'F038：setSecretStore 先问登记的文件密钥库，没有才 new ElectronSecretStore；未登记时与上游一致',
    'src/main/updater/lifecycle/updater-setup.ts': 'UPD：类继承 fork 的 ForkBackgroundUpdates；不先钉上游地址；退出即装 ||= fork 判断；三条 fork 回调',
    'src/main/updater/updater-events.ts': 'UPD：后台下载适配器挂在上游事件上；checking 时的两次清理由适配器决定是否保留已下载版本',
    'src/main/updater/lifecycle/updater-download-install.ts': 'UPD：后台下载失败时不把请求错误写进状态，改回手动下载卡片',
    'src/main/updater/lifecycle/updater-check-failure.ts': 'UPD：检查失败时保留已下载或暂存中的 fork 更新（实现在 ForkBackgroundUpdates）',
    'electron.vite.config.ts': '沙箱 preload 内联 Rolldown runtime 的插件；渲染进程的 ORCA_BUILD_COMMIT 取 skill pin（上游渲染进程只用它拼 skills add）',
    'src/renderer/src/components/tab-group/RetainedPaneHost.tsx': 'F050：登记后写 data-retained-pane-group，样式表才能按分栏组藏起旁边的 xterm；未登记时没有这个属性',
    'config/scripts/verify-packaged-orcad-template.cjs': 'F036：默认目标先读 ORCA_ORCAD_TEMPLATE_TARGETS，未设置时仍是全部目标',
    'config/scripts/packaged-orcad-template.cjs': 'F002：mac.signIgnore 追加 fork 的静态资源排除',
    'config/scripts/build-mac-local.mjs': 'F002：命令行多出的参数作为 --mac 的 electron-builder 目标（dmg:arm64 zip:arm64）',
    'native/computer-use-macos/Sources/OrcaComputerUseMacOS/main.swift': 'F006：DraggableAppTile 不再 private（fork 子类）、一行 install、带参数时保持窗口显示',
    'package.json': 'fork 版本号 1.4.228',
    '.gitattributes': '末尾一行：RPC 目录 merge=ours，合并不冲突；daily-sync 合并后重新生成并提交',
    'src/main/runtime/rpc/methods/index.ts': 'fork 的 RPC 方法（F046 主机读取）经 src/fork/main/rpc-methods.ts 一行摊进 ALL_RPC_METHODS',
    'src/main/runtime/rpc/rpc-params-type-parity.ts': '类型对齐检查跳过 ForkRpcMethodName（schema 在 src/fork）',
    'src/main/ipc/doc-preview-grant-ipc.ts': 'F051：铸 grant 后一行 openDocPreviewAccess，整个请求根放行，不弹文件夹提示',
    'src/main/antigravity/antigravity-acp-runtime-probe.ts': 'F052：Linux 安装校验在 --uid= 后展开 antigravityAcpLinuxArgs()；未登记时仍只有 --uid=',
    'src/main/acp/acp-launch-specs.ts': 'F052：Linux 会话启动（含登录）在 --uid= 后展开 antigravityAcpLinuxArgs()；未登记时仍只有 --uid=',
    'src/shared/runtime-rpc-call-queue.ts': 'F046：分段读 files.hostDocPreview.readChunk、files.hostFile.readChunk 和上游 files.readDocPreviewChunk 一样走 bulk 通道',
    'src/renderer/src/runtime/runtime-terminal-artifact-read.ts': 'F046：授权读给不了的大文本交给 readLargeHostFile 分段读；二进制预览交给 pageLargeHostPreview（图片、PDF 分段读）',
    'src/renderer/src/components/editor/csv/csv-file-content.ts': 'F046：开头先问 readHostCsv，工作区外的主机 CSV 过了分页阈值用上游的分页预览，否则整份读',
    'src/renderer/src/runtime/runtime-file-range-client.ts': 'F046：分页 CSV 预览的 stat 和按段读各在开头一行，工作区外的主机文件按绝对路径读（files.hostFile.*）',
}

# Files a rework put back to upstream or deleted. Each must not differ from the base.
HISTORY = {
    'src/main/remote-ssh-editor-launch.ts': ('revert-to-upstream', '上游 #33877 用 CLI 打开 SSH 上的 Cursor/VS Code/Zed'),
    'src/main/external-editor-launch.ts': ('revert-to-upstream', '上游 #33877 之后没有 cursor:// URL 启动'),
    'src/renderer/src/components/sidebar/WorktreeOpenInMenu.tsx': ('revert-to-upstream', '上游 #33877 覆盖 Open in 的远端启用'),
    'src/renderer/src/i18n/locales/en.json': ('revert-to-upstream', 'fork 键在 src/fork/i18n/en.json'),
    'src/renderer/src/components/terminal-pane/use-covered-terminal-focus-handoff.ts': ('revert-to-upstream', 'F050 改成 src/fork/terminal/covered-terminal-canvas.tsx 的样式表'),
    'src/renderer/src/components/native-chat/StructuredAgentSessionPaneOverlayLayer.tsx': ('revert-to-upstream', 'F050 智能体会话盖层分支从未生效，已删除'),
    'src/renderer/src/assets/terminal.css': ('revert-to-upstream', 'F050 的规则由 fork 注入'),
    'src/main/host/safe-storage-availability.ts': ('revert-to-upstream', 'F038 登记时把 guardedSafeStorage 路由到文件密钥库'),
    'src/main/host/electron-secret-store.ts': ('revert-to-upstream', 'F038 只在 preflight 一行选择密钥库'),
    'src/main/browser/cookies/sources/browser-cookie-detection.ts': ('revert-to-upstream', 'F049 登记时把 Ego Lite 追加进 CHROMIUM_BROWSERS'),
    'src/main/browser/cookies/sources/browser-cookie-key.ts': ('revert-to-upstream', 'F049 同上'),
    'src/main/updater/updater-menu-checks.ts': ('revert-to-upstream', 'UPD 的 skip 状态在运行更新器的进程里不会出现'),
    'src/main/updater/updater-scheduling.ts': ('revert-to-upstream', 'UPD 同上'),
    'src/main/updater/updater-build-selection.ts': ('revert-to-upstream', 'UPD resolveTargetBuild 已拒绝上游 tag'),
    'src/renderer/src/lib/agent-feature-install-commands.ts': ('revert-to-upstream', 'SKL 渲染进程的 ORCA_BUILD_COMMIT 由构建配置给上游基点'),
    'config/scripts/vitest-node-runtime-files.mjs': ('revert-to-upstream', 'SQLite 扫描已经找到两个 fork 测试'),
    'src/main/runtime/workspaces/workspace-selectors.ts': ('revert-to-upstream', '只多了一行注释'),
    'src/renderer/src/components/browser-pane/workspace-doc/HtmlDocPreview.tsx': ('revert-to-upstream', 'F051 之后文件夹提示不再出现，提示里的目录标签钩子已删'),
    'config/scripts/compact-packaged-orcad-ripgrep.cjs': ('revert-to-upstream', 'F036 在上游校验函数的默认参数里收窄目标'),
    'config/scripts/packaged-orcad-browser.cjs': ('revert-to-upstream', 'F036 同上'),
    'src/renderer/src/components/right-sidebar/local-port-section.tsx': ('revert-to-upstream', 'F021/F043 的 Forward 不再穿过分区传参'),
    'src/main/updater-fork-background.ts': ('delete', 'UPD 接线移到 src/fork/main/updater-background-wiring.ts'),
    'src/cli/skills-source-commit.ts': ('delete', 'SKL pin 移到 src/fork/skills-source-commit.ts'),
    'src/fork/ssh/ssh-status-labels.tsx': ('delete', '没有调用方；SSH 状态名用上游 settings.ssh.status.*'),
    'src/fork/main/orcad-serve-bind.ts': ('delete', 'orcad-entry 恢复上游两行'),
    'fork/scripts/release-personal-orca.mjs': ('delete', 'Mac 上从未使用'),
    'src/renderer/src/components/editor/useEditorPanelDiffContentLoader.ts': ('revert-to-upstream', 'F047 已删除，diff 读取回到上游'),
    'src/renderer/src/components/right-sidebar/source-control/panel/panel.tsx': ('revert-to-upstream', 'F047 已删除，源代码管理回到上游单仓库'),
    'src/shared/protocol-version.ts': ('revert-to-upstream', 'F047 已删除，不再广播工作区仓库能力'),
    'src/fork/git-workspace/constants.ts': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/git-workspace/params.ts': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/git-workspace/types.ts': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/main/git-workspace/capability.fork.test.ts': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/main/git-workspace/compare-target-store.ts': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/main/git-workspace/compare-target.fork.test.ts': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/main/git-workspace/compare-target.ts': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/main/git-workspace/discover.fork.test.ts': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/main/git-workspace/discover.ts': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/main/git-workspace/guard.fork.test.ts': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/main/git-workspace/guard.ts': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/main/git-workspace/methods.fork.test.ts': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/main/git-workspace/methods.ts': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/main/git-workspace/reads.ts': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/main/git-workspace/root-change-list.fork.test.ts': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/main/git-workspace/root-status-entries.ts': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/main/git-workspace/route-guard.fork.test.ts': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/source-control/branch-compare-due.fork.test.tsx': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/source-control/compare-picker.tsx': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/source-control/desktop-git-route.ts': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/source-control/diff-loader.fork.test.tsx': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/source-control/diff-read.tsx': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/source-control/discovered-repos.ts': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/source-control/i18n.fork.test.tsx': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/source-control/poll-base-advance.fork.test.tsx': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/source-control/poll-workspace-repos.tsx': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/source-control/register.tsx': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/source-control/repo-order.ts': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/source-control/repo-section.tsx': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/source-control/rpc-client.tsx': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/source-control/scope-memory.tsx': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/source-control/scope-panel.tsx': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/source-control/scope-switch.fork.test.tsx': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/source-control/workspace-groups.fork.test.tsx': ('delete', 'F047 工作区仓库已删除'),
    'src/fork/source-control/workspace-view.tsx': ('delete', 'F047 工作区仓库已删除'),
    'src/shared/fork-hooks/git-workspace-capability.ts': ('delete', 'F047 工作区仓库已删除'),
    'src/shared/fork-hooks/source-control-scope.ts': ('delete', 'F047 工作区仓库已删除'),
    'src/shared/fork-hooks/workspace-repository-diff.ts': ('delete', 'F047 工作区仓库已删除'),
    'tests/e2e/fork-f047-workspace-repos.spec.ts': ('delete', 'F047 工作区仓库已删除'),
}


def git(*args):
    return subprocess.run(['git', '-C', ROOT, *args], capture_output=True, text=True, check=True).stdout


def upstream_base():
    with open(os.path.join(ROOT, PIN), encoding='utf8') as handle:
        match = re.search(r"FORK_SKILLS_SOURCE_COMMIT = '([0-9a-f]{40})'", handle.read())
    if not match:
        sys.exit(f'{PIN} does not pin a commit')
    base = match.group(1)
    if subprocess.run(['git', '-C', ROOT, 'cat-file', '-e', f'{base}^{{commit}}']).returncode:
        sys.exit(f'pinned upstream base {base} is not in this clone; fetch upstream first')
    return base


def feature(path):
    for needle, label in FEATURES:
        if needle in path:
            return label
    return 'INFRA 登记/工程/文档'


def changed_lines(base, path):
    diff = git('diff', '--no-renames', base, '--', path)
    return sum(1 for line in diff.splitlines() if line[:1] in '+-' and line[:3] not in ('+++', '---'))


def build(base):
    statuses = {}
    for line in git('diff', '--name-status', '--no-renames', base).splitlines():
        status, path = line.split('\t', 1)
        statuses[path] = status[0]
    errors = [f'note for a file that matches the base: {path}' for path in REASONS if path not in statuses]
    errors += [f'history entry that differs from the base again: {path}' for path in HISTORY if path in statuses]
    if errors:
        sys.exit('\n'.join(errors))

    rows, counts, upstream_lines, upstream_files = [], collections.Counter(), 0, 0
    for path in sorted(statuses):
        status, fork_root = statuses[path], bool(FORK_ROOT.match(path))
        if fork_root:
            reason = 'fork 自有文件（测试）' if '.test.' in path else 'fork 自有文件'
        elif status == 'A':
            reason = 'fork 新增文件（上游目录）'
        elif status == 'D':
            reason = 'fork 删除的上游文件'
        else:
            lines = changed_lines(base, path)
            upstream_lines += lines
            upstream_files += 1
            reason = f'上游文件，fork 改动 {lines} 行'
        if path in REASONS:
            reason = f'{reason}。{REASONS[path]}'
        counts['keep'] += 1
        rows.append(f'| `{path}` | {feature(path)} | keep | {reason} |')

    history = [
        f'| `{path}` | {feature(path)} | {decision} | {reason} |'
        for path, (decision, reason) in sorted(HISTORY.items())
    ]
    for _path, (decision, _reason) in HISTORY.items():
        counts[decision] += 1
    summary = '，'.join(f'{name} {count}' for name, count in sorted(counts.items()))
    lines = [
        f'# Fork 文件逐个审计（对比上游 {base[:10]}）',
        '',
        f'由 `python3 fork/scripts/generate-audit.py` 生成（`--check` 只比对）。主表是和上游基点（`{PIN}` 记录的提交）不同的每个文件，一个不多一个不少；末尾另列已恢复成上游或已删除的文件，它们必须和基点相同。`src/fork/audit-table.fork.test.ts` 检查表和仓库一致。',
        '',
        f'共 {len(rows) + len(history)} 行：{summary}。上游文件（不含 fork 目录）里的 fork 改动 {upstream_lines} 行，涉及 {upstream_files} 个文件。',
        '',
        '| 文件 | 功能 | 决定 | 原因 |',
        '| --- | --- | --- | --- |',
        *rows,
        '',
        '## 已恢复成上游或已删除',
        '',
        '| 文件 | 功能 | 决定 | 原因 |',
        '| --- | --- | --- | --- |',
        *history,
        '',
    ]
    return '\n'.join(lines)


def formatted(markdown):
    oxfmt = os.path.join(ROOT, 'node_modules', '.bin', 'oxfmt')
    if not os.path.exists(oxfmt):
        sys.exit('node_modules/.bin/oxfmt is missing; run pnpm install first')
    result = subprocess.run(
        [oxfmt, f'--stdin-filepath={TABLE}'], input=markdown, capture_output=True, text=True, cwd=ROOT
    )
    if result.returncode:
        sys.exit(result.stderr)
    return result.stdout


def main():
    check = sys.argv[1:] == ['--check']
    if sys.argv[1:] not in ([], ['--check']):
        sys.exit(__doc__)
    table = formatted(build(upstream_base()))
    path = os.path.join(ROOT, TABLE)
    with open(path, encoding='utf8') as handle:
        current = handle.read()
    if check:
        if current != table:
            sys.exit(f'{TABLE} is stale: run python3 fork/scripts/generate-audit.py')
        return
    if current != table:
        with open(path, 'w', encoding='utf8') as handle:
            handle.write(table)
    print(table.split('\n')[4])


if __name__ == '__main__':
    main()
