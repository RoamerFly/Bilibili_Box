# BiliBox 项目功能实现文档

> Bilibili 媒体工作站 - 全量业务逻辑分析

---

# 1. 项目总体架构

## 1.1 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 桌面框架 | Tauri | 2.x |
| 后端语言 | Rust | - |
| 前端框架 | React | 19 |
| 构建工具 | Vite | 6 |
| 样式框架 | Tailwind CSS | 4 |
| 状态管理 | Zustand | 5 |
| 动画库 | Framer Motion | 12 |
| UI组件 | Radix UI | - |
| HTTP客户端 | reqwest | - |

## 1.2 架构模式

```
┌─────────────────────────────────────────────────────────────┐
│                      前端 (React)                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Views     │  │  Components │  │   Stores    │         │
│  │  (9个页面)   │  │  (布局组件)  │  │  (Zustand)  │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                          │                                  │
│                    ┌─────┴─────┐                            │
│                    │ Tauri IPC │                            │
│                    │  invoke() │                            │
│                    └─────┬─────┘                            │
└──────────────────────────┼──────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────┐
│                    Tauri Commands                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ commands.rs (30+ 命令)                               │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│  ┌─────────────┐  ┌─────┴─────┐  ┌─────────────┐          │
│  │  BiliClient │  │DownloadMgr│  │PluginManager│          │
│  │  (API封装)   │  │ (下载管理) │  │  (插件系统)  │          │
│  └─────────────┘  └───────────┘  └─────────────┘          │
│                    后端 (Rust)                              │
└─────────────────────────────────────────────────────────────┘
```

## 1.3 目录结构

```
bilibili-box/
├── frontend/                    # 前端项目
│   ├── src/
│   │   ├── views/              # 页面视图 (9个)
│   │   ├── components/         # 组件
│   │   │   └── layout/         # 布局组件
│   │   ├── stores/             # Zustand状态管理
│   │   ├── lib/                # 工具库
│   │   │   ├── api.ts          # IPC封装
│   │   │   ├── types.ts        # 类型定义
│   │   │   └── utils.ts        # 工具函数
│   │   ├── hooks/              # 自定义Hooks
│   │   ├── App.tsx             # 根组件
│   │   └── main.tsx            # 入口文件
│   └── package.json
├── src-tauri/                   # Tauri后端
│   ├── src/
│   │   ├── api/                # Bilibili API封装
│   │   ├── download/           # 下载系统
│   │   ├── danmaku/            # 弹幕处理
│   │   ├── plugin/             # 插件系统
│   │   ├── commands.rs         # Tauri命令定义
│   │   ├── config/             # 配置管理
│   │   ├── lib.rs              # 应用入口
│   │   └── main.rs             # 程序入口
│   └── Cargo.toml
└── package.json
```

---

# 2. 路由分析

## 2.1 路由架构

本项目采用**状态驱动视图切换**模式，不使用传统URL路由。

### 核心配置

**状态管理**: `frontend/src/stores/app-store.ts`

```typescript
// 视图类型定义
export type ViewType =
  | "home"          // 首页
  | "recommend"     // 推荐视频
  | "search"        // 搜索视频
  | "favorites"     // 我的收藏
  | "watchlater"    // 稍后再看
  | "history"       // 观看历史
  | "bangumi"       // 追番追剧
  | "downloads"     // 下载队列
  | "settings";     // 设置

// 当前视图状态
currentView: ViewType;
setView: (view: ViewType) => void;
```

**视图渲染**: `frontend/src/components/layout/app-shell.tsx`

```typescript
function renderView(view: ViewType) {
  switch (view) {
    case "home":      return <HomeView />;
    case "recommend": return <RecommendView />;
    case "search":    return <SearchView />;
    // ... 其他视图
  }
}
```

## 2.2 路由映射表

| ViewType | 组件名称 | 文件路径 | 页面功能 |
|----------|----------|----------|----------|
| home | HomeView | views/home/home-view.tsx | 首页仪表板 |
| recommend | RecommendView | views/recommend/recommend-view.tsx | 热门推荐 |
| search | SearchView | views/search/search-view.tsx | 视频搜索 |
| favorites | FavoritesView | views/favorites/favorites-view.tsx | 收藏夹管理 |
| watchlater | WatchLaterView | views/watchlater/watchlater-view.tsx | 稍后再看 |
| history | HistoryView | views/history/history-view.tsx | 观看历史 |
| bangumi | BangumiView | views/bangumi/bangumi-view.tsx | 追番追剧 |
| downloads | DownloadsView | views/downloads/downloads-view.tsx | 下载管理 |
| settings | SettingsView | views/settings/settings-view.tsx | 应用设置 |

## 2.3 导航配置

