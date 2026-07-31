import { LayoutGrid, List, Minus, Plus } from "lucide-react";
import { DEFAULT_CARD_LAYOUT, DEFAULT_CARD_SCALE, useAppStore, type CardLayoutKey, type CardViewMode } from "@/stores/app-store";

interface PageCardControlsProps {
  layoutKey: CardLayoutKey;
  viewMode?: CardViewMode;
  onViewModeChange?: (mode: CardViewMode) => void;
  showViewModeControls?: boolean;
  showLayoutControls?: boolean;
}

export function PageCardControls({
  layoutKey,
  viewMode = "grid",
  onViewModeChange,
  showViewModeControls = true,
  showLayoutControls = true,
}: PageCardControlsProps) {
  const layout = useAppStore((s) => s.cardLayouts[layoutKey] ?? DEFAULT_CARD_LAYOUT);
  const scale = useAppStore((s) => s.cardScales[layoutKey] ?? Number(s.config?.card_scale ?? DEFAULT_CARD_SCALE));
  const setCardLayout = useAppStore((s) => s.setCardLayout);
  const setCardScale = useAppStore((s) => s.setCardScale);
  const rows = Math.max(1, Math.min(8, Math.round(layout.rows || DEFAULT_CARD_LAYOUT.rows)));
  const columns = Math.max(1, Math.min(8, Math.round(layout.columns || DEFAULT_CARD_LAYOUT.columns)));
  const safeScale = Math.max(0.7, Math.min(1.6, Number(scale) || DEFAULT_CARD_SCALE));

  return (
    <div style={containerStyle}>
      {showViewModeControls ? (
        <div style={modeGroupStyle} title="显示模式">
          <ModeButton active={viewMode === "list"} onClick={() => onViewModeChange?.("list")} label="单栏">
            <List style={{ width: 15, height: 15 }} />
          </ModeButton>
          <ModeButton active={viewMode === "grid"} onClick={() => onViewModeChange?.("grid")} label="多宫格">
            <LayoutGrid style={{ width: 15, height: 15 }} />
          </ModeButton>
        </div>
      ) : null}
      {showLayoutControls ? (
        <>
          <div style={stepperGroupStyle} title="卡片行列数">
            <span style={titleStyle}>卡片行列数</span>
            <Stepper label="行" value={rows} onChange={(value) => setCardLayout(layoutKey, { rows: value })} />
            <Stepper label="列" value={columns} onChange={(value) => setCardLayout(layoutKey, { columns: value })} disabled={viewMode === "list"} />
          </div>
          <div style={scaleGroupStyle} title="卡片大小">
            <span style={titleStyle}>卡片大小</span>
            <input
              aria-label="卡片大小"
              type="range"
              min={0.7}
              max={1.6}
              step={0.05}
              value={safeScale}
              onChange={(event) => setCardScale(layoutKey, Number(event.target.value))}
              style={{
                ...rangeStyle,
                background: `linear-gradient(90deg, var(--color-primary) ${((safeScale - 0.7) / 0.9) * 100}%, var(--color-border) ${((safeScale - 0.7) / 0.9) * 100}%)`,
              }}
            />
            <span style={scaleValueStyle}>{Math.round(safeScale * 100)}%</span>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ModeButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        border: active ? "1px solid var(--color-primary)" : "1px solid transparent",
        backgroundColor: active ? "var(--color-bg-elevated)" : "transparent",
        color: active ? "var(--color-primary)" : "var(--color-text-secondary)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Stepper({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, opacity: disabled ? 0.55 : 1 }}>
      <span style={{ color: "var(--color-text-muted)", fontSize: 12, fontWeight: 800 }}>{label}</span>
      <button type="button" disabled={disabled || value <= 1} onClick={() => onChange(value - 1)} style={smallButtonStyle(disabled || value <= 1)}>
        <Minus style={{ width: 12, height: 12 }} />
      </button>
      <span style={{ width: 18, textAlign: "center", color: "var(--color-text)", fontSize: 13, fontWeight: 850, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
      <button type="button" disabled={disabled || value >= 8} onClick={() => onChange(value + 1)} style={smallButtonStyle(disabled || value >= 8)}>
        <Plus style={{ width: 12, height: 12 }} />
      </button>
    </span>
  );
}

const containerStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const modeGroupStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 2,
  padding: 3,
  borderRadius: 10,
  backgroundColor: "var(--color-bg-tertiary)",
};

const stepperGroupStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  height: 38,
  padding: "0 10px",
  borderRadius: 10,
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-bg-secondary)",
  boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
};

const scaleGroupStyle: React.CSSProperties = {
  ...stepperGroupStyle,
  minWidth: 238,
};

const titleStyle: React.CSSProperties = {
  color: "var(--color-text-secondary)",
  fontSize: 12.5,
  fontWeight: 800,
  whiteSpace: "nowrap",
};

const rangeStyle: React.CSSProperties = {
  width: 112,
  height: 5,
  borderRadius: 999,
  accentColor: "var(--color-primary)",
  outline: "none",
  cursor: "pointer",
};

const scaleValueStyle: React.CSSProperties = {
  minWidth: 40,
  textAlign: "right",
  color: "var(--color-text)",
  fontSize: 13,
  fontWeight: 850,
  fontVariantNumeric: "tabular-nums",
};

function smallButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    width: 22,
    height: 22,
    borderRadius: 7,
    border: "1px solid var(--color-border)",
    backgroundColor: "var(--color-bg-secondary)",
    color: disabled ? "var(--color-text-disabled)" : "var(--color-text-secondary)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
