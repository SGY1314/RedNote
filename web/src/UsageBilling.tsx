import { Alert, Button, Spin } from "antd";
import { useEffect, useState } from "react";
import { api } from "./api";
import UsageDashboard from "./admin/UsageDashboard";
import type { UsageRecord } from "./admin/adminData";

export default function UsageBilling() {
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [price, setPrice] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    api<{ usage: UsageRecord[]; price_per_1k: number }>("/usage")
      .then((result) => {
        if (!live) return;
        setRecords(result.usage);
        setPrice(result.price_per_1k);
      })
      .catch((e: Error) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [attempt]);
  if (loading)
    return (
      <Spin tip="正在加载用量">
        <div style={{ minHeight: 120 }} />
      </Spin>
    );
  if (error)
    return (
      <Alert
        type="error"
        message={`用量加载失败：${error}`}
        action={
          <Button aria-label="重试" onClick={() => setAttempt((n) => n + 1)}>
            重试
          </Button>
        }
      />
    );
  return <UsageDashboard records={records} price={price} readOnlyPrice />;
}