**侧边栏导航**: `frontend/src/components/layout/sidebar.tsx`

```typescript
const navItems: NavItem[] = [
  { id: "home",       label: "首页",     icon: Home },
  { id: "recommend",  label: "推荐视频", icon: Compass },
  { id: "search",     label: "搜索视频", icon: Search },
  { id: "favorites",  label: "我的收藏", icon: Star },
  { id: "watchlater", label: "稍后再看", icon: Clock },
  { id: "history",    label: "观看历史", icon: History },
  { id: "bangumi",    label: "追番追剧", icon: Tv },
  { id: "downloads",  label: "下载队列", icon: Download },
  { id: "settings",   label: "设置",     icon: Settings },
];
```

---

# 3. 页面功能分析

## 3.1 首页 (HomeView)

**文件**: `frontend/src/views/home/home-view.tsx`

### UI 功能

| 组件 | 类型 | 功能 | 触发逻辑 |
|------|------|------|----------|
| Hero Banner | 展示区 | 显示欢迎信息和Logo | 无交互 |
| 统计卡片 (4个) | 数据卡片 | 显示今日下载/收藏夹/稍后再看/观看历史数量 | 自动加载 |
| 快速操作-搜索视频 | 按钮 | 跳转到搜索页面 | `setView("search")` |
| 快速操作-我的收藏 | 按钮 | 跳转到收藏页面 | `setView("favorites")` |

### API 调用

| 接口 | 命令 | 参数 | 返回 | 调用时机 |
|------|------|------|------|----------|
| 获取下载统计 | `get_download_task_count` | 无 | `{total, active}` | 页面加载/30秒刷新 |
| 获取配置 | `get_config` | 无 | Config | 检查登录状态 |
| 获取用户信息 | `get_user_info` | `{sessdata}` | UserInfo | 已登录时 |
| 获取收藏夹 | `get_fav_folders` | `{uid}` | FavFolders | 已登录时 |
| 获取稍后再看 | `get_watch_later_info` | 无 | WatchLaterInfo | 已登录时 |
| 获取历史记录 | `get_history_info` | `{view_at}` | HistoryInfo | 已登录时 |

### 状态变化

```
页面加载
  ↓
fetchStats()
  ↓
检查登录状态 (get_config → get_user_info)
  ↓
已登录 → 并行获取 [收藏夹, 稍后再看, 历史记录]
  ↓
更新 stats 状态 → UI 渲染
```

---

## 3.2 搜索视频 (SearchView)

**文件**: `frontend/src/views/search/search-view.tsx`

### UI 功能

| 组件 | 类型 | 功能 | 触发逻辑 |
|------|------|------|----------|
| 搜索模式切换 | Tab按钮 | 切换普通视频/番剧搜索 | `setSearchMode()` |
| 搜索输入框 | 输入框 | 输入BV号/链接 | `setSearchInput()` |
| 搜索按钮 | 按钮 | 执行搜索 | `handleSearch()` |
| 视频结果卡片 | 展示区 | 显示视频信息 | - |
| 分P列表 | 列表 | 显示分P信息 | - |
| 下载按钮 | 按钮 | 创建下载任务 | `handleDownload()` |
| 视频信息面板 | 侧边栏 | 显示详细信息 | - |
| BV号复制 | 按钮 | 复制BV号到剪贴板 | `handleCopyBvid()` |

### API 调用

| 接口 | 命令 | 参数 | 返回 | 调用时机 |
|------|------|------|------|----------|
| 搜索视频 | `search_video` | `{input}` | SearchResult | 点击搜索/回车 |
| 创建下载任务 | `create_download_task` | `{params}` | string[] | 点击下载 |

### 状态变化

```
用户输入 BV号/链接
  ↓
点击搜索 / 按Enter
  ↓
setLoading(true), setError(""), setResult(null)
  ↓
search_video(input)
  ↓
成功 → setResult(data)
失败 → setError(errorMessage)
  ↓
用户点击下载
  ↓
create_download_task({bvid, cid, title, cids})
  ↓
成功 → setView("downloads") 跳转到下载队列
```

### SearchResult 类型

```typescript
type SearchResult =
  | { type: "Normal"; data: VideoInfo }      // 普通视频
  | { type: "Bangumi"; data: BangumiSearchResult }; // 番剧

interface VideoInfo {
  aid: number;
  bvid: string;
  cid: number;
  title: string;
  duration: number;
  pic: string;
  owner: { mid, name, face };
  stat: { view, danmaku, reply, favorite, coin, share, like };
  pages: Array<{ cid, page, part, duration }>;
}
```

---

## 3.3 推荐视频 (RecommendView)

**文件**: `frontend/src/views/recommend/recommend-view.tsx`

