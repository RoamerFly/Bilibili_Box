import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  Copy,
  Download,
  Eye,
  ExternalLink,
  Loader2,
  MessageCircle,
  Play,
  Search,
  Star,
  ThumbsUp,
  UserRound,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@/lib/api";
import { useDownloadQualityPrompt } from "@/components/download-quality-dialog";
import { notifyDownloadQueued } from "@/lib/download-feedback";
import { openExternalUrl } from "@/lib/open-external";
import type {
  AggregateSearchResult,
  SearchDate,
  SearchDuration,
  SearchFilters,
  SearchOrder,
  SearchResponse,
  BangumiInfo,
  VideoInfo,
} from "@/lib/types";
import { useAppStore } from "@/stores/app-store";
import { formatBiliImageUrl, formatDateTime, formatDuration, formatNumber } from "@/lib/utils";

const orderOptions: Array<{ value: SearchOrder; label: string }> = [
  { value: "totalrank", label: "综合排序" },
  { value: "click", label: "最多播放" },
  { value: "pubdate", label: "最新发布" },
  { value: "dm", label: "最多弹幕" },
  { value: "stow", label: "最多收藏" },
];

const dateOptions: Array<{ value: SearchDate; label: string }> = [
  { value: "0", label: "全部日期" },
  { value: "1", label: "一天内" },
  { value: "7", label: "一周内" },
  { value: "30", label: "一月内" },
  { value: "365", label: "一年内" },
];

const durationOptions: Array<{ value: SearchDuration; label: string }> = [
  { value: "0", label: "全部时长" },
  { value: "1", label: "10 分钟以下" },
  { value: "2", label: "10-30 分钟" },
  { value: "3", label: "30-60 分钟" },
  { value: "4", label: "60 分钟以上" },
];

type SearchResultType = "all" | "video" | "bangumi";

