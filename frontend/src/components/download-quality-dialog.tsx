import { useCallback, useState } from "react";
import { Download, X } from "lucide-react";
import { invoke } from "@/lib/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface DownloadQualityTarget {
  bvid: string;
  cid: number;
}

interface DownloadQualityOption {
  id: number;
  value: string;
  label: string;
}

export const DOWNLOAD_QUALITY_OPTIONS: DownloadQualityOption[] = [
  { id: 127, value: "8k", label: "8K" },
  { id: 126, value: "dolby_vision", label: "杜比视界" },
  { id: 125, value: "hdr", label: "HDR" },
  { id: 120, value: "4k", label: "4K" },
  { id: 116, value: "1080p60", label: "1080P60" },
  { id: 112, value: "1080p_plus", label: "1080P+" },
  { id: 100, value: "ai_repair", label: "智能修复" },
  { id: 80, value: "1080p", label: "1080P" },
  { id: 74, value: "720p60", label: "720P60" },
  { id: 64, value: "720p", label: "720P" },
  { id: 32, value: "480p", label: "480P" },
  { id: 16, value: "360p", label: "360P" },
  { id: 6, value: "240p", label: "240P" },
];

interface DownloadPreferenceConfig {
  download_quality: string;
  prompt_download_quality?: boolean;
}

interface DownloadPlayUrlInfo {
  video_list: Array<{ id: number }>;
}

interface PendingPrompt {
  selectedQuality: string;
  options: DownloadQualityOption[];
  isBatch: boolean;
  resolve: (quality: string | null) => void;
}

function normalizeTargets(targets: DownloadQualityTarget | DownloadQualityTarget[]) {
  const entries = Array.isArray(targets) ? targets : [targets];
  return Array.from(
    new Map(entries.map((target) => [`${target.bvid}:${target.cid}`, target])).values()
  );
}

async function loadDownloadQualityOptions(targets: DownloadQualityTarget[]) {
  const responses = await Promise.all(
    targets.map((target) =>
      invoke<DownloadPlayUrlInfo>("get_normal_url", {
        bvid: target.bvid,
        cid: target.cid,
      })
    )
  );
  const availableIds = new Set(
    responses.flatMap((response) => response.video_list.map((video) => video.id))
  );
  const availableOptions = DOWNLOAD_QUALITY_OPTIONS.filter((option) => availableIds.has(option.id));
  if (!availableOptions.length) {
    throw new Error("当前内容没有返回可下载的清晰度列表");
  }
  return availableOptions;
}

function selectDefaultQuality(options: DownloadQualityOption[], preferredQuality: string) {
  const preferredIndex = DOWNLOAD_QUALITY_OPTIONS.findIndex(
    (option) => option.value === preferredQuality
  );
  if (preferredIndex < 0) {
    return options[0].value;
  }
  return (
    options.find(
      (option) =>
        DOWNLOAD_QUALITY_OPTIONS.findIndex((candidate) => candidate.value === option.value) >=
        preferredIndex
    )?.value ?? options[0].value
  );
}

export function useDownloadQualityPrompt() {
  const [pending, setPending] = useState<PendingPrompt | null>(null);

  const requestDownloadQuality = useCallback(
    async (targets: DownloadQualityTarget | DownloadQualityTarget[]): Promise<string | null> => {
      const config = await invoke<DownloadPreferenceConfig>("get_config");
      const preferredQuality = config.download_quality || "1080p";
      if (!config.prompt_download_quality) {
        return preferredQuality;
      }

      const normalizedTargets = normalizeTargets(targets);
      const options = await loadDownloadQualityOptions(normalizedTargets);
      const selectedQuality = selectDefaultQuality(options, preferredQuality);

      return new Promise<string | null>((resolve) => {
        setPending({
          selectedQuality,
          options,
          isBatch: normalizedTargets.length > 1,
          resolve,
        });
      });
    },
    []
  );

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
        options={pending.options}
        isBatch={pending.isBatch}
        onQualityChange={updateSelectedQuality}
        onCancel={() => completePrompt(false)}
        onConfirm={() => completePrompt(true)}
      />
    ) : null,
  };
}

function DownloadQualityDialog({
  selectedQuality,
  options,
  isBatch,
  onQualityChange,
  onCancel,
  onConfirm,
}: {
  selectedQuality: string;
  options: DownloadQualityOption[];
  isBatch: boolean;
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
        backgroundColor: "rgba(15, 23, 42, 0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        backdropFilter: "blur(4px)",
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
          border: "1px solid var(--color-border)",
          backgroundColor: "var(--color-bg-secondary)",
          boxShadow: "var(--shadow-card-hover)",
          padding: "20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justify_content: "space-between", gap: "12px", marginBottom: "18px" } as any}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Download style={{ width: 19, height: 19, color: "var(--color-primary)" }} />
            <h3 style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text)" }}>选择下载清晰度</h3>
          </div>
          <button type="button" onClick={onCancel} aria-label="关闭" style={iconButtonStyle}>
            <X style={{ width: 17, height: 17 }} />
          </button>
        </div>

        <Select value={selectedQuality} onValueChange={onQualityChange}>
          <SelectTrigger className="w-full h-[42px] rounded-[9px] border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[14px]">
            <SelectValue placeholder="选择下载清晰度" />
          </SelectTrigger>
          <SelectContent className="w-full z-[1300]">
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isBatch ? (
          <p style={{ marginTop: "12px", color: "var(--color-text-muted)", fontSize: "12.5px", lineHeight: 1.6 }}>
            已汇总所选内容可用画质；单个内容不支持该画质时，将使用其最高可用画质。
          </p>
        ) : null}

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
  backgroundColor: "var(--color-bg-tertiary)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};

const cancelButtonStyle: React.CSSProperties = {
  height: "38px",
  padding: "0 16px",
  borderRadius: "9px",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  backgroundColor: "var(--color-bg-secondary)",
  fontSize: "13.5px",
  fontWeight: 600,
  cursor: "pointer",
};

const confirmButtonStyle: React.CSSProperties = {
  ...cancelButtonStyle,
  border: "1px solid var(--color-primary)",
  color: "#fff",
  backgroundColor: "var(--color-primary)",
};
