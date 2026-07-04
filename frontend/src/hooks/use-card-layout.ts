import { useAppStore, type CardLayoutKey, type CardViewMode } from "@/stores/app-store";

export const DEFAULT_CARD_ROWS = 3;
export const DEFAULT_CARD_COLUMNS = 2;

interface CardLayoutSource {
  card_scale?: unknown;
  card_page_size?: unknown;
  card_page_rows?: unknown;
  card_page_columns?: unknown;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readInt(value: unknown, fallback: number, min: number, max: number) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return clamp(Math.round(numberValue), min, max);
}

function readFloat(value: unknown, fallback: number, min: number, max: number) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return clamp(numberValue, min, max);
}

function inferLegacyGrid(pageSize: number) {
  const safePageSize = clamp(Math.round(pageSize || DEFAULT_CARD_ROWS * DEFAULT_CARD_COLUMNS), 1, 64);
  const rows = clamp(Math.round(Math.sqrt(safePageSize * 0.75)), 1, 8);
  const columns = clamp(Math.ceil(safePageSize / rows), 1, 8);
  return { rows, columns };
}

export function getCardLayout(
  config: CardLayoutSource | null | undefined,
  pageLayout?: { rows?: number; columns?: number },
  viewMode: CardViewMode = "grid",
  pageScale?: number
) {
  const legacyPageSize = readInt(config?.card_page_size, DEFAULT_CARD_ROWS * DEFAULT_CARD_COLUMNS, 1, 64);
  const inferred = inferLegacyGrid(legacyPageSize);
  const rows = readInt(pageLayout?.rows ?? config?.card_page_rows, inferred.rows, 1, 8);
  const columns = readInt(pageLayout?.columns ?? config?.card_page_columns, inferred.columns, 1, 8);
  const effectiveColumns = viewMode === "list" ? 1 : columns;
  const userCardScale = readFloat(pageScale ?? config?.card_scale, 1, 0.7, 1.6);
  const densityScale = clamp(
    Math.sqrt((DEFAULT_CARD_ROWS * DEFAULT_CARD_COLUMNS) / Math.max(1, rows * effectiveColumns)),
    0.6,
    1.45
  );

  return {
    rows,
    columns,
    effectiveColumns,
    pageSize: rows * effectiveColumns,
    userCardScale,
    densityScale,
    cardScale: userCardScale * densityScale,
  };
}

export function useCardLayout(key?: CardLayoutKey, viewMode: CardViewMode = "grid") {
  const config = useAppStore((s) => s.config);
  const pageLayout = useAppStore((s) => key ? s.cardLayouts[key] : undefined);
  const pageScale = useAppStore((s) => key ? s.cardScales[key] : undefined);
  return getCardLayout(config, pageLayout, viewMode, pageScale);
}

export function fixedCardGridColumns(columns: number) {
  return `repeat(${clamp(Math.round(columns), 1, 8)}, minmax(0, 1fr))`;
}