export function SearchView() {
  const openPlayer = useAppStore((s) => s.openPlayer);
  const searchPageState = useAppStore((s) => s.searchPageState);
  const setSearchPageState = useAppStore((s) => s.setSearchPageState);
  const searchRequestIdRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeResultType, setActiveResultType] = useState<SearchResultType>("all");
  const { requestDownloadQuality, downloadQualityDialog } = useDownloadQualityPrompt();
  const { input: searchInput, filters: currentFilters, lastAggregateInput, result } = searchPageState;

  const placeholder = useMemo(
    () => "输入关键词、BV/AV、ep/ss、视频链接或番剧链接",
    []
  );

  const setSearchInput = useCallback(
    (input: string) => {
      setSearchPageState({ input });
    },
    [setSearchPageState]
  );

  const runSearch = useCallback(async (rawInput: string, filters: SearchFilters) => {
    const input = rawInput.trim();
    if (!input) {
      setError("请输入搜索内容");
      return;
    }

    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    setLoading(true);
    setError("");
    try {
      const data = await invoke<SearchResponse>("search_video", {
        input,
        order: filters.order,
        pubtime: filters.pubtime,
        duration: filters.duration,
      });
      if (requestId !== searchRequestIdRef.current) return;
      const latestState = useAppStore.getState().searchPageState;
      setSearchPageState({
        filters,
        result: data,
        lastAggregateInput: data.type === "Aggregate" ? input : latestState.lastAggregateInput,
      });
    } catch (err) {
      if (requestId !== searchRequestIdRef.current) return;
      setError(String(err));
      setSearchPageState({ result: null });
    } finally {
      if (requestId === searchRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [setSearchPageState]);

  const handleSearch = useCallback(
    async (rawInput = searchInput) => {
      await runSearch(rawInput, currentFilters);
    },
    [currentFilters, runSearch, searchInput]
  );

  const updateFilters = useCallback(
    (nextFilters: SearchFilters) => {
      setSearchPageState({ filters: nextFilters });

      if (result?.type === "Aggregate" && lastAggregateInput) {
        void runSearch(lastAggregateInput, nextFilters);
      }
    },
    [lastAggregateInput, result?.type, runSearch, setSearchPageState]
  );

  const queueDownload = async (bvid: string, cid: number, title: string, downloadQuality: string) => {
    const taskIds = await invoke<string[]>("create_download_task", {
      params: { bvid, cid, title, cids: [cid], download_quality: downloadQuality },
    });
    notifyDownloadQueued(taskIds, title);
  };

  const handleDownload = async (bvid: string, cid: number, title: string) => {
    try {
      const downloadQuality = await requestDownloadQuality();
      if (!downloadQuality) return;
      await queueDownload(bvid, cid, title, downloadQuality);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleSearchVideoDownload = async (video: AggregateSearchResult["videos"][number], selectedQuality?: string) => {
    try {
      const downloadQuality = selectedQuality ?? await requestDownloadQuality();
      if (!downloadQuality) return false;
      const detail = await invoke<VideoInfo>("get_normal_info", { bvid: video.bvid });
      await queueDownload(detail.bvid, detail.cid, detail.title || video.title, downloadQuality);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  };

  const handleSearchBangumiDownload = async (bangumi: { season_id: number; title: string }, selectedQuality?: string) => {
    try {
      const downloadQuality = selectedQuality ?? await requestDownloadQuality();
      if (!downloadQuality) return false;
      const detail = await invoke<BangumiInfo>("get_bangumi_info", { seasonId: bangumi.season_id });
      if (!detail.episodes.length) {
        throw new Error("没有找到可下载的剧集");
      }
      const groups = await Promise.all(
        detail.episodes.map((episode) =>
          invoke<string[]>("create_download_task", {
            params: {
              bvid: episode.bvid,
              cid: episode.cid,
              title: `${detail.title || bangumi.title} - ${episode.long_title || episode.title}`.trim(),
              cids: [episode.cid],
              download_quality: downloadQuality,
            },
          })
        )
      );
      notifyDownloadQueued(groups.flat(), detail.title || bangumi.title);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  };

  const handleOpenBrowser = (url: string) => {
    void openExternalUrl(url).catch((err) => setError(String(err)));
  };

  const handleOpenVideoPlayer = (video: { bvid: string; cid?: number; title: string; pic?: string }) => {
    openPlayer({
      kind: "video",
      bvid: video.bvid,
      cid: video.cid,
      title: video.title,
      cover: video.pic,
    });
  };

  const handleOpenBangumiPlayer = (bangumi: { season_id: number; title: string; cover: string }) => {
    openPlayer({
      kind: "bangumi",
      seasonId: bangumi.season_id,
      title: bangumi.title,
      cover: bangumi.cover,
    });
  };

  const handleCopyBvid = async (bvid: string) => {
    try {
      await navigator.clipboard.writeText(bvid);
    } catch {
      setError("复制 BV 号失败");
    }
  };

  return (
    <div style={{ width: "100%", padding: "36px 44px 48px", minHeight: "100%" }}>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{ marginBottom: "24px" }}
      >
        <h1 style={{ fontSize: "24px", fontWeight: 800, color: "#1a1a2e", lineHeight: 1.25 }}>
          聚合搜索
        </h1>
        <p style={{ fontSize: "14px", color: "#8b8b9a", marginTop: "4px" }}>
          一个搜索框，支持关键词、链接和编号
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.3 }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "14px",
          marginBottom: "20px",
        }}
      >
        <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center" }}>
          <Search
            style={{
              position: "absolute",
              left: "16px",
              width: "18px",
              height: "18px",
              color: "#a0a0ab",
              pointerEvents: "none",
            }}
          />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
            placeholder={placeholder}
            style={{
              width: "100%",
              height: "48px",
              paddingLeft: "46px",
              paddingRight: "16px",
              borderRadius: "12px",
              border: "1.5px solid #dcdce4",
              backgroundColor: "#fff",
              fontSize: "14.5px",
              color: "#1a1a2e",
              outline: "none",
              fontFamily: "inherit",
            }}
          />
        </div>

        <motion.button
          onClick={() => void handleSearch()}
          disabled={loading || !searchInput.trim()}
          whileHover={loading || !searchInput.trim() ? {} : { scale: 1.02 }}
          whileTap={loading || !searchInput.trim() ? {} : { scale: 0.97 }}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "7px",
            height: "48px",
            padding: "0 24px",
            borderRadius: "12px",
            fontSize: "14.5px",
            fontWeight: 600,
            color: "#fff",
            backgroundColor: loading || !searchInput.trim() ? "#c0c0c8" : "#6366f1",
            cursor: loading || !searchInput.trim() ? "not-allowed" : "pointer",
            border: "none",
            fontFamily: "inherit",
            whiteSpace: "nowrap",
          }}
        >
          {loading ? (
            <Loader2 className="animate-spin" style={{ width: 18, height: 18 }} />
          ) : (
            <Search style={{ width: 18, height: 18 }} />
          )}
          {loading ? "搜索中" : "搜索"}
        </motion.button>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.25 }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
          marginBottom: "20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "5px", padding: "4px", borderRadius: "11px", backgroundColor: "#f1f1f7" }}>
          {([
            ["all", "全部"],
            ["video", "视频"],
            ["bangumi", "番剧"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setActiveResultType(value)}
              style={{
                padding: "7px 14px",
                borderRadius: "8px",
                border: "none",
                backgroundColor: activeResultType === value ? "#fff" : "transparent",
                boxShadow: activeResultType === value ? "0 1px 4px rgba(65,65,95,0.09)" : "none",
                color: activeResultType === value ? "#4338ca" : "#666679",
                fontSize: "13px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <FilterSelect
          label="排序"
          value={currentFilters.order}
          options={orderOptions}
          onChange={(value) =>
            updateFilters({ ...currentFilters, order: value as SearchOrder })
          }
        />
        <FilterSelect
          label="日期"
          value={currentFilters.pubtime}
          options={dateOptions}
          onChange={(value) =>
            updateFilters({ ...currentFilters, pubtime: value as SearchDate })
          }
        />
        <FilterSelect
          label="时长"
          value={currentFilters.duration}
          options={durationOptions}
          onChange={(value) =>
            updateFilters({ ...currentFilters, duration: value as SearchDuration })
          }
        />
        <span style={{ fontSize: "12.5px", color: "#9a9aa8" }}>
          排序、日期和时长对关键词视频结果生效
        </span>
      </motion.div>

      <AnimatePresence>
        {error ? (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            style={{
              marginBottom: "20px",
              padding: "12px 18px",
              borderRadius: "12px",
              backgroundColor: "#fef2f2",
              color: "#dc2626",
              fontSize: "13.5px",
            }}
          >
            {error}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {result ? (
        <motion.div
          key={result.type}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ display: "flex", flexDirection: "column", gap: "18px" }}
        >
          {result.type === "Normal" ? (
            <NormalVideoResult
              video={result}
              onCopyBvid={handleCopyBvid}
              onDownload={handleDownload}
              onOpenBrowser={handleOpenBrowser}
              onOpenPlayer={handleOpenVideoPlayer}
            />
          ) : null}

          {result.type === "Bangumi" ? (
            <BangumiResult
              bangumi={result}
              onDownload={handleDownload}
              onDownloadAll={() => void handleSearchBangumiDownload(result)}
              onOpenBrowser={handleOpenBrowser}
              onOpenPlayer={handleOpenBangumiPlayer}
            />
          ) : null}

          {result.type === "Aggregate" ? (
            <AggregateResult
              result={result}
              activeType={activeResultType}
              onOpenVideoPlayer={handleOpenVideoPlayer}
              onOpenBangumiPlayer={handleOpenBangumiPlayer}
              onDownloadVideo={handleSearchVideoDownload}
              onDownloadBangumi={handleSearchBangumiDownload}
              onRequestDownloadQuality={requestDownloadQuality}
              onOpenBrowser={handleOpenBrowser}
            />
          ) : null}
        </motion.div>
      ) : !loading ? (
        <div style={{ marginTop: "84px", textAlign: "center", color: "#9a9aa5" }}>
          <Search style={{ width: "56px", height: "56px", margin: "0 auto 18px", opacity: 0.35 }} />
          <p style={{ fontSize: "15px", fontWeight: 500 }}>输入内容开始搜索</p>
          <p style={{ fontSize: "13px", marginTop: "8px", opacity: 0.75 }}>
            关键词会返回分类结果，链接和编号会直接显示可操作内容
          </p>
        </div>
      ) : null}
      {downloadQualityDialog}
    </div>
  );
}

function NormalVideoResult({
  video,
  onCopyBvid,
  onDownload,
  onOpenBrowser,
  onOpenPlayer,
}: {
  video: VideoInfo;
  onCopyBvid: (bvid: string) => void;
  onDownload: (bvid: string, cid: number, title: string) => void;
  onOpenBrowser: (url: string) => void;
  onOpenPlayer: (video: { bvid: string; cid?: number; title: string; pic?: string }) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gap: 0,
        alignItems: "start",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: "20px",
          padding: "20px",
          borderRadius: "16px",
          backgroundColor: "#fff",
          border: "1px solid #ececf2",
        }}
      >
        <div
          style={{
            width: "280px",
            height: "158px",
            borderRadius: "12px",
            overflow: "hidden",
            flexShrink: 0,
            position: "relative",
            backgroundColor: "#f0f0f5",
            cursor: "pointer",
          }}
          onClick={() => onOpenPlayer({ bvid: video.bvid, cid: video.cid, title: video.title, pic: video.pic })}
        >
          <img
            src={formatBiliImageUrl(video.pic, "@672w_378h_1c.webp")}
            alt={video.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
          <div
            style={{
              position: "absolute",
              bottom: "8px",
              right: "8px",
              padding: "3px 8px",
              borderRadius: "6px",
              backgroundColor: "rgba(0,0,0,0.72)",
              color: "#fff",
              fontSize: "12.5px",
              fontWeight: 600,
            }}
          >
            {formatDuration(video.duration)}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <h3 style={{ fontSize: "18px", fontWeight: 700, color: "#1a1a2e", lineHeight: 1.45, marginBottom: "10px" }}>
            {video.title}
          </h3>

          <div style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "12px" }}>
            <AvatarImage src={video.owner.face} alt={video.owner.name} size={30} />
            <span style={{ fontSize: "13.5px", color: "#505065", fontWeight: 500 }}>{video.owner.name}</span>
            <span style={{ fontSize: "12.5px", color: "#9a9aa8" }}>发布于 {formatDateTime(video.pubdate)}</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: "13px", color: "#7a7a8c", flexWrap: "wrap" }}>
            <MetaPill icon={<Eye style={{ width: 13, height: 13 }} />} text={`播放 ${formatNumber(video.stat.view)}`} />
            <MetaPill icon={<ThumbsUp style={{ width: 13, height: 13 }} />} text={`点赞 ${formatNumber(video.stat.like)}`} />
            <MetaPill icon={<Star style={{ width: 13, height: 13 }} />} text={`收藏 ${formatNumber(video.stat.favorite)}`} />
            <MetaPill icon={<MessageCircle style={{ width: 13, height: 13 }} />} text={`评论 ${formatNumber(video.stat.reply)}`} />
            <button
              onClick={() => onCopyBvid(video.bvid)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "4px",
                cursor: "pointer",
                userSelect: "none",
                background: "none",
                border: "none",
                color: "#7a7a8c",
                padding: 0,
                fontSize: "13px",
              }}
            >
              {video.bvid}
              <Copy style={{ width: "13px", height: "13px" }} />
            </button>
          </div>

          <div style={{ marginTop: "auto", paddingTop: "12px", display: "flex", gap: "10px", justifyContent: "flex-end", flexWrap: "wrap" }}>
            <PrimaryActionButton
              onClick={() => onOpenPlayer({ bvid: video.bvid, cid: video.cid, title: video.title, pic: video.pic })}
              icon={<Play style={{ width: 16, height: 16 }} />}
            >
              播放
            </PrimaryActionButton>
            <GhostActionButton
              onClick={() => onOpenBrowser(`https://www.bilibili.com/video/${video.bvid}`)}
              icon={<ExternalLink style={{ width: 16, height: 16 }} />}
            >
              浏览器打开
            </GhostActionButton>
            <GhostActionButton
              onClick={() => onDownload(video.bvid, video.cid, video.title)}
              icon={<Download style={{ width: 16, height: 16 }} />}
            >
              下载
            </GhostActionButton>
          </div>
        </div>
      </div>

    </div>
  );
}

