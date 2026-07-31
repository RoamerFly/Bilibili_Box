import { cloneElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Download,
  ExternalLink,
  Loader2,
  Maximize,
  Minimize,
  Music2,
  Pause,
  PictureInPicture2,
  Play,
  RefreshCw,
  Share2,
  Star,
  ThumbsUp,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { MediaPlayerClass } from "dashjs";
import { motion } from "framer-motion";
import { useDownloadQualityPrompt } from "@/components/download-quality-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CommentsSection } from "@/components/comments-section";
import { invoke } from "@/lib/api";
import { showNotice } from "@/lib/coming-soon";
import { notifyDownloadQueued } from "@/lib/download-feedback";
import { openExternalUrl } from "@/lib/open-external";
import type { BangumiInfo, VideoActionResult, VideoFavoriteFolder, VideoInfo, VideoInteractionState } from "@/lib/types";
import { formatBiliImageUrl, formatDuration, formatNumber } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { ClickableAvatar } from "@/components/video-card";
import coin22Img from "@/assets/22-coin-ani.png";
import coin33Img from "@/assets/33-coin-ani.png";
interface EpisodeOption {
  label: string;
  title: string;
  aid?: number;
  bvid: string;
  cid: number;
  epId?: number;
  localTaskId?: string;
}

interface PlayableUrlInfo {
  url?: string | null;
  quality: number;
  accept_quality: number[];
  dash?: DashPlaybackInfo | null;
}

interface DashPlaybackInfo {
  duration_seconds: number;
  min_buffer_time: number;
  video: DashStreamInfo;
  audio?: DashStreamInfo | null;
}

interface DashStreamInfo {
  url: string;
  id: number;
  bandwidth: number;
  mime_type: string;
  codecs: string;
  width?: number | null;
  height?: number | null;
  frame_rate?: string | null;
  segment_base?: {
    initialization: string;
    index_range: string;
  } | null;
}

interface ActionNoticeState {
  id: number;
  message: string;
  left: number;
  top: number;
}

const PLAYBACK_QUALITY_LABELS: Record<number, string> = {
  127: "8K",
  126: "杜比视界",
  125: "HDR",
  120: "4K",
  116: "1080P60",
  112: "1080P+",
  100: "智能修复",
  80: "1080P",
  74: "720P60",
  64: "720P",
  32: "480P",
  16: "360P",
  6: "240P",
};

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function PlayerView() {
  const playerState = useAppStore((s) => s.playerState);
  const closePlayer = useAppStore((s) => s.closePlayer);
  const openUpProfile = useAppStore((s) => s.openUpProfile);
  const showComments = useAppStore((s) => s.config?.show_comments !== false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [playUrl, setPlayUrl] = useState("");
  const [dashPlayback, setDashPlayback] = useState<DashPlaybackInfo | null>(null);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [interactionState, setInteractionState] = useState<VideoInteractionState | null>(null);
  const [interactionLoading, setInteractionLoading] = useState(false);
  const [favoriteDialogOpen, setFavoriteDialogOpen] = useState(false);
  const [coinDialogOpen, setCoinDialogOpen] = useState(false);
  const [favoriteFolders, setFavoriteFolders] = useState<VideoFavoriteFolder[]>([]);
  const [favoriteSelection, setFavoriteSelection] = useState<Set<number>>(new Set());
  const [favoriteInitialSelection, setFavoriteInitialSelection] = useState<Set<number>>(new Set());
  const [favoriteFoldersLoading, setFavoriteFoldersLoading] = useState(false);
  const [actionNotice, setActionNotice] = useState<ActionNoticeState | null>(null);
  const [commentRefreshKey, setCommentRefreshKey] = useState(0);
  const [bangumiInfo, setBangumiInfo] = useState<BangumiInfo | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeOption[]>([]);
  const [selectedEpisode, setSelectedEpisode] = useState<EpisodeOption | null>(null);
  const [downloadingEpisodeKey, setDownloadingEpisodeKey] = useState("");
  const [downloadingAllEpisodes, setDownloadingAllEpisodes] = useState(false);
  const [playbackQuality, setPlaybackQuality] = useState(80);
  const [availableQualities, setAvailableQualities] = useState<number[]>([80]);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [volumeControlOpen, setVolumeControlOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPictureInPicture, setIsPictureInPicture] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const volumeControlRef = useRef<HTMLDivElement | null>(null);
  const controlHideTimerRef = useRef<number | null>(null);
  const resumePlaybackRef = useRef<{ time: number; playing: boolean } | null>(null);
  const dashPlayerRef = useRef<MediaPlayerClass | null>(null);
  const actionNoticeTimerRef = useRef<number | null>(null);
  const coinActionRectRef = useRef<DOMRect | null>(null);
  const favoriteActionRectRef = useRef<DOMRect | null>(null);
  const { requestDownloadQuality, downloadQualityDialog } = useDownloadQualityPrompt();

  const playbackHint =
    "当前内容没有返回可播放的媒体流，可能受登录、会员权限或内容版权限制。";

  const loadPlayableUrl = useCallback(async (bvid: string, cid: number, requestedQuality = 80) => {
    const sourceInfo = await invoke<PlayableUrlInfo>("get_play_proxy_url", {
      bvid,
      cid,
      quality: requestedQuality,
    });
    const selectedQuality = sourceInfo.quality || requestedQuality;
    const qualityOptions = Array.from(new Set([selectedQuality, ...sourceInfo.accept_quality])).sort((left, right) => right - left);
    setPlaybackQuality(selectedQuality);
    setAvailableQualities(qualityOptions.length ? qualityOptions : [selectedQuality]);
    setDashPlayback(sourceInfo.dash ?? null);
    return sourceInfo.url ?? "";
  }, []);

  const loadVideoPlayer = useCallback(async () => {
    if (!playerState?.bvid) {
      throw new Error("缺少视频标识");
    }

    const localPlayUrl = playerState.localTaskId
      ? await invoke<string>("get_downloaded_play_url", { taskId: playerState.localTaskId }).catch(() => "")
      : "";
    if (localPlayUrl) {
      setAvailableQualities([]);
      setDashPlayback(null);
      setPlayUrl(localPlayUrl);
    }
    let info: VideoInfo;
    try {
      info = await invoke<VideoInfo>("get_normal_info", { bvid: playerState.bvid });
    } catch (err) {
      if (!localPlayUrl) throw err;
      const fallbackEpisode = {
        label: "本地文件",
        title: playerState.title,
        bvid: playerState.bvid,
        cid: playerState.cid ?? 0,
        localTaskId: playerState.localTaskId,
      };
      setVideoInfo(null);
      setBangumiInfo(null);
      setEpisodes([fallbackEpisode]);
      setSelectedEpisode(fallbackEpisode);
      setAvailableQualities([]);
      setDashPlayback(null);
      setPlayUrl(localPlayUrl);
      return;
    }
    setVideoInfo(info);
    setBangumiInfo(null);

    const nextEpisodes =
      info.pages?.length > 0
        ? info.pages.map((page, index) => ({
            label: `P${page.page || index + 1}`,
            title: page.part || info.title,
            bvid: info.bvid,
            cid: page.cid,
            localTaskId: page.cid === playerState.cid ? playerState.localTaskId : undefined,
          }))
        : [
            {
              label: "正片",
              title: info.title,
              bvid: info.bvid,
              cid: playerState.cid ?? info.cid,
              localTaskId: playerState.localTaskId,
            },
          ];

    setEpisodes(nextEpisodes);
    const nextSelected = nextEpisodes.find((episode) => episode.cid === (playerState.cid ?? info.cid)) ?? nextEpisodes[0] ?? null;
    setSelectedEpisode(nextSelected);
    if (localPlayUrl) {
      setAvailableQualities([]);
      setDashPlayback(null);
      setPlayUrl(localPlayUrl);
    } else {
      setPlayUrl(nextSelected ? await loadPlayableUrl(nextSelected.bvid, nextSelected.cid) : "");
    }
  }, [loadPlayableUrl, playerState]);

  const loadBangumiPlayer = useCallback(async () => {
    if (!playerState?.seasonId && !playerState?.epId) {
      throw new Error("缺少番剧标识");
    }

    const info = await invoke<BangumiInfo>("get_bangumi_info", {
      seasonId: playerState.seasonId,
      epId: playerState.epId,
    });
    setBangumiInfo(info);
    setVideoInfo(null);

    const nextEpisodes = info.episodes.map((episode, index) => ({
      label: `EP${index + 1}`,
      title: episode.long_title || episode.title,
      aid: episode.aid,
      bvid: episode.bvid,
      cid: episode.cid,
      epId: episode.ep_id,
    }));
    setEpisodes(nextEpisodes);
    const nextSelected = nextEpisodes.find((episode) => episode.epId === playerState.epId) ?? nextEpisodes[0] ?? null;
    setSelectedEpisode(nextSelected);
    setPlayUrl(nextSelected ? await loadPlayableUrl(nextSelected.bvid, nextSelected.cid) : "");
  }, [loadPlayableUrl, playerState]);

  const refresh = useCallback(async () => {
    if (!playerState) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      if (playerState.kind === "video") {
        await loadVideoPlayer();
      } else {
        await loadBangumiPlayer();
      }
      setCommentRefreshKey((key) => key + 1);
    } catch (err) {
      setError(String(err));
      setDashPlayback(null);
      setPlayUrl("");
    } finally {
      setLoading(false);
    }
  }, [loadBangumiPlayer, loadVideoPlayer, playerState]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !dashPlayback || loading) return;

    const manifestUrl = URL.createObjectURL(
      new Blob([buildDashManifest(dashPlayback)], { type: "application/dash+xml" })
    );
    let disposed = false;
    let dashPlayer: MediaPlayerClass | null = null;
    void import("dashjs")
      .then((dashjs) => {
        if (disposed) return;
        dashPlayer = dashjs.MediaPlayer().create();
        dashPlayerRef.current = dashPlayer;
        dashPlayer.on(dashjs.MediaPlayer.events.ERROR, () => {
          setError("DASH 媒体流加载失败，请刷新或选择其他清晰度重试。");
        });
        dashPlayer.initialize(video, manifestUrl, resumePlaybackRef.current?.playing ?? true);
      })
      .catch(() => {
        if (!disposed) {
          setError("播放器组件加载失败，请刷新后重试。");
        }
      });

    return () => {
      disposed = true;
      dashPlayer?.reset();
      if (dashPlayerRef.current === dashPlayer) {
        dashPlayerRef.current = null;
      }
      URL.revokeObjectURL(manifestUrl);
    };
  }, [dashPlayback, loading]);

  useEffect(() => {
    return () => {
      if (controlHideTimerRef.current !== null) {
        window.clearTimeout(controlHideTimerRef.current);
      }
    };
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (controlHideTimerRef.current !== null) {
      window.clearTimeout(controlHideTimerRef.current);
    }
    if (isPlaying) {
      controlHideTimerRef.current = window.setTimeout(() => setControlsVisible(false), 2600);
    }
  }, [isPlaying]);

  useEffect(() => {
    revealControls();
  }, [revealControls]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === playerContainerRef.current);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || loading) return;
    const handleEnterPictureInPicture = () => setIsPictureInPicture(true);
    const handleLeavePictureInPicture = () => setIsPictureInPicture(false);
    video.addEventListener("enterpictureinpicture", handleEnterPictureInPicture);
    video.addEventListener("leavepictureinpicture", handleLeavePictureInPicture);
    return () => {
      video.removeEventListener("enterpictureinpicture", handleEnterPictureInPicture);
      video.removeEventListener("leavepictureinpicture", handleLeavePictureInPicture);
    };
  }, [dashPlayback, loading, playUrl]);

  useEffect(() => {
    if (!volumeControlOpen) return;
    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (!volumeControlRef.current?.contains(event.target as Node)) {
        setVolumeControlOpen(false);
      }
    };
    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown);
  }, [volumeControlOpen]);

  const currentTitle = useMemo(() => {
    if (playerState?.kind === "bangumi") {
      return bangumiInfo?.title || playerState?.title || "播放器";
    }
    return videoInfo?.title || playerState?.title || "播放器";
  }, [bangumiInfo?.title, playerState, videoInfo?.title]);

  const currentEpisodeTitle = selectedEpisode?.title || playerState?.title || currentTitle;
  const cover = bangumiInfo?.cover || videoInfo?.pic || playerState?.cover || "";
  const commentOid = videoInfo?.aid || selectedEpisode?.aid || null;
  const commentType = commentOid ? 1 : null;
  const browserUrl = useMemo(() => {
    if (!playerState) return "";
    if (playerState.kind === "bangumi") {
      if (playerState.seasonId) {
        return `https://www.bilibili.com/bangumi/play/ss${playerState.seasonId}`;
      }
      if (playerState.epId) {
        return `https://www.bilibili.com/bangumi/play/ep${playerState.epId}`;
      }
    }
    if (playerState.bvid) {
      return `https://www.bilibili.com/video/${playerState.bvid}`;
    }
    return "";
  }, [playerState]);

  useEffect(() => {
    setInteractionState(null);
    if (!videoInfo?.aid || !videoInfo.bvid) return;
    let disposed = false;
    void invoke<VideoInteractionState>("get_video_interaction_state", {
      aid: videoInfo.aid,
      bvid: videoInfo.bvid,
    })
      .then((state) => {
        if (!disposed) setInteractionState(state);
      })
      .catch(() => {
        if (!disposed) setInteractionState(null);
      });
    return () => {
      disposed = true;
    };
  }, [videoInfo?.aid, videoInfo?.bvid]);

  useEffect(() => {
    return () => {
      if (actionNoticeTimerRef.current !== null) {
        window.clearTimeout(actionNoticeTimerRef.current);
      }
    };
  }, []);

  const showActionNotice = useCallback((message: string, rect?: DOMRect | null) => {
    if (!rect) {
      showNotice(message);
      return;
    }
    if (actionNoticeTimerRef.current !== null) {
      window.clearTimeout(actionNoticeTimerRef.current);
    }
    setActionNotice({
      id: Date.now(),
      message,
      left: rect.left + rect.width / 2,
      top: rect.top,
    });
    actionNoticeTimerRef.current = window.setTimeout(() => {
      setActionNotice(null);
      actionNoticeTimerRef.current = null;
    }, 1500);
  }, []);

  const mutateVideoStats = (patch: Partial<VideoInfo["stat"]>) => {
    setVideoInfo((info) => {
      if (!info) return info;
      return { ...info, stat: { ...info.stat, ...patch } };
    });
  };

  const handleLikeVideo = async (target?: HTMLElement) => {
    if (!videoInfo || interactionLoading) return;
    const nextLiked = !interactionState?.liked;
    const targetRect = target?.getBoundingClientRect() ?? null;
    setInteractionLoading(true);
    try {
      const result = await invoke<VideoActionResult>("set_video_like", {
        aid: videoInfo.aid,
        bvid: videoInfo.bvid,
        liked: nextLiked,
      });
      setInteractionState((state) => ({ ...(state ?? { coined: 0, favorited: false }), liked: nextLiked }));
      mutateVideoStats({ like: Math.max(0, videoInfo.stat.like + (nextLiked ? 1 : -1)) });
      showActionNotice(result.message || (nextLiked ? "点赞成功" : "已取消点赞"), targetRect);
    } catch (err) {
      setError(String(err));
    } finally {
      setInteractionLoading(false);
    }
  };

  const handleCoinVideo = (target?: HTMLElement) => {
    if (!videoInfo || interactionLoading) return;
    coinActionRectRef.current = target?.getBoundingClientRect() ?? null;
    if ((interactionState?.coined ?? 0) >= 2) {
      showNotice("该视频已投过2枚硬币");
      return;
    }
    setCoinDialogOpen(true);
  };

  const handleConfirmCoin = async (multiply: number) => {
    if (!videoInfo || interactionLoading) return;
    setCoinDialogOpen(false);
    setInteractionLoading(true);
    try {
      const result = await invoke<VideoActionResult>("add_video_coin", {
        aid: videoInfo.aid,
        bvid: videoInfo.bvid,
        multiply,
        selectLike: false,
      });
      setInteractionState((state) => ({
        ...(state ?? { liked: false, favorited: false }),
        coined: Math.min(2, (state?.coined ?? 0) + multiply),
      }));
      mutateVideoStats({ coin: videoInfo.stat.coin + multiply });
      showActionNotice(result.message || "投币成功", coinActionRectRef.current);
    } catch (err) {
      setError(String(err));
    } finally {
      setInteractionLoading(false);
    }
  };

  const handleToggleFavorite = async (target?: HTMLElement) => {
    if (!videoInfo || interactionLoading) return;
    favoriteActionRectRef.current = target?.getBoundingClientRect() ?? null;
    if (!interactionState?.favorited) {
      await handleOpenFavoriteDialog();
      return;
    }

    setInteractionLoading(true);
    try {
      const folders = await invoke<VideoFavoriteFolder[]>("get_video_favorite_folders", {
        aid: videoInfo.aid,
      });
      const selectedIds = folders.filter((folder) => folder.favorited).map((folder) => folder.id);
      if (selectedIds.length === 0) {
        setInteractionState((state) => ({ ...(state ?? { liked: false, coined: 0 }), favorited: false }));
        showActionNotice("已取消收藏", favoriteActionRectRef.current);
        return;
      }
      const result = await invoke<VideoActionResult>("set_video_favorite", {
        aid: videoInfo.aid,
        addMediaIds: [],
        delMediaIds: selectedIds,
      });
      setFavoriteSelection(new Set());
      setFavoriteInitialSelection(new Set());
      setInteractionState((state) => ({ ...(state ?? { liked: false, coined: 0 }), favorited: false }));
      mutateVideoStats({ favorite: Math.max(0, videoInfo.stat.favorite - 1) });
      showActionNotice(result.message || "已取消收藏", favoriteActionRectRef.current);
    } catch (err) {
      setError(String(err));
    } finally {
      setInteractionLoading(false);
    }
  };

  const handleOpenFavoriteDialog = async () => {
    if (!videoInfo) return;
    setFavoriteDialogOpen(true);
    setFavoriteFoldersLoading(true);
    try {
      const folders = await invoke<VideoFavoriteFolder[]>("get_video_favorite_folders", {
        aid: videoInfo.aid,
      });
      const selected = new Set(folders.filter((folder) => folder.favorited).map((folder) => folder.id));
      setFavoriteFolders(folders);
      setFavoriteSelection(selected);
      setFavoriteInitialSelection(new Set(selected));
    } catch (err) {
      setError(String(err));
      setFavoriteFolders([]);
      setFavoriteSelection(new Set());
      setFavoriteInitialSelection(new Set());
    } finally {
      setFavoriteFoldersLoading(false);
    }
  };

  const handleConfirmFavorite = async () => {
    if (!videoInfo || interactionLoading) return;
    const addMediaIds = [...favoriteSelection].filter((id) => !favoriteInitialSelection.has(id));
    const delMediaIds = [...favoriteInitialSelection].filter((id) => !favoriteSelection.has(id));
    setInteractionLoading(true);
    try {
      await invoke<VideoActionResult>("set_video_favorite", {
        aid: videoInfo.aid,
        addMediaIds,
        delMediaIds,
      });
      const nextFavorited = favoriteSelection.size > 0;
      const wasFavorited = interactionState?.favorited ?? favoriteInitialSelection.size > 0;
      setInteractionState((state) => ({ ...(state ?? { liked: false, coined: 0 }), favorited: nextFavorited }));
      if (nextFavorited !== wasFavorited) {
        mutateVideoStats({ favorite: Math.max(0, videoInfo.stat.favorite + (nextFavorited ? 1 : -1)) });
      }
      setFavoriteDialogOpen(false);
      showActionNotice(nextFavorited ? "收藏成功" : "已取消收藏", favoriteActionRectRef.current);
    } catch (err) {
      setError(String(err));
    } finally {
      setInteractionLoading(false);
    }
  };

  const handleShareVideo = async () => {
    if (!browserUrl) return;
    try {
      await copyText(browserUrl);
      showNotice("复制链接成功");
    } catch (err) {
      setError(String(err));
    }
  };

  const handleEpisodeChange = async (episode: EpisodeOption) => {
    setSelectedEpisode(episode);
    setLoading(true);
    setError("");
    try {
      if (episode.localTaskId) {
        setAvailableQualities([]);
        setDashPlayback(null);
        setPlayUrl(await invoke<string>("get_downloaded_play_url", { taskId: episode.localTaskId }));
      } else {
        setPlayUrl(await loadPlayableUrl(episode.bvid, episode.cid));
      }
    } catch (err) {
      setError(String(err));
      setDashPlayback(null);
      setPlayUrl("");
    } finally {
      setLoading(false);
    }
  };

  const handleEpisodeDownload = async (episode: EpisodeOption) => {
    const episodeKey = `${episode.bvid}-${episode.cid}`;
    if (downloadingEpisodeKey || downloadingAllEpisodes) return;
    setDownloadingEpisodeKey(episodeKey);
    try {
      const isBangumi = playerState?.kind === "bangumi";
      const downloadQuality = await requestDownloadQuality({
        bvid: episode.bvid,
        cid: episode.cid,
      });
      if (!downloadQuality) return;
      const taskIds = await invoke<string[]>("create_download_task", {
        params: {
          bvid: episode.bvid,
          cid: episode.cid,
          title:
            isBangumi
              ? `${currentTitle} - ${episode.title}`.trim()
              : currentTitle,
          cids: [episode.cid],
          collection_title: isBangumi ? currentTitle : undefined,
          episode_title: isBangumi ? episode.title : undefined,
          download_quality: downloadQuality,
        },
      });
      notifyDownloadQueued(taskIds, episode.title || currentTitle);
    } catch (err) {
      setError(String(err));
    } finally {
      setDownloadingEpisodeKey("");
    }
  };

  const handleDownload = async () => {
    if (!selectedEpisode) return;
    await handleEpisodeDownload(selectedEpisode);
  };

  const handleDownloadAll = async () => {
    if (!episodes.length || downloadingAllEpisodes || downloadingEpisodeKey) return;
    setDownloadingAllEpisodes(true);
    try {
      const downloadQuality = await requestDownloadQuality(
        episodes.map((episode) => ({ bvid: episode.bvid, cid: episode.cid }))
      );
      if (!downloadQuality) return;
      let taskIds: string[];
      const groupId = `player-all:${playerState?.kind ?? "video"}:${Date.now()}`;
      if (playerState?.kind === "video") {
        taskIds = await invoke<string[]>("create_download_task", {
          params: {
            bvid: episodes[0].bvid,
            cid: episodes[0].cid,
            title: currentTitle,
            cids: episodes.map((episode) => episode.cid),
            download_quality: downloadQuality,
            group_id: groupId,
            group_title: `${currentTitle} 全部分P`,
            group_total: episodes.length,
          },
        });
      } else {
        const taskGroups = await Promise.all(
          episodes.map((episode) =>
            invoke<string[]>("create_download_task", {
              params: {
                bvid: episode.bvid,
                cid: episode.cid,
                title: `${currentTitle} - ${episode.title}`.trim(),
                cids: [episode.cid],
                collection_title: currentTitle,
                episode_title: episode.title,
                download_quality: downloadQuality,
                group_id: groupId,
                group_title: `${currentTitle} 全部剧集`,
                group_total: episodes.length,
              },
            })
          )
        );
        taskIds = taskGroups.flat();
      }
      notifyDownloadQueued(taskIds, currentTitle);
    } catch (err) {
      setError(String(err));
    } finally {
      setDownloadingAllEpisodes(false);
    }
  };

  const handleAudioDownload = async () => {
    if (!selectedEpisode) return;
    try {
      const isBangumi = playerState?.kind === "bangumi";
      const title =
        isBangumi
          ? `${currentTitle} - ${selectedEpisode.title}`.trim()
          : currentTitle;
      const taskIds = await invoke<string[]>("create_download_task", {
        params: {
          bvid: selectedEpisode.bvid,
          cid: selectedEpisode.cid,
          title,
          cids: [selectedEpisode.cid],
          collection_title: isBangumi ? currentTitle : undefined,
          episode_title: isBangumi ? selectedEpisode.title : undefined,
          audio_only: true,
        },
      });
      notifyDownloadQueued(taskIds, title, { mediaKind: "audio", quality: "音频", format: "MP3" });
    } catch (err) {
      setError(String(err));
    }
  };

  const handlePlaybackQualityChange = async (nextQuality: number) => {
    if (!selectedEpisode || selectedEpisode.localTaskId || nextQuality === playbackQuality) return;
    const activeVideo = videoRef.current;
    resumePlaybackRef.current = {
      time: activeVideo?.currentTime ?? 0,
      playing: Boolean(activeVideo && !activeVideo.paused),
    };
    setLoading(true);
    setError("");
    try {
      setPlayUrl(await loadPlayableUrl(selectedEpisode.bvid, selectedEpisode.cid, nextQuality));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
    revealControls();
  };

  const handleSeek = (time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = time;
    setCurrentTime(time);
  };

  const handleVolumeChange = (nextVolume: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = nextVolume;
    video.muted = nextVolume === 0;
    setVolume(nextVolume);
    setIsMuted(nextVolume === 0);
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  const handlePlaybackRateChange = (rate: number) => {
    const video = videoRef.current;
    if (video) video.playbackRate = rate;
    setPlaybackRate(rate);
  };

  const handlePictureInPicture = async () => {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const handleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await playerContainerRef.current?.requestFullscreen();
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const hasPlayableSource = Boolean(playUrl || dashPlayback);
  const canPictureInPicture = typeof document !== "undefined" && document.pictureInPictureEnabled;

  if (!playerState) {
    return (
      <div style={{ width: "100%", padding: "36px 44px 48px", minHeight: "100%" }}>
        <div style={{ paddingTop: "120px", textAlign: "center", color: "var(--color-text-muted)" }}>暂无播放内容</div>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", padding: "36px 44px 48px", minHeight: "100%" }}>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "14px",
          marginBottom: "20px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <HeaderButton onClick={closePlayer} icon={<ArrowLeft style={{ width: 15, height: 15 }} />}>
            返回
          </HeaderButton>
          <div>
            <h1 style={{ fontSize: "24px", fontWeight: 800, color: "var(--color-text)", lineHeight: 1.25 }}>
              通用播放页
            </h1>
            <p style={{ fontSize: "14px", color: "var(--color-text-muted)", marginTop: "4px" }}>{currentEpisodeTitle}</p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <HeaderButton onClick={() => void refresh()} icon={<RefreshCw style={{ width: 15, height: 15 }} />}>
            刷新
          </HeaderButton>
          <HeaderButton
            onClick={() => browserUrl && void openExternalUrl(browserUrl).catch((err) => setError(String(err)))}
            icon={<ExternalLink style={{ width: 15, height: 15 }} />}
          >
            浏览器打开
          </HeaderButton>
        </div>
      </motion.div>

      {error ? <div style={errorStyle}>{error}</div> : null}

      {!hasPlayableSource && !loading ? (
        <div style={warningStyle}>
          <div style={{ fontWeight: 700, marginBottom: "6px" }}>为什么现在还播不起来</div>
          <div>{playbackHint}</div>
          <div style={{ marginTop: "8px" }}>
            播放器已支持 DASH 音视频同步及直链回退，可尝试登录后刷新，或在浏览器中确认该内容的观看权限。
          </div>
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 320px",
          gap: "22px",
          alignItems: "start",
        }}
      >
        <div style={panelStyle}>
          <div style={{ padding: "0 0 14px" }}>
            <h2 style={{ fontSize: "17px", fontWeight: 700, color: "var(--color-text)", lineHeight: 1.45 }}>
              {currentTitle}
            </h2>
          </div>
          <div
            ref={playerContainerRef}
            onMouseMove={revealControls}
            onMouseLeave={() => isPlaying && setControlsVisible(false)}
            style={{
              width: "100%",
              height: isFullscreen ? "100%" : undefined,
              aspectRatio: isFullscreen ? undefined : "16 / 9",
              backgroundColor: "#0f172a",
              position: "relative",
              borderRadius: "12px",
              overflow: "hidden",
            }}
          >
            {loading ? (
              <div style={loadingOverlayStyle}>
                <Loader2 className="animate-spin" style={{ width: 28, height: 28 }} />
              </div>
            ) : hasPlayableSource ? (
              <video
                ref={videoRef}
                key={playUrl || dashPlayback?.video.url}
                autoPlay={resumePlaybackRef.current?.playing ?? true}
                playsInline
                poster={formatBiliImageUrl(cover, "@672w_378h_1c.webp")}
                src={playUrl || undefined}
                onClick={togglePlayback}
                onDoubleClick={() => void handleFullscreen()}
                onLoadedMetadata={(event) => {
                  const video = event.currentTarget;
                  setMediaDuration(video.duration || 0);
                  video.playbackRate = playbackRate;
                  video.volume = volume;
                  video.muted = isMuted;
                  if (resumePlaybackRef.current) {
                    video.currentTime = resumePlaybackRef.current.time;
                    if (resumePlaybackRef.current.playing) {
                      void video.play();
                    } else {
                      video.pause();
                    }
                    resumePlaybackRef.current = null;
                  }
                }}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onError={() => {
                  setError("媒体流已建立，但当前资源无法播放，请刷新或选择其他清晰度重试。");
                }}
                style={{ width: "100%", height: "100%", objectFit: "contain", backgroundColor: "#000" }}
              />
            ) : (
              <div style={emptyPlayerStyle}>
                <Play style={{ width: 32, height: 32, opacity: 0.7 }} />
                <div style={{ fontSize: "14px", opacity: 0.85 }}>当前没有拿到可直接播放的地址</div>
              </div>
            )}
            {hasPlayableSource ? (
              <div
                style={{
                  ...playerControlsStyle,
                  opacity: controlsVisible ? 1 : 0,
                  pointerEvents: controlsVisible ? "auto" : "none",
                }}
              >
                <input
                  aria-label="播放进度"
                  type="range"
                  min={0}
                  max={mediaDuration || 0}
                  step={0.1}
                  value={Math.min(currentTime, mediaDuration || 0)}
                  onChange={(event) => handleSeek(Number(event.target.value))}
                  style={{ width: "100%", accentColor: "#7c5cff" }}
                />
                <div style={playerToolbarStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <PlayerIconButton title={isPlaying ? "暂停" : "播放"} onClick={togglePlayback}>
                      {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                    </PlayerIconButton>
                    <div ref={volumeControlRef} style={{ position: "relative" }}>
                      <PlayerIconButton
                        title="音量调节"
                        onClick={() => {
                          setVolumeControlOpen((open) => !open);
                          revealControls();
                        }}
                      >
                        {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                      </PlayerIconButton>
                      {volumeControlOpen ? (
                        <div style={volumePopoverStyle}>
                          <input
                            aria-label="音量"
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={isMuted ? 0 : volume}
                            onChange={(event) => handleVolumeChange(Number(event.target.value))}
                            style={verticalVolumeSliderStyle}
                          />
                          <PlayerIconButton title={isMuted ? "取消静音" : "静音"} onClick={toggleMute}>
                            {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                          </PlayerIconButton>
                        </div>
                      ) : null}
                    </div>
                    <span style={{ fontSize: "12px", color: "#fff", fontVariantNumeric: "tabular-nums" }}>
                      {formatPlaybackTime(currentTime)} / {formatPlaybackTime(mediaDuration)}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "auto" }}>
                    <PlayerIconButton title="下载视频" onClick={() => void handleDownload()}>
                      <Download size={18} />
                    </PlayerIconButton>
                    <PlayerIconButton title="下载音频为 MP3" onClick={() => void handleAudioDownload()}>
                      <Music2 size={18} />
                    </PlayerIconButton>
                    <Select
                      value={String(playbackQuality)}
                      onValueChange={(val) => void handlePlaybackQualityChange(Number(val))}
                      disabled={!availableQualities.length}
                    >
                      <SelectTrigger style={playerSelectStyle} className="min-w-[80px] border-white/30 bg-black/40 text-white h-[30px] rounded-[7px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent side="top" className="z-[1050] max-h-[320px] overflow-y-auto">
                        {availableQualities.length ? availableQualities.map((quality) => (
                          <SelectItem key={quality} value={String(quality)}>
                            {PLAYBACK_QUALITY_LABELS[quality] || `${quality}P`}
                          </SelectItem>
                        )) : <SelectItem value={String(playbackQuality)}>本地</SelectItem>}
                      </SelectContent>
                    </Select>
                    <Select
                      value={String(playbackRate)}
                      onValueChange={(val) => handlePlaybackRateChange(Number(val))}
                    >
                      <SelectTrigger style={playerSelectStyle} className="min-w-[65px] border-white/30 bg-black/40 text-white h-[30px] rounded-[7px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent side="top" className="z-[1050] max-h-[320px] overflow-y-auto">
                        {PLAYBACK_SPEEDS.map((rate) => (
                          <SelectItem key={rate} value={String(rate)}>
                            {rate}x
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <PlayerIconButton
                      title={isPictureInPicture ? "退出画中画" : "画中画"}
                      disabled={!canPictureInPicture}
                      onClick={() => void handlePictureInPicture()}
                    >
                      <PictureInPicture2 size={18} />
                    </PlayerIconButton>
                    <PlayerIconButton title={isFullscreen ? "退出全屏" : "全屏"} onClick={() => void handleFullscreen()}>
                      {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                    </PlayerIconButton>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {videoInfo ? (
            <VideoActionBar
              stat={videoInfo.stat}
              liked={Boolean(interactionState?.liked)}
              coined={Boolean(interactionState?.coined)}
              favorited={Boolean(interactionState?.favorited)}
              disabled={interactionLoading}
              onLike={(target) => void handleLikeVideo(target)}
              onCoin={(target) => void handleCoinVideo(target)}
              onFavorite={(target) => void handleToggleFavorite(target)}
              onShare={() => void handleShareVideo()}
            />
          ) : null}

          <div style={{ padding: "18px 20px" }}>
            <p style={{ fontSize: "13.5px", color: "var(--color-text-muted)", lineHeight: 1.7 }}>
              {videoInfo?.description || bangumiInfo?.evaluate || "暂无简介"}
            </p>
          </div>
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={panelStyle}>
            {videoInfo?.owner ? (
              <div style={upHeaderButtonStyle}>
                <ClickableAvatar
                  src={videoInfo.owner.face}
                  alt={videoInfo.owner.name}
                  size={38}
                  onClick={() => openUpProfile({ mid: videoInfo.owner.mid, name: videoInfo.owner.name, face: videoInfo.owner.face })}
                />
                <button
                  type="button"
                  onClick={() => openUpProfile({ mid: videoInfo.owner.mid, name: videoInfo.owner.name, face: videoInfo.owner.face })}
                  style={upHeaderTextButtonStyle}
                >
                  <span style={{ display: "block", color: "var(--color-text)", fontSize: "14px", fontWeight: 850, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {videoInfo.owner.name}
                  </span>
                  <span style={{ display: "block", marginTop: "2px", color: "var(--color-text-muted)", fontSize: "12px" }}>
                    UP 主
                  </span>
                </button>
              </div>
            ) : null}
            <div
              style={{
                width: "100%",
                aspectRatio: "16 / 9",
                borderRadius: "12px",
                overflow: "hidden",
                backgroundColor: "var(--color-bg-tertiary)",
                marginBottom: "14px",
              }}
            >
              {cover ? (
                <img
                  src={formatBiliImageUrl(cover, "@672w_378h_1c.webp")}
                  alt={currentTitle}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : null}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <InfoRow label="类型" value={playerState.kind === "bangumi" ? "番剧" : "视频"} />
              {videoInfo ? <InfoRow label="时长" value={formatDuration(videoInfo.duration)} /> : null}
              {selectedEpisode ? <InfoRow label="当前" value={selectedEpisode.label} /> : null}
              {selectedEpisode?.localTaskId ? <InfoRow label="来源" value="本地文件" /> : null}
              {dashPlayback ? <InfoRow label="播放模式" value="DASH 音视频同步" /> : null}
              {episodes.length > 1 ? <InfoRow label="集数" value={`${episodes.length}`} /> : null}
            </div>
          </div>

          <div style={panelStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "12px" }}>
              <h3 style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-text)" }}>
                {playerState.kind === "bangumi" ? "剧集列表" : "分 P 列表"}
              </h3>
              {episodes.length > 1 ? (
                <button
                  type="button"
                  disabled={downloadingAllEpisodes || Boolean(downloadingEpisodeKey)}
                  onClick={() => void handleDownloadAll()}
                  style={{
                    ...episodeActionButtonStyle,
                    opacity: downloadingAllEpisodes || downloadingEpisodeKey ? 0.62 : 1,
                  }}
                >
                  {downloadingAllEpisodes ? (
                    <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />
                  ) : (
                    <Download style={{ width: 13, height: 13 }} />
                  )}
                  下载所有
                </button>
              ) : null}
            </div>
            <div
              style={{
                display: "grid",
                gridAutoRows: "max-content",
                alignContent: "start",
                gap: "8px",
                maxHeight: "420px",
                overflowY: "auto",
              }}
            >
              {episodes.map((episode) => {
                const active = selectedEpisode?.cid === episode.cid;
                const episodeKey = `${episode.bvid}-${episode.cid}`;
                const episodeDownloading = downloadingEpisodeKey === episodeKey;
                return (
                  <div
                    key={`${episode.bvid}-${episode.cid}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "10px",
                      minHeight: "58px",
                      borderRadius: "10px",
                      border: active ? "1px solid var(--color-primary)" : "1px solid var(--color-border)",
                      backgroundColor: active ? "var(--color-primary-light)" : "var(--color-bg-secondary)",
                      overflow: "hidden",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => void handleEpisodeChange(episode)}
                      style={{
                        minWidth: 0,
                        flex: 1,
                        alignSelf: "stretch",
                        display: "grid",
                        alignContent: "center",
                        gap: "3px",
                        padding: "8px 0 8px 12px",
                        border: 0,
                        color: "inherit",
                        background: "transparent",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <div style={{ fontSize: "13.5px", lineHeight: 1.2, fontWeight: 700, color: "var(--color-text)" }}>{episode.label}</div>
                      <div
                        style={{
                          fontSize: "12.5px",
                          lineHeight: 1.25,
                          color: "var(--color-text-muted)",
                          display: "-webkit-box",
                          WebkitBoxOrient: "vertical",
                          WebkitLineClamp: 2,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "normal",
                        }}
                      >
                        {episode.title}
                      </div>
                    </button>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "3px", paddingRight: "8px" }}>
                      <button
                        type="button"
                        aria-label={`播放 ${episode.label}`}
                        title="播放"
                        onClick={() => void handleEpisodeChange(episode)}
                        style={{
                          ...episodeItemIconButtonStyle,
                          color: active ? "var(--color-primary)" : "var(--color-text-muted)",
                        }}
                      >
                        <Play style={{ width: 14, height: 14 }} />
                      </button>
                      <button
                        type="button"
                        aria-label={`下载 ${episode.label}`}
                        title="下载本集"
                        disabled={Boolean(downloadingEpisodeKey) || downloadingAllEpisodes || episode.cid <= 0}
                        onClick={() => void handleEpisodeDownload(episode)}
                        style={{
                          ...episodeItemIconButtonStyle,
                          color: "var(--color-primary)",
                          opacity:
                            (downloadingEpisodeKey && !episodeDownloading) || downloadingAllEpisodes || episode.cid <= 0
                              ? 0.45
                              : 1,
                        }}
                      >
                        {episodeDownloading ? (
                          <Loader2 className="animate-spin" style={{ width: 14, height: 14 }} />
                        ) : (
                          <Download style={{ width: 14, height: 14 }} />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
      {showComments ? <CommentsSection oid={commentOid} typeId={commentType} refreshKey={commentRefreshKey} /> : null}
      {actionNotice ? (
        <motion.div
          key={actionNotice.id}
          initial={{ opacity: 0, y: -8, scale: 0.96 }}
          animate={{ opacity: 1, y: -42, scale: 1 }}
          exit={{ opacity: 0, y: -56, scale: 0.98 }}
          transition={{ duration: 0.24, ease: "easeOut" }}
          style={{
            ...actionNoticeStyle,
            left: actionNotice.left,
            top: actionNotice.top,
          }}
        >
          {actionNotice.message}
        </motion.div>
      ) : null}
      {favoriteDialogOpen ? (
        <FavoriteDialog
          folders={favoriteFolders}
          selectedIds={favoriteSelection}
          loading={favoriteFoldersLoading || interactionLoading}
          onToggle={(id) =>
            setFavoriteSelection((selected) => {
              const next = new Set(selected);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onCancel={() => setFavoriteDialogOpen(false)}
          onConfirm={() => void handleConfirmFavorite()}
        />
      ) : null}
      {coinDialogOpen ? (
        <CoinDialog
          open={coinDialogOpen}
          currentCoined={interactionState?.coined ?? 0}
          onSelect={(multiply) => void handleConfirmCoin(multiply)}
          onCancel={() => setCoinDialogOpen(false)}
          disabled={interactionLoading}
        />
      ) : null}
      {downloadQualityDialog}
    </div>
  );
}

function HeaderButton({
  children,
  icon,
  onClick,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "6px",
        padding: "9px 16px",
        borderRadius: "10px",
        fontSize: "14px",
        fontWeight: 500,
        color: "var(--color-text-secondary)",
        backgroundColor: "var(--color-bg-secondary)",
        border: "1.5px solid var(--color-border)",
        cursor: "pointer",
      }}
    >
      {icon}
      {children}
    </motion.button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
      <span style={{ fontSize: "12.5px", color: "var(--color-text-muted)", fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: "13.5px", color: "var(--color-text)", fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function PlayerIconButton({
  children,
  disabled = false,
  onClick,
  title,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        ...playerIconButtonStyle,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.42 : 1,
      }}
    >
      {children}
    </button>
  );
}

function VideoActionBar({
  stat,
  liked,
  coined,
  favorited,
  disabled,
  onLike,
  onCoin,
  onFavorite,
  onShare,
}: {
  stat: VideoInfo["stat"];
  liked: boolean;
  coined: boolean;
  favorited: boolean;
  disabled: boolean;
  onLike: (target: HTMLButtonElement) => void;
  onCoin: (target: HTMLButtonElement) => void;
  onFavorite: (target: HTMLButtonElement) => void;
  onShare: (target: HTMLButtonElement) => void;
}) {
  return (
    <div style={videoActionBarStyle}>
      <VideoActionButton
        title={liked ? "取消点赞" : "点赞"}
        active={liked}
        disabled={disabled}
        icon={<ThumbsUp fill={liked ? "currentColor" : "none"} />}
        count={stat.like}
        onClick={onLike}
      />
      <VideoActionButton
        title="投币"
        active={coined}
        disabled={disabled}
        icon={<BiliCoinIcon />}
        count={stat.coin}
        onClick={onCoin}
      />
      <VideoActionButton
        title="收藏"
        active={favorited}
        disabled={disabled}
        icon={<Star fill={favorited ? "currentColor" : "none"} />}
        count={stat.favorite}
        onClick={onFavorite}
      />
      <VideoActionButton
        title="复制链接"
        active={false}
        disabled={disabled}
        icon={<Share2 fill="currentColor" />}
        count={stat.share}
        onClick={onShare}
      />
    </div>
  );
}

function VideoActionButton({
  title,
  active,
  disabled,
  icon,
  count,
  onClick,
}: {
  title: string;
  active: boolean;
  disabled: boolean;
  icon: React.ReactElement<{ style?: React.CSSProperties; size?: number }>;
  count: number;
  onClick: (target: HTMLButtonElement) => void;
}) {
  const color = active ? "#2ea9f7" : "var(--color-text-secondary)";
  const iconSize = 26;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(event) => onClick(event.currentTarget)}
      style={{
        ...videoActionButtonStyle,
        color,
        cursor: disabled ? "wait" : "pointer",
        opacity: disabled ? 0.62 : 1,
      }}
    >
      {cloneElement(icon, { size: iconSize, style: { width: iconSize, height: iconSize, flexShrink: 0 } })}
      <span>{formatNumber(count)}</span>
    </button>
  );
}

function BiliCoinIcon({ size = 26, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={style}>
      <circle cx="32" cy="32" r="24" fill="currentColor" />
      <line x1="22.8" y1="20.2" x2="41.2" y2="20.2" stroke="#fff" strokeWidth="3.7" strokeLinecap="round" />
      <line x1="32" y1="20.2" x2="32" y2="48.4" stroke="#fff" strokeWidth="3.7" strokeLinecap="round" />
      <path
        d="M19.4 40.8 C19.4 32.9 23.35 26.6 32 26.6 C40.65 26.6 44.6 32.9 44.6 40.8"
        fill="none"
        stroke="#fff"
        strokeWidth="3.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FavoriteDialog({
  folders,
  selectedIds,
  loading,
  onToggle,
  onCancel,
  onConfirm,
}: {
  folders: VideoFavoriteFolder[];
  selectedIds: Set<number>;
  loading: boolean;
  onToggle: (id: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div style={dialogBackdropStyle} onClick={onCancel}>
      <div style={favoriteDialogStyle} onClick={(event) => event.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "14px" }}>
          <h3 style={{ fontSize: "17px", fontWeight: 850, color: "var(--color-text)" }}>选择收藏夹</h3>
          <button type="button" title="关闭" onClick={onCancel} style={dialogIconButtonStyle}>
            <X style={{ width: 18, height: 18 }} />
          </button>
        </div>

        {loading && folders.length === 0 ? (
          <div style={{ height: "130px", display: "grid", placeItems: "center", color: "#2ea9f7" }}>
            <Loader2 className="animate-spin" style={{ width: 24, height: 24 }} />
          </div>
        ) : folders.length === 0 ? (
          <div style={{ color: "var(--color-text-muted)", fontSize: "14px", padding: "22px 0" }}>没有可用收藏夹</div>
        ) : (
          <div style={{ display: "grid", gap: "8px", maxHeight: "360px", overflowY: "auto", paddingRight: "4px" }}>
            {folders.map((folder) => {
              const selected = selectedIds.has(folder.id);
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => onToggle(folder.id)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "22px minmax(0, 1fr) auto",
                    alignItems: "center",
                    gap: "10px",
                    padding: "11px 12px",
                    borderRadius: "10px",
                    border: selected ? "1.5px solid #2ea9f7" : "1px solid var(--color-border)",
                    backgroundColor: selected ? "var(--color-info-bg)" : "var(--color-bg-secondary)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ ...favoriteCheckboxStyle, backgroundColor: selected ? "#2ea9f7" : "var(--color-bg-secondary)", borderColor: selected ? "#2ea9f7" : "var(--color-border)" }}>
                    {selected ? <Check style={{ width: 14, height: 14, color: "#fff" }} /> : null}
                  </span>
                  <span style={{ minWidth: 0, color: "var(--color-text)", fontSize: "14px", fontWeight: 750, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {folder.title}
                  </span>
                  <span style={{ color: "var(--color-text-muted)", fontSize: "12.5px", fontWeight: 700 }}>{formatNumber(folder.media_count)}</span>
                </button>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "18px" }}>
          <button type="button" onClick={onCancel} style={dialogSecondaryButtonStyle}>取消</button>
          <button type="button" disabled={loading} onClick={onConfirm} style={{ ...dialogPrimaryButtonStyle, opacity: loading ? 0.65 : 1 }}>
            {loading ? "保存中..." : "确认"}
          </button>
        </div>
      </div>
    </div>
  );
}

const COIN_SPRITE_FRAME_COUNT = 24;
const COIN_SPRITE_FRAME_WIDTH = 102;
const COIN_SPRITE_FRAME_HEIGHT = 150;
const COIN_SPRITE_DURATION_MS = 1440;

function CoinSprite({
  src,
  active,
  resetKey,
}: {
  src: string;
  active: boolean;
  resetKey: number;
}) {
  return (
    <div
      key={`${src}-${resetKey}`}
      style={{
        width: `${COIN_SPRITE_FRAME_WIDTH}px`,
        height: `${COIN_SPRITE_FRAME_HEIGHT}px`,
        backgroundImage: `url(${src})`,
        backgroundSize: `${COIN_SPRITE_FRAME_WIDTH * COIN_SPRITE_FRAME_COUNT}px ${COIN_SPRITE_FRAME_HEIGHT}px`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "0 0",
        animation: active
          ? `coinGirlPlay ${COIN_SPRITE_DURATION_MS}ms steps(${COIN_SPRITE_FRAME_COUNT}) infinite`
          : "none",
      }}
    />
  );
}

function CoinDialog({
  open,
  currentCoined,
  onSelect,
  onCancel,
  disabled,
}: {
  open: boolean;
  currentCoined: number;
  onSelect: (multiply: number) => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [animVersion, setAnimVersion] = useState(0);

  if (!open) return null;

  const maxMultiply = 2 - currentCoined;

  const handleClickOption = (multiply: number) => {
    if (disabled || multiply > maxMultiply) return;
    setAnimVersion((v) => v + 1);
    setSelected(multiply);
  };

  const handleConfirm = () => {
    if (selected === null || disabled) return;
    onSelect(selected);
  };

  const isAnimating = (multiply: number) => selected === multiply;

  return (
    <div style={dialogBackdropStyle} onClick={onCancel}>
      <div style={coinDialogStyle} onClick={(event) => event.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "14px" }}>
          <h3 style={{ fontSize: "17px", fontWeight: 850, color: "var(--color-text)" }}>投币</h3>
          <button type="button" title="关闭" onClick={onCancel} style={dialogIconButtonStyle}>
            <X style={{ width: 18, height: 18 }} />
          </button>
        </div>

        <div style={{ display: "flex", gap: "16px", justifyContent: "center", padding: "10px 0 12px" }}>
          {/* 投1个币 */}
          <button
            type="button"
            disabled={disabled || maxMultiply < 1}
            onMouseEnter={() => setHovered(1)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => handleClickOption(1)}
            style={{
              ...coinOptionStyle,
              opacity: maxMultiply < 1 ? 0.5 : 1,
              cursor: maxMultiply < 1 || disabled ? "not-allowed" : "pointer",
              border: selected === 1 ? "2px solid #2ea9f7" : hovered === 1 ? "2px solid #2ea9f7" : "1px solid var(--color-border)",
              backgroundColor: selected === 1 ? "var(--color-info-bg)" : hovered === 1 ? "var(--color-info-bg)" : "var(--color-bg-secondary)",
            }}
          >
            <CoinSprite src={coin22Img} active={isAnimating(1)} resetKey={animVersion} />
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text)" }}>投1个币</span>
          </button>

          {/* 投2个币 */}
          <button
            type="button"
            disabled={disabled || maxMultiply < 2}
            onMouseEnter={() => setHovered(2)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => handleClickOption(2)}
            style={{
              ...coinOptionStyle,
              opacity: maxMultiply < 2 ? 0.5 : 1,
              cursor: maxMultiply < 2 || disabled ? "not-allowed" : "pointer",
              border: selected === 2 ? "2px solid #2ea9f7" : hovered === 2 ? "2px solid #2ea9f7" : "1px solid var(--color-border)",
              backgroundColor: selected === 2 ? "var(--color-info-bg)" : hovered === 2 ? "var(--color-info-bg)" : "var(--color-bg-secondary)",
            }}
          >
            <CoinSprite src={coin33Img} active={isAnimating(2)} resetKey={animVersion} />
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text)" }}>投2个币</span>
          </button>
        </div>

        {maxMultiply === 1 && (
          <div style={{ textAlign: "center", color: "var(--color-text-muted)", fontSize: "12px", marginBottom: "6px" }}>
            已投1枚，最多再投1枚
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "center", marginTop: "8px" }}>
          <button
            type="button"
            disabled={selected === null || disabled}
            onClick={handleConfirm}
            style={{
              ...dialogPrimaryButtonStyle,
              opacity: selected === null || disabled ? 0.5 : 1,
              cursor: selected === null || disabled ? "not-allowed" : "pointer",
            }}
          >
            {disabled ? "处理中..." : "确认投币"}
          </button>
        </div>
      </div>
      <style>{`
        @keyframes coinGirlPlay {
          from { background-position: 0 0; }
          to { background-position: -${COIN_SPRITE_FRAME_WIDTH * COIN_SPRITE_FRAME_COUNT}px 0; }
        }
      `}</style>
    </div>
  );
}

function buildDashManifest(playback: DashPlaybackInfo) {
  const duration = Math.max(playback.duration_seconds || 0, 0.001);
  const minBufferTime = Math.max(playback.min_buffer_time || 1.5, 0.1);
  const audioAdaptation = playback.audio
    ? `
    <AdaptationSet id="audio" contentType="audio" mimeType="${escapeXml(playback.audio.mime_type)}" segmentAlignment="true">
      ${buildDashRepresentation(playback.audio)}
    </AdaptationSet>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" minBufferTime="PT${minBufferTime}S" mediaPresentationDuration="PT${duration}S">
  <Period id="0" start="PT0S" duration="PT${duration}S">
    <AdaptationSet id="video" contentType="video" mimeType="${escapeXml(playback.video.mime_type)}" segmentAlignment="true" startWithSAP="1">
      ${buildDashRepresentation(playback.video)}
    </AdaptationSet>${audioAdaptation}
  </Period>
</MPD>`;
}

function buildDashRepresentation(stream: DashStreamInfo) {
  const dimensions =
    stream.width && stream.height
      ? ` width="${stream.width}" height="${stream.height}"`
      : "";
  const frameRate = stream.frame_rate ? ` frameRate="${escapeXml(stream.frame_rate)}"` : "";
  const segmentBase = stream.segment_base
    ? `<SegmentBase indexRange="${escapeXml(stream.segment_base.index_range)}"><Initialization range="${escapeXml(stream.segment_base.initialization)}" /></SegmentBase>`
    : "";

  return `<Representation id="${stream.id}" bandwidth="${stream.bandwidth}" codecs="${escapeXml(stream.codecs)}"${dimensions}${frameRate}><BaseURL>${escapeXml(stream.url)}</BaseURL>${segmentBase}</Representation>`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatPlaybackTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00";
  const rounded = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  document.body.removeChild(input);
}

const panelStyle: React.CSSProperties = {
  borderRadius: "16px",
  backgroundColor: "var(--color-bg-secondary)",
  border: "1px solid var(--color-border)",
  padding: "16px",
};

const upHeaderButtonStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "38px minmax(0, 1fr)",
  alignItems: "center",
  gap: "10px",
  padding: "0 0 14px",
  marginBottom: "14px",
  borderBottom: "1px solid var(--color-bg-subtle)",
};

const upHeaderTextButtonStyle: React.CSSProperties = {
  minWidth: 0,
  border: "none",
  background: "transparent",
  padding: 0,
  cursor: "pointer",
  textAlign: "left",
  fontFamily: "inherit",
};

const videoActionBarStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  alignItems: "center",
  gap: 0,
  padding: "12px 0 4px",
};

const videoActionButtonStyle: React.CSSProperties = {
  width: "100%",
  height: "38px",
  border: "none",
  backgroundColor: "transparent",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  fontSize: "16px",
  fontWeight: 700,
  padding: 0,
};

const actionNoticeStyle: React.CSSProperties = {
  position: "fixed",
  zIndex: 6200,
  translate: "-50% 0",
  pointerEvents: "none",
  padding: "7px 12px",
  borderRadius: "999px",
  backgroundColor: "rgba(46, 169, 247, 0.96)",
  color: "#fff",
  fontSize: "13px",
  fontWeight: 800,
  boxShadow: "0 10px 26px rgba(46, 169, 247, 0.28)",
  whiteSpace: "nowrap",
};

const dialogBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 5000,
  backgroundColor: "rgba(15, 23, 42, 0.38)",
  display: "grid",
  placeItems: "center",
  padding: "24px",
};

const favoriteDialogStyle: React.CSSProperties = {
  width: "min(460px, 100%)",
  maxHeight: "min(620px, calc(100vh - 64px))",
  overflow: "hidden",
  borderRadius: "16px",
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-bg-secondary)",
  boxShadow: "0 24px 60px rgba(15, 23, 42, 0.22)",
  padding: "18px",
};

const dialogIconButtonStyle: React.CSSProperties = {
  width: "32px",
  height: "32px",
  border: "1px solid var(--color-border)",
  borderRadius: "8px",
  backgroundColor: "var(--color-bg-secondary)",
  color: "var(--color-text-secondary)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const favoriteCheckboxStyle: React.CSSProperties = {
  width: "20px",
  height: "20px",
  borderRadius: "6px",
  border: "1px solid var(--color-border)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const dialogSecondaryButtonStyle: React.CSSProperties = {
  height: "36px",
  padding: "0 16px",
  borderRadius: "9px",
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-bg-secondary)",
  color: "var(--color-text-secondary)",
  fontSize: "13.5px",
  fontWeight: 750,
  cursor: "pointer",
};

const dialogPrimaryButtonStyle: React.CSSProperties = {
  height: "36px",
  padding: "0 18px",
  borderRadius: "9px",
  border: "1px solid #2ea9f7",
  backgroundColor: "#2ea9f7",
  color: "#fff",
  fontSize: "13.5px",
  fontWeight: 800,
  cursor: "pointer",
};

const errorStyle: React.CSSProperties = {
  marginBottom: "18px",
  padding: "12px 18px",
  borderRadius: "12px",
  backgroundColor: "var(--color-error-bg)",
  color: "var(--color-error-text)",
  fontSize: "13.5px",
};

const warningStyle: React.CSSProperties = {
  marginBottom: "18px",
  padding: "14px 18px",
  borderRadius: "12px",
  backgroundColor: "var(--color-warning-bg)",
  color: "#9a3412",
  fontSize: "13.5px",
  lineHeight: 1.7,
  border: "1px solid #fed7aa",
};

const loadingOverlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#fff",
};

const emptyPlayerStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  color: "#fff",
  gap: "10px",
  padding: "24px",
  textAlign: "center",
};

const playerControlsStyle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  padding: "32px 14px 12px",
  background: "linear-gradient(transparent, rgba(0, 0, 0, 0.82))",
  transition: "opacity 0.18s ease",
};

const playerToolbarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: "8px 12px",
};

const playerIconButtonStyle: React.CSSProperties = {
  width: "32px",
  height: "32px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  borderRadius: "7px",
  color: "#fff",
  backgroundColor: "transparent",
  cursor: "pointer",
};

const volumePopoverStyle: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: "38px",
  transform: "translateX(-50%)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "6px",
  padding: "10px 6px 5px",
  borderRadius: "10px",
  border: "1px solid rgba(255,255,255,0.2)",
  backgroundColor: "rgba(12, 14, 24, 0.94)",
  boxShadow: "0 8px 22px rgba(0,0,0,0.34)",
};

const verticalVolumeSliderStyle: React.CSSProperties = {
  width: "22px",
  height: "82px",
  accentColor: "#7c5cff",
  writingMode: "vertical-lr",
  direction: "rtl",
};

const playerSelectStyle: React.CSSProperties = {
  height: "30px",
  borderRadius: "7px",
  border: "1px solid rgba(255,255,255,0.32)",
  backgroundColor: "rgba(0,0,0,0.38)",
  color: "#fff",
  padding: "0 7px",
  fontSize: "12px",
  cursor: "pointer",
};

const episodeActionButtonStyle: React.CSSProperties = {
  height: "30px",
  padding: "0 10px",
  borderRadius: "8px",
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-bg-secondary)",
  color: "var(--color-primary)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "5px",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
};

const episodeItemIconButtonStyle: React.CSSProperties = {
  width: "30px",
  height: "30px",
  flex: "0 0 30px",
  border: 0,
  borderRadius: "8px",
  backgroundColor: "transparent",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const coinDialogStyle: React.CSSProperties = {
  width: "min(400px, 100%)",
  borderRadius: "16px",
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-bg-secondary)",
  boxShadow: "var(--shadow-card-hover)",
  padding: "18px",
};

const coinOptionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "10px",
  padding: "12px 14px",
  borderRadius: "12px",
  backgroundColor: "var(--color-bg-secondary)",
  border: "1px solid var(--color-border)",
  cursor: "pointer",
};
