import WorkspaceBoundary from "./workspace/WorkspaceBoundary";
import {
  DatabaseOutlined,
  EditOutlined,
  FileDoneOutlined,
  FolderOpenOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { Alert, App as AntApp, Button, Space, Tag, Tooltip } from "antd";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { Project } from "./api";
import { api, post } from "./api";
import Collections from "./Collections";
import { useWorkspaceSync } from "./hooks/useWorkspaceSync";

const Rewrites = lazy(() => import("./Rewrites"));
const Publications = lazy(() => import("./Publications"));
const SettingsPanel = lazy(() => import("./Settings"));
const MediaLibrary = lazy(() => import("./MediaLibrary"));
const TaskDrawer = lazy(() => import("./workspace/TaskDrawer"));
const pages = [
  {
    key: "collections",
    name: "采集库",
    desc: "收藏灵感，整理每一份值得参考的内容。",
    icon: <DatabaseOutlined />,
  },
  {
    key: "rewrites",
    name: "仿写库",
    desc: "从参考到表达，让灵感成为自己的内容。",
    icon: <EditOutlined />,
  },
  {
    key: "publications",
    name: "发布管理",
    desc: "文案与素材准备就绪，再从容发布。",
    icon: <FileDoneOutlined />,
  },
];
function readRoute(): { page: string } {
  const parts = location.hash.slice(1).split("/");
  const page = parts.length > 1 ? parts[1] : parts[0];
  return {
    page: pages.some((p) => p.key === page) ? page : "collections",
  };
}
export default function App() {
  const { message } = AntApp.useApp();
  const [{ page }, setRoute] = useState(readRoute);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("gin.sidebar.collapsed") !== "false";
    } catch {
      return true;
    }
  });
  const toggleSidebar = () =>
    setCollapsed((old) => {
      try {
        localStorage.setItem("gin.sidebar.collapsed", String(!old));
      } catch {}
      return !old;
    });
  const [settings, setSettings] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const {
    jobs,
    assets,
    projects,
    publications,
    setProjects,
    connected,
    tick,
    refresh,
  } = useWorkspaceSync();
  // Load optional panels on first use, then retain their form state on close.
  const openedPanels = useRef({ settings: false, media: false, tasks: false });
  openedPanels.current.settings ||= settings;
  openedPanels.current.media ||= mediaOpen;
  openedPanels.current.tasks ||= taskOpen;
  const [projectID, setProjectID] = useState("");
  const creatingProject = useRef(false);
  const [deploymentNotice, setDeploymentNotice] = useState("");
  useEffect(() => {
    let active = true;
    api<{ notice?: string }>("/health")
      .then((v) => {
        if (active) setDeploymentNotice(v.notice || "");
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const change = () => setRoute(readRoute());
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const navigate = (key: string) => {
    setRoute({ page: key });
    location.hash = key;
  };
  const createProject = async (noteID?: string, kind?: "image" | "video") => {
    if (creatingProject.current) return;
    creatingProject.current = true;
    try {
      const p = await post<Project & { reused?: boolean }>("/rewrites", {
        note_id: noteID,
        kind,
        name: noteID ? "" : "我的新创作",
      });
      setProjects((old) => [p, ...old.filter((item) => item.id !== p.id)]);
      setProjectID(p.id);
      navigate("rewrites");
      await refresh();
      message.success(
        p.reused ? "该笔记已在仿写库，已打开原项目" : "已建立创作项目",
      );
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      creatingProject.current = false;
    }
  };
  const current = pages.find((x) => x.key === page) || pages[0];
  const active = jobs.filter((x) =>
    ["queued", "running"].includes(x.state),
  ).length;
  const failed = jobs.filter(
    (x) =>
      !x.history_deleted_at &&
      ["failed", "blocked", "needs_review"].includes(x.state),
  ).length;
  return (
    <div
      className={
        "app-shell reference-design " + (collapsed ? "sidebar-collapsed" : "")
      }
    >
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => navigate("collections")}
          aria-label="返回采集库"
        >
          <span className="brand-mark">
            <img src="/workbench-logo.png" alt="内容工作台标识" />
          </span>
          <span className="brand-copy">
            <strong>内容工作台</strong>
            <small>CONTENT WORKSPACE</small>
          </span>
        </button>
        <nav aria-label="主导航">
          {pages.map((x) => (
            <Tooltip
              title={collapsed ? x.name : undefined}
              placement="right"
              key={x.key}
            >
              <button
                className={"nav-item " + (page === x.key ? "selected" : "")}
                aria-label={x.name}
                aria-current={page === x.key ? "page" : undefined}
                onClick={() => navigate(x.key)}
              >
                {x.icon}
                <span className="nav-label">{x.name}</span>
              </button>
            </Tooltip>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-status">
            <i className={connected ? "online" : "offline"} />
            <span>
              小红书 / 抖音 · {connected ? "本地个人工作区" : "服务连接中"}
            </span>
          </div>
          <Tooltip title={collapsed ? "设置" : undefined} placement="right">
            <button
              className="nav-item"
              aria-label="设置"
              onClick={() => setSettings(true)}
            >
              <SettingOutlined />
              <span className="nav-label">设置</span>
            </button>
          </Tooltip>
          <Tooltip
            title={collapsed ? "展开侧边栏" : undefined}
            placement="right"
          >
            <button
              className="nav-item sidebar-toggle"
              aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
              aria-expanded={!collapsed}
              onClick={toggleSidebar}
            >
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              <span className="nav-label">收起侧边栏</span>
            </button>
          </Tooltip>
        </div>
      </aside>
      <main className="main-shell">
        <header className="topbar">
          <div className="workspace-heading">
            <div className="workspace-crumb">
              <i className="platform-dot xhs" />
              <strong>内容工作台</strong>
              <span className="crumb-divider">/</span>
              <span>{current.name}</span>
            </div>
          </div>
          <div className="topbar-wordmark" aria-label="RedNote">
            RedNote
          </div>
          <Space className="topbar-actions" size={8}>
            <Button
              aria-label="素材库"
              icon={<FolderOpenOutlined />}
              onClick={() => setMediaOpen(true)}
            >
              素材库
            </Button>
            <Button
              aria-label="后台任务"
              icon={<UnorderedListOutlined />}
              onClick={() => setTaskOpen(true)}
            >
              后台任务 {active > 0 && <Tag color="blue">{active}</Tag>}
              {!active && failed > 0 && <span className="small-dot" />}
            </Button>
          </Space>
        </header>
        <div className={"page-content page-" + page}>
          {!connected && (
            <div className="connection-warning">
              暂时无法连接后端，请运行启动脚本。页面会自动重连。
            </div>
          )}
          {deploymentNotice && (
            <Alert
              type="info"
              showIcon
              message={deploymentNotice}
              style={{ marginBottom: 16 }}
            />
          )}
          <WorkspaceBoundary key={page}>
            <Suspense
              fallback={
                <div className="workspace-loading" role="status">
                  正在打开{current.name}…
                </div>
              }
            >
              {page === "collections" && (
                <Collections
                  assets={assets}
                  projects={projects}
                  jobs={jobs}
                  tick={tick}
                  onCreate={createProject}
                  refresh={refresh}
                />
              )}
              {page === "rewrites" && (
                <Rewrites
                  projects={projects}
                  assets={assets}
                  jobs={jobs}
                  selectedID={projectID}
                  onSelect={setProjectID}
                  onCreate={() => createProject()}
                  refresh={refresh}
                  onPublish={() => navigate("publications")}
                  openMedia={() => setMediaOpen(true)}
                />
              )}
              {page === "publications" && (
                <Publications
                  publications={publications}
                  assets={assets}
                  jobs={jobs}
                  refresh={refresh}
                  onCreate={() => {
                    navigate("rewrites");
                  }}
                />
              )}
            </Suspense>
          </WorkspaceBoundary>
        </div>
      </main>
      <Suspense
        fallback={
          <div className="panel-loading" role="status">
            正在加载面板…
          </div>
        }
      >
        {openedPanels.current.settings && (
          <SettingsPanel open={settings} onClose={() => setSettings(false)} />
        )}
        {openedPanels.current.media && (
          <MediaLibrary
            open={mediaOpen}
            onClose={() => setMediaOpen(false)}
            assets={assets}
            refresh={refresh}
          />
        )}
        {openedPanels.current.tasks && (
          <TaskDrawer
            open={taskOpen}
            onClose={() => setTaskOpen(false)}
            jobs={jobs}
            refresh={refresh}
          />
        )}
      </Suspense>
    </div>
  );
}
