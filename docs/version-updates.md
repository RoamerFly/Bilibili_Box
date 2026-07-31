## 新版本内容

本版本重点修复页面刷新后内容不更新，以及部分视频卡片显示“未知UP”的问题。

### 新增与优化

- 页面缓存增加自动过期机制：短时间返回页面仍可快速恢复，过期后会主动获取最新内容。
- “推荐/关注动态”等页面手动刷新时强制获取新数据，推荐页会切换到下一批内容。
- UP 主主页刷新时会同时更新主页资料和内容列表。
- 网络暂时不可用时保留已缓存内容作为离线回退，避免页面直接变空。

### 修复的问题

- 修复关注动态刷新后仍显示旧缓存、无法及时看到当天新动态的问题。
- 修复部分页面必须在设置中“清空页面缓存并更新所有页面”后才能更新的问题。
- 修复推荐页手动刷新后仍可能重复显示同一批内容的问题。
- 修复最近点赞等页面因接口作者字段不完整而显示“未知UP”或默认头像的问题。

## 下载建议

- Windows 安装版（推荐大多数用户）：下载 `Bilibili_Box-v*-windows-x64-installer.exe`
- Windows 便携版（免安装）：下载 `Bilibili_Box-v*-windows-x64-portable.zip`，解压后运行里面的 `Bilibili_Box.exe`
- macOS Apple Silicon / M 系列：下载 `Bilibili_Box-v*-macos-arm64-installer.dmg`
- macOS Intel：下载 `Bilibili_Box-v*-macos-x64-installer.dmg`
- Linux Debian/Ubuntu：下载 `Bilibili_Box-v*-linux-x64-installer.deb`
- Linux Fedora/openSUSE/RHEL：下载 `Bilibili_Box-v*-linux-x64-installer.rpm`
- Linux 通用便携：下载 `Bilibili_Box-v*-linux-x64-portable.tar.gz`

`.sig` 和 `latest.json` 主要用于自动更新与签名校验，普通安装通常不需要手动下载。
