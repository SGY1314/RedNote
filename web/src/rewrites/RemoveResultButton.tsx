import { DeleteOutlined } from "@ant-design/icons";
import { Button, Popconfirm } from "antd";
import "./result-remove.css";

export default function RemoveResultButton({
  kind,
  disabled,
  onRemove,
}: {
  kind: "image" | "video";
  disabled: boolean;
  onRemove: () => void;
}) {
  const label = kind === "video" ? "视频" : "图片";
  return (
    <Popconfirm
      title={`从当前项目移除这${kind === "video" ? "个" : "张"}${label}？`}
      description="原文件和已有发布稿会保留。"
      okText="移除"
      cancelText="取消"
      disabled={disabled}
      onConfirm={onRemove}
    >
      <Button
        className="media-result-remove"
        size="small"
        type="text"
        icon={<DeleteOutlined />}
        aria-label={`移除${label}`}
        title={`移除${label}`}
        disabled={disabled}
      />
    </Popconfirm>
  );
}
