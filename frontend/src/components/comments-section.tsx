import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Ban, ChevronDown, ChevronUp, Copy, Flag, Link2, Loader2, MessageCircle, MoreVertical, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { invoke } from "@/lib/api";
import { ClickableAvatar } from "@/components/video-card";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

interface CommentMember {
  mid: number;
  name: string;
  avatar: string;
  level: number;
}

interface CommentItem {
  rpid: number;
  root: number;
  parent: number;
  dialog: number;
  message: string;
  ctime: number;
  like: number;
  reply_count: number;
  member: CommentMember;
}

interface CommentPage {
  list: CommentItem[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

interface SavedUserInfo {
  mid: number;
  uname: string;
  face: string;
  is_login?: boolean;
}

interface CommentsSectionProps {
  oid?: number | string | null;
  typeId?: number | null;
  title?: string;
  refreshKey?: string | number;
}

const PAGE_SIZE = 10;
const REPLY_PAGE_SIZE = 10;

export function CommentsSection({ oid, typeId, title = "评论区", refreshKey }: CommentsSectionProps) {
  const openUpProfile = useAppStore((s) => s.openUpProfile);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selfMid, setSelfMid] = useState(0);
  const [blockedMids, setBlockedMids] = useState<Set<number>>(new Set());

  const canLoad = Boolean(oid && typeId);
  const filterBlockedComments = (items: CommentItem[]) =>
    items.filter((item) => !blockedMids.has(item.member.mid));

  const loadComments = async (nextPage: number, mode: "replace" | "append" = "replace", force = false) => {
    if (!oid || !typeId || (loading && !force)) return;
    setLoading(true);
    setError("");
    try {
      const data = await invoke<CommentPage>("get_comments", {
        oid: String(oid),
        typeId,
        page: nextPage,
        pageSize: PAGE_SIZE,
      });
      setComments((previous) => {
        const loaded = filterBlockedComments(data.list);
        const merged = mode === "append" ? [...previous, ...loaded] : loaded;
        return Array.from(new Map(merged.map((item) => [item.rpid, item])).values());
      });
      setPage(data.page);
      setTotal(data.total);
      setHasMore(data.has_more);
    } catch (err) {
      setError(String(err));
      if (mode === "replace") {
        setComments([]);
        setTotal(0);
        setHasMore(false);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setComments([]);
    setPage(1);
    setTotal(0);
    setHasMore(false);
    setError("");
    if (canLoad) void loadComments(1, "replace");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oid, typeId, refreshKey]);

  useEffect(() => {
    invoke<SavedUserInfo | null>("get_saved_user_info")
      .then((info) => setSelfMid(info?.mid || 0))
      .catch(() => setSelfMid(0));
  }, []);

  return (
    <section
      style={{
        marginTop: "22px",
        border: "1px solid var(--color-border)",
        backgroundColor: "var(--color-bg-secondary)",
        borderRadius: "16px",
        padding: "20px 22px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "16px" }}>
        <h2 style={{ display: "inline-flex", alignItems: "center", gap: "8px", color: "var(--color-text)", fontSize: "17px", fontWeight: 850 }}>
          <MessageCircle style={{ width: 18, height: 18 }} />
          {title}
        </h2>
        {total ? <span style={{ color: "var(--color-text-muted)", fontSize: "13px", fontWeight: 700 }}>{formatNumber(total)} 条</span> : null}
      </div>

      {!canLoad ? (
        <div style={{ color: "var(--color-text-muted)", fontSize: "14px", padding: "14px 0" }}>当前内容没有可读取的评论区标识</div>
      ) : loading && comments.length === 0 ? (
        <div style={{ height: "120px", display: "grid", placeItems: "center", color: "var(--color-primary)" }}>
          <Loader2 className="animate-spin" style={{ width: 24, height: 24 }} />
        </div>
      ) : error && comments.length === 0 ? (
        <div style={{ color: "var(--color-error-text)", fontSize: "14px", padding: "14px 0" }}>{error}</div>
      ) : comments.length === 0 ? (
        <div style={{ color: "var(--color-text-muted)", fontSize: "14px", padding: "14px 0" }}>暂无评论</div>
      ) : (
        <div style={{ display: "grid", gap: "18px" }}>
          {comments.map((comment) => (
            <CommentEntry
              key={comment.rpid}
              oid={oid!}
              typeId={typeId!}
              selfMid={selfMid}
              comment={comment}
              onDeleted={(rpid) => {
                setComments((previous) => previous.filter((item) => item.rpid !== rpid));
                setTotal((previous) => Math.max(0, previous - 1));
              }}
              onChanged={() => void loadComments(1, "replace", true)}
              blockedMids={blockedMids}
              onBlockMid={(mid) => setBlockedMids((previous) => new Set(previous).add(mid))}
              onUnblockMid={(mid) => setBlockedMids((previous) => {
                const next = new Set(previous);
                next.delete(mid);
                return next;
              })}
            />
          ))}
        </div>
      )}

      {hasMore ? (
        <div style={{ display: "flex", justifyContent: "center", marginTop: "18px" }}>
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadComments(page + 1, "append")}
            style={loadMoreButtonStyle(loading)}
          >
            {loading ? "加载中..." : "加载更多评论"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function CommentEntry({
  oid,
  typeId,
  selfMid,
  comment,
  onDeleted,
  onChanged,
  blockedMids,
  onBlockMid,
  onUnblockMid,
}: {
  oid: number | string;
  typeId: number;
  selfMid: number;
  comment: CommentItem;
  onDeleted: (rpid: number) => void;
  onChanged: () => void;
  blockedMids: Set<number>;
  onBlockMid: (mid: number) => void;
  onUnblockMid: (mid: number) => void;
}) {
  const openUpProfile = useAppStore((s) => s.openUpProfile);
  const [currentComment, setCurrentComment] = useState(comment);
  const [localReplies, setLocalReplies] = useState<CommentItem[]>([]);
  const [replying, setReplying] = useState(false);

  useEffect(() => {
    setCurrentComment(comment);
  }, [comment]);

  useEffect(() => {
    setLocalReplies([]);
  }, [comment.rpid]);

  return (
    <article style={{ display: "grid", gridTemplateColumns: "40px minmax(0, 1fr)", gap: "13px" }}>
      <ClickableAvatar
        src={currentComment.member.avatar}
        alt={currentComment.member.name}
        size={40}
        onClick={() => openUpProfile({ mid: currentComment.member.mid, name: currentComment.member.name, face: currentComment.member.avatar })}
      />
      <div style={{ minWidth: 0, paddingBottom: "16px", borderBottom: "1px solid var(--color-bg-subtle)" }}>
        <CommentBody
          oid={oid}
          typeId={typeId}
          selfMid={selfMid}
          comment={currentComment}
          onReply={() => setReplying(true)}
          onDeleted={onDeleted}
          isBlocked={blockedMids.has(currentComment.member.mid)}
          onBlockMid={onBlockMid}
          onUnblockMid={onUnblockMid}
        />
        {replying ? (
          <ReplyEditor
            placeholder={`回复 @${currentComment.member.name || "匿名用户"}`}
            onCancel={() => setReplying(false)}
            onSubmit={async (message) => {
              const created = await submitCommentReply(oid, typeId, currentComment.rpid, currentComment.rpid, message);
              setCurrentComment((previous) => ({ ...previous, reply_count: previous.reply_count + 1 }));
              setLocalReplies((previous) => mergeComments(previous, [created]));
              setReplying(false);
            }}
          />
        ) : null}
        <ReplyThread
          oid={oid}
          typeId={typeId}
          selfMid={selfMid}
          rootComment={currentComment}
          initialReplies={localReplies}
          blockedMids={blockedMids}
          onBlockMid={onBlockMid}
          onUnblockMid={onUnblockMid}
        />
      </div>
    </article>
  );
}

function ReplyThread({
  oid,
  typeId,
  selfMid,
  rootComment,
  initialReplies,
  blockedMids,
  onBlockMid,
  onUnblockMid,
}: {
  oid: number | string;
  typeId: number;
  selfMid: number;
  rootComment: CommentItem;
  initialReplies: CommentItem[];
  blockedMids: Set<number>;
  onBlockMid: (mid: number) => void;
  onUnblockMid: (mid: number) => void;
}) {
  const openUpProfile = useAppStore((s) => s.openUpProfile);
  const [expanded, setExpanded] = useState(false);
  const [replies, setReplies] = useState<CommentItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(rootComment.reply_count);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [replyTarget, setReplyTarget] = useState<CommentItem | null>(null);

  useEffect(() => {
    setTotal(Math.max(rootComment.reply_count, initialReplies.length));
    if (initialReplies.length > 0) {
      setReplies((previous) => mergeComments(previous, initialReplies));
      setExpanded(true);
    }
  }, [initialReplies, rootComment.reply_count]);

  const replyCount = total;
  const memberByRpid = useMemo(() => {
    const entries: Array<[number, string]> = [[rootComment.rpid, rootComment.member.name]];
    for (const reply of replies) {
      entries.push([reply.rpid, reply.member.name]);
    }
    return new Map(entries);
  }, [replies, rootComment.member.name, rootComment.rpid]);

  if (replyCount <= 0) {
    return null;
  }

  const loadReplies = async (nextPage: number, mode: "replace" | "append" = "replace") => {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const data = await invoke<CommentPage>("get_comment_replies", {
        oid: String(oid),
        typeId,
        root: rootComment.rpid,
        page: nextPage,
        pageSize: REPLY_PAGE_SIZE,
      });
      setReplies((previous) => {
        const loaded = data.list.filter((item) => !blockedMids.has(item.member.mid));
        return mode === "append" ? mergeComments(previous, loaded) : mergeComments(loaded, initialReplies);
      });
      setPage(data.page);
      setTotal(Math.max(data.total || rootComment.reply_count, initialReplies.length));
      setHasMore(data.has_more);
      setExpanded(true);
    } catch (err) {
      setError(String(err));
      setExpanded(true);
      if (mode === "replace") {
        setReplies([]);
        setHasMore(false);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (replies.length > 0) {
      setExpanded(true);
      return;
    }
    void loadReplies(1, "replace");
  };

  return (
    <div style={{ marginTop: "10px" }}>
      <button type="button" onClick={handleToggle} disabled={loading && replies.length === 0} style={replyToggleStyle}>
        {loading && replies.length === 0 ? (
          <Loader2 className="animate-spin" style={{ width: 15, height: 15 }} />
        ) : expanded ? (
          <ChevronUp style={{ width: 15, height: 15 }} />
        ) : (
          <ChevronDown style={{ width: 15, height: 15 }} />
        )}
        {expanded ? "收起回复" : `共 ${formatNumber(replyCount)} 条回复，点击查看`}
      </button>

      {expanded ? (
        <div style={{ marginTop: "12px", display: "grid", gap: "14px", padding: "12px 14px", borderRadius: "12px", backgroundColor: "var(--color-bg-subtle)" }}>
          {error ? <div style={{ color: "var(--color-error-text)", fontSize: "13px" }}>{error}</div> : null}
          {replies.map((reply) => (
            <article key={reply.rpid} style={{ display: "grid", gridTemplateColumns: "30px minmax(0, 1fr)", gap: "10px" }}>
              <ClickableAvatar
                src={reply.member.avatar}
                alt={reply.member.name}
                size={30}
                onClick={() => openUpProfile({ mid: reply.member.mid, name: reply.member.name, face: reply.member.avatar })}
              />
              <div style={{ minWidth: 0 }}>
                <CommentBody
                  oid={oid}
                  typeId={typeId}
                  selfMid={selfMid}
                  comment={reply}
                  compact
                  relationText={getReplyRelationText(reply, rootComment, memberByRpid)}
                  onReply={() => setReplyTarget(reply)}
                  onDeleted={(rpid) => {
                    setReplies((previous) => previous.filter((item) => item.rpid !== rpid));
                    setTotal((previous) => Math.max(0, previous - 1));
                  }}
                  isBlocked={blockedMids.has(reply.member.mid)}
                  onBlockMid={onBlockMid}
                  onUnblockMid={onUnblockMid}
                />
              </div>
            </article>
          ))}
          {replyTarget ? (
            <ReplyEditor
              placeholder={`回复 @${replyTarget.member.name || "匿名用户"}`}
              onCancel={() => setReplyTarget(null)}
              onSubmit={async (message) => {
                const created = await submitCommentReply(oid, typeId, rootComment.rpid, replyTarget.rpid, message);
                setReplies((previous) => mergeComments(previous, [created]));
                setTotal((previous) => previous + 1);
                setExpanded(true);
                setReplyTarget(null);
              }}
            />
          ) : null}
          {loading && replies.length > 0 ? (
            <div style={{ display: "flex", justifyContent: "center", color: "var(--color-primary)", padding: "4px 0" }}>
              <Loader2 className="animate-spin" style={{ width: 18, height: 18 }} />
            </div>
          ) : null}
          {hasMore ? (
            <div style={{ display: "flex", justifyContent: "center" }}>
              <button
                type="button"
                disabled={loading}
                onClick={() => void loadReplies(page + 1, "append")}
                style={loadMoreButtonStyle(loading)}
              >
                {loading ? "加载中..." : "下一页回复"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CommentBody({
  oid,
  typeId,
  selfMid,
  comment,
  compact = false,
  relationText,
  onReply,
  onDeleted,
  isBlocked,
  onBlockMid,
  onUnblockMid,
}: {
  oid: number | string;
  typeId: number;
  selfMid: number;
  comment: CommentItem;
  compact?: boolean;
  relationText?: string;
  onReply?: () => void;
  onDeleted: (rpid: number) => void;
  isBlocked: boolean;
  onBlockMid: (mid: number) => void;
  onUnblockMid: (mid: number) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [toast, setToast] = useState("");
  const isOwn = Boolean(selfMid && comment.member.mid === selfMid);
  const commentUrl = buildCommentUrl(oid, typeId, comment);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 1800);
  };

  const handleCopyText = async () => {
    await copyText(comment.message);
    setMenuOpen(false);
    showToast("已复制评论");
  };

  const handleCopyLink = async () => {
    await copyText(commentUrl);
    setMenuOpen(false);
    showToast("已复制评论链接");
  };

  const handleDelete = async () => {
    setMenuOpen(false);
    if (!window.confirm("确定删除这条评论吗？")) return;
    await invoke("delete_comment", { oid: String(oid), typeId, rpid: comment.rpid });
    onDeleted(comment.rpid);
    showToast("评论已删除");
  };

  const handleBlock = async () => {
    setMenuOpen(false);
    if (!window.confirm(`确定将 @${comment.member.name || comment.member.mid} 加入黑名单吗？`)) return;
    await invoke("block_user", { mid: comment.member.mid });
    onBlockMid(comment.member.mid);
    showToast("已加入黑名单");
  };

  const handleUnblock = async () => {
    setMenuOpen(false);
    if (!window.confirm(`确定将 @${comment.member.name || comment.member.mid} 移出黑名单吗？`)) return;
    await invoke("unblock_user", { mid: comment.member.mid });
    onUnblockMid(comment.member.mid);
    showToast("已移出黑名单");
  };

  const handleReport = async () => {
    setMenuOpen(false);
    const content = window.prompt("请输入举报说明", "评论内容不当");
    if (content === null) return;
    const message = content.trim();
    if (!message) {
      showToast("举报说明不能为空");
      return;
    }
    setReporting(true);
    try {
      await invoke("report_comment", { oid: String(oid), typeId, rpid: comment.rpid, reason: 0, content: message });
      showToast("举报已提交");
    } finally {
      setReporting(false);
    }
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", minWidth: 0, flex: 1 }}>
          <span style={{ color: "var(--color-text)", fontSize: compact ? "13px" : "13.5px", fontWeight: 800 }}>{comment.member.name || "匿名用户"}</span>
          {comment.member.level > 0 ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: "15px",
                padding: "0 4px",
                borderRadius: "4px",
                backgroundColor: "#ff7a45",
                color: "#fff",
                fontSize: "10px",
                fontWeight: 900,
                lineHeight: 1,
              }}
            >
              LV{comment.member.level}
            </span>
          ) : null}
          {relationText ? <span style={{ color: "var(--color-text-muted)", fontSize: "12.5px", fontWeight: 700 }}>{relationText}</span> : null}
        </div>
        <button
          type="button"
          disabled={reporting}
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((open) => !open);
          }}
          style={commentMenuButtonStyle}
          title="评论操作"
        >
          <MoreVertical style={{ width: 16, height: 16 }} />
        </button>
        {menuOpen ? (
          <div style={commentMenuStyle}>
            <CommentMenuItem icon={<Copy style={commentMenuIconStyle} />} label="复制评论" onClick={() => void runCommentAction(handleCopyText, showToast)} />
            <CommentMenuItem icon={<Link2 style={commentMenuIconStyle} />} label="复制评论链接" onClick={() => void runCommentAction(handleCopyLink, showToast)} />
            {isOwn ? (
              <CommentMenuItem danger icon={<Trash2 style={commentMenuIconStyle} />} label="删除" onClick={() => void runCommentAction(handleDelete, showToast)} />
            ) : (
              <>
                {isBlocked ? (
                  <CommentMenuItem icon={<Ban style={commentMenuIconStyle} />} label="移出黑名单" onClick={() => void runCommentAction(handleUnblock, showToast)} />
                ) : (
                  <CommentMenuItem icon={<Ban style={commentMenuIconStyle} />} label="加入黑名单" onClick={() => void runCommentAction(handleBlock, showToast)} />
                )}
                <CommentMenuItem icon={<Flag style={commentMenuIconStyle} />} label={reporting ? "举报中..." : "举报"} onClick={() => void runCommentAction(handleReport, showToast)} />
              </>
            )}
          </div>
        ) : null}
      </div>
      <p
        style={{
          marginTop: compact ? "5px" : "7px",
          color: "var(--color-text)",
          fontSize: compact ? "13.5px" : "14px",
          lineHeight: 1.7,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {comment.message}
      </p>
      <div
        style={{
          marginTop: compact ? "6px" : "8px",
          display: "flex",
          alignItems: "center",
          gap: compact ? "14px" : "18px",
          color: "var(--color-text-muted)",
          fontSize: compact ? "12px" : "12.5px",
          fontWeight: 700,
        }}
      >
        {comment.ctime ? <span>{formatDateTime(comment.ctime)}</span> : null}
        <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
          <ThumbsUp style={{ width: 14, height: 14 }} />
          {formatNumber(comment.like)}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
          <ThumbsDown style={{ width: 14, height: 14 }} />
        </span>
        <button type="button" onClick={onReply} style={replyActionButtonStyle}>
          回复
        </button>
      </div>
      {toast ? <div style={commentToastStyle}>{toast}</div> : null}
    </>
  );
}

function CommentMenuItem({
  icon,
  label,
  danger = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      style={{ ...commentMenuItemStyle, color: danger ? "var(--color-error-text)" : "var(--color-text-secondary)" }}
    >
      {icon}
      {label}
    </button>
  );
}

async function runCommentAction(action: () => Promise<void>, showToast: (message: string) => void) {
  try {
    await action();
  } catch (err) {
    showToast(String(err));
  }
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function buildCommentUrl(oid: number | string, typeId: number, comment: CommentItem) {
  const root = comment.root || comment.rpid;
  if (typeId === 1) {
    return `https://www.bilibili.com/video/av${oid}/#reply${root}`;
  }
  if (typeId === 12) {
    return `https://www.bilibili.com/read/cv${oid}#reply${root}`;
  }
  if (typeId === 17 || typeId === 11) {
    return `https://www.bilibili.com/opus/${oid}#reply${root}`;
  }
  return `https://www.bilibili.com/?comment_type=${typeId}&oid=${oid}&rpid=${root}`;
}

function ReplyEditor({
  placeholder,
  onCancel,
  onSubmit,
}: {
  placeholder: string;
  onCancel: () => void;
  onSubmit: (message: string) => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  return (
    <div style={{ marginTop: "10px", display: "grid", gap: "8px" }}>
      <textarea
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder={placeholder}
        rows={3}
        style={{
          width: "100%",
          resize: "vertical",
          borderRadius: "10px",
          border: "1px solid var(--color-border)",
          padding: "10px 12px",
          color: "var(--color-text)",
          fontSize: "13px",
          lineHeight: 1.55,
          fontFamily: "inherit",
          outline: "none",
        }}
      />
      {error ? <div style={{ color: "var(--color-error-text)", fontSize: "12.5px", fontWeight: 700 }}>{error}</div> : null}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
        <button type="button" disabled={submitting} onClick={onCancel} style={replySmallButtonStyle(false)}>
          取消
        </button>
        <button
          type="button"
          disabled={submitting || !message.trim()}
          onClick={async () => {
            setSubmitting(true);
            setError("");
            try {
              await onSubmit(message);
              setMessage("");
            } catch (err) {
              setError(String(err));
            } finally {
              setSubmitting(false);
            }
          }}
          style={replySmallButtonStyle(true, submitting || !message.trim())}
        >
          {submitting ? "发送中" : "发送"}
        </button>
      </div>
    </div>
  );
}

async function submitCommentReply(oid: number | string, typeId: number, root: number, parent: number, message: string) {
  return invoke<CommentItem>("add_comment_reply", {
    oid: String(oid),
    typeId,
    root,
    parent,
    message,
  });
}

function mergeComments(base: CommentItem[], incoming: CommentItem[]) {
  return Array.from(new Map([...base, ...incoming].map((item) => [item.rpid, item])).values());
}

function getReplyRelationText(reply: CommentItem, rootComment: CommentItem, memberByRpid: Map<number, string>) {
  if (!reply.root || reply.parent === rootComment.rpid || reply.parent === reply.root) {
    return "回复主评论";
  }
  const targetName = memberByRpid.get(reply.parent);
  return targetName ? `回复 @${targetName}` : "回复楼中楼";
}

function loadMoreButtonStyle(loading: boolean) {
  return {
    height: "34px",
    padding: "0 14px",
    borderRadius: "9px",
    border: "1px solid var(--color-border)",
    backgroundColor: "var(--color-bg-secondary)",
    color: loading ? "#aaa" : "var(--color-text-secondary)",
    fontSize: "13px",
    fontWeight: 700,
    cursor: loading ? "wait" : "pointer",
  } as const;
}

const replyToggleStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  border: "none",
  backgroundColor: "transparent",
  color: "var(--color-text-muted)",
  fontSize: "13px",
  fontWeight: 750,
  cursor: "pointer",
  padding: 0,
} as const;

const replyActionButtonStyle = {
  border: "none",
  backgroundColor: "transparent",
  color: "var(--color-text-muted)",
  fontSize: "inherit",
  fontWeight: 700,
  cursor: "pointer",
  padding: 0,
} as const;

const commentMenuButtonStyle = {
  width: "28px",
  height: "28px",
  border: "none",
  borderRadius: "8px",
  backgroundColor: "transparent",
  color: "var(--color-text-muted)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  flexShrink: 0,
} as const;

const commentMenuStyle = {
  position: "absolute",
  top: "30px",
  right: 0,
  zIndex: 40,
  minWidth: "142px",
  padding: "6px",
  borderRadius: "10px",
  border: "1px solid var(--color-border)",
  backgroundColor: "var(--color-bg-secondary)",
  boxShadow: "0 16px 34px rgba(15, 23, 42, 0.14)",
  display: "grid",
  gap: "2px",
} as const;

const commentMenuItemStyle = {
  height: "32px",
  padding: "0 9px",
  border: "none",
  borderRadius: "8px",
  backgroundColor: "transparent",
  display: "flex",
  alignItems: "center",
  gap: "8px",
  fontSize: "12.5px",
  fontWeight: 750,
  cursor: "pointer",
  fontFamily: "inherit",
  textAlign: "left",
} as const;

const commentMenuIconStyle = {
  width: 14,
  height: 14,
  flexShrink: 0,
} as const;

const commentToastStyle = {
  marginTop: "7px",
  display: "inline-flex",
  alignItems: "center",
  minHeight: "24px",
  padding: "0 9px",
  borderRadius: "8px",
  backgroundColor: "var(--color-primary-light)",
  color: "var(--color-primary-hover)",
  fontSize: "12px",
  fontWeight: 800,
} as const;

function replySmallButtonStyle(primary: boolean, disabled = false) {
  return {
    height: "32px",
    padding: "0 13px",
    borderRadius: "9px",
    border: primary ? "1px solid var(--color-primary)" : "1px solid var(--color-border)",
    backgroundColor: primary ? (disabled ? "#b8b8d8" : "var(--color-primary)") : "var(--color-bg-secondary)",
    color: primary ? "#fff" : "var(--color-text-secondary)",
    fontSize: "12.5px",
    fontWeight: 800,
    cursor: disabled ? "not-allowed" : "pointer",
  } as const;
}
