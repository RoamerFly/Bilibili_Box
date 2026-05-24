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

- **桌面体验优先**：基于 Tauri 2 构建，体积更轻，启动更快，系统集成更自然。
- **真实业务闭环**：搜索、推荐、收藏夹、历史、稍后再看、追番追剧、下载队列都接入实际业务逻辑。
- **播放和下载联动**：从任意列表进入播放页，确认资源后可直接加入后台下载。
- **适合分发给非开发用户**：Windows 分发脚本会把 FFmpeg/FFprobe 放入 `env/`，避免“我电脑能跑，朋友电脑报错”的环境差异。
- **本地优先**：登录态、用户信息和下载数据默认写入 exe 同级 `data/`，不上传、不内置到构建产物。

## 功能亮点

### 账号与登录

- 二维码登录、Cookie 登录、内置浏览器登录。
- 自动保存登录状态到本地 `data/user/`。
- 启动后自动恢复账号信息、头像和登录态。

### 内容发现

- 推荐视频。
- 聚合搜索，支持任意关键词、BV/AV 号和视频链接。
- 搜索结果支持排序、发布时间、视频时长筛选。
- 我的收藏、稍后再看、观看历史、追番追剧。

### 播放能力

- 通用播放页面。
- 支持从搜索、收藏、历史、稍后再看、追番追剧等页面进入播放。
- 使用 Tauri 内部媒体协议代理远程媒体资源，减少打包后本地 TCP 代理失效问题。
- 下载完成的视频可直接从首页或下载列表进入播放，复用内部媒体协议读取本地文件。
- 分集视频可在播放页一键加入全部剧集下载任务。

### 下载管理

- 后台下载，不强制跳转页面。
- 下载队列支持多选、批量开始、批量暂停、批量删除和单项打开所在目录。
- 删除任务时可选择仅移除记录，或同步删除本地下载文件。
- 底部上拉面板实时展示视频分片、音频分片、合并、完成和失败原因，最新任务优先显示。
- 上拉面板支持单项暂停、继续、删除，并在点击界面其他区域后自动收起。
- 支持 FFmpeg/FFprobe 自动发现与分发目录打包。
- 支持清晰度、编码、音频质量、并发数量、文件存在策略等配置。

### 个性化设置

- 主题、下载目录、默认清晰度、任务并发、分片并发。
- 卡片尺寸、每页数量、启动最大化。
- 默认下载目录使用 exe 同级相对路径，适合绿色分发。

## 界面预览

> 下方已放入可渲染的占位图。你截图后可以直接替换 `docs/screenshots/` 中的同名文件，建议尺寸统一为 1600×900 或 1920×1080。

### 首页

![Home Preview](./docs/screenshots/home.svg)

### 搜索视频

![Search Preview](./docs/screenshots/search.svg)

### 我的收藏

![Favorites Preview](./docs/screenshots/favorites.svg)

### 播放页面

![Player Preview](./docs/screenshots/player.svg)

### 下载队列

![Downloads Preview](./docs/screenshots/downloads.svg)

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
| FFmpeg/FFprobe | 下载、合并和部分媒体处理能力需要 |

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
.\build-windows.bat
```

构建脚本会生成 `dist_windows/`，并尝试从以下位置复制 FFmpeg/FFprobe：

- `env/ffmpeg.exe`、`env/ffprobe.exe`
- `env/bin/ffmpeg.exe`、`env/bin/ffprobe.exe`
- `env/ffmpeg/bin/ffmpeg.exe`、`env/ffmpeg/bin/ffprobe.exe`
- 系统 `PATH`

分发给其他电脑时，请发送整个 `dist_windows/` 目录，而不是只发送单个 exe。

## 本地数据与安全

BiliBox 默认把运行期数据写入 exe 同级目录：

```text
data/
  user/
    config.json
    user.json
  download/
```

- `config.json` 保存本地配置和登录 Cookie。
- `user.json` 保存本地账号展示信息。
- `download/` 是默认下载目录。

这些文件属于本机运行数据，不会提交到 Git，也不应该打进公开仓库。

项目内部的检查清单、质量审查与实现对照笔记同样不纳入公开仓库；公开仓库仅保留构建、运行、用户文档以及对二次开发有意义的工程资产。

## 项目结构

```text
bilibili-box/
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

## 路线图

- [x] 二维码、Cookie、内置浏览器登录。
- [x] 收藏夹、稍后再看、历史、追番追剧接入。
- [x] 通用播放页面与内部媒体协议代理。
- [x] 后台下载队列、可操作底部下载面板与下载任务状态追踪。
- [x] 已下载视频的本地播放与任务文件管理。
- [x] Windows 分发脚本补齐 FFmpeg/FFprobe 环境。
- [ ] 更完整的 DASH 音视频合流播放策略。
- [ ] 更细粒度的下载任务恢复与失败重试。
- [ ] 插件系统示例与开发文档。

## 免责声明

本项目仅用于学习、研究与个人数据管理。请遵守 Bilibili 用户协议、版权规则和当地法律法规。下载或缓存内容前，请确保你拥有相应权限。

## License

[MIT](./LICENSE)
