import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, RefreshCw, Send, Sparkles, X } from "lucide-react";
import { invoke } from "@/lib/api";
import { ClickableAvatar } from "@/components/video-card";
import type { CommentItem } from "@/components/comments-section";

export interface AiReplyPanelProps {
  targetComment: CommentItem;
  rootComment?: CommentItem | null;
  threadReplies?: CommentItem[];
  selfMid: number;
  videoTitle?: string;
  oid?: number | string;
  typeId?: number;
  initialAutoContext?: boolean;
  onApplyDraft: (text: string) => void;
  onClose: () => void;
}

const TONE_PRESETS = [
  { id: "friendly", label: "💬 友善探讨" },
  { id: "humorous", label: "😄 幽默调侃" },
  { id: "agree", label: "👍 点赞认同" },
  { id: "question", label: "🤔 理性求证" },
] as const;

const QUICK_INSTRUCTIONS = [
  "字数简短(30字内)",
  "用幽默反问",
  "委婉指出逻辑漏洞",
  "表示赞同并补充细节",
  "玩梗/接地气",
];

export function cleanCommentMessage(raw: string): string {
  return (raw || "").trim().replace(/^回复\s*@[^：:\s]+\s*[:：]\s*/, "").trim();
}

export interface FormattedCommentInfo {
  rpid: number;
  speakerName: string;
  targetName: string | null;
  relationText: string;
  fullHeader: string;
  cleanMessage: string;
  isSelf: boolean;
  isRoot: boolean;
  ctime: number;
}

export function resolveCommentInfo(
  item: CommentItem,
  rootComment: CommentItem | null | undefined,
  commentsMap: Map<number, CommentItem>,
  selfMid: number
): FormattedCommentInfo {
  const isSelf = selfMid > 0 && item.member.mid === selfMid;
  const speakerName = isSelf ? "我" : (item.member.name || "其他用户");
  const isRoot = !item.root || (rootComment && item.rpid === rootComment.rpid);

  let targetName: string | null = null;
  let relationText = "";

  if (!isRoot) {
    const isDirectToRoot =
      !item.parent ||
      (rootComment && (item.parent === rootComment.rpid || item.parent === item.root));

    if (isDirectToRoot) {
      const isRootSelf = Boolean(selfMid > 0 && rootComment && rootComment.member.mid === selfMid);
      targetName = isRootSelf ? "我" : (rootComment?.member.name || "主评论");
    } else {
      const parentComment = commentsMap.get(item.parent);
      if (parentComment) {
        const isParentSelf = selfMid > 0 && parentComment.member.mid === selfMid;
        targetName = isParentSelf ? "我" : (parentComment.member.name || "用户");
      } else {
        const rawMsg = item.content?.message || item.message || "";
        const match = rawMsg.match(/^回复\s*@([^：:\s]+)\s*[:：]/);
        if (match && match[1]) {
          targetName = match[1];
        } else {
          const isRootSelf = Boolean(selfMid > 0 && rootComment && rootComment.member.mid === selfMid);
          targetName = isRootSelf ? "我" : (rootComment?.member.name || "主评论");
        }
      }
    }
    relationText = `回复 @${targetName}`;
  }

  const rawMessage = item.content?.message || item.message || "";
  const cleanMessage = cleanCommentMessage(rawMessage);
  const fullHeader = relationText ? `${speakerName} ${relationText}` : speakerName;

  return {
    rpid: item.rpid,
    speakerName,
    targetName,
    relationText,
    fullHeader,
    cleanMessage,
    isSelf,
    isRoot: Boolean(isRoot),
    ctime: item.ctime || 0,
  };
}

/**
 * 根据回复关系递归追溯上下文评论链：
 * 1. 回复主评论时，因仅有自身一条，默认仅选择主评论 [rootComment.rpid]；
 * 2. 回复子评论时，自动根据回复递归找到发起的第一条子评论，再找到主评论加入；
 * 3. 沿途找到的所有评论（排除无关分支评论）按时间先后顺序升序排列（主评论固定置顶）。
 */
