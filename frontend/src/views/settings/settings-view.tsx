import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  Bot,
  Cookie,
  Database,
  Download,
  ExternalLink,
  Eye,
  FolderOpen,
  Github,
  Info,
  Loader2,
  Maximize2,
  Monitor,
  MonitorPlay,
  Moon,
  Palette,
  Power,
  AlertCircle,
  CheckCircle2,
  Film,
  Globe,
  RefreshCw,
  RotateCcw,
  Settings2,
  Sun,
  Trash2,
  Type,
  Users,
} from "lucide-react";
import { motion } from "framer-motion";
import { DOWNLOAD_QUALITY_OPTIONS } from "@/components/download-quality-dialog";
import { LoginDialog } from "@/components/login-dialog";
import { invoke } from "@/lib/api";
import { openExternalUrl } from "@/lib/open-external";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FfmpegRuntimeStatus, FfmpegInstallProgress } from "@/lib/types";
import {
  CARD_LAYOUT_KEYS,
  DEFAULT_CARD_LAYOUT,
  DEFAULT_CARD_SCALE,
  DEFAULT_APP_FONT_SIZE,
  MIN_APP_FONT_SIZE,
  MAX_APP_FONT_SIZE,
  useAppStore,
  type CardLayoutKey,
} from "@/stores/app-store";
import { AiSettingsPanel, withAiSettings, type AiSettings } from "./ai-settings-panel";

type ThemeMode = "light" | "dark" | "system";
type CloseWindowBehavior = "ask" | "minimize_to_tray" | "exit";

interface BackendConfig {
  download_dir: string;
  start_maximized: boolean;
  close_window_behavior: CloseWindowBehavior;
  card_scale: number;
  card_page_size: number;
  card_page_rows: number;
  card_page_columns: number;
  sessdata: string;
  cookie?: string;
  theme: string;
  download_quality: string;
  prompt_download_quality: boolean;
  show_comments: boolean;
  task_concurrency: number;
  proxy_mode?: "system" | "no_proxy" | "custom" | string;
  proxy_host?: string;
  proxy_port?: number;
  custom_ffmpeg_path?: string | null;
  ai?: AiSettings;
  [key: string]: unknown;
}

interface UpdateCheckResult {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  release_name?: string | null;
  release_url: string;
  body: string;
  asset?: {
    name: string;
    url: string;
    size: number;
  } | null;
  installable: boolean;
}

interface CacheBucketInfo {
  label: string;
  path: string;
  file_count: number;
  total_bytes: number;
}

interface CacheOverview {
  page_cache: CacheBucketInfo;
  download_cache: CacheBucketInfo;
}

interface SavedAccountProfile {
  profile: string;
  username: string;
  mid: number;
  face: string;
  active: boolean;
}

interface AccountSwitchResult {
  config: BackendConfig;
  user_info: {
    uname: string;
    face: string;
    login_time?: string | null;
    isLogin?: boolean;
    is_login?: boolean;
  } | null;
}

const PAGE_REFRESH_STEPS = [
  "首页",
  "搜索内容",
  "推荐/关注动态",
  "我的点赞/收藏",
  "稍后再看",
  "观看历史",
  "追番追剧",
  "下载列表",
  "设置",
];

const CARD_PAGE_LABELS: Record<CardLayoutKey, string> = {
  search: "搜索内容",
  recommend: "首页推荐",
  dynamic: "关注动态",
  favorites: "我的点赞/收藏",
  watchlater: "稍后再看",
  history: "观看历史",
  bangumi: "追番追剧",
  up: "UP 主页",
};

const PREVIEW_ITEMS = [
  { title: "测试视频标题 A", author: "示例 UP 主", note: "12.8万播放 · 2小时前" },
  { title: "动态更新内容 B", author: "关注作者", note: "图片动态 · 评论 36" },
  { title: "收藏夹作品 C", author: "收藏夹来源", note: "已收藏 · 08:24" },
  { title: "观看历史 D", author: "历史记录", note: "看到 62%" },
  { title: "番剧剧集 E", author: "追番追剧", note: "第 03 话" },
  { title: "UP 投稿 F", author: "UP 主页", note: "昨日更新" },
];

export function parseProxyUrl(raw: string): { host: string; port: number } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(?:([a-zA-Z][a-zA-Z0-9+.-]*):\/\/)?([^/:]+):(\d+)$/);
  if (match) {
    const scheme = match[1] ? `${match[1].toLowerCase()}://` : "http://";
    const hostname = match[2];
    const port = parseInt(match[3], 10);
    if (port >= 1 && port <= 65535 && hostname.length > 0) {
      return { host: `${scheme}${hostname}`, port };
    }
  }
  return null;
}

const PROJECT_GITHUB_URL = "https://github.com/RoamerFly/Bilibili_Box";
const DEVELOPER_GITHUB_URL = "https://github.com/RoamerFly";
const ISSUES_URL = "https://github.com/RoamerFly/Bilibili_Box/issues";

