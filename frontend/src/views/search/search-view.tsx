import { useCallback, useMemo, useRef, useState } from "react";
import {
  Calendar,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Play,
  Search,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@/lib/api";
import { notifyDownloadQueued } from "@/lib/download-feedback";
import { openExternalUrl } from "@/lib/open-external";
import type {
  AggregateSearchResult,
  BangumiInfo,
  VideoInfo,
} from "@/lib/types";
import { useAppStore } from "@/stores/app-store";
import { ensureHttps, formatBiliImageUrl, formatDuration, formatNumber } from "@/lib/utils";

type SearchResponse =
  | ({ type: "Normal" } & VideoInfo)
  | ({
      type: "Bangumi";
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
    })
  | ({ type: "Aggregate" } & AggregateSearchResult);

type SearchOrder = "totalrank" | "click" | "pubdate" | "dm" | "stow";
type SearchDate = "0" | "1" | "7" | "30" | "365";
type SearchDuration = "0" | "1" | "2" | "3" | "4";
type SearchFilters = {
  order: SearchOrder;
  pubtime: SearchDate;
  duration: SearchDuration;
};

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

export function SearchView() {
  const openPlayer = useAppStore((s) => s.openPlayer);
  const searchRequestIdRef = useRef(0);
  const [searchInput, setSearchInput] = useState("");
  const [searchOrder, setSearchOrder] = useState<SearchOrder>("totalrank");
  const [searchDate, setSearchDate] = useState<SearchDate>("0");
  const [searchDuration, setSearchDuration] = useState<SearchDuration>("0");
  const [lastAggregateInput, setLastAggregateInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SearchResponse | null>(null);

  const placeholder = useMemo(
    () => "输入关键词、BV/AV、ep/ss、视频链接或番剧链接",
    []
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
      setResult(data);
      setLastAggregateInput(data.type === "Aggregate" ? input : "");
    } catch (err) {
      if (requestId !== searchRequestIdRef.current) return;
      setError(String(err));
      setResult(null);
      setLastAggregateInput("");
    } finally {
      if (requestId === searchRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const currentFilters = useMemo<SearchFilters>(
    () => ({
      order: searchOrder,
      pubtime: searchDate,
      duration: searchDuration,
    }),
    [searchDate, searchDuration, searchOrder]
  );

  const handleSearch = useCallback(
    async (rawInput = searchInput) => {
      await runSearch(rawInput, currentFilters);
    },
    [currentFilters, runSearch, searchInput]
  );

  const updateFilters = useCallback(
    (nextFilters: SearchFilters) => {
      setSearchOrder(nextFilters.order);
      setSearchDate(nextFilters.pubtime);
      setSearchDuration(nextFilters.duration);

      if (result?.type === "Aggregate" && lastAggregateInput) {
        void runSearch(lastAggregateInput, nextFilters);
      }
    },
    [lastAggregateInput, result?.type, runSearch]
  );

  const handleDownload = async (bvid: string, cid: number, title: string) => {
    try {
      const taskIds = await invoke<string[]>("create_download_task", {
        params: { bvid, cid, title, cids: [cid] },
      });
      notifyDownloadQueued(taskIds, title);
    } catch (err) {
      setError(String(err));
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
        <FilterSelect
          label="排序"
          value={searchOrder}
          options={orderOptions}
          onChange={(value) =>
            updateFilters({ ...currentFilters, order: value as SearchOrder })
          }
        />
        <FilterSelect
          label="日期"
          value={searchDate}
          options={dateOptions}
          onChange={(value) =>
            updateFilters({ ...currentFilters, pubtime: value as SearchDate })
          }
        />
        <FilterSelect
          label="时长"
          value={searchDuration}
          options={durationOptions}
          onChange={(value) =>
            updateFilters({ ...currentFilters, duration: value as SearchDuration })
          }
        />
        <span style={{ fontSize: "12.5px", color: "#9a9aa8" }}>
          筛选对关键词视频结果生效
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
              onOpenBrowser={handleOpenBrowser}
              onOpenPlayer={handleOpenBangumiPlayer}
            />
          ) : null}

          {result.type === "Aggregate" ? (
            <AggregateResult
              result={result}
              onSearch={handleSearch}
              onOpenVideoPlayer={handleOpenVideoPlayer}
              onOpenBangumiPlayer={handleOpenBangumiPlayer}
            />
          ) : null}
        </motion.div>
      ) : !loading ? (
        <div style={{ marginTop: "84px", textAlign: "center", color: "#9a9aa5" }}>
          <Search style={{ width: "56px", height: "56px", margin: "0 auto 18px", opacity: 0.35 }} />
          <p style={{ fontSize: "15px", fontWeight: 500 }}>输入内容开始搜索</p>
          <p style={{ fontSize: "13px", marginTop: "8px", opacity: 0.75 }}>
            关键词会返回聚合结果，链接和编号会直接进入详情
          </p>
        </div>
      ) : null}
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
        gridTemplateColumns: "minmax(0, 1fr) 320px",
        gap: "22px",
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
            <img
              src={ensureHttps(video.owner.face)}
              alt={video.owner.name}
              style={{ width: "28px", height: "28px", borderRadius: "50%", objectFit: "cover", border: "1.5px solid #ececf2" }}
            />
            <span style={{ fontSize: "13.5px", color: "#505065", fontWeight: 500 }}>{video.owner.name}</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: "13px", color: "#7a7a8c", flexWrap: "wrap" }}>
            <span>播放 {formatNumber(video.stat.view)}</span>
            <span>点赞 {formatNumber(video.stat.like)}</span>
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

          <p style={{ marginTop: "14px", fontSize: "13.5px", color: "#6b7280", lineHeight: 1.7 }}>
            {video.description || "暂无简介"}
          </p>

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

      <InfoPanel
        cover={video.pic}
        title={video.title}
        lines={[
          ["BV", video.bvid],
          ["时长", formatDuration(video.duration)],
          ["作者", video.owner.name],
          ["播放", formatNumber(video.stat.view)],
        ]}
      />
    </div>
  );
}

