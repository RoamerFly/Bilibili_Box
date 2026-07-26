import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { ArrowLeft, Download, ExternalLink, Loader2, RefreshCw, Rss, UserRound, Video } from "lucide-react";
import { motion } from "framer-motion";
import { invoke } from "@/lib/api";
import { useAppStore } from "@/stores/app-store";
import { useCardLayout, fixedCardGridColumns } from "@/hooks/use-card-layout";
import { useDownloadQualityPrompt, type DownloadQualityTarget } from "@/components/download-quality-dialog";
import { ClickableAvatar, UnifiedVideoCard } from "@/components/video-card";
import { FollowingDynamicCard } from "@/views/recommend/recommend-view";
import { notifyDownloadQueued } from "@/lib/download-feedback";
import { biliVideoUrl, openExternalUrl } from "@/lib/open-external";
import { formatBiliImageUrl, formatDateTime, formatNumber } from "@/lib/utils";
import type { VideoInfo } from "@/lib/types";
import type { RecommendPageDynamicItem } from "@/stores/app-store";
import { PageCardControls } from "@/components/page-card-controls";
import { PurpleRefreshButton } from "@/components/toolbar-controls";

interface UpProfile {
  mid: number;
  name: string;
  face: string;
  sign: string;
  level: number;
  following: number;
  follower: number;
  archive_count: number;
}

interface UpVideoItem {
  aid: number;
  bvid: string;
  title: string;
  cover: string;
  duration: string;
  pubdate: number;
  play: number;
  danmaku: number;
  reply: number;
  favorite: number;
}

