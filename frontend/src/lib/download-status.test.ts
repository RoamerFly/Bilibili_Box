import { describe, expect, it } from "vitest";
import { mapDownloadStatus } from "./download-status";

describe("mapDownloadStatus", () => {
  it.each([
    ["Pending", "pending"],
    ["pending", "pending"],
    ["Downloading", "downloading"],
    ["Merging", "merging"],
    ["Paused", "paused"],
    ["Completed", "completed"],
    ["Failed", "error"],
  ] as const)("maps %s to %s", (state, expected) => {
    expect(mapDownloadStatus(state)).toBe(expected);
  });
});
