import { Component, type ReactNode } from "react";

export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { error?: string }
> {
  state: { error?: string } = {};
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    if (this.state.error)
      return (
        <div className="fatal">
          <h1>阅读器遇到了问题</h1>
          <p>{this.state.error}</p>
          <p>已保存的文档仍保留在本地。可以重新打开应用重试。</p>
          <button onClick={() => window.location.reload()}>重新打开</button>
        </div>
      );
    return this.props.children;
  }
}
