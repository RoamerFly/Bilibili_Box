import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, ExternalLink, Loader2, Play, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
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
}

export function PlayerView() {
  const playerState = useAppStore((s) => s.playerState);
  const closePlayer = useAppStore((s) => s.closePlayer);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [playUrl, setPlayUrl] = useState("");
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [bangumiInfo, setBangumiInfo] = useState<BangumiInfo | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeOption[]>([]);
  const [selectedEpisode, setSelectedEpisode] = useState<EpisodeOption | null>(null);

  const playbackHint =
    "当前播放器只拿到了直链地址，但 B 站媒体流还依赖 Referer、Cookie、部分场景还要音视频分离合流。仅把 URL 塞给 <video> 还不够。";

  const loadPlayableUrl = useCallback(async (bvid: string, cid: number) => {
    return await invoke<string>("get_play_proxy_url", { bvid, cid });
  }, []);

  const loadVideoPlayer = useCallback(async () => {
    if (!playerState?.bvid) {
      throw new Error("缺少视频标识");
    }

    const info = await invoke<VideoInfo>("get_normal_info", { bvid: playerState.bvid });
    setVideoInfo(info);
    setBangumiInfo(null);

    const nextEpisodes =
      info.pages?.length > 0
        ? info.pages.map((page, index) => ({
            label: `P${page.page || index + 1}`,
            title: page.part || info.title,
            bvid: info.bvid,
            cid: page.cid,
          }))
        : [
            {
              label: "正片",
              title: info.title,
              bvid: info.bvid,
              cid: playerState.cid ?? info.cid,
            },
          ];

    setEpisodes(nextEpisodes);
    const nextSelected = nextEpisodes.find((episode) => episode.cid === (playerState.cid ?? info.cid)) ?? nextEpisodes[0] ?? null;
    setSelectedEpisode(nextSelected);
    setPlayUrl(nextSelected ? await loadPlayableUrl(nextSelected.bvid, nextSelected.cid) : "");
  }, [loadPlayableUrl, playerState]);

  const loadBangumiPlayer = useCallback(async () => {
    if (!playerState?.seasonId) {
      throw new Error("缺少番剧标识");
    }

    const info = await invoke<BangumiInfo>("get_bangumi_info", { seasonId: playerState.seasonId });
    setBangumiInfo(info);
    setVideoInfo(null);

    const nextEpisodes = info.episodes.map((episode, index) => ({
      label: `EP${index + 1}`,
      title: episode.long_title || episode.title,
      bvid: episode.bvid,
      cid: episode.cid,
    }));
    setEpisodes(nextEpisodes);
    const nextSelected = nextEpisodes[0] ?? null;
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
      setPlayUrl("");
    } finally {
      setLoading(false);
    }
  }, [loadBangumiPlayer, loadVideoPlayer, playerState]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const currentTitle = useMemo(() => {
    if (playerState?.kind === "bangumi") {
      return bangumiInfo?.title || playerState?.title || "播放器";
    }
    return videoInfo?.title || playerState?.title || "播放器";
  }, [bangumiInfo?.title, playerState, videoInfo?.title]);

  const cover = bangumiInfo?.cover || videoInfo?.pic || playerState?.cover || "";
  const browserUrl = useMemo(() => {
    if (!playerState) return "";
    if (playerState.kind === "bangumi" && playerState.seasonId) {
      return `https://www.bilibili.com/bangumi/play/ss${playerState.seasonId}`;
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
      setPlayUrl(await loadPlayableUrl(episode.bvid, episode.cid));
    } catch (err) {
      setError(String(err));
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
      const taskIds = await invoke<string[]>("create_download_task", {
        params: {
          bvid: selectedEpisode.bvid,
          cid: selectedEpisode.cid,
          title:
            playerState?.kind === "bangumi"
              ? `${currentTitle} - ${selectedEpisode.title}`.trim()
              : currentTitle,
          cids: [selectedEpisode.cid],
        },
      });
      notifyDownloadQueued(taskIds, selectedEpisode.title || currentTitle);
    } catch (err) {
      setError(String(err));
    }
  };

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
          <HeaderButton onClick={handleDownload} icon={<Download style={{ width: 15, height: 15 }} />}>
            下载当前
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

      {!playUrl && !loading ? (
        <div style={warningStyle}>
          <div style={{ fontWeight: 700, marginBottom: "6px" }}>为什么现在还播不起来</div>
          <div>{playbackHint}</div>
          <div style={{ marginTop: "8px" }}>
            还差一层本地媒体代理或专用播放 API，至少要能稳定补上请求头，必要时还要处理 DASH 音视频分离。
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
          <div style={{ width: "100%", aspectRatio: "16 / 9", backgroundColor: "#0f172a", position: "relative" }}>
            {loading ? (
              <div style={loadingOverlayStyle}>
                <Loader2 className="animate-spin" style={{ width: 28, height: 28 }} />
              </div>
            ) : playUrl ? (
              <video
                key={playUrl}
                controls
                autoPlay
                poster={formatBiliImageUrl(cover, "@672w_378h_1c.webp")}
                src={playUrl}
                onError={() => {
                  setError("本地媒体代理已建立，但当前资源仍然无法播放，可能还需要 DASH 音视频合流支持。");
                }}
                style={{ width: "100%", height: "100%", objectFit: "contain", backgroundColor: "#000" }}
              />
            ) : (
              <div style={emptyPlayerStyle}>
                <Play style={{ width: 32, height: 32, opacity: 0.7 }} />
                <div style={{ fontSize: "14px", opacity: 0.85 }}>当前没有拿到可直接播放的地址</div>
              </div>
            )}
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
              {episodes.length > 1 ? <InfoRow label="集数" value={`${episodes.length}`} /> : null}
            </div>
          </div>

          <div style={panelStyle}>
            <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#1a1a2e", marginBottom: "12px" }}>
              {playerState.kind === "bangumi" ? "剧集列表" : "分 P 列表"}
            </h3>
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
