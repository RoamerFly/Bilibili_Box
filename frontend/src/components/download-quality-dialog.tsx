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
  const normalizedPreferredQuality = preferredQuality.trim().toLowerCase();
  const preferredIndex = DOWNLOAD_QUALITY_OPTIONS.findIndex(
    (option) => option.value === normalizedPreferredQuality
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
  const selectedOption = options.find((option) => option.value === selectedQuality);

  return (
    <div
      className="bb-download-quality-overlay"
      role="presentation"
      onClick={onCancel}
    >
      <div
        className="bb-download-quality-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="选择下载清晰度"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="bb-download-quality-header">
          <div className="bb-download-quality-title-group">
            <span className="bb-download-quality-icon">
              <Download style={{ width: 20, height: 20 }} />
            </span>
            <div>
              <h3>选择下载清晰度</h3>
              <p>请选择本次任务优先使用的画质</p>
            </div>
          </div>
          <button type="button" onClick={onCancel} aria-label="关闭" className="bb-download-quality-close">
            <X style={{ width: 17, height: 17 }} />
          </button>
        </div>

        <div className="bb-download-quality-field">
          <label>下载画质</label>
          <Select className="w-full" value={selectedQuality} onValueChange={onQualityChange}>
            <SelectTrigger className="bb-download-quality-select-trigger">
              <SelectValue placeholder="选择下载清晰度">{selectedOption?.label}</SelectValue>
            </SelectTrigger>
            <SelectContent className="w-full z-[1300]">
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p className="bb-download-quality-hint">
          {isBatch
            ? "已汇总全部内容的可用画质；单个视频不支持时会自动使用最接近的较低画质。"
            : "若当前视频不支持所选画质，将自动使用最接近的较低画质。"}
        </p>

        <div className="bb-download-quality-actions">
          <button type="button" onClick={onCancel} className="secondary">取消</button>
          <button type="button" onClick={onConfirm} className="primary">开始下载</button>
        </div>
      </div>
    </div>
  );
}
