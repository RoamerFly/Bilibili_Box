bilibili-video-downloader在../bilibili-video-downloader，下列所有相对路径都是基于../bilibili-video-downloader的象相对路径

# bilibili-video-downloader 联网 API 梳理

## 1. 说明与范围

本文只整理**项目源码里真实发起外网请求的功能点**，并把下面三件事串起来：

1. 外部 API / 资源地址是怎么请求的
2. 项目前端页面从哪里触发这次请求
3. 响应在什么位置被解析、加工和回填到页面/下载任务里

结论先说：

- 前端 `Vue` 页面**没有直接 `fetch/axios` 请求外网**。
- 所有外网请求都由 `Tauri + Rust` 后端发出，前端只通过 `src/bindings.ts` 里的 `commands.*` 调用 Tauri 命令。
- 下载相关的很多联网动作不是页面直接发起的，而是页面先调用 `createDownloadTasks`，后续由下载器后台自动请求播放地址、分片、弹幕、字幕、封面、标签、跳过片段等。

不属于联网 API 的内容：

- 配置读写：`get_config` / `save_config`
- 日志读取：`get_logs_dir_size` / `open_log_file`
- 文件管理器打开路径：`show_path_in_file_manager`
- 插件管理的本地文件操作

---

## 2. 联网调用总架构

### 2.1 前端到 Rust 的调用链

所有页面统一走下面这条链：

`Vue 页面` -> `src/bindings.ts` -> `src-tauri/src/commands.rs` -> `src-tauri/src/bili_client.rs` -> `外部接口`

典型包装位置：

- `src/bindings.ts:22-210`
- `src-tauri/src/commands.rs:107-477`

### 2.2 下载链路的特殊路径

下载相关页面先创建任务，真正联网发生在后台：

`页面点击下载` -> `commands.createDownloadTasks(...)` -> `DownloadManager` 创建任务 -> `DownloadProgress::prepare(...)` 请求播放地址 -> 各子任务继续请求分片/字幕/弹幕/封面/NFO 辅助数据

关键位置：

- 页面触发下载：
  - `src/panes/SearchPane/components/NormalSinglePanel.vue:10-17`
  - `src/panes/SearchPane/components/NormalSeasonPanel.vue:55-63,128-145`
  - `src/panes/SearchPane/components/BangumiPanel.vue:172-183`
  - `src/panes/SearchPane/components/CheesePanel.vue:58-58,124-129`
  - `src/panes/SearchPane/components/UserVideoPanel.vue:94-103,105-116`
  - `src/panes/SearchPane/components/PartsDialogContent.vue:15-23`
  - `src/panes/WatchLaterPane/components/WatchLaterPanel.vue:91-113`
  - `src/panes/FavPane/components/FavPanel.vue:138-159`
  - `src/panes/HistoryPane/components/HistoryPanel.vue:188-209`
  - `src/panes/BangumiFollow/components/BangumiFollowPanel.vue:128-151`
- 下载准备入口：
  - `src-tauri/src/downloader/download_progress.rs:332-415`
- 下载 UI 响应处理（事件驱动）：
  - `src/panes/DownloadPane/DownloadPane.vue:25-155`

---

## 3. 通用请求约定

### 3.1 通用客户端

Rust 端维护了 3 类客户端：

- `api_client`：普通 B 站接口
- `media_client`：媒体分片下载
- `content_length_client`：探测媒体长度

代码位置：

- `src-tauri/src/bili_client.rs:43-76`
- `src-tauri/src/bili_client.rs:1081-1164`

### 3.2 默认请求头

所有客户端默认带：

- `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36`
- `Referer: https://www.bilibili.com/`

代码位置：

- `src-tauri/src/bili_client.rs:40-41`
- `src-tauri/src/bili_client.rs:1087-1095`
- `src-tauri/src/bili_client.rs:1109-1116`
- `src-tauri/src/bili_client.rs:1125-1133`

### 3.3 Cookie 注入方式

需要登录态的接口统一使用：

- `Cookie: SESSDATA=<value>`

生成位置：

- `src-tauri/src/bili_client.rs:1075-1078`

注意：

- 会自动去掉末尾多余分号：`trim_end_matches(';')`

### 3.4 代理、超时、重试

代理模式来自配置：

- `NoProxy`
- `System`
- `Custom`

代码位置：

- `src-tauri/src/bili_client.rs:1141-1164`

超时与重试：

- `api_client`：超时 3 秒，指数退避，总重试时长 5 秒
- `media_client`：最多重试 3 次
- `content_length_client`：超时 5 秒

代码位置：

- `src-tauri/src/bili_client.rs:1081-1134`

### 3.5 B 站统一响应包解析

大多数 B 站接口都先解析成：

```rust
pub struct BiliResp {
    pub code: i64,
    pub msg: String,
    pub data: Option<serde_json::Value>,
}
```

特点：

- `message` 和 `msg` 都兼容
- `result` 和 `data` 都兼容

代码位置：

- `src-tauri/src/bili_client.rs:1167-1174`

通用解析流程几乎一致：

1. 校验 HTTP 状态码必须是 `200`
2. 反序列化为 `BiliResp`
3. 校验 `code == 0`（少数接口单独放行/特殊处理）
4. 取出 `data`
5. 再反序列化成具体业务类型

---

## 4. 前端页面入口总表

这一节先给出“页面 -> Tauri 命令”的总览，后面每个外部接口再展开 Rust 侧细节。

### 4.1 登录页

- `src/dialogs/LoginDialog.vue:35-43`
  - `commands.getUserInfo(...)`
  - 成功后写入 `store.userInfo`
- `src/dialogs/LoginDialog.vue:57-72`
  - `commands.generateQrcode()`
  - 成功后写入 `qrcodeData`
- `src/dialogs/LoginDialog.vue:75-85`
  - `commands.getQrcodeStatus(...)`
  - 成功后写入 `qrcodeStatus`
- `src/dialogs/LoginDialog.vue:87-97`
  - 从回调 URL 中提取 `SESSDATA` 并写回配置

### 4.2 搜索页

- `src/panes/SearchPane/SearchPane.vue:60-87`
  - 根据搜索类型调度不同查询
- `src/panes/SearchPane/SearchPane.vue:148-153`
  - `commands.search(params)`，自动识别模式
- `src/panes/SearchPane/SearchPane.vue:181-186`
  - `commands.search({ Normal: ... })`
- `src/panes/SearchPane/SearchPane.vue:217-222`
  - `commands.search({ Bangumi: ... })`
- `src/panes/SearchPane/SearchPane.vue:253-258`
  - `commands.search({ Cheese: ... })`
- `src/panes/SearchPane/SearchPane.vue:286-291`
  - `commands.search({ UserVideo: ... })`
- `src/panes/SearchPane/SearchPane.vue:319-324`
  - `commands.search({ Fav: ... })`

### 4.3 收藏夹 / 稍后再看 / 追番 / 历史

