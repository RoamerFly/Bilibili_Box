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
  Users,
  Trash2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { invoke } from "@/lib/api";
import { openExternalUrl } from "@/lib/open-external";

interface LoginDialogProps {
  open: boolean;
  onClose: (success?: boolean) => void;
  forceNewLogin?: boolean;
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
  login_time?: string | null;
};

type SavedAccountProfile = {
  profile: string;
  username: string;
  mid: number;
  face: string;
  active: boolean;
};

type AccountSwitchResult = {
  config: BackendConfig;
  user_info: BackendUserInfo | null;
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

export function LoginDialog({ open, onClose, forceNewLogin }: LoginDialogProps) {
  const [mode, setMode] = useState<LoginMode>("qrcode");
  const [qrcodeUrl, setQrcodeUrl] = useState<string>("");
  const [qrcodeKey, setQrcodeKey] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [polling, setPolling] = useState(false);
  const [cookieInput, setCookieInput] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [accounts, setAccounts] = useState<SavedAccountProfile[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [accountListOpen, setAccountListOpen] = useState(false);
  const [switchingProfile, setSwitchingProfile] = useState("");
  const [deletingProfile, setDeletingProfile] = useState("");
  const [addingAccount, setAddingAccount] = useState(false);

  const config = useAppStore((s) => s.config);
  const userInfo = useAppStore((s) => s.userInfo);
  const setConfig = useAppStore((s) => s.setConfig);
  const setUserInfo = useAppStore((s) => s.setUserInfo);
  const resetAccountScopedState = useAppStore((s) => s.resetAccountScopedState);
  const actualIsLoggedIn = userInfo !== null;
  const isLoggedIn = !forceNewLogin && actualIsLoggedIn;
  const username = userInfo?.username || "";
  const shouldShowSavedAccounts = open && !isLoggedIn && !forceNewLogin && !addingAccount && accountsLoaded && accounts.length > 0;


  const loadAccounts = useCallback(async () => {
    setAccountsLoaded(false);
    try {
      const savedAccounts = await invoke<SavedAccountProfile[]>("list_saved_accounts");
      setAccounts(savedAccounts);
      return savedAccounts;
    } catch (err) {
      setAccounts([]);
      throw err;
    } finally {
      setAccountsLoaded(true);
    }
  }, []);

  const notifyAccountChanged = useCallback(() => {
    window.dispatchEvent(new CustomEvent("bilibili-box:account-switched"));
    window.dispatchEvent(new CustomEvent("bilibili-box:page-cache-cleared"));
  }, []);

  const completeLogin = useCallback(async (sessdata: string, cookie?: string | null) => {
    const userInfo = await invoke<BackendUserInfo>("get_user_info", { sessdata });
    if (!isBackendUserLoggedIn(userInfo)) {
      throw new Error("登录校验失败，请重新登录");
    }

    const result = await invoke<AccountSwitchResult>("save_login_session", {
      params: { userInfo, sessdata, cookie },
    });
    setConfig(result.config);

    const now = new Date();
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const savedUser = result.user_info ?? userInfo;
    setUserInfo({
      username: savedUser.uname,
      avatar: savedUser.face,
      loginTime: savedUser.login_time || timeStr,
      deviceName: "Windows 桌面端",
    });
    resetAccountScopedState();
    setAddingAccount(false);
    setAccountListOpen(false);
    await loadAccounts();
    notifyAccountChanged();
  }, [loadAccounts, notifyAccountChanged, resetAccountScopedState, setConfig, setUserInfo]);

  const handleClose = useCallback((success?: boolean | any) => {
    setAddingAccount(false);
    onClose(success === true);
  }, [onClose]);

  useEffect(() => {
    if (open) {
      void loadAccounts();
    } else {
      setAccountListOpen(false);
      setAddingAccount(false);
      setPolling(false);
    }
  }, [loadAccounts, open]);

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
            handleClose(true);
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
  }, [qrcodeKey, completeLogin, handleClose]);

  useEffect(() => {
    if (!polling || !qrcodeKey) return;
    const interval = setInterval(pollQrcodeStatus, 1000);
    return () => clearInterval(interval);
  }, [polling, qrcodeKey, pollQrcodeStatus]);

  // 打开对话框时生成二维码
  useEffect(() => {
    if (open && mode === "qrcode" && (addingAccount || (!isLoggedIn && accountsLoaded && accounts.length === 0))) {
      generateQrcode();
      setPolling(true);
    }
    return () => {
      setPolling(false);
    };
  }, [accounts.length, accountsLoaded, open, mode, isLoggedIn, addingAccount, generateQrcode]);

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
      handleClose(true);
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
      setCookieInput("");
      handleClose(true);
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
      await invoke("clear_user_info");
      const guestConfig = await invoke<BackendConfig>("get_config");
      setConfig({ ...guestConfig, sessdata: "", cookie: "" });
      setUserInfo(null);
      resetAccountScopedState();
      setAddingAccount(false);
      setAccountListOpen(false);
      await loadAccounts();
      notifyAccountChanged();
    } catch (e) {
      console.error("登出失败:", e);
    } finally {
      setLoggingOut(false);
    }
  };

  const handleToggleAccountList = async () => {
    if (accountListOpen) {
      setAccountListOpen(false);
      return;
    }
    setError("");
    try {
      await loadAccounts();
      setAccountListOpen(true);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleSwitchAccount = async (profile: string) => {
    setSwitchingProfile(profile);
    setError("");
    try {
      const result = await invoke<AccountSwitchResult>("switch_account_profile", { profile });
      setConfig(result.config);
      setUserInfo(result.user_info ? {
        username: result.user_info.uname,
        avatar: result.user_info.face,
        loginTime: result.user_info.login_time || "--",
        deviceName: "Windows 桌面端",
      } : null);
      resetAccountScopedState();
      setAccountListOpen(false);
      setAddingAccount(false);
      void loadAccounts();
      notifyAccountChanged();
    } catch (err) {
      setError(String(err));
    } finally {
      setSwitchingProfile("");
    }
  };

  const handleAddAccount = () => {
    setError("");
    setCookieInput("");
    setAccountListOpen(false);
    setAddingAccount(true);
    setMode("qrcode");
    void generateQrcode();
    setPolling(true);
  };

  const applyAccountResult = useCallback((result: AccountSwitchResult) => {
    setConfig(result.config);
    setUserInfo(result.user_info ? {
      username: result.user_info.uname,
      avatar: result.user_info.face,
      loginTime: result.user_info.login_time || "--",
      deviceName: "Windows 桌面端",
    } : null);
    resetAccountScopedState();
    notifyAccountChanged();
  }, [notifyAccountChanged, resetAccountScopedState, setConfig, setUserInfo]);

  const handleDeleteAccount = async (profile: string, accountName?: string) => {
    if (!window.confirm(`确定删除本地账号数据「${accountName || profile}」吗？这会删除该账号的配置、缓存和下载目录。`)) {
      return;
    }
    setDeletingProfile(profile);
    setError("");
    try {
      const result = await invoke<AccountSwitchResult>("delete_saved_account_data", { profile });
      applyAccountResult(result);
      setAddingAccount(false);
      setAccountListOpen(false);
      await loadAccounts();
    } catch (err) {
      setError(String(err));
    } finally {
      setDeletingProfile("");
    }
  };

  const handleLogoutAndDelete = async () => {
    const savedAccounts = await loadAccounts();
    const activeAccount = savedAccounts.find((account) => account.active);
    if (!activeAccount) {
      setError("未找到当前账号的本地数据");
      return;
    }
    await handleDeleteAccount(activeAccount.profile, activeAccount.username);
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
          onClick={handleClose}
        >
          {isLoggedIn && !addingAccount ? (
            <LoggedInPanel
              key="logged-in-panel"
              username={username}
              userInfo={userInfo}
              loggingOut={loggingOut}
              accounts={accounts}
              accountListOpen={accountListOpen}
              switchingProfile={switchingProfile}
              deletingProfile={deletingProfile}
              onClose={handleClose}
              onLogout={handleLogout}
              onLogoutAndDelete={() => void handleLogoutAndDelete()}
              onToggleAccountList={() => void handleToggleAccountList()}
              onAddAccount={handleAddAccount}
              onSwitchAccount={(profile) => void handleSwitchAccount(profile)}
            />
          ) : shouldShowSavedAccounts ? (
            <LoggedOutAccountPanel
              accounts={accounts}
              switchingProfile={switchingProfile}
              deletingProfile={deletingProfile}
              onClose={handleClose}
              onAddAccount={handleAddAccount}
              onSwitchAccount={(profile) => void handleSwitchAccount(profile)}
              onDeleteAccount={(profile, username) => void handleDeleteAccount(profile, username)}
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
              onClose={handleClose}
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
  accounts: SavedAccountProfile[];
  accountListOpen: boolean;
  switchingProfile: string;
  deletingProfile: string;
  onClose: () => void;
  onLogout: () => void;
  onLogoutAndDelete: () => void;
  onToggleAccountList: () => void;
  onAddAccount: () => void;
  onSwitchAccount: (profile: string) => void;
}

function LoggedInPanel({
  username,
  userInfo,
  loggingOut,
  accounts,
  accountListOpen,
  switchingProfile,
  deletingProfile,
  onClose,
  onLogout,
  onLogoutAndDelete,
  onToggleAccountList,
  onAddAccount,
  onSwitchAccount,
}: LoggedInPanelProps) {
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
        maxHeight: "calc(100vh - 48px)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--color-bg-secondary)",
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
              color: "var(--color-text)",
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
      <div style={{ padding: "4px 28px 18px", display: "flex", flexWrap: "wrap", gap: "10px" }}>
        <motion.button
          type="button"
          onClick={onToggleAccountList}
          disabled={loggingOut || Boolean(switchingProfile) || Boolean(deletingProfile)}
          whileHover={!loggingOut && !switchingProfile && !deletingProfile ? { backgroundColor: "#f7f7ff", borderColor: "#a5b4fc" } : {}}
          whileTap={!loggingOut && !switchingProfile && !deletingProfile ? { scale: 0.985 } : {}}
          className="cursor-pointer w-full"
          style={{
            height: "42px",
            borderRadius: "11px",
            border: "1.5px solid #d8d8e4",
            background: "var(--color-bg-secondary)",
            color: "#505065",
            fontSize: "14px",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            transition: "all 0.15s",
            marginBottom: 0,
            order: 2,
            width: "calc(50% - 5px)",
          }}
        >
          <Users className="w-[15px] h-[15px]" />
          切换账号
        </motion.button>
        {accountListOpen ? (
          <div style={{ display: "grid", gap: "8px", marginBottom: "2px", maxHeight: "230px", overflowY: "auto", paddingRight: "4px", order: 1, flexBasis: "100%" }}>
            <button
              type="button"
              onClick={onAddAccount}
              disabled={loggingOut || Boolean(switchingProfile)}
              style={{
                height: "38px",
                borderRadius: "10px",
                border: "1.5px dashed #a5b4fc",
                background: "#f8f7ff",
                color: "#6366f1",
                fontSize: "13px",
                fontWeight: 800,
                cursor: loggingOut || switchingProfile ? "not-allowed" : "pointer",
              }}
            >
              添加账号
            </button>
            {accounts.length ? accounts.map((account) => (
              <button
                key={account.profile}
                type="button"
                disabled={account.active || Boolean(switchingProfile) || Boolean(deletingProfile)}
                onClick={() => onSwitchAccount(account.profile)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "32px minmax(0, 1fr) auto",
                  alignItems: "center",
                  gap: "9px",
                  padding: "9px 10px",
                  borderRadius: "10px",
                  border: account.active ? "1.5px solid #6366f1" : "1px solid #ececf2",
                  background: account.active ? "#f5f3ff" : "#fff",
                  cursor: account.active || switchingProfile || deletingProfile ? "default" : "pointer",
                  textAlign: "left",
                }}
              >
                <img src={account.face} alt={account.username} referrerPolicy="no-referrer" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", background: "#eef2ff" }} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", color: "var(--color-text)", fontSize: "13px", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.username}</span>
                  <span style={{ color: "var(--color-text-secondary)", fontSize: "11.5px" }}>UID {account.mid}</span>
                </span>
                <span style={{ color: account.active ? "#6366f1" : "#505065", fontSize: "12px", fontWeight: 800 }}>
                  {account.active ? "当前" : switchingProfile === account.profile ? "切换中" : "切换"}
                </span>
              </button>
            )) : (
              <div style={{ color: "var(--color-text-secondary)", fontSize: "12.5px", textAlign: "center", padding: "4px 0 10px" }}>
                暂无可切换的已保存账号
              </div>
            )}
          </div>
        ) : null}
        <motion.button
          type="button"
          onClick={onLogout}
          disabled={loggingOut || Boolean(deletingProfile)}
          whileHover={!loggingOut && !deletingProfile ? { backgroundColor: "#fef2f2", borderColor: "#f87171" } : {}}
          whileTap={!loggingOut && !deletingProfile ? { scale: 0.985 } : {}}
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
            order: 2,
            width: "calc(50% - 5px)",
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
        <motion.button
          type="button"
          onClick={onLogoutAndDelete}
          disabled={loggingOut || Boolean(switchingProfile) || Boolean(deletingProfile)}
          whileHover={!loggingOut && !switchingProfile && !deletingProfile ? { backgroundColor: "#fff7ed", borderColor: "#fb923c" } : {}}
          whileTap={!loggingOut && !switchingProfile && !deletingProfile ? { scale: 0.985 } : {}}
          className="cursor-pointer w-full"
          style={{
            height: "40px",
            borderRadius: "11px",
            border: "1.5px solid #fed7aa",
            background: "var(--color-bg-secondary)",
            color: deletingProfile ? "#bbb" : "#ea580c",
            fontSize: "13.5px",
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            transition: "all 0.15s",
            order: 3,
            flexBasis: "100%",
          }}
        >
          {deletingProfile ? (
            <>
              <Loader2 className="w-[15px] h-[15px]" style={{ animation: "spin 1s linear infinite" }} />
              删除中...
            </>
          ) : (
            <>
              <Trash2 className="w-[15px] h-[15px]" />
              退出账号并删除数据
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

function LoggedOutAccountPanel({
  accounts,
  switchingProfile,
  deletingProfile,
  onClose,
  onAddAccount,
  onSwitchAccount,
  onDeleteAccount,
}: {
  accounts: SavedAccountProfile[];
  switchingProfile: string;
  deletingProfile: string;
  onClose: () => void;
  onAddAccount: () => void;
  onSwitchAccount: (profile: string) => void;
  onDeleteAccount: (profile: string, username?: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: 16 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      onClick={(event) => event.stopPropagation()}
      className="relative"
      style={{
        width: "400px",
        maxHeight: "calc(100vh - 48px)",
        overflow: "hidden",
        background: "var(--color-bg-secondary)",
        borderRadius: "18px",
        boxShadow: "0 24px 64px rgba(0,0,0,0.2), 0 4px 12px rgba(0,0,0,0.08)",
      }}
    >
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
        className="absolute top-4 right-4 flex items-center justify-center cursor-pointer z-10"
        style={{ width: "30px", height: "30px", borderRadius: "8px", border: "none", background: "transparent", color: "#9999aa" }}
      >
        <X className="w-[16px] h-[16px]" />
      </button>

      <div style={{ padding: "34px 28px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
          <div style={{ width: 46, height: 46, borderRadius: 14, display: "grid", placeItems: "center", background: "#f0efff", color: "#6366f1" }}>
            <Users className="w-[22px] h-[22px]" />
          </div>
          <div>
            <h2 style={{ color: "var(--color-text)", fontSize: "18px", fontWeight: 800 }}>选择本地账号</h2>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "12.5px", marginTop: "3px" }}>已保存的账号可直接切换，无需重新扫码</p>
          </div>
        </div>

        <div style={{ display: "grid", gap: "8px", maxHeight: "300px", overflowY: "auto", paddingRight: "4px" }}>
          {accounts.map((account) => (
            <div
              key={account.profile}
              style={{
                display: "grid",
                gridTemplateColumns: "36px minmax(0, 1fr) auto auto",
                alignItems: "center",
                gap: "10px",
                padding: "10px 11px",
                borderRadius: "11px",
                border: "1px solid #ececf2",
                background: "#fff",
                textAlign: "left",
              }}
            >
              <img src={account.face} alt={account.username} referrerPolicy="no-referrer" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", background: "#eef2ff" }} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", color: "var(--color-text)", fontSize: "13px", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.username}</span>
                <span style={{ color: "var(--color-text-secondary)", fontSize: "11.5px" }}>UID {account.mid}</span>
              </span>
              <button
                type="button"
                disabled={Boolean(switchingProfile) || Boolean(deletingProfile)}
                onClick={() => onSwitchAccount(account.profile)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#6366f1",
                  fontSize: "12px",
                  fontWeight: 800,
                  cursor: switchingProfile || deletingProfile ? "wait" : "pointer",
                  padding: "6px 4px",
                  whiteSpace: "nowrap",
                }}
              >
                {switchingProfile === account.profile ? "切换中" : "进入"}
              </button>
              <button
                type="button"
                disabled={Boolean(switchingProfile) || Boolean(deletingProfile)}
                onClick={() => onDeleteAccount(account.profile, account.username)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: deletingProfile === account.profile ? "#bbb" : "#ef4444",
                  fontSize: "12px",
                  fontWeight: 800,
                  cursor: switchingProfile || deletingProfile ? "wait" : "pointer",
                  padding: "6px 0",
                  whiteSpace: "nowrap",
                }}
              >
                {deletingProfile === account.profile ? "删除中" : "删除数据"}
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={onAddAccount}
          disabled={Boolean(switchingProfile) || Boolean(deletingProfile)}
          style={{
            width: "100%",
            height: "42px",
            marginTop: "14px",
            borderRadius: "11px",
            border: "1.5px dashed #a5b4fc",
            background: "#f8f7ff",
            color: "#6366f1",
            fontSize: "14px",
            fontWeight: 800,
            cursor: switchingProfile || deletingProfile ? "not-allowed" : "pointer",
          }}
        >
          添加账号
        </button>
      </div>
    </motion.div>
  );
}

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
        background: "var(--color-bg-secondary)",
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
                background: "var(--color-bg-secondary)",
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
              background: "var(--color-bg-secondary)",
              fontSize: "14px",
              color: "var(--color-text)",
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
