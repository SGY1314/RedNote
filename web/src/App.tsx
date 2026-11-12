import WorkspaceBoundary from "./workspace/WorkspaceBoundary";
import {
  BarChartOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  FileDoneOutlined,
  FolderOpenOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  UnorderedListOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  App as AntApp,
  Button,
  Dropdown,
  Input,
  Modal,
  Space,
  Tag,
  Tooltip,
} from "antd";
import type { MenuProps } from "antd";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { Project } from "./api";
import { post } from "./api";
import Collections from "./Collections";
import { useWorkspaceSync } from "./hooks/useWorkspaceSync";
import type { AdminUser } from "./admin/adminData";
import { authLogout, authMe } from "./admin/adminData";
import type { AdminPage } from "./admin/AdminConsole";
import ClientSettings from "./ClientSettings";
import UserLogin from "./UserLogin";
import WorkspaceBackdrop from "./components/WorkspaceBackdrop";

const importRewrites = () => import("./Rewrites");
let rewriteModule: ReturnType<typeof importRewrites> | undefined;
const loadRewrites = () => (rewriteModule ??= importRewrites());
const Rewrites = lazy(loadRewrites);
const Publications = lazy(() => import("./Publications"));
const MediaLibrary = lazy(() => import("./MediaLibrary"));
const Trash = lazy(() => import("./Trash"));
const TaskDrawer = lazy(() => import("./workspace/TaskDrawer"));
const UsageBilling = lazy(() => import("./UsageBilling"));
const AdminConsole = lazy(() => import("./admin/AdminConsole"));
const AdminLogin = lazy(() => import("./admin/AdminLogin"));

const pages = [
  {
    key: "collections",
    name: "采集工作台",
    desc: "收藏灵感，整理每一份值得参考的内容。",
    icon: <DatabaseOutlined />,
  },
  {
    key: "rewrites",
    name: "仿写工作台",
    desc: "从参考到表达，让灵感成为自己的内容。",
    icon: <EditOutlined />,
  },
  {
    key: "publications",
    name: "发布管理",
    desc: "文案与素材准备就绪，再从容发布。",
    icon: <FileDoneOutlined />,
  },
  {
    key: "media",
    name: "素材库",
    desc: "集中管理图片与视频，上传、分类后可在不同创作中使用。",
    icon: <FolderOpenOutlined />,
  },
  {
    key: "trash",
    name: "回收站",
    desc: "查看和恢复已删除的采集笔记。",
    icon: <DeleteOutlined />,
  },
  {
    key: "usage",
    name: "计费面板",
    desc: "查看 Token 用量与模型调用记录。",
    icon: <BarChartOutlined />,
  },
];
const utilityPages = [
  {
    key: "settings",
    name: "工作区设置",
    desc: "管理账号与创作空间",
    icon: <SettingOutlined />,
  },
  {
    key: "tasks",
    name: "后台任务",
    desc: "查看任务进度和下一步操作",
    icon: <UnorderedListOutlined />,
  },
];
const navPages = pages.filter((page) => page.key !== "usage");
const adminKeys: AdminPage[] = [
  "overview",
  "users",
  "models",
  "prompts",
  "usage",
];

type RouteArea = "workspace" | "admin" | "admin-login" | "user-login";
type AppRoute = { area: RouteArea; page: string };

