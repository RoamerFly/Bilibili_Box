/**
 * Browser-only demo bridge.
 *
 * This module intentionally contains local sample data only. It does not
 * connect to Bilibili, read credentials, resolve media URLs, or access a
 * native backend.
 */

import type { Config, VideoInfo } from "@/lib/types";

export type UnlistenFn = () => void;
type EventHandler<T> = (event: { payload: T }) => void;

const DEMO_COVER = "/demo-cover.svg";
const DEMO_AVATAR = "/demo-avatar.svg";
const DEMO_VIDEO = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
const now = Math.floor(Date.now() / 1000);
const listeners = new Map<string, Set<EventHandler<unknown>>>();
const pageCache = new Map<string, unknown>();

const defaultConfig: Config = {
  download_dir: "Demo Downloads",
  start_maximized: false,
  card_scale: 1,
  card_page_size: 6,
  card_page_rows: 3,
  card_page_columns: 2,
  enable_file_logger: false,
  sessdata: "demo-session",
  cookie: "",
  theme: "system",
  download_quality: "1080p",
  prompt_download_quality: true,
  show_comments: true,
  video_quality_priority: [80, 64, 32, 16],
  codec_type_priority: [7, 12],
  audio_quality_priority: [30280, 30232, 30216],
  download_video: true,
  download_audio: true,
  auto_merge: true,
  embed_chapter: false,
  embed_skip: false,
  download_xml_danmaku: false,
  download_ass_danmaku: false,
  download_json_danmaku: false,
  download_subtitle: true,
  download_cover: true,
  download_nfo: false,
  download_json: false,
  dir_fmt: "{title}",
  dir_fmt_for_part: "{title}",
  time_fmt: "%Y-%m-%d",
  proxy_mode: "system",
  proxy_host: "",
  proxy_port: 0,
  task_concurrency: 3,
  task_download_interval_sec: 0,
  chunk_concurrency: 4,
  chunk_download_interval_sec: 0,
  file_exist_action: "skip",
  auto_start_download_task: true,
};

let config: Config = { ...defaultConfig };
let taskSequence = 0;
let downloadTasks: Array<Record<string, unknown>> = [];

const demoUser = {
  isLogin: true,
  is_login: true,
  mid: 10001,
  uname: "BiliBox Demo",
  face: DEMO_AVATAR,
  login_time: new Date().toLocaleString("zh-CN"),
  level_info: { current_level: 6 },
  vip: { type: 2, status: 1 },
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeVideo(index: number): VideoInfo {
  const duration = 180 + index * 37;
  return {
    aid: 100000 + index,
    bvid: `BV1DEMO${String(index).padStart(4, "0")}`,
    cid: 200000 + index,
    title: `BiliBox 界面演示视频 ${index}`,
    duration,
    description: "此内容由本地 Mock 数据生成，仅用于预览界面与交互。",
    pic: DEMO_COVER,
    pubdate: now - index * 3600,
    owner: {
      mid: 10001 + (index % 3),
      name: index % 2 === 0 ? "演示创作者" : "BiliBox Demo",
      face: DEMO_AVATAR,
    },
    stat: {
      view: 12000 + index * 2345,
      danmaku: 30 + index,
      reply: 18 + index,
      favorite: 320 + index * 8,
      coin: 90 + index * 4,
      share: 12 + index,
      like: 860 + index * 31,
    },
    pages: [
      { cid: 200000 + index, page: 1, part: "界面演示", duration },
      { cid: 300000 + index, page: 2, part: "交互演示", duration: 95 },
    ],
  };
}

const demoVideos = Array.from({ length: 24 }, (_, index) => makeVideo(index + 1));

function pageInfo(page: number, pageSize: number, total: number) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return {
    page,
    page_size: pageSize,
    total,
    page_count: pageCount,
    has_more: page < pageCount,
  };
}