### UI 功能

| 组件 | 类型 | 功能 | 触发逻辑 |
|------|------|------|----------|
| 页面标题 | 展示区 | 显示"推荐视频" | - |
| 刷新按钮 | 按钮 | 刷新视频列表 | `handleRefresh()` |
| 搜索框 | 输入框 | 本地搜索过滤 | `setSearchQuery()` |
| 筛选按钮 | 按钮 | 打开筛选面板 | 预留功能 |
| 分类标签 | Tab按钮 | 切换视频分类 | `setActiveCategory()` |
| 更多分类 | 下拉菜单 | 显示更多分类 | `setShowMoreCategories()` |
| 视频卡片网格 | 网格布局 | 展示推荐视频 | - |

### API 调用

| 接口 | 命令 | 参数 | 返回 | 调用时机 |
|------|------|------|------|----------|
| 获取热门视频 | `get_popular_videos` | `{page, pageSize}` | VideoInfo[] | 页面加载/刷新 |

### 状态变化

```
页面加载
  ↓
fetchVideos()
  ↓
get_popular_videos({page: 1, pageSize: 20})
  ↓
transformVideo() 转换数据格式
  ↓
setVideos(data) → 渲染视频网格
```

⚠ **分类筛选**: 当前仅实现UI，分类过滤逻辑未实现（使用全量数据）

---

## 3.4 我的收藏 (FavoritesView)

**文件**: `frontend/src/views/favorites/favorites-view.tsx`

### UI 功能

| 组件 | 类型 | 功能 | 触发逻辑 |
|------|------|------|----------|
| 页面标题 | 展示区 | 显示收藏夹数量 | - |
| 刷新按钮 | 按钮 | 刷新收藏夹列表 | `handleRefresh()` |
| 收藏夹列表 | 网格 | 显示所有收藏夹 | `handleSelectFolder()` |
| 加载更多 | 按钮 | 加载更多收藏夹 | `handleLoadMoreFolders()` |
| 视图切换 | 切换按钮 | 网格/列表视图 | `setViewMode()` |
| 批量管理 | 按钮 | 批量操作 | 预留功能 |
| 视频条目 | 列表项 | 显示视频信息 | - |
| 下载按钮 | 按钮 | 创建下载任务 | `handleDownload()` |

### API 调用

| 接口 | 命令 | 参数 | 返回 | 调用时机 |
|------|------|------|------|----------|
| 获取收藏夹列表 | `get_fav_folders` | `{uid}` | FavFolders | 页面加载 |
| 获取收藏夹内容 | `get_fav_info` | `{mediaId, page}` | FavInfo | 选中收藏夹 |
| 创建下载任务 | `create_download_task` | `{params}` | string[] | 点击下载 |

### 状态变化

```
页面加载
  ↓
fetchFolders()
  ↓
get_fav_folders({uid: 0})
  ↓
setFolders(data.list)
setSelectedFolder(data.list[0]) // 默认选中第一个
  ↓
selectedFolder 变化
  ↓
fetchFolderContent(selectedFolder.id, 1)
  ↓
get_fav_info({mediaId, page})
  ↓
setMedias(data.medias)
setHasMore(data.has_more)
  ↓
用户点击下载
  ↓
create_download_task({bvid, cid, title, cids})
  ↓
成功 → setView("downloads")
```

⚠ **加载更多收藏夹**: `handleLoadMoreFolders()` 为 TODO 未实现

---

## 3.5 稍后再看 (WatchLaterView)

**文件**: `frontend/src/views/watchlater/watchlater-view.tsx`

### UI 功能

| 组件 | 类型 | 功能 | 触发逻辑 |
|------|------|------|----------|
| 页面标题 | 展示区 | 显示视频数量 | - |
| 刷新按钮 | 按钮 | 刷新列表 | `handleRefresh()` |
| 视频列表 | 列表 | 显示稍后再看视频 | - |
| 下载按钮 | 按钮 | 创建下载任务 | `handleDownload()` |
| 批量下载 | 按钮 | 下载全部视频 | 预留功能 |

### API 调用

| 接口 | 命令 | 参数 | 返回 | 调用时机 |
|------|------|------|------|----------|
| 获取稍后再看 | `get_watch_later_info` | 无 | WatchLaterInfo | 页面加载/刷新 |
| 创建下载任务 | `create_download_task` | `{params}` | string[] | 点击下载 |

---

## 3.6 观看历史 (HistoryView)

**文件**: `frontend/src/views/history/history-view.tsx`

### UI 功能

