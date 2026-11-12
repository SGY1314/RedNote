import { ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from "antd";
import { useEffect, useRef, useState } from "react";
import type { Job } from "./api";
import { api, date, post } from "./api";
import type { PublisherAccount } from "./PublisherPanel";

type Metrics = {
  likes: string;
  favorites: string;
  comments: string;
  shares: string;
  views: string;
};
type Sample = { at: string; metrics: Metrics };
type OwnPost = {
  id: string;
  account_id: string;
  title: string;
  kind: string;
  published_at_ms: number;
  metrics: Metrics;
  last_seen: string;
  detail_state: string;
  history: Sample[];
};
type Sync = {
  account_id: string;
  username: string;
  last_attempt: string;
  last_success: string;
  last_error: string;
  job_id: string;
  count: number;
};
const metrics: [keyof Metrics, string][] = [
  ["likes", "点赞"],
  ["favorites", "收藏"],
  ["comments", "评论"],
  ["shares", "分享"],
  ["views", "阅读量"],
];
function delta(p: OwnPost, key: keyof Metrics) {
  const old = p.history?.[p.history.length - 2]?.metrics[key],
    value = p.metrics[key];
  if (!old || !/^\d+$/.test(old) || !/^\d+$/.test(value)) return "";
  if (
    !Number.isSafeInteger(Number(value)) ||
    !Number.isSafeInteger(Number(old))
  )
    return "";
  const n = Number(value) - Number(old);
  return n ? `较上次 ${n > 0 ? "+" : ""}${n}` : "较上次持平";
}
export default function PostMonitor({
  account,
  onAccount,
  onConnect,
  jobs,
  refresh,
}: {
  account?: PublisherAccount;
  onAccount: (v: PublisherAccount) => void;
  onConnect: () => void;
  jobs: Job[];
  refresh: () => Promise<void>;
}) {
  const { message } = App.useApp();
  const [selected, setSelected] = useState(account?.user_id || "");
  const [data, setData] = useState<{ accounts: Sync[]; posts: OwnPost[] }>({
    accounts: [],
    posts: [],
  });
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [automatic, setAutomatic] = useState(false);
  const [search, setSearch] = useState("");
  const [history, setHistory] = useState<OwnPost>();
  const syncState = data.accounts.find((a) => a.account_id === selected);
  const active = jobs.some(
    (j) =>
      j.kind === "post_sync" &&
      j.target === selected &&
      ["queued", "running"].includes(j.state),
  );
  const job = jobs.find((j) => j.id === syncState?.job_id);
  const jobVersion = jobs
    .filter((j) => j.kind === "post_sync")
    .map((j) => j.id + ":" + j.state + ":" + j.updated_at)
    .join("|");
  useEffect(() => {
    if (account?.user_id) setSelected(account.user_id);
  }, [account?.user_id]);
  useEffect(() => {
    if (!account?.is_logged_in || account.user_id !== selected)
      setAutomatic(false);
  }, [account?.is_logged_in, account?.user_id, selected]);
  useEffect(() => {
    let stale = false;
    api<{ accounts: Sync[]; posts: OwnPost[] }>(
      "/post-monitor?account_id=" + encodeURIComponent(selected),
    )
      .then((r) => {
        if (stale) return;
        setData(r);
        setError("");
        if (!selected && r.accounts.length)
          setSelected(r.accounts[0].account_id);
      })
      .catch((e) => {
        if (!stale) setError((e as Error).message);
      });
    return () => {
      stale = true;
    };
  }, [selected, jobVersion]);
  const sync = async () => {
    if (checking || active) return;
    setChecking(true);
    try {
      const a = await post<PublisherAccount>("/publisher/status");
      onAccount(a);
      if (!a.is_logged_in || !a.user_id) {
        setAutomatic(false);
        onConnect();
        return;
      }
      if (selected && selected !== a.user_id) {
        setAutomatic(false);
        throw new Error("当前登录账号与所选历史账号不同，请选择当前账号再同步");
      }
      setSelected(a.user_id);
      await post("/post-monitor/sync", { account_id: a.user_id });
      await refresh();
      message.success("帖子数据同步已加入后台任务");
    } catch (e) {
      setError((e as Error).message);
      setAutomatic(false);
    } finally {
      setChecking(false);
    }
  };
  const syncRef = useRef(sync);
  syncRef.current = sync;
  useEffect(() => {
    if (!automatic) return;
    const timer = setInterval(
      () => {
        if (!document.hidden) void syncRef.current();
      },
      15 * 60 * 1000,
    );
    return () => clearInterval(timer);
  }, [automatic, selected]);
  const accountOptions = data.accounts.map((a) => ({
    value: a.account_id,
    label: (a.username || "历史账号") + " · " + a.account_id,
  }));
  if (
    account?.user_id &&
    !accountOptions.some((x) => x.value === account.user_id)
  )
    accountOptions.unshift({
      value: account.user_id,
      label: (account.username || "当前账号") + " · " + account.user_id,
    });
  return (
    <section className="table-panel post-monitor">
      <div className="row-between">
        <div>
          <h3>我的帖子数据</h3>
          <p className="muted">同步自己账号的作品，保留最近 30 次读取记录。</p>
        </div>
        <Button
          type="primary"
          icon={<ReloadOutlined />}
          loading={checking || active}
          onClick={() => void sync()}
        >
          立即同步
        </Button>
      </div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          aria-label="帖子监测账号"
          placeholder="扫码后选择账号"
          style={{ minWidth: 260 }}
          value={selected || undefined}
          options={accountOptions}
          onChange={(v) => {
            setSelected(v);
            setAutomatic(false);
          }}
        />
        <Input.Search
          aria-label="搜索自己的帖子"
          placeholder="搜索帖子标题或 ID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 220 }}
        />
        <Switch
          checked={automatic}
          disabled={!account?.is_logged_in || account.user_id !== selected}
          onChange={setAutomatic}
          aria-label="每十五分钟同步"
        />
        <span>此页面可见时每 15 分钟同步</span>
      </Space>
      <Alert
        type="info"
        showIcon
        message="本次读取主页当前可获取的最多 20 篇作品，不代表账号全部帖子。未返回的旧记录保留，不判断为删除；阅读量等不可获取的数据显示 —。"
      />
      {(error || syncState?.last_error || job?.state === "failed") && (
        <Alert
          style={{ marginTop: 12 }}
          type="warning"
          showIcon
          message={error || syncState?.last_error || job?.error}
          description="旧数据继续保留，请检查账号连接后重新同步。"
        />
      )}
      <p className="muted">
        最近成功同步：
        {syncState?.last_success ? date(syncState.last_success) : "尚未同步"}
        {syncState?.last_success
          ? ` · 本次读取 ${syncState.count} 篇 · 本地已记录 ${data.posts.length} 篇`
          : ""}
        {active ? " · 正在读取，请稍候" : ""}
      </p>
      <Table
        rowKey="id"
        size="small"
        scroll={{ x: 1100 }}
        dataSource={data.posts.filter((p) =>
          (p.title + " " + p.id).toLowerCase().includes(search.toLowerCase()),
        )}
        pagination={{ pageSize: 10, showTotal: (n) => `共 ${n} 篇已记录帖子` }}
        locale={{
          emptyText: (
            <Empty description="暂无帖子数据，请先连接自己的账号并同步" />
          ),
        }}
        columns={[
          {
            title: "帖子",
            key: "title",
            width: 260,
            render: (_, p: OwnPost) => (
              <div>
                <a
                  href={"https://www.xiaohongshu.com/explore/" + p.id}
                  target="_blank"
                  rel="noreferrer"
                >
                  {p.title || "无标题"}
                </a>
                <div className="muted">
                  {p.kind === "video" ? "视频" : "图文"} · {p.id}
                </div>
              </div>
            ),
          },
          ...metrics.map(([key, title]) => ({
            title,
            key,
            width: 115,
            render: (_: unknown, p: OwnPost) => (
              <div>
                {p.metrics[key] || "—"}
                <div className="muted">{delta(p, key)}</div>
              </div>
            ),
          })),
          {
            title: "数据状态",
            key: "state",
            width: 155,
            render: (_, p: OwnPost) => (
              <Tag
                color={
                  p.last_seen === syncState?.last_success ? "blue" : "default"
                }
              >
                {p.last_seen !== syncState?.last_success
                  ? "本次未读取"
                  : p.detail_state === "ready"
                    ? "已读取详情"
                    : "仅主页数据"}
              </Tag>
            ),
          },
          {
            title: "发布时间",
            key: "published",
            width: 150,
            render: (_, p: OwnPost) =>
              p.published_at_ms > 0
                ? date(new Date(p.published_at_ms).toISOString())
                : "—",
          },
          {
            title: "最后读取",
            dataIndex: "last_seen",
            width: 155,
            render: (s: string) => date(s),
          },
          {
            title: "历史",
            key: "history",
            width: 90,
            render: (_, p: OwnPost) => (
              <Button type="link" size="small" onClick={() => setHistory(p)}>
                查看记录
              </Button>
            ),
          },
        ]}
      />
      <Modal
        open={!!history}
        title={history?.title || "帖子数据历史"}
        onCancel={() => setHistory(undefined)}
        footer={<Button onClick={() => setHistory(undefined)}>关闭</Button>}
        width={820}
      >
        <p className="muted">
          历史为实际读取时的快照。平台显示的“万”等缩略值保留原样，仅精确整数计算较上次变化。
        </p>
        <Table
          rowKey="at"
          size="small"
          dataSource={[...(history?.history || [])].reverse()}
          pagination={{ pageSize: 8 }}
          columns={[
            {
              title: "读取时间",
              dataIndex: "at",
              render: (s: string) => date(s),
            },
            ...metrics.map(([key, title]) => ({
              title,
              key,
              render: (_: unknown, r: Sample) => r.metrics[key] || "—",
            })),
          ]}
        />
      </Modal>
    </section>
  );
}
