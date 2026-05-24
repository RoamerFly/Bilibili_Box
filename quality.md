# BiliBox 项目质量审查报告

审查日期：2026-05-22  
审查范围：`checklist.md`、Tauri 命令层、Bilibili API 层、下载管理器、登录流程、前端状态管理与主要页面调用。  
审查方式：静态代码审查 + `npm run build` + `cargo check`。

## 总体结论

项目已经具备完整的桌面应用骨架，UI 覆盖度高，Bilibili 登录、基础内容查询、下载任务创建、配置持久化等主流程均有真实代码接入，不是单纯 UI mock。

但当前实现距离“稳定可发布”仍有明显差距。主要风险集中在下载系统、前后端 IPC 契约一致性、登录 Cookie 安全边界、配置生效链路和部分页面的“本地假操作”。其中下载系统是最大风险点：任务能创建并开始下载，但暂停、删除、恢复、进度、速度、目录、画质、断点续传等关键行为尚未形成严密闭环。

## 验证结果

- `npm run build`：通过。普通沙箱下曾触发 Vite/Rollup 路径限制错误，提升到正常权限后构建成功。
- `cargo check`：通过，但存在 72 个 warning，主要包括未使用模块、未使用导入、废弃 command 仍注册、WBI/弹幕/插件/下载任务子模块未接入。

## 严重问题

### 1. 下载暂停/删除不是真正控制底层下载

位置：
- `src-tauri/src/download/manager.rs:323`
- `src-tauri/src/download/manager.rs:409`
- `src-tauri/src/download/manager.rs:436`

`download_file` 的流式下载循环没有检查任务状态，也没有 cancellation token。`pause_download_tasks` 只是把内存中的 `state` 改成 `Paused`，正在执行的 HTTP stream 仍会继续写文件。`delete_download_tasks` 只是从任务表删除并删除进度文件，已经 spawn 出去的下载协程仍可能继续写入磁盘。

影响：
- 用户点击暂停后文件仍在下载。
- 用户点击删除后后台任务可能继续占用网络和磁盘。
- 恢复任务可能启动第二个并发下载，造成重复写入或状态互相覆盖。

建议：
- 为每个任务引入 `CancellationToken` 或 `watch` channel。
- 下载循环每个 chunk 后检查状态。
- 删除任务时先取消协程，再清理文件和任务状态。
- 暂停应保留已下载临时文件和 Range 续传信息。

### 2. 下载目录配置没有真正生效

位置：
- `src-tauri/src/config/mod.rs:117`
- `src-tauri/src/download/manager.rs:248`

配置中有 `download_dir`，设置页也能保存下载目录，但实际下载路径固定使用 `dirs::download_dir()/BiliBox/{title}`，没有读取用户配置。

影响：
- 用户在设置中选择的下载目录不会影响真实下载。
- “打开下载目录”打开的是配置目录，但文件可能写到另一个目录。

建议：
- 下载路径统一从 `Config.download_dir` 读取。
- `open_download_folder` 和下载器使用同一套目录解析逻辑。
- 对标题做路径非法字符清理，避免 Windows 文件名失败。

### 3. 首页下载统计返回类型与后端不匹配

位置：
- `src-tauri/src/commands.rs:265`
- `frontend/src/views/home/home-view.tsx:39`
- `frontend/src/views/home/home-view.tsx:66`

后端 `get_download_task_count` 返回 `usize`，前端按 `{ total, active }` 对象读取。因此 `downloadCount.total` 永远是 `undefined`，最终显示 0。

影响：
- 首页“今日下载”统计不可信。
- TypeScript 泛型掩盖了真实 IPC 返回结构错误。

建议：
- 后端返回 `{ total, active }` 结构，或前端改为分别调用 `get_download_task_count` / `get_active_download_count`。

### 4. IPC 参数命名混用，运行时有失败风险

位置：
- `frontend/src/components/login-dialog.tsx:123`
- `frontend/src/views/downloads/downloads-view.tsx:126`
- `frontend/src/views/favorites/favorites-view.tsx:100`
- `frontend/src/views/history/history-view.tsx:196`

前端同时使用了 `qrcode_key`、`task_ids` 这类 snake_case，以及 `newConfig`、`mediaId`、`viewAt` 这类 camelCase。Tauri 对 Rust snake_case 参数通常按 camelCase 暴露给前端，混用会让部分 command 在运行时出现“missing required key”类错误。

