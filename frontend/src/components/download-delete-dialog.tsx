import { AlertTriangle, FileX2, Trash2, X } from "lucide-react";
import { createPortal } from "react-dom";

interface DownloadDeleteDialogProps {
  count: number;
  onConfirm: (deleteFiles: boolean) => void;
  onCancel: () => void;
}

export function DownloadDeleteDialog({ count, onConfirm, onCancel }: DownloadDeleteDialogProps) {
  return createPortal(
    <div
      role="presentation"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "grid",
        placeItems: "center",
        backgroundColor: "rgba(15, 23, 42, 0.4)",
        backdropFilter: "blur(3px)",
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-download-title"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(430px, calc(100vw - 40px))",
          borderRadius: "12px",
          border: "1px solid var(--color-border)",
          backgroundColor: "var(--color-bg-secondary)",
          boxShadow: "var(--shadow-card-hover)",
          padding: "20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
          <span
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              display: "grid",
              placeItems: "center",
              backgroundColor: "rgba(249, 115, 22, 0.1)",
              color: "rgb(249, 115, 22)",
              flexShrink: 0,
            }}
          >
            <AlertTriangle size={21} />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 id="delete-download-title" style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text)" }}>
              删除 {count} 个下载任务？
            </h2>
            <p style={{ marginTop: "7px", fontSize: "13px", lineHeight: 1.6, color: "var(--color-text-secondary)" }}>
              可以只移除任务记录，也可以同时删除磁盘中的已下载文件。删除文件后无法恢复。
            </p>
          </div>
          <button type="button" aria-label="取消删除" onClick={onCancel} style={iconButtonStyle}>
            <X size={16} />
          </button>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "22px" }}>
          <button type="button" onClick={onCancel} style={secondaryButtonStyle}>
            取消
          </button>
          <button type="button" onClick={() => onConfirm(false)} style={secondaryButtonStyle}>
            <Trash2 size={15} />
            仅删除记录
          </button>
          <button type="button" onClick={() => onConfirm(true)} style={dangerButtonStyle}>
            <FileX2 size={15} />
            同步删除文件
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}

const iconButtonStyle: React.CSSProperties = {
  width: "30px",
  height: "30px",
  display: "grid",
  placeItems: "center",
  borderRadius: "8px",
  border: 0,
  color: "var(--color-text-muted)",
  backgroundColor: "var(--color-bg-tertiary)",
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  height: "36px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  padding: "0 12px",
  borderRadius: "8px",
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-bg-secondary)",
  color: "var(--color-text-secondary)",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
};

const dangerButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  color: "#fff",
  borderColor: "var(--color-error)",
  backgroundColor: "var(--color-error)",
};