| 组件 | 类型 | 功能 | 触发逻辑 |
|------|------|------|----------|
| 页面标题 | 展示区 | 显示历史记录 | - |
| 刷新按钮 | 按钮 | 刷新列表 | `handleRefresh()` |
| 历史记录列表 | 列表 | 显示观看历史 | - |
| 下载按钮 | 按钮 | 创建下载任务 | `handleDownload()` |
| 加载更多 | 按钮 | 加载更多记录 | `handleLoadMore()` |

### API 调用

| 接口 | 命令 | 参数 | 返回 | 调用时机 |
|------|------|------|------|----------|
| 获取历史记录 | `get_history_info` | `{view_at}` | HistoryInfo | 页面加载/加载更多 |
| 创建下载任务 | `create_download_task` | `{params}` | string[] | 点击下载 |

---

## 3.7 追番追剧 (BangumiView)

**文件**: `frontend/src/views/bangumi/bangumi-view.tsx`

### UI 功能

| 组件 | 类型 | 功能 | 触发逻辑 |
|------|------|------|----------|
| 页面标题 | 展示区 | 显示追番列表 | - |
| Tab切换 | Tab按钮 | 追番/追剧切换 | `setActiveTab()` |
| 刷新按钮 | 按钮 | 刷新列表 | `handleRefresh()` |
| 番剧卡片 | 卡片 | 显示番剧信息 | - |
| 剧集列表 | 列表 | 显示剧集详情 | - |
| 下载按钮 | 按钮 | 下载单集 | `handleDownload()` |

### API 调用

| 接口 | 命令 | 参数 | 返回 | 调用时机 |
|------|------|------|------|----------|
| 获取追番列表 | `get_bangumi_follow_info` | `{vmid, page}` | BangumiFollowInfo | 页面加载 |
| 获取番剧详情 | `get_bangumi_info` | `{ep_id, season_id}` | BangumiInfo | 选中番剧 |
| 创建下载任务 | `create_download_task` | `{params}` | string[] | 点击下载 |

---

## 3.8 下载队列 (DownloadsView)

**文件**: `frontend/src/views/downloads/downloads-view.tsx`

### UI 功能

| 组件 | 类型 | 功能 | 触发逻辑 |
|------|------|------|----------|
| 页面标题 | 展示区 | 显示任务总数 | - |
| 新建下载 | 按钮 | 创建新下载 | 预留功能 |
| 打开目录 | 按钮 | 打开下载文件夹 | `handleOpenFolder()` |
| 全部开始 | 按钮 | 恢复所有暂停任务 | `handleStartAll()` |
| 全部暂停 | 按钮 | 暂停所有任务 | `handlePauseAll()` |
| 全部删除 | 按钮 | 删除所有任务 | `handleDeleteAll()` |
| 状态筛选Tab | Tab按钮 | 按状态筛选 | `setActiveTab()` |
| 搜索框 | 输入框 | 搜索任务 | `setSearchKeyword()` |
| 下载行 | 行组件 | 显示任务详情 | - |
| 暂停/继续按钮 | 按钮 | 暂停/继续任务 | `handlePause()/handleResume()` |
| 删除按钮 | 按钮 | 删除任务 | `handleDelete()` |
| 重试按钮 | 按钮 | 重启失败任务 | `handleRestart()` |

### API 调用

| 接口 | 命令 | 参数 | 返回 | 调用时机 |
|------|------|------|------|----------|
| 获取下载任务 | `get_download_tasks` | 无 | DownloadProgress[] | 页面加载/2秒轮询 |
| 暂停任务 | `pause_download_tasks` | `{task_ids}` | void | 点击暂停 |
| 恢复任务 | `resume_download_tasks` | `{task_ids}` | void | 点击继续 |
| 删除任务 | `delete_download_tasks` | `{task_ids}` | void | 点击删除 |
| 重启任务 | `restart_download_tasks` | `{task_ids}` | void | 点击重试 |
| 打开目录 | `open_download_folder` | 无 | void | 点击打开目录 |

### 状态变化

```
页面加载
  ↓
fetchTasks()
  ↓
get_download_tasks()
  ↓
setTasks(uiTasks) // 转换为UI格式
  ↓
每2秒轮询更新
  ↓
用户操作 (暂停/继续/删除/重启)
  ↓
对应命令调用
  ↓
fetchTasks() 刷新列表
```

### 下载任务状态

```typescript
type TaskState = "Pending" | "Downloading" | "Paused" | "Completed" | "Failed";

interface DownloadTask {
  task_id: string;
  title: string;
  cover: string;
  quality: string;
  format: string;
  state: TaskState;
  progress: number;      // 0-100
  total_size: number;    // bytes
  downloaded_size: number;
  speed: number;         // bytes/s
  remaining_time: string;
  error?: string;
}
```

---

## 3.9 设置 (SettingsView)

