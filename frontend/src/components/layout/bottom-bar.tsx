import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ChevronUp, Download, FolderOpen, ListChecks, Trash2 } from "lucide-react";
import { invoke } from "@/lib/api";
import { formatFileSize } from "@/lib/utils";
import { useAppStore, useDownloadStore, useLogStore } from "@/stores/app-store";

export function BottomBar() {
  const expanded = useAppStore((s) => s.bottomBarExpanded);
  const toggleExpanded = useAppStore((s) => s.toggleBottomBar);
  const setBottomBarExpanded = useAppStore((s) => s.setBottomBarExpanded);
  const activeCount = useDownloadStore((s) => s.activeCount);
  const downloadSpeed = useDownloadStore((s) => s.downloadSpeed);
  const tasks = useDownloadStore((s) => s.tasks);
  const logs = useLogStore((s) => s.logs);
  const clearLogs = useLogStore((s) => s.clearLogs);
  const [activeTab, setActiveTab] = useState<"progress" | "logs">("progress");
  const logsViewportRef = useRef<HTMLDivElement>(null);

  const tasksList = useMemo(() => Object.values(tasks), [tasks]);
  const activeTasks = useMemo(
    () => tasksList.filter((task) => task.status === "downloading" || task.status === "pending" || task.status === "paused"),
    [tasksList]
  );
  const visibleLogs = logs.slice(-300);
  const hiddenLogCount = Math.max(0, logs.length - visibleLogs.length);

  const activeProgress = useMemo(() => {
    if (activeTasks.length === 0) return 0;
    return activeTasks.reduce((sum, task) => sum + (task.progress || 0), 0) / activeTasks.length;
  }, [activeTasks]);

  const scrollLogsToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const viewport = logsViewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    if (!expanded || activeTab !== "logs") return;
    scrollLogsToBottom("auto");
  }, [activeTab, expanded, logs.length, scrollLogsToBottom]);

  const openDownloadFolder = (event: React.MouseEvent) => {
    event.stopPropagation();
    invoke("open_download_folder").catch((error) => {
      console.error("Failed to open download folder:", error);
    });
  };

  const openLogs = (event: React.MouseEvent) => {
    event.stopPropagation();
    setActiveTab("logs");
    setBottomBarExpanded(true);
  };

  return (
    <motion.div
      className="bb-bottom-bar"
      animate={{ height: expanded ? 300 : 68 }}
      transition={{ type: "spring", stiffness: 360, damping: 34 }}
    >
      <div className="bb-bottom-head" onClick={toggleExpanded}>
        <div className="bb-bottom-left">
          <div className="bb-bottom-icon">
            <Download size={24} />
          </div>
          <div className="bb-bottom-copy">
            <strong>下载中 ({activeCount})</strong>
            <span>
              {downloadSpeed || "0 B/s"}
              {activeCount > 0 ? " · 剩余时间计算中" : " · 队列空闲"}
            </span>
          </div>
          <div className="bb-bottom-progress">
            <span style={{ width: `${Math.max(0, Math.min(100, activeProgress))}%` }} />
          </div>
        </div>

        <div className="bb-bottom-actions">
          <button type="button" className="bb-bottom-button" onClick={openDownloadFolder}>
            <FolderOpen size={18} />
            打开下载目录
          </button>
          <button type="button" className="bb-bottom-button primary" onClick={openLogs}>
            <ListChecks size={18} />
            进度日志
          </button>
          <button type="button" className="bb-bottom-toggle" aria-label={expanded ? "收起" : "展开"}>
            <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ type: "spring", stiffness: 320, damping: 22 }}>
              <ChevronUp size={18} />
            </motion.span>
          </button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            className="bb-bottom-body"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.18 }}
          >
            <div className="bb-bottom-tabs">
              <BottomTab active={activeTab === "progress" } onClick={() => setActiveTab("progress")}>下载</BottomTab>
              <BottomTab active={activeTab === "logs"} onClick={() => setActiveTab("logs")}>日志</BottomTab>
            </div>

            <AnimatePresence mode="wait">
              {activeTab === "progress" ? (
                <motion.div
                  key="progress"
                  className="bb-bottom-scroll"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                >
                  {tasksList.length > 0 ? (
                    tasksList.map((task) => (
                      <div className="bb-bottom-task" key={task.id}>
                        <div className={`bb-bottom-task-state ${task.status}`}>{stateLabel(task.status)}</div>
                        <div className="bb-bottom-task-copy">
                          <strong>{task.filename || "未命名任务"}</strong>
                          <div>
                            <span>{formatFileSize(task.downloadedBytes || 0)}</span>
                            <span>/</span>
                            <span>{formatFileSize(task.totalBytes || 0)}</span>
                          </div>
                          <div className="bb-bottom-task-progress">
                            <span style={{ width: `${Math.max(0, Math.min(100, task.progress || 0))}%` }} />
                          </div>
                        </div>
                        <em>{(task.progress || 0).toFixed(0)}%</em>
                      </div>
                    ))
                  ) : (
                    <div className="bb-bottom-empty">暂无下载任务</div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="logs"
                  className="bb-bottom-log-panel"
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                >
                  <div className="bb-bottom-log-tools">
                    <button type="button" onClick={clearLogs} title="清空日志">
                      <Trash2 size={15} />
                    </button>
                    <button type="button" onClick={() => scrollLogsToBottom()} title="滚动到底部">
                      <ArrowDown size={15} />
                    </button>
                  </div>
                  <div ref={logsViewportRef} className="bb-bottom-logs">
                    {hiddenLogCount > 0 && <div className="bb-bottom-log-more">已折叠较早的 {hiddenLogCount} 条日志</div>}
                    {visibleLogs.length > 0 ? (
                      visibleLogs.map((log) => (
                        <div key={log.id} className={`bb-bottom-log ${log.type}`}>
                          <span>[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                          {log.message}
                        </div>
                      ))
                    ) : (
                      <div className="bb-bottom-empty">等待操作日志</div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function BottomTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className={active ? "active" : ""} onClick={onClick}>
      {children}
    </button>
  );
}

function stateLabel(status: string) {
  switch (status) {
    case "downloading":
      return "下载中";
    case "pending":
      return "等待";
    case "completed":
      return "完成";
    case "paused":
      return "暂停";
    case "error":
      return "失败";
    default:
      return "任务";
  }
}
