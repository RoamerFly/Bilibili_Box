import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "@/stores/app-store";
import {
  X,
  AlertCircle,
  Loader2,
  Lock,
  User,
  Clock,
  MonitorSmartphone,
  ShieldCheck,
  LogOut,
  UserCircle,
  RefreshCw,
  Globe2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { invoke } from "@/lib/api";
import { openExternalUrl } from "@/lib/open-external";

interface LoginDialogProps {
  open: boolean;
  onClose: () => void;
}

type LoginMode = "qrcode" | "cookie" | "browser";

type BackendConfig = {
  sessdata: string;
  cookie?: string;
  [key: string]: unknown;
};

type QrcodeStatusResponse = {
  code: number;
  message: string;
  url?: string;
  sessdata?: string | null;
  cookie?: string | null;
};

type BrowserLoginResponse = {
  sessdata: string;
  cookie?: string | null;
};

type BackendUserInfo = {
  isLogin?: boolean;
  is_login?: boolean;
  uname: string;
  face: string;
  mid: number;
};

function isBackendUserLoggedIn(userInfo: { isLogin?: boolean; is_login?: boolean }): boolean {
  return Boolean(userInfo.isLogin ?? userInfo.is_login);
}

function extractSessdata(input: string): string {
  const trimmed = input.trim();
  const cookieMatch = trimmed.match(/(?:^|;\s*)SESSDATA=([^;]+)/i);

  if (cookieMatch?.[1]) {
    return cookieMatch[1].trim();
  }

  if (trimmed.toUpperCase().startsWith("SESSDATA=")) {
    return trimmed.slice("SESSDATA=".length).split(";")[0].trim();
  }

  return trimmed.split(";")[0].trim();
}

function extractSessdataFromQrcodeStatus(status: QrcodeStatusResponse): string | null {
  if (status.sessdata) {
    return status.sessdata;
  }

  if (status.cookie) {
    return extractSessdata(status.cookie);
  }

  if (!status.url) {
    return null;
  }

  const urlParts = status.url.split("SESSDATA=");
  if (urlParts.length <= 1) {
    return null;
  }

  return urlParts[1].split("&")[0] || null;
}

export function LoginDialog({ open, onClose }: LoginDialogProps) {
  const [mode, setMode] = useState<LoginMode>("qrcode");
  const [qrcodeUrl, setQrcodeUrl] = useState<string>("");
  const [qrcodeKey, setQrcodeKey] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [polling, setPolling] = useState(false);
  const [cookieInput, setCookieInput] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  const config = useAppStore((s) => s.config);
  const userInfo = useAppStore((s) => s.userInfo);
  const setConfig = useAppStore((s) => s.setConfig);
  const setUserInfo = useAppStore((s) => s.setUserInfo);
  const isLoggedIn = userInfo !== null;
  const username = userInfo?.username || "";

  const saveSessdata = useCallback(async (sessdata: string, cookie?: string | null) => {
    const currentConfig = await invoke<BackendConfig>("get_config");
    const nextConfig = {
      ...currentConfig,
      sessdata,
      cookie: cookie?.trim() || `SESSDATA=${sessdata}`,
    };
    await invoke("save_config", { newConfig: nextConfig });
    setConfig(nextConfig);
  }, [setConfig]);

  const completeLogin = useCallback(async (sessdata: string, cookie?: string | null) => {
    const userInfo = await invoke<BackendUserInfo>("get_user_info", { sessdata });
    if (!isBackendUserLoggedIn(userInfo)) {
      throw new Error("登录校验失败，请重新登录");
    }

    await saveSessdata(sessdata, cookie);
    await invoke("save_user_info", { userInfo });

    const now = new Date();
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    setUserInfo({
      username: userInfo.uname,
      avatar: userInfo.face,
      loginTime: timeStr,
      deviceName: "Windows 桌面端",
    });
  }, [saveSessdata, setUserInfo]);

  // ── 二维码生成 ──────────────────────────────────────
  const generateQrcode = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      console.log("[Login] 开始生成二维码...");
      const data = await invoke<{ url: string; qrcode_key: string }>("generate_qrcode");
      console.log("[Login] 二维码生成成功:", data);
      setQrcodeUrl(data.url);
      setQrcodeKey(data.qrcode_key);
    } catch (e) {
      console.error("[Login] 二维码生成失败:", e);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // ── 轮询二维码状态 ─────────────────────────────────
  const pollQrcodeStatus = useCallback(async () => {
    if (!qrcodeKey) return;

    try {
      console.log("[Login] 轮询二维码状态, qrcodeKey:", qrcodeKey);
      const status = await invoke<QrcodeStatusResponse>("get_qrcode_status", { qrcodeKey });
      console.log("[Login] 二维码状态响应:", status);

      if (status.code === 0) {
        console.log("[Login] 登录成功! url:", status.url);
        const sessdata = extractSessdataFromQrcodeStatus(status);
        if (sessdata) {
          try {
            console.log("[Login] 提取到 SESSDATA:", sessdata.substring(0, 20) + "...");
            await completeLogin(sessdata, status.cookie);
            setPolling(false);
            onClose();
          } catch (err) {
            console.error("[Login] 保存 SESSDATA 失败:", err);
            setError(String(err));
            setPolling(false);
          }
        } else {
          console.error("[Login] 登录响应中没有 SESSDATA");
          setError("无法从响应中获取 SESSDATA");
          setPolling(false);
        }
      } else if (status.code === 86038) {
        console.log("[Login] 二维码已过期");
        setError("二维码已过期，请刷新");
        setPolling(false);
      } else if (status.code === 86090) {
        console.log("[Login] 已扫码，等待确认");
        setError("已扫码，请在手机上确认");
      } else {
        console.log("[Login] 未知状态码:", status.code, status.message);
      }
    } catch (e) {
      console.error("轮询失败:", e);
    }
  }, [qrcodeKey, completeLogin, onClose]);

  useEffect(() => {
    if (!polling || !qrcodeKey) return;
    const interval = setInterval(pollQrcodeStatus, 1000);
    return () => clearInterval(interval);
  }, [polling, qrcodeKey, pollQrcodeStatus]);

  // 打开对话框时生成二维码
  useEffect(() => {
    if (open && mode === "qrcode") {
      generateQrcode();
      setPolling(true);
    }
    return () => {
      setPolling(false);
    };
  }, [open, mode, generateQrcode]);

  // ── Cookie 登录 ──────────────────────────────────────
  const handleCookieLogin = async () => {
    if (!cookieInput.trim()) {
      setError("请输入 SESSDATA");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const sessdata = extractSessdata(cookieInput);
      const cookie = cookieInput.includes("=") ? cookieInput.trim() : `SESSDATA=${sessdata}`;
      await completeLogin(sessdata, cookie);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  // ── 浏览器登录 ──────────────────────────────────────
  const handleBrowserLogin = async () => {
    setLoading(true);
    setError("");

    try {
      const result = await invoke<BrowserLoginResponse>("browser_login", { timeout: 300 });
      const sessdata = result.sessdata?.trim();
      if (!sessdata) {
        throw new Error("未能从浏览器窗口获取 SESSDATA");
      }
      await completeLogin(sessdata, result.cookie);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  // ── 刷新二维码 ───────────────────────────────────────
  const handleRefresh = () => {
    setError("");
    generateQrcode();
    setPolling(true);
  };

  // ── 退出登录 ─────────────────────────────────────────
  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      // 直接清空 config 中的 sessdata，watch hook 会自动清除 userInfo
      if (config) {
        // 同时保存到后端配置文件
        const currentConfig = await invoke<{ sessdata: string; [key: string]: unknown }>("get_config");
        await invoke("save_config", { newConfig: { ...currentConfig, sessdata: "", cookie: "" } });
        await invoke("clear_user_info");
        // 更新本地状态
        setConfig({ ...config, sessdata: "", cookie: "" });
        setUserInfo(null);
      }
      onClose();
    } catch (e) {
      console.error("登出失败:", e);
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="login-dialog-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={onClose}
        >
          {isLoggedIn ? (
            <LoggedInPanel
              key="logged-in-panel"
              username={username}
              userInfo={userInfo}
              loggingOut={loggingOut}
              onClose={onClose}
              onLogout={handleLogout}
            />
          ) : (
            <LoginForm
              key="login-form-panel"
              mode={mode}
              setMode={setMode}
              qrcodeUrl={qrcodeUrl}
              loading={loading}
              error={error}
              cookieInput={cookieInput}
              setCookieInput={setCookieInput}
              onClose={onClose}
              onRefresh={handleRefresh}
              onCookieLogin={handleCookieLogin}
              onBrowserLogin={handleBrowserLogin}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ════════════════════════════════════════════════════════
//  已登录 → 用户信息面板
// ════════════════════════════════════════════════════════

interface LoggedInPanelProps {
  username: string;
  userInfo: { username: string; loginTime?: string; deviceName?: string } | null;
  loggingOut: boolean;
  onClose: () => void;
  onLogout: () => void;
}

function LoggedInPanel({ username, userInfo, loggingOut, onClose, onLogout }: LoggedInPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: 16 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      onClick={(e) => e.stopPropagation()}
      className="relative"
      style={{
        width: "400px",
        background: "#ffffff",
        borderRadius: "18px",
        boxShadow: "0 24px 64px rgba(0,0,0,0.2), 0 4px 12px rgba(0,0,0,0.08)",
      }}
    >
      {/* ═══ 关闭按钮 ═══ */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
        className="absolute top-4 right-4 flex items-center justify-center cursor-pointer z-10"
        style={{
          width: "30px",
          height: "30px",
          borderRadius: "8px",
          border: "none",
          background: "transparent",
          color: "#9999aa",
          transition: "all 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(0,0,0,0.06)";
          e.currentTarget.style.color = "#555568";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "#9999aa";
        }}
      >
        <X className="w-[16px] h-[16px]" />
      </button>

      {/* ═══ 用户头部信息 ═══ */}
      <div
        className="flex flex-col items-center"
        style={{ paddingTop: "32px", paddingBottom: "20px" }}
      >
        {/* 头像 */}
        <div
          className="relative mb-3"
          style={{
            width: "72px",
            height: "72px",
            borderRadius: "50%",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(135deg, #6b7aff 0%, #a855f7 100%)",
            boxShadow: "0 4px 16px rgba(99,102,241,0.3)",
          }}
        >
          <UserCircle className="w-[44px] h-[44px] text-white" strokeWidth={1.5} />
        </div>

        {/* 用户名 + 状态标签 */}
        <div className="flex items-center gap-2.5">
          <span
            style={{
              fontSize: "18px",
              fontWeight: 700,
              color: "#1a1a2e",
              letterSpacing: "0.2px",
            }}
          >
            {username || userInfo?.username || "未知用户"}
          </span>
          {/* 已登录标签 */}
          <span
            className="flex items-center gap-1 px-2 py-0.5 rounded-full"
            style={{
              fontSize: "11.5px",
              fontWeight: 500,
              color: "#16a34a",
              background: "rgba(22,163,74,0.08)",
            }}
          >
            <span
              className="inline-block w-[6px] h-[6px] rounded-full"
              style={{
                background: "#22c55e",
                boxShadow: "0 0 0 2px rgba(34,197,94,0.25)",
              }}
            />
            已登录
          </span>
        </div>
      </div>

      {/* 分隔线 */}
      <div style={{ borderTop: "1px solid #f0f0f3", margin: "0 28px" }} />

      {/* ═══ 信息列表 ═══ */}
      <div style={{ padding: "18px 28px 14px" }}>
        <InfoRow
          icon={<User className="w-[17px] h-[17px]" />}
          label="账号信息"
          value={username || userInfo?.username || "未知用户"}
        />
        <InfoRow
          icon={<Clock className="w-[17px] h-[17px]" />}
          label="登录时间"
          value={userInfo?.loginTime || "--"}
        />
        <InfoRow
          icon={<MonitorSmartphone className="w-[17px] h-[17px]" />}
          label="设备名称"
          value={userInfo?.deviceName || "Windows 桌面端"}
        />
        <InfoRow
          icon={<ShieldCheck className="w-[17px] h-[17px]" />}
          label="登录状态"
          value="正常"
          valueColor="#22c55e"
          valueFontWeight={600}
        />
      </div>

      {/* ═══ 退出登录按钮 ═══ */}
      <div style={{ padding: "4px 28px 18px" }}>
        <motion.button
          type="button"
          onClick={onLogout}
          disabled={loggingOut}
          whileHover={!loggingOut ? { backgroundColor: "#fef2f2", borderColor: "#f87171" } : {}}
          whileTap={!loggingOut ? { scale: 0.985 } : {}}
          className="cursor-pointer w-full"
          style={{
            height: "42px",
            borderRadius: "11px",
            border: `1.5px solid ${loggingOut ? '#fcc' : '#fecaca'}`,
            background: loggingOut ? "#fafafa" : "#ffffff",
            color: loggingOut ? "#bbb" : "#ef4444",
            fontSize: "14px",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            transition: "all 0.15s",
          }}
        >
          {loggingOut ? (
            <>
              <Loader2
                className="w-[15px] h-[15px]"
                style={{ animation: "spin 1s linear infinite" }}
              />
              退出中...
            </>
          ) : (
            <>
              <LogOut className="w-[15px] h-[15px]" />
              退出登录
            </>
          )}
        </motion.button>
      </div>

      {/* ═══ 底部安全提示 ═══ */}
      <div
        className="flex items-center justify-center gap-1.5"
        style={{
          padding: "0 28px 20px",
          borderTop: "1px solid #f5f5f7",
          paddingTop: "14px",
        }}
      >
        <Lock className="w-[13px] h-[13px]" style={{ color: "#bbb" }} />
        <span style={{ fontSize: "11.5px", color: "#aaaabb" }}>
          为保障账号安全，请勿在公共设备上登录
        </span>
      </div>
    </motion.div>
  );
}

// ════════════════════════════════════════════════════════
//  未登录 → 登录表单
// ════════════════════════════════════════════════════════

interface LoginFormProps {
  mode: LoginMode;
  setMode: (mode: LoginMode) => void;
  qrcodeUrl: string;
  loading: boolean;
  error: string;
  cookieInput: string;
  setCookieInput: (value: string) => void;
  onClose: () => void;
  onRefresh: () => void;
  onCookieLogin: () => void;
  onBrowserLogin: () => void;
}

function LoginForm({
  mode,
  setMode,
  qrcodeUrl,
  loading,
  error,
  cookieInput,
  setCookieInput,
  onClose,
  onRefresh,
  onCookieLogin,
  onBrowserLogin,
}: LoginFormProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: 16 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      onClick={(e) => e.stopPropagation()}
      className="relative"
      style={{
        width: "420px",
        background: "#ffffff",
        borderRadius: "18px",
        boxShadow: "0 24px 64px rgba(0,0,0,0.2), 0 4px 12px rgba(0,0,0,0.08)",
      }}
    >
      {/* ═══ 关闭按钮 ═══ */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
        className="absolute top-4 right-4 flex items-center justify-center cursor-pointer z-10"
        style={{
          width: "30px",
          height: "30px",
          borderRadius: "8px",
          border: "none",
          background: "transparent",
          color: "#9999aa",
          transition: "all 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(0,0,0,0.06)";
          e.currentTarget.style.color = "#555568";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "#9999aa";
        }}
      >
        <X className="w-[16px] h-[16px]" />
      </button>

      {/* ═══ Tab 切换栏 ═══ */}
      <div
        className="flex items-center justify-center relative"
        style={{
          paddingTop: "28px",
          paddingBottom: "20px",
          borderBottom: "1px solid #f0f0f3",
        }}
      >
        <div className="flex gap-7">
          <TabButton
            label="二维码登录"
            active={mode === "qrcode"}
            onClick={() => setMode("qrcode")}
          />
          <TabButton
            label="Cookie 登录"
            active={mode === "cookie"}
            onClick={() => setMode("cookie")}
          />
          <TabButton
            label="浏览器登录"
            active={mode === "browser"}
            onClick={() => setMode("browser")}
          />
        </div>
      </div>

      {/* ═══ 内容区 ═══ */}
      <AnimatePresence mode="wait">
        {mode === "qrcode" ? (
          <QrcodePanel
            key="qrcode"
            qrcodeUrl={qrcodeUrl}
            loading={loading}
            error={error}
            onRefresh={onRefresh}
          />
        ) : mode === "cookie" ? (
          <CookiePanel
            key="cookie"
            cookieInput={cookieInput}
            setCookieInput={setCookieInput}
            loading={loading}
            error={error}
            onLogin={onCookieLogin}
          />
        ) : (
          <BrowserPanel
            key="browser"
            loading={loading}
            error={error}
            onLogin={onBrowserLogin}
          />
        )}
      </AnimatePresence>

      {/* ═══ 底部协议文字（仅二维码模式显示） ═══ */}
      {mode === "qrcode" && (
        <div
          className="text-center"
          style={{
            padding: "0 36px 22px",
            borderTop: "1px solid #f5f5f7",
            marginTop: "0",
          }}
        >
          <span style={{ fontSize: "11.5px", color: "#aaaabb" }}>
            登录即代表你同意
          </span>{" "}
          <a
            href="https://www.bilibili.com/blackboard/protocal/licence.html"
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: "11.5px",
              color: "#6366f1",
              textDecoration: "none",
            }}
          >
            《BiliBox 用户协议》
          </a>
          <span style={{ fontSize: "11.5px", color: "#aaaABB" }}> 和 </span>
          <a
            href="https://www.bilibili.com/blackboard/privacy-pc.html"
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: "11.5px",
              color: "#6366f1",
              textDecoration: "none",
            }}
          >
            《隐私政策》
          </a>
        </div>
      )}

      {/* 全局 CSS 动画注入 */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </motion.div>
  );
}

// ════════════════════════════════════════════════════════
//  二维码登录面板
// ════════════════════════════════════════════════════════

interface QrcodePanelProps {
  qrcodeUrl: string;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}

function QrcodePanel({ qrcodeUrl, loading, error, onRefresh }: QrcodePanelProps) {
  const [isHovering, setIsHovering] = useState(false);

  return (
    <motion.div
      key="qrcode"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18 }}
      style={{ padding: "24px 36px 28px" }}
    >
      <p
        className="text-center"
        style={{
          fontSize: "13.5px",
          color: "#555568",
          marginBottom: "22px",
        }}
      >
        请使用 Bilibili 客户端扫码登录
      </p>

      <div className="flex flex-col items-center">
        <div className="relative" style={{ marginBottom: "18px" }}>
          {loading ? (
            <div
              className="flex items-center justify-center"
              style={{
                width: "200px",
                height: "200px",
                borderRadius: "14px",
                background: "#f7f7f8",
                boxShadow: "inset 0 1px 3px rgba(0,0,0,0.05)",
              }}
            >
              <Loader2
                className="w-8 h-8"
                style={{ color: "#6366f1", animation: "spin 1s linear infinite" }}
              />
            </div>
          ) : qrcodeUrl ? (
            <div
              className="relative cursor-pointer"
              onMouseEnter={() => setIsHovering(true)}
              onMouseLeave={() => setIsHovering(false)}
              onClick={onRefresh}
              style={{
                padding: "12px",
                borderRadius: "12px",
                background: "#ffffff",
                boxShadow: "0 2px 12px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)",
              }}
            >
              <QRCodeSVG
                value={qrcodeUrl}
                size={184}
                level="H"
                includeMargin={false}
                bgColor="#FFFFFF"
                fgColor="#111111"
                style={{
                  filter: isHovering ? "blur(3px)" : "none",
                  transition: "filter 0.2s ease",
                }}
              />
              {/* 悬停时显示刷新提示 */}
              <AnimatePresence>
                {isHovering && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="absolute inset-0 flex flex-col items-center justify-center"
                    style={{
                      borderRadius: "12px",
                      background: "rgba(255,255,255,0.85)",
                    }}
                  >
                    <RefreshCw
                      className="w-8 h-8 mb-2"
                      style={{ color: "#6366f1" }}
                    />
                    <span style={{ fontSize: "13px", color: "#555568", fontWeight: 500 }}>
                      点击刷新
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <div
              className="flex items-center justify-center"
              style={{
                width: "200px",
                height: "200px",
                borderRadius: "14px",
                background: "#f7f7f8",
                border: "1px dashed #dcdce0",
              }}
            >
              <div className="flex flex-col items-center gap-2">
                <AlertCircle className="w-7 h-7" style={{ color: "#bbb" }} />
                <button
                  onClick={onRefresh}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "12px",
                    color: "#6366f1",
                    cursor: "pointer",
                  }}
                >
                  点击重试
                </button>
              </div>
            </div>
          )}
        </div>

        <p
          className="text-center"
          style={{ fontSize: "13px", color: "#444455", marginBottom: "4px" }}
        >
          打开哔哩哔哩 APP
        </p>
        <p
          className="text-center"
          style={{ fontSize: "12.5px", color: "#9999aa" }}
        >
          点击首页右上角 扫一扫
        </p>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="flex items-center gap-1.5 mt-3 px-3 py-2 rounded-lg"
              style={{
                background: "rgba(239,68,68,0.07)",
                border: "1px solid rgba(239,68,68,0.15)",
              }}
            >
              <AlertCircle className="w-[13px] h-[13px] shrink-0" style={{ color: "#ef4444" }} />
              <span style={{ fontSize: "12px", color: "#ef4444" }}>{error}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ════════════════════════════════════════════════════════
//  Cookie 登录面板
// ════════════════════════════════════════════════════════

interface CookiePanelProps {
  cookieInput: string;
  setCookieInput: (value: string) => void;
  loading: boolean;
  error: string;
  onLogin: () => void;
}

function CookiePanel({ cookieInput, setCookieInput, loading, error, onLogin }: CookiePanelProps) {
  return (
    <motion.div
      key="cookie"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18 }}
      style={{ padding: "24px 36px 20px" }}
    >
      <div className="flex flex-col">
        <p
          className="text-center"
          style={{
            fontSize: "13.5px",
            color: "#555568",
            marginBottom: "18px",
          }}
        >
          使用 Bilibili Cookie 快速登录
        </p>

        <div style={{ position: "relative" }}>
          <textarea
            value={cookieInput}
            onChange={(e) => setCookieInput(e.target.value)}
            placeholder=""
            rows={6}
            spellCheck={false}
            style={{
              width: "100%",
              padding: "14px 16px",
              borderRadius: "12px",
              border: "1.5px solid #e0e0e6",
              background: "#ffffff",
              fontSize: "14px",
              color: "#1a1a2e",
              resize: "none",
              outline: "none",
              fontFamily: "inherit",
              boxSizing: "border-box",
              lineHeight: 1.65,
              transition: "border-color 0.15s, box-shadow 0.15s",
            }}
            onFocus={(e) => {
              e.target.style.borderColor = "#6366f1";
              e.target.style.boxShadow = "0 0 0 3px rgba(99,102,241,0.10)";
            }}
            onBlur={(e) => {
              e.target.style.borderColor = "#e0e0e6";
              e.target.style.boxShadow = "none";
            }}
          />
          {!cookieInput && (
            <div
              className="pointer-events-none"
              style={{
                position: "absolute",
                top: "14px",
                left: "16px",
                right: "16px",
                fontSize: "14px",
                lineHeight: "1.65",
                color: "#bbbcc4",
              }}
            >
              请粘贴你的{" "}
              <span style={{ color: "#6366f1", fontWeight: 500 }}>
                Bilibili Cookie
              </span>
            </div>
          )}
        </div>

        <div className="flex justify-end" style={{ marginTop: "10px" }}>
          <button
            type="button"
            onClick={() => void openExternalUrl("https://www.bilibili.com").catch((error) => console.error("打开浏览器失败:", error))}
            className="cursor-pointer"
            style={{
              background: "none",
              border: "none",
              fontSize: "12.5px",
              color: "#6366f1",
              fontWeight: 500,
              padding: "2px 0",
              cursor: "pointer",
            }}
          >
            如何获取 Cookie?
          </button>
        </div>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg mt-2"
              style={{
                background: "rgba(239,68,68,0.07)",
                border: "1px solid rgba(239,68,68,0.15)",
              }}
            >
              <AlertCircle
                className="w-[13px] h-[13px] shrink-0"
                style={{ color: "#ef4444" }}
              />
              <span style={{ fontSize: "12px", color: "#ef4444" }}>{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button
          type="button"
          onClick={onLogin}
          disabled={loading}
          whileHover={!loading ? { backgroundColor: "#5855e6" } : {}}
          whileTap={!loading ? { scale: 0.985 } : {}}
          className="cursor-pointer"
          style={{
            width: "100%",
            height: "46px",
            borderRadius: "11px",
            border: "none",
            background: loading ? "#bbb" : "#6366f1",
            color: "#ffffff",
            fontSize: "15px",
            fontWeight: 600,
            letterSpacing: "0.3px",
            boxShadow: loading ? "none" : "0 4px 14px rgba(99,102,241,0.3)",
            transition: "all 0.2s",
            marginTop: error ? "10px" : "22px",
          }}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2
                className="w-[15px] h-[15px]"
                style={{ animation: "spin 1s linear infinite" }}
              />
              验证中...
            </span>
          ) : (
            "登录"
          )}
        </motion.button>

        <div
          className="flex items-center justify-center gap-1.5"
          style={{ marginTop: "16px" }}
        >
          <Lock className="w-[13px] h-[13px]" style={{ color: "#bbb" }} />
          <span style={{ fontSize: "11.5px", color: "#aaaabb" }}>
            仅本地存储，不会上传你的 Cookie
          </span>
        </div>
      </div>
    </motion.div>
  );
}

// ════════════════════════════════════════════════════════
//  浏览器登录面板
// ════════════════════════════════════════════════════════

interface BrowserPanelProps {
  loading: boolean;
  error: string;
  onLogin: () => void;
}

function BrowserPanel({ loading, error, onLogin }: BrowserPanelProps) {
  return (
    <motion.div
      key="browser"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18 }}
      style={{ padding: "30px 36px 26px" }}
    >
      <div className="flex flex-col items-center">
        <div
          className="flex items-center justify-center"
          style={{
            width: "72px",
            height: "72px",
            borderRadius: "18px",
            background: "rgba(99,102,241,0.08)",
            color: "#6366f1",
            marginBottom: "18px",
          }}
        >
          <Globe2 className="w-[34px] h-[34px]" strokeWidth={1.8} />
        </div>

        <p
          className="text-center"
          style={{ fontSize: "13.5px", color: "#555568", marginBottom: "22px" }}
        >
          打开内置浏览器完成 Bilibili 登录
        </p>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg"
              style={{
                background: "rgba(239,68,68,0.07)",
                border: "1px solid rgba(239,68,68,0.15)",
                marginBottom: "14px",
              }}
            >
              <AlertCircle className="w-[13px] h-[13px] shrink-0" style={{ color: "#ef4444" }} />
              <span style={{ fontSize: "12px", color: "#ef4444" }}>{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button
          type="button"
          onClick={onLogin}
          disabled={loading}
          whileHover={!loading ? { backgroundColor: "#5855e6" } : {}}
          whileTap={!loading ? { scale: 0.985 } : {}}
          className="cursor-pointer"
          style={{
            width: "100%",
            height: "46px",
            borderRadius: "11px",
            border: "none",
            background: loading ? "#bbb" : "#6366f1",
            color: "#ffffff",
            fontSize: "15px",
            fontWeight: 600,
            letterSpacing: "0.3px",
            boxShadow: loading ? "none" : "0 4px 14px rgba(99,102,241,0.3)",
            transition: "all 0.2s",
          }}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2
                className="w-[15px] h-[15px]"
                style={{ animation: "spin 1s linear infinite" }}
              />
              等待登录...
            </span>
          ) : (
            "打开浏览器登录"
          )}
        </motion.button>
      </div>
    </motion.div>
  );
}