function makeAggregateSearch(args: Record<string, unknown>) {
  const keyword = String(args.input || "BiliBox");
  const page = Number(args.page || 1);
  const pageSize = Number(args.pageSize || 6);
  const start = Math.max(0, (page - 1) * pageSize);
  const selected = demoVideos.slice(start, start + pageSize);
  const info = pageInfo(page, pageSize, demoVideos.length);
  const videos = selected.map((video) => ({
    aid: video.aid,
    bvid: video.bvid,
    title: `${keyword} · ${video.title}`,
    pic: video.pic,
    duration: `${Math.floor(video.duration / 60)}:${String(video.duration % 60).padStart(2, "0")}`,
    mid: video.owner.mid,
    author: video.owner.name,
    author_face: video.owner.face,
    pubdate: video.pubdate,
    play: video.stat.view,
    danmaku: video.stat.danmaku,
    like: video.stat.like,
    favorite: video.stat.favorite,
    reply: video.stat.reply,
    description: video.description,
  }));
  const generic = (kind: string) => selected.slice(0, 3).map((video, index) => ({
    id: `${kind}-${video.aid}`,
    title: `${keyword} · ${kind}演示 ${index + 1}`,
    cover: DEMO_COVER,
    description: "本地演示数据",
    url: "#",
    author: video.owner.name,
    author_face: DEMO_AVATAR,
    mid: video.owner.mid,
    badge: kind,
    stats: [`${video.stat.view} 播放`, `${video.stat.like} 点赞`],
  }));
  return {
    type: "Aggregate",
    keyword,
    videos,
    bangumi: [{
      season_id: 40001,
      title: `${keyword} · 演示番剧`,
      cover: DEMO_COVER,
      index_show: "更新至 3 话",
      description: "本地番剧演示数据",
      goto_url: "#",
    }],
    films: generic("影视"),
    lives: generic("直播"),
    articles: generic("专栏"),
    users: generic("用户"),
    video_page: info,
    bangumi_page: pageInfo(1, pageSize, 1),
    film_page: pageInfo(1, pageSize, 3),
    live_page: pageInfo(1, pageSize, 3),
    article_page: pageInfo(1, pageSize, 3),
    user_page: pageInfo(1, pageSize, 3),
  };
}

function makeDynamic(index: number) {
  const video = demoVideos[index % demoVideos.length];
  return {
    id: `demo-dynamic-${index}`,
    author_mid: video.owner.mid,
    author_name: video.owner.name,
    author_face: DEMO_AVATAR,
    kind: "video",
    type_label: "投稿了视频",
    action_text: "投稿了视频",
    text: `这是第 ${index + 1} 条本地演示动态。`,
    content_text: "公开预览不会访问真实账号或网络服务。",
    topic_name: "BiliBox Demo",
    pub_ts: now - index * 1800,
    major_title: video.title,
    major_cover: DEMO_COVER,
    major_url: "#",
    bvid: video.bvid,
    aid: video.aid,
    images: [],
    comment_oid: String(video.aid),
    comment_type: 1,
    duration_text: `${Math.floor(video.duration / 60)}:${String(video.duration % 60).padStart(2, "0")}`,
    view_count: video.stat.view,
    danmaku_count: video.stat.danmaku,
    repost_count: 8 + index,
    comment_count: video.stat.reply,
    like_count: video.stat.like,
  };
}

function makeComment(index: number) {
  return {
    rpid: 900000 + index,
    root: 0,
    parent: 0,
    dialog: 0,
    message: `这是第 ${index} 条本地演示评论。`,
    ctime: now - index * 300,
    like: index * 7,
    reply_count: index % 3,
    member: {
      mid: 11000 + index,
      name: `演示用户 ${index}`,
      avatar: DEMO_AVATAR,
      level: 5,
    },
  };
}

function makeBangumi() {
  return {
    season_id: 40001,
    title: "BiliBox 演示番剧",
    cover: DEMO_COVER,
    evaluate: "用于预览番剧详情和剧集列表的本地数据。",
    episodes: demoVideos.slice(0, 3).map((video, index) => ({
      ep_id: 50001 + index,
      aid: video.aid,
      bvid: video.bvid,
      cid: video.cid,
      title: String(index + 1),
      long_title: `第 ${index + 1} 话 · 界面演示`,
      cover: DEMO_COVER,
      duration: video.duration,
    })),
    up_info: { mid: 10001, name: "BiliBox Demo", avatar: DEMO_AVATAR },
  };
}

function createDemoTask(args: Record<string, unknown>) {
  taskSequence += 1;
  const params = (args.params || args) as Record<string, unknown>;
  const taskId = `demo-task-${taskSequence}`;
  downloadTasks = [{
    task_id: taskId,
    bvid: String(params.bvid || demoVideos[0].bvid),
    cid: Number(params.cid || demoVideos[0].cid),
    title: String(params.title || params.episode_title || `本地演示下载 ${taskSequence}`),
    cover: DEMO_COVER,
    state: "Completed",
    stage: "completed",
    progress: 100,
    total_size: 32 * 1024 * 1024,
    downloaded_size: 32 * 1024 * 1024,
    speed: 0,
    quality: String(params.download_quality || "1080p"),
    output_path: `/demo/${taskId}.mp4`,
    created_at: Date.now(),
    media_kind: params.media_kind || "video",
  }, ...downloadTasks].slice(0, 20);
  return taskId;
}

