import { useState } from "react";
import { App, Alert, Button, Dropdown, Input, Select, Space, Tag } from "antd";
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EllipsisOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import Table from "./components/ResponsiveTable";
import type { Asset, Job, Publication, Project } from "./api";
import { date, fileURL, post } from "./api";
import PublicationPreview from "./components/PublicationPreview";
import MobilePublishDialog, { canPublishOnPhone } from "./MobilePublishDialog";
import DouyinManualPublishDialog from "./components/DouyinManualPublishDialog";
import "./publication-management.css";
import {
  publicationReplaced,
  groupPublications,
  platformPublication,
  pendingPlatformPublication,
  publicationState as state,
} from "./publicationVisibility";
import type {
  PublicationGroup,
  PublicationPlatform,
} from "./publicationVisibility";

export default function Publications({
  publications,
  assets,
  jobs,
  refresh,
  onCreate,
  projects = [],
  onOpenProject,
}: {
  publications: Publication[];
  assets: Asset[];
  jobs: Job[];
  refresh: () => Promise<void>;
  onCreate: () => void;
  projects?: Project[];
  onOpenProject?: (id: string) => void;
}) {
  const { message, modal } = App.useApp();
  const [selectedID, setSelectedID] = useState("");
  const [mobileID, setMobileID] = useState("");
  const [douyinID, setDouyinID] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [platform, setPlatform] = useState("");
  const [updating, setUpdating] = useState("");
  const [localRecords, setLocalRecords] = useState<Publication[]>([]);
  const records = [
    ...publications,
    ...localRecords.filter(
      (p) => !publications.some((stored) => stored.id === p.id),
    ),
  ];
  // Legacy incomplete snapshots stay in storage and remain accessible from their source project.
  const all = records.filter(
    (p) =>
      !p.deleted_at &&
      !publicationReplaced(p, records) &&
      (p.ready ||
        p.published_at ||
        p.remote_work_id ||
        p.online_state === "published"),
  );
  const groups = groupPublications(all);
  const selected = groups.find((p) => p.id === selectedID);
  const mobile = all.find((p) => p.id === mobileID);
  const douyin = all.find((p) => p.id === douyinID);
  const labels = { ready: "等待发布", published: "已发布" };
  const ensurePlatform = async (
    group: PublicationGroup,
    target: PublicationPlatform,
  ) => {
    const existing = platformPublication(group, target);
    if (existing) return existing;
    const p = await post<Publication>(`/publications/${group.id}/platform`, {
      platform: target,
      revision: group.revision || 0,
    });
    setLocalRecords((old) => [...old.filter((item) => item.id !== p.id), p]);
    return p;
  };
  const change = async (
    group: PublicationGroup,
    target: PublicationPlatform,
    status: string,
  ) => {
    setUpdating(group.id + target);
    try {
      const p = await ensurePlatform(group, target);
      await post(`/publications/${p.id}/status`, {
        status,
        revision: p.revision || 0,
      });
      await refresh();
      message.success("状态已更新");
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setUpdating("");
    }
  };
  const status = (group: PublicationGroup, target: PublicationPlatform) => (
    <Select
      aria-label={`修改${target === "xhs" ? "小红书" : "抖音"}发布状态 ${group.title}`}
      size="small"
      value={state(platformPublication(group, target))}
      loading={updating === group.id + target}
      disabled={!!updating}
      style={{ width: 108 }}
      options={Object.entries(labels).map(([value, label]) => ({
        value,
        label,
      }))}
      onChange={(value) => void change(group, target, value)}
    />
  );
  const openPlatform = async (
    group: PublicationGroup,
    target: PublicationPlatform,
  ) => {
    setUpdating(group.id + target);
    try {
      const p = await ensurePlatform(group, target);
      if (target === "xhs") setMobileID(p.id);
      else setDouyinID(p.id);
      await refresh();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setUpdating("");
    }
  };
  const actions = (p: PublicationGroup) => (
    <Space size={6} wrap={false}>
      <Button
        className="publication-platform-button xhs"
        aria-label="小红书扫码发布"
        title={
          !canPublishOnPhone(pendingPlatformPublication(p, "xhs"))
            ? "请核实发布记录；小红书扫码支持未发布的图文或单视频稿"
            : "小红书扫码发布"
        }
        disabled={
          !!updating || !canPublishOnPhone(pendingPlatformPublication(p, "xhs"))
        }
        loading={updating === p.id + "xhs"}
        onClick={() => void openPlatform(p, "xhs")}
      >
        <span aria-hidden="true">小红书</span>
      </Button>
      <Button
        className="publication-platform-button douyin"
        aria-label="抖音手动发布"
        title="抖音：复制文案并保存素材"
        disabled={!!updating}
        loading={updating === p.id + "douyin"}
        onClick={() => void openPlatform(p, "douyin")}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
          <path
            fill="currentColor"
            d="M15 2h3c.3 2.3 1.5 3.7 4 4v3c-1.6 0-3-.5-4-1.3V16a6 6 0 1 1-6-6v3a3 3 0 1 0 3 3V2z"
          />
        </svg>
      </Button>
      <Dropdown
        menu={{
          items: [
            {
              key: "delete",
              label: "移入回收站",
              icon: <DeleteOutlined />,
              onClick: () =>
                modal.confirm({
                  title: "将这份发布稿移入回收站？",
                  onOk: async () => {
                    try {
                      await post("/publications/batch-trash", {
                        ids: p.members.map((member) => member.id),
                        deleted: true,
                      });
                      await refresh();
                      setSelectedID("");
                    } catch (e) {
                      message.error((e as Error).message);
                      throw e;
                    }
                  },
                }),
            },
          ],
        }}
        trigger={["click"]}
      >
        <Button
          type="text"
          shape="circle"
          aria-label={`更多操作 ${p.title}`}
          icon={<EllipsisOutlined />}
        />
      </Dropdown>
    </Space>
  );
  const matchesStatus = (p: PublicationGroup, value: string) =>
    value === "all" ||
    (platform
      ? state(platformPublication(p, platform as PublicationPlatform)) === value
      : value === "published"
        ? ["xhs", "douyin"].every(
            (target) =>
              state(platformPublication(p, target as PublicationPlatform)) ===
              "published",
          )
        : ["xhs", "douyin"].some(
            (target) =>
              state(platformPublication(p, target as PublicationPlatform)) ===
              "ready",
          ));
  const rows = groups.filter(
    (p) =>
      matchesStatus(p, filter) &&
      (!search.trim() ||
        (p.title + " " + p.body)
          .toLowerCase()
          .includes(search.trim().toLowerCase())),
  );
  const selectedXHS = selected && platformPublication(selected, "xhs");
  const activeJob =
    selectedXHS && jobs.find((j) => j.id === selectedXHS.online_job_id);
  const platformStatuses = (p: PublicationGroup) => (
    <div className="publication-platform-statuses">
      <label>
        <span>小红书</span>
        {status(p, "xhs")}
      </label>
      <label>
        <span>抖音</span>
        {status(p, "douyin")}
      </label>
    </div>
  );
  return (
    <>
      {mobile && (
        <MobilePublishDialog
          key={mobile.id}
          publication={mobile}
          onClose={() => setMobileID("")}
        />
      )}
      {douyin && (
        <DouyinManualPublishDialog
          publication={douyin}
          assets={assets}
          onClose={() => setDouyinID("")}
        />
      )}
      {selected ? (
        <section className="publication-detail-page" aria-label="发布稿详情">
          <Space>
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => setSelectedID("")}
            >
              返回发布管理
            </Button>
            <h2>发布稿详情</h2>
          </Space>
          <div className="publication-detail-grid">
            <PublicationPreview publication={selected} assets={assets} />
            <aside className="publication-detail-settings">
              <h3>发布信息</h3>
              {platformStatuses(selected)}
              <p>
                {selected.kind === "video" ? "视频" : "图文"} ·{" "}
                {selected.asset_ids.length} 份素材
              </p>
              <p>创建于 {date(selected.created_at)}</p>
              <p>
                来源项目：
                {projects.find((p) => p.id === selected.project_id)?.name ||
                  "项目不可用"}
              </p>
              {onOpenProject && (
                <Button onClick={() => onOpenProject(selected.project_id)}>
                  返回来源仿写项目
                </Button>
              )}
              <div style={{ marginTop: 20 }}>{actions(selected)}</div>
              {selectedXHS &&
                [
                  "needs_review",
                  "unknown",
                  "manual_ready",
                  "prepared",
                  "manual_review",
                ].includes(selectedXHS.online_state || "") && (
                  <Button
                    style={{ marginTop: 12 }}
                    onClick={() => {
                      const dialog = modal.confirm({
                        title: "已在小红书核实没有发布？",
                        content:
                          "请先检查平台实际结果，确认未发布后再恢复扫码入口。",
                        okText: "已核实未发布",
                        cancelText: "返回检查",
                        onOk: (close: () => void) => {
                          dialog.update({
                            okButtonProps: { loading: true, disabled: true },
                            cancelButtonProps: { disabled: true },
                          });
                          void post(`/publications/${selectedXHS.id}/resolve`, {
                            not_published: true,
                          })
                            .then(() => refresh())
                            .then(() => close())
                            .catch((e: Error) => {
                              message.error(e.message);
                            })
                            .finally(() =>
                              dialog.update({
                                okButtonProps: {
                                  loading: false,
                                  disabled: false,
                                },
                                cancelButtonProps: { disabled: false },
                              }),
                            );
                        },
                      });
                    }}
                  >
                    核实未发布
                  </Button>
                )}
              {activeJob && (
                <Alert
                  style={{ marginTop: 16 }}
                  type="info"
                  message={
                    activeJob.error || activeJob.stage || activeJob.state
                  }
                />
              )}
              {selected.members
                .filter((p) => p.published_url)
                .map((p) => (
                  <p key={p.id}>
                    <a
                      href={p.published_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      查看{p.target_platform === "douyin" ? "抖音" : "小红书"}
                      作品
                    </a>
                  </p>
                ))}
              <Alert
                style={{ marginTop: 16 }}
                type="info"
                message="两个平台分别记录发布状态。复制文案、下载素材和打开平台不会自动标记已发布。已有平台回执会保留。"
              />
            </aside>
          </div>
        </section>
      ) : (
        <>
          <div className="publication-summary">
            {Object.entries(labels).map(([key, name]) => (
              <button
                key={key}
                className={
                  "publication-stat " + (filter === key ? "selected" : "")
                }
                onClick={() => setFilter(filter === key ? "all" : key)}
              >
                <span>
                  {name}
                  {!platform && key === "published" ? "（双平台）" : ""}
                </span>
                <strong>
                  {groups.filter((p) => matchesStatus(p, key)).length}
                </strong>
              </button>
            ))}
          </div>
          <section className="table-panel publication-management">
            <div className="panel-toolbar publication-filters">
              <Input.Search
                placeholder="搜索发布标题或正文"
                aria-label="搜索发布稿"
                allowClear
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Select
                aria-label="发布状态"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "全部发布状态" },
                  ...Object.entries(labels).map(([value, label]) => ({
                    value,
                    label,
                  })),
                ]}
              />
              <Select
                aria-label="筛选发布平台"
                value={platform}
                onChange={setPlatform}
                options={[
                  { value: "", label: "全部平台" },
                  { value: "xhs", label: "小红书" },
                  { value: "douyin", label: "抖音" },
                ]}
              />
            </div>
            <Table
              tableLayout="fixed"
              rowKey="id"
              dataSource={rows}
              pagination={{
                pageSize: 10,
                showTotal: (n) => `共 ${n} 份发布稿`,
              }}
              columns={[
                {
                  title: "发布稿",
                  key: "content",
                  render: (_, p) => (
                    <button
                      className="publication-list-content"
                      aria-label={`查看发布稿 ${p.title}`}
                      onClick={() => setSelectedID(p.id)}
                    >
                      {p.kind === "video" && !p.cover_id ? (
                        <span
                          className="publication-video-thumbnail"
                          aria-label="视频素材"
                        >
                          <VideoCameraOutlined />
                        </span>
                      ) : p.cover_id || p.asset_ids[0] ? (
                        <img
                          src={fileURL(p.cover_id || p.asset_ids[0])}
                          alt=""
                        />
                      ) : null}
                      <span>
                        <strong>{p.title || "未命名发布稿"}</strong>
                        <Tag>小红书 · 抖音</Tag>
                        <small>
                          {p.kind === "video" ? "视频" : "图文"} ·{" "}
                          {p.asset_ids.length} 份素材
                        </small>
                      </span>
                    </button>
                  ),
                },
                {
                  title: "状态",
                  key: "status",
                  width: 180,
                  render: (_, p) => platformStatuses(p),
                },
                {
                  title: "时间",
                  key: "time",
                  width: 135,
                  render: (_, p) => (
                    <small>{date(p.updated_at || p.created_at)}</small>
                  ),
                },
                {
                  title: "操作",
                  key: "actions",
                  width: 145,
                  render: (_, p) => actions(p),
                },
              ]}
              locale={{
                emptyText: (
                  <div className="empty-library">
                    <h3>还没有发布稿</h3>
                    <p>在仿写项目点击“准备发布”，核对确认后会出现在这里。</p>
                    <Button onClick={onCreate}>去准备内容</Button>
                  </div>
                ),
              }}
            />
          </section>
        </>
      )}
    </>
  );
}
