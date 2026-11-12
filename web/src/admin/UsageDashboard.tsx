import Table from "../components/ResponsiveTable";
import {
  BarChartOutlined,
  ClockCircleOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Empty,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Space,
  Tag,
} from "antd";
import type { TableColumnsType } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { Job } from "../api";
import {
  buildUsageRecords,
  filterUsage,
  formatCost,
  formatDate,
  formatNumber,
  groupUsageByDay,
  groupUsageByModel,
  usageRangeLabel,
  type AdminUser,
  type UsageRange,
  type UsageRecord,
} from "./adminData";

const stateColor: Record<string, string> = {
  succeeded: "green",
  failed: "red",
  running: "blue",
  queued: "default",
  blocked: "gold",
  needs_review: "orange",
  cancelled: "default",
};

export default function UsageDashboard({
  jobs,
  users,
  records: providedRecords,
  price: priceProp,
  readOnlyPrice = false,
  onPriceChange,
  embedded = false,
  showUser = false,
}: {
  jobs?: Job[];
  users?: AdminUser[];
  records?: UsageRecord[];
  price?: number;
  readOnlyPrice?: boolean;
  onPriceChange?: (price: number) => void | Promise<void>;
  embedded?: boolean;
  showUser?: boolean;
}) {
  const { message } = App.useApp();
  const [range, setRange] = useState<UsageRange>("7d");
  const [model, setModel] = useState("");
  const [feature, setFeature] = useState("");
  const [price, setPrice] = useState(priceProp ?? 0);
  const [priceOpen, setPriceOpen] = useState(false);
  const [priceDraft, setPriceDraft] = useState(priceProp ?? 0);
  useEffect(() => {
    if (priceProp !== undefined) setPrice(priceProp);
  }, [priceProp]);
  useEffect(() => setPriceDraft(price), [price]);
  const currentUser =
    users?.find((u) => u.role === "creator" && u.status === "active")
      ?.display_name || "创作用户";
  const records = useMemo(
    () => providedRecords || buildUsageRecords(jobs || [], currentUser, price),
    [providedRecords, jobs, currentUser, price],
  );
  const filtered = useMemo(
    () => filterUsage(records, range, model, feature),
    [records, range, model, feature],
  );
  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, r) => ({
          input: acc.input + r.input,
          output: acc.output + r.output,
          total: acc.total + r.total,
          cost: acc.cost + r.cost,
        }),
        { input: 0, output: 0, total: 0, cost: 0 },
      ),
    [filtered],
  );
  const daily = useMemo(
    () => groupUsageByDay(filtered, range),
    [filtered, range],
  );
  const byModel = useMemo(() => groupUsageByModel(filtered), [filtered]);
  const modelOptions = useMemo(
    () =>
      [...new Set(records.map((r) => r.model))].map((v) => ({
        value: v,
        label: v,
      })),
    [records],
  );
  const featureOptions = useMemo(
    () =>
      [...new Set(records.map((r) => r.feature))].map((v) => ({
        value: v,
        label: v,
      })),
    [records],
  );
  const maxDay = Math.max(1, ...daily.map((d) => d.input + d.output));
  const maxModel = Math.max(1, ...byModel.map((m) => m.total));

  const savePrice = () => {
    const next = Number(priceDraft) || 0;
    setPrice(next);
    setPriceOpen(false);
    void onPriceChange?.(next);
    message.success(next > 0 ? "Token 单价已保存" : "已关闭费用估算");
  };

  const columns: TableColumnsType<UsageRecord> = [
    {
      title: "调用时间",
      dataIndex: "at",
      width: 168,
      render: (value: string) => (
        <span className="usage-time">
          <ClockCircleOutlined /> {formatDate(value)}
        </span>
      ),
    },
    {
      title: "功能 / 模型",
      dataIndex: "feature",
      render: (_: string, record) => (
        <div className="usage-feature-cell">
          <strong>{record.feature}</strong>
          <small>{record.model}</small>
        </div>
      ),
    },
    ...(showUser
      ? [
          {
            title: "用户",
            dataIndex: "user",
            width: 120,
          },
        ]
      : []),
    {
      title: "输入",
      dataIndex: "input",
      width: 96,
      align: "right" as const,
      render: (value: number) => formatNumber(value),
    },
    {
      title: "输出",
      dataIndex: "output",
      width: 96,
      align: "right" as const,
      render: (value: number) => formatNumber(value),
    },
    {
      title: "总 Token",
      dataIndex: "total",
      width: 110,
      align: "right" as const,
      render: (value: number) => <strong>{formatNumber(value)}</strong>,
    },
    {
      title: "估算费用",
      dataIndex: "cost",
      width: 110,
      align: "right" as const,
      render: (value: number) => (
        <span className="usage-cost">{formatCost(value, value <= 0)}</span>
      ),
    },
    {
      title: "状态",
      dataIndex: "state",
      width: 108,
      render: (_: string, record) => (
        <Tag color={stateColor[record.state] || "default"}>
          {record.stateLabel}
        </Tag>
      ),
    },
  ];

  return (
    <section
      className={"usage-dashboard " + (embedded ? "usage-embedded" : "")}
    >
      {!embedded && (
        <div className="usage-page-head">
          <div>
            <span className="usage-eyebrow">WORKSPACE USAGE</span>
            <h2>计费面板</h2>
            {!readOnlyPrice && (
              <p>查看 Token 用量、模型调用与费用估算，数据按本地时间统计。</p>
            )}
          </div>
          <div className="usage-price-pill">
            <BarChartOutlined />
            Token 单价：
            <strong>{price > 0 ? `¥${price} / 千 Token` : "未估算"}</strong>
            {!readOnlyPrice && (
              <Button
                type="text"
                icon={<SettingOutlined />}
                onClick={() => setPriceOpen(true)}
              >
                设置
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="usage-toolbar">
        <Segmented
          value={range}
          onChange={(value) => setRange(value as UsageRange)}
          options={(Object.keys(usageRangeLabel) as UsageRange[]).map(
            (value) => ({
              value,
              label: usageRangeLabel[value],
            }),
          )}
        />
        <Space wrap>
          <Select
            allowClear
            value={model || undefined}
            placeholder="全部模型"
            style={{ width: 190 }}
            options={modelOptions}
            onChange={(value) => setModel(value || "")}
          />
          <Select
            allowClear
            value={feature || undefined}
            placeholder="全部调用类型"
            style={{ width: 170 }}
            options={featureOptions}
            onChange={(value) => setFeature(value || "")}
          />
          {embedded && !readOnlyPrice && (
            <Button
              icon={<SettingOutlined />}
              onClick={() => setPriceOpen(true)}
            >
              单价设置
            </Button>
          )}
        </Space>
      </div>
      <div className="usage-call-count">
        <strong>{filtered.filter((r) => r.total > 0).length}</strong>{" "}
        次已执行任务
        <span>· Token和费用为任务估算，非供应商账单；未执行任务不计入消耗</span>
      </div>
      <div className="usage-summary">
        <article className="usage-summary-card primary">
          <span>总 Token</span>
          <strong>{formatNumber(totals.total)}</strong>
          <small>按执行任务估算，非实际账单</small>
        </article>
        <article className="usage-summary-card">
          <span>输入 Token</span>
          <strong>{formatNumber(totals.input)}</strong>
          <small>包含提示词与参考内容</small>
        </article>
        <article className="usage-summary-card">
          <span>输出 Token</span>
          <strong>{formatNumber(totals.output)}</strong>
          <small>按返回内容估算</small>
        </article>
        <article className="usage-summary-card">
          <span>估算费用 CNY</span>
          <strong>{formatCost(totals.cost, totals.cost <= 0)}</strong>
          <small>
            {price > 0 ? "按已配置 Token 单价" : "配置单价后显示估算"}
          </small>
        </article>
      </div>
      <div className="usage-chart-grid">
        <article className="usage-panel usage-chart-panel">
          <div className="usage-panel-head">
            <div>
              <strong>Token 用量趋势</strong>
              <small>按日期查看输入与输出</small>
            </div>
            <div className="usage-legend">
              <span>
                <i className="legend-input" />
                输入
              </span>
              <span>
                <i className="legend-output" />
                输出
              </span>
            </div>
          </div>
          {filtered.length ? (
            <div className="usage-chart">
              <div className="usage-bars">
                {daily.map((day) => {
                  const total = day.input + day.output;
                  const height = total
                    ? Math.max(6, (total / maxDay) * 154)
                    : 0;
                  return (
                    <div className="usage-bar-column" key={day.key}>
                      <div className="usage-bar-value">
                        {total ? formatNumber(total) : ""}
                      </div>
                      <div
                        className="usage-bar-stack"
                        style={{ height: `${height}px` }}
                      >
                        {!!total && (
                          <>
                            <i
                              className="usage-bar-output"
                              style={{
                                height: `${(day.output / total) * 100}%`,
                              }}
                            />
                            <i
                              className="usage-bar-input"
                              style={{
                                height: `${(day.input / total) * 100}%`,
                              }}
                            />
                          </>
                        )}
                      </div>
                      <span>{day.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无调用记录"
            />
          )}
        </article>
        <article className="usage-panel usage-dist-panel">
          <div className="usage-panel-head">
            <div>
              <strong>用量分布</strong>
              <small>按模型查看 Token 占比</small>
            </div>
          </div>
          {byModel.length ? (
            <div className="usage-distribution">
              {byModel.map((item) => (
                <div className="usage-dist-row" key={item.model}>
                  <div className="usage-dist-head">
                    <span title={item.model}>{item.model}</span>
                    <strong>{formatNumber(item.total)} Token</strong>
                  </div>
                  <div className="usage-dist-track">
                    <i
                      style={{
                        width: `${Math.max(4, (item.total / maxModel) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无模型用量"
            />
          )}
        </article>
      </div>
      <article className="usage-panel usage-detail-panel">
        <div className="usage-panel-head">
          <div>
            <strong>调用明细</strong>
            <small>展开记录查看缓存、推理与计量详情</small>
          </div>
          <small>{filtered.length} 条记录</small>
        </div>
        <Table
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={filtered}
          pagination={{ pageSize: 8, hideOnSinglePage: true }}
          scroll={{ x: 900 }}
          locale={{
            emptyText: "暂无调用记录。完成一次 AI 创作后，这里会自动统计。",
          }}
        />
      </article>
      <Modal
        open={priceOpen}
        title="Token 单价"
        okText="保存"
        cancelText="取消"
        onOk={savePrice}
        onCancel={() => setPriceOpen(false)}
      >
        <p className="muted">
          仅用于工作台内的费用估算，不会修改模型服务商的真实账单。设置为 0
          则显示“未估算”。
        </p>
        <label className="usage-price-field">
          <span>每千 Token 单价（CNY）</span>
          <InputNumber
            min={0}
            step={0.001}
            value={priceDraft}
            onChange={(value) => setPriceDraft(Number(value) || 0)}
            addonAfter="元 / 千 Token"
            style={{ width: "100%" }}
          />
        </label>
      </Modal>
    </section>
  );
}
