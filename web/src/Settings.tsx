import {
  CheckCircleOutlined,
  LinkOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Alert, App, Button, Drawer, Input, Space, Tabs, Tag } from "antd";
import { useEffect, useState } from "react";
import type { Settings as ServiceSettings } from "./api";
import { api, post } from "./api";
export default function SettingsPanel({
  open,
  onClose,
  endpoint = "/settings",
}: {
  open: boolean;
  onClose: () => void;
  endpoint?: string;
}) {
  const { message } = App.useApp();
  const [settings, setSettings] = useState<ServiceSettings>();
  const [deps, setDeps] = useState<Record<string, boolean>>({});
  const [dataDir, setDataDir] = useState("");
  const [testing, setTesting] = useState("");
  const load = async () => {
    try {
      const d = await api(endpoint);
      setSettings(d.services);
      setDeps(d.dependencies);
      setDataDir(d.data_dir);
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  useEffect(() => {
    if (open) load();
  }, [open]);
  const test = async (kind: string) => {
    setTesting(kind);
    try {
      const result = await post(endpoint + "/test/" + kind);
      message.info(result.message, 6);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setTesting("");
    }
  };
  return (
    <Drawer
      title={
        <Space>
          <SettingOutlined />
          服务与环境设置
        </Space>
      }
      width={680}
      open={open}
      onClose={onClose}
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
