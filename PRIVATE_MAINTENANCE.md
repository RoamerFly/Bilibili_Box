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
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：签名私钥密码；没有密码时可为空。

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
