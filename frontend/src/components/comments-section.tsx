import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, MessageCircle, ThumbsDown, ThumbsUp } from "lucide-react";
import { invoke } from "@/lib/api";
import { ClickableAvatar } from "@/components/video-card";
import { formatDateTime, formatNumber } from "@/lib/utils";

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

interface CommentsSectionProps {
  oid?: number | null;
  typeId?: number | null;
  title?: string;
}

const PAGE_SIZE = 10;
const REPLY_PAGE_SIZE = 10;

export function CommentsSection({ oid, typeId, title = "评论区" }: CommentsSectionProps) {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const canLoad = Boolean(oid && typeId);

  const loadComments = async (nextPage: number, mode: "replace" | "append" = "replace") => {
    if (!oid || !typeId || loading) return;
    setLoading(true);
    setError("");
    try {
      const data = await invoke<CommentPage>("get_comments", {
        oid,
        typeId,
        page: nextPage,
        pageSize: PAGE_SIZE,
      });
      setComments((previous) => {
        const merged = mode === "append" ? [...previous, ...data.list] : data.list;
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
  }, [oid, typeId]);

  return (
    <section
      style={{
        marginTop: "22px",
        border: "1px solid #ececf2",
        backgroundColor: "#fff",
        borderRadius: "16px",
        padding: "20px 22px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "16px" }}>
        <h2 style={{ display: "inline-flex", alignItems: "center", gap: "8px", color: "#1a1a2e", fontSize: "17px", fontWeight: 850 }}>
          <MessageCircle style={{ width: 18, height: 18 }} />
          {title}
        </h2>
        {total ? <span style={{ color: "#8b8b9a", fontSize: "13px", fontWeight: 700 }}>{formatNumber(total)} 条</span> : null}
      </div>

      {!canLoad ? (
        <div style={{ color: "#9a9aa8", fontSize: "14px", padding: "14px 0" }}>当前内容没有可读取的评论区标识</div>
      ) : loading && comments.length === 0 ? (
        <div style={{ height: "120px", display: "grid", placeItems: "center", color: "#6366f1" }}>
          <Loader2 className="animate-spin" style={{ width: 24, height: 24 }} />
        </div>
      ) : error && comments.length === 0 ? (
        <div style={{ color: "#dc2626", fontSize: "14px", padding: "14px 0" }}>{error}</div>
      ) : comments.length === 0 ? (
        <div style={{ color: "#9a9aa8", fontSize: "14px", padding: "14px 0" }}>暂无评论</div>
      ) : (
        <div style={{ display: "grid", gap: "18px" }}>
          {comments.map((comment) => (
            <article key={comment.rpid} style={{ display: "grid", gridTemplateColumns: "40px minmax(0, 1fr)", gap: "13px" }}>
              <ClickableAvatar src={comment.member.avatar} alt={comment.member.name} size={40} />
              <div style={{ minWidth: 0, paddingBottom: "16px", borderBottom: "1px solid #f0f0f4" }}>
                <CommentBody comment={comment} />
                <ReplyThread oid={oid!} typeId={typeId!} rootComment={comment} />
              </div>
            </article>
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

function ReplyThread({ oid, typeId, rootComment }: { oid: number; typeId: number; rootComment: CommentItem }) {
  const [expanded, setExpanded] = useState(false);
  const [replies, setReplies] = useState<CommentItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(rootComment.reply_count);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const replyCount = total || rootComment.reply_count;
  const memberByRpid = useMemo(() => {
    const entries: Array<[number, string]> = [[rootComment.rpid, rootComment.member.name]];
    for (const reply of replies) {
      entries.push([reply.rpid, reply.member.name]);
    }
    return new Map(entries);
  }, [replies, rootComment.member.name, rootComment.rpid]);

  if (!rootComment.reply_count) {
    return null;
  }

  const loadReplies = async (nextPage: number, mode: "replace" | "append" = "replace") => {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const data = await invoke<CommentPage>("get_comment_replies", {
        oid,
        typeId,
        root: rootComment.rpid,
        page: nextPage,
        pageSize: REPLY_PAGE_SIZE,
      });
      setReplies((previous) => {
        const merged = mode === "append" ? [...previous, ...data.list] : data.list;
        return Array.from(new Map(merged.map((item) => [item.rpid, item])).values());
      });
      setPage(data.page);
      setTotal(data.total || rootComment.reply_count);
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
        <div style={{ marginTop: "12px", display: "grid", gap: "14px", padding: "12px 14px", borderRadius: "12px", backgroundColor: "#f8f8fb" }}>
          {error ? <div style={{ color: "#dc2626", fontSize: "13px" }}>{error}</div> : null}
          {replies.map((reply) => (
            <article key={reply.rpid} style={{ display: "grid", gridTemplateColumns: "30px minmax(0, 1fr)", gap: "10px" }}>
              <ClickableAvatar src={reply.member.avatar} alt={reply.member.name} size={30} />
              <div style={{ minWidth: 0 }}>
                <CommentBody comment={reply} compact relationText={getReplyRelationText(reply, rootComment, memberByRpid)} />
              </div>
            </article>
          ))}
          {loading && replies.length > 0 ? (
            <div style={{ display: "flex", justifyContent: "center", color: "#6366f1", padding: "4px 0" }}>
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

function CommentBody({ comment, compact = false, relationText }: { comment: CommentItem; compact?: boolean; relationText?: string }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <span style={{ color: "#1f2937", fontSize: compact ? "13px" : "13.5px", fontWeight: 800 }}>{comment.member.name || "匿名用户"}</span>
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
        {relationText ? <span style={{ color: "#8b8b9a", fontSize: "12.5px", fontWeight: 700 }}>{relationText}</span> : null}
      </div>
      <p
        style={{
          marginTop: compact ? "5px" : "7px",
          color: "#242432",
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
          color: "#8b8b9a",
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
        <span>回复</span>
      </div>
    </>
  );
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
    border: "1px solid #e2e2ea",
    backgroundColor: "#fff",
    color: loading ? "#aaa" : "#505065",
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
  color: "#8b8b9a",
  fontSize: "13px",
  fontWeight: 750,
  cursor: "pointer",
  padding: 0,
} as const;