**文件**: `frontend/src/views/settings/settings-view.tsx`

### UI 功能

| 组件 | 类型 | 功能 | 触发逻辑 |
|------|------|------|----------|
| Cookie登录 | 设置项 | 显示登录状态/退出登录 | `handleLogout()` |
| 外观主题 | 选择器 | 切换亮色/暗色/系统 | `handleThemeChange()` |
| 下载目录 | 路径显示 | 显示/更改下载目录 | `handleBrowseFolder()` |
| 下载质量 | 下拉选择 | 选择视频质量 | `handleQualityChange()` |
| 并发下载数 | 数字步进器 | 设置同时下载数 | `handleConcurrencyChange()` |

### API 调用

| 接口 | 命令 | 参数 | 返回 | 调用时机 |
|------|------|------|------|----------|
| 获取配置 | `get_config` | 无 | BackendConfig | 页面加载 |
| 保存配置 | `save_config` | `{newConfig}` | void | 更改设置时 |
| 获取用户信息 | `get_user_info` | `{sessdata}` | UserInfoData | 检查登录 |
| 退出登录 | `logout` | 无 | void | 点击退出 |

### 质量选项

```typescript
const QUALITY_OPTIONS = [
  { value: "4k", label: "4K 超清" },
  { value: "1080p_plus", label: "1080P 高码率" },
  { value: "1080p", label: "1080P 高清（推荐）" },
  { value: "720p", label: "720P 高清" },
  { value: "480p", label: "480P 清晰" },
  { value: "360p", label: "360P 流畅" },
];
```

---

# 4. API 总表

## 4.1 Tauri IPC 命令

### 配置相关

| 命令 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `get_config` | 无 | Config | 获取应用配置 |
| `save_config` | `{newConfig: Config}` | void | 保存应用配置 |

### 认证相关

| 命令 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `generate_qrcode` | 无 | QrcodeData | 生成登录二维码 |
| `get_qrcode_status` | `{qrcode_key: string}` | QrcodeStatus | 查询二维码状态 |
| `get_user_info` | `{sessdata: string}` | UserInfo | 获取用户信息 |
| `login` | `{sessdata: string}` | void | 保存SESSDATA登录 |
| `logout` | 无 | void | 清除登录状态 |
| `check_login_status` | 无 | bool | 检查是否已登录 |

### 视频相关

| 命令 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `search_video` | `{input: string}` | SearchResult | 搜索视频 |
| `get_normal_info` | `{bvid: string}` | VideoInfo | 获取视频信息 |
| `get_normal_url` | `{bvid: string, cid: i64}` | PlayUrlInfo | 获取播放地址 |
| `get_popular_videos` | `{page?: i64, pageSize?: i64}` | VideoInfo[] | 获取热门视频 |

### 下载相关

| 命令 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `create_download_task` | `{params: CreateParams}` | string[] | 创建下载任务 |
| `get_download_tasks` | 无 | DownloadProgress[] | 获取所有任务 |
| `pause_download_tasks` | `{task_ids: string[]}` | void | 暂停任务 |
| `resume_download_tasks` | `{task_ids: string[]}` | void | 恢复任务 |
| `delete_download_tasks` | `{task_ids: string[]}` | void | 删除任务 |
| `restart_download_tasks` | `{task_ids: string[]}` | void | 重启任务 |
| `get_download_task_count` | 无 | number | 获取任务总数 |
| `get_active_download_count` | 无 | number | 获取活跃任务数 |

### 用户内容相关

| 命令 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `get_fav_folders` | `{uid: i64}` | FavFolders | 获取收藏夹列表 |
| `get_fav_info` | `{mediaId: i64, page: i64}` | FavInfo | 获取收藏夹内容 |
| `get_history_info` | `{view_at: i64}` | HistoryInfo | 获取观看历史 |
| `get_watch_later_info` | 无 | WatchLaterInfo | 获取稍后再看 |

### 番剧相关

| 命令 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `get_bangumi_info` | `{ep_id?: i64, season_id?: i64}` | BangumiInfo | 获取番剧信息 |
| `get_bangumi_follow_info` | `{vmid: i64, page: i64}` | BangumiFollowInfo | 获取追番列表 |

### 弹幕字幕相关

| 命令 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `get_danmaku` | `{aid: i64, cid: i64, duration: i64}` | DanmakuData | 获取弹幕数据 |
| `get_danmaku_xml` | `{aid: i64, cid: i64, duration: i64}` | string | 获取弹幕XML |
| `get_subtitle_info` | `{aid: i64, cid: i64}` | SubtitleInfo | 获取字幕信息 |
| `get_subtitle` | `{url: string}` | Subtitle | 获取字幕内容 |
| `get_all_subtitles_srt` | `{aid: i64, cid: i64}` | Vec<(string, string)> | 获取所有字幕SRT |

