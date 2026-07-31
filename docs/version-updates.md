## 新版本内容

### 新增与优化

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
- Linux 通用便携：下载 `Bilibili_Box-v*-linux-x64-portable.tar.gz`

`.sig` 和 `latest.json` 主要用于自动更新与签名校验，普通安装通常不需要手动下载。