- 稍后再看初始化：`src/panes/WatchLaterPane/WatchLaterPane.vue:12-25`
- 稍后再看翻页：`src/panes/WatchLaterPane/components/WatchLaterPanel.vue:115-123`
- 收藏夹初始化：`src/panes/FavPane/FavPane.vue:12-32`
- 收藏夹目录列表：`src/panes/FavPane/components/FavPanel.vue:39-46`
- 收藏夹内容翻页：`src/panes/FavPane/components/FavPanel.vue:58-66`
- 追番初始化：`src/panes/BangumiFollow/BangumiFollowPane.vue:12-30`
- 追番筛选/翻页：`src/panes/BangumiFollow/components/BangumiFollowPanel.vue:108-126`
- 历史初始化：`src/panes/HistoryPane/HistoryPane.vue:12-34`
- 历史筛选/翻页：`src/panes/HistoryPane/components/HistoryPanel.vue:98-118`

### 4.4 下载配置修改页

- `src/panes/DownloadPane/components/ModifyProgressDialogContent.vue:74-103`
  - `commands.getAvailableMediaFormats(...)`
  - 成功后写入 `availableMediaFormats`
- `src/panes/DownloadPane/components/ModifyProgressDialogContent.vue:105-128`
  - `commands.restartDownloadTask(...)`

---

## 5. 外部接口逐项详解

## 5.1 登录二维码生成

- 外部接口：`GET https://passport.bilibili.com/x/passport-login/web/qrcode/generate`
- 前端入口：
  - `src/dialogs/LoginDialog.vue:57-63`
- 页面响应处理：
  - `src/dialogs/LoginDialog.vue:63-72`
  - 返回后写入 `qrcodeData`，并启动 1 秒轮询
- Tauri 包装：
  - `src/bindings.ts:22-28`
  - `src-tauri/src/commands.rs:107-117`
- Rust 请求实现：
  - `src-tauri/src/bili_client.rs:79-108`

请求方式：

- 无 query 参数
- 使用默认 `User-Agent` / `Referer`
- 不强制带 `SESSDATA`

响应处理：

1. HTTP 必须 `200`
2. 解析 `BiliResp`
3. 要求 `code == 0`
4. `data` 反序列化为 `QrcodeData`

返回模型：

- `QrcodeData { url, qrcode_key }`
- 类型定义位置：`src/bindings.ts` 中导出的 `QrcodeData`

---

## 5.2 登录二维码轮询状态

- 外部接口：`GET https://passport.bilibili.com/x/passport-login/web/qrcode/poll`
- 前端入口：
  - `src/dialogs/LoginDialog.vue:75-85`
- 页面响应处理：
  - `src/dialogs/LoginDialog.vue:84-97`
  - `code === 0` 时从 `qrcodeStatus.url` 中拆出 `SESSDATA`
- Tauri 包装：
  - `src/bindings.ts:30-36`
  - `src-tauri/src/commands.rs:119-130`
- Rust 请求实现：
  - `src-tauri/src/bili_client.rs:111-144`

请求方式：

- Query：`qrcode_key`

响应处理：

1. HTTP 必须 `200`
2. 解析 `BiliResp`
3. 要求 `code == 0`
4. `data` 反序列化为 `QrcodeStatus`
5. 额外允许的二维码状态码：`0 / 86101 / 86090 / 86038`

页面侧特殊逻辑：

- `src/dialogs/LoginDialog.vue:92-95`
  - 从 `qrcodeStatus.url` 中提取 `SESSDATA`
  - 再 `encodeURIComponent`

---

## 5.3 获取当前用户信息

- 外部接口：`GET https://api.bilibili.com/x/web-interface/nav`
- 用途：
  - Cookie 登录后校验 `SESSDATA`
  - 获取昵称、头像、等级、mid 等
- 前端入口：
  - `src/dialogs/LoginDialog.vue:22-45`
- 页面响应处理：
  - `src/dialogs/LoginDialog.vue:35-43`
  - 成功后 `store.userInfo = result.data`
- Tauri 包装：
  - `src/bindings.ts:38-44`
  - `src-tauri/src/commands.rs:132-142`
- Rust 请求实现：
  - `src-tauri/src/bili_client.rs:146-180`

请求方式：

- Header：`Cookie: SESSDATA=<sessdata>`

响应处理：

1. HTTP 必须 `200`
2. 解析 `BiliResp`
3. `code == -101` 视为 Cookie 失效
4. `data` 反序列化为 `UserInfo`

额外用途：

- 同一个 `nav` 接口也被 `WBI` 签名逻辑复用来拿 `wbi_img`

---

## 5.4 获取 WBI 签名密钥

- 外部接口：`GET https://api.bilibili.com/x/web-interface/nav`
- 用途：
  - 不是页面直接调用
  - 专门给 `x/space/wbi/arc/search` 做 `w_rid` / `wts` 签名
- 页面间接入口：
  - `src/panes/SearchPane/SearchPane.vue:286-291`
  - `src/panes/SearchPane/components/UserVideoPanel.vue:118-127`
- Rust 触发位置：
  - `src-tauri/src/bili_client.rs:333`
  - `src-tauri/src/wbi.rs:27-86`

请求方式：

- Header：`Cookie: SESSDATA=<配置中的登录态>`

签名处理逻辑：

1. 从 `data.wbi_img.img_url` 和 `data.wbi_img.sub_url` 提取文件名
2. 拼接得到原始 key
3. 按 `MIXIN_KEY_ENC_TAB` 重排取前 32 位
4. 参数里附加 `wts`
5. 参数按 key 排序并 URL 编码
6. `md5(query + mixin_key)` 得到 `w_rid`

代码位置：

- `src-tauri/src/wbi.rs:10-14`
- `src-tauri/src/wbi.rs:27-48`
- `src-tauri/src/wbi.rs:50-86`
- `src-tauri/src/wbi.rs:89-122`

---

## 5.5 获取普通视频详情

- 外部接口：`GET https://api.bilibili.com/x/web-interface/view`
- 前端入口：
  - 搜索页普通视频搜索：`src/panes/SearchPane/SearchPane.vue:156-186`（实际走 `commands.search`）
  - 稍后再看下载前补全详情：`src/panes/WatchLaterPane/components/WatchLaterPanel.vue:91-100`
  - 收藏夹下载前补全详情：`src/panes/FavPane/components/FavPanel.vue:138-147`
  - 历史下载前补全详情：`src/panes/HistoryPane/components/HistoryPanel.vue:188-197`
  - UP 投稿下载前补全详情：`src/panes/SearchPane/components/UserVideoPanel.vue:94-103`
  - 追番结果里的普通视频下载：`src/panes/SearchPane/components/BangumiPanel.vue:177-183`
  - NFO / JSON 下载子任务内部懒加载：`src-tauri/src/downloader/episode_info.rs:44-51`
- 页面响应处理：
  - 搜索页：`src/panes/SearchPane/SearchPane.vue:181-186`
  - 各下载前调用：成功后把 `result.data` 填入 `createDownloadTasks`
- Tauri 包装：
  - `src/bindings.ts:46-52`
  - `src-tauri/src/commands.rs:159-172`
  - 聚合搜索命令：`src-tauri/src/commands.rs:329-335`
- Rust 请求实现：
  - `src-tauri/src/bili_client.rs:182-220`

请求方式：

- Query：
  - `bvid=<BV...>` 或
  - `aid=<av 数字>`
- Header：`Cookie: SESSDATA=<配置值>`

响应处理：

1. HTTP 必须 `200`
2. 解析 `BiliResp`
3. 要求 `code == 0`
4. `data` 反序列化为 `NormalInfo`

后续用途：