### 插件相关

| 命令 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `get_plugins` | 无 | PluginInfo[] | 获取插件列表 |
| `refresh_plugins` | 无 | void | 刷新插件列表 |
| `enable_plugin` | `{plugin_id: string}` | void | 启用插件 |
| `disable_plugin` | `{plugin_id: string}` | void | 禁用插件 |
| `get_plugin_dir` | 无 | string | 获取插件目录 |

### 工具相关

| 命令 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `open_download_folder` | 无 | void | 打开下载目录 |

## 4.2 Bilibili API 端点

### 认证 API (`src-tauri/src/api/auth.rs`)

| 方法 | API端点 | 说明 |
|------|---------|------|
| `generate_qrcode()` | `https://passport.bilibili.com/x/passport-login/web/qrcode/generate` | 生成二维码 |
| `get_qrcode_status()` | `https://passport.bilibili.com/x/passport-login/web/qrcode/poll` | 查询二维码状态 |
| `get_user_info()` | `https://api.bilibili.com/x/web-interface/nav` | 获取用户信息 |

### 视频 API (`src-tauri/src/api/video.rs`)

| 方法 | API端点 | 说明 |
|------|---------|------|
| `get_normal_info()` | `https://api.bilibili.com/x/web-interface/view` | 获取视频信息 |
| `get_normal_url()` | `https://api.bilibili.com/x/player/wbi/playurl` | 获取播放地址 |
| `get_popular_videos()` | `https://api.bilibili.com/x/web-interface/popular` | 获取热门视频 |

### 番剧 API (`src-tauri/src/api/bangumi.rs`)

| 方法 | API端点 | 说明 |
|------|---------|------|
| `get_bangumi_info()` | `https://api.bilibili.com/pgc/view/web/season` | 获取番剧信息 |
| `get_bangumi_follow_info()` | `https://api.bilibili.com/x/space/bangumi/follow/list` | 获取追番列表 |

### 收藏夹 API (`src-tauri/src/api/favorite.rs`)

| 方法 | API端点 | 说明 |
|------|---------|------|
| `get_fav_folders()` | `https://api.bilibili.com/x/v3/fav/folder/created/list-all` | 获取收藏夹列表 |
| `get_fav_info()` | `https://api.bilibili.com/x/v3/fav/resource/list` | 获取收藏夹内容 |

### 历史记录 API (`src-tauri/src/api/history.rs`)

| 方法 | API端点 | 说明 |
|------|---------|------|
| `get_history_info()` | `https://api.bilibili.com/x/web-interface/history/cursor` | 获取观看历史 |

### 稍后再看 API (`src-tauri/src/api/watchlater.rs`)

| 方法 | API端点 | 说明 |
|------|---------|------|
| `get_watch_later_info()` | `https://api.bilibili.com/x/v2/history/toview` | 获取稍后再看 |

### 弹幕 API (`src-tauri/src/api/danmaku.rs`)

| 方法 | API端点 | 说明 |
|------|---------|------|
| `get_danmaku_segment()` | `https://api.bilibili.com/x/v2/dm/web/seg.so` | 获取弹幕片段 |
| `get_danmaku_view()` | `https://api.bilibili.com/x/v2/dm/web/view` | 获取弹幕视图 |

### 字幕 API (`src-tauri/src/api/subtitle.rs`)

| 方法 | API端点 | 说明 |
|------|---------|------|
| `get_subtitle_info()` | `https://api.bilibili.com/x/player/wbi/v2` | 获取字幕信息 |
| `get_subtitle()` | 字幕URL (相对路径) | 获取字幕内容 |

---

# 5. 状态管理分析

## 5.1 Zustand Stores

**文件**: `frontend/src/stores/app-store.ts`

### AppStore (应用状态)

```typescript
interface AppState {
  // 视图状态
  currentView: ViewType;
  setView: (view: ViewType) => void;

  // 侧边栏状态
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // 底部栏状态
  bottomBarExpanded: boolean;
  toggleBottomBar: () => void;
  setBottomBarExpanded: (expanded: boolean) => void;

  // 设置面板状态
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;

  // 登录状态
  isLoggedIn: boolean;
  username: string;
  userInfo: UserInfoDetail | null;
  setLoggedIn: (loggedIn: boolean, username?: string) => void;
  updateUserInfo: (info: Partial<UserInfoDetail>) => void;
  logout: () => void;
}
```

### DownloadStore (下载状态)

