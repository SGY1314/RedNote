import {
  CheckCircleOutlined,
  LinkOutlined,
  SaveOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Drawer,
  Input,
  Popconfirm,
  Space,
  Tabs,
  Tag,
} from "antd";
import { useEffect, useState } from "react";
import type { Settings as ServiceSettings } from "./api";
import { api, post } from "./api";
export default function SettingsPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const [settings, setSettings] = useState<ServiceSettings>();
  const [deps, setDeps] = useState<Record<string, boolean>>({});
  const [dataDir, setDataDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState("");
  const [clear, setClear] = useState<string[]>([]);
  const load = async () => {
    try {
      const d = await api("/settings");
      setSettings(d.services);
      setDeps(d.dependencies);
      setDataDir(d.data_dir);
      setClear([]);
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  useEffect(() => {
    if (open) load();
  }, [open]);
  const save = async () => {
    if (!settings) return false;
    setBusy(true);
    try {
      await api("/settings", {
        method: "PUT",
        body: JSON.stringify({ ocr: settings.ocr, asr: settings.asr, clear }),
      });
      await load();
      message.success("配置已保存");
      return true;
    } catch (e) {
      message.error((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const test = async (kind: string) => {
    setTesting(kind);
    try {
      if (kind !== "collector" && !(await save())) return;
      const result = await post("/settings/test/" + kind);
      message.info(result.message, 6);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setTesting("");
    }
  };
  const forms = settings
    ? (["ocr", "asr"] as const).map((key) => ({
        key,
        label: { text: "文案仿写", ocr: "图片 OCR", asr: "语音转写" }[key],
        children: (
          <div className="settings-form">
            <div className="row-between">
              <strong>
                {
                  {
                    text: "文字生成服务",
                    ocr: "图片文字识别",
                    asr: "原视频语音转写",
                  }[key]
                }
              </strong>
              <Tag
                color={
                  settings[key].configured && !clear.includes(key)
                    ? "green"
                    : "gold"
                }
              >
                {settings[key].configured && !clear.includes(key)
                  ? "已配置"
                  : "待配置"}
              </Tag>
            </div>
            <p className="muted">
              {key === "asr"
                ? "通过 WebSocket 上传音频流，保留带时间的转写结果。"
                : "需要能读取图片的视觉/OCR 模型，例如 qwen3.5-ocr；不要使用仅写文案的模型。接口须支持 image_url 和 Base64 图片。填写基础地址，不包含 /chat/completions。"}
            </p>
            <label>
              API 地址
              <Input
                value={settings[key].base_url}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    [key]: { ...settings[key], base_url: e.target.value },
                  })
                }
              />
            </label>
            <label>
              模型
              <Input
                value={settings[key].model}
                placeholder={
                  key === "ocr"
                    ? "例如 qwen3.5-ocr"
                    : "例如 paraformer-realtime-v2"
                }
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    [key]: { ...settings[key], model: e.target.value },
                  })
                }
              />
            </label>
            <label>
              API 密钥
              <Input.Password
                autoComplete="new-password"
                value={settings[key].secret || ""}
                placeholder={
                  settings[key].configured
                    ? "已保存密钥，留空保持不变"
                    : "请输入 API Key"
                }
                onChange={(e) => {
                  setSettings({
                    ...settings,
                    [key]: { ...settings[key], secret: e.target.value },
                  });
                  setClear(clear.filter((x) => x !== key));
                }}
              />
            </label>
            <Space>
              <Button
                icon={<LinkOutlined />}
                loading={testing === key}
                onClick={() => test(key)}
              >
                保存并检测连接
              </Button>
              <Popconfirm
                title="清除这项服务的密钥？保存后生效。"
                onConfirm={() => {
                  setClear([...clear, key]);
                  setSettings({
                    ...settings,
                    [key]: { ...settings[key], secret: "" },
                  });
                }}
              >
                <Button type="text" danger>
                  清除密钥
                </Button>
              </Popconfirm>
            </Space>
            <Alert
              type="info"
              showIcon
              message="请确保 API 地址、地域、业务空间与密钥匹配。连接检测不等于模型实际调用验收。"
            />
          </div>
        ),
      }))
    : [];
  return (
    <Drawer
      title={
        <Space>
          <SettingOutlined />
          工作台设置
        </Space>
      }
      width={680}
      open={open}
      onClose={onClose}
      footer={
        <div className="row-between">
          <small className="muted">密钥使用 Windows DPAPI 加密保存</small>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={busy}
            onClick={save}
          >
            保存设置
          </Button>
        </div>
      }
    >
      {settings && (
        <Tabs
          items={[
            {
              key: "collector",
              label: "采集服务",
              children: (
                <div className="settings-form">
                  <h3>小红书采集</h3>
                  <p className="muted">
                    粘贴完整笔记链接或分享文字即可采集公开内容，无需配置登录信息。
                  </p>
                  <label>
                    服务地址
                    <Input value={settings.collector_url} disabled />
                  </label>
                  <Button
                    icon={<LinkOutlined />}
                    loading={testing === "collector"}
                    onClick={() => test("collector")}
                  >
                    检测采集服务
                  </Button>
                  <Alert
                    type="info"
                    message="服务连接正常仅表示采集进程可用。具体笔记能否访问，还取决于链接有效性和平台状态。"
                  />
                </div>
              ),
            },
            ...forms,
            {
              key: "local",
              label: "本地环境",
              children: (
                <div className="settings-form">
                  <h3>本地依赖与存储</h3>
                  {Object.entries(deps).map(([key, ready]) => (
                    <div className="dependency-row" key={key}>
                      <strong>{key}</strong>
                      <Tag color={ready ? "green" : "orange"}>
                        {ready ? (
                          <>
                            <CheckCircleOutlined /> 已就绪
                          </>
                        ) : (
                          "未检测到"
                        )}
                      </Tag>
                    </div>
                  ))}
                  <label>
                    数据目录
                    <Input readOnly value={dataDir} />
                  </label>
                  <p>
                    数据库、上传素材与导出文件均保存在该目录。备份前请先停止服务，再复制整个
                    data 目录。
                  </p>
                  <Alert
                    type="info"
                    message="密钥绑定当前 Windows 用户。迁移到其他账户或电脑后，需要重新配置密钥。"
                  />
                </div>
              ),
            },
          ]}
        />
      )}
    </Drawer>
  );
}