function BangumiResult({
  bangumi,
  onDownload,
  onOpenBrowser,
  onOpenPlayer,
}: {
  bangumi: Extract<SearchResponse, { type: "Bangumi" }>;
  onDownload: (bvid: string, cid: number, title: string) => void;
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
  onSearch,
  onOpenVideoPlayer,
  onOpenBangumiPlayer,
}: {
  result: Extract<SearchResponse, { type: "Aggregate" }>;
  onSearch: (input: string) => Promise<void>;
  onOpenVideoPlayer: (video: { bvid: string; cid?: number; title: string; pic?: string }) => void;
  onOpenBangumiPlayer: (bangumi: { season_id: number; title: string; cover: string }) => void;
}) {
  return (
    <>
      <SectionHeader title="视频结果" count={result.videos.length} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "16px" }}>
        {result.videos.map((video) => (
          <AggregateVideoCard
            key={video.bvid}
            video={video}
            onDetail={() => void onSearch(video.bvid)}
            onPlay={() => onOpenVideoPlayer({ bvid: video.bvid, title: video.title, pic: video.pic })}
          />
        ))}
      </div>

      <SectionHeader title="番剧结果" count={result.bangumi.length} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "16px" }}>
        {result.bangumi.map((bangumi) => (
          <AggregateBangumiCard
            key={bangumi.season_id}
            bangumi={bangumi}
            onDetail={() => void onSearch(`ss${bangumi.season_id}`)}
            onPlay={() => onOpenBangumiPlayer(bangumi)}
          />
        ))}
      </div>
    </>
  );
}