- 搜索面板展示普通视频/合集信息
- 创建普通视频下载任务
- 下载器后台再次取详情，用于 NFO / JSON 导出

---

## 5.6 获取番剧详情

- 外部接口：`GET https://api.bilibili.com/pgc/view/web/season`
- 前端入口：
  - 搜索页番剧搜索：`src/panes/SearchPane/SearchPane.vue:189-223`
  - 追番页下载整季前：`src/panes/BangumiFollow/components/BangumiFollowPanel.vue:128-139`
  - 下载子任务内部懒加载：`src-tauri/src/downloader/episode_info.rs:52-59`
- 页面响应处理：
  - 搜索页：`src/panes/SearchPane/SearchPane.vue:217-222`
  - 追番页：`src/panes/BangumiFollow/components/BangumiFollowPanel.vue:130-138`
- Tauri 包装：
  - `src/bindings.ts:54-60`
  - `src-tauri/src/commands.rs:144-157`
  - 聚合搜索命令：`src-tauri/src/commands.rs:336-360`
- Rust 请求实现：
  - `src-tauri/src/bili_client.rs:222-263`

请求方式：

- Query：
  - `ep_id=<数字>` 或
  - `season_id=<数字>`
- Header：`Cookie: SESSDATA=<配置值>`

响应处理：

1. HTTP 必须 `200`
2. 解析 `BiliResp`
3. 要求 `code == 0`
4. `data` 反序列化为 `BangumiInfo`

聚合搜索的额外处理：

- `commands.search` 在 `EpId` 模式下会继续从：
  - `info.episodes`
  - `info.section[].episodes`
  中查找命中的单集并回填到 `BangumiSearchResult.ep`
- 代码位置：`src-tauri/src/commands.rs:336-352`

---

## 5.7 获取课程（Cheese）详情

- 外部接口：`GET https://api.bilibili.com/pugv/view/web/season`
- 前端入口：
  - 搜索页课程搜索：`src/panes/SearchPane/SearchPane.vue:225-259`
  - 下载子任务内部懒加载：`src-tauri/src/downloader/episode_info.rs:60-67`
- 页面响应处理：
  - 搜索页：`src/panes/SearchPane/SearchPane.vue:253-258`
- Tauri 包装：
  - 没有单独暴露前端 `getCheeseInfo` wrapper，主要通过 `commands.search`
  - 聚合搜索命令：`src-tauri/src/commands.rs:361-375`
- Rust 请求实现：
  - `src-tauri/src/bili_client.rs:265-303`

请求方式：

- Query：
  - `ep_id=<数字>` 或
  - `season_id=<数字>`
- Header：`Cookie: SESSDATA=<配置值>`

响应处理：

1. HTTP 必须 `200`
2. 解析 `BiliResp`
3. 要求 `code == 0`
4. `data` 反序列化为 `CheeseInfo`

聚合搜索的额外处理：

- `EpId` 模式下会在 `info.episodes` 中查到对应单集并回填到 `CheeseSearchResult.ep`
- 代码位置：`src-tauri/src/commands.rs:361-367`

---

## 5.8 获取 UP 投稿列表

- 外部接口：`GET https://api.bilibili.com/x/space/wbi/arc/search`
- 前端入口：
  - 搜索页 UP 搜索：`src/panes/SearchPane/SearchPane.vue:261-292`
  - UP 投稿列表翻页：`src/panes/SearchPane/components/UserVideoPanel.vue:118-127`
- 页面响应处理：
  - 搜索页：`src/panes/SearchPane/SearchPane.vue:286-291`
  - 翻页：`src/panes/SearchPane/components/UserVideoPanel.vue:122-127`
- Tauri 包装：
  - `src/bindings.ts:62-68`
  - `src-tauri/src/commands.rs:174-187`
  - 聚合搜索命令：`src-tauri/src/commands.rs:376-382`
- Rust 请求实现：
  - `src-tauri/src/bili_client.rs:305-365`
- WBI 签名实现：
  - `src-tauri/src/wbi.rs:27-86`

请求方式：

- Query 固定包含：
  - `pn`
  - `ps=42`
  - `mid`
  - `dm_img_list=[]`
  - `dm_img_str=<随机 base64>`
  - `dm_cover_img_str=<随机 base64>`
  - `dm_img_inter={"ds":[],"wh":[0,0,0],"of":[0,0,0]}`
  - `wts`
  - `w_rid`
- Header：`Cookie: SESSDATA=<配置值>`

随机参数生成位置：

- `src-tauri/src/bili_client.rs:310-333`

响应处理：

1. HTTP 必须 `200`
2. 解析 `BiliResp`
3. `code == 0`
4. `data` 反序列化为 `UserVideoInfo`

---

## 5.9 获取普通视频播放地址

- 外部接口：`GET https://api.bilibili.com/x/player/wbi/playurl`
- 页面直接入口：
  - 没有页面直接调用
- 页面间接入口：
  - 修改下载配置弹窗请求可选清晰度：`src/panes/DownloadPane/components/ModifyProgressDialogContent.vue:74-103`
  - 任意普通视频下载任务创建后，后台准备阶段自动调用
- Tauri 包装：
  - 可选格式查询：`src/bindings.ts:168-176` -> `src-tauri/src/commands.rs:441-477`
- Rust 请求实现：
  - 取播放地址：`src-tauri/src/bili_client.rs:367-405`
  - 下载准备入口：`src-tauri/src/downloader/download_progress.rs:348-368`
  - 可选格式提取：`src-tauri/src/types/normal_media_url.rs:112-156`

请求方式：

- Query：
  - `bvid`
  - `cid`
  - `qn=127`
  - `fnval=4048`
- Header：`Cookie: SESSDATA=<配置值>`

响应处理：

1. HTTP 必须 `200`
2. 解析 `BiliResp`
3. `code == 0`
4. `data` 反序列化为 `NormalMediaUrl`

后续处理：

- `DownloadProgress::prepare` 用它判断是否预览资源：
  - `!media_url.durl.is_empty() && media_url.dash.video.is_empty()`
  - 位置：`src-tauri/src/downloader/download_progress.rs:353-363`
- `VideoTask::prepare_normal` / `AudioTask::prepare_normal` 会从：
  - `dash.video[].base_url`
  - `dash.video[].backup_url`
  - `dash.audio[].base_url`
  - `dash.audio[].backup_url`
  - `dash.dolby.audio`
  - `dash.flac.audio`
  - `durl[].url`
  - `durl[].backup_url`
  中继续探测可用 CDN 和文件长度

相关代码：

- 视频：`src-tauri/src/downloader/tasks/video_task.rs:47-113`
- 音频：`src-tauri/src/downloader/tasks/audio_task.rs:45-128`

---

## 5.10 获取番剧播放地址（优先 v2，DRM 时回退 v1）

- 外部接口 1：`GET https://api.bilibili.com/pgc/player/web/v2/playurl`
- 外部接口 2：`GET https://api.bilibili.com/pgc/player/web/playurl`
- 页面间接入口：
  - 修改下载配置弹窗：`src/panes/DownloadPane/components/ModifyProgressDialogContent.vue:83-103`
  - 任意番剧下载任务准备阶段
- Tauri 包装：
  - `src/bindings.ts:168-176`
  - `src-tauri/src/commands.rs:458-465`