function BangumiResult({
  bangumi,
  onDownload,
  onDownloadAll,
  onOpenBrowser,
  onOpenPlayer,
}: {
  bangumi: Extract<SearchResponse, { type: "Bangumi" }>;
  onDownload: (bvid: string, cid: number, title: string) => void;
  onDownloadAll: () => void;
  onOpenBrowser: (url: string) => void;
  onOpenPlayer: (bangumi: { season_id: number; title: string; cover: string }) => void;
}) {
  return (
    <div
      style={{
        width: "100%",
        borderRadius: "16px",
        backgroundColor: "#fff",
        border: "1px solid #ececf2",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", gap: "20px", padding: "20px" }}>
        <div
          style={{
            width: "144px",
            height: "192px",
            borderRadius: "12px",
            overflow: "hidden",
            flexShrink: 0,
            backgroundColor: "#f0f0f5",
            cursor: "pointer",
          }}
          onClick={() => onOpenPlayer(bangumi)}
        >
          <img
            src={formatBiliImageUrl(bangumi.cover, "@308w_410h_1c.webp")}
            alt={bangumi.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ fontSize: "18px", fontWeight: 700, color: "#1a1a2e", marginBottom: "10px" }}>
            {bangumi.title}
          </h3>
          <p style={{ fontSize: "13.5px", color: "#505065", lineHeight: 1.7 }}>
            {bangumi.evaluate || "暂无简介"}
          </p>
          <div style={{ marginTop: "16px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <PrimaryActionButton onClick={() => onOpenPlayer(bangumi)} icon={<Play style={{ width: 16, height: 16 }} />}>
              播放
            </PrimaryActionButton>
            <GhostActionButton
              onClick={() => onOpenBrowser(`https://www.bilibili.com/bangumi/play/ss${bangumi.season_id}`)}
              icon={<ExternalLink style={{ width: 16, height: 16 }} />}
            >
              浏览器打开
            </GhostActionButton>
            <GhostActionButton onClick={onDownloadAll} icon={<Download style={{ width: 16, height: 16 }} />}>
              下载全部
            </GhostActionButton>
          </div>
        </div>
      </div>

      <div style={{ borderTop: "1px solid #ececf2", padding: "20px" }}>
        <h4 style={{ fontSize: "15px", fontWeight: 700, color: "#1a1a2e", marginBottom: "14px" }}>剧集列表</h4>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {bangumi.episodes.map((episode) => (
            <div
              key={`${episode.bvid}-${episode.cid}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "11px 14px",
                borderRadius: "12px",
                backgroundColor: "#fff",
                border: "1px solid #ececf2",
              }}
            >
              <div
                style={{
                  width: "80px",
                  height: "48px",
                  borderRadius: "8px",
                  overflow: "hidden",
                  flexShrink: 0,
                  backgroundColor: "#f0f0f5",
                }}
              >
                <img
                  src={formatBiliImageUrl(episode.cover, "@672w_378h_1c.webp")}
                  alt={episode.title}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: "14px", fontWeight: 500, color: "#33334a" }}>{episode.title}</span>
                {episode.long_title ? (
                  <span style={{ fontSize: "13px", color: "#8b8b9a", marginLeft: "5px" }}>{episode.long_title}</span>
                ) : null}
              </div>
              <GhostActionButton
                onClick={() => onDownload(episode.bvid, episode.cid, `${bangumi.title} - ${episode.long_title || episode.title}`.trim())}
                icon={<Download style={{ width: 15, height: 15 }} />}
              >
                下载
              </GhostActionButton>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AggregateResult({
  result,
  activeType,
  onOpenVideoPlayer,
  onOpenBangumiPlayer,
  onDownloadVideo,
  onDownloadBangumi,
  onRequestDownloadQuality,
  onOpenBrowser,
}: {
  result: Extract<SearchResponse, { type: "Aggregate" }>;
  activeType: SearchResultType;
  onOpenVideoPlayer: (video: { bvid: string; cid?: number; title: string; pic?: string }) => void;
  onOpenBangumiPlayer: (bangumi: { season_id: number; title: string; cover: string }) => void;
  onDownloadVideo: (video: AggregateSearchResult["videos"][number], quality?: string) => Promise<boolean>;
  onDownloadBangumi: (bangumi: { season_id: number; title: string }, quality?: string) => Promise<boolean>;
  onRequestDownloadQuality: () => Promise<string | null>;
  onOpenBrowser: (url: string) => void;
}) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [batchDownloading, setBatchDownloading] = useState(false);
  const showVideos = activeType === "all" || activeType === "video";
  const showBangumi = activeType === "all" || activeType === "bangumi";
  const visibleKeys = [
    ...(showVideos ? result.videos.map((video) => `video:${video.bvid}`) : []),
    ...(showBangumi ? result.bangumi.map((bangumi) => `bangumi:${bangumi.season_id}`) : []),
  ];
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeys.has(key));

  useEffect(() => {
    setSelectedKeys(new Set());
  }, [result]);

  const toggleSelection = (key: string) => {
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleVisibleSelection = () => {
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (allVisibleSelected) {
        visibleKeys.forEach((key) => next.delete(key));
      } else {
        visibleKeys.forEach((key) => next.add(key));
      }
      return next;
    });
  };

  const handleBatchDownload = async () => {
    const operations = [
      ...result.videos
        .filter((video) => selectedKeys.has(`video:${video.bvid}`))
        .map((video) => ({ key: `video:${video.bvid}`, run: (quality: string) => onDownloadVideo(video, quality) })),
      ...result.bangumi
        .filter((bangumi) => selectedKeys.has(`bangumi:${bangumi.season_id}`))
        .map((bangumi) => ({ key: `bangumi:${bangumi.season_id}`, run: (quality: string) => onDownloadBangumi(bangumi, quality) })),
    ];
    if (!operations.length) return;

    const downloadQuality = await onRequestDownloadQuality();
    if (!downloadQuality) return;
    setBatchDownloading(true);
    const outcomes = await Promise.all(operations.map(async (operation) => ({ key: operation.key, ok: await operation.run(downloadQuality) })));
    setBatchDownloading(false);
    setSelectedKeys(new Set(outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.key)));
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "13px", color: "#7a7a8c" }}>
          当前类别 {activeType === "all" ? "全部" : activeType === "video" ? "视频" : "番剧"}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "9px", flexWrap: "wrap" }}>
          <GhostActionButton onClick={toggleVisibleSelection} icon={<span aria-hidden="true">{allVisibleSelected ? "✓" : "□"}</span>}>
            {allVisibleSelected ? "取消当前全选" : "全选当前"}
          </GhostActionButton>
          <GhostActionButton
            onClick={() => void handleBatchDownload()}
            icon={batchDownloading ? <Loader2 className="animate-spin" style={{ width: 15, height: 15 }} /> : <Download style={{ width: 15, height: 15 }} />}
            disabled={batchDownloading || selectedKeys.size === 0}
          >
            下载选中 {selectedKeys.size ? `(${selectedKeys.size})` : ""}
          </GhostActionButton>
        </div>
      </div>

      {showVideos && result.videos.length ? (
        <>
          <SectionHeader title="视频结果" count={result.videos.length} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(370px, 1fr))", gap: "14px" }}>
            {result.videos.map((video) => (
              <AggregateVideoCard
                key={video.bvid}
                video={video}
                selected={selectedKeys.has(`video:${video.bvid}`)}
                onToggleSelection={() => toggleSelection(`video:${video.bvid}`)}
                onDownload={() => void onDownloadVideo(video)}
                onOpenBrowser={() => onOpenBrowser(`https://www.bilibili.com/video/${video.bvid}`)}
                onPlay={() => onOpenVideoPlayer({ bvid: video.bvid, title: video.title, pic: video.pic })}
              />
            ))}
          </div>
        </>
      ) : null}

      {showBangumi && result.bangumi.length ? (
        <>
          <SectionHeader title="番剧结果" count={result.bangumi.length} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "14px" }}>
            {result.bangumi.map((bangumi) => (
              <AggregateBangumiCard
                key={bangumi.season_id}
                bangumi={bangumi}
                selected={selectedKeys.has(`bangumi:${bangumi.season_id}`)}
                onToggleSelection={() => toggleSelection(`bangumi:${bangumi.season_id}`)}
                onDownload={() => void onDownloadBangumi(bangumi)}
                onOpenBrowser={() => onOpenBrowser(`https://www.bilibili.com/bangumi/play/ss${bangumi.season_id}`)}
                onPlay={() => onOpenBangumiPlayer(bangumi)}
              />
            ))}
          </div>
        </>
      ) : null}

      {(!showVideos || !result.videos.length) && (!showBangumi || !result.bangumi.length) ? (
        <div style={{ padding: "52px 0", textAlign: "center", color: "#8b8b9a", fontSize: "14px" }}>该类型暂无结果</div>
      ) : null}
    </>
  );
}