function parseRoute(hash: string): AppRoute {
  const raw = hash.replace(/^#\/?/, "");
  const parts = raw.split("/").filter(Boolean);
  if (parts[0] === "xhs" || parts[0] === "douyin") parts.shift();
  if (parts[0] === "admin") {
    if (parts[1] === "login") return { area: "admin-login", page: "login" };
    return {
      area: "admin",
      page: adminKeys.includes(parts[1] as AdminPage) ? parts[1] : "overview",
    };
  }
  if (parts[0] === "login") return { area: "user-login", page: "login" };
  return {
    area: "workspace",
    page: [...pages, ...utilityPages].some((page) => page.key === parts[0])
      ? parts[0]
      : "collections",
  };
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => parseRoute(location.hash));
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    authMe()
      .then((account) => {
        if (active) setUser(account);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const change = () => {
      const next = parseRoute(location.hash);
      if (
        next.area === "admin" &&
        /^#\/?admin\/(tasks|audit)\/?$/.test(location.hash)
      ) {
        history.replaceState(history.state, "", "#admin/overview");
      }
      setRoute(next);
    };
    change();
    window.addEventListener("hashchange", change);
    return () => {
      active = false;
      window.removeEventListener("hashchange", change);
    };
  }, []);

  const navigate = (path: string) => {
    setRoute(parseRoute("#/" + path));
    location.hash = path;
  };
  const handleLoggedIn = (account: AdminUser) => {
    setUser(account);
    navigate(account.role === "admin" ? "admin/overview" : "collections");
  };
  const handleLogout = async (redirect = "login") => {
    await authLogout().catch(() => {});
    setUser(null);
    navigate(redirect);
  };

  useEffect(() => {
    if (!user) return;
    if (user.role === "admin") {
      if (route.area !== "admin") navigate("admin/overview");
    } else if (route.area !== "workspace") {
      navigate("collections");
    }
  }, [user, route.area]);

  if (loading) {
    return <div className="workspace-loading">正在验证登录状态…</div>;
  }
  if (route.area === "admin-login") {
    if (user) {
      return <div className="workspace-loading">正在打开工作台…</div>;
    }
    return (
      <Suspense
        fallback={<div className="workspace-loading">正在打开管理控制台…</div>}
      >
        <AdminLogin
          onLoggedIn={handleLoggedIn}
          onUserWorkspace={() => navigate("login")}
        />
      </Suspense>
    );
  }
  if (route.area === "user-login") {
    if (user) {
      return <div className="workspace-loading">正在打开创作工作台…</div>;
    }
    return (
      <UserLogin
        onLoggedIn={handleLoggedIn}
        onAdminLogin={() => navigate("admin/login")}
      />
    );
  }
  if (!user) {
    return (
      <UserLogin
        onLoggedIn={handleLoggedIn}
        onAdminLogin={() => navigate("admin/login")}
      />
    );
  }
  if (user.role === "admin") {
    if (route.area !== "admin") {
      return <div className="workspace-loading">正在打开管理控制台…</div>;
    }
    return (
      <Suspense
        fallback={<div className="workspace-loading">正在打开管理控制台…</div>}
      >
        <AdminConsole
          page={route.page as AdminPage}
          user={user}
          onNavigate={(page) => navigate(`admin/${page}`)}
          onLogout={() => handleLogout("admin/login")}
        />
      </Suspense>
    );
  }
  if (route.area === "admin") {
    return <div className="workspace-loading">正在打开创作工作台…</div>;
  }
  return (
    <WorkspaceShell
      route={route}
      user={user}
      navigate={navigate}
      onLogout={() => handleLogout("login")}
    />
  );
}

