import { describe, expect, it } from "vitest";
import { computeNextActiveReply } from "./comments-section";
import type { ActiveReplyState } from "./comments-section";

describe("CommentsSection active reply state machine", () => {
  it("opens AI reply or normal reply when no comment is currently being replied to", () => {
    expect(computeNextActiveReply(null, 1001, true)).toEqual({
      rpid: 1001,
      isAi: true,
    });

    expect(computeNextActiveReply(null, 1001, false)).toEqual({
      rpid: 1001,
      isAi: false,
    });
  });

  it("enforces single-instance reply across comments (switching to a new comment closes previous one)", () => {
    const prevAi: ActiveReplyState = { rpid: 1001, isAi: true };
    // Clicking AI reply on comment 1002 closes 1001 and opens 1002 as AI
    expect(computeNextActiveReply(prevAi, 1002, true)).toEqual({
      rpid: 1002,
      isAi: true,
    });

    // Clicking normal reply on comment 1002 closes 1001 and opens 1002 as normal
    expect(computeNextActiveReply(prevAi, 1002, false)).toEqual({
      rpid: 1002,
      isAi: false,
    });

    const prevNormal: ActiveReplyState = { rpid: 1001, isAi: false };
    // Clicking AI reply on comment 1002 closes 1001 and opens 1002 as AI
    expect(computeNextActiveReply(prevNormal, 1002, true)).toEqual({
      rpid: 1002,
      isAi: true,
    });
  });

  it("toggles off and closes when clicking the same button on the same comment", () => {
    // 再次点击“AI回复”关闭
    const currentAi: ActiveReplyState = { rpid: 1001, isAi: true };
    expect(computeNextActiveReply(currentAi, 1001, true)).toBeNull();

    // 再次点击普通“回复”关闭
    const currentNormal: ActiveReplyState = { rpid: 1001, isAi: false };
    expect(computeNextActiveReply(currentNormal, 1001, false)).toBeNull();
  });

  it("seamlessly switches mode when clicking the alternate button on the same comment", () => {
    // AI回复助手开启状态下，点击普通“回复”，直接切换为普通回复框
    const currentAi: ActiveReplyState = { rpid: 1001, isAi: true };
    expect(computeNextActiveReply(currentAi, 1001, false)).toEqual({
      rpid: 1001,
      isAi: false,
    });

    // 普通回复框开启状态下，点击“AI回复”，直接切换为AI回复助手
    const currentNormal: ActiveReplyState = { rpid: 1001, isAi: false };
    expect(computeNextActiveReply(currentNormal, 1001, true)).toEqual({
      rpid: 1001,
      isAi: true,
    });
  });
});