// ════════════════════════════════════════════════════════
//  Tab 按钮（带下划线指示器）
// ════════════════════════════════════════════════════════

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      className="relative pb-1 cursor-pointer"
      style={{
        background: "none",
        border: "none",
        padding: "0",
        fontSize: "15px",
        fontWeight: active ? 600 : 450,
        color: active ? "#6366f1" : "#9999aa",
        transition: "color 0.2s",
        letterSpacing: "0.2px",
      }}
      whileHover={!active ? { color: "#666677" } : {}}
      whileTap={{ scale: 0.97 }}
    >
      {label}
      {active && (
        <motion.div
          layoutId="loginTabIndicator"
          className="absolute left-0 right-0 bottom-0"
          style={{
            height: "2.5px",
            borderRadius: "2px",
            background: "#6366f1",
          }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        />
      )}
    </motion.button>
  );
}

// ════════════════════════════════════════════════════════
//  信息行组件（用户信息面板使用）
// ════════════════════════════════════════════════════════

function InfoRow({
  icon,
  label,
  value,
  valueColor = "#555568",
  valueFontWeight = 400,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor?: string;
  valueFontWeight?: number;
}) {
  return (
    <div
      className="flex items-center"
      style={{ padding: "11px 0", borderBottom: "1px solid #f5f5f7" }}
    >
      <div
        className="flex items-center justify-center shrink-0 mr-3"
        style={{
          width: "32px",
          height: "32px",
          borderRadius: "9px",
          background: "#f7f7f9",
          color: "#8888a0",
        }}
      >
        {icon}
      </div>
      <span
        className="shrink-0"
        style={{ fontSize: "13.5px", color: "#777788", width: "72px" }}
      >
        {label}
      </span>
      <span
        className="ml-auto text-right truncate"
        style={{
          fontSize: "13.5px",
          color: valueColor,
          fontWeight: valueFontWeight,
          maxWidth: "180px",
        }}
      >
        {value}
      </span>
    </div>
  );
}
