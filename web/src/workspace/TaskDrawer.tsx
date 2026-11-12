import {
  CloudSyncOutlined,
  DeleteOutlined,
  EditOutlined,
  ExclamationCircleFilled,
  ReloadOutlined,
  SendOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Segmented,
  Select,
  Tag,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Asset, Job, Project, Publication } from "../api";
import { date, post, stateColor, stateLabel } from "../api";
import {
  categoryNames,
  groupTaskProjects,
  matchesTaskSearch,
  taskGroup,
  taskNames,
} from "./taskProjects";
import type { TaskCategory } from "./taskProjects";
import "./task-projects.css";
export { taskGroup } from "./taskProjects";

export default function TaskDrawer({
  open,
  onClose,
  jobs,
  projects = [],
  assets = [],
  publications = [],
  refresh,
}: {
  open: boolean;
  onClose: () => void;
  jobs: Job[];
  projects?: Project[];
  assets?: Asset[];
  publications?: Publication[];
  refresh: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<TaskCategory | "all">("all");
  const [filter, setFilter] = useState("all");
  const [retrying, setRetrying] = useState("");
  const [deleting, setDeleting] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const [bodyHeight, setBodyHeight] = useState<number>();
  const mutation = useRef(false);
  const [removed, setRemoved] = useState<string[]>([]);
  useEffect(() => {
    setRemoved((old) =>
      old.filter((id) => {
        const j = jobs.find((j) => j.id === id);
        return j && !j.history_deleted_at && taskGroup(j) !== "active";
      }),
    );
  }, [jobs]);
  const history = useMemo(
    () => jobs.filter((j) => !j.history_deleted_at && !removed.includes(j.id)),
    [jobs, removed],
  );
  const groups = useMemo(
    () => groupTaskProjects(history, projects, assets, publications),
    [history, projects, assets, publications],
  );
  const classified = groups.filter(
    (g) => category === "all" || g.category === category,
  );
  const counts = {
    all: classified.length,
    active: classified.filter((g) => g.state !== "done").length,
    done: classified.filter((g) => g.state === "done").length,
  };
  const visible = classified.filter(
    (g) =>
      (filter === "all" ||
        (filter === "active" ? g.state !== "done" : g.state === filter)) &&
      matchesTaskSearch(g, search),
  );
  const deletable = history.filter((j) => taskGroup(j) !== "active");
  const deleteHistory = async (ids: string[], owner: string) => {
    if (mutation.current || !ids.length) return;
    mutation.current = true;
    setDeleting(owner);
    try {
      const result = await post<{
        deleted_ids: string[];
        skipped_active_ids: string[];
      }>("/jobs/history/delete", { ids });
      setRemoved((old) => [...new Set([...old, ...result.deleted_ids])]);
      await refresh();
      message.success(
        `已删除 ${result.deleted_ids.length} 条历史记录${result.skipped_active_ids.length ? "，进行中的任务已保留" : ""}`,
      );
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      mutation.current = false;
      setDeleting("");
    }
  };
  const retry = (job: Job) =>
    taskGroup(job) === "attention" &&
    !["publish", "export"].includes(job.kind) &&
    !job.kind.startsWith("douyin_") ? (
      <Popconfirm
        title={
          job.state === "needs_review"
            ? "重试可能再次计费，确认继续？"
            : "重试这个步骤？"
        }
        onConfirm={async () => {
          if (mutation.current) return;
          mutation.current = true;
          setRetrying(job.id);
          try {
            await post(`/jobs/${job.id}/retry`);
            await refresh();
          } catch (e) {
            message.error((e as Error).message);
          } finally {
            mutation.current = false;
            setRetrying("");
          }
        }}
      >
        <Button
          size="small"
          icon={<ReloadOutlined />}
          loading={retrying === job.id}
          disabled={!!deleting || (!!retrying && retrying !== job.id)}
        >
          重试
        </Button>
      </Popconfirm>
    ) : null;
  return (
    <Modal
      className="task-modal"
      aria-label="后台任务列表"
      title={<span className="task-dialog-title">后台任务列表</span>}
      open={open}
      onCancel={onClose}
      centered
      width={800}
      styles={{
        body: bodyHeight === undefined ? undefined : { height: bodyHeight },
      }}
      afterOpenChange={(visible) => {
        if (!visible) {
          setBodyHeight(undefined);
          return;
        }
        const body = listRef.current?.parentElement;
        if (body) setBodyHeight(body.getBoundingClientRect().height);
      }}
      destroyOnHidden
      footer={
        <div className="task-dialog-footer">
          <Popconfirm
            title="清空任务历史？"
            description="已生成的内容和素材会保留，进行中的任务不受影响。"
            okText="清空历史"
            cancelText="取消"
            onConfirm={() =>
              deleteHistory(
                deletable.map((j) => j.id),
                "all",
              )
            }
          >
            <Button
              icon={<DeleteOutlined />}
              loading={deleting === "all"}
              disabled={
                !deletable.length ||
                !!retrying ||
                (!!deleting && deleting !== "all")
              }
            >
              清空历史
            </Button>
          </Popconfirm>
        </div>
      }
    >
      <div className="task-dialog-toolbar">
        <Input.Search
          aria-label="搜索后台任务"
          placeholder="搜索项目、素材或步骤"
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          aria-label="项目类型筛选"
          value={category}
          onChange={(value) => {
            setCategory(value);
            setFilter("all");
          }}
          options={[
            { value: "all", label: "全部项目" },
            ...Object.entries(categoryNames).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
        />
        <Segmented
          aria-label="筛选后台任务"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: `全部 ${counts.all}` },
            { value: "active", label: `进行中 ${counts.active}` },
            { value: "done", label: `已完成 ${counts.done}` },
          ]}
        />
      </div>
      <div ref={listRef} className="task-list" aria-live="polite">
        {!visible.length ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={history.length ? "此分类下没有项目" : "还没有后台任务"}
          />
        ) : (
          visible.map((group) => (
            <article
              className="job-card task-card task-project-card"
              key={group.key}
              data-project-key={group.key}
              data-category={group.category}
              data-state={group.state}
            >
              <header className="task-project-heading">
                <div className="task-project-identity">
                  <span className="task-project-icon">
                    {group.category === "collect" ? (
                      <CloudSyncOutlined />
                    ) : group.category === "rewrite" ? (
                      <EditOutlined />
                    ) : (
                      <SendOutlined />
                    )}
                  </span>
                  <div>
                    <strong>{group.name}</strong>
                    <div className="task-project-labels">
                      <span>{categoryNames[group.category]}</span>
                      <Tag
                        color={
                          group.state === "active"
                            ? "processing"
                            : group.state === "attention"
                              ? "orange"
                              : "green"
                        }
                      >
                        {group.state === "active"
                          ? "进行中"
                          : group.state === "attention"
                            ? group.active
                              ? "进行中 · 待处理"
                              : "待处理"
                            : group.current.every(
                                  (j) => j.state === "succeeded",
                                )
                              ? "已完成"
                              : "已结束"}
                      </Tag>
                    </div>
                  </div>
                </div>
                <div className="task-project-meta">
                  <time dateTime={group.updatedAt}>
                    {date(group.updatedAt)}
                  </time>
                  <Popconfirm
                    title="删除这个项目的任务历史？"
                    description="已生成的内容和素材会保留。"
                    okText="删除历史"
                    cancelText="取消"
                    onConfirm={() =>
                      deleteHistory(
                        group.jobs.map((j) => j.id),
                        group.key,
                      )
                    }
                  >
                    <Button
                      type="text"
                      className="task-project-delete"
                      icon={<DeleteOutlined />}
                      aria-label="删除项目历史"
                      loading={deleting === group.key}
                      disabled={
                        group.active ||
                        !!retrying ||
                        (!!deleting && deleting !== group.key)
                      }
                    >
                      删除历史
                    </Button>
                  </Popconfirm>
                </div>
              </header>
              <div
                className="task-project-progress"
                role="group"
                aria-label="项目总进度"
              >
                <div className="task-project-progress-label">
                  <span>
                    {group.category === "collect"
                      ? "素材采集进度"
                      : "项目处理进度"}
                  </span>
                  <span>
                    已完成 {group.completed} / {group.total}
                    {group.failures.length > 0 && (
                      <b> · {group.failures.length} 项待处理</b>
                    )}
                  </span>
                </div>
                <Progress
                  percent={group.percent}
                  success={{
                    percent: group.successPercent,
                    strokeColor: "var(--task-progress-accent, #2f5d4b)",
                  }}
                  strokeColor={
                    group.failures.length
                      ? "#cf5b54"
                      : "var(--task-progress-accent, #2f5d4b)"
                  }
                  status={group.active ? "active" : "normal"}
                  showInfo={false}
                />
              </div>
              {group.failures.length > 0 && (
                <div className="task-project-failures" role="status">
                  {group.failures.map((j) => (
                    <div key={j.id}>
                      <ExclamationCircleFilled />
                      <span>
                        <strong>
                          {j.task_project?.item_name ||
                            assets.find((a) => a.id === j.target)?.name ||
                            taskNames[j.kind] ||
                            j.kind}
                        </strong>
                        ：{j.error || stateLabel[j.state] || "处理失败"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <details
                className="task-project-details"
                open={group.jobs.length === 1 || !!search || undefined}
              >
                <summary>
                  处理步骤（{group.current.length}）
                  {group.jobs.length > group.current.length &&
                    ` · 历史 ${group.jobs.length - group.current.length} 条`}
                </summary>
                <ul>
                  {group.jobs.map((j) => (
                    <li
                      key={j.id}
                      data-job-id={j.id}
                      data-state={j.state}
                      className={
                        taskGroup(j) === "attention" ? "task-step-failed" : ""
                      }
                    >
                      <div className="task-step-name">
                        <strong>{taskNames[j.kind] || j.kind}</strong>
                        <span>
                          {j.task_project?.item_name ||
                            assets.find((a) => a.id === j.target)?.name ||
                            j.stage ||
                            "等待执行"}
                        </span>
                      </div>
                      <Tag color={stateColor[j.state]}>
                        {stateLabel[j.state] || j.state}
                      </Tag>
                      {group.current.some((current) => current.id === j.id) &&
                        retry(j)}
                    </li>
                  ))}
                </ul>
              </details>
            </article>
          ))
        )}
      </div>
    </Modal>
  );
}
