## 新版本内容

### 新增与优化

- 新增「提示词模板」自定义与实时预览：生成 AI 总结时可自定义附加给模型的上下文，支持标题、简介、UP 主、BV/AV 号、字幕等变量替换。
- AI 总结章节时间戳更精确：章节起点绑定主题过渡句，并吸附到真实字幕分段时间点，避免提前、取整或估算漂移。
- 优化 AI 总结生成：短视频跳过二次汇总、字幕转录结果自动缓存，重新生成不再重复拉取，降低耗时与调用成本。
- 下载完成的视频支持「播放全部」：按时间顺序连续播放整组已完成视频，分集视频可一键连播。
- 检查更新改为弹窗展示：展示版本更新说明，并支持一键前往发布页；更新包缺少数字签名时明确提示并引导手动下载。

### 修复的问题

- 修复播放页顶部「总结 / 刷新 / 浏览器打开」按钮在右上角与下一行之间错位的问题，统一固定在右上角，标题或简介过长时自动换行。
- 修复 AI 设置「启用 AI 功能」开关单独占一行、浪费空间的问题，改为紧凑内联布局。
- 修复更新包缺少数字签名时仍尝试应用内下载、导致验签失败的问题，改为先校验签名再决定是否提供应用内下载。
- 修复播放页分辨率和倍速首次播放时显示为空、需鼠标悬浮才显示当前设置的问题。

### 交互与体验

- 搜索过程中将鼠标悬浮在「搜索中」按钮上会变为「取消」，点击即可立即取消本次搜索。

## 下载建议

- Windows 安装版（推荐大多数用户）：下载 `Bilibili_Box-v*-windows-x64-installer.exe`
- Windows 便携版（免安装）：下载 `Bilibili_Box-v*-windows-x64-portable.zip`，解压后运行里面的 `Bilibili_Box.exe`
- macOS Apple Silicon / M 系列：下载 `Bilibili_Box-v*-macos-arm64-installer.dmg`
- macOS Intel：下载 `Bilibili_Box-v*-macos-x64-installer.dmg`
- Linux Debian/Ubuntu：下载 `Bilibili_Box-v*-linux-x64-installer.deb`
- Linux Fedora/openSUSE/RHEL：下载 `Bilibili_Box-v*-linux-x64-installer.rpm`
- Linux 通用 AppImage：下载 `Bilibili_Box-v*-linux-x64-appimage.AppImage`
- Linux 通用便携：下载 `Bilibili_Box-v*-linux-x64-portable.tar.gz`

Linux 应用内自动更新仅支持已验签的 AppImage；Deb/RPM 请使用系统包管理器或手动安装。`.sig` 和 `latest.json` 主要用于自动更新与签名校验，普通安装通常不需要手动下载。