- Rust 请求实现：
  - 调度入口：`src-tauri/src/bili_client.rs:407-415`
  - v1：`src-tauri/src/bili_client.rs:417-457`
  - v2：`src-tauri/src/bili_client.rs:459-500`
  - 下载准备：`src-tauri/src/downloader/download_progress.rs:370-386`
  - 可选格式提取：`src-tauri/src/types/bangumi_media_url.rs:139-176`

请求方式：

- v2 Query：
  - `cid`
  - `qn=127`
  - `fnval=4048`
  - `drm_tech_type=2`
  - `from_client=BROWSER`
- v1 Query：
  - `cid`
  - `qn=127`
  - `fnval=4048`
  - `drm_tech_type=2`
- Header：`Cookie: SESSDATA=<配置值>`

响应处理：

- v2 先解析为 `BangumiMediaUrlV2`
- 如果 `video_info.is_drm == true`，则回退到 v1
- 否则直接使用 `video_info`

特殊错误：

- `code == -10403`：地区限制

后续处理：

- `DownloadProgress::prepare` 将 `media_url.is_preview != 0` 写入 `progress.is_preview`
- `VideoTask::prepare_bangumi` / `AudioTask::prepare_bangumi` 继续从 `dash` / `durls` 中筛选实际 CDN

---

## 5.11 获取课程播放地址

- 外部接口：`GET https://api.bilibili.com/pugv/player/web/playurl`
- 页面间接入口：
  - 修改下载配置弹窗：`src/panes/DownloadPane/components/ModifyProgressDialogContent.vue:85-103`
  - 任意课程下载任务准备阶段
- Tauri 包装：
  - `src/bindings.ts:168-176`
  - `src-tauri/src/commands.rs:466-473`
- Rust 请求实现：
  - `src-tauri/src/bili_client.rs:502-542`
  - 下载准备：`src-tauri/src/downloader/download_progress.rs:388-408`
  - 可选格式提取：`src-tauri/src/types/cheese_media_url.rs:132-169`

请求方式：

- Query：
  - `ep_id`
  - `qn=127`
  - `fnval=4048`
  - `drm_tech_type=2`
- Header：`Cookie: SESSDATA=<配置值>`

响应处理：

1. HTTP 必须 `200`
2. 解析 `BiliResp`
3. `code == -403` 表示无观看权限
4. `code == 0` 时 `data` 反序列化为 `CheeseMediaUrl`

后续处理：

- `DownloadProgress::prepare` 将：
  - `media_url.is_drm` -> `progress.is_drm`
  - `media_url.is_preview != 0` -> `progress.is_preview`

---

## 5.12 获取播放器信息

- 外部接口：`GET https://api.bilibili.com/x/player/wbi/v2`
- 页面直接入口：
  - 无
- 页面间接入口：
  - 用户先创建下载任务
  - 后台在需要字幕或章节信息时懒加载
- Rust 触发位置：
  - `src-tauri/src/extensions.rs:54-72`
- 实际使用位置：
  - 字幕下载：`src-tauri/src/downloader/tasks/subtitle_task.rs:42-70`
  - 嵌入章节信息：`src-tauri/src/downloader/tasks/video_process_task.rs:351-363`
- Rust 请求实现：
  - `src-tauri/src/bili_client.rs:544-580`

请求方式：

- Query：
  - `aid`
  - `cid`
- Header：`Cookie: SESSDATA=<配置值>`

响应处理：

1. HTTP 必须 `200`
2. 解析 `BiliResp`
3. `code == 0`
4. `data` 反序列化为 `PlayerInfo`

使用方式：

- 字幕任务读取 `player_info.subtitle.subtitles`
- 章节任务读取 `player_info.view_points`

---

## 5.13 获取收藏夹列表

- 外部接口：`GET https://api.bilibili.com/x/v3/fav/folder/created/list-all`
- 前端入口：
  - 收藏页初始化：`src/panes/FavPane/FavPane.vue:20-27`
  - 收藏页组件挂载：`src/panes/FavPane/components/FavPanel.vue:39-46`
- 页面响应处理：
  - `src/panes/FavPane/FavPane.vue:20-32`
  - `src/panes/FavPane/components/FavPanel.vue:40-45`
- Tauri 包装：
  - `src/bindings.ts:70-76`
  - `src-tauri/src/commands.rs:189-199`
- Rust 请求实现：
  - `src-tauri/src/bili_client.rs:582-615`

请求方式：

- Query：`up_mid=<uid>`
- Header：`Cookie: SESSDATA=<配置值>`

响应处理：

1. HTTP 必须 `200`
2. `BiliResp.code == 0`
3. `data` -> `FavFolders`

---

## 5.14 获取收藏夹内容

- 外部接口：`GET https://api.bilibili.com/x/v3/fav/resource/list`
- 前端入口：
  - 收藏页初始化：`src/panes/FavPane/FavPane.vue:27-32`
  - 收藏页翻页/切目录：`src/panes/FavPane/components/FavPanel.vue:48-66`
  - 搜索页按收藏夹 ID 搜索：`src/panes/SearchPane/SearchPane.vue:294-324`（走 `commands.search`）
- 页面响应处理：
  - 收藏页：`src/panes/FavPane/FavPane.vue:27-32`
  - 收藏页组件：`src/panes/FavPane/components/FavPanel.vue:60-65`
  - 搜索页：`src/panes/SearchPane/SearchPane.vue:319-324`
- Tauri 包装：
  - `src/bindings.ts:78-84`
  - `src-tauri/src/commands.rs:201-211`
  - 聚合搜索命令：`src-tauri/src/commands.rs:383-389`
- Rust 请求实现：
  - `src-tauri/src/bili_client.rs:617-655`

请求方式：

- Query：
  - `media_id`
  - `pn`
  - `ps=36`
  - `platform=web`
- Header：`Cookie: SESSDATA=<配置值>`

响应处理：

1. HTTP 必须 `200`
2. `BiliResp.code == 0`
3. `data` -> `FavInfo`

---

## 5.15 获取稍后再看列表

- 外部接口：`GET https://api.bilibili.com/x/v2/history/toview`
- 前端入口：
  - 初始化：`src/panes/WatchLaterPane/WatchLaterPane.vue:12-25`
  - 翻页：`src/panes/WatchLaterPane/components/WatchLaterPanel.vue:115-123`
- 页面响应处理：
  - `src/panes/WatchLaterPane/WatchLaterPane.vue:19-24`
  - `src/panes/WatchLaterPane/components/WatchLaterPanel.vue:117-122`
- Tauri 包装：
  - `src/bindings.ts:86-92`
  - `src-tauri/src/commands.rs:213-223`
- Rust 请求实现：
  - `src-tauri/src/bili_client.rs:657-691`

请求方式：

- Query：
  - `ps=20`
  - `pn=<页码>`
- Header：`Cookie: SESSDATA=<配置值>`

响应处理：

1. HTTP 必须 `200`
2. `BiliResp.code == 0`
3. `data` -> `WatchLaterInfo`

---

## 5.16 获取追番/追剧列表

- 外部接口：`GET https://api.bilibili.com/x/space/bangumi/follow/list`
- 前端入口：
  - 初始化：`src/panes/BangumiFollow/BangumiFollowPane.vue:12-30`
  - 翻页和筛选：`src/panes/BangumiFollow/components/BangumiFollowPanel.vue:108-126`
