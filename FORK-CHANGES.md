# Fork 维护（develop）

集成分支是 `develop`（名字上和上游的 `main` 区分开）。它从上游 `17a2bced1115f064e834e397c2b949d9e150d275` 起，只加扩展点；之后每天把上游 `main` 合并进来，不再变基，也不强推。`fork/base` 保留为切到集成分支时的那个提交，每日任务不移动它。`fork/base-upstream` 仍是人工推上去的上游指针。行为登记在 `src/fork/`。未登记时上游行为保持不变。上游 main 的 `package.json` 仍是 `1.4.214`（稳定版号只在发布分支上改）。本 fork 写成 `1.4.228`，比已发布的 `1.4.227` 和本机正在用的 `1.4.224` 都新，本地构建不会被当成降级。

- 扩展点说明：[docs/fork/HOOKS.md](docs/fork/HOOKS.md)
- 逐文件审计（每个和上游基点不同的文件）：[docs/fork/AUDIT.md](docs/fork/AUDIT.md)。只用一条命令生成：`python3 fork/scripts/generate-audit.py`，`--check` 只比对。见下面「审计表」。
- 行为清单：[docs/fork/parity/ssh-import.md](docs/fork/parity/ssh-import.md)、[docs/fork/parity/build-skills.md](docs/fork/parity/build-skills.md)、[docs/fork/parity/ai-vault.md](docs/fork/parity/ai-vault.md)、[docs/fork/parity/sidebar.md](docs/fork/parity/sidebar.md)
- 同步上游：[docs/fork/SYNC.md](docs/fork/SYNC.md)
- 每日上游同步和家里的 Mac 发布：[docs/fork/DAILY.md](docs/fork/DAILY.md)
- Linux 验收和手动验收：[docs/fork/VERIFY.md](docs/fork/VERIFY.md)
- F024 停用说明：[docs/fork/skill-update-flow.md](docs/fork/skill-update-flow.md)
- 登记入口：上游在三个地方各调用一次 fork 入口。`src/main/index.ts` 在 preflight 之前调用 `registerForkDesktopMain()`（`src/fork/main/register-electron.ts`），preflight 要用登记的密钥库；它依次登记 `registerForkModules()`（`src/fork/register.ts`）、只在 Electron 主进程的部分，以及 `registerForkMainModules()`（`src/fork/main/register-main.ts`）。`src/renderer/src/main.tsx` 在模块开头调用 `registerForkRenderer()`（`src/fork/register-renderer.tsx`），先 `registerForkModules()` 登记分组模式，再 `registerForkRendererModules()` 登记界面插槽。`src/main/orcad/orcad-entry.ts` 的 `startOrcad` 在上游 `installOrcadHostAdapters()` 之前调用 `installForkOrcadHost()`（`register-main.ts`），它只调用 `registerForkMainModules()`；orcad 不加载 `register.ts` 和 `register-electron.ts`，所以不引入 Electron。
  - `register.ts`（主进程和界面都调用，不静态引入 electron、node:fs 或界面组件）：fork 构建标记、host-directory 分组模式和删除项目组的「仅取消分组」选项、保留旧主机漏发的 `sidebarGroupId`、Ego Lite 的设置行名字和导入提示。
  - `register-main.ts`（桌面主进程和 orcad）：fork 构建标记、Ego Lite（名字、导入提示和追加进上游 `CHROMIUM_BROWSERS` 的浏览器定义）、历史会话扫描进程的堆内存和扫描策略、启动时不等浏览器分区代理、运行时导入的 git 根、删除项目组时保留文件夹工作区、在软删除过的路径上新建时清掉归档、Linux 上 Antigravity ACP 跳过内核 IPv6 检查。
  - `register-electron.ts`（只在 Electron 主进程）：macOS 文件密钥库、权限助手参数、F046 工作区外文档预览的读取、F051 文档预览免授权。
  - `register-renderer.tsx`（仅界面）：fork 语言包、侧栏行计划和各个插槽、跨组拖放、删除工作区和软删除归档、创建弹窗的种子、导入后的回调、SSH 重连重绘、聊天盖层的画布样式、F046 工作区外的主机文件和大文件分段读、端口 Forward、历史会话的列表呈现和默认主机、源代码管理的工作区仓库。
- 目录约定：只在主进程运行的 fork 代码放 `src/fork/main/`；引用渲染进程的 fork 代码用 `.tsx`；`*.fork.test.ts` 是 node 测试，渲染进程测试用 `.fork.test.tsx`。tsconfig 只按这三条通配：node 工程收 `src/fork/**/*.ts`，web 工程收 `src/fork/**/*.ts` 和 `*.tsx`，排除 `src/fork/main/**` 和 `src/fork/**/*.fork.test.ts`。fork 文件引用了所在工程不包含的文件时 tsc 自己报 TS6307；`src/fork/tsconfig-boundaries.mjs` 只在 fork 测试（`src/fork/tsconfig-boundaries.fork.test.ts`）里跑，不挂在 `pnpm tc` 前面。用到真实 SQLite 的 fork 测试由上游的 `findSqliteRuntimeTests()` 按 import 找到，`config/scripts/vitest-node-runtime-files.mjs` 与上游一致。

## 上游文件规则

每天有机器人把上游 `main` 合并进 `develop`（`fork/scripts/daily-sync.sh`，见 [docs/fork/DAILY.md](docs/fork/DAILY.md)）。fork 在上游文件里改的每一行都是以后可能的合并冲突，所以同步成本是首要要求。上游文件指 `src/fork/`、`src/shared/fork-hooks/`、`fork/`、`docs/fork/` 和本文件以外的所有文件。

- 上游文件里只放钩子调用。逻辑在 `src/fork/**`，登记表在 `src/shared/fork-hooks/`。未登记时上游行为完全不变：不多 await，不多 DOM，不多菜单项，不改存储的值。
- 不移动、复制、重新缩进或重新格式化上游代码。包住一个上游表达式会让它的行重新缩进，不允许；改成加一行（展开、调用、提前返回）。
- 钩子调用尽量少占行，放在稳定的代码旁边。只有这一行自己说明不了时才加 `// fork:` 注释。
- 行数上限（`max-lines`，不算空行和注释：`.ts` 300 行，`.tsx` 400 行）。上游文件因为钩子行超过上限时，文件第一行加 `/* oxlint-disable max-lines -- fork: hook call only */`，并在 `config/max-lines-baseline.txt` 里加对应的 `inline <路径>` 一行：上游的 `pnpm check:max-lines-ratchet`（`pnpm lint` 的一步）只放行列在里面的豁免。不为了躲上限把上游代码搬进 fork 文件。
- fork 的基线条目作为一块放在 `config/max-lines-baseline.txt` 末尾，前面一行注释 `# fork: hook lines in upstream files at the cap`。现在这一块是首行带这个豁免的四个文件：`src/main/orcad/orcad-entry.ts`、`src/renderer/src/components/editor/useEditorPanelFileContentLoader.ts`、`src/renderer/src/components/sidebar/DeleteWorktreeDialog.tsx`、`src/renderer/src/components/sidebar/useAddRepoNestedImportFlow.ts`。不要在 fork 上随手跑 `pnpm check:max-lines-ratchet --prune`：它按顺序重写整个文件，丢掉 fork 的注释，把 fork 条目混进上游的条目。上游改了基线的最后一条时，合并会在 fork 这一块旁边冲突：保留上游的行，fork 这一块仍放在末尾。只有某个文件不再需要这行豁免时，才删掉它的 fork 条目。
- `pnpm lint` 在 fork 上只应在上游 main 自己也失败的地方失败。
- fork 测试只放在 `src/fork/**/*.fork.test.ts(x)`，不往上游测试文件里加用例或 mock。
- 上游覆盖了某个 fork 行为时，删掉 fork 代码，用上游的，并在本文件里标成「已移除」。
- 类型断言要有逐行的 `SAFETY:` 说明（AGENTS.md）。不留死代码。
- 生成文件 `src/shared/rpc-contract/rpc-params-catalog.generated.ts` 两边都会加方法。`.gitattributes` 末尾一行给它 `merge=ours`（要 `git config merge.ours.driver true`），合并留 fork 一侧、不冲突；`daily-sync.sh` 随后跑 `pnpm generate:rpc-params-catalog` 并提交。手动合并后也要跑这条命令。

## F002 macOS 本地安装

- 脚本：[fork/scripts/install-mac-release.sh](fork/scripts/install-mac-release.sh)。它只包一层上游发布命令，不再维护单独的 electron-builder 配置。签名身份、Mac 包要带的 orcad 目标和静态资源签名排除都写在 `src/fork/packaging.cjs`。
- 依赖安装是 `pnpm install --frozen-lockfile --cpu=arm64`（安装前设 `ORCA_PNPM_GLOBAL_VIRTUAL_STORE=0`，关掉上游默认打开的 pnpm 全局依赖存储，让依赖都在仓库的 node_modules 里；Linux 槽的容器只挂载仓库，编译前脚本会检查 `node-pty` 和它的依赖确实在仓库里），以及 mobile 的 `pnpm install --frozen-lockfile`。应用构建是 `pnpm run build:release`。本机 `darwin-arm64` 槽仍是 `pnpm build:orcad-prebuilds`、`--require-slots`、`--smoke`。Linux 槽由 [fork/scripts/build-orcad-linux-prebuilds.sh](fork/scripts/build-orcad-linux-prebuilds.sh) 按 `node-server-tests.yml` 的 manylinux 镜像编译：`linux-x64-glibc`、`linux-arm64-glibc`、`linux-x64-glibc217`。模板命令是 `node config/scripts/build-orcad-template.mjs --targets darwin-arm64,linux-x64-glibc,linux-arm64-glibc`。然后是文件监视隔离检查、`pinned-node-downloads.mjs darwin-arm64`、`ensure:electron-runtime`，最后 `node config/scripts/build-mac-local.mjs dmg:arm64 zip:arm64`。
- 只覆盖这些事。签名身份是 `Orca Local Signing`（`CSC_NAME` 和 `ORCA_COMPUTER_MACOS_SIGN_IDENTITY`，`CSC_IDENTITY_AUTO_DISCOVERY=false`）；钥匙串里没有该证书就停止。版本后缀由 `build-mac-local.mjs` 写入，脚本不自己算。Electron 包只打 arm64：`dmg:arm64 zip:arm64`。安装、备份和回退仍在这个脚本里。
- 这些 Mac 都是 Apple Silicon。x64 包的 afterPack 会在 Rosetta 下启动交互式 shell 做 PTY 检查，并超时。单独的 `--arm64` 去不掉配置里写死的 x64 目标；空的命令行目标列表会保留配置里的两个架构。`dmg:arm64 zip:arm64` 才是只打一个架构的上游参数，`build-mac-local.mjs` 把多出的命令行参数接在 `--mac` 后面。因此不会编 x64 Electron 包，也不会跑 x64 PTY 检查，也不下载 `darwin-x64` Node。`verify-packaged-daemon-entry` 本身不改。
- 不公证。`ORCA_MAC_RELEASE` 等保持 0。需要 Apple 密钥、GitHub 发布，以及 musl、win32、`darwin-x64` 这些本机编不了的槽，仍然跳过，原因写在 [docs/fork/SYNC.md](docs/fork/SYNC.md)。
- orcad 模板检查两次：模板构建之后立即对 `out/orcad-template/orcad-template.json` 跑 `assertLocalTemplateTargets`（缺 glibc 2.17 槽时在 electron-builder 之前就失败），打包后再对 `Contents/Resources/orcad-template/orcad-template.json` 跑一次。四个目标 `darwin-arm64`、`linux-x64-glibc`、`linux-arm64-glibc`、`linux-x64-glibc217` 写在 `packaging.cjs` 的 `LOCAL_TEMPLATE_TARGETS`。之后在解包后的目录上跑上游的 `verifySkillsCliRuntime`，和 electron-builder afterPack 是同一个检查。
- `--fast` 跳过两次依赖安装；Linux 槽若已通过 `--require-slots` 也不重编。签名、模板和安装仍会做。`--cleanup-verified-backups <版本号>` 只清理 `/Applications/.orca-previous.*` 里已退出的旧应用。
- 静态资源签名排除（feature-wall 图片、Electron Framework 的语言包等资源）由 `config/scripts/packaged-orcad-template.cjs` 一行 push 进上游的签名排除列表，最后进 `mac.signIgnore`。不再写钥匙串 partition list；后台安装传递 `ORCA_BACKGROUND_LAUNCH=1`。

## 侧栏 host-directory

默认分组是「按执行主机，再按目录」。内置的 Project / Status / PR / None 不改。没有登记这个模式的测试里，缺省分组仍是 `repo`。配对客户端仍按上游的 Zod 枚举校验 `groupBy`：桌面独有的模式只存在桌面的配置里，手机看到不认识的值时保留它原来的模式。