interface UpVideoPage {
  list: UpVideoItem[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

interface UpDynamicItem {
  id: string;
  author_mid: number;
  author_name: string;
  author_face: string;
  kind: "video" | "image" | "link" | "text";
  type_label: string;
  text: string;
  content_text: string;
  pub_ts: number;
  major_title: string;
  major_cover: string;
  major_url: string;
  bvid: string;
  aid: number;
  images: string[];
  comment_oid: string;
  comment_type: number;
}

interface UpDynamicPage {
  list: UpDynamicItem[];
  offset: string;
  has_more: boolean;
}

interface ArticleImageInfo {
  url: string;
  title: string;
}

interface ArticleDetailInfo {
  id: number;
  title: string;
  images: ArticleImageInfo[];
}

type ActiveTab = "videos" | "dynamics";

const UP_VIDEO_PAGE_SIZE = 30;

export function UpProfileView() {
  const upProfileState = useAppStore((s) => s.upProfileState);
  const closeUpProfile = useAppStore((s) => s.closeUpProfile);
  const openUpProfile = useAppStore((s) => s.openUpProfile);
  const openPlayer = useAppStore((s) => s.openPlayer);
  const openContentDetail = useAppStore((s) => s.openContentDetail);
  const viewMode = useAppStore((s) => s.cardViewModes.up ?? "grid");
  const setCardViewMode = useAppStore((s) => s.setCardViewMode);
  const { cardScale, columns } = useCardLayout("up", viewMode);
  const { requestDownloadQuality, downloadQualityDialog } = useDownloadQualityPrompt();
  const [activeTab, setActiveTab] = useState<ActiveTab>("videos");
  const [profile, setProfile] = useState<UpProfile | null>(null);
  const [videos, setVideos] = useState<UpVideoItem[]>([]);
  const [videoPage, setVideoPage] = useState(0);
  const [videoTotal, setVideoTotal] = useState(0);
  const [hasMoreVideos, setHasMoreVideos] = useState(true);
  const [dynamics, setDynamics] = useState<UpDynamicItem[]>([]);
  const [dynamicOffset, setDynamicOffset] = useState("");
  const [hasMoreDynamics, setHasMoreDynamics] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadScopeOpen, setDownloadScopeOpen] = useState(false);
  const [downloadVideosScope, setDownloadVideosScope] = useState(true);
  const [downloadArticlesScope, setDownloadArticlesScope] = useState(false);
  const [multiSelectEnabled, setMultiSelectEnabled] = useState(false);
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  const mid = upProfileState?.mid ?? 0;

  const fetchProfile = useCallback(async () => {
    if (!mid) return;
    const data = await invoke<UpProfile>("get_up_profile", { mid });
    setProfile({
      ...data,
      name: data.name || upProfileState?.name || "",
      face: data.face || upProfileState?.face || "",
    });
  }, [mid, upProfileState?.face, upProfileState?.name]);

  const fetchVideos = useCallback(async (page: number, mode: "replace" | "append" = "replace") => {
    if (!mid) return;
    if (mode === "append") setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const data = await invoke<UpVideoPage>("get_up_videos", { mid, page, pageSize: UP_VIDEO_PAGE_SIZE });
      setVideos((previous) => {
        const merged = mode === "append" ? [...previous, ...data.list] : data.list;
        return Array.from(new Map(merged.map((item) => [item.bvid, item])).values());
      });
      setVideoPage(data.page);
      setVideoTotal(data.total);
      setHasMoreVideos(data.has_more);
    } catch (err) {
      setError(String(err));
      if (mode === "replace") setVideos([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [mid]);

  const fetchDynamics = useCallback(async (offset = "", mode: "replace" | "append" = "replace") => {
    if (!mid) return;
    if (mode === "append") setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const data = await invoke<UpDynamicPage>("get_up_dynamics", { mid, offset: offset || null });
      setDynamics((previous) => {
        const merged = mode === "append" ? [...previous, ...data.list] : data.list;
        return Array.from(new Map(merged.map((item) => [item.id || `${item.pub_ts}-${item.text}`, item])).values());
      });
      setDynamicOffset(data.offset);
      setHasMoreDynamics(data.has_more);
    } catch (err) {
      setError(String(err));
      if (mode === "replace") setDynamics([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [mid]);

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      fetchProfile(),
      activeTab === "videos"
        ? fetchVideos(1, "replace")
        : fetchDynamics("", "replace"),
    ]);
  }, [activeTab, fetchDynamics, fetchProfile, fetchVideos]);

  useEffect(() => {
    if (!mid) return;
    setProfile(upProfileState ? {
      mid: upProfileState.mid,
      name: upProfileState.name || "",
      face: upProfileState.face || "",
      sign: "",
      level: 0,
      following: 0,
      follower: 0,
      archive_count: 0,
    } : null);
    setVideos([]);
    setDynamics([]);
    setSelectedVideoIds(new Set());
    setMultiSelectEnabled(false);
    setVideoPage(0);
    setDynamicOffset("");
    void Promise.all([fetchProfile(), fetchVideos(1, "replace"), fetchDynamics("", "replace")]);
  }, [fetchDynamics, fetchProfile, fetchVideos, mid, upProfileState]);

  const displayProfile = profile ?? {
    mid,
    name: upProfileState?.name || "UP 主",
    face: upProfileState?.face || "",
    sign: "",
    level: 0,
    following: 0,
    follower: 0,
    archive_count: 0,
  };

  const resolveDownloadTarget = async (video: UpVideoItem) => {
    const detail = await invoke<VideoInfo>("get_normal_info", { bvid: video.bvid });
    return detail;
  };

  const queueVideoDownload = async (video: UpVideoItem, selectedQuality?: string) => {
    const detail = await resolveDownloadTarget(video);
    const downloadQuality = selectedQuality ?? await requestDownloadQuality({ bvid: detail.bvid, cid: detail.cid });
    if (!downloadQuality) return false;
    const taskIds = await invoke<string[]>("create_download_task", {
      params: {
        bvid: detail.bvid,
        cid: detail.cid,
        title: detail.title || video.title,
        cids: [detail.cid],
        download_quality: downloadQuality,
      },
    });
    notifyDownloadQueued(taskIds, detail.title || video.title);
    return true;
  };

  const handleDownloadOne = async (video: UpVideoItem) => {
    try {
      await queueVideoDownload(video);
    } catch (err) {
      setError(String(err));
    }
  };

  const loadAllVideos = async () => {
    let allVideos = [...videos];
    let page = videoPage;
    let nextHasMore = hasMoreVideos;
    if (!allVideos.length) {
      const data = await invoke<UpVideoPage>("get_up_videos", { mid, page: 1, pageSize: UP_VIDEO_PAGE_SIZE });
      allVideos = Array.from(new Map(data.list.map((item) => [item.bvid, item])).values());
      page = data.page;
      nextHasMore = data.has_more;
      setVideos(allVideos);
      setVideoPage(data.page);
      setVideoTotal(data.total);
      setHasMoreVideos(data.has_more);
    }
    const maxPages = Math.max(page + 1, Math.ceil((videoTotal || displayProfile.archive_count || allVideos.length) / UP_VIDEO_PAGE_SIZE) + 2);
    while (nextHasMore && page < maxPages) {
      page += 1;
      const data = await invoke<UpVideoPage>("get_up_videos", { mid, page, pageSize: UP_VIDEO_PAGE_SIZE });
      const previousCount = allVideos.length;
      allVideos = Array.from(new Map([...allVideos, ...data.list].map((item) => [item.bvid, item])).values());
      nextHasMore = data.has_more;
      setVideos(allVideos);
      setVideoPage(data.page);
      setVideoTotal(data.total);
      setHasMoreVideos(data.has_more);
      if (!data.list.length || allVideos.length === previousCount) {
        nextHasMore = false;
        setHasMoreVideos(false);
      }
    }
    return allVideos;
  };

  const loadAllDynamics = async () => {
    let allDynamics = [...dynamics];
    let offset = dynamicOffset;
    let nextHasMore = hasMoreDynamics;
    let guard = 0;
    while (nextHasMore && offset && guard < 80) {
      guard += 1;
      const data = await invoke<UpDynamicPage>("get_up_dynamics", { mid, offset });
      const previousCount = allDynamics.length;
      allDynamics = Array.from(new Map([...allDynamics, ...data.list].map((item) => [item.id || `${item.pub_ts}-${item.text}`, item])).values());
      offset = data.offset;
      nextHasMore = data.has_more && allDynamics.length > previousCount;
      setDynamics(allDynamics);
      setDynamicOffset(data.offset);
      setHasMoreDynamics(nextHasMore);
    }
    return allDynamics;
  };

  const handleDownloadArticles = async (items: UpDynamicItem[], groupId: string, groupTitle: string, groupTotalBase: number) => {
    const articleIds = Array.from(new Set(items.map((item) => extractArticleId(item.major_url)).filter((id): id is number => Boolean(id))));
    let index = 0;
    for (const articleId of articleIds) {
      const article = await invoke<ArticleDetailInfo>("get_article_detail", { articleId });
      if (!article.images.length) continue;
      index += 1;
      await invoke<string[]>("create_article_download_task", {
        params: {
          article_id: article.id || articleId,
          title: article.title || `专栏 ${articleId}`,
          images: article.images,
          group_id: groupId,
          group_title: groupTitle,
          group_total: groupTotalBase + articleIds.length,
        },
      });
    }
  };

  const handleDownloadVideos = async (scope: "loaded" | "all" | "selected") => {
    if (!mid || downloadingAll) return;
    setDownloadingAll(true);
    setError("");
    try {
      const targets = scope === "all"
        ? await loadAllVideos()
        : scope === "selected"
          ? videos.filter((video) => selectedVideoIds.has(video.bvid))
          : videos;
      if (!targets.length) return;
      const resolved: Array<{ video: UpVideoItem; detail: VideoInfo }> = [];
      for (const video of targets) {
        const detail = await resolveDownloadTarget(video);
        resolved.push({ video, detail });
      }
      const downloadQuality = await requestDownloadQuality(
        resolved.map(({ detail }) => ({ bvid: detail.bvid, cid: detail.cid } satisfies DownloadQualityTarget))
      );
      if (!downloadQuality) return;
      const taskGroups: string[][] = [];
      const groupId = scope === "selected"
        ? `up-selected:${mid}:${Date.now()}`
        : `up-all:${mid}:${Date.now()}`;
      const groupTitle = scope === "selected"
        ? targets.slice(0, 2).map((video) => video.title).join("、") + (targets.length > 2 ? " 等" : "")
        : `${displayProfile.name} 全部作品`;
      for (const { video, detail } of resolved) {
        const taskIds = await invoke<string[]>("create_download_task", {
          params: {
            bvid: detail.bvid,
            cid: detail.cid,
            title: detail.title || video.title,
            cids: [detail.cid],
            download_quality: downloadQuality,
            group_id: groupId,
            group_title: groupTitle,
            group_total: targets.length,
          },
        });
        taskGroups.push(taskIds);
      }
      notifyDownloadQueued(taskGroups.flat(), scope === "selected" ? `已选 ${targets.length} 个投稿` : `${displayProfile.name} 的投稿`);
      if (scope === "selected") setSelectedVideoIds(new Set());
    } catch (err) {
      setError(String(err));
    } finally {
      setDownloadingAll(false);
    }
  };

  const handleDownloadAllWorks = async () => {
    if (!downloadVideosScope && !downloadArticlesScope) return;
    setDownloadingAll(true);
    setError("");
    setDownloadScopeOpen(false);
    const groupId = `up-works:${mid}:${Date.now()}`;
    const groupTitle = `${displayProfile.name} 全部作品`;
    try {
      let videoCount = 0;
      if (downloadVideosScope) {
        const targets = await loadAllVideos();
        videoCount = targets.length;
        if (targets.length) {
          const resolved: Array<{ video: UpVideoItem; detail: VideoInfo }> = [];
          for (const video of targets) {
            const detail = await resolveDownloadTarget(video);
            resolved.push({ video, detail });
          }
          const downloadQuality = await requestDownloadQuality(
            resolved.map(({ detail }) => ({ bvid: detail.bvid, cid: detail.cid } satisfies DownloadQualityTarget))
          );
          if (downloadQuality) {
            for (const { video, detail } of resolved) {
              await invoke<string[]>("create_download_task", {
                params: {
                  bvid: detail.bvid,
                  cid: detail.cid,
                  title: detail.title || video.title,
                  cids: [detail.cid],
                  download_quality: downloadQuality,
                  group_id: groupId,
                  group_title: groupTitle,
                  group_total: resolved.length,
                },
              });
            }
          }
        }
      }
      if (downloadArticlesScope) {
        const allDynamics = await loadAllDynamics();
        await handleDownloadArticles(allDynamics, groupId, groupTitle, videoCount);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setDownloadingAll(false);
    }
  };

  const toggleCurrentVideoSelection = () => {
    const currentIds = videos.map((video) => video.bvid);
    const allSelected = currentIds.length > 0 && currentIds.every((id) => selectedVideoIds.has(id));
    setSelectedVideoIds(allSelected ? new Set() : new Set(currentIds));
  };

  const toggleVideoSelection = (bvid: string) => {
    setSelectedVideoIds((previous) => {
      const next = new Set(previous);
      if (next.has(bvid)) next.delete(bvid);
      else next.add(bvid);
      return next;
    });
  };

  const handleOpenDynamicBrowser = (url: string) => {
    if (!url) return;
    const normalized = url.startsWith("//")
      ? `https:${url}`
      : url.startsWith("/")
        ? `https://www.bilibili.com${url}`
        : url;
    void openExternalUrl(normalized).catch((err) => setError(String(err)));
  };

  const handleOpenDynamic = (item: UpDynamicItem) => {
    if (item.bvid) {
      openPlayer({
        kind: "video",
        bvid: item.bvid,
        title: item.major_title || item.text || "UP 动态视频",
        cover: item.major_cover,
      });
      return;
    }

    openContentDetail({
      id: item.id,
      kind: item.kind === "video" ? "dynamic" : item.kind || "dynamic",
      title: item.major_title,
      text: item.text,
      contentText: item.content_text,
      cover: item.major_cover,
      url: item.major_url,
      images: item.images || [],
      commentOid: item.comment_oid,
      commentType: item.comment_type,
      pubTs: item.pub_ts,
      typeLabel: item.type_label,
      author: {
        mid: item.author_mid || displayProfile.mid,
        name: item.author_name || displayProfile.name,
        face: item.author_face || displayProfile.face,
      },
    });
  };

  const headerStats = useMemo(
    () => [
      ["粉丝", formatNumber(displayProfile.follower)],
      ["关注", formatNumber(displayProfile.following)],
      ["投稿", formatNumber(videoTotal || displayProfile.archive_count)],
    ],
    [displayProfile.archive_count, displayProfile.follower, displayProfile.following, videoTotal]
  );

  if (!mid) {
    return (
      <div style={{ padding: "72px 44px", color: "var(--color-text-muted)" }}>
        <button type="button" onClick={closeUpProfile} style={backButtonStyle}>
          <ArrowLeft style={{ width: 16, height: 16 }} />
          返回
        </button>
        <div style={{ marginTop: "64px", textAlign: "center" }}>没有可查看的 UP 主信息</div>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", minHeight: "100%", padding: "36px 44px 52px" }}>
      <button type="button" onClick={closeUpProfile} style={backButtonStyle}>
        <ArrowLeft style={{ width: 16, height: 16 }} />
        返回
      </button>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          marginTop: "18px",
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr) auto",
          gap: "20px",
          alignItems: "center",
          padding: "22px",
          borderRadius: "16px",
          backgroundColor: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border)",
        }}
      >
        <ClickableAvatar src={displayProfile.face} alt={displayProfile.name} size={78} />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: "24px", lineHeight: 1.2, fontWeight: 800, color: "var(--color-text)" }}>{displayProfile.name || "UP 主"}</h1>
          <div style={{ marginTop: "8px", display: "flex", alignItems: "flex-start", gap: "10px", flexWrap: "wrap" }}>
            <p style={{ flex: "1 1 280px", color: "var(--color-text-muted)", fontSize: "13.5px", lineHeight: 1.6, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {displayProfile.sign || "这个 UP 主暂时没有填写简介"}
            </p>
            <PurpleRefreshButton loading={loading} onClick={handleRefresh} />
          </div>
          <div style={{ marginTop: "12px", display: "flex", gap: "16px", color: "var(--color-text-secondary)", fontSize: "13px", flexWrap: "wrap" }}>
            {headerStats.map(([label, value]) => (
              <span key={label}><strong style={{ color: "var(--color-text)" }}>{value}</strong> {label}</span>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <ActionButton onClick={() => void openExternalUrl(`https://space.bilibili.com/${mid}`).catch((err) => setError(String(err)))} icon={<ExternalLink style={{ width: 15, height: 15 }} />}>
            空间
          </ActionButton>
          <ActionButton disabled={downloadingAll || !videos.length} onClick={() => void handleDownloadVideos("loaded")} icon={downloadingAll ? <Loader2 className="animate-spin" style={{ width: 15, height: 15 }} /> : <Download style={{ width: 15, height: 15 }} />}>
            下载已加载
          </ActionButton>
          <ActionButton disabled={downloadingAll} onClick={() => setDownloadScopeOpen(true)} icon={downloadingAll ? <Loader2 className="animate-spin" style={{ width: 15, height: 15 }} /> : <Download style={{ width: 15, height: 15 }} />}>
            下载全部投稿
          </ActionButton>
        </div>
      </motion.section>

      {error ? (
        <div style={{ marginTop: "18px", padding: "12px 18px", borderRadius: "12px", backgroundColor: "var(--color-error-bg)", color: "var(--color-error-text)", fontSize: "13.5px" }}>
          {error}
        </div>
      ) : null}

      <div style={{ marginTop: "20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", padding: "4px", borderRadius: "11px", backgroundColor: "var(--color-border)", gap: "4px" }}>
          <TabButton active={activeTab === "videos"} onClick={() => setActiveTab("videos")} icon={<Video style={{ width: 15, height: 15 }} />}>
            投稿
          </TabButton>
          <TabButton active={activeTab === "dynamics"} onClick={() => setActiveTab("dynamics")} icon={<Rss style={{ width: 15, height: 15 }} />}>
            动态
          </TabButton>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px", flexWrap: "wrap" }}>
          {activeTab === "videos" ? (
            <>
              {multiSelectEnabled ? (
                <>
                  <ActionButton onClick={toggleCurrentVideoSelection} icon={<span aria-hidden="true">☑</span>}>
                    {videos.length > 0 && videos.every((video) => selectedVideoIds.has(video.bvid)) ? "取消全选" : "全选当前"}
                  </ActionButton>
                  <ActionButton
                    onClick={() => {
                      setMultiSelectEnabled(false);
                      setSelectedVideoIds(new Set());
                    }}
                    icon={<span aria-hidden="true">✓</span>}
                  >
                    取消
                  </ActionButton>
                  <ActionButton
                    disabled={downloadingAll || selectedVideoIds.size === 0}
                    onClick={() => void handleDownloadVideos("selected")}
                    icon={downloadingAll ? <Loader2 className="animate-spin" style={{ width: 15, height: 15 }} /> : <Download style={{ width: 15, height: 15 }} />}
                  >
                    下载选中({selectedVideoIds.size})
                  </ActionButton>
                </>
              ) : (
                <ActionButton
                  onClick={() => setMultiSelectEnabled(true)}
                  icon={<span aria-hidden="true">□</span>}
                >
                  多选
                </ActionButton>
              )}
            </>
          ) : null}
          {activeTab === "videos" ? (
            <PageCardControls
              layoutKey="up"
              viewMode={viewMode}
              onViewModeChange={(mode) => setCardViewMode("up", mode)}
              showLayoutControls={false}
            />
          ) : null}
        </div>
      </div>

      {loading ? (
        <div style={{ height: "260px", display: "grid", placeItems: "center" }}>
          <Loader2 className="animate-spin" style={{ width: 32, height: 32, color: "var(--color-primary)" }} />
        </div>
      ) : activeTab === "videos" ? (
        <>
          <div style={{ marginTop: "18px", display: "grid", gridTemplateColumns: viewMode === "grid" ? fixedCardGridColumns(columns) : "1fr", gap: `${14 * cardScale}px` }}>
            {videos.map((video) => (
              <UnifiedVideoCard
                key={video.bvid}
                scale={cardScale}
                video={{
                  bvid: video.bvid,
                  title: video.title,
                  pic: video.cover,
                  duration: video.duration,
                  pubdate: video.pubdate,
                  play: video.play,
                  favorite: video.favorite,
                  reply: video.reply,
                  author: { mid: displayProfile.mid, name: displayProfile.name, face: displayProfile.face },
                }}
                selectable={multiSelectEnabled}
                selected={selectedVideoIds.has(video.bvid)}
                onToggleSelection={() => toggleVideoSelection(video.bvid)}
                onPlay={() => multiSelectEnabled ? toggleVideoSelection(video.bvid) : openPlayer({ kind: "video", bvid: video.bvid, title: video.title, cover: video.cover })}
                onDownload={() => void handleDownloadOne(video)}
                onOpenBrowser={() => void openExternalUrl(biliVideoUrl(video.bvid)).catch((err) => setError(String(err)))}
              />
            ))}
          </div>
          {videos.length === 0 ? <EmptyState icon={<UserRound />} text="这个 UP 主暂时没有可展示的投稿" /> : null}
          {hasMoreVideos ? (
            <LoadMoreButton loading={loadingMore} onClick={() => void fetchVideos(videoPage + 1, "append")} />
          ) : null}
        </>
      ) : (
        <>
          <div style={{ marginTop: "18px", display: "grid", gap: "10px", maxWidth: "780px", marginLeft: "auto", marginRight: "auto" }}>
            {dynamics.map((item) => (
              <FollowingDynamicCard
                key={item.id || `${item.pub_ts}-${item.text}`}
                item={toRecommendDynamicItem(item, displayProfile)}
                onOpenAuthor={() => openUpProfile({ mid: item.author_mid || displayProfile.mid, name: item.author_name || displayProfile.name, face: item.author_face || displayProfile.face })}
                onOpenContent={() => handleOpenDynamic(item)}
                onOpenBrowser={handleOpenDynamicBrowser}
              />
            ))}
          </div>
          {dynamics.length === 0 ? <EmptyState icon={<Rss />} text="这个 UP 主暂时没有可展示的动态" /> : null}
          {hasMoreDynamics ? (
            <LoadMoreButton loading={loadingMore} onClick={() => void fetchDynamics(dynamicOffset, "append")} />
          ) : null}
        </>
      )}
      {downloadQualityDialog}
      {downloadScopeOpen ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 900, display: "grid", placeItems: "center", backgroundColor: "rgba(15,23,42,0.38)" }}>
          <div style={{ width: "min(420px, 92vw)", padding: "22px", borderRadius: "16px", backgroundColor: "var(--color-bg-secondary)", boxShadow: "0 22px 60px rgba(15,23,42,0.22)" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 850, color: "var(--color-text)" }}>选择下载内容</h2>
            <div style={{ marginTop: "16px", display: "grid", gap: "12px" }}>
              <label style={checkboxRowStyle}>
                <input type="checkbox" checked={downloadVideosScope} onChange={(event) => setDownloadVideosScope(event.target.checked)} />
                视频投稿
              </label>
              <label style={checkboxRowStyle}>
                <input type="checkbox" checked={downloadArticlesScope} onChange={(event) => setDownloadArticlesScope(event.target.checked)} />
                专栏图片
              </label>
            </div>
            <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <ActionButton onClick={() => setDownloadScopeOpen(false)} icon={<span aria-hidden="true">×</span>}>取消</ActionButton>
              <ActionButton disabled={downloadingAll || (!downloadVideosScope && !downloadArticlesScope)} onClick={() => void handleDownloadAllWorks()} icon={downloadingAll ? <Loader2 className="animate-spin" style={{ width: 15, height: 15 }} /> : <Download style={{ width: 15, height: 15 }} />}>开始下载</ActionButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const backButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  height: "36px",
  padding: "0 13px",
  borderRadius: "10px",
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-bg-secondary)",
  color: "var(--color-text-secondary)",
  fontSize: "13px",
  fontWeight: 700,
  cursor: "pointer",
};

const checkboxRowStyle: CSSProperties = {
  height: "40px",
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: "0 12px",
  borderRadius: "10px",
  border: "1px solid var(--color-border)",
  color: "var(--color-text)",
  fontSize: "14px",
  fontWeight: 750,
  cursor: "pointer",
};

function TabButton({ active, icon, children, onClick }: { active: boolean; icon: ReactNode; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: "34px",
        padding: "0 14px",
        borderRadius: "8px",
        border: "none",
        backgroundColor: active ? "var(--color-bg-elevated)" : "transparent",
        color: active ? "var(--color-primary-hover)" : "var(--color-text-secondary)",
        boxShadow: active ? "0 1px 4px rgba(65,65,95,0.09)" : "none",
        display: "inline-flex",
        alignItems: "center",
        gap: "7px",
        fontSize: "13px",
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {icon}
      {children}
    </button>
  );
}

function ActionButton({ children, icon, disabled = false, onClick }: { children: ReactNode; icon: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        height: "36px",
        padding: "0 13px",
        borderRadius: "10px",
        border: "1px solid var(--color-border)",
        backgroundColor: "var(--color-bg-secondary)",
        color: disabled ? "var(--color-text-disabled)" : "var(--color-text-secondary)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "7px",
        fontSize: "13px",
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {icon}
      {children}
    </button>
  );
}

function DynamicCard({
  item,
  onOpen,
  onOpenBrowser,
}: {
  item: UpDynamicItem;
  onOpen: (item: UpDynamicItem) => void;
  onOpenBrowser: (url: string) => void;
}) {
  const previewImages = Array.from(new Set([...(item.images || []), item.major_cover || ""])).filter(Boolean).slice(0, 4);
  return (
    <div
      onClick={() => onOpen(item)}
      style={{ display: "grid", gridTemplateColumns: previewImages.length ? "148px minmax(0, 1fr)" : "1fr", gap: "14px", padding: "15px", borderRadius: "14px", border: "1px solid var(--color-border)", backgroundColor: "var(--color-bg-secondary)", cursor: "pointer" }}
    >
      {previewImages.length ? (
        <div style={{ display: "grid", gridTemplateColumns: previewImages.length > 1 ? "1fr 1fr" : "1fr", gap: "4px", aspectRatio: "16 / 10", borderRadius: "10px", overflow: "hidden", backgroundColor: "var(--color-bg-subtle)" }}>
          {previewImages.map((image, index) => (
            <img
              key={`${image}-${index}`}
              src={formatBiliImageUrl(image, previewImages.length > 1 ? "@240w_240h_1c.webp" : "@412w_258h_1c.webp")}
              alt={item.major_title || "动态封面"}
              loading="lazy"
              referrerPolicy="no-referrer"
              style={{ width: "100%", height: "100%", objectFit: "cover", minHeight: 0 }}
            />
          ))}
        </div>
      ) : null}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "var(--color-text-muted)", fontSize: "12.5px", marginBottom: "7px" }}>
          <span>{item.type_label || "动态"}</span>
          <span>{formatDateTime(item.pub_ts)}</span>
        </div>
        {item.major_title ? (
          <h3 style={{ fontSize: "15px", fontWeight: 800, color: "var(--color-text)", lineHeight: 1.4, marginBottom: "6px" }}>{item.major_title}</h3>
        ) : null}
        <p style={{ color: "var(--color-text-secondary)", fontSize: "13.5px", lineHeight: 1.65, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {item.text ? `动态简介: ${item.text}` : (previewImages.length ? `共 ${item.images?.length || previewImages.length} 张图片` : "这条动态暂时没有文字内容")}
        </p>
        {item.content_text ? (
          <p style={{ marginTop: "4px", color: "var(--color-text-secondary)", fontSize: "13.5px", lineHeight: 1.65, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            内容简介: {item.content_text}
          </p>
        ) : null}
        <div style={{ marginTop: "10px", display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={(event) => { event.stopPropagation(); onOpen(item); }} style={{ border: "none", background: "transparent", color: "var(--color-primary)", fontSize: "13px", fontWeight: 700, cursor: "pointer", padding: 0 }}>
            {item.bvid ? "播放视频" : "查看详情"}
          </button>
          {item.major_url ? (
            <button type="button" onClick={(event) => { event.stopPropagation(); onOpenBrowser(item.major_url); }} style={{ border: "none", background: "transparent", color: "var(--color-text-muted)", fontSize: "13px", fontWeight: 700, cursor: "pointer", padding: 0 }}>
              浏览器打开
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function toRecommendDynamicItem(item: UpDynamicItem, profile: UpProfile): RecommendPageDynamicItem {
  const maybeItem = item as UpDynamicItem & Partial<RecommendPageDynamicItem>;
  return {
    id: item.id,
    author_mid: item.author_mid || profile.mid,
    author_name: item.author_name || profile.name,
    author_face: item.author_face || profile.face,
    kind: item.kind,
    type_label: item.type_label,
    action_text: maybeItem.action_text || "",
    text: item.text,
    content_text: item.content_text,
    topic_name: maybeItem.topic_name || "",
    pub_ts: item.pub_ts,
    major_title: item.major_title,
    major_cover: item.major_cover,
    major_url: item.major_url,
    bvid: item.bvid,
    aid: item.aid,
    images: item.images,
    comment_oid: item.comment_oid,
    comment_type: item.comment_type,
    duration_text: maybeItem.duration_text || "",
    view_count: maybeItem.view_count || 0,
    danmaku_count: maybeItem.danmaku_count || 0,
    repost_count: maybeItem.repost_count || 0,
    comment_count: maybeItem.comment_count || 0,
    like_count: maybeItem.like_count || 0,
  };
}

function extractArticleId(url: string) {
  const match = String(url || "").match(/(?:read\/cv|cv)(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function LoadMoreButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <div style={{ marginTop: "22px", display: "flex", justifyContent: "center" }}>
      <ActionButton disabled={loading} onClick={onClick} icon={loading ? <Loader2 className="animate-spin" style={{ width: 15, height: 15 }} /> : <RefreshCw style={{ width: 15, height: 15 }} />}>
        {loading ? "加载中" : "加载更多"}
      </ActionButton>
    </div>
  );
}

function EmptyState({ icon, text }: { icon: ReactElement; text: string }) {
  return (
    <div style={{ padding: "80px 0", display: "grid", placeItems: "center", gap: "12px", color: "var(--color-text-muted)" }}>
      <span style={{ width: "54px", height: "54px", borderRadius: "16px", backgroundColor: "var(--color-bg-subtle)", display: "grid", placeItems: "center", color: "var(--color-text-disabled)" }}>
        {icon}
      </span>
      <span style={{ fontSize: "14px", fontWeight: 700 }}>{text}</span>
    </div>
  );
}