- 页面响应处理：
  - `src/panes/BangumiFollow/BangumiFollowPane.vue:20-30`
  - `src/panes/BangumiFollow/components/BangumiFollowPanel.vue:115-125`
- Tauri 包装：
  - `src/bindings.ts:94-100`
  - `src-tauri/src/commands.rs:225-238`
- Rust 请求实现：
  - `src-tauri/src/bili_client.rs:693-736`

请求方式：

- Query：
  - `vmid`
  - `type`
  - `pn`
  - `ps=24`
  - `follow_status`
- Header：`Cookie: SESSDATA=<配置值>`

响应处理：

1. HTTP 必须 `200`
2. `BiliResp.code == 0`
3. `data` -> `BangumiFollowInfo`

---

## 5.17 获取历史记录

- 外部接口：`GET https://api.bilibili.com/x/web-interface/history/search`
- 前端入口：
  - 初始化：`src/panes/HistoryPane/HistoryPane.vue:20-34`
  - 搜索/筛选/翻页：`src/panes/HistoryPane/components/HistoryPanel.vue:47-118,212-221`
- 页面响应处理：
  - `src/panes/HistoryPane/HistoryPane.vue:20-34`
  - `src/panes/HistoryPane/components/HistoryPanel.vue:102-117`
- Tauri 包装：
  - `src/bindings.ts:102-108`
  - `src-tauri/src/commands.rs:240-253`
- Rust 请求实现：
  - `src-tauri/src/bili_client.rs:738-784`

请求方式：

- Query：
  - `pn`
  - `keyword`
  - `business=archive`
  - `add_time_start`
  - `add_time_end`
  - `arc_max_duration`
  - `arc_min_duration`
  - `device_type`
- Header：`Cookie: SESSDATA=<配置值>`

页面侧参数来源：

- 时长筛选：`src/panes/HistoryPane/components/HistoryPanel.vue:47-66`
- 时间筛选：`src/panes/HistoryPane/components/HistoryPanel.vue:68-94,212-221`
- 设备筛选：`src/panes/HistoryPane/components/HistoryPanel.vue:96`

响应处理：

1. HTTP 必须 `200`
2. `BiliResp.code == 0`
3. `data` -> `HistoryInfo`

---

## 5.18 获取视频标签

- 外部接口：`GET https://api.bilibili.com/x/web-interface/view/detail/tag`
- 页面直接入口：
  - 无
- 页面间接入口：
  - 下载任务勾选 `NFO` 时，普通视频导出 NFO 会触发
- Rust 触发位置：
  - `src-tauri/src/downloader/tasks/nfo_task.rs:89-99`
- Rust 请求实现：
  - `src-tauri/src/bili_client.rs:1003-1037`

请求方式：

- Query：`aid`
- Header：`Cookie: SESSDATA=<配置值>`

响应处理：

1. HTTP 必须 `200`
2. `BiliResp.code == 0`
3. `data` -> `Tags`
4. 再传给 `info.to_movie_nfo(tags)`

NFO 写入位置：

- `src-tauri/src/downloader/tasks/nfo_task.rs:95-99`

---

## 5.19 获取跳过片段（SponsorBlock 风格）

- 外部接口：`GET https://bsbsb.top/api/skipSegments`
- 页面直接入口：
  - 无
- 页面间接入口：
  - 下载任务勾选“标记广告”时，视频后处理阶段会触发
- Tauri 也暴露了命令，但当前前端页面没有直接调用：
  - `src/bindings.ts:160-166`
  - `src-tauri/src/commands.rs:425-439`
- 真正后台触发位置：
  - `src-tauri/src/downloader/tasks/video_process_task.rs:365-375`
- Rust 请求实现：
  - `src-tauri/src/bili_client.rs:1039-1073`

请求方式：

- Query 固定有：
  - `videoID=<bvid>`
  - `actionType=skip`
- 可选：
  - `cid=<cid>`

响应处理：

- HTTP `404`：直接当成空数组返回
- HTTP `200`：直接把响应体解析成 `SkipSegments`
- 不是 B 站标准 `BiliResp` 包装

后续处理：

- `video_process_task` 中把 `SkipSegments` 转成 `ChapterSegment`
- 再与播放器章节合并，生成 `FFMETA.ini`
- 代码位置：`src-tauri/src/downloader/tasks/video_process_task.rs:365-387`

---

## 5.20 获取弹幕分段 protobuf

- 外部接口：`GET https://api.bilibili.com/x/v2/dm/web/seg.so`
- 页面直接入口：
  - 无
- 页面间接入口：
  - 下载任务勾选 XML / ASS / JSON 弹幕时触发
- Rust 触发位置：
  - `src-tauri/src/downloader/tasks/danmaku_task.rs:66-97`
- Rust 请求实现：
  - `src-tauri/src/bili_client.rs:898-954`

请求方式：

- 按视频时长分段并发请求
- 分段数：`duration.div_ceil(360)`，即每 6 分钟一段
- Query：
  - `type=1`
  - `oid=<cid>`
  - `pid=<aid>`
  - `segment_index=<1..N>`
- Header：`Cookie: SESSDATA=<配置值>`

响应处理：

1. 每段 HTTP 必须 `200`
2. 以 `bytes()` 读取 body
3. 用 `prost` 反序列化为 `DmSegMobileReply`
4. 收集所有分段结果

后续处理：

- `replies.to_xml(progress.cid)` 生成 XML
- `xml_to_ass(...)` 生成 ASS
- `serde_json::to_string(&replies)` 生成 JSON

代码位置：

- `src-tauri/src/downloader/tasks/danmaku_task.rs:72-93`

---

## 5.21 获取字幕 JSON

- 外部接口：字幕 URL 为**动态地址**，不是固定 API
- URL 来源：
  - `player_info.subtitle.subtitles[*].subtitle_url`
- 页面直接入口：
  - 无
- 页面间接入口：
  - 下载任务勾选字幕时触发
- Rust URL 组装位置：
  - `src-tauri/src/downloader/tasks/subtitle_task.rs:48-53`
- Rust 请求实现：
  - `src-tauri/src/bili_client.rs:956-970`

请求方式：

- 先通过 `x/player/wbi/v2` 获取 `PlayerInfo`
- 再遍历字幕列表
- 项目把返回的 `//i0.hdslb.com/...` 拼成：
  - `http:<subtitle_url>`

响应处理：

1. HTTP 必须 `200`
2. 直接 JSON 反序列化为 `Subtitle`
3. 遍历 `subtitle.body`
4. 转成 `.srt` 文本写文件

文件生成位置：

- `src-tauri/src/downloader/tasks/subtitle_task.rs:55-69`

---

## 5.22 获取封面图片 / fanart / poster

- 外部接口：封面 URL 为**动态地址**，不是固定 API
- URL 来源：
  - 下载主封面：`progress.cover_task.url`
  - 普通视频合集封面：`ugc_season.cover`
  - 番剧封面：`info.cover`
  - 番剧背景图：`info.bkg_cover`
  - 课程封面：`info.cover`
- 页面直接入口：
  - 无
- 页面间接入口：
  - 勾选封面下载或 NFO 下载时触发
- Rust 请求实现：
  - 通用下载函数：`src-tauri/src/bili_client.rs:972-1001`
