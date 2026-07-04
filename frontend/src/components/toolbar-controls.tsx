import { RefreshCw } from "lucide-react";
import { showNotice } from "@/lib/coming-soon";

interface PurpleRefreshButtonProps {
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void | Promise<void>;
  successMessage?: string;
}

export function PurpleRefreshButton({ loading = false, disabled = false, onClick, successMessage = "刷新成功" }: PurpleRefreshButtonProps) {
  const inactive = disabled || loading;
  const handleClick = async () => {
    await onClick();
    showNotice(successMessage);
  };
  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={inactive}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "6px 11px",
        border: 0,
        borderRadius: "8px",
        background: "transparent",
        color: inactive ? "#a0a0ae" : "#6366f1",
        fontSize: "12.5px",
        fontWeight: 600,
        cursor: inactive ? "wait" : "pointer",
        whiteSpace: "nowrap",
      }}
    >
      <RefreshCw className={loading ? "animate-spin" : ""} size={14} />
      刷新
    </button>
  );
}
