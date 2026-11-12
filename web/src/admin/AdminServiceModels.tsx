import {
  AudioOutlined,
  LinkOutlined,
  PictureOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { Alert, App, Button, Input, Popconfirm, Space, Spin, Tag } from "antd";
import { useEffect, useRef, useState } from "react";
import { api, post } from "../api";
import type { Service, Settings } from "../api";

export type ServiceModelKind = "ocr" | "asr";
const definitions = {
  ocr: {
    name: "图片 OCR",
    description: "识别参考图片中的文字",
    help: "使用支持图片输入的视觉或 OCR 模型。接口须支持 image_url 和 Base64 图片，填写不含 /chat/completions 的基础地址。",
    placeholder: "例如 qwen3.5-ocr",
    icon: <PictureOutlined />,
  },
  asr: {
    name: "语音转写",
    description: "将原视频的语音识别为文字",
    help: "通过 WebSocket 上传音频流，保留带时间的转写结果。",
    placeholder: "例如 paraformer-realtime-v2",
    icon: <AudioOutlined />,
  },
};

// Stay mounted across category switches so unfinished OCR/ASR edits are retained.
export default function AdminServiceModels({
  service,
}: {
  service?: ServiceModelKind;
}) {
  const { message } = App.useApp();
  const [settings, setSettings] = useState<Settings>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [clear, setClear] = useState<ServiceModelKind[]>([]);
  const [busy, setBusy] = useState<ServiceModelKind>();
  const [testing, setTesting] = useState(false);
  const running = useRef(false);
  const [results, setResults] = useState<
    Partial<
      Record<ServiceModelKind, { type: "success" | "error"; text: string }>
    >
  >({});
  const enabled = !!service;
  useEffect(() => {
    if (!enabled || settings) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void api<{ services: Settings }>("/admin/settings")
      .then((data) => {
        if (!data.services?.ocr || !data.services?.asr)
          throw new Error("服务配置读取失败，请重试");
        if (!cancelled) setSettings(data.services);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, retry]);

  if (!service) return null;
  const kind = service;
  const definition = definitions[kind];
  const value = settings?.[kind];
  const clearing = clear.includes(kind);
  const update = (patch: Partial<Service>) => {
    setSettings((old) => old && { ...old, [kind]: { ...old[kind], ...patch } });
    setResults((old) => ({ ...old, [kind]: undefined }));
  };
  const save = async (testConnection: boolean) => {
    if (!value || running.current) return;
    running.current = true;
    setBusy(kind);
    setTesting(testConnection);
    setResults((old) => ({ ...old, [kind]: undefined }));
    let saved = false;
    try {
      // Never submit the other service's possibly stale address/model or draft key.
      await api("/admin/settings", {
        method: "PUT",
        body: JSON.stringify({
          [kind]: {
            base_url: value.base_url,
            model: value.model,
            secret: value.secret || "",
          },
          clear: clearing ? [kind] : [],
        }),
      });
      saved = true;
      const configured = !clearing && (!!value.secret || value.configured);
      setSettings(
        (old) =>
          old && {
            ...old,
            [kind]: {
              ...value,
              base_url: value.base_url.replace(/\/+$/, ""),
              model: value.model.trim(),
              secret: "",
              configured,
            },
          },
      );
      setClear((old) => old.filter((item) => item !== kind));
      if (testConnection) {
        const result = await post<{ message: string }>(
          `/admin/settings/test/${kind}`,
        );
        setResults((old) => ({
          ...old,
          [kind]: { type: "success", text: result.message },
        }));
      } else {
        message.success(`${definition.name}配置已保存`);
      }
    } catch (e) {
      const text =
        (saved ? "配置已保存；连接检测失败：" : "保存失败：") +
        (e as Error).message;
      setResults((old) => ({ ...old, [kind]: { type: "error", text } }));
    } finally {
      running.current = false;
      setBusy(undefined);
      setTesting(false);
    }
  };
  return (
    <article
      className="admin-model-group admin-service-model"
      aria-label={`${definition.name}配置`}
    >
      <div className="admin-model-group-head">
        <div className="admin-model-icon">{definition.icon}</div>
        <div>
          <strong>{definition.name}</strong>
          <small>{definition.description}</small>
        </div>
        {value && (
          <Tag
            className={
              "admin-config-status " +
              (value.configured && !clearing ? "is-configured" : "")
            }
          >
            <i aria-hidden="true" />
            {clearing ? "待清除密钥" : value.configured ? "已配置" : "待配置"}
          </Tag>
        )}
      </div>
      {loading && (
        <Spin tip="读取配置中">
          <div style={{ minHeight: 100 }} />
        </Spin>
      )}
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          action={
            <Button size="small" onClick={() => setRetry((old) => old + 1)}>
              重新加载
            </Button>
          }
        />
      )}
      {value && (
        <div className="settings-form admin-service-model-form">
          <p className="muted">{definition.help}</p>
          <label htmlFor={`admin-${kind}-url`}>API 地址</label>
          <Input
            id={`admin-${kind}-url`}
            value={value.base_url}
            disabled={busy === kind}
            onChange={(e) => update({ base_url: e.target.value })}
          />
          <label htmlFor={`admin-${kind}-model`}>模型名称</label>
          <Input
            id={`admin-${kind}-model`}
            value={value.model}
            placeholder={definition.placeholder}
            disabled={busy === kind}
            onChange={(e) => update({ model: e.target.value })}
          />
          <label htmlFor={`admin-${kind}-secret`}>API 密钥</label>
          <Input.Password
            id={`admin-${kind}-secret`}
            value={value.secret || ""}
            autoComplete="new-password"
            disabled={busy === kind}
            placeholder={
              clearing
                ? "保存后清除密钥，输入新密钥可取消清除"
                : value.configured
                  ? "已保存密钥，留空保持不变"
                  : "请输入 API Key"
            }
            onChange={(e) => {
              update({ secret: e.target.value });
              if (e.target.value)
                setClear((old) => old.filter((item) => item !== kind));
            }}
          />
          <Space wrap>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={busy === kind && !testing}
              disabled={!!busy}
              onClick={() => void save(false)}
            >
              保存配置
            </Button>
            <Button
              icon={<LinkOutlined />}
              loading={busy === kind && testing}
              disabled={!!busy}
              onClick={() => void save(true)}
            >
              保存并检测连接
            </Button>
            <Popconfirm
              title="清除这项服务的密钥？保存后生效。"
              onConfirm={() => {
                update({ secret: "" });
                setClear((old) => [
                  ...old.filter((item) => item !== kind),
                  kind,
                ]);
              }}
            >
              <Button
                type="text"
                danger
                disabled={
                  !!busy || clearing || (!value.configured && !value.secret)
                }
              >
                清除密钥
              </Button>
            </Popconfirm>
          </Space>
          {results[kind] && (
            <Alert
              showIcon
              type={results[kind]!.type}
              message={results[kind]!.text}
            />
          )}
          <Alert
            type="info"
            showIcon
            message="请确保 API 地址、地域、业务空间与密钥匹配。连接检测不等于模型实际调用验收。"
          />
          <small className="muted">
            密钥使用 Windows DPAPI 加密保存，留空不会覆盖已保存的密钥。
          </small>
        </div>
      )}
    </article>
  );
}