function AggregateVideoCard({
  video,
  onDetail,
  onPlay,
}: {
  video: AggregateSearchResult["videos"][number];
  onDetail: () => void;
  onPlay: () => void;
}) {
  return (
    <div style={{ borderRadius: "16px", backgroundColor: "#fff", border: "1px solid #ececf2", padding: "16px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "140px minmax(0, 1fr)", gap: "14px", alignItems: "start" }}>
        <div style={{ aspectRatio: "16 / 9", borderRadius: "10px", overflow: "hidden", backgroundColor: "#f0f0f5" }}>
          <img
            src={formatBiliImageUrl(video.pic, "@672w_378h_1c.webp")}
            alt={video.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#1a1a2e", lineHeight: 1.45 }}>{video.title}</h3>
          <p style={{ marginTop: "6px", fontSize: "12.5px", color: "#8b8b9a" }}>
            {video.author} · {video.duration} · {formatNumber(video.play)}
          </p>
          <p style={{ marginTop: "8px", fontSize: "13px", color: "#6b7280", lineHeight: 1.6 }}>
            {video.description || "暂无简介"}
          </p>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "14px", flexWrap: "wrap" }}>
        <PrimaryActionButton onClick={onPlay} icon={<Play style={{ width: 15, height: 15 }} />}>
          播放
        </PrimaryActionButton>
        <GhostActionButton onClick={onDetail} icon={<Search style={{ width: 15, height: 15 }} />}>
          查看详情
        </GhostActionButton>
      </div>
    </div>
  );
}

function AggregateBangumiCard({
  bangumi,
  onDetail,
  onPlay,
}: {
  bangumi: AggregateSearchResult["bangumi"][number];
  onDetail: () => void;
  onPlay: () => void;
}) {
  return (
    <div style={{ borderRadius: "16px", backgroundColor: "#fff", border: "1px solid #ececf2", padding: "16px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "116px minmax(0, 1fr)", gap: "14px", alignItems: "start" }}>
        <div style={{ aspectRatio: "3 / 4", borderRadius: "10px", overflow: "hidden", backgroundColor: "#f0f0f5" }}>
          <img
            src={formatBiliImageUrl(bangumi.cover, "@308w_410h_1c.webp")}
            alt={bangumi.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#1a1a2e", lineHeight: 1.45 }}>{bangumi.title}</h3>
          <div style={{ marginTop: "6px", fontSize: "12.5px", color: "#8b8b9a", display: "flex", alignItems: "center", gap: "6px" }}>
            <Calendar style={{ width: 13, height: 13 }} />
            {bangumi.index_show || "番剧"}
          </div>
          <p style={{ marginTop: "8px", fontSize: "13px", color: "#6b7280", lineHeight: 1.6 }}>
            {bangumi.description || "暂无简介"}
          </p>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "14px", flexWrap: "wrap" }}>
        <PrimaryActionButton onClick={onPlay} icon={<Play style={{ width: 15, height: 15 }} />}>
          播放
        </PrimaryActionButton>
        <GhostActionButton onClick={onDetail} icon={<Search style={{ width: 15, height: 15 }} />}>
          查看详情
        </GhostActionButton>
      </div>
    </div>
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

function InfoPanel({
  cover,
  title,
  lines,
}: {
  cover: string;
  title: string;
  lines: Array<[string, string]>;
}) {
  return (
    <div style={{ borderRadius: "16px", backgroundColor: "#fff", border: "1px solid #ececf2", padding: "20px" }}>
      <div
        style={{
          width: "100%",
          aspectRatio: "16/9",
          borderRadius: "10px",
          overflow: "hidden",
          backgroundColor: "#f0f0f5",
          marginBottom: "18px",
        }}
      >
        <img
          src={formatBiliImageUrl(cover, "@672w_378h_1c.webp")}
          alt={title}
          loading="lazy"
          referrerPolicy="no-referrer"
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {lines.map(([label, value]) => (
          <div key={label}>
            <div style={{ fontSize: "12.5px", fontWeight: 600, color: "#7a7a8c", marginBottom: "4px" }}>{label}</div>
            <div style={{ color: "#1a1a2e", fontWeight: 500, fontSize: "13.5px", wordBreak: "break-all" }}>{value || "-"}</div>
          </div>
        ))}
      </div>
    </div>
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
        backgroundColor: "#fff",
        color: "#505065",
        fontSize: "14px",
        fontWeight: 600,
        cursor: "pointer",
        border: "1.5px solid #d8d8e4",
        fontFamily: "inherit",
      }}
    >
      {icon}
      {children}
    </motion.button>
  );
}
