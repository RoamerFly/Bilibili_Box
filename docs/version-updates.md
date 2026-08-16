## 新版本内容

### 新增与优化

- 新增「AI 总结」功能：播放页一键生成视频内容总结，输出核心观点与按时间戳划分的章节，支持多语言输出。
- AI 总结优先使用官方字幕，无字幕时自动切换本地语音识别兜底，结果自动缓存，并支持配置多个 AI 供应商与模型。
- 优化 AI 总结生成流程：分块并发分析、单分块直出与字幕转录缓存，减少重复请求、降低耗时与调用成本。
- 自动更新增加安装包数字签名和官方来源校验，下载更新更安全。
- 页面发生异常时提供返回首页和重新加载入口，避免整个应用白屏。
- 精简启动资源和内部依赖，降低图标资源体积并改善构建效率。

### 修复的问题

- 修复开启“启动时最大化”后仍以普通窗口启动的问题。
- 修复下载暂停、等待或网络停滞后速度显示没有及时归零的问题。
- 修复部分签名请求因密钥长度错误而失败的问题。
- 修复下载任务状态转换逻辑重复、不同事件显示不一致的问题。

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