影响：
- 二维码状态轮询、下载暂停/恢复/删除等操作可能在某些环境下直接失败。
- 同一项目内调用风格不一致，后续维护容易踩坑。

建议：
- 统一前端 invoke 参数为 camelCase，例如 `qrcodeKey`、`taskIds`、`newConfig`。
- 增加一层 typed command wrapper，禁止页面直接手写字符串 command 和参数对象。

### 5. 浏览器登录只保存 SESSDATA，后续高权限接口可能缺少 CSRF 所需 Cookie

位置：
- `src-tauri/src/commands.rs:68`
- `src-tauri/src/commands.rs:103`
- `frontend/src/components/login-dialog.tsx:206`

内置浏览器登录目前只提取 `SESSDATA`。查询类接口通常够用，但涉及稍后再看删除、历史删除、收藏变更等操作时，Bilibili 常需要 `bili_jct` 等 CSRF Cookie。当前配置模型也只保存 `sessdata`。

影响：
- “已登录”状态可显示，但写操作/删除操作扩展时会失败。
- 后续实现 B 站状态修改会缺少认证材料。

建议：
- 保存完整 Cookie 字符串或至少保存 `SESSDATA`、`bili_jct`、`DedeUserID`。
- 后端 API 层统一通过 `Config` 构造完整 Cookie header。
- 配置文件需要考虑敏感信息保护。

## 高风险问题

### 6. 二维码登录 Cookie Jar 生命周期可能导致取不到 SESSDATA

位置：
- `src-tauri/src/api/auth.rs:127`
- `src-tauri/src/api/auth.rs:133`
- `src-tauri/src/api/auth.rs:184`

二维码生成使用普通 API client，轮询时才创建带 cookie jar 的 login client。若 B 站登录链路依赖生成阶段或跨域 Set-Cookie，当前 cookie jar 可能拿不到完整登录 Cookie。代码里还保留了 `extract_sessdata_from_url` 但永远返回 `None`。

影响：
- 用户扫码确认后可能仍提示无法获取 `SESSDATA`。
- 与用户反馈的“已扫码未确认/确认后不落库”问题相关。

建议：
- 生成二维码与轮询使用同一个带 cookie jar 的 login client。
- 成功后从 `Set-Cookie` 与 cookie jar 双路径提取 Cookie。
- 失败时返回明确状态：已扫码待确认、已确认但未取到 Cookie、二维码过期。

### 7. 下载速度字段没有被真实更新

位置：
- `src-tauri/src/download/manager.rs:45`
- `src-tauri/src/download/manager.rs:236`
- `src-tauri/src/download/manager.rs:370`

`byte_per_sec` 被创建并有速度事件循环，但 `download_file` 参数名是 `_byte_per_sec`，下载 chunk 后没有累加字节数；`DownloadProgress.speed` 也没有更新。

影响：
- 前端速度和剩余时间大概率长期为 0 或 `--:--:--`。
- checklist 中“下载速度正常显示/剩余时间正常显示”不成立。

建议：
- 每次写入 chunk 后 `byte_per_sec.fetch_add(chunk.len() as u64, Ordering::Relaxed)`。
- 同步更新任务内的 `speed`。
- 前端优先消费后端事件，轮询作为兜底。

### 8. `useDownloadEvents` 没有接入应用入口

位置：
- `frontend/src/hooks/use-download-events.ts:55`
- `frontend/src/App.tsx:3`

下载事件 hook 已写好，但没有在 `App` 或 `AppShell` 中调用。下载页目前靠 2 秒轮询刷新，事件流无法驱动全局底栏或下载状态。

影响：
- 后端 emit 的 `download://progress`、`download://completed`、`download://error` 对大部分 UI 没有作用。
- `useDownloadStore` 与下载页本地 state 形成两套状态源。

建议：
- 在 `AppShell` 顶层调用 `useDownloadEvents()`。
- 下载页改为消费统一 store，移除重复轮询或保留为异常兜底。

### 9. 部分页面删除/清空只是本地假操作

位置：
- `frontend/src/views/watchlater/watchlater-view.tsx:102`
- `frontend/src/views/history/history-view.tsx:233`
- `src-tauri/src/api/watchlater.rs`
- `src-tauri/src/api/history.rs`

稍后再看清空、历史清空只修改前端 state。后端没有 `delete_watch_later`、`clear_watch_later`、`delete_history`、`clear_history` 命令。刷新后数据会恢复。

