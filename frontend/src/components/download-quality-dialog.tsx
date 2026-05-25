import { useCallback, useState } from "react";
import { Download, X } from "lucide-react";
import { invoke } from "@/lib/api";

export const DOWNLOAD_QUALITY_OPTIONS = [
  { value: "4k", label: "4K" },
  { value: "1080p_plus", label: "1080P+" },
  { value: "1080p", label: "1080P" },
  { value: "720p", label: "720P" },
  { value: "480p", label: "480P" },
  { value: "360p", label: "360P" },
] as const;

interface DownloadPreferenceConfig {
  download_quality: string;
  prompt_download_quality?: boolean;
}

interface PendingPrompt {
  selectedQuality: string;
  resolve: (quality: string | null) => void;
}

export function useDownloadQualityPrompt() {
  const [pending, setPending] = useState<PendingPrompt | null>(null);

  const requestDownloadQuality = useCallback(async (): Promise<string | null> => {
    const config = await invoke<DownloadPreferenceConfig>("get_config");
    const preferredQuality = config.download_quality || "1080p";
    if (!config.prompt_download_quality) {
      return preferredQuality;
    }

    return new Promise<string | null>((resolve) => {
      setPending({ selectedQuality: preferredQuality, resolve });
    });
  }, []);

  const updateSelectedQuality = (selectedQuality: string) => {
    setPending((current) => (current ? { ...current, selectedQuality } : current));
  };

  const completePrompt = (confirmed: boolean) => {
    if (!pending) return;
    const quality = confirmed ? pending.selectedQuality : null;
    pending.resolve(quality);
    setPending(null);
  };

  return {
    requestDownloadQuality,
    downloadQualityDialog: pending ? (
      <DownloadQualityDialog
        selectedQuality={pending.selectedQuality}
        onQualityChange={updateSelectedQuality}
        onCancel={() => completePrompt(false)}
        onConfirm={() => completePrompt(true)}
      />
    ) : null,
  };
}

function DownloadQualityDialog({
  selectedQuality,
  onQualityChange,
  onCancel,
  onConfirm,
}: {
  selectedQuality: string;
  onQualityChange: (quality: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="presentation"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        backgroundColor: "rgba(15, 23, 42, 0.34)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="选择下载清晰度"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(400px, 100%)",
          borderRadius: "14px",
          border: "1px solid #e7e7ef",
          backgroundColor: "#fff",
          boxShadow: "0 18px 48px rgba(15, 23, 42, 0.2)",
          padding: "20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Download style={{ width: 19, height: 19, color: "#6366f1" }} />
            <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#1a1a2e" }}>选择下载清晰度</h3>
          </div>
          <button type="button" onClick={onCancel} aria-label="关闭" style={iconButtonStyle}>
            <X style={{ width: 17, height: 17 }} />
          </button>
        </div>

        <select
          aria-label="下载清晰度"
          value={selectedQuality}
          onChange={(event) => onQualityChange(event.target.value)}
          style={{
            width: "100%",
            height: "42px",
            borderRadius: "9px",
            border: "1px solid #dedee7",
            padding: "0 12px",
            color: "#26263b",
            backgroundColor: "#fff",
            fontSize: "14px",
          }}
        >
          {DOWNLOAD_QUALITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" }}>
          <button type="button" onClick={onCancel} style={cancelButtonStyle}>取消</button>
          <button type="button" onClick={onConfirm} style={confirmButtonStyle}>开始下载</button>
        </div>
      </div>
    </div>
  );
}

const iconButtonStyle: React.CSSProperties = {
  width: "30px",
  height: "30px",
  border: "none",
  borderRadius: "7px",
  backgroundColor: "#f5f5fa",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#555568",
  cursor: "pointer",
};

const cancelButtonStyle: React.CSSProperties = {
  height: "38px",
  padding: "0 16px",
  borderRadius: "9px",
  border: "1px solid #dedee7",
  color: "#505065",
  backgroundColor: "#fff",
  fontSize: "13.5px",
  fontWeight: 600,
  cursor: "pointer",
};

const confirmButtonStyle: React.CSSProperties = {
  ...cancelButtonStyle,
  border: "1px solid #6366f1",
  color: "#fff",
  backgroundColor: "#6366f1",
};
