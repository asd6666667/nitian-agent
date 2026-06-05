import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-paper p-8 text-ink">
          <div className="mx-auto max-w-lg rounded-xl border border-loss/30 bg-bitget-panel p-6 shadow-panel">
            <h1 className="mb-2 text-lg font-semibold text-loss">页面渲染出错</h1>
            <p className="mb-4 text-sm text-ink-muted">
              请刷新页面（Ctrl+Shift+R）。若仍无法加载，把下方错误信息发给开发者。
            </p>
            <pre className="overflow-auto rounded border border-bitget-border bg-paper-sub/60 p-3 text-xs text-loss">
              {this.state.error?.message || String(this.state.error)}
            </pre>
            <button
              type="button"
              className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
              onClick={() => window.location.reload()}
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