影响：
- 用户以为已经删除，实际 Bilibili 侧没有变化。
- checklist 中“可删除/可清空/同步 Bilibili 状态”的结论不准确。

建议：
- 对未接通的写操作隐藏按钮或标注不可用。
- 真正实现 B 站删除接口，并处理 CSRF Cookie。

### 10. 下载配置项大量未参与下载决策

位置：
- `src-tauri/src/config/mod.rs:125`
- `src-tauri/src/config/mod.rs:126`
- `src-tauri/src/config/mod.rs:134`
- `src-tauri/src/download/manager.rs:98`

配置中定义了画质、编码、音频优先级、是否下载字幕/封面/NFO/JSON/弹幕、是否自动合并、文件存在策略等，但下载器创建任务时固定取 `video_list.first()` 和 `audio_list.first()`，附加资源任务仍是 TODO。

影响：
- 设置页给出的下载选项不一定真实生效。
- 用户可能选择 1080P，但实际下载 API 返回列表第一项，不一定符合偏好。

建议：
- 将 `Config` 注入下载任务创建流程。
- 按配置筛选视频流/音频流。
- 未实现的附加资源开关暂时禁用，避免误导。

## 中风险问题

### 11. 任务进度持久化只写入创建时状态，没有恢复和持续更新

位置：
- `src-tauri/src/download/manager.rs:129`
- `src-tauri/src/download/manager.rs:486`

`save_progress` 只在创建任务时调用，下载过程中没有持续写入，应用启动时也没有加载 `.download_tasks` 目录。

影响：
- 应用重启后下载队列丢失。
- 崩溃恢复、断点续传无法成立。

建议：
- 下载状态变更和进度更新时节流写入。
- `DownloadManager::new` 加载历史任务。
- 对未完成任务做恢复/失败标记策略。

### 12. 文件名与输出路径缺少清理和冲突处理

位置：
- `src-tauri/src/download/manager.rs:248`
- `src-tauri/src/download/manager.rs:282`
- `src-tauri/src/config/mod.rs:163`

下载目录和输出文件名直接使用标题；`file_exist_action` 定义了 `Overwrite/Skip/Rename`，但下载器没有实现。

影响：
- 标题含 `<>:"/\|?*` 等字符时 Windows 写入失败。
- 同名视频可能覆盖、失败或混乱。

建议：
- 增加文件名 sanitize。
- 实现文件存在策略。
- 目录格式化使用 `dir_fmt` / `dir_fmt_for_part`。

### 13. Cookie 明文持久化，安全说法偏乐观

位置：
- `src-tauri/src/config/mod.rs:117`
- `src-tauri/src/config/mod.rs:378`
- `frontend/src/components/login-dialog.tsx:781`

`sessdata` 以明文写入 `config.json`。前端提示“仅本地存储，不会上传”基本属实，但 checklist 中“本地存储安全”并不严谨。

影响：
- 本机其他进程、备份工具或日志误采集可能泄露登录态。

建议：
- 使用系统 keychain/credential manager 存储敏感 Cookie。
- 至少在文档和 UI 中准确表达风险。

### 14. mock/占位文本仍残留

位置：
- `frontend/src/components/login-dialog.tsx:383`
- `frontend/src/components/login-dialog.tsx:415`
- `frontend/src/components/layout/sidebar.tsx:209`

已登录面板和侧栏中仍有 `test_user` 兜底。真实产品中不应出现测试用户名。

影响：
- 用户信息加载失败时误显示为已登录测试用户。

建议：
- 改为“未知用户”或直接显示加载/异常状态。

## 低风险与工程质量问题

- `cargo check` 有 72 个 warning，说明存在大量未接入模块和废弃接口。
- `login/logout/check_login_status` 已标记 deprecated 但仍注册到 invoke handler。
- `src-tauri/src/download/task.rs` 与 `download/tasks/*.rs` 多处 TODO，架构意图存在但未整合进主下载流程。
- `frontend/src/lib/types.ts` 中 `DownloadEvent.data: any` 降低了类型保护。
- 首页、番剧、收藏、历史等页面直接散落 invoke 字符串，缺少统一 API SDK 层，维护成本偏高。

## checklist 对照修正

建议调整当前完成度判断：

