<div align="center">
  <img src="./frontend/src/assets/app-icon.png" width="136" height="136" alt="BiliBox Logo" />
  <h1>BiliBox</h1>

  <p>一个现代化的 Bilibili 桌面媒体工作台。</p>
  <p><strong>搜索、推荐、收藏、历史、追番、播放与下载管理，一站完成。</strong></p>

  <p>
    <a href="https://github.com/RoamerFly/Bilibili_Box/releases/latest"><img src="https://img.shields.io/github/v/release/RoamerFly/Bilibili_Box?style=flat-square" alt="Release" /></a>
    <a href="https://github.com/RoamerFly/Bilibili_Box/releases"><img src="https://img.shields.io/github/downloads/RoamerFly/Bilibili_Box/total?style=flat-square" alt="Downloads" /></a>
    <a href="https://github.com/RoamerFly/Bilibili_Box/stargazers"><img src="https://img.shields.io/github/stars/RoamerFly/Bilibili_Box?style=flat-square" alt="Stars" /></a>
    <img src="https://img.shields.io/badge/Source-UI%20Preview-2ea44f?style=flat-square" alt="UI Preview" />
    <img src="https://img.shields.io/badge/Frontend-React%20%7C%20Vite%20%7C%20TypeScript-3178c6?style=flat-square" alt="Frontend" />
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-Non--Commercial-red?style=flat-square" alt="Non-Commercial License" /></a>
  </p>
</div>

---

## 功能亮点

- 聚合搜索、推荐视频与关注动态
- 收藏夹、最近点赞、稍后再看与观看历史
- 追番追剧、UP 主页、视频与专栏详情
- 多分集播放、评论区与互动状态
- 下载队列、批量任务与底部悬浮下载栏
- 亮色、暗色与系统主题
- 页面缓存、卡片布局和显示密度设置

完整桌面应用请前往 [Releases](https://github.com/RoamerFly/Bilibili_Box/releases/latest) 下载。

## 界面预览

| 首页 | 推荐 |
| --- | --- |
| ![首页](docs/screenshots/home.png) | ![推荐](docs/screenshots/recommend.png) |

| 聚合搜索 | 播放页 |
| --- | --- |
| ![聚合搜索](docs/screenshots/search.png) | ![播放页](docs/screenshots/player.png) |

| 关注动态 | 收藏夹 |
| --- | --- |
| ![关注动态](docs/screenshots/dynamic.png) | ![收藏夹](docs/screenshots/favorites.png) |

| 下载列表 | 设置 |
| --- | --- |
| ![下载列表](docs/screenshots/downloads.png) | ![设置](docs/screenshots/settings.png) |

## 本地界面预览

仓库中的开发模式使用本地演示数据，便于查看界面、主题、布局和交互，不需要账号信息。

环境要求：

- Node.js 20 或更高版本
- npm 10 或更高版本

```bash
npm install
npm --prefix frontend install
npm run dev
```

生产构建：

```bash
npm run build
```

构建结果输出到 `dist/`。

## 下载建议

- Windows 安装版：`Bilibili_Box-v*-windows-x64-installer.exe`
- Windows 便携版：`Bilibili_Box-v*-windows-x64-portable.zip`
- macOS Apple Silicon：`Bilibili_Box-v*-macos-arm64-installer.dmg`
- macOS Intel：`Bilibili_Box-v*-macos-x64-installer.dmg`
- Debian / Ubuntu：`Bilibili_Box-v*-linux-x64-installer.deb`
- Fedora / openSUSE / RHEL：`Bilibili_Box-v*-linux-x64-installer.rpm`
- Linux 通用便携版：`Bilibili_Box-v*-linux-x64-portable.tar.gz`

`.sig` 和 `latest.json` 用于自动更新与签名校验，普通安装通常不需要手动下载。

## 许可证

项目采用 [BiliBox Non-Commercial License](LICENSE)，仅允许个人、教育、研究及其他非商业用途。

使用本项目时请遵守所在地法律法规、平台服务条款与内容版权要求。
