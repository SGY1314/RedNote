import {
  CloudSyncOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Drawer,
  Empty,
  Popconfirm,
  Segmented,
  Space,
  Tag,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Job } from "../api";
import { date, post, stateColor, stateLabel } from "../api";

const names: Record<string, string> = {
  collect: "采集笔记",
  download: "下载素材",
  ocr: "图片 OCR",
  asr: "原视频转写",
  rewrite: "AI 仿写",
  angle_suggest: "发帖角度建议",
  image_generation: "AI 图片",
  image_plan: "画面规划",
  video_plan: "视频脚本",
  video_generate: "视频镜头",
  video_compose: "视频合成",
  export: "历史打包任务（已停用）",
  cleanup: "清理删除素材",
  publish: "小红书上传准备",
  post_sync: "同步帖子数据",
  douyin_prepare: "准备抖音发布",
  douyin_submit: "提交抖音发布",
};
export const taskGroup = (job: Job) =>
  ["queued", "running"].includes(job.state)
    ? "active"
    : ["failed", "blocked", "needs_review"].includes(job.state)
      ? "attention"
      : "done";

export default function TaskDrawer({
  open,
  onClose,
  jobs,
  refresh,
}: {
  open: boolean;
  onClose: () => void;
  jobs: Job[];
  refresh: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const [filter, setFilter] = useState("all");
  const [retrying, setRetrying] = useState("");
  const [deleting, setDeleting] = useState("");
  const mutation = useRef(false);
  const [removed, setRemoved] = useState<string[]>([]);
  useEffect(() => {
    setRemoved((old) =>
      old.filter((id) => {
        const job = jobs.find((j) => j.id === id);
        return job && !job.history_deleted_at && taskGroup(job) !== "active";
      }),
    );
  }, [jobs]);
  const history = useMemo(
    () => jobs.filter((j) => !j.history_deleted_at && !removed.includes(j.id)),
    [jobs, removed],
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
  const counts = useMemo(
    () => ({
      all: history.length,
      active: history.filter((j) => taskGroup(j) === "active").length,
      attention: history.filter((j) => taskGroup(j) === "attention").length,
    }),
    [history],
  );
  const visible = useMemo(
    () =>
      history
        .filter((j) => filter === "all" || taskGroup(j) === filter)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [history, filter],
  );
  return (
    <Drawer
      title={
        <Space>
          <CloudSyncOutlined />
          后台任务
        </Space>
      }
      open={open}
      onClose={onClose}
      size="large"
      extra={
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
      }
    >
      <p className="muted">
        关闭页面不影响后台任务。待处理任务会说明原因和下一步操作。
      </p>
      <Segmented
        block
        aria-label="筛选后台任务"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: `全部 ${counts.all}` },
          { value: "active", label: `进行中 ${counts.active}` },
          { value: "attention", label: `待处理 ${counts.attention}` },
        ]}
      />
      <div className="task-list" aria-live="polite">
        {!visible.length ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={history.length ? "此分类下没有任务" : "还没有后台任务"}
          />
        ) : (
          visible.map((j) => (
            <article className="job-card" key={j.id} data-job-id={j.id}>
              <div className="row-between">
                <strong>{names[j.kind] || "后台任务"}</strong>
                <Tag color={stateColor[j.state]}>
                  {stateLabel[j.state] || j.state}
                </Tag>
              </div>
              <p>{j.stage}</p>
              {j.error && <div className="job-error">{j.error}</div>}
              <div className="row-between">
                <small className="muted">{date(j.updated_at)}</small>
                <Space>
                  {taskGroup(j) === "attention" &&
                    !["publish", "export"].includes(j.kind) &&
                    !j.kind.startsWith("douyin_") && (
                      <Popconfirm
                        title={
                          j.state === "needs_review"
                            ? "重试可能再次计费，确认继续？"
                            : "重试这个步骤？"
                        }
                        onConfirm={async () => {
                          if (mutation.current) return;
                          mutation.current = true;
                          setRetrying(j.id);
                          try {
                            await post(`/jobs/${j.id}/retry`);
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
                          loading={retrying === j.id}
                          disabled={
                            !!deleting || (!!retrying && retrying !== j.id)
                          }
                        >
                          重试
                        </Button>
                      </Popconfirm>
                    )}
                  {taskGroup(j) !== "active" && (
                    <Popconfirm
                      title="删除这条任务历史？"
                      description="已生成的内容和素材会保留。"
                      okText="删除历史"
                      cancelText="取消"
                      onConfirm={() => deleteHistory([j.id], j.id)}
                    >
                      <Button
                        size="small"
                        type="text"
                        icon={<DeleteOutlined />}
                        aria-label="删除历史记录"
                        loading={deleting === j.id}
                        disabled={
                          !!retrying || (!!deleting && deleting !== j.id)
                        }
                      >
                        删除历史
                      </Button>
                    </Popconfirm>
                  )}
                </Space>
              </div>
            </article>
          ))
        )}
      </div>
    </Drawer>
  );
}
