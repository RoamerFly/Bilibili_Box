/// 前端类型定义

// 配置类型
export interface Config {
  download_dir: string;
  start_maximized: boolean;
  card_scale: number;
  card_page_size: number;
  enable_file_logger: boolean;
  sessdata: string;
  cookie?: string;
  theme: string;
  download_quality: string;
  prompt_download_quality: boolean;
  video_quality_priority: number[];
  codec_type_priority: number[];
  audio_quality_priority: number[];
  download_video: boolean;
  download_audio: boolean;
  auto_merge: boolean;
  embed_chapter: boolean;
  embed_skip: boolean;
  download_xml_danmaku: boolean;
  download_ass_danmaku: boolean;
  download_json_danmaku: boolean;
  download_subtitle: boolean;
  download_cover: boolean;
  download_nfo: boolean;
  download_json: boolean;
  dir_fmt: string;
  dir_fmt_for_part: string;
  time_fmt: string;
  proxy_mode: string;
  proxy_host: string;
  proxy_port: number;
  task_concurrency: number;
  task_download_interval_sec: number;
  chunk_concurrency: number;
  chunk_download_interval_sec: number;
  file_exist_action: string;
  auto_start_download_task: boolean;
}

// 用户信息
export interface UserInfo {
  isLogin?: boolean;
  is_login?: boolean;
  mid: number;
  uname: string;
  face: string;
  level_info: {
    current_level: number;
  };
  vip: {
    type: number;
    status: number;
  };
}

// 二维码数据
export interface QrcodeData {
  url: string;
  qrcode_key: string;
}

// 二维码状态
export interface QrcodeStatus {
  code: number;
  message: string;
  url?: string;
  refresh_token?: string;
  sessdata?: string | null;
}

// 视频信息
export interface VideoInfo {
  aid: number;
  bvid: string;
  cid: number;
  title: string;
  duration: number;
  description: string;
  pic: string;
  pubdate?: number;
  owner: {
    mid: number;
    name: string;
    face: string;
  };
  stat: VideoStat;
  pages: Array<{
    cid: number;
    page: number;
    part: string;
    duration: number;
  }>;
}

// 视频统计信息
export interface VideoStat {
  view: number;
  danmaku: number;
  reply: number;
  favorite: number;
  coin: number;
  share: number;
  like: number;
}

// 番剧信息
export interface BangumiInfo {
  season_id: number;
  title: string;
  cover: string;
  evaluate: string;
  episodes: Array<{
    ep_id: number;
    bvid: string;
    cid: number;
    title: string;
    long_title: string;
    cover: string;
    duration: number;
  }>;
  up_info?: {
    mid: number;
    name: string;
    avatar: string;
  };
}

export interface AggregateKeywordVideoResult {
  aid: number;
  bvid: string;
  title: string;
  pic: string;
  duration: string;
  mid?: number;
  author: string;
  author_face?: string;
  pubdate?: number;
  play: number;
  danmaku?: number;
  like?: number;
  favorite?: number;
  reply?: number;
  description: string;
}

export interface AggregateKeywordBangumiResult {
  season_id: number;
  title: string;
  cover: string;
  index_show: string;
  description: string;
  goto_url: string;
}

export interface AggregateSearchResult {
  keyword: string;
  videos: AggregateKeywordVideoResult[];
  bangumi: AggregateKeywordBangumiResult[];
}

export type SearchOrder = "totalrank" | "click" | "pubdate" | "dm" | "stow";
export type SearchDate = "0" | "1" | "7" | "30" | "365";
export type SearchDuration = "0" | "1" | "2" | "3" | "4";

export interface SearchFilters {
  order: SearchOrder;
  pubtime: SearchDate;
  duration: SearchDuration;
}

export interface BangumiSearchResult {
  season_id: number;
  title: string;
  cover: string;
  evaluate: string;
  episodes: Array<{
    ep_id: number;
    bvid: string;
    cid: number;
    title: string;
    long_title: string;
    cover: string;
    duration: number;
  }>;
}

export type SearchResponse =
  | ({ type: "Normal" } & VideoInfo)
  | ({ type: "Bangumi" } & BangumiSearchResult)
  | ({ type: "Aggregate" } & AggregateSearchResult);

// 追番信息项
export interface BangumiFollowItem {
  season_id: number;
  title: string;
  cover: string;
  evaluate: string;
  total_count: number;
  new_ep?: {
    id: number;
    title: string;
    long_title: string;
    cover: string;
  };
}

// 追番列表
export interface BangumiFollowInfo {
  list: BangumiFollowItem[];
  total: number;
}

// 收藏夹
export interface FavFolder {
  id: number;
  title: string;
  cover: string;
  media_count: number;
}

export interface FavFolders {
  count: number;
  list: FavFolder[];
}

export interface FavMedia {
  id: number;
  bvid: string;
  cid: number;
  title: string;
  cover: string;
  duration: number;
  upper: {
    mid: number;
    name: string;
  };
}

export interface FavInfo {
  info: FavFolder;
  medias: FavMedia[];
  has_more: boolean;
}

// 历史记录
export interface HistoryItem {
  bvid: string;
  cid: number;
  title: string;
  cover: string;
  duration: number;
  progress: number;
  view_at: number;
  author: {
    mid: number;
    name: string;
  };
}

export interface HistoryInfo {
  list: HistoryItem[];
  cursor: {
    max: number;
    view_at: number;
    business: string;
  };
}

// 稍后再看
export interface WatchLaterItem {
  aid: number;
  bvid: string;
  cid: number;
  title: string;
  pic: string;
  duration: number;
  owner: {
    mid: number;
    name: string;
    face: string;
  };
}

export interface WatchLaterInfo {
  count: number;
  list: WatchLaterItem[];
}

// 下载事件
export interface DownloadEvent {
  event: string;
  data: any;
}

// ========== 下载相关类型（匹配后端） ==========

/** 创建下载任务参数（匹配后端 CreateDownloadTaskParams） */
export interface CreateDownloadTaskParams {
  bvid: string;
  cid: number;
  title: string;
  cids: number[];
  download_quality?: string;
}

export type DownloadStage =
  | "pending"
  | "downloading_video"
  | "downloading_audio"
  | "merging"
  | "completed"
  | "failed"
  | "paused";

/** 下载任务状态枚举（匹配后端 DownloadTaskState） */
export type DownloadTaskState =
  | "Pending"
  | "Downloading"
  | "Merging"
  | "Paused"
  | "Completed"
  | "Failed";

/** 下载进度（匹配后端 DownloadProgress） */
export interface DownloadProgress {
  task_id: string;
  aid?: number;
  bvid: string;
  cid: number;
  title: string;
  cover?: string;
  duration?: number;
  quality?: string;
  state: DownloadTaskState;
  stage?: DownloadStage;
  progress: number;
  total_size: number;
  downloaded_size: number;
  speed: number;
  video_url?: string;
  audio_url?: string;
  error?: string;
  output_path?: string;
  created_at?: number;
}

/** 前端 UI 使用的下载任务格式 */
export interface DownloadTask {
  task_id: string;
  title: string;
  cover: string;
  quality: string;
  format: string;
  state: DownloadTaskState;
  stage?: DownloadStage;
  progress: number;
  total_size: number;
  downloaded_size: number;
  speed: number;
  remaining_time: string;
  error?: string;
  output_path?: string;
  created_at?: number;
}

// 插件信息
export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  enabled: boolean;
  priority: number;
}