- 侧栏启动时上游对每个分区读取 `group.repoIds`（按分区做主机和项目过滤）。host-directory 的每个分区（含置顶）都带上游要的 `group`，`repoIds` 是这一目录里实际出现的仓库。行计划的类型就是上游 `planSidebarRows` 的返回类型，上游以后给分区加字段时类型检查会失败。`planSidebarRows` 开头先问登记的模式要行计划；内置 id 查不到模式，走上游原来的计划。
- 同一目录在两台主机上各成一块，不合并。组归属只认同一台主机。行计划用上游传入的 `repoOfWorktree`（按主机找项目登记），找不到时才按裸 id 查：同一个项目在两台主机上登记时，每台主机的行继承自己那份登记的项目组。没有主机字段的行、项目和组按侧栏的默认主机算。
- 只看见一台主机时仍保留主机标题：`host-section-rows.ts` 的单主机提前返回都多一个 `retainSingleHostHeader` 判断，`use-section-rows.ts` 用 `sidebarModeRetainsHostHeaders` 传入。目录标题如果自带 `hostId`，按这个主机归组，不按标题上仓库的主机：`host-section-rows.ts` 只调用一次 `forkHeaderHostId`，登记了 `retainHostHeaders` 且行上有 `hostId` 才返回它，否则返回 null。没有登记时标题仍按仓库主机归组。
- 不画仓库标题层，工作区直接出现在主机和项目组下面。上游按 `groupBy === 'repo'` 决定的项目标题外观（项目操作菜单、新建按钮、隐藏项目徽标、空项目占位）合成一个判断 `hasProjectHeaderChrome(groupBy)`，`SectionHeader.tsx`、`item-row.tsx` 和 `empty-project-placeholder-repos.ts` 共用。
- 删除项目组只取消分组。上游「同时移除包含的项目」勾选还在；登记的附加项（`renderDeleteProjectGroupOption`，fork 组件 `project-group-delete-option.tsx`）默认勾上时，这个标志被改成不移除。文件夹工作区留在列表里，变成未分组。主进程也一样（`src/fork/main/project-group-delete.ts`，在 `register-main.ts` 登记，桌面和 orcad 都有）：上游 `deleteProjectGroup` 会连同组删掉它拥有的文件夹工作区，删除后界面重新拉列表时它们就消失了（磁盘上的目录还在）；登记后只把 `sidebarGroupId` 设成 `null`，被删的组拥有的工作区从组上补齐缺少的 `folderPath`、`connectionId`、`executionHostId`，仍在原主机上；它们的会话标签页也保留。加载时这些失去所属组的文件夹工作区不再被丢弃，并且一律取消分组（`src/shared/folder-workspaces.ts`），已经存有这种工作区的配置也一样。数据模型里文件夹工作区必须有 `projectGroupId`（合成的 `repoId` 和迁移清单都要求它），没有“无组”的写法，所以保留的工作区仍记着已删组的 id，凡是按 id 找组的地方都要接受找不到：迁移到 orcad 时目标端不再因为组不在而报 `orcad_migration_folder_workspace_project_group_missing`（`orcad-catalog-records.ts`）；Status、PR、None 分组方式给这种已取消分组的工作区配一个用它自己路径和主机的替身组，照样列出（`folder-workspace-lanes.ts`，被隐藏主机的组仍隐藏它的工作区）；agent 状态按工作区自己的 `connectionId` / `executionHostId` 判断主机（`restored-status-dead-terminal-sweep.ts`，同一个替身组）。其余按 id 找组的地方本来就允许找不到。对话框里没有“同时删除文件夹工作区”的选项，上游“同时移除包含的项目”勾选仍照旧移除项目。
- 从 Orca 移除单个工作区只归档，不删目录、不删 git 分支。多主机归属不清时中止。顺序与上游删除一致：先在宿主上归档，成功后才停掉它的浏览器和终端；归档失败时终端保持运行。找不到所属仓库的孤立工作区先停再移出列表。
- 删除工作区对话框默认不删磁盘上的文件夹（F048）。git 工作区默认只归档；勾上「同时删除文件夹」才走原来的 `git worktree remove`。本来就不删目录的文件夹工作区不显示这个勾选。
- 隐藏工作区可搜索、可恢复：搜索从第一个隐藏工作区起就出现，保留上游的名称和路径匹配，只多一行 `hiddenWorktreeMatchesExtra` 匹配分支。「隐藏的工作区」菜单按项目的执行主机找项目（含只有 `connectionId` 的 SSH 项目）。「已从 Orca 移除」列表按每一行自己的项目和侧栏默认主机判断主机，恢复写到这台主机，失败时提示。工作区选择器（`WorkspaceCombobox.tsx`）显示目录、分支、分组和路径，标签按行自己的项目查，分支去掉 `refs/heads/`。设置里的项目列表可以多选后移除，只从 Orca 注销，不删目录。
- 卡片左侧用淡色、从左侧截断的目录前缀（行上的 `directoryLabel`，`worktree-card-header.tsx` 一行 `renderWorktreeDirectoryPrefix`，fork 组件 `directory-prefix.tsx`）。项目组只有一个工作区、且仓库路径不在组的父目录下时，卡片去掉父目录前缀。
- 已保存的 `groupBy: repo` 在登记后读成 host-directory：`normalizeGroupBy` 开头一行 `normalizeRegisteredGroupBy`，界面水合用 `hydrateSidebarGroupBy`。未登记时 `repo` 仍是原来的项目标题。读取失败时的界面兜底也跟登记的默认值走，不会打开项目标题。
- SSH 状态行上的主机类型和连接状态不换行（`SshTargetStatusRow.tsx` 两个 `shrink-0 whitespace-nowrap`）。连接状态名用上游 #34680 的 `settings.ssh.status.*`（含中文和其他语言），fork 不另做标签。参考实现已经去掉远程工作区同步冲突按钮，这里不把那套界面加回来。
- 旧远端刷新如果省略 `sidebarGroupId`，本机保留原来的分组（`fetched-worktree-merge.ts` 一处 `preserveRegisteredSidebarGroupIds`）。显式 `null` 仍表示取消分组。
- 组内排序：smart 保持传入顺序，其他模式在组内重排。拖到另一台主机被拒绝。
- 手动排序时，组内显示和拖放写入用同一个顺序（`src/fork/sidebar/manual-order.ts`）：有效排序值 `manualOrder ?? sortOrder` 从大到小，相同时按名称、再按主机，和上游手动排序、上游拖放目录一致。没有 `manualOrder` 的行出现在它 `sortOrder`（创建时间，或上次智能排序的快照）对应的位置，和上游其他分组方式里的顺序一样。拖放的插入位置按显示出来的行计算。拖放排序（`group-drop-order.tsx`）全部按主机身份（主机|工作区 id）计算：排序值、已存的手动排序、分区归属和拖动的行都用身份键，结果只写目标主机上的行，另一台主机上同 id 的工作区不会被当成邻居。
- host-directory 下子工作区画在自己的父工作区正下方：分区先排序再交给上游的层级展开，每个根行后面紧跟它的子树。置顶分区里两台主机各有一个同 id 的工作区时，子树按主机身份记，各画一次。松手在父子行旁边、邻居的排序值解释不了显示顺序时，按显示顺序重新编号这一段，结果落在松手处。
- 置顶分区标题切换界面语言后立即重绘：fork 的行计划不把翻译后的标题写进行里（和上游一样由绘制时取），`use-section-rows.ts` 调用 fork 的 `useSidebarGroupModeLabelsVersion()` 订阅模式标题版本号（语言切换时变化），版本变化时重新生成行数组。未登记 fork 模式时版本号不变。
- 跨组拖放只写目标主机上真实存在的项目组；拖到空项目标题或主机标题等于拖进该主机的未分组列表，不写假的组 id。多选拖放要么全部写入，要么一项都不写：有一项不在该主机就整体拒绝。写入一项一项串行进行，不会并发改同一份存储；中途失败时按相反顺序把已写入的项精确改回原状态：原本没有自己的分组（继承项目组）就恢复成未设置，原本没有手动排序就去掉手动排序。回滚也失败时弹出错误提示，用显示名列出没能改回的工作区（不是内部 id），并写一条带 id 的错误日志。文件夹工作区的 `sidebarGroupId` 会真正保存（参数校验和加载都认这个字段）。
- 清除字段随更新一起走一个并列的 `clearFields` 列表（钩子 `sidebar-field-clear.ts`，参数都是它导出的带类型的 `SidebarFields`）：`null` 已经表示取消分组，JSON 又会丢掉 `undefined`。宿主在每个写入处加一行，把要清除的字段就地写成自己的 `undefined` 键，合并写入时去掉：文件夹工作区的 IPC（`folder-workspace-handlers.ts`）和运行时的 `worktree.set`（`runtime-managed-worktree-metadata.ts`）用 `applySidebarFieldClears`，参数已经过 schema 校验；运行时 RPC 的文件夹方法在表达式里用 `decodeSidebarFieldClears`；`worktrees:updateMeta` 的 IPC 参数没有声明 `clearFields`，`register-worktree-metadata-handlers.ts` 只有一行 import 和一行 `applySidebarFieldClearsFromIpcArgs(sanitizedUpdates, args)`，从原始 IPC 参数里解析。`worktree.set` 处理函数直接传 `sidebarGroupId` 和 `clearFields`。旧版远端主机会丢掉 `sidebarGroupId` 和 `clearFields`、只应用其余字段：文件夹写入按宿主返回值对账，git 工作区写入检查宿主返回的工作区，缺了要求的分组或清除就算失败。当前主机的 `worktree.set` 回复按这次写入之后存储里的值回显分组和手动排序（`echoSidebarFields`，取 `setWorktreeMeta` 的返回值），只回显这次写入涉及的字段：`show` 解析出的行可能缺这个字段（例如文件夹仓库的投影），不会因此被误判成主机过旧；存储没有保存分组时回复里就没有，客户端照样判为没写进去。旧主机没有这段回显，回复里没有要求的分组，客户端拒绝，整次拖放失败并回滚，这一行已经写进去的排序也改回去，不会只写一半而不报错；提示让用户先更新该主机上的 Orca。“只写了一半”按错误码判断，不比对提示文字：`SidebarFieldsNotAppliedError` 带固定的 `code`（`SIDEBAR_FIELDS_NOT_APPLIED`），由 `worktree-meta-persist.ts` 一行 `assertSidebarFieldsApplied` 根据主机的回复抛出；`update-worktree-meta.ts` 的失败结果经 `sidebarFieldsWriteFailure` 保留这个 `code`，用上游的 `hasRuntimeRpcErrorCode` 匹配。抛出和判断都在渲染进程里，不经过 IPC 或运行时 RPC。
- 文件夹项目（`kind: folder`）重启后仍留在拖进去的侧栏分组。分组记在 worktree meta 上；元数据到工作区行的四个投影（`mergeWorktree`、`mergeFolderWorkspace`、`mergeRuntimeFolderWorkspace`、`folderWorkspaceToWorktree`）各一行展开 `forkWorkspaceFields(meta)`：`sidebarGroupId` 有值或是显式 `null` 都带回，缺失时仍缺失。fork 以后往 meta 里加字段只改这一个函数。`runtime-worktree-ps-summaries.ts` 不带这个字段：它只供 `orca worktree ps` 和手机列表，两边都不按侧栏分组。
- 未分组的工作区可以拖：fork 的未分组列表没有标题行，上游按标题行切拖放组。`groups.ts` 和 `worktree-drag-units.ts` 遇到行自己的分区键变了（不是 `all`）就另起一组；上游自己的行仍在 `all` 里，行为不变。
- 拖出分组、松手在另一张卡片中间时，跨组拖放先于“设为父工作区”判断，不会悄悄把那张卡片设成父级；同组内拖到卡片中间仍按上游设父级。指针拖放（`pointer-commit.ts`）和原生拖放（`use-document-drop.ts`）各一个提前返回调用 `commitRegisteredWorkspaceGroupDrop`，跨组拖放不要求指针还在源组里。拖放目标的 `data-workspace-sidebar-group` 只在登记了跨组拖放时渲染（`workspaceDropGroupKey`、`hostHeaderDropGroupKey`），未登记时 DOM 与上游一致。
- 松手在两行之间（行距 6px）时按 12px 内最近的一行决定目标分区。这个就近判断只用于分组和未分组列表里真正的行间空隙：指针下面必须是列表容器或放行的那一层（不是横幅、按钮或其他非分区元素），而且上下最近的行（12px 内）都得是分组或未分组的行；挨着置顶区的行或标题时不算跨组拖放，交回上游处理。
- 跨组拖放保留当前排序方式：只有手动排序时才写排序，而且只给被拖的行写，取新邻居有效排序值（`manualOrder ?? sortOrder`）之间的值，不把整个列表重新编号；邻居排序值相同，或两者之间已经放不下一个严格居中的值（间隔小于 1e-6，或在这个数量级上只剩几个浮点精度单位，比如同一个空位反复拖放几十次后），才只把目标分区按当前显示顺序、被拖的行放在松手位置，重新编号，结果正好落在松手处。只重编号松手处那一段连续的目标分区行，新值放在全列表里这一段上下两侧其他分区的行之间（两侧都有就均分，只有一侧就按步长 1000 往外排），其他行的排序值不变，所以切换到合并分区的分组方式（比如不分组）时，其他行的相对顺序不变；只有两侧其他分区的行之间也放不下（比如所有行排序值都相同）时，才退回从分区自己的最大值开始、步长 1000 的整段重新编号，这种情况下其他分组方式里的顺序可能变，是数据本身没有空间造成的；分区里不显示的行（比如隐藏默认分支）按手动顺序（`manualOrder ?? sortOrder`）留在原位，插入点是被拖的行在显示列表里前一行的正后方（拖到最前时是第一行的正前方），所以放到末尾时只写被拖的行，不会因为隐藏行排在后面而重新编号整组；被重新编号的邻居只写排序、不改分组，回滚恢复原值。其他排序方式只写分组，和上游跨组拖放一样，也不切换成手动排序。
- 工作区右键菜单的分组项（钩子 `worktree-menu-groups.ts`，直接接收菜单模型里的字段名）：host-directory 模式下按工作区的有效分组判断（自己的分组、否则项目的分组、否则无），“移入分组”只列同一主机的分组，选中后移动这个工作区本身（写它的 `sidebarGroupId`，走跨组拖放的写入和回滚，不改排序），“移出分组”写显式 `null`。多选时右键选中的行打开的是批量菜单，上游在批量菜单里不显示分组项，这里一样，所以不会只移动右键的那一行；右键选区外的行时选区收成这一行，菜单只作用于它。fork 通过 `renderSidebarContextMenu` 加的单行项（隐藏的工作区、从 Orca 移除）在批量菜单里不显示（`WorktreeContextMenuView.tsx` 一行判断）。其他分组模式仍是上游的项目级操作，只是列表去掉 `moveProjectToGroup` 会拒绝的其他主机分组。
- 遗留数据：`sidebarGroupId` 指向已删除的分组、指向其他主机的分组，或显式 `null` 时，显示、拖放和菜单都按未分组处理，读取时判断，不做迁移，不改存储，直到用户移动它。
- 两次拖放互相独立地排队：上一次的写入和回滚全部结束后，下一次才按最新状态规划并写入；上一次失败不影响下一次。插入位置仍按松手时看到的行计算。
- 创建弹窗从分组打开时，主机和分组就是该组。从侧栏空白创建时，按当前主机取当前工作区（同 id 工作区在两台主机上时不会取错），取它的主机和分组；默认主机用侧栏默认主机。状态看板和指定仓库的创建不改。新建的 git 工作区在完成后写入这个分组；弹窗打开后改选了另一台主机上的项目时，不写入原来那一组（它在别的主机上）。

