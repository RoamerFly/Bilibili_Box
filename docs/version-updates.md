## 新版本内容

### 新增与优化

- 下载失败的任务现在可以单独重试，也可以在下载栏中一键重试全部失败任务。
- 下载完成的合集支持播放单个视频或连续播放全部视频，切换视频时会同步更新标题、封面和 UP 主信息。
- 新增完整播放器快捷键：空格播放/暂停，方向键调节音量和进度，长按左右键进行三倍速播放或连续后退，`F`/`Esc` 切换全屏。
- 新增后台运行支持，可在设置中选择关闭窗口时每次询问、最小化到托盘或直接退出；托盘运行期间下载不会中断。

### 修复的问题

- 修复网页层全屏未覆盖桌面窗口底部，导致播放器下方仍有空缺、边框或异常横条的问题。
- 修复连续播放合集时，右上角 UP 主资料没有随当前视频更新的问题。
- 修复空格键可能聚焦全屏按钮，以及 `F` 键在部分情况下无法进入或退出全屏的问题。

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
