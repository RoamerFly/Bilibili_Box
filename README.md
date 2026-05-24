# BiliBox

BiliBox 是一个基于 Tauri 2、React 19 和 Rust 的 Bilibili 媒体工作台，提供登录、视频搜索、收藏夹、稍后再看、观看历史、追番追剧、在线播放和下载队列等桌面端功能。

## 功能概览

- Bilibili 登录：二维码登录、Cookie 登录、内置浏览器登录。
- 视频发现：推荐视频、聚合搜索、收藏夹、稍后再看、观看历史、追番追剧。
- 搜索筛选：支持按排序、日期和时长筛选视频搜索结果。
- 播放页面：通过 Tauri 内部媒体协议代理远程媒体资源，支持从列表双击或播放按钮进入。
- 下载管理：支持后台下载、下载队列、底部下载面板、进度日志。
- 配置管理：主题、下载目录、清晰度优先级、并发数量、卡片尺寸、每页数量、启动最大化等。
- 打包分发：Windows 构建脚本会生成独立分发目录，并复制 FFmpeg/FFprobe 到运行环境目录。

## 技术栈

- 前端：React 19、TypeScript、Vite、Zustand、Framer Motion、Lucide React。
- 桌面端：Tauri 2。
- 后端：Rust、Tokio、Reqwest、Serde。
- 媒体处理：FFmpeg/FFprobe。

## 环境要求

| 依赖 | 建议版本 |
| --- | --- |
| Rust | 1.77.2 或更高 |
| Node.js | 18 或更高，推荐 LTS |
| npm | 随 Node.js 安装 |
| FFmpeg/FFprobe | 下载与合并功能需要 |

Windows 还需要安装 Microsoft Visual C++ Build Tools，或安装 Visual Studio 2022 并勾选 “Desktop development with C++”。

## 安装依赖

```powershell
npm install
npm --prefix frontend install
```

## 开发运行

```powershell
npm run tauri dev
```

如需记录 Rust 调试日志：

```powershell
$env:RUST_LOG="info,bilibili_box_lib=debug"
$env:RUST_BACKTRACE="1"
npm run tauri dev 2>&1 | Tee-Object -FilePath .\player-debug.log
```

## 构建

普通 Tauri 构建：

```powershell
npm run build
npm run tauri build
```

Windows 分发构建：

```powershell
.\build-windows.bat
```

`build-windows.bat` 会生成 `dist_windows/`，并尝试从以下位置寻找 FFmpeg/FFprobe：

- `env/ffmpeg.exe` 和 `env/ffprobe.exe`
- `env/bin/ffmpeg.exe` 和 `env/bin/ffprobe.exe`
- `env/ffmpeg/bin/ffmpeg.exe` 和 `env/ffmpeg/bin/ffprobe.exe`
- 系统 `PATH`

如果要把程序发给其他电脑，请分发整个 `dist_windows/` 目录，而不是只复制单个 exe。

## 本地数据

应用运行时会在 exe 同级创建：

```text
data/
  user/
    config.json
    user.json
  download/
```

这些文件包含本地配置、登录态和下载数据，不应提交到 Git 仓库。

## 项目结构

```text
bilibili-box/
  frontend/                 React 前端
    src/
      components/           通用组件和布局
      hooks/                前端 hooks
      lib/                  前端工具和类型
      stores/               Zustand 状态
      views/                各业务页面
  src-tauri/                Tauri/Rust 后端
    src/
      api/                  Bilibili API 封装
      config/               配置和本地数据路径
      download/             下载任务和 FFmpeg 集成
      plugin/               插件管理
      media_proxy.rs        内部媒体协议代理
      commands.rs           Tauri commands
  src-plugin/               插件相关 Rust 工程
  build-windows.bat         Windows 分发构建脚本
  build-linux.sh            Linux 构建脚本
  build-macos.sh            macOS 构建脚本
```

## 常用命令

```powershell
# 前端构建
npm run build

# Rust 检查
cd src-tauri
cargo check

# Rust 格式化
cd src-tauri
cargo fmt
```

## 注意事项

- Bilibili 接口可能触发风控，搜索和媒体播放请求需要合理频率和正确 Cookie。
- 高权限接口通常需要完整 Cookie，不能只依赖裸 `SESSDATA`。
- 下载和合并依赖 FFmpeg/FFprobe；跨机器运行时请确认 `dist_windows/env/` 中包含对应二进制文件。
- 仓库不会提交 `node_modules/`、`target/`、`dist*/`、日志、本地数据和登录态。

## License

MIT