export function SettingsView() {
  const userInfo = useAppStore((s) => s.userInfo);
  const setConfig = useAppStore((s) => s.setConfig);
  const setUserInfo = useAppStore((s) => s.setUserInfo);
  const resetAccountScopedState = useAppStore((s) => s.resetAccountScopedState);
  const cardLayouts = useAppStore((s) => s.cardLayouts);
  const cardScales = useAppStore((s) => s.cardScales);
  const setCardLayout = useAppStore((s) => s.setCardLayout);
  const setCardScale = useAppStore((s) => s.setCardScale);
  const setAllCardLayouts = useAppStore((s) => s.setAllCardLayouts);
  const setAllCardScales = useAppStore((s) => s.setAllCardScales);
  const appFontSize = useAppStore((s) => s.appFontSize ?? DEFAULT_APP_FONT_SIZE);
  const setAppFontSize = useAppStore((s) => s.setAppFontSize);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [aboutDialogOpen, setAboutDialogOpen] = useState(false);
  const [appVersion, setAppVersion] = useState("1.2.1");
  const [updating, setUpdating] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheStepIndex, setCacheStepIndex] = useState(-1);
  const [cacheOverview, setCacheOverview] = useState<CacheOverview | null>(null);
  const [cacheDialogOpen, setCacheDialogOpen] = useState(false);
  const [cardSettingsOpen, setCardSettingsOpen] = useState(false);
  const [accounts, setAccounts] = useState<SavedAccountProfile[]>([]);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [addAccountDialogOpen, setAddAccountDialogOpen] = useState(false);
  const [accountSwitching, setAccountSwitching] = useState("");
  const [accountDeleting, setAccountDeleting] = useState("");
  const [feedback, setFeedback] = useState("");
  const [activeSettingsTab, setActiveSettingsTab] = useState<"general" | "ai">("general");
  const [backendConfig, setBackendConfig] = useState<BackendConfig | null>(null);
  const backendConfigRef = useRef<BackendConfig | null>(null);
  const [unifiedCardLayoutDraft, setUnifiedCardLayoutDraft] = useState<{ rows: number; columns: number }>({
    rows: DEFAULT_CARD_LAYOUT.rows,
    columns: DEFAULT_CARD_LAYOUT.columns,
  });

  const syncBackendConfig = useCallback((nextConfig: BackendConfig) => {
    backendConfigRef.current = nextConfig;
    setBackendConfig(nextConfig);
    setConfig(nextConfig);
  }, [setConfig]);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const nextConfig = await invoke<BackendConfig>("get_config");
      syncBackendConfig(nextConfig);
    } finally {
      setLoading(false);
    }
  }, [syncBackendConfig]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    void getVersion().then(setAppVersion).catch(() => {});
  }, []);

  const storeConfig = useAppStore((s) => s.config);
  useEffect(() => {
    if (storeConfig && typeof storeConfig === "object") {
      setBackendConfig((prev) => {
        if (!prev) return storeConfig as unknown as BackendConfig;
        return { ...prev, ...storeConfig } as BackendConfig;
      });
    }
  }, [storeConfig]);

  const saveConfig = useCallback(
    async (updates: Partial<BackendConfig>) => {
      const currentConfig = backendConfigRef.current ?? backendConfig ?? (await invoke<BackendConfig>("get_config"));
      const nextConfig = { ...currentConfig, ...updates };
      await invoke("save_config", { newConfig: nextConfig });
      syncBackendConfig(nextConfig);
    },
    [backendConfig, syncBackendConfig]
  );

  const isLoggedIn = useMemo(() => userInfo !== null, [userInfo]);
  const normalizedCardLayouts = useMemo(
    () =>
      CARD_LAYOUT_KEYS.map((key) => {
        const layout = cardLayouts[key] ?? DEFAULT_CARD_LAYOUT;
        return {
          key,
          rows: Math.max(1, Math.min(8, Math.round(layout.rows || DEFAULT_CARD_LAYOUT.rows))),
          columns: Math.max(1, Math.min(8, Math.round(layout.columns || DEFAULT_CARD_LAYOUT.columns))),
        };
      }),
    [cardLayouts]
  );
  const unifiedCardLayout = useMemo(() => {
    const first = normalizedCardLayouts[0] ?? DEFAULT_CARD_LAYOUT;
    const isUniform = normalizedCardLayouts.every((layout) => layout.rows === first.rows && layout.columns === first.columns);
    return {
      isUniform,
      rows: first.rows,
      columns: first.columns,
      label: isUniform ? `${first.rows} 行 x ${first.columns} 列` : "自定义",
    };
  }, [normalizedCardLayouts]);
  const normalizedCardScales = useMemo(
    () =>
      CARD_LAYOUT_KEYS.map((key) => ({
        key,
        scale: Math.max(0.7, Math.min(1.6, Number(cardScales[key] ?? backendConfig?.card_scale ?? DEFAULT_CARD_SCALE))),
      })),
    [backendConfig?.card_scale, cardScales]
  );
  const unifiedCardScale = useMemo(() => {
    const first = normalizedCardScales[0]?.scale ?? DEFAULT_CARD_SCALE;
    const isUniform = normalizedCardScales.every((item) => Math.abs(item.scale - first) < 0.001);
    return {
      isUniform,
      scale: first,
      label: isUniform ? `${Math.round(first * 100)}%` : "自定义",
    };
  }, [normalizedCardScales]);

  useEffect(() => {
    if (unifiedCardLayout.isUniform) {
      setUnifiedCardLayoutDraft({ rows: unifiedCardLayout.rows, columns: unifiedCardLayout.columns });
    }
  }, [unifiedCardLayout.columns, unifiedCardLayout.isUniform, unifiedCardLayout.rows]);
  const feedbackIsError = feedback.includes("失败") || feedback.includes("错误");

  const notifyAccountChanged = useCallback(() => {
    window.dispatchEvent(new CustomEvent("bilibili-box:account-switched"));
    window.dispatchEvent(new CustomEvent("bilibili-box:page-cache-cleared"));
  }, []);

  const applyAccountResult = useCallback((result: AccountSwitchResult) => {
    syncBackendConfig(result.config);
    setUserInfo(result.user_info ? {
      username: result.user_info.uname,
      avatar: result.user_info.face || "",
      loginTime: result.user_info.login_time || "--",
      deviceName: "Windows 桌面端",
    } : null);
    resetAccountScopedState();
    notifyAccountChanged();
  }, [notifyAccountChanged, resetAccountScopedState, setUserInfo, syncBackendConfig]);

  const handleLogout = async () => {
    setFeedback("");
    try {
      await invoke("clear_user_info");
      const guestConfig = await invoke<BackendConfig>("get_config");
      syncBackendConfig(guestConfig);
      setUserInfo(null);
      resetAccountScopedState();
      notifyAccountChanged();
      setFeedback("已退出登录，本地账号数据已保留");
    } catch (err) {
      setFeedback(`退出登录失败：${String(err)}`);
    }
  };

  const handleBrowseFolder = async () => {
    setFeedback("");
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择下载目录",
      });
      if (selected && typeof selected === "string") {
        await saveConfig({ download_dir: selected });
        setFeedback("下载目录已更新");
      }
    } catch (err) {
      setFeedback(`选择下载目录失败：${String(err)}`);
    }
  };

  // Proxy state and handlers
  const [proxyInput, setProxyInput] = useState("http://127.0.0.1:7890");

  useEffect(() => {
    if (backendConfig) {
      const host = backendConfig.proxy_host || "127.0.0.1";
      const port = backendConfig.proxy_port || 7890;
      const formatted = host.includes("://") ? `${host}:${port}` : `http://${host}:${port}`;
      setProxyInput(formatted);
    }
  }, [backendConfig?.proxy_host, backendConfig?.proxy_port]);

  const handleProxyModeChange = async (mode: "system" | "no_proxy" | "custom") => {
    if (mode === "custom") {
      const parsed = parseProxyUrl(proxyInput) || { host: "http://127.0.0.1", port: 7890 };
      await saveConfig({ proxy_mode: "custom", proxy_host: parsed.host, proxy_port: parsed.port });
      setFeedback(`已启用自定义代理：${parsed.host}:${parsed.port}`);
    } else {
      await saveConfig({ proxy_mode: mode });
      setFeedback(mode === "system" ? "已使用系统代理" : "已停用代理");
    }
  };

  const handleSaveProxyInput = async () => {
    const parsed = parseProxyUrl(proxyInput);
    if (!parsed) {
      setFeedback("代理格式无效，请输入如 http://127.0.0.1:7890");
      return;
    }
    await saveConfig({
      proxy_mode: "custom",
      proxy_host: parsed.host,
      proxy_port: parsed.port,
    });
    setFeedback(`代理配置已保存并生效：${parsed.host}:${parsed.port}`);
  };

  // FFmpeg runtime state and handlers
  const [ffmpegStatus, setFfmpegStatus] = useState<FfmpegRuntimeStatus | null>(null);
  const [ffmpegInstalling, setFfmpegInstalling] = useState(false);
  const [ffmpegProgress, setFfmpegProgress] = useState<FfmpegInstallProgress | null>(null);

  const loadFfmpegStatus = useCallback(async () => {
    try {
      const status = await invoke<FfmpegRuntimeStatus>("get_ffmpeg_runtime_status");
      setFfmpegStatus(status);
    } catch (err) {
      console.error("获取 FFmpeg 状态失败", err);
    }
  }, []);

  useEffect(() => {
    void loadFfmpegStatus();
  }, [loadFfmpegStatus]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<FfmpegInstallProgress>("ffmpeg-install-progress", (event) => {
        setFfmpegProgress(event.payload);
        if (event.payload.progress >= 100) {
          setTimeout(() => {
            setFfmpegInstalling(false);
            setFfmpegProgress(null);
            void loadFfmpegStatus();
          }, 1000);
        }
      }).then((fn) => {
        unlisten = fn;
      });
    });
    return () => {
      unlisten?.();
    };
  }, [loadFfmpegStatus]);

  const handleInstallFfmpeg = async () => {
    setFfmpegInstalling(true);
    setFfmpegProgress({
      stage: "正在连接下载服务器...",
      downloadedBytes: 0,
      totalBytes: 0,
      progress: 0,
      speedBps: 0,
    });
    try {
      const updated = await invoke<FfmpegRuntimeStatus>("install_ffmpeg_runtime");
      setFfmpegStatus(updated);
      setFeedback("FFmpeg 运行环境安装完成");
    } catch (err) {
      setFeedback(`安装 FFmpeg 失败：${String(err)}`);
    } finally {
      setFfmpegInstalling(false);
      setFfmpegProgress(null);
      void loadFfmpegStatus();
    }
  };

  const handleBrowseCustomFfmpeg = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: false,
        multiple: false,
        title: "选择 FFmpeg 可执行文件 (ffmpeg / ffmpeg.exe)",
        filters: [{ name: "可执行文件", extensions: ["exe", ""] }],
      });
      if (selected && typeof selected === "string") {
        const updated = await invoke<FfmpegRuntimeStatus>("set_custom_ffmpeg_path", { path: selected });
        setFfmpegStatus(updated);
        await saveConfig({ custom_ffmpeg_path: selected });
        setFeedback("已配置自定义 FFmpeg 路径");
      }
    } catch (err) {
      setFeedback(`设置 FFmpeg 路径失败：${String(err)}`);
    }
  };

  const handleResetCustomFfmpeg = async () => {
    try {
      const updated = await invoke<FfmpegRuntimeStatus>("set_custom_ffmpeg_path", { path: null });
      setFfmpegStatus(updated);
      await saveConfig({ custom_ffmpeg_path: null });
      setFeedback("已恢复默认自动检测 FFmpeg");
    } catch (err) {
      setFeedback(`恢复默认 FFmpeg 失败：${String(err)}`);
    }
  };

  const handleCloseWindowBehaviorChange = async (value: CloseWindowBehavior) => {
    setFeedback("");
    try {
      await saveConfig({ close_window_behavior: value });
      setFeedback("关闭窗口行为已保存");
    } catch (err) {
      setFeedback(`保存关闭窗口行为失败：${String(err)}`);
    }
  };

  const handleResetConfig = async () => {
    setResetting(true);
    setFeedback("");
    try {
      const restored = await invoke<BackendConfig>("reset_config");
      syncBackendConfig(restored);
      setFeedback("已恢复默认设置；AI 供应商配置与 API Key 未修改，请在 AI 设置中管理供应商");
    } catch (err) {
      setFeedback(`恢复默认设置失败：${String(err)}`);
    } finally {
      setResetting(false);
    }
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setFeedback("");
    try {
      const result = await invoke<UpdateCheckResult>("check_update");
      if (!result.update_available) {
        setFeedback(`当前已是最新版 ${result.current_version}`);
        return;
      }
      setUpdateResult(result);
      setUpdateDialogOpen(true);
    } catch (err) {
      setFeedback(`检查更新失败：${String(err)}`);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleDownloadUpdate = async () => {
    if (!updateResult) return;
    setUpdating(true);
    setFeedback("");
    try {
      await invoke("download_and_install_update");
      setFeedback("安装程序已启动，应用即将退出");
      setUpdateDialogOpen(false);
    } catch (err) {
      setFeedback(`下载更新失败：${String(err)}`);
    } finally {
      setUpdating(false);
    }
  };

  const handleOpenRelease = () => {
    if (!updateResult) return;
    void openExternalUrl(updateResult.release_url).catch((err) => {
      setFeedback(`打开发布页失败：${String(err)}`);
    });
  };

  const handleViewCache = async () => {
    setFeedback("");
    try {
      const overview = await invoke<CacheOverview>("get_cache_overview");
      setCacheOverview(overview);
      setCacheDialogOpen(true);
    } catch (err) {
      setFeedback(`查看缓存失败：${String(err)}`);
    }
  };

  const handleClearPageCacheOnly = async () => {
    setFeedback("");
    try {
      const overview = await invoke<CacheOverview>("clear_page_cache");
      setCacheOverview(overview);
      resetAccountScopedState();
      window.dispatchEvent(new CustomEvent("bilibili-box:page-cache-cleared"));
      setFeedback("已清理页面缓存");
    } catch (err) {
      setFeedback(`清理页面缓存失败：${String(err)}`);
    }
  };

  const handleClearDownloadCacheOnly = async () => {
    setFeedback("");
    try {
      const overview = await invoke<CacheOverview>("clear_download_cache");
      setCacheOverview(overview);
      setFeedback("已清理下载缓存");
    } catch (err) {
      setFeedback(`清理下载缓存失败：${String(err)}`);
    }
  };

  const handleClearCacheAndRefreshPages = async () => {
    setClearingCache(true);
    setCacheStepIndex(0);
    setFeedback("");
    try {
      const overview = await invoke<CacheOverview>("clear_page_cache");
      setCacheOverview(overview);
      resetAccountScopedState();
      window.dispatchEvent(new CustomEvent("bilibili-box:page-cache-cleared"));
      for (let index = 0; index < PAGE_REFRESH_STEPS.length; index += 1) {
        setCacheStepIndex(index);
        await new Promise((resolve) => window.setTimeout(resolve, 180));
      }
      setFeedback("已清空页面缓存，更新所有页面成功");
    } catch (err) {
      setFeedback(`清空页面缓存失败：${String(err)}`);
    } finally {
      setClearingCache(false);
      setCacheStepIndex(-1);
    }
  };

  const loadAccounts = useCallback(async () => {
    const savedAccounts = await invoke<SavedAccountProfile[]>("list_saved_accounts");
    setAccounts(savedAccounts);
  }, []);

  const handleOpenAccountSwitcher = async () => {
    setFeedback("");
    try {
      await loadAccounts();
      setAccountDialogOpen(true);
    } catch (err) {
      setFeedback(`读取账号列表失败：${String(err)}`);
    }
  };

  const handleSwitchAccount = async (profile: string) => {
    setAccountSwitching(profile);
    setFeedback("");
    try {
      const result = await invoke<AccountSwitchResult>("switch_account_profile", { profile });
      applyAccountResult(result);
      setAccountDialogOpen(false);
      setFeedback(`已切换到账号：${result.user_info?.uname || profile}`);
    } catch (err) {
      setFeedback(`切换账号失败：${String(err)}`);
    } finally {
      setAccountSwitching("");
    }
  };

  const handleDeleteAccount = async (profile: string, accountName?: string) => {
    if (!window.confirm(`确定删除本地账号数据「${accountName || profile}」吗？这会删除该账号的配置、缓存和下载目录。`)) {
      return;
    }
    setAccountDeleting(profile);
    setFeedback("");
    try {
      const result = await invoke<AccountSwitchResult>("delete_saved_account_data", { profile });
      applyAccountResult(result);
      await loadAccounts();
      setFeedback("账号数据已删除");
    } catch (err) {
      setFeedback(`删除账号数据失败：${String(err)}`);
    } finally {
      setAccountDeleting("");
    }
  };

  const handleLogoutAndDelete = async () => {
    setFeedback("");
    try {
      const savedAccounts = await invoke<SavedAccountProfile[]>("list_saved_accounts");
      const activeAccount = savedAccounts.find((account) => account.active);
      if (!activeAccount) {
        setFeedback("未找到当前账号的本地数据");
        return;
      }
      await handleDeleteAccount(activeAccount.profile, activeAccount.username);
    } catch (err) {
      setFeedback(`删除当前账号数据失败：${String(err)}`);
    }
  };

  const handleAiSettingsSaved = useCallback((settings: AiSettings) => {
    const currentConfig = backendConfigRef.current;
    if (!currentConfig) return;
    syncBackendConfig(withAiSettings(currentConfig, settings));
  }, [syncBackendConfig]);

  if (loading || !backendConfig) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "120px 20px",
          width: "100%",
          minHeight: "100%",
        }}
      >
        <Loader2 className="animate-spin" style={{ width: 32, height: 32, color: "var(--color-primary)" }} />
      </div>
    );
  }

  return (
    <div style={{ width: "100%", padding: "20px 24px 24px", minHeight: "100%" }}>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{ marginBottom: "14px" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
          <div>
            <h1 style={{ fontSize: "24px", fontWeight: 800, color: "var(--color-text)", lineHeight: 1.25 }}>
              设置
            </h1>
            <p style={{ fontSize: "14px", color: "var(--color-text-muted)", marginTop: "5px" }}>
              个性化配置 BiliBox
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => setAboutDialogOpen(true)}
              style={purpleAboutButtonStyle}
              title="关于 BiliBox (bilibili-box) 项目与 GitHub 仓库"
            >
              <Github style={{ width: 15, height: 15, marginRight: "6px" }} />
              关于
            </button>
            <button
              type="button"
              disabled={clearingCache}
              onClick={() => void handleViewCache()}
              style={{ ...secondaryButtonStyle, opacity: clearingCache ? 0.65 : 1 }}
            >
              <Database style={{ width: 15, height: 15, marginRight: "6px" }} />
              查看缓存
            </button>
            <button
              type="button"
              disabled={clearingCache || checkingUpdate || resetting}
              onClick={() => void handleClearCacheAndRefreshPages()}
              style={{ ...secondaryButtonStyle, opacity: clearingCache || checkingUpdate || resetting ? 0.65 : 1 }}
            >
              {clearingCache ? <Loader2 className="animate-spin" style={{ width: 15, height: 15, marginRight: "6px" }} /> : <Trash2 style={{ width: 15, height: 15, marginRight: "6px" }} />}
              清空页面缓存
            </button>
            <button
              type="button"
              disabled={checkingUpdate || resetting || clearingCache}
              onClick={() => void handleCheckUpdate()}
              style={{ ...secondaryButtonStyle, opacity: checkingUpdate || resetting || clearingCache ? 0.65 : 1 }}
            >
              <RefreshCw className={checkingUpdate ? "animate-spin" : undefined} style={{ width: 15, height: 15, marginRight: "6px" }} />
              {checkingUpdate ? "检查中" : "检查更新"}
            </button>
            <button
              type="button"
              disabled={resetting || checkingUpdate || clearingCache}
              onClick={() => void handleResetConfig()}
              title="通用恢复默认不会修改 AI 供应商配置或 API Key；供应商需在 AI 设置中管理"
              style={{ ...secondaryButtonStyle, opacity: resetting || checkingUpdate || clearingCache ? 0.65 : 1 }}
            >
              <RotateCcw style={{ width: 15, height: 15, marginRight: "6px" }} />
              {resetting ? "恢复中" : "恢复默认"}
            </button>
          </div>
        </div>
      </motion.div>

      <div
        role="tablist"
        aria-label="设置分类"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          width: "fit-content",
          maxWidth: "100%",
          marginBottom: "10px",
          padding: "4px",
          borderRadius: "11px",
          backgroundColor: "var(--color-bg-tertiary)",
          overflowX: "auto",
        }}
      >
        <SettingsTab
          id="settings-general-tab"
          controls="settings-general-panel"
          active={activeSettingsTab === "general"}
          icon={<Settings2 style={{ width: 16, height: 16 }} />}
          onClick={() => setActiveSettingsTab("general")}
        >
          通用设置
        </SettingsTab>
        <SettingsTab
          id="settings-ai-tab"
          controls="settings-ai-panel"
          active={activeSettingsTab === "ai"}
          icon={<Bot style={{ width: 16, height: 16 }} />}
          onClick={() => setActiveSettingsTab("ai")}
        >
          AI 设置
        </SettingsTab>
      </div>

      {feedback ? (
        <div
          role={feedbackIsError ? "alert" : "status"}
          aria-live={feedbackIsError ? "assertive" : "polite"}
          style={{
            marginBottom: "10px",
            padding: "11px 16px",
            borderRadius: "10px",
            backgroundColor: feedbackIsError ? "var(--color-error-bg)" : "var(--color-success-bg)",
            color: feedbackIsError ? "var(--color-error-text)" : "var(--color-success-text)",
            fontSize: "13.5px",
          }}
        >
          {feedback}
        </div>
      ) : null}

      {activeSettingsTab === "ai" ? (
        <div id="settings-ai-panel" role="tabpanel" aria-labelledby="settings-ai-tab" tabIndex={0}>
          <AiSettingsPanel onSettingsSaved={handleAiSettingsSaved} />
        </div>
      ) : (
      <div id="settings-general-panel" role="tabpanel" aria-labelledby="settings-general-tab" tabIndex={0}>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.35 }}
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderRadius: "14px",
          border: "1.5px solid var(--color-border)",
          overflow: "hidden",
        }}
      >
        <SettingRow
          icon={<Cookie style={{ width: 21, height: 21, color: "var(--color-warning-text)" }} />}
          iconBgColor="var(--color-warning-bg)"
          title="登录状态"
          description="使用 Bilibili 账号获取更多个人内容"
          control={
            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", justifyContent: "flex-end" }}>
              {isLoggedIn ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "5px 14px",
                    borderRadius: "8px",
                    fontSize: "13px",
                    fontWeight: 500,
                    backgroundColor: "var(--color-success-bg)",
                    color: "var(--color-success-text)",
                  }}
                >
                  已登录：{userInfo?.username}
                </span>
              ) : (
                <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>未登录</span>
              )}
              {isLoggedIn ? (
                <button onClick={() => void handleOpenAccountSwitcher()} style={secondaryButtonStyle}>
                  <Users style={{ width: 15, height: 15, marginRight: "6px" }} />
                  切换账号
                </button>
              ) : null}
              {isLoggedIn ? (
                <button onClick={() => void handleLogout()} style={secondaryButtonStyle}>
                  退出登录
                </button>
              ) : null}
              {isLoggedIn ? (
                <button onClick={() => void handleLogoutAndDelete()} style={{ ...secondaryButtonStyle, color: "var(--color-warning-text)", borderColor: "#fed7aa" }}>
                  <Trash2 style={{ width: 15, height: 15, marginRight: "6px" }} />
                  退出账号并删除数据
                </button>
              ) : null}
            </div>
          }
        />

        <SettingRow
          icon={<Palette style={{ width: 21, height: 21, color: "var(--color-primary)" }} />}
          iconBgColor="var(--color-primary-light)"
          title="外观主题"
          description="选择应用使用的配色模式"
          control={
            <ThemeSelector
              value={(backendConfig.theme as ThemeMode) || "system"}
              onChange={(val) => void saveConfig({ theme: val })}
            />
          }
        />

        <SettingRow
          icon={<Type style={{ width: 21, height: 21, color: "var(--color-purple)" }} />}
          iconBgColor="var(--color-purple-bg)"
          title="全局界面与字体缩放"
          description="调整全界面的字号与整体布局缩放（含导航栏与各页面），滑动实时生效"
          control={
            <FontSizeSliderControl
              value={appFontSize}
              onChange={(val) => setAppFontSize(val)}
            />
          }
        />

        <SettingRow
          icon={<Eye style={{ width: 21, height: 21, color: "var(--color-info-text)" }} />}
          iconBgColor="var(--color-info-bg)"
          title="是否显示评论区"
          description="控制视频播放页和动态详情页底部评论区容器的显示"
          control={
            <ToggleSwitch
              checked={backendConfig.show_comments !== false}
              onChange={(checked) => void saveConfig({ show_comments: checked })}
            />
          }
        />

        <SettingRow
          icon={<FolderOpen style={{ width: 21, height: 21, color: "#059669" }} />}
          iconBgColor="var(--color-success-bg)"
          title="下载目录"
          description="设置下载文件的默认保存位置"
          control={
            <div style={{ display: "flex", alignItems: "center", gap: "10px", maxWidth: "420px" }}>
              <span
                style={{
                  fontSize: "13.5px",
                  color: "var(--color-text)",
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                }}
              >
                {backendConfig.download_dir}
              </span>
              <button onClick={() => void handleBrowseFolder()} style={secondaryButtonStyle}>
                更改
              </button>
            </div>
          }
        />

        <SettingRow
          icon={<Film style={{ width: 21, height: 21, color: "#2563eb" }} />}
          iconBgColor="var(--color-primary-light)"
          title="媒体处理环境 (FFmpeg)"
          description="用于音视频混流合并与 MP3 转换的核心组件。已从安装包中分离，支持持久化独立环境或自定义本地路径。"
          control={
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 12px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 600,
                  backgroundColor: ffmpegStatus?.ready
                    ? ffmpegStatus.source === "custom"
                      ? "var(--color-purple-bg, rgba(147, 51, 234, 0.12))"
                      : ffmpegStatus.source === "system"
                        ? "var(--color-info-bg)"
                        : "var(--color-success-bg)"
                    : "var(--color-warning-bg)",
                  color: ffmpegStatus?.ready
                    ? ffmpegStatus.source === "custom"
                      ? "var(--color-purple, #9333ea)"
                      : ffmpegStatus.source === "system"
                        ? "var(--color-info-text)"
                        : "var(--color-success-text)"
                    : "var(--color-warning-text)",
                }}
                title={ffmpegStatus?.ffmpegPath ? `路径: ${ffmpegStatus.ffmpegPath}${ffmpegStatus.version ? `\n版本: ${ffmpegStatus.version}` : ""}` : undefined}
              >
                {ffmpegStatus?.ready ? (
                  <CheckCircle2 style={{ width: 15, height: 15 }} />
                ) : (
                  <AlertCircle style={{ width: 15, height: 15 }} />
                )}
                <span>
                  {ffmpegStatus?.ready
                    ? ffmpegStatus.source === "custom"
                      ? "自定义路径"
                      : ffmpegStatus.source === "system"
                        ? "系统环境"
                        : "已就绪"
                    : "未安装"}
                </span>
              </div>

              {ffmpegInstalling ? (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: "200px" }}>
                  <div style={{ flex: 1, height: "6px", borderRadius: "3px", backgroundColor: "var(--color-bg-tertiary)", overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.max(5, ffmpegProgress?.progress || 0)}%`,
                        backgroundColor: "var(--color-primary)",
                        transition: "width 0.2s ease",
                      }}
                    />
                  </div>
                  <span style={{ fontSize: "12px", color: "var(--color-text-secondary)", minWidth: "35px" }}>
                    {Math.round(ffmpegProgress?.progress || 0)}%
                  </span>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void handleInstallFfmpeg()}
                    style={ffmpegStatus?.ready ? secondaryButtonStyle : primaryButtonStyle}
                  >
                    <Download style={{ width: 14, height: 14, marginRight: "5px" }} />
                    {ffmpegStatus?.ready ? "重新下载" : "下载安装"}
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleBrowseCustomFfmpeg()}
                    style={secondaryButtonStyle}
                  >
                    选择本地路径
                  </button>

                  {ffmpegStatus?.source === "custom" ? (
                    <button
                      type="button"
                      onClick={() => void handleResetCustomFfmpeg()}
                      style={{ ...secondaryButtonStyle, color: "var(--color-text-muted)" }}
                      title="恢复默认自动检测"
                    >
                      <RotateCcw style={{ width: 13, height: 13, marginRight: "4px" }} />
                      恢复默认
                    </button>
                  ) : null}
                </>
              )}
            </div>
          }
        />

        <SettingRow
          icon={<Globe style={{ width: 21, height: 21, color: "#0284c7" }} />}
          iconBgColor="var(--color-info-bg)"
          title="网络代理"
          description="设置应用的网络连接代理（支持 HTTP/HTTPS 代理格式，如 http://127.0.0.1:7890）"
          control={
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <div style={{ display: "flex", alignItems: "center", padding: "3px", gap: "2px", backgroundColor: "var(--color-bg-tertiary)", borderRadius: "10px" }}>
                <ModeButton
                  active={(backendConfig.proxy_mode || "system") === "system"}
                  onClick={() => void handleProxyModeChange("system")}
                >
                  系统代理
                </ModeButton>
                <ModeButton
                  active={backendConfig.proxy_mode === "no_proxy"}
                  onClick={() => void handleProxyModeChange("no_proxy")}
                >
                  不使用代理
                </ModeButton>
                <ModeButton
                  active={backendConfig.proxy_mode === "custom"}
                  onClick={() => void handleProxyModeChange("custom")}
                >
                  自定义代理
                </ModeButton>
              </div>

              {backendConfig.proxy_mode === "custom" && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="text"
                    value={proxyInput}
                    onChange={(e) => setProxyInput(e.target.value)}
                    onBlur={() => void handleSaveProxyInput()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void handleSaveProxyInput();
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    placeholder="http://127.0.0.1:7890"
                    style={{
                      width: "190px",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1.5px solid var(--color-border)",
                      backgroundColor: "var(--color-bg-secondary)",
                      color: "var(--color-text)",
                      fontSize: "13px",
                      outline: "none",
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void handleSaveProxyInput()}
                    style={secondaryButtonStyle}
                  >
                    保存
                  </button>
                </div>
              )}
            </div>
          }
        />

        <SettingRow
          icon={<MonitorPlay style={{ width: 21, height: 21, color: "var(--color-info-text)" }} />}
          iconBgColor="var(--color-info-bg)"
          title="下载画质策略"
          description="可每次选择或使用默认画质；目标视频最高画质低于所选画质时，将自动下载其最高可用画质"
          control={
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <div style={{ display: "flex", alignItems: "center", padding: "3px", gap: "2px", backgroundColor: "var(--color-bg-tertiary)", borderRadius: "10px" }}>
                <ModeButton
                  active={backendConfig.prompt_download_quality}
                  onClick={() => void saveConfig({ prompt_download_quality: true })}
                >
                  每次询问
                </ModeButton>
                <ModeButton
                  active={!backendConfig.prompt_download_quality}
                  onClick={() => void saveConfig({ prompt_download_quality: false })}
                >
                  使用默认
                </ModeButton>
              </div>
              <Select
                value={backendConfig.download_quality}
                onValueChange={(val) => void saveConfig({ download_quality: val })}
              >
                <SelectTrigger style={{ ...selectStyle, opacity: backendConfig.prompt_download_quality ? 0.72 : 1 }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOWNLOAD_QUALITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      默认 {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
        />

        <SettingRow
          icon={<Maximize2 style={{ width: 21, height: 21, color: "#7c3aed" }} />}
          iconBgColor="var(--color-primary-light)"
          title="启动时最大化窗口"
          description="下次打开程序时直接使用最大化窗口"
          control={
            <ToggleSwitch
              checked={backendConfig.start_maximized}
              onChange={(checked) => void saveConfig({ start_maximized: checked })}
            />
          }
        />

        <SettingRow
          icon={<Power style={{ width: 21, height: 21, color: "#c2410c" }} />}
          iconBgColor="var(--color-warning-bg)"
          title="关闭窗口时"
          description="选择最小化到托盘后，窗口会隐藏，下载任务和后台处理仍会继续运行"
          control={
            <Select
              value={backendConfig.close_window_behavior || "ask"}
              onValueChange={(value) => void handleCloseWindowBehaviorChange(value as CloseWindowBehavior)}
            >
              <SelectTrigger style={{ ...selectStyle, minWidth: "190px" }} aria-label="关闭窗口时">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ask">每次询问</SelectItem>
                <SelectItem value="minimize_to_tray">最小化到托盘运行</SelectItem>
                <SelectItem value="exit">退出程序</SelectItem>
              </SelectContent>
            </Select>
          }
        />

        <SettingRow
          icon={<Monitor style={{ width: 21, height: 21, color: "#0f766e" }} />}
          iconBgColor="var(--color-info-bg)"
          title="卡片设置"
          description="统一或分别配置各页面的卡片行列数与卡片大小，并可实时预览效果。"
          control={
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <span
                style={{
                  minWidth: "116px",
                  padding: "8px 10px",
                  borderRadius: "9px",
                  backgroundColor: unifiedCardLayout.isUniform && unifiedCardScale.isUniform ? "var(--color-success-bg)" : "var(--color-warning-bg)",
                  color: unifiedCardLayout.isUniform && unifiedCardScale.isUniform ? "var(--color-success-text)" : "var(--color-warning-text)",
                  fontSize: "13px",
                  fontWeight: 800,
                  textAlign: "center",
                  whiteSpace: "nowrap",
                }}
              >
                {unifiedCardLayout.label} · {unifiedCardScale.label}
              </span>
              <button type="button" onClick={() => setCardSettingsOpen(true)} style={secondaryButtonStyle}>
                打开设置
              </button>
            </div>
          }
        />

        <SettingRow
          icon={<Monitor style={{ width: 21, height: 21, color: "#0f766e" }} />}
          iconBgColor="var(--color-info-bg)"
          title="并发下载数"
          description="控制同时进行的下载任务数量"
          control={
            <NumberStepper
              value={backendConfig.task_concurrency || 3}
              min={1}
              max={10}
              onChange={(value) => void saveConfig({ task_concurrency: value })}
            />
          }
        />

        <SettingRow
          icon={<Github style={{ width: 21, height: 21, color: "var(--color-purple, #9333ea)" }} />}
          iconBgColor="var(--color-purple-bg, rgba(147, 51, 234, 0.12))"
          title="关于项目"
          description="BiliBox (bilibili-box) 开源项目、GitHub 仓库与反馈"
          control={
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setAboutDialogOpen(true)}
                style={purpleAboutButtonStyle}
              >
                <Info style={{ width: 14, height: 14, marginRight: "5px" }} />
                关于详情
              </button>
              <button
                type="button"
                onClick={() => void openExternalUrl(PROJECT_GITHUB_URL)}
                style={{ ...secondaryButtonStyle, color: "var(--color-purple, #9333ea)", borderColor: "var(--color-purple-border, rgba(147, 51, 234, 0.35))" }}
              >
                <ExternalLink style={{ width: 14, height: 14, marginRight: "5px" }} />
                GitHub 仓库
              </button>
            </div>
          }
          isLast
        />
      </motion.div>
      </div>
      )}
      {cacheDialogOpen ? (
        <CacheDialog
          overview={cacheOverview}
          onClearPageCache={() => void handleClearPageCacheOnly()}
          onClearDownloadCache={() => void handleClearDownloadCacheOnly()}
          onClose={() => setCacheDialogOpen(false)}
        />
      ) : null}
      {cardSettingsOpen ? (
        <CardSettingsDialog
          backendConfig={backendConfig}
          cardLayouts={cardLayouts}
          cardScales={cardScales}
          unifiedLayout={unifiedCardLayout}
          unifiedScale={unifiedCardScale}
          unifiedLayoutDraft={unifiedCardLayoutDraft}
          onUnifiedLayoutDraftChange={setUnifiedCardLayoutDraft}
          onSetCardLayout={setCardLayout}
          onSetCardScale={setCardScale}
          onSetAllCardLayouts={async (layout) => {
            setAllCardLayouts(layout);
            await saveConfig({
              card_page_rows: layout.rows,
              card_page_columns: layout.columns,
              card_page_size: layout.rows * layout.columns,
            });
            setFeedback(`已统一卡片行列数为 ${layout.rows} 行 x ${layout.columns} 列`);
          }}
          onSetAllCardScales={async (scale) => {
            setAllCardScales(scale);
            await saveConfig({ card_scale: scale });
            setFeedback(`已统一卡片大小为 ${Math.round(scale * 100)}%`);
          }}
          onClose={() => setCardSettingsOpen(false)}
        />
      ) : null}
      {accountDialogOpen ? (
        <AccountSwitcherDialog
          accounts={accounts}
          switchingProfile={accountSwitching}
          deletingProfile={accountDeleting}
          onAddAccount={() => setAddAccountDialogOpen(true)}
          onSwitch={(profile) => void handleSwitchAccount(profile)}
          onDelete={(profile, username) => void handleDeleteAccount(profile, username)}
          onClose={() => setAccountDialogOpen(false)}
        />
      ) : null}
      {updateDialogOpen && updateResult ? (
        <UpdateDialog
          result={updateResult}
          updating={updating}
          onDownload={() => void handleDownloadUpdate()}
          onOpenRelease={handleOpenRelease}
          onClose={() => setUpdateDialogOpen(false)}
        />
      ) : null}
      {aboutDialogOpen ? (
        <AboutDialog
          onClose={() => setAboutDialogOpen(false)}
          version={updateResult?.current_version || appVersion}
        />
      ) : null}
      <LoginDialog
        open={addAccountDialogOpen}
        onClose={() => {
          setAddAccountDialogOpen(false);
          void loadAccounts();
        }}
      />
      {clearingCache ? <CacheRefreshOverlay activeIndex={cacheStepIndex} /> : null}
    </div>
  );
}

function SettingInfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        aria-label="查看说明"
        title="查看说明"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "17px",
          height: "17px",
          borderRadius: "50%",
          border: open ? "1.5px solid var(--color-primary)" : "1px solid var(--color-border)",
          backgroundColor: open ? "var(--color-primary-light)" : "var(--color-bg-tertiary)",
          color: open ? "var(--color-primary)" : "var(--color-text-muted)",
          cursor: "pointer",
          padding: 0,
          fontSize: "11px",
          fontWeight: 700,
          fontFamily: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif",
          fontStyle: "italic",
          transition: "all 0.18s ease",
          flexShrink: 0,
          lineHeight: 1,
        }}
      >
        i
      </button>
      {open && (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: 0,
            zIndex: 100,
            maxWidth: "300px",
            minWidth: "160px",
            padding: "8px 12px",
            borderRadius: "9px",
            backgroundColor: "var(--color-bg-secondary)",
            border: "1px solid var(--color-border)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            color: "var(--color-text)",
            fontSize: "12.5px",
            lineHeight: 1.45,
            whiteSpace: "normal",
            pointerEvents: "auto",
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

function SettingRow({
  icon,
  iconBgColor,
  title,
  description,
  control,
  isLast = false,
}: {
  icon: React.ReactNode;
  iconBgColor: string;
  title: string;
  description?: string;
  control: React.ReactNode;
  isLast?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
        padding: "16px 24px",
        borderBottom: isLast ? "none" : "1px solid var(--color-bg-subtle)",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "16px", flex: "1 1 280px", minWidth: "220px" }}>
        <div
          style={{
            width: "42px",
            height: "42px",
            borderRadius: "11px",
            backgroundColor: iconBgColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {icon}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flexWrap: "wrap" }}>
          <h3 style={{ fontSize: "15px", fontWeight: 600, color: "var(--color-text)", margin: 0 }}>
            {title}
          </h3>
          {description ? <SettingInfoTooltip text={description} /> : null}
        </div>
      </div>

      <div style={{ flexShrink: 0, marginLeft: "auto" }}>{control}</div>
    </div>
  );
}

function SettingsTab({
  id,
  controls,
  active,
  icon,
  onClick,
  children,
}: {
  id: string;
  controls: string;
  active: boolean;
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      id={id}
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "7px",
        minHeight: "36px",
        padding: "0 14px",
        border: active ? "1px solid var(--color-border)" : "1px solid transparent",
        borderRadius: "8px",
        backgroundColor: active ? "var(--color-bg-secondary)" : "transparent",
        color: active ? "var(--color-primary)" : "var(--color-text-secondary)",
        boxShadow: active ? "0 1px 3px rgba(15,23,42,0.08)" : "none",
        fontSize: "13.5px",
        fontWeight: active ? 650 : 500,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {icon}
      {children}
    </button>
  );
}

function CardSettingsDialog({
  backendConfig,
  cardLayouts,
  cardScales,
  unifiedLayout,
  unifiedScale,
  unifiedLayoutDraft,
  onUnifiedLayoutDraftChange,
  onSetCardLayout,
  onSetCardScale,
  onSetAllCardLayouts,
  onSetAllCardScales,
  onClose,
}: {
  backendConfig: BackendConfig | null;
  cardLayouts: Partial<Record<CardLayoutKey, { rows: number; columns: number }>>;
  cardScales: Partial<Record<CardLayoutKey, number>>;
  unifiedLayout: { isUniform: boolean; rows: number; columns: number; label: string };
  unifiedScale: { isUniform: boolean; scale: number; label: string };
  unifiedLayoutDraft: { rows: number; columns: number };
  onUnifiedLayoutDraftChange: React.Dispatch<React.SetStateAction<{ rows: number; columns: number }>>;
  onSetCardLayout: (key: CardLayoutKey, layout: Partial<{ rows: number; columns: number }>) => void;
  onSetCardScale: (key: CardLayoutKey, scale: number) => void;
  onSetAllCardLayouts: (layout: { rows: number; columns: number }) => Promise<void>;
  onSetAllCardScales: (scale: number) => Promise<void>;
  onClose: () => void;
}) {
  const [activeKey, setActiveKey] = useState<CardLayoutKey>("search");
  const [unifiedScaleDraft, setUnifiedScaleDraft] = useState(unifiedScale.scale || DEFAULT_CARD_SCALE);
  const activeLayout = cardLayouts[activeKey] ?? DEFAULT_CARD_LAYOUT;
  const activeScale = Math.max(0.7, Math.min(1.6, Number(cardScales[activeKey] ?? backendConfig?.card_scale ?? DEFAULT_CARD_SCALE)));
  const rows = Math.max(1, Math.min(8, Math.round(activeLayout.rows || DEFAULT_CARD_LAYOUT.rows)));
  const columns = Math.max(1, Math.min(8, Math.round(activeLayout.columns || DEFAULT_CARD_LAYOUT.columns)));
  const pageSize = rows * columns;
  const previewItems = PREVIEW_ITEMS.slice(0, Math.min(pageSize, PREVIEW_ITEMS.length));

  useEffect(() => {
    if (unifiedScale.isUniform) {
      setUnifiedScaleDraft(unifiedScale.scale);
    }
  }, [unifiedScale.isUniform, unifiedScale.scale]);

  const applyUnifiedLayout = async () => {
    const nextLayout = {
      rows: Math.max(1, Math.min(8, Math.round(unifiedLayoutDraft.rows || DEFAULT_CARD_LAYOUT.rows))),
      columns: Math.max(1, Math.min(8, Math.round(unifiedLayoutDraft.columns || DEFAULT_CARD_LAYOUT.columns))),
    };
    await onSetAllCardLayouts(nextLayout);
  };

  const applyUnifiedScale = async () => {
    const nextScale = Math.max(0.7, Math.min(1.6, Number(unifiedScaleDraft) || DEFAULT_CARD_SCALE));
    await onSetAllCardScales(nextScale);
  };

  return (
    <div style={dialogBackdropStyle} onClick={onClose}>
      <div style={{ ...dialogPanelStyle, width: "min(980px, 100%)" }} onClick={(event) => event.stopPropagation()}>
        <div style={dialogHeaderStyle}>
          <div>
            <h2 style={dialogTitleStyle}>卡片设置</h2>
            <p style={{ marginTop: "4px", color: "var(--color-text-muted)", fontSize: "13px" }}>
              分页面调整行列数和卡片大小，也可以一键统一所有页面。
            </p>
          </div>
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>关闭</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(280px, 0.9fr)", gap: "16px", alignItems: "start" }}>
          <div style={{ display: "grid", gap: "12px" }}>
            <div style={{ padding: "14px", borderRadius: "13px", border: "1px solid var(--color-border)", backgroundColor: "var(--color-bg-subtle)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                <div>
                  <strong style={{ color: "var(--color-text)", fontSize: "14px" }}>统一行列数</strong>
                  <div style={{ color: unifiedLayout.isUniform ? "var(--color-success-text)" : "var(--color-warning-text)", fontSize: "12.5px", marginTop: "3px", fontWeight: 700 }}>
                    当前：{unifiedLayout.label}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <StepperField
                    label="行"
                    value={unifiedLayoutDraft.rows}
                    min={1}
                    max={8}
                    onChange={(rows) => onUnifiedLayoutDraftChange((previous) => ({ ...previous, rows }))}
                  />
                  <StepperField
                    label="列"
                    value={unifiedLayoutDraft.columns}
                    min={1}
                    max={8}
                    onChange={(columns) => onUnifiedLayoutDraftChange((previous) => ({ ...previous, columns }))}
                  />
                  <button type="button" onClick={() => void applyUnifiedLayout()} style={secondaryButtonStyle}>一键统一</button>
                </div>
              </div>
            </div>

            <div style={{ padding: "14px", borderRadius: "13px", border: "1px solid var(--color-border)", backgroundColor: "var(--color-bg-subtle)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                <div>
                  <strong style={{ color: "var(--color-text)", fontSize: "14px" }}>统一卡片大小</strong>
                  <div style={{ color: unifiedScale.isUniform ? "var(--color-success-text)" : "var(--color-warning-text)", fontSize: "12.5px", marginTop: "3px", fontWeight: 700 }}>
                    当前：{unifiedScale.label}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <ScaleSlider value={unifiedScaleDraft} onChange={setUnifiedScaleDraft} />
                  <button type="button" onClick={() => void applyUnifiedScale()} style={secondaryButtonStyle}>一键统一</button>
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gap: "10px" }}>
              {CARD_LAYOUT_KEYS.map((key) => {
                const layout = cardLayouts[key] ?? DEFAULT_CARD_LAYOUT;
                const safeRows = Math.max(1, Math.min(8, Math.round(layout.rows || DEFAULT_CARD_LAYOUT.rows)));
                const safeColumns = Math.max(1, Math.min(8, Math.round(layout.columns || DEFAULT_CARD_LAYOUT.columns)));
                const safeScale = Math.max(0.7, Math.min(1.6, Number(cardScales[key] ?? backendConfig?.card_scale ?? DEFAULT_CARD_SCALE)));
                const active = key === activeKey;
                return (
                  <div
                    key={key}
                    role="button"
                    tabIndex={0}
                    onClick={() => setActiveKey(key)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setActiveKey(key);
                      }
                    }}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "118px minmax(0, 1fr)",
                      gap: "12px",
                      alignItems: "center",
                      padding: "12px",
                      borderRadius: "13px",
                      border: active ? "1.5px solid var(--color-primary)" : "1px solid var(--color-border)",
                      backgroundColor: active ? "var(--color-primary-light)" : "var(--color-bg-secondary)",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <span>
                      <strong style={{ display: "block", color: "var(--color-text)", fontSize: "13.5px" }}>{CARD_PAGE_LABELS[key]}</strong>
                      <span style={{ color: "var(--color-text-muted)", fontSize: "12px" }}>{safeRows} 行 x {safeColumns} 列 · {Math.round(safeScale * 100)}%</span>
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <StepperField label="行" value={safeRows} min={1} max={8} onChange={(rows) => onSetCardLayout(key, { rows })} />
                      <StepperField label="列" value={safeColumns} min={1} max={8} onChange={(columns) => onSetCardLayout(key, { columns })} />
                      <ScaleSlider value={safeScale} onChange={(scale) => onSetCardScale(key, scale)} compact />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ position: "sticky", top: 0, padding: "14px", borderRadius: "14px", border: "1px solid var(--color-border)", backgroundColor: "var(--color-bg-secondary)", boxShadow: "0 10px 28px rgba(15,23,42,0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "12px" }}>
              <div>
                <strong style={{ color: "var(--color-text)", fontSize: "14px" }}>{CARD_PAGE_LABELS[activeKey]}预览</strong>
                <div style={{ color: "var(--color-text-muted)", fontSize: "12.5px", marginTop: "3px" }}>
                  {rows} 行 x {columns} 列，每页 {pageSize} 张，大小 {Math.round(activeScale * 100)}%
                </div>
              </div>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gap: `${10 * activeScale}px`,
                padding: "12px",
                borderRadius: "13px",
                backgroundColor: "var(--color-bg)",
              }}
            >
              {previewItems.map((item, index) => (
                <div
                  key={`${item.title}-${index}`}
                  style={{
                    borderRadius: `${10 * activeScale}px`,
                    overflow: "hidden",
                    border: "1px solid var(--color-border)",
                    backgroundColor: "var(--color-bg-secondary)",
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      height: `${72 * activeScale}px`,
                      background: `linear-gradient(135deg, ${index % 2 ? "var(--color-info-bg)" : "#fce7f3"}, ${index % 2 ? "var(--color-primary-light)" : "var(--color-info-bg)"})`,
                    }}
                  />
                  <div style={{ padding: `${8 * activeScale}px`, display: "grid", gap: `${5 * activeScale}px` }}>
                    <strong style={{ color: "var(--color-text)", fontSize: `${12.5 * activeScale}px`, lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.title}
                    </strong>
                    <span style={{ color: "var(--color-primary)", fontSize: `${11.5 * activeScale}px`, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.author}</span>
                    <span style={{ color: "var(--color-text-muted)", fontSize: `${11 * activeScale}px`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.note}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CacheDialog({
  overview,
  onClearPageCache,
  onClearDownloadCache,
  onClose,
}: {
  overview: CacheOverview | null;
  onClearPageCache: () => void;
  onClearDownloadCache: () => void;
  onClose: () => void;
}) {
  return (
    <div style={dialogBackdropStyle} onClick={onClose}>
      <div style={dialogPanelStyle} onClick={(event) => event.stopPropagation()}>
        <div style={dialogHeaderStyle}>
          <h2 style={dialogTitleStyle}>缓存情况</h2>
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>关闭</button>
        </div>
        {overview ? (
          <div style={{ display: "grid", gap: "12px" }}>
            <CacheBucketCard bucket={overview.page_cache} actionLabel="清理页面缓存" onAction={onClearPageCache} />
            <CacheBucketCard bucket={overview.download_cache} actionLabel="清理下载缓存" onAction={onClearDownloadCache} />
          </div>
        ) : (
          <div style={{ color: "var(--color-text-muted)", fontSize: "14px" }}>暂无缓存数据</div>
        )}
      </div>
    </div>
  );
}

function CacheBucketCard({ bucket, actionLabel, onAction }: { bucket: CacheBucketInfo; actionLabel: string; onAction: () => void }) {
  return (
    <div style={{ padding: "14px 16px", borderRadius: "12px", border: "1px solid var(--color-border)", backgroundColor: "var(--color-bg-subtle)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
        <strong style={{ color: "var(--color-text)", fontSize: "15px" }}>{bucket.label}</strong>
        <span style={{ color: "var(--color-primary)", fontWeight: 800, fontSize: "13px" }}>{formatBytes(bucket.total_bytes)}</span>
      </div>
      <div style={{ marginTop: "8px", color: "var(--color-text-muted)", fontSize: "13px", lineHeight: 1.65 }}>
        <div>文件数：{bucket.file_count}</div>
        <div style={{ wordBreak: "break-all" }}>目录：{bucket.path}</div>
      </div>
      <button type="button" onClick={onAction} style={{ ...secondaryButtonStyle, marginTop: "12px" }}>
        <Trash2 style={{ width: 14, height: 14, marginRight: "6px" }} />
        {actionLabel}
      </button>
    </div>
  );
}

function UpdateDialog({
  result,
  updating,
  onDownload,
  onOpenRelease,
  onClose,
}: {
  result: UpdateCheckResult;
  updating: boolean;
  onDownload: () => void;
  onOpenRelease: () => void;
  onClose: () => void;
}) {
  const canInstall = Boolean(result.asset && result.installable);
  const downloadLabel =
    result.asset && result.asset.size > 0 ? `下载更新 (${formatBytes(result.asset.size)})` : "下载更新";

  return (
    <div style={dialogBackdropStyle} onClick={onClose}>
      <div style={{ ...dialogPanelStyle, width: "min(640px, 100%)" }} onClick={(event) => event.stopPropagation()}>
        <div style={dialogHeaderStyle}>
          <div style={{ minWidth: 0 }}>
            <h2 style={dialogTitleStyle}>发现新版本 {result.latest_version}</h2>
            {result.release_name ? (
              <p style={{ marginTop: "3px", color: "var(--color-text-muted)", fontSize: "12.5px" }}>
                {result.release_name}
              </p>
            ) : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
            <button type="button" onClick={onOpenRelease} style={secondaryButtonStyle}>
              <ExternalLink style={{ width: 15, height: 15, marginRight: "6px" }} />
              前往发布页
            </button>
            <button type="button" onClick={onClose} style={secondaryButtonStyle}>
              关闭
            </button>
          </div>
        </div>

        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-secondary)", marginBottom: "8px" }}>
            当前版本 {result.current_version} → {result.latest_version}
          </div>
          {result.body ? (
            <div
              style={{
                maxHeight: "320px",
                overflowY: "auto",
                padding: "14px 16px",
                borderRadius: "12px",
                border: "1px solid var(--color-border)",
                backgroundColor: "var(--color-bg-subtle)",
                color: "var(--color-text)",
                fontSize: "13.5px",
                lineHeight: 1.7,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {result.body}
            </div>
          ) : (
            <div style={{ color: "var(--color-text-muted)", fontSize: "13.5px", padding: "12px 0" }}>
              该版本未提供更新说明。
            </div>
          )}
        </div>

        {!canInstall ? (
          <div
            style={{
              marginBottom: "16px",
              padding: "11px 14px",
              borderRadius: "10px",
              backgroundColor: "var(--color-warning-bg)",
              color: "var(--color-warning-text)",
              fontSize: "13px",
              lineHeight: 1.6,
            }}
          >
            {result.asset
              ? "当前更新包缺少数字签名，暂不支持应用内下载，请前往发布页手动安装。"
              : "没有适合当前系统的安装包，请前往发布页手动下载。"}
          </div>
        ) : null}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px" }}>
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>
            稍后再说
          </button>
          {canInstall ? (
            <button
              type="button"
              disabled={updating}
              onClick={onDownload}
              style={{ ...primaryButtonStyle, opacity: updating ? 0.65 : 1 }}
            >
              {updating ? (
                <Loader2 className="animate-spin" style={{ width: 15, height: 15, marginRight: "6px" }} />
              ) : (
                <Download style={{ width: 15, height: 15, marginRight: "6px" }} />
              )}
              {updating ? "下载中" : downloadLabel}
            </button>
          ) : (
            <button type="button" onClick={onOpenRelease} style={primaryButtonStyle}>
              <ExternalLink style={{ width: 15, height: 15, marginRight: "6px" }} />
              前往发布页
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AboutDialog({
  onClose,
  version = "1.2.1",
}: {
  onClose: () => void;
  version?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(PROJECT_GITHUB_URL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <div style={dialogBackdropStyle} onClick={onClose}>
      <div style={{ ...dialogPanelStyle, width: "min(520px, 100%)" }} onClick={(event) => event.stopPropagation()}>
        <div style={dialogHeaderStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "38px",
                height: "38px",
                borderRadius: "10px",
                backgroundColor: "var(--color-purple-bg, rgba(147, 51, 234, 0.1))",
                display: "grid",
                placeItems: "center",
                color: "var(--color-purple, #9333ea)",
                flexShrink: 0,
              }}
            >
              <Github style={{ width: 22, height: 22 }} />
            </div>
            <div>
              <h2 style={{ ...dialogTitleStyle, fontSize: "17px" }}>关于 BiliBox (bilibili-box)</h2>
              <p style={{ marginTop: "2px", color: "var(--color-text-muted)", fontSize: "12.5px" }}>
                基于 Rust + React 构建的哔哩哔哩媒体桌面客户端
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>关闭</button>
        </div>

        <div style={{ display: "grid", gap: "12px", marginTop: "4px" }}>
          <div
            style={{
              padding: "14px 16px",
              borderRadius: "12px",
              border: "1.5px solid var(--color-purple-border, rgba(147, 51, 234, 0.35))",
              backgroundColor: "var(--color-purple-bg, rgba(147, 51, 234, 0.05))",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
              <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-purple, #9333ea)" }}>
                GitHub 项目开源地址
              </span>
              <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>v{version}</span>
            </div>
            <div style={{ fontSize: "13.5px", fontWeight: 650, color: "var(--color-text)", wordBreak: "break-all" }}>
              {PROJECT_GITHUB_URL}
            </div>
            <div style={{ display: "flex", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => void openExternalUrl(PROJECT_GITHUB_URL)}
                style={{
                  ...secondaryButtonStyle,
                  backgroundColor: "var(--color-purple, #9333ea)",
                  borderColor: "var(--color-purple, #9333ea)",
                  color: "#ffffff",
                  fontWeight: 700,
                }}
              >
                <ExternalLink style={{ width: 14, height: 14, marginRight: "5px" }} />
                打开 GitHub 仓库
              </button>
              <button
                type="button"
                onClick={() => void handleCopyUrl()}
                style={{
                  ...secondaryButtonStyle,
                  borderColor: "var(--color-purple-border, rgba(147, 51, 234, 0.35))",
                  color: "var(--color-purple, #9333ea)",
                }}
              >
                {copied ? "已复制链接" : "复制仓库链接"}
              </button>
            </div>
          </div>

          <div
            style={{
              padding: "14px 16px",
              borderRadius: "12px",
              border: "1px solid var(--color-border)",
              backgroundColor: "var(--color-bg-subtle)",
              display: "grid",
              gap: "11px",
              fontSize: "13px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "var(--color-text-muted)" }}>项目名称</span>
              <span style={{ fontWeight: 700, color: "var(--color-text)" }}>Bilibili Box (bilibili-box)</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "var(--color-text-muted)" }}>开发者</span>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontWeight: 700, color: "var(--color-text)" }}>RoamerFly</span>
                <button
                  type="button"
                  onClick={() => void openExternalUrl(DEVELOPER_GITHUB_URL)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "var(--color-primary)",
                    cursor: "pointer",
                    padding: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "2px",
                    fontSize: "12px",
                    fontWeight: 600,
                  }}
                >
                  GitHub 主页 <ExternalLink style={{ width: 11, height: 11 }} />
                </button>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "var(--color-text-muted)" }}>问题反馈与需求建议</span>
              <button
                type="button"
                onClick={() => void openExternalUrl(ISSUES_URL)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--color-primary)",
                  cursor: "pointer",
                  padding: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "2px",
                  fontSize: "12px",
                  fontWeight: 600,
                }}
              >
                GitHub Issues <ExternalLink style={{ width: 11, height: 11 }} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountSwitcherDialog({
  accounts,
  switchingProfile,
  deletingProfile,
  onAddAccount,
  onSwitch,
  onDelete,
  onClose,
}: {
  accounts: SavedAccountProfile[];
  switchingProfile: string;
  deletingProfile: string;
  onAddAccount: () => void;
  onSwitch: (profile: string) => void;
  onDelete: (profile: string, username?: string) => void;
  onClose: () => void;
}) {
  return (
    <div style={dialogBackdropStyle} onClick={onClose}>
      <div style={dialogPanelStyle} onClick={(event) => event.stopPropagation()}>
        <div style={dialogHeaderStyle}>
          <h2 style={dialogTitleStyle}>切换账号</h2>
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>关闭</button>
        </div>
        <button
          type="button"
          onClick={onAddAccount}
          disabled={Boolean(switchingProfile) || Boolean(deletingProfile)}
          style={{
            ...secondaryButtonStyle,
            width: "100%",
            marginBottom: "12px",
            borderStyle: "dashed",
            color: "var(--color-primary)",
            fontWeight: 800,
          }}
        >
          添加账号
        </button>
        {accounts.length ? (
          <div style={{ display: "grid", gap: "10px" }}>
            {accounts.map((account) => (
              <div
                key={account.profile}
                style={{
                  display: "grid",
                  gridTemplateColumns: "42px minmax(0, 1fr) auto auto",
                  alignItems: "center",
                  gap: "12px",
                  padding: "12px",
                  borderRadius: "12px",
                  border: account.active ? "1.5px solid var(--color-primary)" : "1px solid var(--color-border)",
                  backgroundColor: account.active ? "var(--color-primary-light)" : "var(--color-bg-secondary)",
                  textAlign: "left",
                }}
              >
                <img
                  src={account.face}
                  alt={account.username}
                  referrerPolicy="no-referrer"
                  style={{ width: 42, height: 42, borderRadius: "50%", objectFit: "cover", backgroundColor: "var(--color-primary-light)" }}
                />
                <span style={{ minWidth: 0 }}>
                  <strong style={{ display: "block", color: "var(--color-text)", fontSize: "14px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.username}</strong>
                  <span style={{ color: "var(--color-text-muted)", fontSize: "12.5px" }}>UID {account.mid}</span>
                </span>
                <button
                  type="button"
                  disabled={account.active || Boolean(switchingProfile) || Boolean(deletingProfile)}
                  onClick={() => onSwitch(account.profile)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: account.active ? "var(--color-primary)" : "var(--color-text-secondary)",
                    fontSize: "13px",
                    fontWeight: 800,
                    cursor: account.active || switchingProfile || deletingProfile ? "default" : "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {account.active ? "当前账号" : switchingProfile === account.profile ? "切换中" : "切换"}
                </button>
                <button
                  type="button"
                  disabled={Boolean(switchingProfile) || Boolean(deletingProfile)}
                  onClick={() => onDelete(account.profile, account.username)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: deletingProfile === account.profile ? "#bbb" : "#ef4444",
                    fontSize: "13px",
                    fontWeight: 800,
                    cursor: switchingProfile || deletingProfile ? "default" : "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {deletingProfile === account.profile ? "删除中" : "删除数据"}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: "var(--color-text-muted)", fontSize: "14px", padding: "10px 0" }}>暂无可切换的已保存账号</div>
        )}
      </div>
    </div>
  );
}

function CacheRefreshOverlay({ activeIndex }: { activeIndex: number }) {
  return (
    <div style={{ ...dialogBackdropStyle, cursor: "wait" }}>
      <div style={{ ...dialogPanelStyle, maxWidth: "460px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
          <Loader2 className="animate-spin" style={{ width: 24, height: 24, color: "var(--color-primary)" }} />
          <div>
            <h2 style={dialogTitleStyle}>正在更新所有页面</h2>
            <p style={{ color: "var(--color-text-muted)", fontSize: "13px", marginTop: "3px" }}>请等待当前操作完成</p>
          </div>
        </div>
        <div style={{ display: "grid", gap: "8px" }}>
          {PAGE_REFRESH_STEPS.map((step, index) => (
            <div
              key={step}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "9px 12px",
                borderRadius: "10px",
                backgroundColor: index === activeIndex ? "var(--color-primary-light)" : index < activeIndex ? "var(--color-success-bg)" : "var(--color-bg-subtle)",
                color: index === activeIndex ? "var(--color-primary)" : index < activeIndex ? "var(--color-success-text)" : "var(--color-text-muted)",
                fontSize: "13.5px",
                fontWeight: 700,
              }}
            >
              <span>{step}</span>
              {index === activeIndex ? <Loader2 className="animate-spin" style={{ width: 15, height: 15 }} /> : index < activeIndex ? "已更新" : "等待中"}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function ThemeSelector({
  value,
  onChange,
}: {
  value: ThemeMode;
  onChange: (value: ThemeMode) => void;
}) {
  const options: Array<{ key: ThemeMode; label: string; icon: React.ReactNode }> = [
    { key: "light", label: "亮色", icon: <Sun style={{ width: 16, height: 16 }} /> },
    { key: "dark", label: "暗色", icon: <Moon style={{ width: 16, height: 16 }} /> },
    { key: "system", label: "系统", icon: <Monitor style={{ width: 16, height: 16 }} /> },
  ];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "2px",
        padding: "3px",
        borderRadius: "10px",
        backgroundColor: "var(--color-bg-tertiary)",
      }}
    >
      {options.map((option) => {
        const active = value === option.key;
        return (
          <button
            key={option.key}
            onClick={() => onChange(option.key)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              padding: "8px 16px",
              borderRadius: "8px",
              fontSize: "13.5px",
              fontWeight: active ? 600 : 400,
              border: active ? "1.5px solid var(--color-primary)" : "1.5px solid transparent",
              color: active ? "var(--color-primary)" : "var(--color-text-secondary)",
              backgroundColor: active ? "var(--color-bg-secondary)" : "transparent",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function FontSizeSliderControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const [localInput, setLocalInput] = useState<string>(String(value));

  useEffect(() => {
    setLocalInput(String(value));
  }, [value]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const num = parseFloat(e.target.value);
    if (!isNaN(num)) {
      onChange(num);
    }
  };

  const commitInputChange = (strVal: string) => {
    let num = parseFloat(strVal);
    if (isNaN(num)) {
      num = DEFAULT_APP_FONT_SIZE;
    }
    const clamped = Math.max(MIN_APP_FONT_SIZE, Math.min(MAX_APP_FONT_SIZE, Math.round(num * 10) / 10));
    setLocalInput(String(clamped));
    onChange(clamped);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      commitInputChange(localInput);
      (e.target as HTMLInputElement).blur();
    }
  };

  const stepDecrease = () => {
    const next = Math.max(MIN_APP_FONT_SIZE, Math.round((value - 0.5) * 10) / 10);
    onChange(next);
  };

  const stepIncrease = () => {
    const next = Math.min(MAX_APP_FONT_SIZE, Math.round((value + 0.5) * 10) / 10);
    onChange(next);
  };

  const isMin = value <= MIN_APP_FONT_SIZE;
  const isMax = value >= MAX_APP_FONT_SIZE;

  return (
    <div className="bb-font-slider-container">
      <div className="bb-font-slider-row">
        <button
          type="button"
          onClick={stepDecrease}
          disabled={isMin}
          className="bb-font-step-btn"
          title="缩小字号 (每次 -0.5px)"
          aria-label="缩小字号"
        >
          A-
        </button>
        <input
          type="range"
          min={MIN_APP_FONT_SIZE}
          max={MAX_APP_FONT_SIZE}
          step={0.5}
          value={value}
          onChange={handleSliderChange}
          className="bb-font-slider"
          aria-label="全局字号滑块"
        />
        <button
          type="button"
          onClick={stepIncrease}
          disabled={isMax}
          className="bb-font-step-btn bb-font-step-btn-large"
          title="放大字号 (每次 +0.5px)"
          aria-label="放大字号"
        >
          A+
        </button>
      </div>

      <div className="bb-font-px-wrap">
        <input
          type="number"
          min={MIN_APP_FONT_SIZE}
          max={MAX_APP_FONT_SIZE}
          step={0.5}
          value={localInput}
          onChange={(e) => {
            setLocalInput(e.target.value);
            const num = parseFloat(e.target.value);
            if (!isNaN(num) && num >= MIN_APP_FONT_SIZE && num <= MAX_APP_FONT_SIZE) {
              onChange(num);
            }
          }}
          onBlur={() => commitInputChange(localInput)}
          onKeyDown={handleInputKeyDown}
          className="bb-font-px-input"
          aria-label="全局字号数值(px)"
        />
        <span className="bb-font-px-unit">px</span>
      </div>

      {Math.abs(value - DEFAULT_APP_FONT_SIZE) >= 0.1 && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_APP_FONT_SIZE)}
          className="bb-font-reset-btn"
          title="恢复默认 14px 字号"
        >
          <RotateCcw style={{ width: 12, height: 12 }} />
          默认 (14px)
        </button>
      )}
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: "52px",
        height: "30px",
        borderRadius: "999px",
        border: "none",
        backgroundColor: checked ? "var(--color-primary)" : "var(--color-border)",
        padding: "3px",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: checked ? "flex-end" : "flex-start",
        transition: "all 0.2s ease",
      }}
    >
      <span
        style={{
          width: "24px",
          height: "24px",
          borderRadius: "50%",
          backgroundColor: "var(--color-bg-secondary)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
        }}
      />
    </button>
  );
}

function ModeButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: "34px",
        padding: "0 12px",
        borderRadius: "8px",
        border: active ? "1px solid var(--color-primary)" : "1px solid transparent",
        backgroundColor: active ? "var(--color-bg-elevated)" : "transparent",
        color: active ? "var(--color-primary)" : "var(--color-text-secondary)",
        fontSize: "13px",
        fontWeight: active ? 600 : 500,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function NumberStepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        borderRadius: "10px",
        border: "1.5px solid var(--color-border)",
        overflow: "hidden",
        backgroundColor: "var(--color-bg-secondary)",
      }}
    >
      <button
        onClick={() => value > min && onChange(value - 1)}
        disabled={value <= min}
        style={stepperButtonStyle(value <= min)}
      >
        -
      </button>
      <div
        style={{
          minWidth: "42px",
          textAlign: "center",
          fontSize: "14.5px",
          fontWeight: 600,
          color: "var(--color-text)",
          fontVariantNumeric: "tabular-nums",
          padding: "0 8px",
          userSelect: "none",
        }}
      >
        {value}
      </div>
      <button
        onClick={() => value < max && onChange(value + 1)}
        disabled={value >= max}
        style={stepperButtonStyle(value >= max)}
      >
        +
      </button>
    </div>
  );
}

function StepperField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
      <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-secondary)" }}>{label}</span>
      <NumberStepper value={value} min={min} max={max} onChange={onChange} />
    </div>
  );
}

function ScaleSlider({
  value,
  onChange,
  compact = false,
}: {
  value: number;
  onChange: (value: number) => void;
  compact?: boolean;
}) {
  const safeValue = Math.max(0.7, Math.min(1.6, Number(value) || DEFAULT_CARD_SCALE));
  const progress = ((safeValue - 0.7) / 0.9) * 100;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", minWidth: compact ? "170px" : "230px" }}>
      <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>大小</span>
      <input
        aria-label="卡片大小"
        type="range"
        min={0.7}
        max={1.6}
        step={0.05}
        value={safeValue}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{
          width: compact ? "92px" : "140px",
          height: 5,
          borderRadius: 999,
          accentColor: "var(--color-primary)",
          outline: "none",
          cursor: "pointer",
          background: `linear-gradient(90deg, var(--color-primary) ${progress}%, var(--color-bg-tertiary) ${progress}%)`,
        }}
      />
      <span
        style={{
          minWidth: "42px",
          textAlign: "right",
          fontSize: "13px",
          fontWeight: 800,
          color: "var(--color-text)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {Math.round(safeValue * 100)}%
      </span>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  minWidth: "180px",
  padding: "9px 12px",
  borderRadius: "10px",
  border: "1.5px solid var(--color-border)",
  backgroundColor: "var(--color-bg-secondary)",
  fontSize: "13.5px",
  color: "var(--color-text)",
};

const secondaryButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "8px 14px",
  borderRadius: "8px",
  fontSize: "13.5px",
  fontWeight: 500,
  color: "var(--color-text-secondary)",
  backgroundColor: "var(--color-bg-secondary)",
  border: "1.5px solid var(--color-border)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const purpleAboutButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  color: "var(--color-purple, #9333ea)",
  backgroundColor: "var(--color-purple-bg, rgba(147, 51, 234, 0.08))",
  border: "1.5px solid var(--color-purple-border, rgba(147, 51, 234, 0.35))",
  fontWeight: 650,
};

const primaryButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "9px 16px",
  borderRadius: "8px",
  fontSize: "13.5px",
  fontWeight: 650,
  color: "#ffffff",
  backgroundColor: "var(--color-primary)",
  border: "1.5px solid var(--color-primary)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const dialogBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  backgroundColor: "rgba(15,23,42,0.4)",
  backdropFilter: "blur(4px)",
};

const dialogPanelStyle: React.CSSProperties = {
  width: "min(560px, 100%)",
  maxHeight: "82vh",
  overflowY: "auto",
  borderRadius: "16px",
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-bg-secondary)",
  boxShadow: "var(--shadow-card-hover)",
  padding: "20px",
};

const dialogHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  marginBottom: "16px",
};

const dialogTitleStyle: React.CSSProperties = {
  color: "var(--color-text)",
  fontSize: "18px",
  fontWeight: 850,
  lineHeight: 1.25,
};

function stepperButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "38px",
    height: "38px",
    border: "none",
    backgroundColor: "transparent",
    color: disabled ? "var(--color-text-muted)" : "var(--color-text-secondary)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: "17px",
    fontFamily: "inherit",
  };
}