export function buildAutoContextChain(
  targetComment: CommentItem,
  rootComment: CommentItem | null | undefined,
  commentsMap: Map<number, CommentItem>
): number[] {
  const isRoot = !targetComment.root || (rootComment && targetComment.rpid === rootComment.rpid);
  if (isRoot) {
    return [targetComment.rpid];
  }

  const chain: CommentItem[] = [targetComment];
  const visitedRpids = new Set<number>([targetComment.rpid]);
  let current = targetComment;

  while (true) {
    let parentComment: CommentItem | undefined;
    const parentRpid = current.parent;

    const isDirectParentRoot = Boolean(
      rootComment && (parentRpid === rootComment.rpid || (current.root && parentRpid === current.root))
    );

    if (parentRpid && parentRpid !== 0 && !isDirectParentRoot) {
      if (visitedRpids.has(parentRpid)) {
        break; // 避免循环引用
      }
      parentComment = commentsMap.get(parentRpid);
    }

    // 容错处理：若 parent 为 0 或缺失，但消息正文包含 "回复 @xxx :"
    if (!parentComment && !isDirectParentRoot) {
      const rawMsg = current.content?.message || current.message || "";
      const match = rawMsg.match(/^回复\s*@([^：:\s]+)\s*[:：]/);
      if (match && match[1]) {
        const targetUname = match[1].trim();
        if (rootComment && (rootComment.member.name || "").trim() === targetUname) {
          if (!visitedRpids.has(rootComment.rpid)) {
            visitedRpids.add(rootComment.rpid);
            chain.push(rootComment);
          }
          break;
        } else {
          for (const item of commentsMap.values()) {
            if (
              item.rpid !== current.rpid &&
              !visitedRpids.has(item.rpid) &&
              (item.member.name || "").trim() === targetUname &&
              (item.ctime || 0) <= (current.ctime || 0)
            ) {
              parentComment = item;
              break;
            }
          }
        }
      }
    }

    if (parentComment) {
      visitedRpids.add(parentComment.rpid);
      chain.push(parentComment);
      current = parentComment;
    } else {
      // 已追溯到直接回复主评论的首条子评论，将主评论加入对话链
      if (rootComment && !visitedRpids.has(rootComment.rpid)) {
        visitedRpids.add(rootComment.rpid);
        chain.push(rootComment);
      }
      break;
    }
  }

  // 严格按时间先后顺序排列，主评论固定位于首位
  chain.sort((a, b) => {
    if (rootComment && a.rpid === rootComment.rpid) return -1;
    if (rootComment && b.rpid === rootComment.rpid) return 1;
    const timeDiff = (a.ctime || 0) - (b.ctime || 0);
    if (timeDiff !== 0) return timeDiff;
    return a.rpid - b.rpid;
  });

  return chain.map((item) => item.rpid);
}

export function computeInitialSelectedRpids(
  targetComment: CommentItem,
  rootComment: CommentItem | null | undefined,
  commentsMap: Map<number, CommentItem>,
  autoContext: boolean
): Set<number> {
  if (!autoContext) {
    return new Set<number>([targetComment.rpid]);
  }
  return new Set<number>(buildAutoContextChain(targetComment, rootComment, commentsMap));
}