function AggregateVideoCard({
  video,
  selected,
  onToggleSelection,
  onDownload,
  onOpenBrowser,
  onPlay,
}: {
  video: AggregateSearchResult["videos"][number];
  selected: boolean;
  onToggleSelection: () => void;
  onDownload: () => void;
  onOpenBrowser: () => void;
  onPlay: () => void;
}) {
  return (
    <div style={{ borderRadius: "14px", backgroundColor: "#fff", border: selected ? "1.5px solid #6366f1" : "1px solid #ececf2", padding: "13px 14px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "148px minmax(0, 1fr)", gap: "13px", alignItems: "start" }}>
        <div
          onClick={onPlay}
          style={{ aspectRatio: "16 / 9", borderRadius: "10px", overflow: "hidden", backgroundColor: "#f0f0f5", position: "relative", cursor: "pointer" }}
        >
          <img
            src={formatBiliImageUrl(video.pic, "@672w_378h_1c.webp")}
            alt={video.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
          <span
            style={{
              position: "absolute",
              right: "7px",
              bottom: "7px",
              padding: "2px 7px",
              borderRadius: "6px",
              backgroundColor: "rgba(0,0,0,0.7)",
              color: "#fff",
              fontSize: "12px",
              fontWeight: 700,
            }}
          >
            {video.duration || "--:--"}
          </span>
          <input
            type="checkbox"
            checked={selected}
            onClick={(event) => event.stopPropagation()}
            onChange={onToggleSelection}
            aria-label={`选择视频 ${video.title}`}
            style={{ position: "absolute", top: "8px", left: "8px", width: "17px", height: "17px", accentColor: "#6366f1", cursor: "pointer" }}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <h3
            style={{
              fontSize: "15px",
              fontWeight: 700,
              color: "#1a1a2e",
              lineHeight: 1.45,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {video.title}
          </h3>
          <div style={{ marginTop: "8px", display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
            <AvatarImage src={video.author_face || ""} alt={video.author} size={24} />
            <span style={{ fontSize: "12.5px", color: "#505065", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {video.author || "未知 UP"}
            </span>
            <span style={{ fontSize: "12px", color: "#999aaa", whiteSpace: "nowrap" }}>{formatDateTime(video.pubdate)}</span>
          </div>
        </div>
      </div>
      <div style={{ marginTop: "11px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "11px", color: "#7a7a8c", fontSize: "12.5px", flexWrap: "wrap" }}>
        <MetaPill icon={<Eye style={{ width: 13, height: 13 }} />} text={`播放 ${formatNumber(video.play)}`} />
        <MetaPill icon={<ThumbsUp style={{ width: 13, height: 13 }} />} text={`点赞 ${formatNumber(video.like || 0)}`} />
        <MetaPill icon={<Star style={{ width: 13, height: 13 }} />} text={`收藏 ${formatNumber(video.favorite || 0)}`} />
        <MetaPill icon={<MessageCircle style={{ width: 13, height: 13 }} />} text={`评论 ${formatNumber(video.reply || 0)}`} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px", marginTop: "13px" }}>
        <CardActionButton primary onClick={onPlay} icon={<Play style={{ width: 14, height: 14 }} />}>
          播放
        </CardActionButton>
        <CardActionButton onClick={onDownload} icon={<Download style={{ width: 14, height: 14 }} />}>
          下载
        </CardActionButton>
        <CardActionButton onClick={onOpenBrowser} icon={<ExternalLink style={{ width: 14, height: 14 }} />}>
          浏览器
        </CardActionButton>
      </div>
    </div>
  );
}

function AggregateBangumiCard({
  bangumi,
  selected,
  onToggleSelection,
  onDownload,
  onOpenBrowser,
  onPlay,
}: {
  bangumi: AggregateSearchResult["bangumi"][number];
  selected: boolean;
  onToggleSelection: () => void;
  onDownload: () => void;
  onOpenBrowser: () => void;
  onPlay: () => void;
}) {
  return (
    <div style={{ borderRadius: "14px", backgroundColor: "#fff", border: selected ? "1.5px solid #6366f1" : "1px solid #ececf2", padding: "13px 14px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "116px minmax(0, 1fr)", gap: "14px", alignItems: "start" }}>
        <div onClick={onPlay} style={{ aspectRatio: "3 / 4", borderRadius: "10px", overflow: "hidden", backgroundColor: "#f0f0f5", cursor: "pointer", position: "relative" }}>
          <img
            src={formatBiliImageUrl(bangumi.cover, "@308w_410h_1c.webp")}
            alt={bangumi.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
          <input
            type="checkbox"
            checked={selected}
            onClick={(event) => event.stopPropagation()}
            onChange={onToggleSelection}
            aria-label={`选择番剧 ${bangumi.title}`}
            style={{ position: "absolute", top: "8px", left: "8px", width: "17px", height: "17px", accentColor: "#6366f1", cursor: "pointer" }}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#1a1a2e", lineHeight: 1.45 }}>{bangumi.title}</h3>
          <div style={{ marginTop: "6px", fontSize: "12.5px", color: "#8b8b9a", display: "flex", alignItems: "center", gap: "6px" }}>
            <Calendar style={{ width: 13, height: 13 }} />
            {bangumi.index_show || "番剧"}
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px", marginTop: "13px" }}>
        <CardActionButton primary onClick={onPlay} icon={<Play style={{ width: 14, height: 14 }} />}>
          播放
        </CardActionButton>
        <CardActionButton onClick={onDownload} icon={<Download style={{ width: 14, height: 14 }} />}>
          下载
        </CardActionButton>
        <CardActionButton onClick={onOpenBrowser} icon={<ExternalLink style={{ width: 14, height: 14 }} />}>
          浏览器
        </CardActionButton>
      </div>
    </div>
  );
}

function AvatarImage({ src, alt, size }: { src: string; alt: string; size: number }) {
  const normalizedSrc = formatBiliImageUrl(src, `@${size * 3}w_${size * 3}h_1c.webp`);
  const fallback = (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#eef2ff",
        color: "#6366f1",
        border: "1.5px solid #ececf2",
        flexShrink: 0,
      }}
    >
      <UserRound style={{ width: size * 0.56, height: size * 0.56 }} />
    </span>
  );

  if (!normalizedSrc) {
    return fallback;
  }

  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#eef2ff",
        border: "1.5px solid #ececf2",
        flexShrink: 0,
        position: "relative",
        color: "#6366f1",
      }}
    >
      <UserRound style={{ width: size * 0.56, height: size * 0.56, position: "absolute" }} />
      <img
        src={normalizedSrc}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={(event) => {
          event.currentTarget.style.display = "none";
        }}
        style={{ width: "100%", height: "100%", objectFit: "cover", position: "relative" }}
      />
    </span>
  );
}

function MetaPill({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}>
      {icon}
      {text}
    </span>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "4px" }}>
      <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#1a1a2e" }}>{title}</h2>
      <span style={{ fontSize: "13px", color: "#8b8b9a" }}>{count} 条</span>
    </div>
  );
}

function CardActionButton({
  children,
  icon,
  onClick,
  primary = false,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      style={{
        minWidth: 0,
        height: "36px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "5px",
        padding: "0 7px",
        borderRadius: "9px",
        border: primary ? "1px solid #6366f1" : "1px solid #dddde8",
        backgroundColor: primary ? "#6366f1" : "#fff",
        color: primary ? "#fff" : "#505065",
        fontSize: "12.5px",
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
      }}
    >
      {icon}
      {children}
    </motion.button>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        padding: "7px 10px",
        borderRadius: "10px",
        backgroundColor: "#fff",
        border: "1px solid #e2e2ea",
      }}
    >
      <span style={{ fontSize: "13px", fontWeight: 600, color: "#6f6f82", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{
          height: "28px",
          border: "none",
          outline: "none",
          backgroundColor: "transparent",
          color: "#1a1a2e",
          fontSize: "13px",
          fontWeight: 600,
          fontFamily: "inherit",
          cursor: "pointer",
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function PrimaryActionButton({
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
      onClick={onClick}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "7px",
        padding: "9px 18px",
        borderRadius: "10px",
        backgroundColor: "#6366f1",
        color: "#fff",
        fontSize: "14px",
        fontWeight: 600,
        cursor: "pointer",
        border: "none",
        fontFamily: "inherit",
      }}
    >
      {icon}
      {children}
    </motion.button>
  );
}

function GhostActionButton({
  children,
  icon,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled ? {} : { scale: 1.04 }}
      whileTap={disabled ? {} : { scale: 0.96 }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "7px",
        padding: "9px 18px",
        borderRadius: "10px",
        backgroundColor: "#fff",
        color: disabled ? "#a5a5b2" : "#505065",
        fontSize: "14px",
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        border: "1.5px solid #d8d8e4",
        opacity: disabled ? 0.7 : 1,
        fontFamily: "inherit",
      }}
    >
      {icon}
      {children}
    </motion.button>
  );
}