function accountResult() {
  return { config: clone(config), user_info: clone(demoUser) };
}

export async function listen<T>(event: string, handler: EventHandler<T>): Promise<UnlistenFn> {
  const handlers = listeners.get(event) ?? new Set<EventHandler<unknown>>();
  handlers.add(handler as EventHandler<unknown>);
  listeners.set(event, handlers);
  return () => handlers.delete(handler as EventHandler<unknown>);
}

function updateTaskStates(taskIds: unknown, state: string, stage: string) {
  const ids = new Set(Array.isArray(taskIds) ? taskIds.map(String) : []);
  downloadTasks = downloadTasks.map((task) =>
    ids.has(String(task.task_id)) ? { ...task, state, stage } : task
  );
}

/** Local mock replacement for the native IPC invoke function. */
export async function invoke<T>(
  cmd: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  let result: unknown;

  switch (cmd) {
    case "get_config":
      result = clone(config);
      break;
    case "save_config":
      config = { ...config, ...((args.newConfig || {}) as Partial<Config>) };
      result = null;
      break;
    case "reset_config":
      config = { ...defaultConfig };
      result = clone(config);
      break;
    case "select_directory":
      result = "Demo Downloads";
      break;
    case "get_saved_user_info":
    case "get_user_info":
      result = clone(demoUser);
      break;
    case "list_saved_accounts":
      result = [{
        profile: "demo",
        username: demoUser.uname,
        mid: demoUser.mid,
        face: demoUser.face,
        active: true,
      }];
      break;
    case "save_login_session":
    case "switch_account_profile":
    case "delete_saved_account_data":
      result = accountResult();
      break;
    case "clear_user_info":
      result = null;
      break;
    case "get_recommended_videos":
    case "get_region_videos": {
      const pageSize = Number(args.pageSize || 18);
      const page = Number(args.page || args.freshIndex || 1);
      const start = ((Math.max(1, page) - 1) * pageSize) % demoVideos.length;
      result = clone([...demoVideos, ...demoVideos].slice(start, start + pageSize));
      break;
    }
    case "get_following_dynamics": {
      const start = Number(args.offset || 0);
      const list = Array.from({ length: 12 }, (_, index) => makeDynamic(start + index));
      result = { list, offset: String(start + list.length), has_more: start < 24 };
      break;
    }
    case "search_video":
    case "search_video_web":
      result = makeAggregateSearch(args);
      break;
    case "get_normal_info": {
      const bvid = String(args.bvid || "");
      result = clone(demoVideos.find((video) => video.bvid === bvid) || demoVideos[0]);
      break;
    }
    case "get_play_proxy_url":
      result = { url: DEMO_VIDEO, quality: Number(args.quality || 80), accept_quality: [80, 64, 32], dash: null };
      break;
    case "get_downloaded_play_url":
      result = DEMO_VIDEO;
      break;
    case "get_normal_url":
      result = { video_list: [{ id: 80 }, { id: 64 }, { id: 32 }, { id: 16 }] };
      break;
    case "get_video_interaction_state":
      result = { liked: false, coined: 0, favorited: false };
      break;
    case "set_video_like":
    case "add_video_coin":
    case "set_video_favorite":
      result = { success: true, message: "演示状态已更新" };
      break;
    case "get_video_favorite_folders":
      result = [{ id: 1, title: "演示收藏夹", media_count: 6, favorited: false }];
      break;
    case "get_fav_folders":
      result = {
        count: 2,
        list: [
          { id: 1, title: "稍后细看", cover: DEMO_COVER, media_count: 8 },
          { id: 2, title: "界面参考", cover: DEMO_COVER, media_count: 6 },
        ],
      };
      break;
    case "get_fav_info": {
      const folderId = Number(args.mediaId || 1);
      result = {
        info: { id: folderId, title: folderId === 1 ? "稍后细看" : "界面参考", cover: DEMO_COVER, media_count: 12 },
        medias: demoVideos.slice(0, 12).map((video) => ({
          id: video.aid,
          bvid: video.bvid,
          cid: video.cid,
          title: video.title,
          cover: video.pic,
          duration: video.duration,
          upper: { mid: video.owner.mid, name: video.owner.name, face: video.owner.face },
        })),
        has_more: false,
      };
      break;
    }
    case "get_liked_videos": {
      const page = Number(args.page || 1);
      const pageSize = Number(args.pageSize || 18);
      const start = (page - 1) * pageSize;
      result = {
        list: demoVideos.slice(start, start + pageSize).map((video) => ({
          aid: video.aid,
          bvid: video.bvid,
          cid: video.cid,
          title: video.title,
          cover: video.pic,
          duration: video.duration,
          pubdate: video.pubdate,
          play: video.stat.view,
          like: video.stat.like,
          upper: { mid: video.owner.mid, name: video.owner.name, face: video.owner.face },
        })),
        total: demoVideos.length,
        page,
        page_size: pageSize,
        has_more: start + pageSize < demoVideos.length,
      };
      break;
    }
    case "get_history_info": {
      const params = (args.params || {}) as Record<string, unknown>;
      const page = Number(params.page || 1);
      const pageSize = Number(params.page_size || 20);
      result = {
        list: demoVideos.slice(0, pageSize).map((video, index) => ({
          bvid: video.bvid,
          cid: video.cid,
          business: "archive",
          ep_id: null,
          title: video.title,
          cover: video.pic,
          duration: video.duration,
          progress: index % 4 === 0 ? -1 : Math.floor(video.duration * 0.62),
          view_at: now - index * 2400,
          author: { mid: video.owner.mid, name: video.owner.name, face: video.owner.face },
        })),
        page: { pn: page, total: demoVideos.length },
      };
      break;
    }
    case "get_watch_later_info":
      result = {
        count: demoVideos.length,
        list: demoVideos.map((video, index) => ({
          aid: video.aid,
          bvid: video.bvid,
          cid: video.cid,
          title: video.title,
          pic: video.pic,
          duration: video.duration,
          owner: clone(video.owner),
          add_at: now - index * 3600,
        })),
      };
      break;
    case "get_bangumi_info":
      result = makeBangumi();
      break;
    case "get_bangumi_follow_info":
      result = {
        list: [makeBangumi(), { ...makeBangumi(), season_id: 40002, title: "第二部演示番剧" }].map((item) => ({
          season_id: item.season_id,
          title: item.title,
          cover: item.cover,
          evaluate: item.evaluate,
          total_count: item.episodes.length,
          new_ep: {
            id: item.episodes[item.episodes.length - 1]?.ep_id || 0,
            title: String(item.episodes.length),
            long_title: item.episodes[item.episodes.length - 1]?.long_title || "",
            cover: item.cover,
          },
        })),
        total: 2,
      };
      break;
    case "get_up_profile":
      result = {
        mid: Number(args.mid || demoUser.mid),
        name: "BiliBox Demo",
        face: DEMO_AVATAR,
        sign: "本地演示账号，不连接真实平台。",
        level: 6,
        following: 128,
        follower: 52000,
        archive_count: demoVideos.length,
      };
      break;
    case "get_up_videos": {
      const page = Number(args.page || 1);
      const pageSize = Number(args.pageSize || 30);
      const start = (page - 1) * pageSize;
      result = {
        list: demoVideos.slice(start, start + pageSize).map((video) => ({
          aid: video.aid,
          bvid: video.bvid,
          title: video.title,
          cover: video.pic,
          duration: `${Math.floor(video.duration / 60)}:${String(video.duration % 60).padStart(2, "0")}`,
          pubdate: video.pubdate,
          play: video.stat.view,
          danmaku: video.stat.danmaku,
          reply: video.stat.reply,
          favorite: video.stat.favorite,
        })),
        total: demoVideos.length,
        page,
        page_size: pageSize,
        has_more: start + pageSize < demoVideos.length,
      };
      break;
    }
    case "get_up_dynamics":
      result = { list: Array.from({ length: 8 }, (_, index) => makeDynamic(index)), offset: "", has_more: false };
      break;
    case "get_comments":
    case "get_comment_replies": {
      const page = Number(args.page || 1);
      const pageSize = Number(args.pageSize || 10);
      const list = Array.from({ length: cmd === "get_comments" ? 7 : 2 }, (_, index) => makeComment(index + 1));
      result = { list, page, page_size: pageSize, total: list.length, has_more: false };
      break;
    }
    case "add_comment_reply":
      result = { ...makeComment(Date.now() % 10000), message: String(args.message || "演示回复") };
      break;
    case "delete_comment":
    case "block_user":
    case "unblock_user":
    case "report_comment":
      result = null;
      break;
    case "get_article_detail":
      result = {
        id: Number(args.articleId || 70001),
        title: "BiliBox 专栏界面演示",
        summary: "本地专栏摘要",
        content_text: "这是本地 Mock 专栏内容。",
        images: [{ url: DEMO_COVER, title: "演示配图" }],
        content_blocks: [
          { kind: "text", text: "这是本地 Mock 专栏内容，用于验证文字与图片的混排效果。", url: "", title: "" },
          { kind: "image", text: "", url: DEMO_COVER, title: "演示配图" },
          { kind: "text", text: "公开预览不会请求真实文章内容。", url: "", title: "" },
        ],
        collection: { id: 71001, title: "演示文集", count_text: "共 3 篇", cover: DEMO_COVER },
        banner_url: DEMO_COVER,
        author_mid: demoUser.mid,
        author_name: demoUser.uname,
        author_face: DEMO_AVATAR,
      };
      break;
    case "get_article_collection":
      result = {
        id: Number(args.collectionId || 71001),
        title: "演示文集",
        count_text: "共 3 篇",
        cover: DEMO_COVER,
        articles: Array.from({ length: 3 }, (_, index) => ({
          id: 70001 + index,
          title: `本地专栏演示 ${index + 1}`,
          summary: "本地演示摘要",
          cover: DEMO_COVER,
          pubdate: now - index * 86400,
          author_mid: demoUser.mid,
          author_name: demoUser.uname,
        })),
      };
      break;
    case "get_live_play_info":
      result = {
        room_id: Number(args.roomId || 80001),
        title: "BiliBox 直播界面演示",
        url: null,
        cover: DEMO_COVER,
        quality: 10000,
        accept_quality: [10000, 400, 250],
      };
      break;
    case "create_download_task": {
      const params = Array.isArray(args.params) ? args.params : [args.params || args];
      result = params.map((item) => createDemoTask(item as Record<string, unknown>));
      break;
    }
    case "create_article_download_task":
      result = [createDemoTask({ title: "本地专栏演示", media_kind: "article" })];
      break;
    case "get_download_tasks":
      result = clone(downloadTasks);
      break;
    case "get_download_task_count":
      result = downloadTasks.length;
      break;
    case "pause_download_tasks":
      updateTaskStates(args.taskIds, "Paused", "paused");
      result = null;
      break;
    case "resume_download_tasks":
    case "restart_download_tasks":
      updateTaskStates(args.taskIds, "Completed", "completed");
      result = null;
      break;
    case "delete_download_tasks": {
      const ids = new Set(Array.isArray(args.taskIds) ? args.taskIds.map(String) : []);
      downloadTasks = downloadTasks.filter((task) => !ids.has(String(task.task_id)));
      result = null;
      break;
    }
    case "get_page_cache":
      result = pageCache.get(String(args.key)) ?? null;
      break;
    case "save_page_cache":
      pageCache.set(String(args.key), clone(args.value));
      result = null;
      break;
    case "clear_page_cache":
      pageCache.clear();
      result = {
        page_cache: { label: "页面缓存", path: "memory://page-cache", file_count: 0, total_bytes: 0 },
        download_cache: { label: "下载缓存", path: "memory://download-cache", file_count: downloadTasks.length, total_bytes: 0 },
      };
      break;
    case "clear_download_cache":
      downloadTasks = [];
      result = {
        page_cache: { label: "页面缓存", path: "memory://page-cache", file_count: pageCache.size, total_bytes: 0 },
        download_cache: { label: "下载缓存", path: "memory://download-cache", file_count: 0, total_bytes: 0 },
      };
      break;
    case "get_cache_overview":
      result = {
        page_cache: { label: "页面缓存", path: "memory://page-cache", file_count: pageCache.size, total_bytes: 0 },
        download_cache: { label: "下载缓存", path: "memory://download-cache", file_count: downloadTasks.length, total_bytes: 0 },
      };
      break;
    case "check_update":
      result = {
        current_version: "public-demo",
        latest_version: "public-demo",
        update_available: false,
        release_name: "BiliBox Demo",
        release_url: "https://github.com/RoamerFly/Bilibili_Box/releases/latest",
        body: "本地演示环境不执行自动更新。",
        asset: null,
      };
      break;
    case "download_and_install_update":
    case "open_download_folder":
    case "open_download_task_folder":
    case "window_start_dragging":
    case "window_toggle_maximize":
    case "window_minimize":
    case "window_close":
      result = null;
      break;
    case "open_external_url":
      if (typeof args.url === "string") {
        window.open(args.url, "_blank", "noopener,noreferrer");
      }
      result = null;
      break;
    default:
      console.info(`[Demo bridge] ${cmd} is a no-op in the browser preview.`);
      result = null;
  }

  return clone(result) as T;
}

/** Invoke helper that toggles a caller-provided loading state. */
export async function invokeWithLoading<T>(
  cmd: string,
  args?: Record<string, unknown>,
  options?: { onLoading?: (value: boolean) => void }
): Promise<T> {
  options?.onLoading?.(true);
  try {
    return await invoke<T>(cmd, args);
  } finally {
    options?.onLoading?.(false);
  }
}