## 界面中文

fork 新增的界面文字（从 Orca 移除、已移除和隐藏的工作区、设置里批量移除项目、跨组拖放的提示、「主机」分组模式和「仅取消分组」、删除工作区的「同时删除文件夹」和保留文件夹的文案、源代码管理的工作区仓库、历史会话的「其他已配置主机」和「全部收起」、父目录导入提示）的英文在 `src/fork/i18n/en.json`，中文在 `src/fork/i18n/zh.json`。渲染进程登记时（`src/fork/i18n/locale-overlay.ts`）把两份分别合进 en 和 zh 语言包：只补缺少的键，上游已有的条目优先；其他语言经 i18next 的英文回退拿到英文。上游的 `en.json`、`en-runtime-required.json` 和 `zh.json` 都与上游一致，上游文件不翻译任何 fork 键。

工作区右键菜单的「休眠」「删除所选」和数量写法由上游翻译（`auto.components.sidebar.workspaceBatchActionLabels.*`），SSH 连接状态名用上游 #34680 的 `settings.ssh.status.*`，fork 不再另做标签层。删除 SSH 目标对话框里上游写死的 `Remove` / `Removing` 仍经钩子 `ssh-target-remove-labels.ts` 翻译成“删除”/“正在删除”；没有登记时原样用上游的英文。

fork 代码统一用 `src/fork/i18n/fork-translate.tsx` 的 `forkTranslate` 翻译。上游的提取检查（`config/i18next.config.ts`，与上游一致）只认 `translate` 等函数名，看不到 fork 键。`src/fork/i18n/fork-keys-catalog.fork.test.ts` 检查：键是字面量，或来自测试读取的带类型常量表（目前没有），不能是模板字符串；每个键都有英文和中文；fork 代码不直接调用 `translate`；上游文件不引用 fork 键。

在不依赖界面的代码里登记的标签（`register-mode.ts` 的「主机」分组模式和「仅取消分组」选项）在那里是英文，渲染进程由 `src/fork/sidebar/mode-labels.tsx` 换成随语言取值的 getter。`mode-labels.tsx` 监听 i18n 的 `languageChanged`，增加 `sidebar-group-mode.ts` 里的标签版本号。上游的 `SidebarGroupByToggle` 只调用 fork 的 `useSidebarGroupByOptions`，`use-section-rows.ts` 只调用 `useSidebarGroupModeLabelsVersion`，两者都用 `useSyncExternalStore` 订阅这个版本号，切换界面语言后分组菜单和置顶等标题立即换成新语言。fork 里所有 `useSyncExternalStore` 都传第三个参数 `getServerSnapshot`：上游测试用 react-dom/server 渲染侧栏，缺了会报 `Missing getServerSnapshot`（`src/fork/server-snapshot.fork.test.tsx` 检查）。没登记模式时版本号不变，菜单和上游一样。

## F003 / F025 批量导入

交接阶段把选中路径写入 `importedExternalWorktreePaths` 和 `externalWorktreeInboxBaselinePaths`。运行时导入登记了 git 根解析时，用解析出的工作区根代替扫描路径；根和工作区自己的检出相同则不写入。桌面进程不对 SSH 路径做本地 git 解析。

父目录不是 git 仓库、且至少有一个子项导入成功或原本就存在时，才添加父文件夹。同主机同路径已有文件夹则复用并取消归档；新建时用 `createFolderWorkspace` 放进父路径对应的分组。宿主接口不能把已有文件夹改到另一个分组。添加父目录失败只提示，不撤销已导入的子仓库。不自动打开，也不为此启动代理。直接 SSH、没有托管环境时，子项导入在本进程全部失败，父目录因此不会创建。这和当前参考实现一致：桌面导入遇到 `connectionId` 直接记失败，父目录块只在成功数大于 0 时运行，远端创建只走选中的托管环境。

- 运行时导入在 `runtime-nested-repo-import.ts` 的 `results.map(stampImportedWorktreePath)` 一处给每个项目补 `worktreePath`（钩子 `imported-worktree-path.ts`，`register-main.ts` 用 `getGitRepoRoot` 登记，桌面和 orcad 都有）。`getGitRepoRoot` 是同步的，每个项目一次 rev-parse，在 orcad 上会短暂挡住事件循环；改成异步要动上游那一行，所以没改。
- 添加项目后的回调是 `repo-add-actions.ts` 里的 `runForkRepoRegistered(repo, path)`，未登记时返回空，不多 await。git 交接由 `use-complete-git-repo-add.ts` 返回的 `withForkPostImportHandoff(...)` 包一层：回调在上游完成之后执行，上游抛错也执行，错误照旧往外抛。嵌套导入在 `useAddRepoNestedImportFlow.ts` 里用 `noteForkPostImportContext(nestedHandoff(...))` 记下选中的路径和连接（这个文件因此首行加了 max-lines 豁免）。回调的实现在 `src/fork/import/`，按需加载。
- 导入时清归档元数据（见 F048）走 store 的 `updateWorktreeMeta`，运行时（orcad）主机上的元数据写到那台主机。外部工作区收件箱导入把清归档和清隐藏记录并进重新扫描那一行：`reactivateRegisteredImportedWorktrees(...) && fetchWorktrees(...)`，写失败时照旧回滚这次导入。

## F006 授权窗口可拖拽的应用卡片

仅 macOS。fork 应用启动权限助手时多传 `--fork-drag-card`（`open` 不传环境变量，所以用参数）。带这个参数时，授权窗口在检查中、缺权限、权限已齐三种状态都把应用卡片放在文案下方同一个位置（高 42），代替上游顶部 58 的图标，所以状态切换时窗口不跳，检查中也没有空白占位。只有缺权限时卡片接收拖拽：整张卡片可拖，未激活窗口也能拖出；检查中和权限已齐时卡片只显示、不能拖。指定单项权限时窗口保持显示，方便拖卡片。没有这个参数时，图标、文案和点击行为都是上游原样。拖拽助手窗口里的卡片是上游原样。

卡片在 `native/computer-use-macos/Sources/OrcaComputerUseMacOS/ForkPermissionCard.swift`，是上游 `DraggableAppTile` 的子类（`acceptsFirstMouse` 为真，`hitTest` 返回整张卡片，只在缺权限时拖）。`main.swift` 只改三处：`DraggableAppTile` 去掉 `private final`（子类需要）、一行 `ForkPermissionCard.install(...)`、带参数时一行 `showWindow`。TS 侧是 `macos-computer-use-permissions.ts` 的一行 `helperArgs.push(...)`（钩子 `computer-use-permission.ts`，`register-electron.ts` 登记）。Linux 只由 `src/fork/computer-use/permission-card.fork.test.ts` 核对参数和接线；拖进系统设置要在 Mac 上做。

## F007 目录软链可选（已移除）

上游已经覆盖：SSH 浏览用 `[ -d ]` 跟随目录软链，`ls` 失败时非零退出；受管服务浏览对软链做 `stat`。fork 的 POSIX 后半段会把空目录列成一个空名字的 `/` 条目，读不了的目录显示成空目录，所以删掉，回到上游。`src/fork/directory-browse.fork.test.ts` 用上游代码验证目录软链、空目录、读不了的目录和失效链接。

## F010 SSH 重连后重绘

重连 fit 对 `ssh:` 终端先把列数减 1，200ms 后恢复这次记下的尺寸。随后的同尺寸 fit 在脉冲期间被挡住。`remote:` 终端和列数小于等于 2 时不脉冲。从停放模型恢复的完整画面不脉冲。面板当时不可见时先记下，第一次显示再用当时的尺寸脉冲，之后的显示不再补。

三个上游文件各一行调用：`reattach-grid-fit.ts` 在上游的 `await fit.completion` 之后调用 `notifyTerminalReconnectFit(...)`，`session-reconcile-dispose.ts` 的可见恢复调用 `notifyTerminalPaneShown(session)`，`connect-pane-pty.ts` 在 `installPtyInputForward` 之后调用 `holdDesktopResizeDuringTuiRepaint(session)`。读当前载荷、停放模型、可见性和挡住同尺寸 fit 的逻辑在 `src/shared/fork-hooks/terminal-lifecycle.ts`，通知在 fit 完成后的下一个微任务里判断载荷是否仍是当前的。脉冲在 `src/fork/terminal/reconnect-tui-pulse.ts`，由 `register-renderer.tsx` 登记。未登记时三处调用的结果与上游相同。

## F021 / F043 用 Cursor、VS Code 或 Zed 打开远端工作区（Open in 由上游 #33877 覆盖）