| 模块 | 原 checklist 判断 | 本次复核判断 |
|---|---:|---:|
| UI | 100% | 90%+，主要页面完整，但部分按钮无真实动作 |
| API | 90% | 70%-80%，查询类较完整，写操作和 WBI 接入不足 |
| 登录系统 | 100% | 80%-85%，Cookie 登录可用，二维码/浏览器登录仍需 Cookie 完整性验证 |
| 下载系统 | 40% | 35%-45%，能下载基础流，但暂停/删除/续传/配置/事件闭环不足 |
| 状态管理 | 70% | 60%-70%，persist 已有，但下载状态源割裂 |
| Rust 后端 | 75% | 65%-75%，结构不错，但 warning 和未接入模块较多 |
| 工程化 | 80% | 70%，能构建检查，但缺少自动化测试和 typed IPC 约束 |

## 优先级建议

1. 先修 IPC 参数命名和返回类型契约，避免功能在运行时随机失败。
2. 重构下载任务控制：取消、暂停、恢复、删除必须能控制真实协程。
3. 让下载器读取 `Config.download_dir`、画质、音频、合并、文件存在策略。
4. 接入 `useDownloadEvents`，统一下载状态源。
5. 登录保存完整 Cookie，并为写操作准备 CSRF Cookie。
6. 对暂未实现的清空/删除/批量管理按钮做禁用或真实 API 实现。
7. 清理 `test_user`、TODO、deprecated command 和 cargo warning。
8. 增加最小自动化测试：配置保存、登录 Cookie 提取、IPC 参数、下载任务状态机。

## 上线前必测场景

- 二维码登录：未扫码、已扫码未确认、确认成功、过期、确认后 Cookie 提取失败。
- 浏览器登录：正常登录、手动关闭窗口、超时、已登录账号复用。
- Cookie 登录：完整 Cookie、裸 SESSDATA、过期 Cookie、含特殊字符 Cookie。
- 下载：单 P、多 P、大文件、暂停、恢复、删除、失败重试、应用重启恢复。
- 配置：修改下载目录、画质、并发数、代理后，实际下载是否生效。
- 内容页：收藏夹、稍后再看、历史、追番在未登录/登录失效/网络失败时的表现。
- 平台：Windows、macOS、Linux 的路径、FFmpeg、WebView Cookie 行为。

## 2026-05-22 修复进展

本轮已处理：

- 修复前端 invoke 参数命名：二维码轮询和下载任务操作改为 Tauri 期望的 camelCase 参数。
- 修复首页下载统计：前端按后端真实返回的 `usize` 读取，不再把数字误当对象。
- 接入下载事件监听：`AppShell` 顶层启用 `useDownloadEvents`，底栏进度和日志可以接收后端事件。
- 修复下载事件序列化：后端 `DownloadEvent` 增加 `snake_case` 序列化，与前端事件类型对齐。
- 改造下载控制：增加任务控制句柄，暂停/删除/重试会被下载循环感知，删除会发出任务删除事件。
- 下载目录生效：下载器改为读取 `Config.download_dir`，不再固定写入系统下载目录。
- 下载文件名清理：标题中的 Windows 非法路径字符会被替换，避免创建文件失败。
- 文件冲突策略部分生效：输出 mp4 支持 `Overwrite`、`Skip`、`Rename`。
- 下载速度统计生效：下载 chunk 写入后会累加速度统计，并更新任务 `speed`。
- 下载流选择优化：创建任务时按配置中的画质、编码、音频优先级选择 DASH 流。
- 登录 Cookie 完整性增强：配置新增 `cookie` 字段，浏览器登录和 Cookie 登录会保存完整 Cookie；后端请求优先使用完整 Cookie。
- 二维码生成与轮询统一使用登录 Cookie Jar，提高扫码成功后提取 Cookie 的一致性。
- 移除废弃登录命令注册，统一通过 `save_config` 管理登录状态。
- 假操作收敛：稍后再看/历史清空不再只改本地 state，而是明确提示当前版本未启用写接口；播放动作改为打开真实 Bilibili 页面。
- 底栏“打开下载目录”接入真实后端命令。
- 清理部分无用代码和 warning，`cargo check` warning 从 72 降至 52。

仍需后续处理：

- 下载断点续传仍未完整实现；当前暂停能停止后台下载，但恢复会重新开始对应流。
- 下载任务进度文件仍未做持续写入与启动恢复。
- 稍后再看/历史删除类写接口仍未实现，需要结合完整 Cookie 和 CSRF。
- 弹幕 ASS、插件 Hook、附加资源下载等模块存在大量未接入代码，仍产生 warning。