- 使用位置：
  - 封面任务：`src-tauri/src/downloader/tasks/cover_task.rs:30-50`
  - 普通视频 NFO：`src-tauri/src/downloader/tasks/nfo_task.rs:101-112`
  - 番剧 NFO：`src-tauri/src/downloader/tasks/nfo_task.rs:158-176`
  - 课程 NFO：`src-tauri/src/downloader/tasks/nfo_task.rs:221-230`

请求方式：

- 直接 `GET <动态图片 URL>`

响应处理：

1. HTTP 必须 `200`
2. 读取 `Content-Type`
3. 根据类型推断扩展名：
  - `image/png` -> `png`
  - `image/webp` -> `webp`
  - `image/avif` -> `avif`
  - 其他 -> `jpg`
4. 读取字节写入本地文件

---

## 5.23 探测媒体长度（HEAD / Range 0-0）

- 外部接口：**动态媒体 CDN URL**
- URL 来源：
  - 普通视频 `NormalMediaUrl`
  - 番剧 `BangumiMediaUrl`
  - 课程 `CheeseMediaUrl`
  中的 `dash.*.base_url / backup_url`、`durl.url / backup_url`
- 页面直接入口：
  - 无
- 页面间接入口：
  - 修改下载配置弹窗获取可选清晰度时会先取播放信息，但不会做长度探测
  - 真正长度探测只发生在后台下载准备阶段
- Rust 请求实现：
  - `src-tauri/src/bili_client.rs:810-896`
- 使用位置：
  - 视频准备：`src-tauri/src/downloader/tasks/video_task.rs:63-109,135-183,210-258`
  - 音频准备：`src-tauri/src/downloader/tasks/audio_task.rs:57-127,159-183,215-239`

请求方式：

第一步优先：

- `HEAD <media_url>`

如果 `HEAD` 失败或没有 `Content-Length`：

- `GET <media_url>`
- Header：`Range: bytes=0-0`

响应处理：

- 如果 `HEAD 200` 且有 `Content-Length`，直接取
- 如果 `GET 206`，从 `Content-Range: bytes 0-0/12345` 解析总长度
- 如果 `GET 200`，退回读 `Content-Length`

后续处理：

- 选出可用 URL 后会构造 2MB 分片表
- 代码位置：
  - 视频：`src-tauri/src/downloader/tasks/video_task.rs:294-320`
  - 音频：`src-tauri/src/downloader/tasks/audio_task.rs:264-290`

URL 选择偏好：

- 优先 `https://upos-` 开头的地址
- 否则取探测成功列表第一个

代码位置：

- 视频：`src-tauri/src/downloader/tasks/video_task.rs:294-299`
- 音频：`src-tauri/src/downloader/tasks/audio_task.rs:264-269`

---

## 5.24 下载媒体分片

- 外部接口：**动态媒体 CDN URL**
- 页面直接入口：
  - 无
- 页面间接入口：
  - 所有视频/音频下载任务
- Rust 请求实现：
  - `src-tauri/src/bili_client.rs:786-808`
- 调用位置：
  - `src-tauri/src/downloader/download_chunk_task.rs:80-109`
  - 视频分片调度：`src-tauri/src/downloader/tasks/video_task.rs:381-461`
  - 音频分片调度：`src-tauri/src/downloader/tasks/audio_task.rs:349-429`

请求方式：

- `GET <media_url>`
- Header：`Range: bytes=<start>-<end>`

响应处理：

- 状态码必须是 `206 Partial Content`
- 读取 `bytes()` 后写入预分配的临时文件对应偏移

并发控制：

- 分片并发信号量：`DownloadManager.media_chunk_sem`
- 代码位置：`src-tauri/src/downloader/download_chunk_task.rs:111-130`

下载速度统计：

- 每次分片完成把长度累计到 `byte_per_sec`
- `DownloadPane.vue` 监听 `download-event` 中的 `Speed`

---

## 6. 聚合命令与响应分发

虽然下面几个不是新的外部接口，但它们是页面最常用的“统一入口”，模仿实现时很重要。

### 6.1 `commands.search`

- 前端调用位置：
  - `src/panes/SearchPane/SearchPane.vue:148,181,217,253,286,319`
- Tauri 聚合逻辑：
  - `src-tauri/src/commands.rs:325-391`

它会根据 `SearchParams` 分发到：

- `Normal` -> `get_normal_info`
- `Bangumi` -> `get_bangumi_info`
- `Cheese` -> `get_cheese_info`
- `UserVideo` -> `get_user_video_info`
- `Fav` -> `get_fav_info`

额外加工：

- 番剧按 `ep_id` 搜索时，会在 season 结果里定位命中的单集
- 课程按 `ep_id` 搜索时，会在 episodes 里定位命中的单集

### 6.2 `commands.getAvailableMediaFormats`

- 前端调用位置：
  - `src/panes/DownloadPane/components/ModifyProgressDialogContent.vue:74-103`
- Tauri 聚合逻辑：
  - `src-tauri/src/commands.rs:441-477`

它不会访问新接口，而是复用：

- 普通视频：`get_normal_url`
- 番剧：`get_bangumi_url`
- 课程：`get_cheese_url`

然后把响应里的可用格式抽成统一结构：

- 普通视频：`src-tauri/src/types/normal_media_url.rs:112-156`
- 番剧：`src-tauri/src/types/bangumi_media_url.rs:139-176`
- 课程：`src-tauri/src/types/cheese_media_url.rs:132-169`

### 6.3 `EpisodeInfo::get_or_init`

- 代码位置：
  - `src-tauri/src/downloader/episode_info.rs:22-71`

作用：

- 下载任务在导出 `NFO` / `JSON` 时，如果内存里没有详情对象，会再次联网拉取：
  - 普通视频详情
  - 番剧详情
  - 课程详情

这意味着：

- **同一个下载任务可能在搜索阶段拿过一次详情，下载导出元数据时又拿一次**

---

## 7. 下载链路中的实际联网顺序

以“页面点下载一个普通视频”为例，真实联网顺序通常是：

1. 页面可能先通过 `getNormalInfo` 获得详情
2. 页面调用 `createDownloadTasks`
3. 后台 `DownloadProgress::prepare` 调用 `x/player/wbi/playurl`
4. `VideoTask` / `AudioTask` 并发探测多个 CDN 的长度
5. 选中最佳 URL 后，用多个 `Range` 分片并发下载媒体
6. 如果勾选弹幕，调用 `x/v2/dm/web/seg.so`
7. 如果勾选字幕，先调 `x/player/wbi/v2`，再调动态字幕 URL
8. 如果勾选封面，调动态封面 URL
9. 如果勾选 NFO，普通视频会额外调标签接口；番剧/课程会额外拉 poster/fanart
10. 如果勾选“标记广告”，调 `bsbsb.top/api/skipSegments`

关键实现位置：

- 下载准备：`src-tauri/src/downloader/download_progress.rs:332-415`
- 视频：`src-tauri/src/downloader/tasks/video_task.rs`
- 音频：`src-tauri/src/downloader/tasks/audio_task.rs`
- 弹幕：`src-tauri/src/downloader/tasks/danmaku_task.rs`
- 字幕：`src-tauri/src/downloader/tasks/subtitle_task.rs`
- 封面：`src-tauri/src/downloader/tasks/cover_task.rs`
- NFO：`src-tauri/src/downloader/tasks/nfo_task.rs`
- 后处理：`src-tauri/src/downloader/tasks/video_process_task.rs`

