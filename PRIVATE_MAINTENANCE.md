# BiliBox 私有源码与公开发布维护说明

此仓库是 BiliBox 完整版本的唯一源码主线，包含真实平台连接、账号会话、下载解析、Tauri/Rust 后端及跨平台构建发布逻辑。所有后端和完整应用变更都应只在此仓库开发、审查、提交和打标签。

公开仓库 `RoamerFly/Bilibili_Box` 只保存无真实平台连接能力的前端演示外壳。不要把本文件、私有仓库地址、真实接口实现、Cookie 处理、请求参数、下载解析、风控细节、签名配置或内部发布方式同步到公开仓库。

## 日常开发

1. 从本私有仓库创建功能分支。
2. 前端与后端改动在本仓库一起完成并运行完整构建。
3. 仅当需要公开界面改动时，才把纯 UI、样式、前端类型和 Mock 可表达的交互同步到公开仓库。
4. 同步前必须检查公开差异，确认不包含真实端点、请求头、Cookie、签名、协议、下载器或构建密钥信息。

## 跨仓库 Release

完整应用由本私有仓库的 `.github/workflows/release.yml` 构建。工作流完成 Linux、Windows、macOS 构建、签名和 `latest.json` 生成后，会把产物发布到公开仓库 `RoamerFly/Bilibili_Box` 的同名 Release。

在本私有仓库的 Actions secrets 中配置：