```typescript
interface DownloadStore {
  tasks: Record<string, DownloadTask>;
  activeCount: number;
  downloadSpeed: string;
  addTask: (task: DownloadTask) => void;
  updateTask: (task: Partial<DownloadTask> & { id: string }) => void;
  removeTask: (id: string) => void;
  clearCompleted: () => void;
  setDownloadSpeed: (speed: string) => void;
}
```

### LogStore (日志状态)

```typescript
interface LogStore {
  logs: LogEntry[];
  nextId: number;
  addLog: (message: string, type: LogEntry["type"]) => void;
  clearLogs: () => void;
}
```

## 5.2 状态变化链

### 登录流程

```
用户点击登录
  ↓
LoginDialog 打开
  ↓
选择登录方式 (二维码/Cookie)
  ↓
[二维码登录]
  generate_qrcode() → 显示二维码
  ↓
轮询 get_qrcode_status() (每2秒)
  ↓
用户扫码确认 → code=0
  ↓
提取 SESSDATA
  ↓
login({sessdata}) → 保存到配置
  ↓
setLoggedIn(true) → 更新全局状态
  ↓
关闭对话框

[Cookie登录]
  用户输入 SESSDATA
  ↓
get_user_info({sessdata}) → 验证有效性
  ↓
login({sessdata}) → 保存到配置
  ↓
setLoggedIn(true, username) → 更新全局状态
  ↓
关闭对话框
```

### 下载流程

```
任意页面点击下载
  ↓
create_download_task({bvid, cid, title, cids})
  ↓
返回 taskIds
  ↓
setView("downloads") → 跳转下载队列
  ↓
DownloadsView 轮询 get_download_tasks() (每2秒)
  ↓
更新任务进度/状态
  ↓
下载完成 → 状态变为 "Completed"
```

---

# 6. 权限系统分析

## 6.1 鉴权机制

### Token 管理

- **存储位置**: 配置文件 (`config.json`)
- **存储字段**: `sessdata` (Bilibili SESSDATA)
- **使用方式**: 请求时自动注入 Cookie header

```rust
// src-tauri/src/api/client.rs
pub fn get_cookie(&self) -> String {
    let config = self.app.state::<Arc<RwLock<Config>>>();
    let sessdata = config.read().sessdata.clone();
    format!("SESSDATA={}", sessdata.trim_end_matches(';'))
}
```

### 登录方式

1. **二维码登录**
   - 调用 `generate_qrcode` 获取二维码URL
   - 用户使用Bilibili APP扫码
   - 轮询 `get_qrcode_status` 直到成功
   - 从响应中提取 SESSDATA

2. **Cookie 直接登录**
   - 用户手动输入 SESSDATA
   - 调用 `get_user_info` 验证有效性
   - 调用 `login` 保存到配置

### 登录状态检查

```typescript
// 前端检查
const isLoggedIn = useAppStore((s) => s.isLoggedIn);

// 后端检查
pub fn check_login_status(config: State<'_, Arc<RwLock<Config>>>) -> bool {
    !config.read().sessdata.is_empty()
}
```

## 6.2 需要登录的功能

| 功能 | 是否需要登录 |
|------|-------------|
| 搜索视频 (普通) | 否 |
| 搜索番剧 | 否 |
| 获取热门视频 | 否 |
| 创建下载任务 | 否 |
| 下载管理 | 否 |
| 获取收藏夹 | 是 |
| 获取稍后再看 | 是 |
| 获取观看历史 | 是 |
| 获取追番列表 | 是 |

---

# 7. 完整业务流程图

## 7.1 视频下载流程

```
┌─────────────────────────────────────────────────────────────────┐
│                         开始                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  用户选择视频来源:                                                │
│  - 搜索视频 (输入BV号/链接)                                       │
│  - 推荐视频 (热门列表)                                            │
│  - 我的收藏 (收藏夹内容)                                          │
│  - 稍后再看                                                      │
│  - 观看历史                                                      │
│  - 追番追剧                                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  获取视频信息:                                                    │
│  search_video / get_popular_videos / get_fav_info 等             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  显示视频详情:                                                    │
│  - 标题、封面、时长、UP主                                         │
│  - 分P列表 (如有)                                                │
│  - 下载按钮                                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  用户点击下载                                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  create_download_task({bvid, cid, title, cids})                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  后端 DownloadManager 处理:                                       │
│  1. 创建下载任务                                                   │
│  2. 获取视频流地址                                                 │
│  3. 开始下载 (视频+音频+封面+弹幕+字幕+NFO)                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  前端自动跳转到下载队列页面                                        │
│  setView("downloads")                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  下载队列轮询更新 (每2秒)                                          │
│  get_download_tasks()                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  下载完成 → 用户可打开下载目录查看文件                              │
│  open_download_folder()                                         │
└─────────────────────────────────────────────────────────────────┘
```