---

## 8. 全部外部联网点清单

固定 API：

1. `https://passport.bilibili.com/x/passport-login/web/qrcode/generate`
2. `https://passport.bilibili.com/x/passport-login/web/qrcode/poll`
3. `https://api.bilibili.com/x/web-interface/nav`
4. `https://api.bilibili.com/x/web-interface/view`
5. `https://api.bilibili.com/pgc/view/web/season`
6. `https://api.bilibili.com/pugv/view/web/season`
7. `https://api.bilibili.com/x/space/wbi/arc/search`
8. `https://api.bilibili.com/x/player/wbi/playurl`
9. `https://api.bilibili.com/pgc/player/web/playurl`
10. `https://api.bilibili.com/pgc/player/web/v2/playurl`
11. `https://api.bilibili.com/pugv/player/web/playurl`
12. `https://api.bilibili.com/x/player/wbi/v2`
13. `https://api.bilibili.com/x/v3/fav/folder/created/list-all`
14. `https://api.bilibili.com/x/v3/fav/resource/list`
15. `https://api.bilibili.com/x/v2/history/toview`
16. `https://api.bilibili.com/x/space/bangumi/follow/list`
17. `https://api.bilibili.com/x/web-interface/history/search`
18. `https://api.bilibili.com/x/web-interface/view/detail/tag`
19. `https://api.bilibili.com/x/v2/dm/web/seg.so`
20. `https://bsbsb.top/api/skipSegments`

动态 URL：

21. 播放地址响应里的 `base_url` / `backup_url` / `durl.url`
22. 字幕详情里的 `subtitle_url`
23. 视频 / 番剧 / 课程详情里的封面地址

---

## 9. 复刻实现时最容易漏掉的细节

1. 前端没有直接外网请求，真正的外网协议细节都在 Rust 里。
2. 很多接口都要求 `Referer + User-Agent`，并且多数需要 `SESSDATA`。
3. `UP 投稿列表`必须补 `WBI` 签名，不能只传 `mid/pn`。
4. 播放地址接口返回的是“候选 URL 列表”，项目不会直接用第一个，而是会继续探测每个候选 URL 的实际可用性和文件长度。
5. 媒体下载不是整文件直下，而是：
   - 先 `HEAD` / `Range 0-0` 探测长度
   - 再 2MB 分片并发 `Range` 下载
6. 字幕、封面很多时候不是固定接口，而是“先拿详情，再取详情里的动态 URL”。
7. 下载 `NFO` / `JSON` 时，后台可能会再次拉详情，不一定复用搜索结果。
8. `skipSegments` 不是 B 站官方接口，而且 404 会被当成“没有跳过片段”处理。

# bilibili-video-downloader 非联网 API 梳理

## 1. 说明

这一节整理**前端可调用、但不会访问外网**的本地 API / 本地能力，便于后续模仿项目整体交互方式。

这部分主要包括：

1. 配置读取与保存
2. 下载任务管理
3. 下载事件分发
4. 日志与文件管理器能力
5. 插件管理

---

## 2. 非联网调用总架构

和联网部分一样，前端仍然统一通过：

`Vue 页面` -> `src/bindings.ts` -> `src-tauri/src/commands.rs` -> 本地状态 / 本地文件 / 本地任务管理器

关键位置：

- 前端命令封装：`src/bindings.ts:5-210`
- Tauri 命令实现：`src-tauri/src/commands.rs:51-578`

---

## 3. 配置相关

## 3.1 获取配置

- 前端入口：
  - `src/dialogs/SettingsDialog/SettingsDialog.vue:21`
- 前端处理：
  - `store.config = await commands.getConfig()`
- Tauri 包装：
  - `src/bindings.ts:7-11`
- Rust 实现：
  - `src-tauri/src/commands.rs:51-58`

行为：

- 从 `RwLock<Config>` 中直接克隆当前配置返回
- 不访问外网

## 3.2 保存配置

- 前端入口：
  - `src/dialogs/SettingsDialog/SettingsDialog.vue:31-36`
- Tauri 包装：
  - `src/bindings.ts:12-18`
- Rust 实现：
  - `src-tauri/src/commands.rs:60-104`

行为：

1. 用新配置覆盖当前内存配置
2. 调用 `config.save(&app)` 落盘
3. 如果代理配置变化，调用 `bili_client.reload_client()`
4. 如果文件日志开关变化，重载或关闭文件日志

相关本地副作用：

- 代理变化会影响后续联网客户端，但保存动作本身不发网

---

## 4. 下载任务管理

## 4.1 创建下载任务

- 典型前端入口：
  - `src/panes/SearchPane/components/NormalSinglePanel.vue:10-17`
  - `src/panes/SearchPane/components/NormalSeasonPanel.vue:55-63,128-137`
  - `src/panes/SearchPane/components/BangumiPanel.vue:172-183`
  - `src/panes/SearchPane/components/CheesePanel.vue:58,124-129`
  - `src/panes/SearchPane/components/UserVideoPanel.vue:102`
  - `src/panes/SearchPane/components/PartsDialogContent.vue:19`
- Tauri 包装：
  - `src/bindings.ts:110-112`
- Rust 实现：
  - `src-tauri/src/commands.rs:255-262`
  - `src-tauri/src/downloader/download_manager.rs:98-104`

行为：

- 不直接联网
- 只是在本地创建 `DownloadTask`
- 后续任务运行时才会进入联网下载阶段

任务参数结构：

- `src-tauri/src/types/create_download_task_params.rs:6-32`

## 4.2 暂停下载任务

- 前端入口：
  - `src/panes/DownloadPane/components/DownloadProgress.vue:51-54`
  - `src/panes/DownloadPane/components/UncompletedProgresses.vue`
- Tauri 包装：
  - `src/bindings.ts:113-115`
- Rust 实现：
  - `src-tauri/src/commands.rs:264-271`
  - `src-tauri/src/downloader/download_manager.rs:106-123`

行为：

- 将任务状态改为 `Paused`
- 不发网

## 4.3 继续下载任务

- 前端入口：
  - `src/panes/DownloadPane/components/DownloadProgress.vue:52-54`
  - `src/panes/DownloadPane/components/UncompletedProgresses.vue`
- Tauri 包装：
  - `src/bindings.ts:116-118`
- Rust 实现：
  - `src-tauri/src/commands.rs:273-280`
  - `src-tauri/src/downloader/download_manager.rs:125-142`

行为：

- 将任务状态改为 `Pending`
- 不发网

## 4.4 删除下载任务

- 前端入口：
  - `src/panes/DownloadPane/components/CompletedProgresses.vue:127`
  - `src/panes/DownloadPane/components/UncompletedProgresses.vue:185`
- Tauri 包装：
  - `src/bindings.ts:119-121`
- Rust 实现：
  - `src-tauri/src/commands.rs:282-289`
  - `src-tauri/src/downloader/download_manager.rs:144-180`

行为：

1. 从内存任务表删除任务
2. 删除对应进度文件 `<task_id>.json`
3. 发送删除信号给任务

## 4.5 重启下载任务（按原配置）

- 前端入口：
  - `src/panes/DownloadPane/components/CompletedProgresses.vue:112`
  - `src/panes/DownloadPane/components/UncompletedProgresses.vue:170`