function WorkspaceShell({
  route,
  user,
  navigate,
  onLogout,
}: {
  route: AppRoute;
  user: AdminUser;
  navigate: (path: string) => void;
  onLogout: () => void | Promise<void>;
}) {
  const { message } = AntApp.useApp();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("rednote.sidebar.collapsed") === "true";
    } catch {
      return false;
    }
  });
  const toggleSidebar = () =>
    setCollapsed((old) => {
      try {
        localStorage.setItem("rednote.sidebar.collapsed", String(!old));
      } catch {}
      return !old;
    });
  const returnPage = useRef("collections");
  const taskReturnPage = useRef("collections");
  const openUtility = (page: "settings" | "tasks") => {
    if (page === "tasks") {
      if (route.page !== "tasks") taskReturnPage.current = route.page;
      navigate(page);
      return;
    }
    if (!utilityPages.some((p) => p.key === route.page))
      returnPage.current = route.page;
    navigate(page);
  };
  const closeUtility = () => navigate(returnPage.current);
  const requestedPage =
    route.page === "tasks" ? taskReturnPage.current : route.page;
  const {
    jobs,
    assets,
    projects,
    publications,
    setProjects,
    connected,
    ready: workspaceReady,
    tick,
    refresh,
  } = useWorkspaceSync();
  const lastProjectKey = "rednote.last-project." + user.id;
  const [projectID, updateProjectID] = useState(() => {
    try {
      return localStorage.getItem(lastProjectKey) || "";
    } catch {
      return "";
    }
  });
  const setProjectID = (id: string) => {
    updateProjectID(id);
    try {
      id
        ? localStorage.setItem(lastProjectKey, id)
        : localStorage.removeItem(lastProjectKey);
    } catch {}
  };
  const selectedProjectID =
    projectID || projects.find((project) => !project.deleted_at)?.id || "";
  const [rewritesWarm, setRewritesWarm] = useState(false);
  const [rewriteModuleFailed, setRewriteModuleFailed] = useState(false);
  const [rewriteReadyID, setRewriteReadyID] = useState<string>();
  const previousPage = useRef(requestedPage);
  const preparingRewrite =
    requestedPage === "rewrites" &&
    previousPage.current !== "rewrites" &&
    (!workspaceReady || rewriteReadyID !== selectedProjectID) &&
    !rewriteModuleFailed;
  const displayPage = preparingRewrite ? previousPage.current : requestedPage;
  previousPage.current = displayPage;
  const warmRewrites = () => {
    void loadRewrites()
      .then(() => setRewritesWarm(true))
      .catch(() => setRewriteModuleFailed(true));
  };
  useEffect(() => {
    if (!workspaceReady || route.page !== "collections") return;
    const timer = window.setTimeout(warmRewrites, 80);
    return () => window.clearTimeout(timer);
  }, [workspaceReady, route.page]);
  const openedPanels = useRef({ media: false });
  openedPanels.current.media ||= displayPage === "media";
  useEffect(() => {
    if (!workspaceReady || projects.some((project) => project.id === projectID))
      return;
    const next = projects.find((project) => !project.deleted_at)?.id || "";
    if (next !== projectID) setProjectID(next);
  }, [workspaceReady, projects, projectID]);
  const creatingProject = useRef(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [projectNameError, setProjectNameError] = useState("");
  const [projectCreating, setProjectCreating] = useState(false);
  const createProject = async (
    noteID?: string,
    kind?: "image" | "video",
    name?: string,
  ) => {
    if (!noteID && name === undefined) {
      setNewProjectName("");
      setProjectNameError("");
      setNewProjectOpen(true);
      return;
    }
    if (!noteID && !name?.trim()) {
      setProjectNameError("请输入项目名称");
      return;
    }
    if (creatingProject.current) return;
    creatingProject.current = true;
    setProjectCreating(true);
    try {
      const project = await post<Project & { reused?: boolean }>("/rewrites", {
        note_id: noteID,
        kind,
        name: noteID ? "" : name!.trim(),
      });
      setProjects((old) => [
        project,
        ...old.filter((item) => item.id !== project.id),
      ]);
      setProjectID(project.id);
      setNewProjectOpen(false);
      navigate("rewrites");
      await refresh();
      message.success(
        project.reused ? "该笔记已在仿写库，已打开原项目" : "已建立创作项目",
      );
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      creatingProject.current = false;
      setProjectCreating(false);
    }
  };

  const current =
    [...pages, ...utilityPages].find((item) => item.key === displayPage) ||
    pages[0];
  const active = jobs.filter((job) =>
    ["queued", "running"].includes(job.state),
  ).length;
  const failed = jobs.filter(
    (job) =>
      !job.history_deleted_at &&
      ["failed", "blocked", "needs_review"].includes(job.state),
  ).length;
  const userMenuItems: MenuProps["items"] = [
    { key: "usage", label: "计费面板", icon: <BarChartOutlined /> },
    { key: "settings", label: "设置", icon: <SettingOutlined /> },
  ];
  if (user.role === "admin") {
    userMenuItems.push(
      { type: "divider" },
      {
        key: "admin",
        label: "管理控制台",
        icon: <SafetyCertificateOutlined />,
      },
    );
  }
  userMenuItems.push(
    { type: "divider" },
    {
      key: "logout",
      label: "退出登录",
      icon: <LogoutOutlined />,
      danger: true,
    },
  );
  const userMenu: MenuProps = {
    items: userMenuItems,
    onClick: ({ key }) => {
      if (key === "usage") navigate("usage");
      if (key === "settings") openUtility("settings");
      if (key === "admin") navigate("admin/overview");
      if (key === "logout") void onLogout();
    },
  };

  return (
    <div
      className={
        "app-shell reference-design rednote-shell " +
        (collapsed ? "sidebar-collapsed" : "")
      }
    >
      <WorkspaceBackdrop page={displayPage} />
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => navigate("collections")}
          aria-label="返回采集工作台"
        >
          <span className="brand-mark">
            <img src="/rednote-mark.svg" alt="RedNote" />
          </span>
          <span className="brand-copy">
            <strong className="brand-wordmark">
              RedNote
              <span className="brand-spotlight" aria-hidden="true">
                RedNote
              </span>
            </strong>
            <small>内容创作工作台</small>
          </span>
        </button>
        <nav aria-label="主导航">
          {navPages.map((item) => (
            <Tooltip
              title={collapsed ? item.name : undefined}
              placement="right"
              key={item.key}
            >
              <button
                className={
                  "nav-item " + (displayPage === item.key ? "selected" : "")
                }
                aria-label={item.name}
                aria-current={displayPage === item.key ? "page" : undefined}
                aria-busy={
                  (item.key === "rewrites" && preparingRewrite) || undefined
                }
                onPointerEnter={
                  item.key === "rewrites" ? warmRewrites : undefined
                }
                onFocus={item.key === "rewrites" ? warmRewrites : undefined}
                onClick={() => navigate(item.key)}
              >
                {item.icon}
                <span className="nav-label">{item.name}</span>
              </button>
            </Tooltip>
          ))}
        </nav>
        <div className="sidebar-bottom">
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
            <div className="workspace-crumb">{current.name}</div>
          </div>
          <Space className="topbar-actions" size={8}>
            <Button
              aria-label="后台任务"
              icon={<UnorderedListOutlined />}
              onClick={() => openUtility("tasks")}
            >
              后台任务 {active > 0 && <Tag color="blue">{active}</Tag>}
              {!active && failed > 0 && <span className="small-dot" />}
            </Button>
            <Dropdown menu={userMenu} trigger={["click"]}>
              <Button icon={<UserOutlined />} aria-label="账号菜单">
                {user.display_name} <DownOutlined />
              </Button>
            </Dropdown>
          </Space>
        </header>
        <div className={"page-content page-" + displayPage}>
          {!connected && (
            <div className="connection-warning">
              暂时无法连接服务端，页面会自动重连。
            </div>
          )}
          {(rewritesWarm || requestedPage === "rewrites") && workspaceReady && (
            <div
              className="retained-rewrite-page"
              hidden={displayPage !== "rewrites"}
            >
              <WorkspaceBoundary
                onError={() => setRewriteReadyID(selectedProjectID)}
              >
                <Suspense
                  fallback={
                    <div className="workspace-loading" role="status">
                      正在打开仿写工作台…
                    </div>
                  }
                >
                  <Rewrites
                    active={displayPage === "rewrites"}
                    onReady={setRewriteReadyID}
                    projects={projects}
                    assets={assets}
                    jobs={jobs}
                    selectedID={selectedProjectID}
                    onSelect={setProjectID}
                    onCreate={() => createProject()}
                    refresh={refresh}
                    onPublish={() => navigate("publications")}
                    openMedia={() => navigate("media")}
                  />
                </Suspense>
              </WorkspaceBoundary>
            </div>
          )}
          {openedPanels.current.media && (
            <div
              className="standalone-media-page"
              hidden={displayPage !== "media"}
            >
              <WorkspaceBoundary>
                <Suspense
                  fallback={
                    <div className="workspace-loading" role="status">
                      正在打开素材库…
                    </div>
                  }
                >
                  <MediaLibrary
                    embedded
                    standalone
                    open={displayPage === "media"}
                    onClose={() => navigate("rewrites")}
                    assets={assets}
                    refresh={refresh}
                  />
                </Suspense>
              </WorkspaceBoundary>
            </div>
          )}
          <WorkspaceBoundary key={displayPage}>
            <Suspense
              fallback={
                <div className="workspace-loading" role="status">
                  正在打开{current.name}…
                </div>
              }
            >
              {displayPage === "trash" && (
                <Trash
                  assets={assets}
                  projects={projects}
                  publications={publications}
                  refresh={refresh}
                  tick={tick}
                  onProjectPurged={(id) => {
                    if (projectID === id) setProjectID("");
                  }}
                />
              )}
              {displayPage === "collections" && (
                <Collections
                  assets={assets}
                  projects={projects}
                  jobs={jobs}
                  tick={tick}
                  onCreate={createProject}
                  refresh={refresh}
                />
              )}
              {displayPage === "rewrites" && !workspaceReady && (
                <div className="workspace-loading" role="status">
                  正在恢复工作台…
                </div>
              )}
              {displayPage === "publications" && (
                <Publications
                  publications={publications}
                  projects={projects}
                  onOpenProject={(id) => {
                    setProjectID(id);
                    navigate("rewrites");
                  }}
                  assets={assets}
                  jobs={jobs}
                  refresh={refresh}
                  onCreate={() => navigate("rewrites")}
                />
              )}
              {displayPage === "usage" && <UsageBilling />}
              {displayPage === "settings" && (
                <ClientSettings
                  open
                  onClose={closeUtility}
                  user={user}
                  onLogout={onLogout}
                  onOpenUsage={() => navigate("usage")}
                />
              )}
            </Suspense>
          </WorkspaceBoundary>
          {route.page === "tasks" && (
            <WorkspaceBoundary>
              <Suspense fallback={null}>
                <TaskDrawer
                  open
                  onClose={() => navigate(taskReturnPage.current)}
                  jobs={jobs}
                  projects={projects}
                  assets={assets}
                  publications={publications}
                  refresh={refresh}
                />
              </Suspense>
            </WorkspaceBoundary>
          )}
        </div>
      </main>
      <Modal
        title="新建项目"
        open={newProjectOpen}
        centered
        width={400}
        okText="创建"
        cancelText="取消"
        confirmLoading={projectCreating}
        onCancel={() => {
          if (!projectCreating) setNewProjectOpen(false);
        }}
        onOk={() => createProject(undefined, undefined, newProjectName)}
        destroyOnHidden
      >
        <label className="new-project-name-field">
          <span>项目名称</span>
          <Input
            autoFocus
            aria-label="项目名称"
            value={newProjectName}
            placeholder="输入项目名称"
            maxLength={80}
            disabled={projectCreating}
            status={projectNameError ? "error" : undefined}
            onChange={(e) => {
              setNewProjectName(e.target.value);
              setProjectNameError("");
            }}
            onPressEnter={() =>
              void createProject(undefined, undefined, newProjectName)
            }
          />
          {projectNameError && <small role="alert">{projectNameError}</small>}
        </label>
      </Modal>
    </div>
  );
}
