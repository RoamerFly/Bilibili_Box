import { describe, expect, it } from "vitest";
import { isPageCacheFresh } from "./page-cache";

describe("isPageCacheFresh", () => {
  it("accepts entries inside the configured lifetime", () => {
    expect(isPageCacheFresh(9_000, 2_000, 10_000)).toBe(true);
  });

  it("expires old and legacy entries", () => {
    expect(isPageCacheFresh(7_999, 2_000, 10_000)).toBe(false);
    expect(isPageCacheFresh(null, 2_000, 10_000)).toBe(false);
  });

  it("rejects timestamps from the future", () => {
    expect(isPageCacheFresh(10_001, 2_000, 10_000)).toBe(false);
  });
});
