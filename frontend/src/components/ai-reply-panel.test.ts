import { describe, expect, it } from "vitest";
import { buildAutoContextChain, cleanCommentMessage, computeInitialSelectedRpids, resolveCommentInfo } from "./ai-reply-panel";
import type { CommentItem } from "./comments-section";

describe("ai-reply-panel helpers", () => {
  it("cleans redundant reply prefixes from comment message", () => {
    expect(cleanCommentMessage("回复 @飘雪柳寒青 :确实挺有意思")).toBe("确实挺有意思");
    expect(cleanCommentMessage("回复 @爱唱歌的满满：同感同感！")).toBe("同感同感！");
    expect(cleanCommentMessage("回复 @主评论 :同意楼上观点")).toBe("同意楼上观点");
    expect(cleanCommentMessage("正常没有任何前缀的评论")).toBe("正常没有任何前缀的评论");
    expect(cleanCommentMessage("")).toBe("");
  });

  const rootComment: CommentItem = {
    rpid: 1001,
    root: 0,
    parent: 0,
    dialog: 0,
    message: "这个视频拍得太赞了！",
    ctime: 1700000000,
    like: 50,
    reply_count: 3,
    member: {
      mid: 8888,
      name: "爱唱歌的满满",
      avatar: "",
      level: 5,
    },
  };

  const replyDirectToRoot: CommentItem = {
    rpid: 1002,
    root: 1001,
    parent: 1001,
    dialog: 0,
    message: "回复 @爱唱歌的满满 :同感同感，细节拉满了",
    ctime: 1700000100,
    like: 10,
    reply_count: 1,
    member: {
      mid: 9999,
      name: "咻咻满在发光",
      avatar: "",
      level: 4,
    },
  };

  const replyToSubComment: CommentItem = {
    rpid: 1003,
    root: 1001,
    parent: 1002,
    dialog: 0,
    message: "确实挺有意思",
    ctime: 1700000200,
    like: 2,
    reply_count: 0,
    member: {
      mid: 7777,
      name: "苹果醋-古月",
      avatar: "",
      level: 3,
    },
  };

  const myReply: CommentItem = {
    rpid: 1004,
    root: 1001,
    parent: 1003,
    dialog: 0,
    message: "我也觉得很棒",
    ctime: 1700000300,
    like: 1,
    reply_count: 0,
    member: {
      mid: 12345, // 当前登录用户
      name: "Roamer",
      avatar: "",
      level: 6,
    },
  };

  const commentsMap = new Map<number, CommentItem>([
    [rootComment.rpid, rootComment],
    [replyDirectToRoot.rpid, replyDirectToRoot],
    [replyToSubComment.rpid, replyToSubComment],
    [myReply.rpid, myReply],
  ]);

  it("formats root comment without reply relation prefix", () => {
    const info = resolveCommentInfo(rootComment, rootComment, commentsMap, 12345);
    expect(info.isRoot).toBe(true);
    expect(info.speakerName).toBe("爱唱歌的满满");
    expect(info.relationText).toBe("");
    expect(info.fullHeader).toBe("爱唱歌的满满");
    expect(info.cleanMessage).toBe("这个视频拍得太赞了！");
  });

  it("replaces '回复主评论' with root author real name (咻咻满在发光 回复 @爱唱歌的满满)", () => {
    const info = resolveCommentInfo(replyDirectToRoot, rootComment, commentsMap, 12345);
    expect(info.isRoot).toBe(false);
    expect(info.speakerName).toBe("咻咻满在发光");
    expect(info.relationText).toBe("回复 @爱唱歌的满满");
    expect(info.fullHeader).toBe("咻咻满在发光 回复 @爱唱歌的满满");
    expect(info.cleanMessage).toBe("同感同感，细节拉满了");
  });

  it("reflects reply relation to another sub-comment (苹果醋-古月 回复 @咻咻满在发光)", () => {
    const info = resolveCommentInfo(replyToSubComment, rootComment, commentsMap, 12345);
    expect(info.isRoot).toBe(false);
    expect(info.speakerName).toBe("苹果醋-古月");
    expect(info.relationText).toBe("回复 @咻咻满在发光");
    expect(info.fullHeader).toBe("苹果醋-古月 回复 @咻咻满在发光");
    expect(info.cleanMessage).toBe("确实挺有意思");
  });

  it("identifies current user as '我' when speaking", () => {
    const info = resolveCommentInfo(myReply, rootComment, commentsMap, 12345);
    expect(info.isSelf).toBe(true);
    expect(info.speakerName).toBe("我");
    expect(info.relationText).toBe("回复 @苹果醋-古月");
    expect(info.fullHeader).toBe("我 回复 @苹果醋-古月");
  });

  it("identifies target as '@我' when another user replies to current user", () => {
    const replyToMe: CommentItem = {
      rpid: 1005,
      root: 1001,
      parent: 1004, // replied to myReply (mid: 12345)
      dialog: 0,
      message: "赞成你的看法",
      ctime: 1700000400,
      like: 0,
      reply_count: 0,
      member: {
        mid: 6666,
        name: "路人甲",
        avatar: "",
        level: 2,
      },
    };
    const mapWithMe = new Map(commentsMap);
    mapWithMe.set(replyToMe.rpid, replyToMe);

    const info = resolveCommentInfo(replyToMe, rootComment, mapWithMe, 12345);
    expect(info.speakerName).toBe("路人甲");
    expect(info.relationText).toBe("回复 @我");
    expect(info.fullHeader).toBe("路人甲 回复 @我");
  });

  it("sorts candidate comments chronologically with root comment at top", () => {
    const unordered = [replyToSubComment, rootComment, myReply, replyDirectToRoot];
    const sorted = [...unordered].sort((a, b) => {
      if (a.rpid === rootComment.rpid) return -1;
      if (b.rpid === rootComment.rpid) return 1;
      return (a.ctime || 0) - (b.ctime || 0);
    });

    expect(sorted.map((item) => item.rpid)).toEqual([1001, 1002, 1003, 1004]);
  });

  describe("buildAutoContextChain & computeInitialSelectedRpids", () => {
    // 构造典型层级：A为楼主，B回复A，C回复B，D回复B，E回复D
    const commentA: CommentItem = {
      rpid: 100,
      root: 0,
      parent: 0,
      dialog: 0,
      message: "楼主发言A",
      ctime: 1000,
      like: 10,
      reply_count: 4,
      member: { mid: 1, name: "用户A", avatar: "", level: 5 },
    };

    const commentB: CommentItem = {
      rpid: 200,
      root: 100,
      parent: 100,
      dialog: 0,
      message: "B回复A",
      ctime: 1010,
      like: 5,
      reply_count: 2,
      member: { mid: 2, name: "用户B", avatar: "", level: 4 },
    };

    const commentC: CommentItem = {
      rpid: 300,
      root: 100,
      parent: 200,
      dialog: 0,
      message: "C回复B",
      ctime: 1020,
      like: 1,
      reply_count: 0,
      member: { mid: 3, name: "用户C", avatar: "", level: 3 },
    };

    const commentD: CommentItem = {
      rpid: 400,
      root: 100,
      parent: 200,
      dialog: 0,
      message: "D回复B",
      ctime: 1030,
      like: 3,
      reply_count: 1,
      member: { mid: 4, name: "用户D", avatar: "", level: 6 },
    };

    const commentE: CommentItem = {
      rpid: 500,
      root: 100,
      parent: 400,
      dialog: 0,
      message: "E回复D",
      ctime: 1040,
      like: 0,
      reply_count: 0,
      member: { mid: 5, name: "用户E", avatar: "", level: 2 },
    };

    const hierarchyMap = new Map<number, CommentItem>([
      [commentA.rpid, commentA],
      [commentB.rpid, commentB],
      [commentC.rpid, commentC],
      [commentD.rpid, commentD],
      [commentE.rpid, commentE],
    ]);

    it("1. 回复主评论时，默认自动选择的上下文仅有主评论自身", () => {
      const chain = buildAutoContextChain(commentA, commentA, hierarchyMap);
      expect(chain).toEqual([100]);

      const selected = computeInitialSelectedRpids(commentA, commentA, hierarchyMap, true);
      expect(Array.from(selected)).toEqual([100]);
    });

    it("2. 回复子评论D时，递归追溯到首条子评论B及主评论A（A <- B <- D），排除无关分支C，按时间先后顺序排列", () => {
      const chain = buildAutoContextChain(commentD, commentA, hierarchyMap);
      // 期望顺序为时间先后：A(100) -> B(200) -> D(400)
      expect(chain).toEqual([100, 200, 400]);
      expect(chain.includes(300)).toBe(false); // C 不在链中

      const selected = computeInitialSelectedRpids(commentD, commentA, hierarchyMap, true);
      expect(Array.from(selected)).toEqual([100, 200, 400]);
    });

    it("3. 回复深层子评论E时，追溯整个对话链 A -> B -> D -> E", () => {
      const chain = buildAutoContextChain(commentE, commentA, hierarchyMap);
      expect(chain).toEqual([100, 200, 400, 500]);
    });

    it("4. 回复分支评论C时，追溯 A -> B -> C，不包含D", () => {
      const chain = buildAutoContextChain(commentC, commentA, hierarchyMap);
      expect(chain).toEqual([100, 200, 300]);
      expect(chain.includes(400)).toBe(false);
    });

    it("5. 当关闭自动选择时，仅选择当前被回复的单条评论", () => {
      const selected = computeInitialSelectedRpids(commentD, commentA, hierarchyMap, false);
      expect(Array.from(selected)).toEqual([400]);

      const selectedRoot = computeInitialSelectedRpids(commentA, commentA, hierarchyMap, false);
      expect(Array.from(selectedRoot)).toEqual([100]);
    });

    it("6. 容错处理：若 parent 字段丢失，但正文有 '回复 @用户B :'，仍能正确递归匹配", () => {
      const commentFWithMissingParent: CommentItem = {
        rpid: 600,
        root: 100,
        parent: 0, // 接口 parent 丢失
        dialog: 0,
        message: "回复 @用户B : 容错正文测试",
        ctime: 1050,
        like: 0,
        reply_count: 0,
        member: { mid: 6, name: "用户F", avatar: "", level: 1 },
      };
      const mapWithF = new Map(hierarchyMap);
      mapWithF.set(commentFWithMissingParent.rpid, commentFWithMissingParent);

      const chain = buildAutoContextChain(commentFWithMissingParent, commentA, mapWithF);
      expect(chain).toEqual([100, 200, 600]);
    });
  });
});