export function AiReplyPanel({
  targetComment,
  rootComment,
  threadReplies = [],
  selfMid,
  videoTitle,
  oid,
  typeId,
  initialAutoContext,
  onApplyDraft,
  onClose,
}: AiReplyPanelProps) {
  const [extraReplies, setExtraReplies] = useState<CommentItem[]>([]);
  const [loadingExtra, setLoadingExtra] = useState(false);

  // 1. 汇总所有可作为上下文的候选评论（去重，严格按时间序排列）
  const { candidateComments, candidateMap } = useMemo(() => {
    const map = new Map<number, CommentItem>();
    if (rootComment) {
      map.set(rootComment.rpid, rootComment);
    }
    for (const reply of threadReplies) {
      map.set(reply.rpid, reply);
    }
    for (const reply of extraReplies) {
      map.set(reply.rpid, reply);
    }
    map.set(targetComment.rpid, targetComment);

    const sorted = Array.from(map.values()).sort((a, b) => {
      if (rootComment && a.rpid === rootComment.rpid) return -1;
      if (rootComment && b.rpid === rootComment.rpid) return 1;
      const timeDiff = (a.ctime || 0) - (b.ctime || 0);
      if (timeDiff !== 0) return timeDiff;
      return a.rpid - b.rpid;
    });

    return { candidateComments: sorted, candidateMap: map };
  }, [rootComment, threadReplies, extraReplies, targetComment]);

  // 计算当前目标评论关联的递归对话链
  const autoContextChain = useMemo(
    () => buildAutoContextChain(targetComment, rootComment, candidateMap),
    [targetComment, rootComment, candidateMap]
  );
  const autoContextChainSet = useMemo(() => new Set(autoContextChain), [autoContextChain]);

  // 记录用户是否手动增删勾选过评论；若用户手动修改过，后续后台数据拉取不再强行覆盖用户选择
  const userModifiedSelectionRef = useRef(false);
  const [autoContextEnabled, setAutoContextEnabled] = useState<boolean>(initialAutoContext ?? true);

  const [selectedRpids, setSelectedRpids] = useState<Set<number>>(() =>
    computeInitialSelectedRpids(targetComment, rootComment, candidateMap, initialAutoContext ?? true)
  );

  // 初始化时从 AI 设置拉取上下文自动选择配置
  useEffect(() => {
    let cancelled = false;
    invoke<{ settings?: { reply_auto_context?: boolean } }>("get_ai_settings")
      .then((res) => {
        if (cancelled) return;
        if (typeof res?.settings?.reply_auto_context === "boolean") {
          const enabled = res.settings.reply_auto_context;
          setAutoContextEnabled(enabled);
          if (!userModifiedSelectionRef.current) {
            setSelectedRpids(computeInitialSelectedRpids(targetComment, rootComment, candidateMap, enabled));
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // 当候选评论集合更新（如楼中楼加载完毕），且用户未手动修改且处于自动追溯模式时，自动保持完整对话链
  useEffect(() => {
    if (!userModifiedSelectionRef.current && autoContextEnabled) {
      setSelectedRpids(new Set(autoContextChain));
    }
  }, [autoContextChain, autoContextEnabled]);

  const handleToggleAutoContext = () => {
    const nextVal = !autoContextEnabled;
    setAutoContextEnabled(nextVal);
    userModifiedSelectionRef.current = false;
    setSelectedRpids(computeInitialSelectedRpids(targetComment, rootComment, candidateMap, nextVal));
  };

  // 若在主评论触发 AI 回复且本地尚未拉取子评论，自动加载第一页子评论以便供用户勾选上下文
  useEffect(() => {
    if (
      oid &&
      typeId &&
      rootComment &&
      rootComment.reply_count > 0 &&
      threadReplies.length === 0 &&
      extraReplies.length === 0
    ) {
      let cancelled = false;
      setLoadingExtra(true);
      invoke<{ list: CommentItem[] }>("get_comment_replies", {
        oid: String(oid),
        typeId,
        root: rootComment.rpid,
        page: 1,
        pageSize: 10,
      })
        .then((data) => {
          if (!cancelled && data?.list?.length) {
            setExtraReplies(data.list);
          }
        })
        .catch((err) => {
          console.warn("加载楼中楼子评论失败:", err);
        })
        .finally(() => {
          if (!cancelled) setLoadingExtra(false);
        });
      return () => {
        cancelled = true;
      };
    }
  }, [oid, typeId, rootComment, threadReplies.length, extraReplies.length]);

  const [includeVideoTitle, setIncludeVideoTitle] = useState(Boolean(videoTitle));
  const [selectedTone, setSelectedTone] = useState<string>("friendly");
  const [customInstruction, setCustomInstruction] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedDraft, setGeneratedDraft] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const toggleSelect = (rpid: number) => {
    userModifiedSelectionRef.current = true;
    setSelectedRpids((prev) => {
      const next = new Set(prev);
      if (next.has(rpid)) {
        if (next.size > 1) {
          next.delete(rpid);
        }
      } else {
        next.add(rpid);
      }
      return next;
    });
  };

  const handleAppendInstruction = (text: string) => {
    setCustomInstruction((prev) => {
      if (!prev.trim()) return text;
      if (prev.includes(text)) return prev;
      return `${prev.trim()}，${text}`;
    });
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setErrorMessage("");

    // 格式化选中的上下文（严格按时间先后顺序排列，并非按选择顺序）
    const chosenItems = candidateComments
      .filter((c) => selectedRpids.has(c.rpid))
      .sort((a, b) => {
        if (rootComment && a.rpid === rootComment.rpid) return -1;
        if (rootComment && b.rpid === rootComment.rpid) return 1;
        const timeDiff = (a.ctime || 0) - (b.ctime || 0);
        if (timeDiff !== 0) return timeDiff;
        return a.rpid - b.rpid;
      });

    const contextLines: string[] = [];

    if (includeVideoTitle && videoTitle) {
      contextLines.push(`【视频背景】标题：${videoTitle}`);
    }

    contextLines.push("【评论区讨论上下文（按时间先后顺序）】");
    for (const item of chosenItems) {
      const info = resolveCommentInfo(item, rootComment, candidateMap, selfMid);
      contextLines.push(`${info.fullHeader}：${info.cleanMessage}`);
    }

    const targetInfo = resolveCommentInfo(targetComment, rootComment, candidateMap, selfMid);

    const payload = {
      context: contextLines.join("\n"),
      targetSpeaker: targetInfo.fullHeader,
      style: selectedTone,
      instructions: customInstruction.trim(),
      videoTitle: includeVideoTitle ? videoTitle : undefined,
    };

    try {
      const result = await invoke<string>("generate_ai_reply", { request: payload, ...payload });
      setGeneratedDraft(result);
    } catch (err) {
      setErrorMessage(String(err) || "生成失败，请重试");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div
      style={{
        marginTop: "10px",
        borderRadius: "12px",
        border: "1px solid var(--color-primary-transparent, rgba(0, 161, 214, 0.25))",
        backgroundColor: "var(--color-bg-secondary)",
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        fontSize: "13px",
      }}
    >
      {/* 头部标题与关闭按钮 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700, color: "var(--color-primary)" }}>
          <Sparkles style={{ width: 16, height: 16 }} />
          <span>AI 评论回复助手</span>
          <span style={{ fontSize: "11px", fontWeight: 400, color: "var(--color-text-muted)" }}>
            (以“我”的视角生成自然草稿)
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            padding: "4px",
            color: "var(--color-text-muted)",
            cursor: "pointer",
            borderRadius: "6px",
            display: "inline-flex",
            alignItems: "center",
          }}
          title="关闭 AI 面板"
        >
          <X style={{ width: 15, height: 15 }} />
        </button>
      </div>

      {/* 1. 上下文勾选列表 */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px", flexWrap: "wrap", gap: "6px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, color: "var(--color-text)", fontSize: "12.5px" }}>
              选择喂给 AI 的上下文 ({selectedRpids.size}/{candidateComments.length})：
            </span>
            <button
              type="button"
              onClick={handleToggleAutoContext}
              title={autoContextEnabled ? "已开启自动追溯对话链，点击切换为仅勾选当前单条" : "已关闭自动追溯对话链，点击开启智能追溯"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "11px",
                padding: "2px 8px",
                borderRadius: "12px",
                cursor: "pointer",
                backgroundColor: autoContextEnabled
                  ? "var(--color-primary-transparent, rgba(0, 161, 214, 0.12))"
                  : "var(--color-bg-subtle)",
                color: autoContextEnabled ? "var(--color-primary)" : "var(--color-text-muted)",
                border: autoContextEnabled
                  ? "1px solid var(--color-primary)"
                  : "1px solid var(--color-border)",
                transition: "all 0.15s ease",
              }}
            >
              <Sparkles style={{ width: 11, height: 11 }} />
              智能追溯对话链: {autoContextEnabled ? "已开启" : "已关闭"}
            </button>
            <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
              (按时间先后顺序发送)
            </span>
          </div>
          {videoTitle ? (
            <label style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11.5px", color: "var(--color-text-muted)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={includeVideoTitle}
                onChange={(e) => setIncludeVideoTitle(e.target.checked)}
                style={{ cursor: "pointer", accentColor: "var(--color-primary)" }}
              />
              带入视频标题
            </label>
          ) : null}
        </div>

        <div
          style={{
            maxHeight: "160px",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            padding: "6px 8px",
            borderRadius: "8px",
            backgroundColor: "var(--color-bg-subtle)",
            border: "1px solid var(--color-border)",
          }}
        >
          {candidateComments.map((item) => {
            const isTarget = item.rpid === targetComment.rpid;
            const isChecked = selectedRpids.has(item.rpid);
            const isChainNode = autoContextChainSet.has(item.rpid);
            const info = resolveCommentInfo(item, rootComment, candidateMap, selfMid);

            return (
              <div
                key={item.rpid}
                onClick={() => toggleSelect(item.rpid)}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "8px",
                  padding: "5px 6px",
                  borderRadius: "6px",
                  cursor: "pointer",
                  backgroundColor: isChecked ? "var(--color-bg-elevated, rgba(0, 0, 0, 0.04))" : "transparent",
                  border: isChecked ? "1px solid var(--color-primary-transparent, rgba(0, 161, 214, 0.3))" : "1px solid transparent",
                  transition: "background 0.15s ease",
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleSelect(item.rpid)}
                  onClick={(e) => e.stopPropagation()}
                  style={{ marginTop: "3px", cursor: "pointer", accentColor: "var(--color-primary)" }}
                />
                <ClickableAvatar src={item.member.avatar} alt={item.member.name} size={20} />
                <div style={{ flex: 1, minWidth: 0, fontSize: "12px", lineHeight: 1.45 }}>
                  <span style={{ fontWeight: 700, color: info.isSelf ? "var(--color-primary)" : "var(--color-text)" }}>
                    {info.speakerName}
                  </span>
                  {info.relationText ? (
                    <span style={{ color: "var(--color-primary)", fontWeight: 600, fontSize: "11px", marginLeft: "4px" }}>
                      {info.relationText}
                    </span>
                  ) : null}
                  {isTarget ? (
                    <span style={{ marginLeft: "6px", fontSize: "10px", padding: "1px 4px", borderRadius: "4px", backgroundColor: "var(--color-primary-transparent, rgba(0, 161, 214, 0.15))", color: "var(--color-primary)", fontWeight: 600 }}>
                      当前回复目标
                    </span>
                  ) : info.isRoot ? (
                    <span style={{ marginLeft: "6px", fontSize: "10px", padding: "1px 4px", borderRadius: "4px", backgroundColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
                      主楼
                    </span>
                  ) : isChainNode ? (
                    <span style={{ marginLeft: "6px", fontSize: "10px", padding: "1px 4px", borderRadius: "4px", backgroundColor: "var(--color-primary-transparent, rgba(0, 161, 214, 0.08))", color: "var(--color-primary)", border: "1px solid var(--color-primary-transparent, rgba(0, 161, 214, 0.25))" }}>
                      对话链
                    </span>
                  ) : null}
                  <span style={{ color: "var(--color-text-muted)" }}>：</span>
                  <span style={{ color: "var(--color-text)", wordBreak: "break-word" }}>
                    {info.cleanMessage.length > 80 ? `${info.cleanMessage.slice(0, 80)}...` : info.cleanMessage}
                  </span>
                </div>
              </div>
            );
          })}
          {loadingExtra ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "6px", color: "var(--color-text-muted)", fontSize: "11.5px" }}>
              <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />
              正在加载楼中楼子评论...
            </div>
          ) : null}
        </div>
      </div>

      {/* 2. 手动补充信息与要求输入框 */}
      <div>
        <span style={{ fontWeight: 600, color: "var(--color-text)", fontSize: "12.5px", display: "block", marginBottom: "6px" }}>
          补充背景或具体要求（选填）：
        </span>
        <input
          type="text"
          value={customInstruction}
          onChange={(e) => setCustomInstruction(e.target.value)}
          placeholder="例如：说明我是XX老粉 / 用俏皮语气反问 / 强调某观点..."
          style={{
            width: "100%",
            padding: "7px 10px",
            borderRadius: "8px",
            border: "1px solid var(--color-border)",
            backgroundColor: "var(--color-bg)",
            color: "var(--color-text)",
            fontSize: "12px",
            outline: "none",
          }}
        />
        {/* 快捷标签 */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "6px" }}>
          {QUICK_INSTRUCTIONS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => handleAppendInstruction(chip)}
              style={{
                fontSize: "11px",
                padding: "2px 8px",
                borderRadius: "12px",
                border: "1px solid var(--color-border)",
                backgroundColor: "var(--color-bg-subtle)",
                color: "var(--color-text-muted)",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              + {chip}
            </button>
          ))}
        </div>
      </div>

      {/* 3. 语气选择与生成操作条 */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "8px", paddingTop: "4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {TONE_PRESETS.map((tone) => {
            const isSelected = selectedTone === tone.id;
            return (
              <button
                key={tone.id}
                type="button"
                onClick={() => setSelectedTone(tone.id)}
                style={{
                  fontSize: "11.5px",
                  fontWeight: isSelected ? 700 : 500,
                  padding: "3px 9px",
                  borderRadius: "14px",
                  border: isSelected ? "1px solid var(--color-primary)" : "1px solid var(--color-border)",
                  backgroundColor: isSelected ? "var(--color-primary-transparent, rgba(0, 161, 214, 0.15))" : "transparent",
                  color: isSelected ? "var(--color-primary)" : "var(--color-text-muted)",
                  cursor: "pointer",
                }}
              >
                {tone.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          disabled={isGenerating || selectedRpids.size === 0}
          onClick={handleGenerate}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            padding: "6px 14px",
            borderRadius: "8px",
            fontSize: "12.5px",
            fontWeight: 700,
            border: "none",
            backgroundColor: isGenerating ? "var(--color-border)" : "var(--color-primary)",
            color: "#fff",
            cursor: isGenerating ? "not-allowed" : "pointer",
            boxShadow: "0 2px 6px rgba(0, 161, 214, 0.2)",
          }}
        >
          {isGenerating ? (
            <>
              <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />
              生成中...
            </>
          ) : (
            <>
              <Sparkles style={{ width: 13, height: 13 }} />
              生成回复草稿
            </>
          )}
        </button>
      </div>

      {/* 4. 错误提示 */}
      {errorMessage ? (
        <div style={{ color: "var(--color-error-text)", fontSize: "12px" }}>{errorMessage}</div>
      ) : null}

      {/* 5. 生成结果展示与一键填入 */}
      {generatedDraft ? (
        <div
          style={{
            marginTop: "2px",
            padding: "10px 12px",
            borderRadius: "8px",
            backgroundColor: "var(--color-bg-subtle)",
            border: "1px dashed var(--color-primary)",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "11.5px", fontWeight: 700, color: "var(--color-primary)" }}>
              生成的回复草稿（可人工修改后发送）：
            </span>
            <button
              type="button"
              disabled={isGenerating}
              onClick={handleGenerate}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                background: "none",
                border: "none",
                fontSize: "11px",
                color: "var(--color-text-muted)",
                cursor: "pointer",
              }}
              title="重新生成"
            >
              <RefreshCw style={{ width: 11, height: 11 }} />
              换一条
            </button>
          </div>
          <div
            style={{
              fontSize: "13px",
              lineHeight: 1.6,
              color: "var(--color-text)",
              whiteSpace: "pre-wrap",
              backgroundColor: "var(--color-bg)",
              padding: "8px 10px",
              borderRadius: "6px",
              border: "1px solid var(--color-border)",
            }}
          >
            {generatedDraft}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
            <button
              type="button"
              onClick={() => onApplyDraft(generatedDraft)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "5px 12px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 700,
                border: "none",
                backgroundColor: "var(--color-primary)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              <Check style={{ width: 13, height: 13 }} />
              填入回复框
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
