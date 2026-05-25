import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Cookie,
  FolderOpen,
  Loader2,
  Maximize2,
  Monitor,
  MonitorPlay,
  Moon,
  Palette,
  Rows3,
  Sun,
} from "lucide-react";
import { motion } from "framer-motion";
import { DOWNLOAD_QUALITY_OPTIONS } from "@/components/download-quality-dialog";
import { invoke } from "@/lib/api";
import { useAppStore } from "@/stores/app-store";

type ThemeMode = "light" | "dark" | "system";

interface BackendConfig {
  download_dir: string;
  start_maximized: boolean;
  card_scale: number;
  card_page_size: number;
  sessdata: string;
  cookie?: string;
  theme: string;
  download_quality: string;
  prompt_download_quality: boolean;
  task_concurrency: number;
  [key: string]: unknown;
}

export function SettingsView() {
  const userInfo = useAppStore((s) => s.userInfo);
  const setConfig = useAppStore((s) => s.setConfig);
  const setUserInfo = useAppStore((s) => s.setUserInfo);
  const [loading, setLoading] = useState(true);
  const [backendConfig, setBackendConfig] = useState<BackendConfig | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const nextConfig = await invoke<BackendConfig>("get_config");
      setBackendConfig(nextConfig);
      setConfig(nextConfig);
    } finally {
      setLoading(false);
    }
  }, [setConfig]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const saveConfig = useCallback(
    async (updates: Partial<BackendConfig>) => {
      const currentConfig = backendConfig ?? (await invoke<BackendConfig>("get_config"));
      const nextConfig = { ...currentConfig, ...updates };
      await invoke("save_config", { newConfig: nextConfig });
      setBackendConfig(nextConfig);
      setConfig(nextConfig);
    },
    [backendConfig, setConfig]
  );

  const isLoggedIn = useMemo(() => userInfo !== null, [userInfo]);

  const handleLogout = async () => {
    const currentConfig = await invoke<BackendConfig>("get_config");
    const nextConfig = { ...currentConfig, sessdata: "", cookie: "" };
    await invoke("save_config", { newConfig: nextConfig });
    await invoke("clear_user_info");
    setBackendConfig(nextConfig);
    setConfig(nextConfig);
    setUserInfo(null);
  };

  const handleBrowseFolder = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
      title: "选择下载目录",
    });
    if (selected && typeof selected === "string") {
      await saveConfig({ download_dir: selected });
    }
  };

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
        <Loader2 className="animate-spin" style={{ width: 32, height: 32, color: "#6366f1" }} />
      </div>
    );
  }

  return (
    <div style={{ width: "100%", padding: "36px 44px 48px", minHeight: "100%" }}>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{ marginBottom: "28px" }}
      >
        <h1 style={{ fontSize: "24px", fontWeight: 800, color: "#1a1a2e", lineHeight: 1.25 }}>
          设置
        </h1>
        <p style={{ fontSize: "14px", color: "#8b8b9a", marginTop: "5px" }}>
          个性化配置 BiliBox
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.35 }}
        style={{
          backgroundColor: "#fff",
          borderRadius: "14px",
          border: "1.5px solid #ececf2",
          overflow: "hidden",
        }}
      >
        <SettingRow
          icon={<Cookie style={{ width: 21, height: 21, color: "#d97706" }} />}
          iconBgColor="#fef9e6"
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
                    backgroundColor: "#f0fdf4",
                    color: "#16a34a",
                  }}
                >
                  已登录：{userInfo?.username}
                </span>
              ) : (
                <span style={{ fontSize: "13px", color: "#8b8b9a" }}>未登录</span>
              )}
              {isLoggedIn ? (
                <button onClick={() => void handleLogout()} style={secondaryButtonStyle}>
                  退出登录
                </button>
              ) : null}
            </div>
          }
        />

        <SettingRow
          icon={<Palette style={{ width: 21, height: 21, color: "#6366f1" }} />}
          iconBgColor="#f0efff"
          title="外观主题"
          description="选择应用使用的配色模式"
          control={
            <ThemeSelector
              value={(backendConfig.theme as ThemeMode) || "system"}
              onChange={(theme) => void saveConfig({ theme })}
            />
          }
        />

        <SettingRow
          icon={<FolderOpen style={{ width: 21, height: 21, color: "#059669" }} />}
          iconBgColor="#ecfdf5"
          title="下载目录"
          description="设置下载文件的默认保存位置"
          control={
            <div style={{ display: "flex", alignItems: "center", gap: "10px", maxWidth: "420px" }}>
              <span
                style={{
                  fontSize: "13.5px",
                  color: "#33334a",
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
          icon={<MonitorPlay style={{ width: 21, height: 21, color: "#2563eb" }} />}
          iconBgColor="#eff6ff"
          title="下载画质策略"
          description="可在每次下载时选择画质，或直接使用默认画质"
          control={
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <div style={{ display: "flex", alignItems: "center", padding: "3px", gap: "2px", backgroundColor: "#f3f3f8", borderRadius: "10px" }}>
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
              <select
                aria-label="默认下载清晰度"
                value={backendConfig.download_quality}
                onChange={(e) => void saveConfig({ download_quality: e.target.value })}
                style={{ ...selectStyle, opacity: backendConfig.prompt_download_quality ? 0.72 : 1 }}
              >
                {DOWNLOAD_QUALITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    默认 {option.label}
                  </option>
                ))}
              </select>
            </div>
          }
        />

        <SettingRow
          icon={<Maximize2 style={{ width: 21, height: 21, color: "#7c3aed" }} />}
          iconBgColor="#faf5ff"
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
          icon={<Rows3 style={{ width: 21, height: 21, color: "#0f766e" }} />}
          iconBgColor="#ecfeff"
          title="数据卡片大小"
          description="拖动滑块后，卡片的图片、间距和字体会一起缩放"
          control={
            <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: "300px" }}>
              <span style={{ fontSize: "12px", color: "#8b8b9a", width: "28px", textAlign: "right" }}>
                小
              </span>
              <input
                type="range"
                min={0.7}
                max={1.6}
                step={0.05}
                value={backendConfig.card_scale ?? 1}
                onChange={(e) => {
                  const nextScale = Number(e.target.value);
                  setBackendConfig((prev) => (prev ? { ...prev, card_scale: nextScale } : prev));
                }}
                onMouseUp={(e) => void saveConfig({ card_scale: Number((e.target as HTMLInputElement).value) })}
                onTouchEnd={(e) => {
                  const target = e.target as HTMLInputElement;
                  void saveConfig({ card_scale: Number(target.value) });
                }}
                style={{ width: "180px" }}
              />
              <span style={{ fontSize: "12px", color: "#8b8b9a", width: "28px" }}>大</span>
              <span
                style={{
                  minWidth: "52px",
                  textAlign: "center",
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "#1a1a2e",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {Math.round((backendConfig.card_scale ?? 1) * 100)}%
              </span>
            </div>
          }
        />

        <SettingRow
          icon={<Rows3 style={{ width: 21, height: 21, color: "#0891b2" }} />}
          iconBgColor="#ecfeff"
          title="每页卡片数量"
          description="固定卡片列表每页显示数量，卡片区域单独滚动"
          control={
            <NumberStepper
              value={backendConfig.card_page_size || 12}
              min={4}
              max={60}
              onChange={(value) => void saveConfig({ card_page_size: value })}
            />
          }
        />

        <SettingRow
          icon={<Monitor style={{ width: 21, height: 21, color: "#0f766e" }} />}
          iconBgColor="#ecfeff"
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
          isLast
        />
      </motion.div>
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
  description: string;
  control: React.ReactNode;
  isLast?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "16px",
        padding: "22px 28px",
        borderBottom: isLast ? "none" : "1px solid #f5f5f8",
      }}
    >
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

      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ fontSize: "15px", fontWeight: 600, color: "#1a1a2e", marginBottom: "3px" }}>
          {title}
        </h3>
        <p style={{ fontSize: "13px", color: "#8b8b9a" }}>{description}</p>
      </div>

      <div style={{ flexShrink: 0 }}>{control}</div>
    </div>
  );
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
        backgroundColor: "#f3f3f8",
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
              border: active ? "1.5px solid #6366f1" : "1.5px solid transparent",
              color: active ? "#6366f1" : "#505065",
              backgroundColor: active ? "#fff" : "transparent",
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
        backgroundColor: checked ? "#6366f1" : "#d4d4dc",
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
          backgroundColor: "#fff",
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
        border: active ? "1px solid #6366f1" : "1px solid transparent",
        backgroundColor: active ? "#fff" : "transparent",
        color: active ? "#6366f1" : "#505065",
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
        border: "1.5px solid #e2e2ea",
        overflow: "hidden",
        backgroundColor: "#fff",
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
          color: "#1a1a2e",
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

const selectStyle: React.CSSProperties = {
  minWidth: "180px",
  padding: "9px 12px",
  borderRadius: "10px",
  border: "1.5px solid #e2e2ea",
  backgroundColor: "#fff",
  fontSize: "13.5px",
  color: "#33334a",
};

const secondaryButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "8px 14px",
  borderRadius: "8px",
  fontSize: "13.5px",
  fontWeight: 500,
  color: "#505065",
  backgroundColor: "#fff",
  border: "1.5px solid #e2e2ea",
  cursor: "pointer",
  whiteSpace: "nowrap",
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
    color: disabled ? "#d0d0da" : "#505065",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: "17px",
    fontFamily: "inherit",
  };
}
