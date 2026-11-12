import { Alert, Button } from "antd";
import { Component } from "react";
import type { ReactNode } from "react";
import { pageFailure } from "./pageFailure";

/** Keep navigation available when a page chunk fails to load after an update. */
export default class WorkspaceBoundary extends Component<
  { children: ReactNode; onError?: () => void },
  { error: unknown }
> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("Workspace page failed", error);
    this.props.onError?.();
  }
  render() {
    if (this.state.error) {
      const failure = pageFailure(this.state.error);
      return (
        <Alert
          type="error"
          showIcon
          message={failure.title}
          description={
            <div>
              {failure.description}
              <details className="workspace-error-details">
                <summary>错误信息</summary>
                <code>{failure.detail}</code>
              </details>
            </div>
          }
          action={<Button onClick={() => location.reload()}>刷新工作台</Button>}
        />
      );
    }
    return this.props.children;
  }
}