## 7.2 用户登录流程

```
┌─────────────────────────────────────────────────────────────────┐
│  用户点击侧边栏用户区域                                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  打开 LoginDialog                                                │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────────┐  ┌─────────────────────────────────┐
│      二维码登录              │  │         Cookie登录              │
├─────────────────────────────┤  ├─────────────────────────────────┤
│ 1. generate_qrcode()        │  │ 1. 用户输入 SESSDATA            │
│ 2. 显示二维码                │  │ 2. get_user_info() 验证         │
│ 3. 轮询 qrcode_status       │  │ 3. login() 保存                 │
│ 4. 用户扫码确认              │  │ 4. setLoggedIn(true)            │
│ 5. 提取 SESSDATA            │  │                                 │
│ 6. login() 保存             │  │                                 │
│ 7. setLoggedIn(true)        │  │                                 │
└─────────────────────────────┘  └─────────────────────────────────┘
              │                               │
              └───────────────┬───────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  更新全局状态:                                                    │
│  - isLoggedIn = true                                             │
│  - username = "用户昵称"                                          │
│  - 侧边栏显示已登录状态                                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  解锁需要登录的功能:                                               │
│  - 我的收藏                                                      │
│  - 稍后再看                                                      │
│  - 观看历史                                                      │
│  - 追番追剧                                                      │
└─────────────────────────────────────────────────────────────────┘
```

## 7.3 应用启动流程

```
┌─────────────────────────────────────────────────────────────────┐
│  应用启动                                                        │
│  main.tsx → App.tsx                                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Tauri 后端初始化:                                                │
│  1. 加载配置 (config.json)                                       │
│  2. 创建 BiliClient                                              │
│  3. 创建 DownloadManager                                         │
│  4. 创建 PluginManager                                           │
│  5. 注册所有 Commands                                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  前端初始化:                                                      │
│  1. 渲染 AppShell                                                │
│  2. 显示 Sidebar + 主内容区                                       │
│  3. 默认显示 HomeView                                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  HomeView 加载:                                                   │
│  1. get_download_task_count() 获取下载统计                        │
│  2. 检查登录状态                                                   │
│  3. 已登录 → 获取收藏夹/稍后再看/历史记录数量                        │
└─────────────────────────────────────────────────────────────────┘
```

---

# 8. 特殊标记

## ⚠ 未实现功能

| 功能 | 位置 | 说明 |
|------|------|------|
| 分类筛选 | recommend-view.tsx | 分类标签仅UI，无过滤逻辑 |
| 加载更多收藏夹 | favorites-view.tsx | `handleLoadMoreFolders()` 为TODO |
| WBI密钥获取 | src-tauri/src/api/wbi.rs | 标记为TODO未实现 |
| 批量管理 | favorites-view.tsx | 按钮预留，功能未实现 |
| 新建下载 | downloads-view.tsx | 按钮预留，跳转到搜索页 |
| 筛选功能 | recommend-view.tsx | 按钮预留，功能未实现 |

## 📝 注意事项

1. **轮询机制**: 下载进度通过轮询实现 (每2秒)，非WebSocket
2. **状态持久化**: 登录信息保存在配置文件，重启后自动恢复
3. **分页处理**: 支持收藏夹内容、历史记录分页加载
4. **跨平台**: 支持 Windows/macOS/Linux，打开目录命令适配不同系统

---

# 附录

## A. 类型定义

**文件**: `frontend/src/lib/types.ts`

```typescript
// 下载进度
interface DownloadProgress {
  task_id: string;
  title: string;
  state: TaskState;
  progress: number;
  total_size: number;
  downloaded_size: number;
  speed: number;
  error?: string;
}

// 下载任务状态
type TaskState = "Pending" | "Downloading" | "Paused" | "Completed" | "Failed";

// 创建下载任务参数
interface CreateDownloadTaskParams {
  bvid: string;
  cid: number;
  title: string;
  cids: number[];
}
```

## B. 工具函数

**文件**: `frontend/src/lib/utils.ts`

```typescript
// 格式化时长 (秒 → "HH:MM:SS" 或 "MM:SS")
formatDuration(seconds: number): string

// 格式化数字 (12345 → "1.2万")
formatNumber(num: number): string

// 类名合并
cn(...inputs: ClassValue[]): string
```

## C. IPC 封装

**文件**: `frontend/src/lib/api.ts`

```typescript
// 统一的 Tauri IPC 调用
async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T>

// 带加载状态的调用
async function invokeWithLoading<T>(
  cmd: string,
  args?: Record<string, unknown>,
  options?: { onLoading?: (v: boolean) => void }
): Promise<T>
```

---

> 文档生成时间: 2026-05-22
> 分析工具: Claude Code
