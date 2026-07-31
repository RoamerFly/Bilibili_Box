import { ShieldCheck, UserCircle, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

interface LoginDialogProps {
  open: boolean;
  onClose: (success?: boolean) => void;
  forceNewLogin?: boolean;
}

export function LoginDialog({ open, onClose }: LoginDialogProps) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose(false);
          }}
        >
          <motion.section
            className="w-full max-w-md rounded-[28px] border border-[var(--color-border)] bg-[var(--color-bg-card)] p-6 shadow-2xl"
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            aria-label="演示账号"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--color-primary-soft)] text-[var(--color-primary)]">
                  <UserCircle size={24} />
                </span>
                <div>
                  <h2 className="text-lg font-bold text-[var(--color-text)]">BiliBox Demo</h2>
                  <p className="text-sm text-[var(--color-text-muted)]">本地界面预览账号</p>
                </div>
              </div>
              <button
                type="button"
                aria-label="关闭"
                className="rounded-xl p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-tertiary)]"
                onClick={() => onClose(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-6 flex gap-3 rounded-2xl bg-[var(--color-bg-secondary)] p-4 text-sm leading-6 text-[var(--color-text-secondary)]">
              <ShieldCheck className="mt-0.5 shrink-0 text-[var(--color-primary)]" size={20} />
              <p>当前预览使用本地 Mock 数据，不读取账号信息，也不会连接任何平台服务。</p>
            </div>

            <button
              type="button"
              className="mt-6 w-full rounded-2xl bg-[var(--color-primary)] px-4 py-3 font-semibold text-white transition-opacity hover:opacity-90"
              onClick={() => onClose(true)}
            >
              继续浏览演示
            </button>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
