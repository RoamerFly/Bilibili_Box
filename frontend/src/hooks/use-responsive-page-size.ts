import { useEffect, useMemo, useState } from "react";

interface ResponsivePageSizeOptions {
  minCardWidth: number;
  gap: number;
  rowHeight: number;
  reservedHeight: number;
  extraReservedWidth?: number;
  sidebarWidth?: number;
  minPageSize?: number;
}

function readViewport() {
  if (typeof window === "undefined") {
    return { width: 1440, height: 900 };
  }
  return { width: window.innerWidth, height: window.innerHeight };
}

export function useResponsivePageSize({
  minCardWidth,
  gap,
  rowHeight,
  reservedHeight,
  extraReservedWidth = 0,
  sidebarWidth = 240,
  minPageSize = 1,
}: ResponsivePageSizeOptions) {
  const [viewport, setViewport] = useState(readViewport);

  useEffect(() => {
    const handleResize = () => setViewport(readViewport());
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return useMemo(() => {
    const horizontalPadding = 88;
    const availableWidth = Math.max(
      minCardWidth,
      viewport.width - sidebarWidth - horizontalPadding - extraReservedWidth
    );
    const columns = Math.max(
      1,
      Math.floor((availableWidth + gap) / (minCardWidth + gap))
    );
    const availableHeight = Math.max(rowHeight, viewport.height - reservedHeight);
    const rows = Math.max(1, Math.floor((availableHeight + gap) / (rowHeight + gap)));
    const pageSize = Math.max(minPageSize, columns * rows);
    return { columns, rows, pageSize };
  }, [
    extraReservedWidth,
    gap,
    minCardWidth,
    minPageSize,
    reservedHeight,
    rowHeight,
    sidebarWidth,
    viewport.height,
    viewport.width,
  ]);
}

export function buildVisiblePages(currentPage: number, pageCount: number, maxVisible = 5) {
  const start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  const end = Math.min(pageCount, start + maxVisible - 1);
  const pages: number[] = [];
  for (let page = Math.max(1, end - maxVisible + 1); page <= end; page += 1) {
    pages.push(page);
  }
  return pages;
}
