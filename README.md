<div align="center">
  <img src="./icon.png" width="136" height="136" alt="BiliBox Logo" />
  <h1>BiliBox</h1>

  <p>
    一个高颜值、桌面级、开箱即用的 Bilibili 媒体工作台。
  </p>
  <p>
    <strong>搜索、收藏、稍后再看、观看历史、追番追剧、在线播放与后台下载，一站完成。</strong>
  </p>

  <p>
    <a href="#功能亮点">功能亮点</a>
    ·
    <a href="#界面预览">界面预览</a>
    ·
    <a href="#快速开始">快速开始</a>
    ·
    <a href="#构建分发">构建分发</a>
  </p>

  <p>
    <img alt="Rust" src="https://img.shields.io/badge/Rust-1.77%2B-f46623?style=for-the-badge&logo=rust&logoColor=white" />
    <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2.x-24c8db?style=for-the-badge&logo=tauri&logoColor=white" />
    <img alt="React" src="https://img.shields.io/badge/React-19-61dafb?style=for-the-badge&logo=react&logoColor=20232a" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178c6?style=for-the-badge&logo=typescript&logoColor=white" />
    <img alt="License" src="https://img.shields.io/badge/License-MIT-7c3aed?style=for-the-badge" />
  </p>
</div>

---

## 为什么选择 BiliBox

BiliBox 不是一个只会粘贴链接的下载器，而是面向日常使用的 Bilibili 桌面媒体工作台。它把常用入口、账号数据、在线播放、下载队列和本地配置集中在一个现代化桌面应用里，让找视频、看视频、存视频变成一个连续的流程。

- **桌面体验优先** - 基于 Tauri 2 构建，体积更轻，启动更快，系统集成更自然。
- **真实业务闭环** - 搜索、推荐、收藏夹、历史、稍后再看、追番追剧、下载队列都接入实际业务逻辑。
- **播放和下载联动** - 从任意列表进入播放页，确认资源后可直接加入后台下载。
- **适合分发给非开发用户** - 三端 Release 构建会下载并校验真正可独立运行的 FFmpeg/FFprobe，将其放入 `env/` 后封装进安装版与便携版。
- **本地优先** - 便携版将登录态、用户信息和下载数据写入程序同级 `data/`；安装版使用系统应用数据目录，数据均不会上传。

## 功能亮点

### 账号与登录

- 二维码登录、Cookie 登录、内置浏览器登录
- 自动保存登录状态到本地，启动后自动恢复账号信息

### 内容发现

- 推荐视频、聚合搜索（支持关键词/BV号/AV号/链接）
- 搜索结果支持排序、发布时间、视频时长筛选
- 我的收藏、稍后再看、观看历史、追番追剧
- 浏览页面支持本地缓存，手动刷新时重新获取最新数据

### 播放能力

- 多清晰度动态展示、全屏、画中画、双击切换全屏
- 使用 Tauri 内部媒体协议代理远程媒体资源
- 下载完成的视频可直接从首页或下载列表进入播放
- 分集视频可在播放页一键加入全部剧集下载任务

### 下载管理

- 后台下载，不强制跳转页面；支持多选批量操作
- 底部上拉面板实时展示下载进度，最新任务优先显示
- 支持 FFmpeg/FFprobe 自动发现与分发目录打包
- 下载清晰度按目标视频可用画质展示，自动采用最高可用画质

### 个性化设置

- 主题切换（浅色/深色/跟随系统）
- 下载目录、默认清晰度、任务并发、分片并发配置
- 支持一键恢复默认设置，并保留当前账号登录状态

## 界面预览

### 首页

![Home Preview](./docs/screenshots/home.png)

### 搜索视频

![Search Preview](./docs/screenshots/search.png)

### 推荐视频

![Recommend Preview](./docs/screenshots/recommend.png)

### 我的收藏

![Favorites Preview](./docs/screenshots/favorites.png)

### 播放页面

![Player Preview](./docs/screenshots/player.png)

### 下载队列

![Downloads Preview](./docs/screenshots/downloads.png)

### 观看历史

![Downloads Preview](./docs/screenshots/history.png)

### 追番追剧

![Downloads Preview](./docs/screenshots/zfzj1.png)

![Downloads Preview](./docs/screenshots/zfzj2.png)

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面容器 | Tauri 2 |
| 前端 | React 19、TypeScript、Vite |
| UI 与交互 | Zustand、Framer Motion、Lucide React、Radix UI |
| 后端 | Rust、Tokio、Reqwest、Serde |
| 媒体处理 | FFmpeg、FFprobe |

## 快速开始

### 环境要求

| 依赖 | 建议版本 |
| --- | --- |
| Rust | 1.77.2 或更高 |
| Node.js | 18 或更高，推荐 LTS |
| npm | 随 Node.js 安装 |
| FFmpeg/FFprobe | 本地开发构建时需要；GitHub Release 的安装版和便携版已内置独立工具 |

Windows 需要安装 Microsoft Visual C++ Build Tools，或安装 Visual Studio 2022 并勾选 **Desktop development with C++**。

### 安装依赖

```powershell
npm install
npm --prefix frontend install
```

### 开发运行

```powershell
npm run tauri dev
```

### 调试日志

```powershell
$env:RUST_LOG="info,bilibili_box_lib=debug"
$env:RUST_BACKTRACE="1"
npm run tauri dev 2>&1 | Tee-Object -FilePath .\player-debug.log
```

## 构建分发

### 普通构建

```powershell
npm run build
npm run tauri build
```

