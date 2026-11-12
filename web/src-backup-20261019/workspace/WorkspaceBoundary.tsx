import { Alert, Button } from "antd";
import { Component } from "react";
import type { ReactNode } from "react";

/** Keep navigation available when a page chunk fails to load after an update. */
export default class WorkspaceBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <Alert
          type="error"
          showIcon
          message="这个页面暂时无法打开"
          description="可能是更新后文件缓存不一致。请确认当前修改已保存，再刷新工作台。"
          action={<Button onClick={() => location.reload()}>刷新工作台</Button>}
        />
      );
    return this.props.children;
  }
}