- Tauri 包装：
  - `src/bindings.ts:122-124`
- Rust 实现：
  - `src-tauri/src/commands.rs:291-298`
  - `src-tauri/src/downloader/download_manager.rs:182-207`

行为：

- 向任务发送 `restart_sender`
- 不直接发网

## 4.6 重启下载任务（按新配置）

- 前端入口：
  - `src/panes/DownloadPane/components/ModifyProgressDialogContent.vue:105-128`
- Tauri 包装：
  - `src/bindings.ts:125-127`
- Rust 实现：
  - `src-tauri/src/commands.rs:300-307`
  - `src-tauri/src/downloader/download_manager.rs:209-253`

行为：

1. 先修改进度对象里各子任务勾选状态和音视频格式选择
2. 再发送重启信号

参数结构：

- `src-tauri/src/types/restart_download_task_params.rs:8-30`

## 4.7 恢复历史下载任务

- 前端入口：
  - `src/panes/DownloadPane/DownloadPane.vue:151-154`
- Tauri 包装：
  - `src/bindings.ts:128-134`
- Rust 实现：
  - `src-tauri/src/commands.rs:309-320`
  - `src-tauri/src/downloader/download_manager.rs:63-96`

行为：

1. 遍历应用数据目录下的 `.下载任务`
2. 只保留 `.json` 进度文件
3. 反序列化为 `DownloadProgress`
4. 重建本地任务对象

这一步只读本地文件，不访问外网。

---

## 5. 下载事件

前端下载列表并不是主动轮询，而是监听 Tauri 事件。

## 5.1 事件定义

- `src/bindings.ts:222-228`

事件名：

- `download-event`
- `log-event`
- `plugin-event`

## 5.2 下载页事件处理

- 前端处理：
  - `src/panes/DownloadPane/DownloadPane.vue:25-149`

主要事件：

1. `Speed`
2. `TaskCreate`
3. `TaskStateUpdate`
4. `TaskSleeping`
5. `TaskDelete`
6. `ProgressPreparing`
7. `ProgressUpdate`

行为：

- 更新 `store.downloadSpeed`
- 更新任务进度表
- 推导当前 UI 的状态文字、百分比和任务指示语

这部分是本地事件流，不是联网接口。

---

## 6. 文件与日志相关

## 6.1 获取日志目录大小

- 前端入口：
  - `src/dialogs/LogDialog.vue:123,157`
- Tauri 包装：
  - `src/bindings.ts:144-150`
- Rust 实现：
  - `src-tauri/src/commands.rs:394-411`

行为：

- 枚举本地日志目录下文件
- 累加文件大小

## 6.2 打开日志文件

- 前端入口：
  - `src/dialogs/LogDialog.vue:270-276`
- Tauri 包装：
  - `src/bindings.ts:176-182`
- Rust 实现：
  - `src-tauri/src/commands.rs:479-510`

行为：

1. 逐行读取日志文件
2. 逐行反序列化为 `LogMetadata`
3. 返回给前端做展示

## 6.3 在文件管理器中定位路径

- 前端入口：
  - `src/dialogs/SettingsDialog/SettingsDialog.vue:46-49`
  - `src/dialogs/LogDialog.vue:252-255`
  - `src/dialogs/SettingsDialog/components/PluginSettings.vue:167-170`
  - `src/panes/DownloadPane/components/DownloadDirInput.vue:15-18`
  - `src/panes/DownloadPane/components/DownloadProgress.vue:98-110`
- Tauri 包装：
  - `src/bindings.ts:152-158`
- Rust 实现：
  - `src-tauri/src/commands.rs:413-423`

行为：

- 调用 `app.opener().reveal_item_in_dir(path)`
- 这是本地桌面能力，不发网

---

## 7. 插件管理

## 7.1 获取插件列表

- 前端入口：
  - `src/dialogs/SettingsDialog/components/PluginSettings.vue:24`
- Tauri 包装：
  - `src/bindings.ts:19-21`
- Rust 实现：
  - `src-tauri/src/commands.rs:512-518`

行为：

- 从本地 `PluginManager` 取插件信息

## 7.2 添加插件

- 前端入口：
  - `src/dialogs/SettingsDialog/components/PluginSettings.vue:129-137`
- Tauri 包装：
  - `src/bindings.ts:184-190`
- Rust 实现：
  - `src-tauri/src/commands.rs:520-532`

行为：

- 调本地 `plugin_manager.add_plugin(&plugin_path)`

## 7.3 卸载插件

- 前端入口：
  - `src/dialogs/SettingsDialog/components/PluginSettings.vue:196-203`
- Tauri 包装：
  - `src/bindings.ts:192-198`
- Rust 实现：
  - `src-tauri/src/commands.rs:534-546`

## 7.4 启用/禁用插件

- 前端入口：
  - `src/dialogs/SettingsDialog/components/PluginSettings.vue:216-217`
- Tauri 包装：
  - `src/bindings.ts:200-206`
- Rust 实现：
  - `src-tauri/src/commands.rs:548-560`

## 7.5 调整插件优先级

- 前端入口：
  - `src/dialogs/SettingsDialog/components/PluginSettings.vue:235-236`
- Tauri 包装：
  - `src/bindings.ts:208-214`
- Rust 实现：
  - `src-tauri/src/commands.rs:562-578`

以上插件操作都属于本地文件与本地运行时管理，不访问外网。

---

## 8. 与联网能力相邻、但本身不联网的内部处理

这些点经常和联网逻辑混在一起，但本身属于本地处理：

1. 下载文件名和目录格式化
   - `src-tauri/src/downloader/download_progress.rs:418-453`
2. 下载进度保存/恢复
   - `src-tauri/src/downloader/download_progress.rs:455-472`
   - `src-tauri/src/downloader/download_manager.rs:63-96`
3. 弹幕 XML 转 ASS
   - `src-tauri/src/downloader/tasks/danmaku_task.rs:81-87`
4. 字幕 JSON 转 SRT
   - `src-tauri/src/downloader/tasks/subtitle_task.rs:55-69`
5. 视频/音频分片写入临时文件、校验完整性、重命名
   - `src-tauri/src/downloader/tasks/video_task.rs:337-461`
   - `src-tauri/src/downloader/tasks/audio_task.rs:305-429`
6. 章节与广告片段合并后生成 `FFMETA.ini`
   - `src-tauri/src/downloader/tasks/video_process_task.rs:340-387`
7. 导出 `NFO` / `JSON`
   - `src-tauri/src/downloader/tasks/nfo_task.rs`
   - `src-tauri/src/downloader/tasks/json_task.rs:30-60`

---

## 9. 非联网能力总表

前端可直接调用的非联网命令：

1. `getConfig`
2. `saveConfig`
3. `createDownloadTasks`
4. `pauseDownloadTasks`
5. `resumeDownloadTasks`
6. `deleteDownloadTasks`
7. `restartDownloadTasks`
8. `restartDownloadTask`
9. `restoreDownloadTasks`
10. `getLogsDirSize`
11. `showPathInFileManager`
12. `openLogFile`
13. `getPluginInfos`
14. `addPlugin`
15. `uninstallPlugin`
16. `setPluginEnabled`
17. `setPluginPriority`

事件型本地能力：

18. `download-event`
19. `log-event`
20. `plugin-event`