### Windows 一键分发

```powershell
.\scripts\prepare-ffmpeg-runtime.ps1
.\build-windows.bat
```

运行时准备脚本会下载并校验独立的 Windows x64 静态 `ffmpeg.exe` 与 `ffprobe.exe`；构建脚本随后生成包含这套运行时的 `dist_windows/`。构建脚本会从以下位置复制 FFmpeg/FFprobe：

- `env/ffmpeg.exe`、`env/ffprobe.exe`
- `env/bin/ffmpeg.exe`、`env/bin/ffprobe.exe`
- `env/ffmpeg/bin/ffmpeg.exe`、`env/ffmpeg/bin/ffprobe.exe`
- 系统 `PATH`

分发给其他电脑时，请发送整个 `dist_windows/` 目录，而不是只发送单个 exe。

### Linux 与 macOS 分发

```bash
# Linux x64
./scripts/prepare-ffmpeg-runtime.sh linux-x64
./build-linux.sh

# macOS Apple Silicon
./scripts/prepare-ffmpeg-runtime.sh macos-arm64
./build-macos.sh

# macOS Intel
./scripts/prepare-ffmpeg-runtime.sh macos-x64
./build-macos.sh
```

Linux 与 macOS 使用的工具名称同样是 `ffmpeg` 和 `ffprobe`，只是没有 Windows 的 `.exe` 后缀。三端 Release 工作流会自动完成上述下载与校验，不需要手动向压缩包或安装程序中复制文件。

### GitHub Release 产物

推送 `v*` 标签或在 Actions 中手动运行 `Build And Release` 工作流，会构建三端安装版和便携版，并发布到对应 GitHub Release。`v1.0.2` 的资产文件清单如下：

| 平台 | Release Asset |
| --- | --- |
| Linux x64 | `Bilibili_Box-v1.0.2-linux-x64-installer.deb` |
| Linux x64 | `Bilibili_Box-v1.0.2-linux-x64-installer.rpm` |
| Linux x64 | `Bilibili_Box-v1.0.2-linux-x64-portable.tar.gz` |
| Windows x64 | `Bilibili_Box-v1.0.2-windows-x64-installer.exe` |
| Windows x64 | `Bilibili_Box-v1.0.2-windows-x64-portable.zip` |
| macOS arm64 | `Bilibili_Box-v1.0.2-macos-arm64-installer.dmg` |
| macOS arm64 | `Bilibili_Box-v1.0.2-macos-arm64-portable.zip` |
| macOS x64 | `Bilibili_Box-v1.0.2-macos-x64-installer.dmg` |
| macOS x64 | `Bilibili_Box-v1.0.2-macos-x64-portable.zip` |

安装包和便携包都会携带经过执行校验的 FFmpeg/FFprobe 运行环境：Windows 安装后位于程序目录 `env/`，Linux 安装后位于 `/opt/Bilibili_Box/env/`，macOS 位于应用包 `Contents/MacOS/env/`。便携包通过程序旁的 `data/` 保存数据；安装包使用系统应用数据目录。macOS 产物当前为未进行 Apple Developer ID 签名和公证的构建，首次打开时可能需要在系统安全设置中确认。

> `v1.0.0` 的 Windows 发布包误复制了 Chocolatey 的小型 shim 启动器，而非真实 FFmpeg 工具；`v1.0.1` 在发布校验阶段终止且未生成完整 Release。请分发 `v1.0.2` 或更高版本。

发布资产中包含独立的 GPL FFmpeg 工具及许可证文件，详细来源与许可说明见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

## 本地数据与安全

BiliBox 便携版把运行期数据写入程序同级目录：

```text
data/
  user/
    config.json
    user.json
  cache/
  download/
```

- `config.json` 保存本地配置和登录 Cookie。
- `user.json` 保存本地账号展示信息。
- `cache/` 按登录账号隔离保存浏览页面响应数据，页面刷新时会更新对应缓存。
- `download/` 是默认下载目录。

这些文件属于本机运行数据，不会提交到 Git，也不应该打进公开仓库。

安装版不在应用安装目录内创建 `data/`，而会在操作系统为应用提供的可写数据目录下保存同样的目录结构，避免 Linux 与 macOS 安装路径的权限问题。

项目内部的检查清单、质量审查与实现对照笔记同样不纳入公开仓库；公开仓库仅保留构建、运行、用户文档以及对二次开发有意义的工程资产。

## 项目结构

```text
bilibili-box/
  .github/workflows/         GitHub Release 自动构建工作流
  frontend/                 React 前端
    src/
      components/           通用组件和布局
      hooks/                前端 hooks
      lib/                  工具函数和类型定义
      stores/               Zustand 状态管理
      views/                首页、搜索、收藏、播放、下载等页面
  src-tauri/                Tauri/Rust 后端
    src/
      api/                  Bilibili API 封装
      config/               配置与本地数据路径
      download/             下载任务、分片、FFmpeg 集成
      plugin/               插件管理
      commands.rs           Tauri commands
      media_proxy.rs        内部媒体协议代理
  src-plugin/               插件相关 Rust 工程
  packaging/windows/        NSIS 安装包模板
  scripts/                  三端发布运行时准备脚本
  THIRD_PARTY_NOTICES.md    随包第三方工具许可说明
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

## 免责声明

本项目仅用于学习、研究与个人数据管理。请遵守 Bilibili 用户协议、版权规则和当地法律法规。下载或缓存内容前，请确保你拥有相应权限。

## License

[MIT](./LICENSE)