- `PUBLIC_RELEASE_TOKEN`：GitHub fine-grained personal access token，仅授权 `RoamerFly/Bilibili_Box`，Repository permissions 中 `Contents` 设为 `Read and write`。
- `TAURI_UPDATER_PRIVATE_KEY` 或 `TAURI_SIGNING_PRIVATE_KEY`：Tauri 更新签名私钥。
- `TAURI_UPDATER_PRIVATE_KEY_PASSWORD`：新更新私钥的密码；没有密码时不需要创建。仅在回退使用旧 `TAURI_SIGNING_PRIVATE_KEY` 时读取 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。
- 可选 macOS Developer ID 签名：`APPLE_CERTIFICATE_BASE64`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY`。
- 可选 macOS 公证：`APPLE_ID`、`APPLE_TEAM_ID`、`APPLE_APP_PASSWORD`（需同时配置上面的 Developer ID 证书）。

没有 Apple secrets 时，工作流只做 ad-hoc 签名，并明确标记产物未公证、不可视为 Gatekeeper 发布就绪；只有配置完整的 Developer ID 与公证凭据时才会 notarize/staple DMG。

与私钥配对的 Minisign 公钥不属于机密，保存在 Release 工作流的 `BILIBOX_UPDATER_PUBLIC_KEY` 中；构建时会嵌入应用，用于安装更新前验证签名。

不要把这些值写入文件、提交记录、构建日志或公开仓库。

## 发布步骤

1. 更新所有版本号和 `docs/version-updates.md`。
2. 在本私有仓库提交并推送完整源码。
3. 创建并推送版本标签，例如 `v1.0.9`。
4. 私有 Actions 自动构建完整应用。
5. 工作流使用 `PUBLIC_RELEASE_TOKEN` 在公开仓库创建或更新同名 Release，并上传安装包、便携包、签名和 `latest.json`。
6. 检查公开 Release 的正文、资产名称、签名和更新清单；公开标签只应指向公开外壳的安全提交。

## 公开仓库历史维护

公开仓库主线应保持为无父提交或只包含公开外壳历史，不得合并本仓库分支。现有 Release 附件可以保留，但所有公开分支和版本标签都必须指向不含完整后端的安全提交，否则 GitHub 自动生成的 Source code 压缩包仍会暴露后端历史。

如果完整源码曾经被推送到公开引用，需要：

1. 先确认本私有仓库已保存完整主线和所有标签。
2. 用清理后的公开外壳提交替换公开主线。
3. 将公开版本标签移动到安全提交，保留 Release 与附件。
4. 删除其他仍可到达旧历史的公开分支或标签。
5. 验证公开克隆、标签和 Source code 压缩包均不包含后端路径或敏感实现。

改写公开引用无法撤回第三方此前已经完成的克隆、分叉或缓存；发现真实凭据泄露时必须立即轮换凭据，不能只依赖删除 Git 历史。

## 应用内更新与签名校验

应用内「检查更新 → 下载安装」依赖 Minisign 签名校验。公私钥配对关系跨越三处（构建、CI 签名、运行时验签），理解它才能排查「签名校验失败」。

### 原理流程

1. **构建嵌入公钥**：`BILIBOX_UPDATER_PUBLIC_KEY`（Minisign 公钥，整体 base64 编码）通过 `option_env!` 注入二进制，运行时由 `src-tauri/src/commands/update.rs` 的 `parse_update_public_key` 解析。它是公开的，写在 `.github/workflows/release.yml` 的 `env` 里，不是机密。
2. **发布时签名**：CI 用私钥（Actions secret `TAURI_UPDATER_PRIVATE_KEY`，回退 `TAURI_SIGNING_PRIVATE_KEY`）经 `npx @tauri-apps/cli@2 signer sign` 为每个安装包生成 `.sig`。
3. **生成清单**：`scripts/finalize-updater-metadata.mjs` 读取 `.sig` 内容写入 `latest.json` 的 `platforms.<platform>.signature`；找不到任何带签名的资产时会直接报错退出。
4. **运行时验签**：`download_and_install_update` 下载安装包后调用 `verify_update_signature`，用嵌入的公钥对 `Signature::decode(signature)` 做 `PublicKey::verify`，通过后才启动安装。

### 关键坑（接手必读）

- **公钥为何 base64**：Minisign 公钥是「注释行 + 密钥行」两行，中间换行在环境变量里会被吞掉，所以整体 base64 编码后再注入。`parse_update_public_key` 依次尝试三种形态：标准多行文本 → base64 整体解码后的文本 → 纯 base64 密钥行。改动前先看 `update.rs` 里的回归测试 `parses_base64_encoded_update_public_key`。
- **私钥不在仓库**：私钥只存在于私有仓库的 Actions secrets，代码里搜不到是正常的。公私钥必须来自同一对，否则运行时验签必失败。
- **本地开发验签失败是预期**：`cargo build`/`cargo check` 产出的本地程序没有注入 `BILIBOX_UPDATER_PUBLIC_KEY`，`option_env!` 返回空，`verify_update_signature` 会拒绝安装并报「当前构建未配置更新验签公钥」。这是有意为之，不是 bug；用正式发布产物验证更新链路。
- **`installable` 标志**：`check_update` 返回的 `installable` 仅在「存在安装包且签名非空」时为 true，前端据此决定是否显示「下载更新」。检查能成功但下载会失败的最常见原因，是回退源（GitHub API / 网页 / GitCode）没有签名。

### 签名失败排查清单

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 「更新验签公钥无效」 | 公钥 base64 解析问题（历史 bug，已修复） | 确认 `BILIBOX_UPDATER_PUBLIC_KEY` 是完整 base64，且密钥行可被 `PublicKey::from_base64` 解析 |
| 「当前构建未配置更新验签公钥」 | 本地/非发布构建没有注入公钥 | 预期行为，用正式发布产物验证 |
| 「更新包缺少数字签名」 | `latest.json` 的 signature 为空，或走了无签名的回退源 | 检查 `.sig` 是否生成并上传、`finalize-updater-metadata.mjs` 是否成功 |
| 「更新包签名验证失败」 | 公私钥不匹配，或 `.sig` 与安装包版本不对应 | 确认 CI secret 私钥与嵌入公钥同对，重新发布 |

### 轮换密钥

需要更换签名密钥时，用 Tauri CLI 的 signer 命令重新生成 Minisign 密钥对，同步更新私有仓库 secrets 里的私钥（`TAURI_UPDATER_PRIVATE_KEY`）和 `release.yml` env 里的 `BILIBOX_UPDATER_PUBLIC_KEY`（base64 编码新公钥），二者必须成对。旧版本客户端嵌入的是旧公钥，无法验证新签名，只能提示去发布页手动更新。
