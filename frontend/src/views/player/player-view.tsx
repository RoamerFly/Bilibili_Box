import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
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
  Volume2,
  VolumeX,
} from "lucide-react";
import type { MediaPlayerClass } from "dashjs";
import { motion } from "framer-motion";
import { useDownloadQualityPrompt } from "@/components/download-quality-dialog";
import { invoke } from "@/lib/api";
import { notifyDownloadQueued } from "@/lib/download-feedback";
import { openExternalUrl } from "@/lib/open-external";
import type { BangumiInfo, VideoInfo } from "@/lib/types";
import { formatBiliImageUrl, formatDuration } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

interface EpisodeOption {
  label: string;
  title: string;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [playUrl, setPlayUrl] = useState("");
  const [dashPlayback, setDashPlayback] = useState<DashPlaybackInfo | null>(null);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [bangumiInfo, setBangumiInfo] = useState<BangumiInfo | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeOption[]>([]);
  const [selectedEpisode, setSelectedEpisode] = useState<EpisodeOption | null>(null);
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

  const cover = bangumiInfo?.cover || videoInfo?.pic || playerState?.cover || "";
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

  const handleDownload = async () => {
    if (!selectedEpisode) {
      return;
    }
    try {
      const downloadQuality = await requestDownloadQuality({
        bvid: selectedEpisode.bvid,
        cid: selectedEpisode.cid,
      });
      if (!downloadQuality) return;
      const taskIds = await invoke<string[]>("create_download_task", {
        params: {
          bvid: selectedEpisode.bvid,
          cid: selectedEpisode.cid,
          title:
            playerState?.kind === "bangumi"
              ? `${currentTitle} - ${selectedEpisode.title}`.trim()
              : currentTitle,
          cids: [selectedEpisode.cid],
          download_quality: downloadQuality,
        },
      });
      notifyDownloadQueued(taskIds, selectedEpisode.title || currentTitle);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDownloadAll = async () => {
    if (!episodes.length) return;
    try {
      const downloadQuality = await requestDownloadQuality(
        episodes.map((episode) => ({ bvid: episode.bvid, cid: episode.cid }))
      );
      if (!downloadQuality) return;
      let taskIds: string[];
      if (playerState?.kind === "video") {
        taskIds = await invoke<string[]>("create_download_task", {
          params: {
            bvid: episodes[0].bvid,
            cid: episodes[0].cid,
            title: currentTitle,
            cids: episodes.map((episode) => episode.cid),
            download_quality: downloadQuality,
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
                download_quality: downloadQuality,
              },
            })
          )
        );
        taskIds = taskGroups.flat();
      }
      notifyDownloadQueued(taskIds, currentTitle);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleAudioDownload = async () => {
    if (!selectedEpisode) return;
    try {
      const title =
        playerState?.kind === "bangumi"
          ? `${currentTitle} - ${selectedEpisode.title}`.trim()
          : currentTitle;
      const taskIds = await invoke<string[]>("create_download_task", {
        params: {
          bvid: selectedEpisode.bvid,
          cid: selectedEpisode.cid,
          title,
          cids: [selectedEpisode.cid],
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
        <div style={{ paddingTop: "120px", textAlign: "center", color: "#8b8b9a" }}>暂无播放内容</div>
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
            <h1 style={{ fontSize: "24px", fontWeight: 800, color: "#1a1a2e", lineHeight: 1.25 }}>
              通用播放页
            </h1>
            <p style={{ fontSize: "14px", color: "#8b8b9a", marginTop: "4px" }}>{currentTitle}</p>
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
                    <select
                      aria-label="播放清晰度"
                      title="播放清晰度"
                      value={playbackQuality}
                      disabled={!availableQualities.length}
                      onChange={(event) => void handlePlaybackQualityChange(Number(event.target.value))}
                      style={playerSelectStyle}
                    >
                      {availableQualities.length ? availableQualities.map((quality) => (
                        <option key={quality} value={quality}>{PLAYBACK_QUALITY_LABELS[quality] || `${quality}P`}</option>
                      )) : <option value={playbackQuality}>本地</option>}
                    </select>
                    <select
                      aria-label="播放倍速"
                      title="播放倍速"
                      value={playbackRate}
                      onChange={(event) => handlePlaybackRateChange(Number(event.target.value))}
                      style={playerSelectStyle}
                    >
                      {PLAYBACK_SPEEDS.map((rate) => <option key={rate} value={rate}>{rate}x</option>)}
                    </select>
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

          <div style={{ padding: "18px 20px" }}>
            <h2 style={{ fontSize: "17px", fontWeight: 700, color: "#1a1a2e", marginBottom: "8px" }}>
              {selectedEpisode?.title || currentTitle}
            </h2>
            <p style={{ fontSize: "13.5px", color: "#6b7280", lineHeight: 1.7 }}>
              {videoInfo?.description || bangumiInfo?.evaluate || "暂无简介"}
            </p>
          </div>
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={panelStyle}>
            <div
              style={{
                width: "100%",
                aspectRatio: "16 / 9",
                borderRadius: "12px",
                overflow: "hidden",
                backgroundColor: "#f3f4f6",
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
              <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#1a1a2e" }}>
                {playerState.kind === "bangumi" ? "剧集列表" : "分 P 列表"}
              </h3>
              {episodes.length > 1 ? (
                <button type="button" onClick={() => void handleDownloadAll()} style={episodeActionButtonStyle}>
                  <Download style={{ width: 13, height: 13 }} />
                  下载所有
                </button>
              ) : null}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "420px", overflowY: "auto" }}>
              {episodes.map((episode) => {
                const active = selectedEpisode?.cid === episode.cid;
                return (
                  <button
                    key={`${episode.bvid}-${episode.cid}`}
                    onClick={() => void handleEpisodeChange(episode)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "10px",
                      padding: "10px 12px",
                      borderRadius: "10px",
                      border: active ? "1px solid #6366f1" : "1px solid #ececf2",
                      backgroundColor: active ? "#f5f3ff" : "#fff",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "13.5px", fontWeight: 600, color: "#1a1a2e" }}>{episode.label}</div>
                      <div
                        style={{
                          fontSize: "12.5px",
                          color: "#6b7280",
                          marginTop: "2px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {episode.title}
                      </div>
                    </div>
                    {active ? <Play style={{ width: 14, height: 14, color: "#6366f1", flexShrink: 0 }} /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
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
        color: "#505065",
        backgroundColor: "#fff",
        border: "1.5px solid #e2e2ea",
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
      <span style={{ fontSize: "12.5px", color: "#8b8b9a", fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: "13.5px", color: "#1a1a2e", fontWeight: 600 }}>{value}</span>
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

const panelStyle: React.CSSProperties = {
  borderRadius: "16px",
  backgroundColor: "#fff",
  border: "1px solid #ececf2",
  padding: "16px",
};

const errorStyle: React.CSSProperties = {
  marginBottom: "18px",
  padding: "12px 18px",
  borderRadius: "12px",
  backgroundColor: "#fef2f2",
  color: "#dc2626",
  fontSize: "13.5px",
};

const warningStyle: React.CSSProperties = {
  marginBottom: "18px",
  padding: "14px 18px",
  borderRadius: "12px",
  backgroundColor: "#fff7ed",
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
  border: "1px solid #dedee7",
  backgroundColor: "#fff",
  color: "#6366f1",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "5px",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
};