上游 [stablyai/orca#33877](https://github.com/stablyai/orca/pull/33877)（修 #30593）用 CLI 参数打开直接 SSH，以及文件就在这台机器上、经 SSH 到达的托管或配对服务器。Cursor 是 `cursor --new-window --remote ssh-remote+<authority> <path>`，VS Code 系是 `--remote ssh-remote+…`，Zed 是 `ssh://` URL。菜单是否可点由上游 `getExternalEditorOpenCapability` 和 `getWorkspaceEditorSshHost` 决定：编辑器是 Cursor、VS Code 或 Zed；托管侧认 `orcadDeployment` 或 `sshAccess` 上的 `sshTargetId`（临时 `runtime-ssh-` 目标不算），并且工作区文件在这台服务器上。主进程再用 `isEditorSshHostForOwner` 核对主机、代次和围栏。fork 不改这条打开路径。Cursor 跟 Zed 一样，在打开方式里配置之后才出现。托管服务器再经自己的 SSH 访问的工作区，以及所有者还没落到这台机器上的路径，跟上游一样保持拒绝。

剩下的 fork 只有托管工作区的端口行：渲染进程登记后，每个检测到的端口有 Forward，打开已有的转发对话框，填上该端口、主机 `localhost` 和进程名。未登记时没有这个按钮。已有的 Forwarded 区不变。实现在 `src/fork/ports/workspace-port-forward.tsx`：端口面板渲染一个 fork 对话框槽位（`local-workspace-ports-panel.tsx` 两行），有 SSH 转发目标时发布一个打开函数；行的悬停按钮和右键菜单各渲染一个槽位读它（`local-port-row.tsx` 三行）。行和分区不多传参数，`local-port-section.tsx` 与上游一致。

## F022 软链目录上的 Cursor 会话（已移除）

上游已经覆盖（#35052）：`matchAiVaultSessionCwdCandidates` 在 `resolveWorktreeInfoFromCandidates` 里也按 `cwdAliases` 的最短剩余路径排序，fork 唯一不同的地方没了。`src/shared/ai-vault-session-worktree.ts` 回到上游。

## F045 远端终端链接文件的 Markdown 预览（已移除）

上游会把终端链接的 `terminalArtifactGrantId` 复制到 Markdown 预览上，预览不再需要单独的授权钩子。fork 的这一段已经删掉。

## F046 终端文件链接留在当前工作区

没有设置开关。本地工作区跟上游：#33304 之后跨工作区打开回到归属工作区，本地 HTML 按链接路由设置打开。下面只说运行时主机（托管 orcad，包括经 SSH 部署的；上游现在每台 SSH 主机连上后都由它的托管 orcad 提供文件）。

上游 #33958 之后，主机对能开终端的客户端授权它上面任何已存在的普通文件（`files.resolveTerminalPath` 返回 `absolute-file`），编辑器、图片和 Markdown 预览都经这份授权读主机的字节，不会读这台 Mac 的同路径文件。终端和对话里的绝对路径、`~/`、相对终端 cwd 的路径、`file://` 都按上游解析。没有工作区认领的普通文件就在点击时的工作区用编辑器打开。终端路径解析和文件授权都与上游一致。

fork 加的部分，未登记时全部是上游行为：

- 工作区外的 HTML 在点击时的工作区开应用内文档预览，不进编辑器源码，不开系统浏览器。上游 #36791 起，`getWorkspaceFilePreviewPlan` 对配对运行时的工作区外路径本来就返回文档预览，`file-preview.ts` 不再改。未登记时 grant 是上游的 `fileAccess: 'terminal-artifact'`。登记后仍先走 `hostFileDocLocation`。终端或对话链接里带授权的 HTML 也走 HTML 分支；上游对只读授权留在编辑器，登记后只读授权仍预览。另一个工作区认领的文档，`buildDocPreviewGrantRequest` 用上游在那个工作区里预览它时的位置，字节走上游的 `files.readDocPreview`。没有工作区认领的文档，grant 的请求根是主机的文件系统根（`/`，Windows 是盘符根），入口是去掉根的绝对路径，root 是文档目录，owner 仍是点击时工作区。页面因此像从 `file://` 打开一样解析路径：同目录、子目录、`../` 以上、别的目录都能引用；F051 让它读到请求根下的任何文件，不弹提示，点开头的文件和软链也照常读。文档目录以外的路径先按文档目录拼一遍再读：根路径（`/assets/app.js`）指的是页面自己的站点（构建出来的单页应用常这样引用），文件系统根上恰好也有同名文件时不会拿错；这样读到的确实不存在（主机回 ENOENT）才回到主机上的那个路径，`../` 引用就是这样读到的。超时、权限、读的时候变了这类失败不再换路径重试，grant 被撤销了也不重试。入口路径按预览 URL 回来的样子写成 `/` 分隔（Windows 主机的反斜杠、重复的分隔符都规整掉）；UNC 共享上的文档没有文件系统根，仍以文档目录为根。`readDocPreviewFile` 在上游 404 的地方改由主进程按绝对路径向主机读：fork 的 RPC `files.hostDocPreview.read` 和 `files.hostDocPreview.readChunk`（`src/fork/main/host-file-methods.ts`），主机上直接调用上游 `files.readDocPreview` 用的 `readAuthorizedDocPreviewFile` / `readAuthorizedDocPreviewFileChunk`：字体和 PDF、超过一次回复的文件分段读（文本 10 MiB、二进制 50 MiB 为上限），限额和上游一样；分段读和上游 `files.readDocPreviewChunk` 一样走 bulk 通道，不占终端和工作区的调用槽。主机没有这两个方法（旧版 fork orcad、上游 `orca serve`，回 `method_not_found`）时，退回逐个文件 `files.resolveTerminalPath`（不带 `crossWorkspace`）拿授权、`files.readTerminalArtifactPreview` 读：文本 512 KiB 为上限，字体读不了。地址栏手贴的工作区外绝对路径或 `file://` HTML 由上游的地址栏解析转成同样的预览。重启后预览照常重读。
- 工作区外的文本在编辑器里打开，不管授权读给不给：超过 512 KiB（`file_too_large`）、解码后超过一次回复（`truncated`）、或者授权因为文件变了而失效（`terminal_file_grant_stale`，还在写的日志就是这样）时，`runtime-terminal-artifact-read.ts` 的两处钩子交给 `src/fork/terminal/large-host-file-read.tsx`，改由 fork 的 RPC `files.hostFile.stat` 和 `files.hostFile.readChunk` 按绝对路径读，不再续授权。先读前 8 KiB：有 NUL 就直接按二进制显示，不把几十 MB 拉过来。分页用上游的 `readFileInChunks`，上限是上游在工作区里分段读用的 50 MiB；CSV/TSV 到了上游切换分页预览的 1 MiB 就用分页预览打开（见下一条）；带草稿的标签照上游在工作区里的做法整份读，表格编辑仍由上游的 1 MiB 预算拒绝。按开始读时的大小读：读完时文件只是变长（`files.hostFile.stat` 带的 dev:ino 没变、更长、读到的第一段和最后一段字节都没变）就算成功，所以还在写的日志能打开；同样大小但改过、被换成另一个文件、被截断，都按上游报「读的时候文件变了」。超过 512 KiB 的标签读完后设为只读（`readOnly` 随会话保存）：授权保存最多 512 KiB，上游在工作区里往远端保存也只到一次请求约 720 KiB，与其编辑后保存失败，不如一开始就只看。图片和 PDF 先走上游的授权预览（`files.readTerminalArtifactPreview`）；超过一次回复（远端约 3 MB，回 `file_too_large`）时，`pageLargeHostPreview` 把同一个文件按上游的严格方式分段读，最多 50 MiB（上游分段读的上限；工作区里的 PDF 在桌面上按范围流式读，没有这个上限，工作区外的还没有）。图片先用上游的 `rasterImageExceedsPreviewLimits` 按需读文件头：尺寸已经超过预览上限的直接报上游的「Image dimensions exceed the preview safety limit」，不先把整个文件拉过来。其他二进制（预览回 `binary_file` 或 `file_too_large`）显示成二进制，和上游在工作区里一样，不再报错。编辑器、对话里的图片和 Markdown 里引用的工作区外图片都经过这里。读的时候文件被改写时按上游报「读的时候文件变了」，编辑器照上游的规则自动重试。主机没有这两个方法时保持上游的错误和续授权。
- 工作区外的 CSV/TSV 到了 1 MiB 用上游的分页预览打开，和工作区里一样能滚动、换分隔符：上游 `readEditorCsvFileContent` 对主机文件没有路由（带授权的整份读，重启后还没授权的去 stat 会被拒绝），开头先问 `readHostCsv`（钩子 `src/shared/fork-hooks/host-file-ranges.ts`，实现 `src/fork/terminal/host-file-csv-preview.tsx`）：工作区外的主机 CSV 由它处理，`files.hostFile.stat` 到了阈值就返回分页预览，否则（更小，或 stat 失败：旧主机、文件不在了）交给传进来的上游整份读，报错也和上游一样，重启后恢复的标签会续授权；别的文件同步返回 null，照走上游。分页预览的 `statRuntimeReadTarget` 和 `readRuntimeFileRange` 开头各一行，工作区外的主机文件按绝对路径走 `files.hostFile.stat` / `files.hostFile.readChunk`（上游的路由对绝对路径直接拒绝），分段校验和上游的 `files.readChunk` 一样。带草稿的标签照旧整份读；主机没有 `files.hostFile.*` 时回到上游经授权的整份读，最多 512 KiB。直连 SSH 连接留下的标签（`expectedExternalSshTargetId`）不归这些钩子，照走上游的拒绝。
- 另一个工作区认领的文件留在点击时的工作区，只读，经授权读（超过一次回复时同上分段读）。`resolveHostWorkspaceFile` 收到别的工作区时，为点击时的工作区向同一台主机要一份授权，路由因此当成工作区外文件处理，不激活归属工作区，也不跳到已打开的同路径标签；HTML 同样开文档预览。目录、点在工作区根上、浮动终端仍走上游。主机不给授权（#33958 之前的主机只授权终端打印过的路径）时保持上游的切换。悬停判断链接是否存在也经过这里，代价是对别的工作区里的路径多一次授权请求，结果进上游的存在缓存。编辑器加载器不把只读、带运行时 id、按绝对路径命名的标签重挂到归属工作区，重启后照常经授权读。
- Markdown 预览和富文本里引用的工作区外图片经主机授权读，和上游对 `chat-image` 的处理一样。
- 同一台主机上，更深的工作区已经可写打开同一路径时，外层可写标签降为只读，标签留在外层。外层还有未保存的修改或草稿时先不改，等它干净了再改；更深的那张自己是只读的就不降级，避免一份可写都不剩。只读随工作区会话保存，重启后仍是只读。不恢复 #33304 删掉的「留在当前工作区」开关，本地 HTML 和文件路由仍跟上游。监视在 `src/fork/terminal/file-link-nested-demotion.tsx`，渲染进程登记后订阅编辑器标签，不改上游打开文件的路由。

直接 SSH（`ssh:` 路由、只有 `connectionId` 的旧行）和运行时背后的嵌套 SSH 不补：上游已经不在桌面上服务 SSH 文件（#27644），这些路径在工作区里也打不开。

钩子在 `src/shared/fork-hooks/host-file-doc-preview.ts`、`host-file-ranges.ts` 和 `kept-host-file-view.ts`。渲染进程由 `src/fork/terminal/host-file-doc-preview.tsx`、`kept-host-file-view.tsx` 登记；编辑器的大文件分段读由 `src/fork/terminal/large-host-file-read.tsx` 登记，工作区外 CSV 的分页预览由 `src/fork/terminal/host-file-csv-preview.tsx` 登记；主进程读取在 `src/fork/main/host-file-doc-preview-read.ts`，只在桌面由 `register-electron.ts` 登记，orcad 不登记；主机上的四个 RPC 方法经 `src/fork/main/rpc-methods.ts` 进 `ALL_RPC_METHODS`，桌面、orcad 和 `orca serve` 都有。上游文件里都是钩子行：`file-preview.ts` 与上游相同。`doc-preview-grants.ts` 在没有工作区相对路径时先返回 `hostFileDocLocation(...)`，未登记再走上游的 `terminal-artifact` grant。`doc-preview-file-reader.ts` 在算不出工作区参数时是 `readHostDocPreview(...) ?? notFoundOutcome()`。`terminal-file-open-routing.ts` 的 HTML 分支条件是 `previewsHostFiles() || !hostGrant?.readOnly`。`terminal-host-workspace-file.ts` 在返回之前取钩子结果，`useEditorPanelFileContentLoader.ts` 的重挂条件 `&& !isKeptHostFileView(...)`（文件因此首行加 max-lines 豁免），`runtime-file-read-client.ts` 在 `chat-image` 分支后读图片，`runtime-terminal-artifact-read.ts` 授权读的 catch 开头和 `truncated` 判断之前各问一次 `readLargeHostFile(args, …)`，二进制分支把上游的预览调用存成 `preview`，返回 `pageLargeHostPreview(args, preview) ?? preview`，`csv-file-content.ts` 开头问一次 `readHostCsv(...)`，`runtime-file-range-client.ts` 的 `statRuntimeReadTarget` 和 `readRuntimeFileRange` 开头各问一次 `statHostFileRange` / `readHostFileRange`，`runtime-rpc-call-queue.ts` 的 `isBulkReadRuntimeMethod` 开头一个 `if (isHostFileBulkRead(method))`（常量判断，只认 fork 的两个分段读方法名）。未登记时钩子同步返回 null，不多一次 await。

沙箱 webview 的 `browser-window-close-preload.js` 和 `doc-preview-link-preload.js` 跟主进程打在同一次 Rolldown CJS 构建里。Rolldown 1.2.14 会抽出 `chunks/rolldown-runtime-<hash>.js`，沙箱 `preloadRequire` 加载不了这个相对路径，控制台就是 `Unable to load preload script` 加上 `module not found: ./chunks/rolldown-runtime-….js`。`createSandboxedPreloadRuntimeInlinePlugin`（`src/fork/main/sandboxed-preload-runtime.ts`，`electron.vite.config.ts` 在主进程构建插件里加一行）在 `generateBundle` 里把这份运行时内联进这两个入口，其它入口仍引用原来的 chunk。内联之后如果这两个入口还含有 `require("./chunks/`，或者不在 bundle 里，构建直接失败；运行时 chunk 自己再去 `require` 另一个 chunk 也会被同一条检查抓住。测试是 `src/fork/main/sandboxed-preload-runtime.fork.test.ts`。2026-11 按上游 4365547899 的构建配置复查过：去掉插件两者仍引用运行时 chunk，所以保留。

## F051 文档预览不要授权

上游的 HTML 文档预览默认只让页面读入口文件（文档在工作区子目录时再加上文档目录），其余文件要用户在「This preview wants to read files in …」横幅里点「Allow folder」。fork 不要这一步：每个 grant 铸好后立即放行它的整个请求根（工作区预览是工作区根，工作区外的文档是主机文件系统根，见 F046），页面引用的同目录、子目录、`../` 文件都直接读，横幅不会出现。点开头的文件、指向请求根内别处的软链照常读。本地桌面的文档预览也一样放开。上游其余的预览限制不变：页面的网络请求被 CSP 和请求拦截挡住、下载被拦、点外部链接仍先确认、工作区预览的规范路径不能出工作区根（软链指到工作区外读不到）。但上游注释写明 Electron 43 的 DNS 预取绕过这两层：放开之后，一个被预览的页面理论上能读到主机上这个用户能读的任何文件，再用 `<link rel="dns-prefetch">` 把内容编进域名查询带出去。上游只放行入口文件就是为了限制这个；这份自用版本按用户的要求接受它，只预览自己信得过的 HTML。

钩子 `src/shared/fork-hooks/doc-preview-access.ts`：`doc-preview-grant-ipc.ts` 铸 grant 后一行 `openDocPreviewAccess(grant.id)`。实现 `src/fork/main/doc-preview-open-access.ts` 用上游的 `authorizeDocPreviewDirectory` 放行请求根（传入口路径的第一段，它所在的目录就是请求根），只在桌面由 `register-electron.ts` 登记。未登记时什么都不做，grant 照旧只到入口。

## F047 工作区里的多个仓库（只读）

一个需求目录常常是 Orca 工作区，根上还有好几份 git 检出（前端、客户端、后端、控制台各自的 feature 分支，很多是 `git worktree add`）。上游的源代码管理只看根仓库，嵌套仓库里的改动看不见。

源代码管理多一个范围开关，按工作区记在本地：当前仓库（和上游完全一样）或工作区仓库。工作区范围里每个仓库一栏，有相对路径、分支、领先/落后，以及已暂存、未暂存、未跟踪、相对主干的提交。点文件打开 diff。比较目标存在这台主机上，键是主机、工作区绝对路径、仓库相对路径和分支；没有覆盖时用上游的 `getBaseRefDefault`（`origin/HEAD`，然后 `origin/main`、`origin/master`），再没有就显示未设置。不写工作区自己的 baseRef，也不查 MR/PR。范围表只记选了「工作区仓库」的工作区，切回当前仓库就删掉这一项；换工作区时范围按工作区 id 同步算出，第一帧不会沿用上一个工作区的范围。写 localStorage 失败不在点击里抛错。

发现只看工作区根下的第一层：根仓库自己，加上直接子目录里带 `.git` 目录或文件的检出（`git worktree add` 的 `.git` 是文件，也算）。名字以 `.` 开头的子目录和 `node_modules` 跳过。目录软链不跟，就算目标还在工作区里面也不跟，避免深层检出借软链出现在第一层。发现到的仓库不再往下扫，所以子仓库里的子模块不会再各占一栏。第一层以下的检出（例如 `svc/api` 这种 worktree）不单独成组，父目录仍可能以未跟踪目录出现在根仓库的变更列表里。根上的 `.gitignore` 不影响这一层（嵌套检出经常被忽略）。数量上限、超时和逃出工作区的检查还在，按 realpath 去重。根仓库自己也占一行。根仓库 `.gitmodules` 里还没检出的子模块不单列，界面收进最后一栏、默认收起的「其他」。已经检出的路径（含第一层以下、目录里已有 `.git` 的）不收进「其他」。

根仓库这一栏只去掉已经单独成栏的嵌套仓库的未跟踪条目（正好是该仓库根，或在它里面的未跟踪路径）。嵌套检出被报成未跟踪目录才去掉。已暂存或未暂存的 gitlink（根 `.gitmodules` 里已初始化的子模块有新提交，或指针已暂存）是根仓库自己的改动，留在根分组里，并算作有改动。根仓库自己的未跟踪文件、以及只是路径前缀撞车的文件，都留着。比较在 fork 的状态读取里做，不改上游 `git.status`。根仓库这一栏和上游 `git.status` 一样带共享链接路径；嵌套仓库不带（那些路径相对根）。

有未提交改动、或领先比较目标的仓库排在前面并自动展开；没有改动的收起。根仓库固定在最上面：它是打开的这个工作区，收起时只有一行，下面的仓库按改动集合重排时它不跳。「其他」固定在最后。栏目标题直接显示未提交数量和领先/落后。排序只看「哪些仓库有改动」这个集合，条数变化不重排。用户手动展开过的栏不会被自动收起，手动收起的也不会被下一轮自动展开。这一栏按工作区 id 作为 key，换工作区时不把展开状态带到同名子仓库上。「只显示有改动的」记在本机 localStorage（`orca.fork.source-control-only-changed`，整个面板一份，不按工作区分），缺省为关。状态还没回来、或者比较还在算的仓库先留在列表里，避免比较结果到达前被滤掉。比较已经结束但不是 ready（出错、基线无效、没有合并基线、HEAD 还没出生）且没有未提交文件时，视为没有改动，打开过滤后不再一直留着。`git status` 读失败的仓库写出原因，排前面并展开，「只显示有改动的」不滤掉它。分支比较给不出结果（基线不存在、没有共同祖先、比较出错）时写出原因。列出仓库失败时写出原因，不一直停在「正在查找仓库…」。

新 RPC 是 `git.workspaceRepositories` 和它的 `status`、`branchCompare`、`diff`、`branchDiff`、`setCompareTarget`。不往上游的 `git.status` 等参数里加 `repositoryPath`：旧主机会丢掉不认识的字段，静默返回根仓库。方法在 `src/fork/main/git-workspace/methods.ts`，和 F046 的主机方法一起由 `src/fork/main/rpc-methods.ts` 汇成 `FORK_RPC_METHODS`，`src/main/runtime/rpc/methods/index.ts` 一行展开进 `ALL_RPC_METHODS`；以后 fork 加 RPC 方法只改这个 fork 文件。参数 schema 在 `src/fork/git-workspace/params.ts`，直接扩展上游的 `GitDiff`、`GitBranchDiff`、`GitBranchCompare`；生成的 `rpc-params-catalog.generated.ts` 把这些方法列为未编目，`rpc-params-type-parity.ts` 只在 `Exclude<…>` 那一行加上 `ForkRpcMethodName`（同在 `rpc-methods.ts`）。处理函数从 RPC 上下文里的运行时解析工作区目标（`resolveRuntimeGitTarget` 在运行时上是 protected，用 `in` 加 `typeof` 的类型守卫检查后调用；`methods.fork.test.ts` 用真的 `OrcaRuntimeService` 跑一遍，上游改名会让测试失败），然后把上游的 `RuntimeGitStatusCommands`、`RuntimeGitDiffCommands` 原样用在嵌套仓库的路径上：路径规范化（`normalizeRuntimeGitRelativePath`）、WSL 路由、传输上限都跟上游 `git.status`、`git.diff`、`git.branchDiff`、`git.branchCompare` 一致。能力 `fork.git.workspace-repositories.v1` 放在 `src/shared/fork-hooks/git-workspace-capability.ts`，在 `protocol-version.ts` 的 `RUNTIME_CAPABILITIES` 中间展开一行，这样 CLI 工程不用包含 `src/fork`。渲染进程对本地桌面视为已有这个能力；配对或托管主机用 `runtimeEnvironmentSupportsCapability` 探测。`repositoryPath` 不能逃出工作区，realpath 也不能顺着软链跑出去，并且必须在这次发现结果里。

`ssh:` 和 `runtime:` 的工作区在读任何文件之前就拒绝：桌面进程不能按远端路径扫自己的磁盘。托管 SSH 主机的请求目标是 `environment`，方法在那台主机的 orcad 上执行，开关等能力探测通过再打开。上游从 1.4.225 起每台 SSH 主机都在连接时部署或转换成 orcad，工作区行变成 `runtime:<环境>`，F047 按 environment 目标走那台主机的 orcad。桌面上仍直接标成 `ssh:` 的仓库，以及只有 `connectionId` 的旧 SSH 行，是还没转换或被拒绝接管的主机，上游自己的源代码管理在这些行上也读不了 git：开关灰掉，提示重新连接这台主机。上游已经删掉桌面上经 SSH 跑 git 的路子（#27215、#27477、#27644），fork 不另做 SSH git provider。配对或托管主机探测不到能力时提示更新主机，探测本身失败时提示连不上；面板开着时每 15 秒再探一次，重连或升级之后不用切换工作区。

默认比较目标按仓库、分支（分离 HEAD 也算一档）和 HEAD 记住，五分钟过期，最多留 64 条；手动刷新或 HEAD 变了立刻重算。分支比较在第一次、刷新、HEAD 或比较目标变化时做；状态里带一次 rev-parse 得到的基线提交，它变了就重比，否则满一分钟再比。这是每次状态轮询、每个仓库多出来的一次 background rev-parse：比较目标解析只给出 ref 名，没有可以共用的 oid。比较目标的写入用上游的 `withFileTransactionLock` 跨进程串起来（桌面和共用 userData 的 `orca serve` 同时写也不丢），锁里读、合并、写临时文件再 rename。文件在但读不了（坏 JSON、不是这一版的格式、不是缺文件的读错误）就不覆盖。读不加锁，而且是异步的，状态轮询不在主进程里同步读文件。比较目标保存失败（主机拒绝、文件读不了）时输入框下面说明原因，草稿留着。

轮询和上游状态轮询一样（上游的 `createCoalescedPollRunner` 加 `installWindowVisibilityInterval`）：窗口不可见时停，显示时立刻补一轮；同一时间只跑一轮，一轮跑得慢就按耗时拉长间隔；失败按 2 秒起翻倍退避，最多 30 秒。手动刷新只强制一轮。面板切走再回来时沿用上一次比较到哪里，不把所有仓库重比一遍。内容没变的结果不触发重画。状态和 diff 请求只查成员：一分钟内的上一轮列表（包括超时截断的）都能用，查不到再按列表的 5 秒缓存判一次（同一个工作区最多 5 秒重扫一次），仍不在就拒绝。列出仓库是 5 秒缓存，超时的结果不当完整列表用。远端调用的超时是列出仓库 20 秒（发现本身最多 15 秒，扫描超时也能带着 `timedOut` 回来），其余 15 秒。

diff 标签只有在这条路由和能力允许时才先要清单；发现失败或主机没有这个方法就退回上游，并短时间记住，避免每个文件再探一次。已经确定落在嵌套仓库里的路径不会改拿根仓库的 diff。面板记下的仓库清单超过一分钟就先重新发现；发现失败时有旧清单按旧清单分流。暂存区的改名带上旧路径（加仓库前缀），和上游一样只在暂存区用。嵌套仓库里的冲突文件按普通 diff 只读打开，不走上游按根工作区跟踪的冲突流程；根仓库的冲突仍走上游。

上游文件里：`panel.tsx` 只把 `return (` 改成 `return renderSourceControlScope(`（钩子 `source-control-scope.ts`），JSX 和结尾不动；fork 面板自己调用上游的 `useSourceControlWorktreeContext`，拿到和上游面板同一个工作区、同一条路由；文件夹工作区仍走上游原来的提前返回。加载 diff 的 `useEditorPanelDiffContentLoader.ts` 把上游的读取写成 `readUpstream` 函数，后面两行：一行拼输入，一行 `forkWorkspaceRepositoryDiff(fork, readUpstream) ?? readUpstream()`（钩子 `workspace-repository-diff.ts`，未登记时同步返回 null），上游的三元表达式一行没动，没有类型断言。两个钩子都由 `src/fork/source-control/register.tsx` 登记。

这一步只读，暂存、取消暂存和提交不做。服务端可以把嵌套仓库的目标原样交给上游的 `RuntimeGitStagingCommands` 和 `commitRuntimeGit`，旧主机用一个新的能力挡住即可；难处在界面：上游的提交还有按工作区保存的草稿、合并或变基进行中的处理、钩子失败后的恢复提示、进行中的 git 变更检测和 AI 生成提交信息。在 fork 的列表里另做一套，要么少掉这些边界（出错时用户不知道仓库处于什么状态），要么复制一份上游提交流程、以后跟着漂移。需要在嵌套检出里提交时，把它当成自己的 Orca 工作区打开（`git worktree add` 的检出可以直接导入），用上游完整的面板。

## F048 删除工作区默认保留文件夹

删除工作区对话框对 git 工作区（含一次删多个、含子工作区）多一个「同时删除文件夹」勾选，默认不勾。不勾时只从 Orca 移除：复用「从 Orca 移除」的归档（`isArchived: true`），不调用 `git worktree remove`，目录留在磁盘上。勾上之后仍是现在的硬删除，文案也仍是「会从 git 删除并删掉工作区文件夹」，未提交的改动那句警告只在勾上时出现。

文件夹工作区本来就只删 Orca 里的记录、不删目录，对话框不显示这个勾选，确认仍走原来的路径。

软删除写成归档，是因为下次 git 扫描会合并已有元数据：`isArchived` 还在，侧栏不会把同一行立刻加回来，也可以从「已从 Orca 移除」里恢复。不用 forget-local：那会删掉元数据，下一次列表把这行当成新工作区加回来，归档标记是默认的否。git 里的 worktree 登记还在，目录也还在，也不另做「`git worktree remove` 但留下目录」。

没有所属仓库、主机对不上、或扫描时对不上原来的 id / 身份键时，元数据里的 `isArchived` 写不进去或读不回来。软删除另外在本机 `localStorage`（`orca.fork.archived-workspaces`）记下一条隐藏记录。有所属仓库时按工作区 id（路径写法折叠后比较）、身份键和主机对上。没有所属仓库时再按规范化路径对上，同一台主机上换成另一个仓库 id 也对得上。记录和候选行两边都写了主机时，路径记录也必须是同一台主机，所以一台 SSH 上的孤立行不会藏起另一台主机的同一路径，也不会藏起另一台主机上有所属仓库的活行。某一边没有主机时仍按路径对上：占位行或旧记录可能还没标主机，宁可继续藏着，也不要把软删除的行漏回活动列表。强制刷新和普通 worktree 扫描都在合并进侧栏之前套上这条记录（`fetched-worktree-merge.ts`）。SSH 终端水合占位、运行时会话占位，以及已知 SSH 工作区的回退列表（不经过那次合并）也套上。对上的行标成归档，活动列表不显示，已移除列表里可以恢复。恢复和撤销会先删掉这条记录。

新建工作区成功（`sidebar-pending-layer.ts` 一行）、导入成功（添加项目、选中的关联工作区、外部工作区收件箱）会清掉同一条路径上、按上面的规则对得上的记录，避免以后在同一路径再建一个工作区时被悄悄藏起来。只清这条记录不够：profile-state 里同一 repo+path 的元数据还会把软删除写下的 `isArchived: true` 合并进新行。所以桌面新建（`worktree-remote.ts`）、运行时新建（`runtime-local-worktree-materialization.ts`）和预置根目录（`provisioned-root-checkout.ts`）在新的 `instanceId` 旁边展开一行 `...reusedPathUnarchiveMeta()`，把 `isArchived` 写成否（钩子 `reused-path-unarchive.ts`，`register-main.ts` 登记，桌面和 orcad 都有；未登记时不写）。导入在重新扫描之前经 store 的 `updateWorktreeMeta` 对这条路径写 `isArchived: false`，运行时主机上的元数据也写到那台主机。发现扫描补上缺失的 `instanceId`、以及给已经不在的父工作区轮换血统，都不清归档，所以普通刷新仍把软删除的行留在已移除里。任何硬删除在宿主确认删除之后清掉隐藏记录（`dispatch-worktree-removal.ts` 一行），对话框、跳过确认、强制删除和清理都经过这里；硬删除成功后元数据本来就会丢掉，不会为了清归档再写回去。软删除不写「同时删除文件夹」的记录。

「不要再问」只跳过对话框。登记了这个钩子之后，跳过确认的删除也是软删除：`delete-worktree-flow.ts` 的两条跳过确认路径各一行 `skipConfirmHardDeletes`，git 工作区只归档并回报，文件夹工作区交回上游删除（本来就不删目录）。不会因为上次勾过「同时删除文件夹」就在以后静默删目录。没登记时（上游测试）跳过确认仍是硬删除。勾选和「不要再问」一起确认时，这一次硬删除，之后的跳过确认仍是软删除。

所属项目按主机查，和上游删除一样用 `findRepoForHost`，不在同 id 的项目之间猜。查不到所属项目的行当作 git 工作区，只归档，不交给 `git worktree remove`。对话框确认时目标列表已经变了，上游的确认函数会提示并关掉对话框，这时不归档也不硬删除。

硬删除失败后的强制删除（`canForceDelete`）不显示「同时删除文件夹」，文案是上游的硬删除。Force Delete 仍会删目录。

软删除不丢掉编辑器里还没保存的内容，也不关这些标签。对话框在不勾选时不显示「未保存的编辑将被丢弃」。缓冲区留到用户自己关标签。

一次归档多个 git 工作区只弹一条汇总提示，不逐行提示。单行仍是原来的「已移除」和撤销。

命令行和配对客户端的 `worktree.rm` 不经过这个对话框，仍会硬删除文件夹。

`DeleteWorktreeDialog.tsx` 首行加 `/* oxlint-disable max-lines -- fork: hook call only */`，上游代码都在原位。fork 只有一次 `useWorkspaceFolderDeleteDialog(...)`（`src/fork/sidebar/workspace-folder-delete.tsx`）、两个确认处理函数开头各一个三行提前返回、描述 / 改动警告 / 未保存提示三个属性、子工作区提示的一个属性和勾选框一行。子工作区提示（`DeleteWorktreeLineageNotice.tsx`）把两处 `translate(` 换成 `title.t(` / `body.t(`（`keptLineageText`）：保留文件夹时给出 fork 文案，否则就是上游的 `translate`。行为由 `registerForkWorkspaceFolderDelete` 打开；没登记时没有勾选，确认仍硬删除。子工作区在软删除时只归档，不按硬删除那样先删子级。

## F049 从 Ego Lite 导入 Cookie

设置里「会话和 Cookie」的导入菜单，在本机发现 Ego Lite 时多一项「从 Ego Lite」。有多个配置时和 Arc 一样出子菜单。没安装，或配置目录里没有 Cookies 库时不显示这一行，和没装的 Chrome 一样。点选之后走上游的 Chromium 导入：快照、解密、合并、失败提示，菜单底部仍是「Google 登录信息未导入」。Safari 和从文件导入不改。

主进程登记（`src/fork/main/ego-lite-cookie-detection.ts`，桌面和 orcad 都经 `register-main.ts`）把 Ego Lite 的定义追加进上游的 `CHROMIUM_BROWSERS`，已有同名 family 时不追加，换不掉 Chrome 或 Arc。上游的发现、配置切换和取密钥都直接读这张表，相关上游文件不改。orcad 也登记，远端导入才会在那台机器上发现浏览器。`src/fork/ego-lite-cookie-browser.ts` 在主进程和渲染进程都登记：设置行的名字 `BROWSER_FAMILY_LABELS['ego-lite']` 用 `??=` 补上（上游以后有了就用上游的），导入提示名单由 `browser-cookie-import-sources.ts` 一行展开钩子 `chromium-cookie-browsers.ts` 的结果。会话来源的 family 类型在 `browser-workspace-types.ts` 多一个 `'ego-lite'`。未登记时发现结果、提示名单和设置行都与上游一致。

macOS 根目录是 `~/Library/Application Support/Citro Labs/ego lite`，`Local State` 和各个配置直接放在这下面。钥匙串通用密码的服务名是 `ego safe storage`、账户是 `ego`，都是小写；不是按显示名拼出来的 “Ego Lite Safe Storage”。Windows 根目录是 `%LOCALAPPDATA%\Citro Labs\ego lite\User Data`，比 macOS 多一层 `User Data`，和 Chrome 相同；解密仍读这份 `Local State` 里的 DPAPI。这两处路径分别对过 SweetCookieKit 的目录和 citrolabs/ego-lite 的 Windows 问题记录。Linux 还在官方路线图上，不设根目录。Cookie 文件先找 `<配置>/Network/Cookies`，没有再找 `<配置>/Cookies`。配置名单来自 `Local State` 的 `info_cache`，不单独解析 Space。

菜单文案沿用上游的 `From {{value0}}` / `从 {{value0}}`，填进去的名字是 `Ego Lite`。导入之后会话来源的 family 是 `ego-lite`，设置行显示 Ego Lite。

## F041 普通目录的终端生命周期

上游的 `resolveFolderWorkspaceSelector` 已经解析 `folder:<id>`，fork 不再有自己的解析器。剩下一处：exact stop（让单个窗格休眠）刷新存活状态时，文件夹工作区不在 resolved map 里。`worktree-terminal-stop-targets.ts` 在上游取列表那一行之后加一行 `appendMissingTargetWorktree(resolvedWorktrees, worktree)`（`src/fork/main/folder-stop-target.ts`，用上游的 `includeTargetResolvedWorktree`），把这个目标补进去。上游的休眠路径本来就这样做，只有 exact stop 漏了，可以报给上游。

## F044 全部主机时经 SSH 的 Orca 服务器（已移除）

上游已经覆盖（#31226）：保存的环境记录对 SSH 一律带 `connectionDependency: 'ssh-tunnel'`（`runtime-environments.ts` 里的收窄）。全部主机扫描按这个字段给 SSH 隧道 15 秒，其余 3 秒。fork 的超时回退已删除，`src/main/ipc/ai-vault.ts` 回到上游。

## 历史会话（已登记）

- 列表默认看所有主机：本机加上已保存的运行时环境（托管 orcad、配对的服务器）。直连 SSH 的工作区上游不扫会话历史，Linux 服务器上的历史要经托管 orcad。多台主机先有可折叠的主机行，行名用主机菜单里的名字（托管 orcad 服务器显示保存时起的名字，不是环境 id），行上的数字是这台主机的会话数；下面是完整目录，长目录换行。只有一台主机时不重复主机行。
- 侧栏里新出现的主机行和目录默认收起，展开过的在渲染进程重载前一直记得。`/resume` 打开的会话历史对话框保持上游的展开状态：每次打开都是新面板，键盘只在看得见的会话行之间移动。标题栏的按钮一次收起主机和目录，只作用于它所在的面板。
- 上游面板的折叠集合和切换都不改。fork 只记一份「这个分组的折叠含义是否反过来」，显示时与上游集合做异或，所以不需要往上游的过渡状态里加写入口，也没有跨面板的全局变量。目录分组的键总带着主机，所以第二台主机的会话到了、或只选一台主机时，展开过的目录仍是展开的。上游集合满 512 条时丢掉最早的键；侧栏里它记的多是展开过的分组，所以切换超过 512 个分组后最早展开的那个会重新收起。
- 全文搜索保持命中顺序。多台主机的命中在行上标出来源，由上游 #31261 提供（环境名和 i18n 提示）。索引状态只在上游的设置「智能体会话搜索」页里看。
- 主机菜单把没有会话、不是当前工作区所在、没连上、也不是当前选中的主机收进「其他已配置主机」。「有会话」包括这个窗口里此前列出过会话的主机，选中某一台主机后其他有会话的主机不会跳进子菜单；从子菜单选中的主机移到主列表，按钮上仍是保存时起的名字。「连上」看托管 / 配对的运行时服务器的连接状态；上游菜单只列当前工作区的 SSH 主机，按 SSH 连接判断已经不起作用。上游菜单那行 `hostOptions.map(` 不改（改了会让上游的 host-list-render 计数检查失败），主列表之外的主机经 `forkOtherVaultHostsMenu` 交给子菜单。
- 面板不另显示扫描提示和主机数量：扫描中有上游刷新按钮的转圈和「Scanning sessions」，主机数从主机行就能看出来。
- 上游文件里：`AiVaultPanel.tsx` 调用 `src/fork/ai-vault/panel-hooks.tsx` 的 `useForkVaultHostMenu`（主机菜单）和 `useForkAiVaultGroups`（主机行、折叠的分组和作为 `headerAction` 传入的全部收起按钮），面板加上这些行后按 max-lines 的算法是 391 行，没到上限，不需要豁免；`AiVaultPanelControls.tsx` 在登记后用 `ForkVaultGroupHeader` 画分组标题，主机菜单末尾一行 `forkOtherVaultHostsMenu`（`src/fork/ai-vault/panel-controls.tsx`）。`registerAiVaultListPresentation` 运行之前两个钩子都原样返回输入。默认主机范围经钩子 `ai-vault.ts` 读（`ai-vault-host-scope.ts` 一行）；完整目录标题经同一个钩子，`src/shared/ai-vault-session-filters.ts` 的 `folderLabel` 先问登记的读取函数。
- `src/fork/ai-vault/agents-panel-empty-profile.fork.test.tsx` 用空配置渲染整个「Agents」面板，检查不会报 React #185（Maximum update depth exceeded）：fork 代码以前在 zustand 选择器里每次新建数组，`useSyncExternalStore` 一直重渲染，右侧栏崩溃。它在 `act` 里渲染，不用真实时间等待（上游的 ast-grep 门禁不许测试里用真实时间）；选择器每次返回新数组时它仍会报 Maximum update depth exceeded。`agents-panel-multi-host.fork.test.tsx` 用本机加几台托管的 Linux 服务器渲染同一个面板（主机行、折叠、全部收起、主机菜单和选中单台主机后的菜单），钩子行被合并冲掉时会失败。
- 扫描进程的内存按本机内存计算，下限仍是 384 MiB（`session-scanner-service-spawn.ts` 读 `readAiVaultServiceHeapMiB(384)`）。工具输出按块写入索引，索引版本在上游之上 +1，旧的截断索引会重建。策略随扫描进程的 init 消息下发（可选字段 `fork`，未登记时不带），`session-scanner-service-entry.ts` 一行 `applyAiVaultForkServicePolicy`。
- 启动时浏览器分区的代理改成后台应用，不再挡住第一个窗口。每个分区在排队时同步标成「代理未就绪」，请求守卫会扣住该分区的请求直到代理生效，失败则取消请求，所以不会有请求先走直连。上游的 try/catch 保留，只把等待的那一行换成 `deferStartupProxyWait(...)`。`src/fork/main/startup/browser-session-proxy.fork.test.ts` 验证这一点。
- 没有另做一份主机扫描缓存。Linux 上用合成会话量过：上游冷扫描已经能在一次扫描里给出列表，热扫描大约 10 毫秒；旧的 150 毫秒提前返回在冷扫描时是空列表。数字记在 [docs/fork/parity/ai-vault.md](docs/fork/parity/ai-vault.md)。

## F024 Skill 安装来源（已放弃）

不再移植自定义仓库。skills 仍从 `https://github.com/stablyai/orca` 安装，内容与上游相同。fork 构建不能把本次构建提交当作 clone ref：该提交不在上游，`npx skills add` 会报 Failed to clone repository。

上游只有渲染进程拼 `npx skills add`（`src/renderer/src/lib/agent-feature-install-commands.ts`，读构建常量 `ORCA_BUILD_COMMIT`），安装和更新是同一条命令。fork 的 ref 是上游基线提交，只写在 `src/fork/skills-source-commit.ts` 一处：`electron.vite.config.ts` 在渲染进程的 define 里多一行 `...forkRendererDefines()`，把 `ORCA_BUILD_COMMIT` 换成这个提交。上游 CLI 拷贝内置技能文件，不按提交克隆，不需要 pin。生产 CLI 代码不引用 `src/fork`。审计表和内部标识扫描也把这个提交当作上游基点。

同步后运行 `node fork/scripts/sync-skills-source-commit.mjs` 重写这个文件：先 `git merge-base HEAD fork/base-upstream`（再 `origin/fork/base-upstream`）；没有该引用就用 `git merge-base HEAD upstream/main`（再 `origin/upstream/main`），不用上游 main 的最新提交；都没有就保留已写入的值。`src/fork/skills-source-commit.fork.test.ts` 检查 pin 是上游基点（本机没有任何上游引用时跳过，并在用例名里写明原因）、构建配置把它交给渲染进程且渲染进程没有别处读这个常量、同步脚本能逐字节重写 pin 文件、生产 CLI 不引用 `src/fork`。`src/shared/agent-feature-install-commands.ts` 与上游一致，没有 `ORCA_FORK_SKILLS_SOURCE`。

## F036 本机 orcad 模板目标

`ORCA_ORCAD_TEMPLATE_TARGETS`（逗号分隔）设置时，打包清单校验收窄到该子集：上游 `verify-packaged-orcad-template.cjs` 里 `verifyPackagedOrcadTemplate` 的默认参数先读 `src/fork/packaging.cjs` 的 `orcadTemplateTargets()`。未设置则仍要求全部目标，发布 CI 行为不变。压缩、浏览器和模板脚本都是上游原样。安装脚本把它设成 `darwin-arm64,linux-x64-glibc,linux-arm64-glibc`，并设置 `ORCA_REQUIRE_ORCAD_TEMPLATE=1`。`linux-x64-glibc217` 不写进这个变量：模板脚本在基座槽 `linux-x64-glibc` 已请求且预编译存在时自动放进清单，上游校验又会把清单里的兼容槽加进期望集合，写两次会对不上。Mac 包要带的四个名字另由 `LOCAL_TEMPLATE_TARGETS` 检查（见 F002）。不能改用上游发布的 orcad 模板：`orcad.js` 打包的是 `src/main/orcad/main.ts`，它引入 `orcad-entry.ts`，`startOrcad` 调用 `installForkOrcadHost()` 登记 fork 的主进程钩子（`packaging.fork.test.ts` 检查这条链）。musl、win32、`darwin-x64` 仍不在本地包里；Apple Silicon 编不出 `darwin-x64`。SSH 到未编进模板的主机仍会失败。

## 应用内更新

发布检查只指向 `quzard/orca-fork` 的 GitHub Releases，用 electron-updater 的公开 GitHub provider 匿名读取（`private: false`，没有 `token` 字段），打开 `allowPrerelease`，元数据文件是 `latest-mac.yml`。不读令牌文件，不读 `GH_TOKEN` / `GITHUB_TOKEN`，请求里没有 `Authorization`。设置页没有令牌输入，也没有相关 IPC。

fork 构建（`registerForkBuild`，主进程、渲染进程和 orcad 都登记）不访问上游，读上游的地方各一个提前返回：changelog（`updater-changelog.ts`）、nudge（`src/main/updater-nudge.ts`）、atom（`updater-prerelease-feed.ts` 的 `fetchNewerReleaseTagsWithReadiness`）、版本列表和指定版本（`updater-release-builds.ts`：`listReleaseBuilds` 返回空，`resolveTargetBuild` 抛 `FORK_UPSTREAM_RELEASE_BLOCKED`，上游的 catch 显示这个错误）、agent 状态规则（`const run` 之后三行，只用内置规则和用户的覆盖文件）、WSL 主机策略（`wsl-hosts-policy-live-update.ts`）；发行说明链接用 `forkReleaseNotesUrl` 指向 `quzard/orca-fork`（`release-channel.ts`）。更新源在 `updater-release-feed.ts` 一行 `pinForkUpdateFeed(autoUpdater)`：fork 构建打开 `allowPrerelease`、设上面的匿名源并返回；`updater-setup.ts` 在 fork 构建里不设上游的 `releases/latest/download`。未登记时都是上游行为。所有拼上游发布地址的源文件列在 `src/fork/upstream-release-sources.fork.test.ts`（也扫描 `src/fork`），每个都要在代码里调用 `isForkBuild()`（注释里的不算），上游新加一处时测试会失败。这个扫描只检查有没有这次调用，不检查门挡的是不是正确的分支；行为由 `upstream-release-reads.fork.test.ts`、`updater-fork-feed.fork.test.ts` 和 `update-feed-provider.fork.test.ts` 在运行时覆盖。

后台下载完成后，macOS 要等 Squirrel 暂存完成（`isMacInstallerReady()`）才弹重启卡片；暂存期间手动检查只把界面放回「已下载 100%」。暂存失败时清掉暂存中的版本，界面进入错误状态，重新检查会重新下载。受监管的无界面 serve 把暂存推迟到 `quitAndInstall`（`isMacStagingDeferredToInstall()`），这种情况下下载完就算就绪。已知限制：Squirrel 既不完成也不报错时，版本一直停在暂存中，后台检查一直挂起，手动检查一直显示「已下载 100%」。实现：`src/fork/main/updater-background-class.ts` 的 `ForkBackgroundUpdates` 继承上游 `UpdaterDownloadInstall`，`UpdaterSetup` 改为继承它；`updater-check-failure.ts` 只有一个抽象声明 `keepForkStagedUpdate` 和三行调用；`updater-download-install.ts` 在后台下载失败时不把请求错误写进状态，改回手动下载卡片；`updater-events.ts` 的 `registerAutoUpdaterHandlers` 用 `bindForkBackgroundUpdates`（`src/fork/main/updater-background-wiring.ts`）把后台下载适配器挂在上游处理函数的上下文上；退出即装是上游赋值之后一行 `||= forkInstallsOnQuit(this.updateInstallMode)`。

家里的 LaunchAgent 只在 `develop` 前进时构建、签名并发布。它跑的是 `~/Projects/orca-verify/bin/mac-auto-update.sh`，安装脚本负责复制。已经装过、仍指向仓库内脚本的代理，要重跑安装脚本，再在终端手动跑一次并点 Always Allow，然后 `--bootstrap`。脚本在 git 操作之前从临时文件重新执行，退出时删掉该副本；成功结束后才用 mv 换掉稳定副本。构建在独立进程组里，锁文件挡住第二次同时构建。codesign 超时会 `kill` 整个进程组。glibc 2.17 的 Node 压缩包先放进 `~/Projects/orca-verify/node-runtime-cache`（缺了就从 `ORCA_NODE_UNOFFICIAL_MIRROR` 取），文件名、版本和 sha256 读上游的 `src/shared/node-runtime-pin.ts`，脚本里不另写一份；读到后先校验格式（版本 `X.Y.Z`、64 位小写十六进制 sha256、文件名必须是 `node-v<版本>-linux-x64-glibc-217.tar.gz`），不符合就报明哪一项并停止（`mac-auto-update-seed.test.sh`）。状态文件不写 `installedSha`：Mac 上没有地方读它。代理只来自 `sync.env` 的 `ORCA_PROXY`（或直接写的 `http_proxy` 等）。

发布用 `gh release create`。`gh auth status` 放在「这个 sha 已发布」之后。失败时 `release` 保持原值，`ghAuth` 记为 `failed`，不写成 skipped。`dist/` 里版本后缀已经对上该 sha 时，gh 恢复后只补发，不重新签名。客户机不需要 gh，也不用 `gh release download` 安装。

launchd 里签名可能停在 Orca Local Signing 的钥匙串确认上。`--bootstrap` 之前先在终端跑一次稳定副本，点 Always Allow。超时或拒绝写入 `sync-status.json`，默认 600 秒（`ORCA_CODESIGN_TIMEOUT_SECONDS`）。已登记的 fork 构建不列出、不钉、也不打开上游 stablyai 的发行说明。

## F038 macOS 本地文件密钥

仅打包后的 macOS、且不是隔离配置时，桌面 `SecretStore` 换成 `MacosFileSecretStore`。32 字节随机密钥，AES-256-GCM，密钥在 `~/.orca/secrets/macos-key-v1`，目录 0700、文件 0600。并发首次启动用排他硬链接，只保留先发布的密钥。密钥缺失或损坏会报错，不回退明文。插件和账号会话走同一个文件密钥库。开发、Windows、Linux、SSH orcad 仍走各自原来的存储。

上游只改 `main-process-preflight.ts` 一行：`setSecretStore(registeredDesktopSecretStore() ?? new ElectronSecretStore())`（钩子 `desktop-secret-store.ts`）。`register-electron.ts` 登记的工厂（`src/fork/main/desktop-secret-store.ts`）在打包后的 macOS、非隔离配置时返回文件密钥库，同时把上游 `guardedSafeStorage` 对象的三个方法路由到它（插件密钥、账号会话直接调用这个对象）；路由对象写成 `satisfies typeof guardedSafeStorage`，上游以后加方法时类型检查失败。其他情况返回 null，仍是上游的钥匙串存储。`safe-storage-availability.ts` 和 `electron-secret-store.ts` 与上游一致。

## F040 自用发布

- 家里的 Mac 用 [fork/scripts/mac-auto-update.sh](fork/scripts/mac-auto-update.sh) 构建、签名并发布（见“应用内更新”）。构建步骤是 [fork/scripts/install-mac-release.sh](fork/scripts/install-mac-release.sh) `--build-only`：上游发布步骤、`darwin-arm64` 与 Linux glibc orcad 槽、`dist/mac-arm64/Orca.app`。
- 手动安装仍用 `install-mac-release.sh`（不带参数）：安装前备份旧应用，替换失败时改回；验收后用 `--cleanup-verified-backups` 清理。
- Mac 上没有别的发布入口。

## 审计表

[docs/fork/AUDIT.md](docs/fork/AUDIT.md) 只有一条生成命令：`python3 fork/scripts/generate-audit.py`。它读 `src/fork/skills-source-commit.ts` 记录的上游基点，对工作区跑 `git diff --no-renames <基点>`，主表一行一个和基点不同的已跟踪文件（上游文件也算），一个不多一个不少；再经仓库里的 oxfmt 格式化后写入。`--check` 只比对，表过期时以 1 退出。需要 git、python3 和 `node_modules`（oxfmt）。只看已跟踪的文件：新文件 `git add` 之后再生成。

原因列默认写「fork 自有文件」「fork 新增文件（上游目录）」「fork 删除的上游文件」或「上游文件，fork 改动 N 行」。脚本里的 `REASONS` 只给少数行补一句说明；`HISTORY` 单列已恢复成上游或已删除的文件。补充说明指向的文件和基点相同、或者 `HISTORY` 里的文件又和基点不同时，脚本直接报错，不会悄悄留下过期条目。

`src/fork/audit-table.fork.test.ts` 自己用 git 重算文件集合，不信任生成器：主表等于和基点不同的文件、决定都是 keep；`HISTORY` 里的文件仍和基点相同，标成删除的文件确实不存在；汇总数字对得上；最后跑一次 `--check`。`fork/push_github.sh` 推送前先跑 `--check` 和 fork 测试，任何一项失败都不推送。`daily-sync.sh` 在 install 之后跑生成器，表变了就提交 `docs(fork): regenerate the audit table`：上游合并移动了基点、或者 PR 带进来过期的表，都在这一步修好。

## 内部标识

本 fork 新增的文档、脚本和 `src/fork` 不得写入雇主或内部环境的名称、地址、主机和数量。检查是 `fork/scripts/verify/check-no-internal-refs.sh`，扫描 `src/fork`、`src/shared/fork-hooks`、`docs/fork`、`fork/`、本文件，以及从 skill pin 记录的上游基点以来新增的所有文件（任何扩展名）；没有那个提交时退回按 `*.fork.test.ts(x)` 和 `*-fork.test.ts(x)` 文件名收集。具体模式放在未入库的 `fork/scripts/verify/internal-ref-patterns.local`，或环境变量 `ORCA_INTERNAL_REF_PATTERNS`。上游文件复制或改名而来的 fork 文件也按新增扫描（`--no-renames`）。

## 提交身份

`fork/scripts/verify/check-commit-identity.sh [REF]`（默认 `HEAD`）检查 `git rev-list REF ^upstream/main ^下限` 里的每个提交，合并提交也算：作者和提交者都必须正好是 `quzard <30899719+quzard@users.noreply.github.com>`，否则列出不合规的 SHA 并失败。唯一例外：在 github.com 网页或用 `gh pr merge` 生成的合并提交（两个以上父提交），作者正好是 quzard、提交者正好是 `GitHub <noreply@github.com>` 时放行；非合并提交或别的提交者照样失败。没有 `upstream/main` 引用时直接失败，不退回别的基点。下限 `8fd7c96acc934cb25e41b5da17f1743e88219bbe`（develop 的 8fd7c96acc）写死在脚本里，不从任何文件读：以前的 `fork/scripts/verify/identity-baseline` 从被检查引用自己的树里读，后面的提交可以把它挪过一个坏提交，从而跳过检查，现在这个文件已删除，提交改不了下限。仓库里没有这个提交，或它不是被检查引用的祖先，都直接失败。下限之前的提交已经公开，加检查时查过，没有个人邮箱（其中 20 个是 2026-10-16/17 的 `Cursor Agent <cursoragent@cursor.com>`，无法改写）。不要改这个下限。`check-no-internal-refs.sh` 扫完内容后接着跑它（`ORCA_IDENTITY_REF` 可指定引用）；`daily-sync.sh` 在推 attempt 分支和 `develop` 之前各跑一次，它自己的合并、pin、审计表和冲突提交由脚本设置成这个身份（`GIT_AUTHOR_*` / `GIT_COMMITTER_*`），机器上不用配置；`fork/push_github.sh` 推送前跑；`mac-auto-update.sh` 发布 release 前对要发布的提交跑。这两处和 `run-linux-verify.sh` 在检查前先用 `fork/scripts/verify/fetch-upstream-main.sh` 拉最新的上游 main（`upstream` 远端，没有时用 daily-sync 添加的同一个地址），拉取失败就不推送、不发布；daily-sync 本来就在合并前拉过。拉取有超时：默认 600 秒（Mac 上一次拉取用了约 6 分钟），用 `ORCA_UPSTREAM_FETCH_TIMEOUT` 改；超时后杀掉 fetch（先 TERM，5 秒后 KILL，连同它的子进程），以非零退出，调用方按拉取失败处理。不依赖 GNU `timeout`，macOS 自带的 bash 3.2 也能用；另外设了 git 的 `http.lowSpeedLimit` / `http.lowSpeedTime`，传输停滞 120 秒也会中止。fetch 在自己的进程组里（`set -m` 作业控制；macOS 没有 `setsid`），launchd 停止任务（卸载、注销、关机）时杀的是脚本的进程组，碰不到 fetch 和它的子进程（git-remote-https 等），它们会成为孤儿继续跑。所以脚本捕获 TERM、INT、HUP：先停看门狗，再停 fetch 的整个进程组，然后按惯例退出（143、130、129）；正常结束和超时由 EXIT 陷阱做同样的清理，每一步只做一次，不会重复杀。停一个子进程时每 0.1 秒重发一次 TERM，3 秒后还在就发 KILL，清理时不 `wait` 任何子进程（bash 自己回收，退出时剩下的僵尸交给 init），所以清理最多几秒，不会一直等。不 `wait` 是因为：launchd 把 TERM 发给脚本的整个进程组时看门狗也收到，它若恰好在信号打断脚本等 fetch 的 `wait` 时退出，bash 3.2 和 5.2 都可能把它悄悄回收掉，之后再 `wait` 它就会一直等到另一个子进程（fetch）结束，而这时 fetch 已经没有看门狗管了（身份测试“TERM to the script's group (launchd)”在高负载下偶尔要等假 fetch 的 `sleep 300` 结束才退出，就是这个原因）。看门狗收到 INT、HUP 时和 TERM 一样结束它正在睡的 `sleep`（后台的 `sleep` 忽略 INT，看门狗直接死掉会把它留下）。判断“没了”时用 `ps` 排除僵尸进程；没有可用的 `ps`（精简容器里缺它、运行失败或什么都不输出）时只看 `kill -0`，当作还在，照样重发 TERM、3 秒后 KILL。重发是因为 bash 的子进程刚起来、还没换上自己的陷阱时，收到的信号会被丢掉：父进程捕获着 TERM 时，子进程开头仍用父进程的陷阱处理函数，记下的信号在它重置陷阱时被清掉。以前只发一次 TERM 再无限期 `wait` 看门狗，信号落在启动窗口里时（约 1%～2%）脚本要等到看门狗超时（生产 600 秒）才退出。看门狗收到 TERM 时也结束它正在睡的 `sleep`，包括 TERM 落在起 `sleep` 和记下它的 pid 之间的情况，不留下 `sleep`。信号如果落在 fetch 和看门狗刚启动、pid 还没记下的那一刻，陷阱只记下信号，两个 pid 都拿到后立即按上面的步骤处理，不会漏掉 fetch。测试是 `fork/scripts/check-commit-identity.test.sh`（含评审复现的“挪基线跳过坏提交”现在失败，以及假的卡住拉取被超时杀掉、脚本收到 TERM/INT/HUP 时连同子进程一起被杀掉，包括信号落在启动 fetch 和记下 pid 之间的情况）。压力测试是 `fork/scripts/fetch-upstream-signal-stress.test.sh`：TERM、INT、HUP 各在启动窗口里打 200 次（`ORCA_FETCH_STRESS_RUNS` 调次数，`ORCA_FETCH_STRESS_BASH` 换被测的 bash），每次都要在 5 秒内按退出码退出，事后不剩 fetch、它的子进程、看门狗或看门狗的 `sleep`；另外在被测脚本的 PATH 最前面放让 `ps` 失败或什么都不输出的垫片，各跑 20 次，再用一个根本没有 `ps` 的 PATH（链接原 PATH 里除 `ps` 以外的全部命令，脚本以后多用命令也不用改测试）跑 20 次（`ORCA_FETCH_STRESS_NO_PS_RUNS`）；fetch 和它的子进程都忽略 TERM 时，每次都要走 3 秒后的 KILL 分支，用时在 2.9～8 秒之间（Mac 上 4.5～4.85 秒）、不剩进程（`ORCA_FETCH_STRESS_KILL_RUNS`，默认 3 次）；fetch 已经在跑、脚本在等它时把 TERM、INT、HUP 发给脚本的整个进程组（和 launchd 一样，看门狗一起收到），各 100 次，每次 5 秒内退出、不剩进程（`ORCA_FETCH_STRESS_GROUP_RUNS`）。找不到被测的 bash、`ps`、git、perl 或 awk 时测试在 stderr 说明并以 2 退出，不会悄悄退出。测试自己的检查用绝对路径的 `ps`，单次运行超过 35 秒就从外面 KILL 掉并算失败，测试不会卡死。同一个检出里可以同时跑几次压力测试或身份测试，互不干扰：压力测试每次把被测脚本复制到自己的临时目录里测，只按这份副本的路径、自己的临时目录、自己的进程组和自己的 `sleep` 辅助进程找残留进程、杀进程，从不按名字或模式杀；身份测试只杀它自己记下的 pid 和进程组。从非交互 shell 的后台作业（`bash -c '… &'`）启动时 INT 一开始就被忽略，用 `nohup` 启动时 HUP 被忽略（`nohup … &` 两个都被忽略），bash 改不回来，INT、HUP 用例会误报超时；所以两个测试开头都用 `fork/scripts/signal-test-preflight.sh` 检查被测的 bash 能不能捕获 INT 和 HUP，不能就用 perl 把两者恢复成默认后重新执行自己一次（bash 3.2 和 5.2 都行），还不行就说明原因并以 2 退出，不报超时。

## 根目录杂项

`push_github.sh` 在 [fork/push_github.sh](fork/push_github.sh)。主机、仓库路径、GitHub 地址和分支都要由环境变量给出（`PUSH_GITHUB_HOST`、`PUSH_GITHUB_REPO`、`PUSH_GITHUB_URL`、`PUSH_GITHUB_BRANCH`），没有内置默认值。示例路径是 `/srv/wt/project`。不在检出所在的主机上时经 ssh 到那台主机执行。它先快进检出，GitHub 上已是同一个提交就跳过；否则依次跑 `python3 fork/scripts/generate-audit.py --check`、fork 测试（`src/fork src/shared/fork-hooks`）、`fetch-upstream-main.sh` 和提交身份检查，任何一项失败都不推送，所以检出要有 `node_modules`。`--dry-run` 走 `git push --dry-run`，不改远端。

早期方案和评审笔记没有入库，见 [docs/fork/historical-notes.md](docs/fork/historical-notes.md)。

## F050 聊天盖住终端时藏起 xterm 画布

原生聊天盖层是窗格（`.pane`）的直接子元素（`.native-chat-pane-shell`）。渲染进程登记时注入一张样式表（`src/fork/terminal/covered-terminal-canvas.tsx`）：含有这个盖层的窗格里，盖层之外的 `.xterm` 设 `pointer-events: none`，它里面所有 canvas 设 `visibility: hidden` 和 `pointer-events: none`。画布仍占布局盒，不释放 WebGL backing。盖层卸下后选择器自然不再命中；盖住之后才创建的画布（WebGL 挂上、context 丢失重建）、之后才 open 的 xterm 也都覆盖，不需要 MutationObserver。分屏里没被盖住的窗格、盖层自己内容里的元素不受影响。没有 document 的环境（node 下登记渲染模块的测试）什么都不做。

智能体会话（历史转录也在这只宿主里）不进 `.pane`。它和终端都是 `RetainedPaneHost`，由 fragment 直接挂在工作区表面或浮动面板上，xterm 是旁边那只宿主里的兄弟，不是 `.native-chat-pane-shell` 的兄弟。会话宿主还看得见（没有 `inert`）时，同一分栏组里其他宿主的 `.xterm` 用同一套 `pointer-events` / `visibility` 藏起来，包括已经 `display: none` 或 `inert` 的终端：隐藏宿主上的 WebGL 层仍可能画在转录上面。盖层变成 `inert` 后选择器不再命中，切回终端不会一直灰。另一分栏组、盖层自己里面的画布不受影响。分栏组第一次出现时往同一张样式表补一条规则，不挂 MutationObserver。

`RetainedPaneHost` 多两处钩子调用（`src/shared/fork-hooks/covered-terminal-group.ts`）：渲染时写 `data-retained-pane-group`，布局时记下这个组。未登记时没有属性、也没有这些规则。智能体会话盖层组件本身仍是上游。这是一个可以报给上游的 bug（macOS 把 WebGL 画布合成到 z-10 的 HTML 之上）。测试是 `src/fork/terminal/covered-terminal-canvas.fork.test.tsx`，窗格盖层用真实的 `NativeChatPaneCover`，会话盖层用真实的 `RetainedPaneHost`。

## F052 没有 IPv6 的 Linux 上启动 Antigravity ACP

Antigravity ACP 仍钉在 1.4.1。这一版的 `agy_acp_server.par` 在 google3 初始化里强制创建 `AF_INET6` socket。内核 `CONFIG_IPV6=n`（关掉 IPv6 的 Docker 容器常见）时进程 `SIGABRT`，安装校验失败，界面是 “Antigravity couldn't start on this host, so it wasn't installed.” 不要求主机打开 IPv6，也不改主机网络说明。

Linux 上每次启动都在已有的 `--uid=` 后面加上 `--enforce_kernel_ipv6_support=false`。安装校验（`probeAntigravityAcpServer`）和正式会话（`ANTIGRAVITY_LAUNCH_SPEC.args`，登录也走这里）都展开同一个钩子。macOS 和 Windows 不追加。未登记时 Linux 仍只有 `--uid=`。

钩子 `src/shared/fork-hooks/antigravity-acp-args.ts`。参数在 `src/fork/main/antigravity-acp-ipv6.ts`，由 `register-main.ts` 登记，桌面和 orcad 都有：SSH 远端的安装和会话在那台主机的 orcad 上启动。1.4.2 到 1.4.5 会在会话开始时往工作区写 `skills/system/run-workflow/SKILL.md`，不升 pin。测试不跑官方二进制，用假服务器核对 argv。
