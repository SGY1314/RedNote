import {
  CheckCircleOutlined,
  CopyOutlined,
  ExportOutlined,
  FileImageOutlined,
  ReloadOutlined,
  SendOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  DatePicker,
  Drawer,
  Image,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
} from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import type { Asset, Job, Platform, Publication } from "./api";
import { date, fileURL, patch, platformName, post } from "./api";
import Douyin from "./Douyin";
import PostMonitor from "./PostMonitor";
import type { PublisherAccount } from "./PublisherPanel";
import PublisherPanel from "./PublisherPanel";
export default function Publications({
  publications: allPublications,
  assets,
  jobs,
  refresh,
  onCreate,
}: {
  publications: Publication[];
  assets: Asset[];
  jobs: Job[];
  refresh: () => Promise<void>;
  onCreate: () => void;
}) {
  const { message, modal } = App.useApp();
  const publications = allPublications;
  const [platformFilter, setPlatformFilter] = useState<Platform | "">("");
  const [account, setAccount] = useState<PublisherAccount>();
  const [workspace, setWorkspace] = useState("drafts");
  const [connectOpen, setConnectOpen] = useState(false);
  const [checkingID, setCheckingID] = useState("");
  const publishJob = (p: Publication) =>
    jobs.find((j) => j.id === p.online_job_id);
  const needsReview = (p: Publication) =>
    !p.published_at &&
    !["queued", "running"].includes(publishJob(p)?.state || "") &&
    (p.online_state === "needs_review" ||
      (p.online_state === "queued" && publishJob(p)?.state === "needs_review"));
  const publishing = (p: Publication) =>
    ["queued", "running"].includes(publishJob(p)?.state || "") ||
    (p.online_state === "queued" && !needsReview(p));
  const canPublish = (p: Publication) =>
    p.ready &&
    !p.published_at &&
    (!p.online_state || p.online_state === "failed");
  const publish = async (p: Publication) => {
    if (p.kind === "video" && p.cover_id) {
      message.warning(
        "扫码发布暂使用平台默认视频封面，请移除自选封面并重新准备发布稿，或下载素材后自行发布。",
      );
      return;
    }
    const orderedIDs =
      p.kind === "image" && p.cover_id
        ? [p.cover_id, ...p.asset_ids.filter((id) => id !== p.cover_id)]
        : p.asset_ids;
    setCheckingID(p.id);
    try {
      const a = await post<PublisherAccount>("/publisher/status");
      setAccount(a);
      if (!a.is_logged_in || !a.user_id) {
        setConnectOpen(true);
        return;
      }
      modal.confirm({
        title: "准备上传到这个小红书账号？",
        width: 620,
        content: (
          <>
            <p>
              <strong>{a.username || "小红书账号"}</strong> · {a.user_id}
            </p>
            <p>
              只上传素材、填写文案，不会自动点击发布。请在打开的官方窗口检查封面、话题及可见范围，再手动发布。
            </p>
            <h3>{p.title}</h3>
            <p
              style={{
                whiteSpace: "pre-wrap",
                maxHeight: 180,
                overflow: "auto",
              }}
            >
              {full(p)}
            </p>
            <p>
              {p.kind === "image"
                ? `图文 · ${orderedIDs.length} 张图片，以下顺序为实际上传顺序`
                : "视频 · 1 个文件，使用平台默认封面"}{" "}
              · 可见范围请在官方页面确认
            </p>
            <Space wrap>
              {orderedIDs.map((id) =>
                assets.find((x) => x.id === id)?.kind === "image" ? (
                  <Image
                    key={id}
                    width={70}
                    height={70}
                    style={{ objectFit: "cover" }}
                    src={fileURL(id)}
                  />
                ) : (
                  <Tag key={id}>
                    {assets.find((x) => x.id === id)?.name || "视频素材"}
                  </Tag>
                ),
              )}
            </Space>
          </>
        ),
        okText: "开始准备上传",
        cancelText: "取消",
        onOk: async () => {
          try {
            await post("/publications/" + p.id + "/publish-prepare", {
              account_id: a.user_id,
              confirm: true,
            });
            await refresh();
            message.success("已开始上传准备，完成后请在官方窗口预览并手动发布");
          } catch (e) {
            message.error((e as Error).message);
            throw e;
          }
        },
      });
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setCheckingID("");
    }
  };
  const resolve = (p: Publication) =>
    modal.confirm({
      title: "已确认这份内容没有发布？",
      content:
        "请先在小红书创作平台检查是否已手动发布。确认后将关闭旧编辑窗口，允许重新上传准备；已发布请直接记录结果。",
      okText: "已核实未发布",
      cancelText: "返回检查",
      onOk: async () => {
        try {
          await post("/publications/" + p.id + "/resolve", {
            not_published: true,
          });
          await refresh();
        } catch (e) {
          message.error((e as Error).message);
          throw e;
        }
      },
    });
  const manualReady = (p: Publication) =>
    !p.published_at && p.online_state === "manual_ready";
  const openEditor = async (p: Publication) => {
    try {
      await post("/publications/" + p.id + "/open-editor");
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  const xhsActions = (p: Publication, detail = false) => (
    <>
      <Button
        type={detail ? "primary" : "link"}
        disabled={!canPublish(p) && !manualReady(p) && !needsReview(p)}
        loading={checkingID === p.id || publishing(p)}
        title={
          manualReady(p) || needsReview(p)
            ? "打开已准备的官方窗口，不会重复上传"
            : undefined
        }
        onClick={() =>
          manualReady(p) || needsReview(p) ? openEditor(p) : publish(p)
        }
      >
        上传到小红书
      </Button>
      {detail && (manualReady(p) || needsReview(p)) && (
        <Button onClick={() => resolve(p)}>核实未发布，重新准备</Button>
      )}
    </>
  );
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedID, setSelectedID] = useState("");
  const [markID, setMarkID] = useState("");
  const [publishedAt, setPublishedAt] = useState(dayjs());
  const selected = allPublications.find((p) => p.id === selectedID);
  const state = (p: Publication) =>
    p.published_at ? "published" : !p.ready ? "pending" : "ready";
  const label: Record<string, string> = {
    pending: "待准备",
    ready: "可发布",
    published: "已发布",
  };
  const color: Record<string, string> = {
    pending: "default",
    ready: "green",
    published: "green",
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success("已复制");
    } catch {
      message.error("浏览器不允许复制，请从详情中手动选择文案");
    }
  };
  const full = (p: Publication) =>
    p.title +
    "\n\n" +
    p.body +
    "\n\n" +
    p.topics.map((t) => "#" + t.replace(/^#+/, "")).join(" ");
  return (
    <>
      <PublisherPanel
        account={account}
        onAccount={setAccount}
        open={connectOpen}
        onOpen={setConnectOpen}
      />
      <Douyin jobs={jobs} refresh={refresh}>
        {({ actions: douyinActions, status: douyinStatus }) => (
          <>
            <div className="publication-summary">
              {Object.entries(label).map(([key, name]) => (
                <button
                  key={key}
                  className={
                    "publication-stat " + (tab === key ? "selected" : "")
                  }
                  onClick={() => {
                    setTab(tab === key ? "all" : key);
                    setWorkspace("drafts");
                  }}
                  aria-pressed={tab === key}
                >
                  <span>{name}</span>
                  <strong>
                    {allPublications.filter((p) => state(p) === key).length}
                  </strong>
                </button>
              ))}
            </div>
            <Tabs
              activeKey={workspace}
              onChange={setWorkspace}
              items={[
                { key: "drafts", label: "全部发布稿" },
                { key: "monitor", label: "小红书帖子数据" },
              ]}
            />
            {workspace === "monitor" ? (
              <PostMonitor
                account={account}
                onAccount={setAccount}
                onConnect={() => setConnectOpen(true)}
                jobs={jobs}
                refresh={refresh}
              />
            ) : (
              <>
                <section className="table-panel">
                  <div className="panel-toolbar publication-filters">
                    <Space wrap>
                      <Input.Search
                        aria-label="搜索发布稿"
                        placeholder="搜索发布标题或正文"
                        allowClear
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        style={{ width: 300 }}
                      />
                      <Select
                        aria-label="筛选发布平台"
                        value={platformFilter}
                        onChange={setPlatformFilter}
                        style={{ width: 130 }}
                        options={[
                          { value: "", label: "全部平台" },
                          { value: "xhs", label: "小红书" },
                          { value: "douyin", label: "抖音" },
                        ]}
                      />
                      <Select
                        aria-label="发布状态"
                        value={tab}
                        onChange={setTab}
                        style={{ width: 160 }}
                        options={[
                          { value: "all", label: "全部发布状态" },
                          ...Object.entries(label).map(([value, label]) => ({
                            value,
                            label,
                          })),
                        ]}
                      />
                    </Space>
                    <Space wrap>
                      <Button
                        icon={<ExportOutlined />}
                        href="https://creator.xiaohongshu.com/"
                        target="_blank"
                        rel="noreferrer"
                      >
                        打开小红书创作平台
                      </Button>
                      <Button
                        icon={<ExportOutlined />}
                        href="https://creator.douyin.com/"
                        target="_blank"
                        rel="noreferrer"
                      >
                        打开抖音创作平台
                      </Button>
                      <Button
                        aria-label="刷新发布管理"
                        icon={<ReloadOutlined />}
                        onClick={() => void refresh()}
                      />
                    </Space>
                  </div>
                  <Table
                    scroll={{ x: 1120 }}
                    rowKey="id"
                    dataSource={publications.filter(
                      (p) =>
                        (!platformFilter ||
                          (p.target_platform || "xhs") === platformFilter) &&
                        (tab === "all" || state(p) === tab) &&
                        (!search.trim() ||
                          (p.title + " " + p.body)
                            .toLowerCase()
                            .includes(search.trim().toLowerCase())),
                    )}
                    pagination={{
                      pageSize: 10,
                      showTotal: (n) => `共 ${n} 份发布稿`,
                    }}
                    columns={[
                      {
                        title: "发布稿",
                        width: 330,
                        key: "content",
                        render: (_, p) => {
                          const id =
                            p.cover_id ||
                            p.asset_ids.find(
                              (id) =>
                                assets.find((a) => a.id === id)?.kind ===
                                "image",
                            );
                          return (
                            <div
                              className="note-cell publication-note"
                              role="button"
                              tabIndex={0}
                              aria-label={`查看发布稿 ${p.title}`}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setSelectedID(p.id);
                                }
                              }}
                              onClick={() => setSelectedID(p.id)}
                            >
                              <span className="publication-thumbnail">
                                {id ? (
                                  <img
                                    src={fileURL(id)}
                                    alt=""
                                    loading="lazy"
                                  />
                                ) : p.kind === "video" ? (
                                  <VideoCameraOutlined />
                                ) : (
                                  <FileImageOutlined />
                                )}
                              </span>
                              <div>
                                <strong>{p.title || "未命名发布稿"}</strong>
                                <Tag
                                  color={
                                    p.target_platform === "douyin"
                                      ? "purple"
                                      : "red"
                                  }
                                >
                                  {platformName(
                                    p.target_platform === "douyin"
                                      ? "douyin"
                                      : "xhs",
                                  )}
                                </Tag>
                                {p.group_id && (
                                  <Tag color="blue">
                                    双平台同稿 · {p.group_id.slice(0, 6)}
                                  </Tag>
                                )}
                                <small>
                                  {p.kind === "image" ? "图文" : "视频"} ·{" "}
                                  {p.asset_ids.length} 份素材
                                </small>
                              </div>
                            </div>
                          );
                        },
                      },
                      {
                        title: "状态",
                        width: 150,
                        key: "state",
                        render: (_, p) =>
                          p.target_platform === "douyin" ? (
                            douyinStatus(p)
                          ) : needsReview(p) ? (
                            <Tag color="orange">发布待核实</Tag>
                          ) : manualReady(p) ? (
                            <Tag color="blue">待手动发布</Tag>
                          ) : publishing(p) ? (
                            <Tag color="blue">正在准备上传</Tag>
                          ) : (
                            <Tag color={color[state(p)]}>{label[state(p)]}</Tag>
                          ),
                      },
                      {
                        title: "创建时间",
                        width: 170,
                        dataIndex: "created_at",
                        render: (s) => <small>{date(s)}</small>,
                      },
                      {
                        title: "发布时间",
                        width: 170,
                        dataIndex: "published_at",
                        render: (s) => <small>{date(s)}</small>,
                      },
                      {
                        title: "操作",
                        key: "actions",
                        width: 330,
                        render: (_, p) => (
                          <Space
                            wrap
                            size={[12, 0]}
                            className="publication-row-actions"
                          >
                            {p.target_platform === "douyin"
                              ? douyinActions(p)
                              : xhsActions(p)}
                            <Button type="link" onClick={() => copy(full(p))}>
                              复制文案
                            </Button>
                            <Button
                              type="link"
                              disabled={!p.ready}
                              onClick={() => {
                                setMarkID(p.id);
                                setPublishedAt(
                                  p.published_at
                                    ? dayjs(p.published_at)
                                    : dayjs(),
                                );
                              }}
                            >
                              {p.published_at ? "编辑发布记录" : "记录已发布"}
                            </Button>
                            <Button
                              type="link"
                              onClick={() => setSelectedID(p.id)}
                            >
                              查看发布稿
                            </Button>
                          </Space>
                        ),
                      },
                    ]}
                    locale={{
                      emptyText: (
                        <div className="empty-library">
                          <div className="empty-art">
                            <SendOutlined />
                          </div>
                          <h3>这里将收纳你的待发布内容</h3>
                          <p>
                            在仿写库确认版本、选好图片或视频，就能建立发布稿。
                          </p>
                          <Button type="primary" onClick={onCreate}>
                            去准备内容
                          </Button>
                        </div>
                      ),
                    }}
                  />
                </section>
              </>
            )}
            <Drawer
              width={740}
              title="发布稿详情"
              open={!!selectedID}
              onClose={() => setSelectedID("")}
            >
              {selected && (
                <>
                  <div className="row-between">
                    {selected.target_platform === "douyin" ? (
                      douyinStatus(selected)
                    ) : needsReview(selected) ? (
                      <Tag color="orange">发布待核实</Tag>
                    ) : manualReady(selected) ? (
                      <Tag color="blue">待手动发布</Tag>
                    ) : publishing(selected) ? (
                      <Tag color="blue">正在准备上传</Tag>
                    ) : (
                      <Tag color={color[state(selected)]}>
                        {label[state(selected)]}
                      </Tag>
                    )}
                    <small className="muted">
                      快照 {selected.id.slice(0, 8)}
                    </small>
                  </div>
                  <h2>{selected.title}</h2>
                  {selected.group_id && (
                    <div className="extraction-card">
                      <strong>同一稿件的两个平台</strong>
                      <p className="muted">
                        文案和素材相同，账号确认与发布结果分别管理。只处理未成功的平台。
                      </p>
                      <Space wrap>
                        {allPublications
                          .filter((p) => p.group_id === selected.group_id)
                          .map((p) => (
                            <div key={p.id}>
                              <Button
                                type={
                                  p.id === selected.id ? "primary" : "default"
                                }
                                onClick={() => setSelectedID(p.id)}
                              >
                                {platformName(
                                  p.target_platform === "douyin"
                                    ? "douyin"
                                    : "xhs",
                                )}
                              </Button>{" "}
                              {p.target_platform === "douyin" ? (
                                douyinStatus(p)
                              ) : needsReview(p) ? (
                                <Tag color="orange">发布待核实</Tag>
                              ) : manualReady(p) ? (
                                <Tag color="blue">待手动发布</Tag>
                              ) : publishing(p) ? (
                                <Tag color="blue">正在准备上传</Tag>
                              ) : (
                                <Tag color={color[state(p)]}>
                                  {label[state(p)]}
                                </Tag>
                              )}
                            </div>
                          ))}
                      </Space>
                    </div>
                  )}
                  <div className="publication-actions">
                    {selected.target_platform === "douyin"
                      ? douyinActions(selected)
                      : xhsActions(selected, true)}
                  </div>
                  {selected.online_job_id && (
                    <Alert
                      showIcon
                      type={
                        needsReview(selected)
                          ? "warning"
                          : selected.published_at
                            ? "success"
                            : "info"
                      }
                      message={
                        selected.published_at
                          ? "已记录发布成功"
                          : manualReady(selected)
                            ? "上传准备完成，等待你在官方窗口手动发布"
                            : selected.online_state === "failed" &&
                                publishJob(selected)?.state === "needs_review"
                              ? "已核实未发布，可以重新准备"
                              : publishJob(selected)?.error ||
                                publishJob(selected)?.stage ||
                                "发布任务等待处理"
                      }
                      description={
                        manualReady(selected)
                          ? "请点击“上传到小红书”打开原窗口，检查内容并手动发布。完成后点击“记录已发布”确认时间，无需作品链接。重启软件后窗口可能需要重新准备。"
                          : needsReview(selected)
                            ? "请检查专用官方窗口，可手动补填并发布；若已经发布，请点击“记录已发布”。需要重新上传时，先确认未发布。"
                            : undefined
                      }
                    />
                  )}
                  <p className="source-body">{selected.body}</p>
                  <Space wrap>
                    {selected.topics.map((t) => (
                      <Tag color="blue" key={t}>
                        #{t.replace(/^#+/, "")}
                      </Tag>
                    ))}
                  </Space>
                  <div className="publication-actions">
                    <Button
                      icon={<CopyOutlined />}
                      onClick={() => copy(selected.title)}
                    >
                      复制标题
                    </Button>
                    <Button
                      icon={<CopyOutlined />}
                      onClick={() => copy(full(selected))}
                    >
                      复制完整文案
                    </Button>
                  </div>
                  <div className="detail-media">
                    {selected.asset_ids.map((id, i) => {
                      const a = assets.find((a) => a.id === id);
                      return (
                        <div className="detail-asset" key={id}>
                          {a?.kind === "image" ? (
                            <Image src={fileURL(id)} />
                          ) : (
                            <video controls src={fileURL(id)} />
                          )}
                          <div className="row-between">
                            <small>
                              {String(i + 1).padStart(2, "0")} · {a?.name}
                            </small>
                            <a href={fileURL(id) + "?download=1"}>下载素材</a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {selected.cover_id && (
                    <div>
                      <h4>封面</h4>
                      <Image width={160} src={fileURL(selected.cover_id)} />
                    </div>
                  )}
                  <Alert
                    type="info"
                    message="小红书上传准备后，请在官方窗口预览并手动发布，再点击“记录已发布”。上传素材、复制文案或打开平台均不会自动标记为已发布。"
                    showIcon
                  />
                  <div className="publication-actions">
                    <Button
                      icon={<ExportOutlined />}
                      href={
                        selected?.target_platform === "douyin"
                          ? "https://creator.douyin.com/"
                          : "https://creator.xiaohongshu.com/"
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      打开创作平台
                    </Button>
                    <Button
                      type="primary"
                      icon={<CheckCircleOutlined />}
                      disabled={!selected.ready}
                      onClick={() => {
                        setMarkID(selected.id);
                        setPublishedAt(
                          selected.published_at
                            ? dayjs(selected.published_at)
                            : dayjs(),
                        );
                      }}
                    >
                      {selected.published_at ? "修改发布记录" : "记录已发布"}
                    </Button>
                  </div>
                  {!selected.ready && (
                    <p className="muted">
                      请回到仿写项目选好素材，再建立一份完整发布稿。
                    </p>
                  )}
                  {selected.published_at && (
                    <p>
                      已发布于 {date(selected.published_at)} ·{" "}
                      {selected.published_url ? (
                        <a
                          href={selected.published_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          查看作品
                        </a>
                      ) : (
                        "已手动记录"
                      )}
                    </p>
                  )}
                </>
              )}
            </Drawer>
            <Modal
              title="记录实际发布结果"
              open={!!markID}
              onCancel={() => setMarkID("")}
              onOk={async () => {
                try {
                  await patch("/publications/" + markID, {
                    published_at: publishedAt.toISOString(),
                  });
                  setMarkID("");
                  message.success("已记录发布结果");
                  refresh();
                } catch (e) {
                  message.error((e as Error).message);
                }
              }}
            >
              <div className="settings-form">
                <p>
                  请确认已在对应平台完成发布。这里只记录结果，无需填写作品链接，也不会再次上传或发布。
                </p>
                <label>
                  发布时间
                  <DatePicker
                    showTime
                    value={publishedAt}
                    onChange={(v) => v && setPublishedAt(v)}
                    style={{ width: "100%" }}
                  />
                </label>
              </div>
            </Modal>
          </>
        )}
      </Douyin>
    </>
  );
}
