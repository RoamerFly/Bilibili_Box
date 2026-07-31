import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  title?: string;
  resetKey?: string;
  onBackHome?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] 渲染失败", error, info.componentStack);
  }

  componentDidUpdate(previousProps: ErrorBoundaryProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private reloadApplication = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-[320px] w-full items-center justify-center p-8">
        <div className="w-full max-w-xl rounded-[28px] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-8 text-center shadow-[var(--shadow-card)]">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-error-bg)] text-[var(--color-error)]">
            <AlertTriangle size={28} />
          </div>
          <h2 className="m-0 text-2xl font-semibold text-[var(--color-text)]">
            {this.props.title || "页面加载失败"}
          </h2>
          <p className="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">
            当前页面发生了渲染异常。你可以返回首页继续使用，或重新加载应用。
          </p>
          <details className="mt-5 rounded-xl bg-[var(--color-bg-tertiary)] p-3 text-left text-xs text-[var(--color-text-secondary)]">
            <summary className="cursor-pointer select-none">查看错误摘要</summary>
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words">
              {this.state.error.message || String(this.state.error)}
            </pre>
          </details>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {this.props.onBackHome ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-2.5 font-medium text-[var(--color-text)]"
                onClick={this.props.onBackHome}
              >
                <Home size={17} />
                返回首页
              </button>
            ) : null}
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl border-0 bg-[var(--color-primary)] px-4 py-2.5 font-medium text-white"
              onClick={this.reloadApplication}
            >
              <RefreshCw size={17} />
              重新加载应用
            </button>
          </div>
        </div>
      </div>
    );
  }
}
