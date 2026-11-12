import {
  DeleteOutlined,
  PlusOutlined,
  PushpinOutlined,
  PushpinFilled,
  SettingOutlined,
} from "@ant-design/icons";
import { Button, Empty, Input, Select, Tag, Tooltip } from "antd";
import type { Platform, Project } from "../api";
import { date, platformName } from "../api";

type Props = {
  query: string;
  onQuery: (value: string) => void;
  platformFilter: Platform | "";
  onPlatformFilter: (value: Platform | "") => void;
  trash: boolean;
  onToggleTrash: () => void;
  visibleProjects: Project[];
  selectedID: string;
  projectStats: Record<string, { count: number; confirmed: boolean }>;
  projectActionBusy: boolean;
  mediaDisabled: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRemove: (id: string) => void;
  pinned: string[];
  onTogglePin: (id: string) => void;
};
export default function ProjectRail({
  query,
  onQuery,
  platformFilter,
  onPlatformFilter,
  trash,
  onToggleTrash,
  visibleProjects,
  selectedID,
  projectStats,
  projectActionBusy,
  mediaDisabled,
  onSelect,
  onCreate,
  onRemove,
  pinned,
  onTogglePin,
}: Props) {
  return (
    <aside className="rewrite-projects">
      <div className="project-rail-filters">
        <Input.Search
          aria-label="搜索仿写项目"
          placeholder="搜索仿写项目"
          value={query}
          allowClear
          onChange={(e) => onQuery(e.target.value)}
        />
        <Select
          aria-label="筛选仿写来源平台"
          value={platformFilter}
          onChange={onPlatformFilter}
          options={[
            { value: "", label: "来源平台" },
            { value: "xhs", label: "小红书" },
            { value: "douyin", label: "抖音" },
          ]}
        />
      </div>
      <div className="project-rail-actions">
        <Button
          size="small"
          type="text"
          icon={<PlusOutlined />}
          onClick={onCreate}
        >
          新建项目
        </Button>
        <Button size="small" type="text" onClick={onToggleTrash}>
          {trash ? "返回项目" : "回收站"}
        </Button>
      </div>
      <div className="project-rail-list">
        {visibleProjects.map((p) => (
          <article
            className={
              "project-rail-item " + (selectedID === p.id ? "selected" : "")
            }
            key={p.id}
          >
            <button
              className="project-rail-open"
              onClick={() => onSelect(p.id)}
              aria-current={selectedID === p.id ? "true" : undefined}
            >
              <strong>{p.name || "未命名项目"}</strong>
              <span>
                <Tag>
                  {p.note_id
                    ? platformName(p.platform === "douyin" ? "douyin" : "xhs")
                    : "自主创作"}
                </Tag>
              </span>
              <span>
                {projectStats[p.id]
                  ? `${projectStats[p.id].count} 个版本`
                  : p.note_id
                    ? "来源仿写"
                    : "自主创作"}
                {projectStats[p.id] && (
                  <Tag
                    bordered={false}
                    color={projectStats[p.id].confirmed ? "green" : "default"}
                  >
                    {projectStats[p.id].confirmed ? "含已确认版本" : "草稿"}
                  </Tag>
                )}
              </span>
              <small>{date(p.created_at)}</small>
            </button>
            {!trash && (
              <div className="project-rail-item-actions">
                <Tooltip
                  title={pinned.includes(p.id) ? "取消置顶" : "置顶项目"}
                >
                  <Button
                    type="text"
                    size="small"
                    className={
                      pinned.includes(p.id)
                        ? "project-pin is-pinned"
                        : "project-pin"
                    }
                    aria-label={`${pinned.includes(p.id) ? "取消置顶" : "置顶项目"} ${p.name}`}
                    aria-pressed={pinned.includes(p.id)}
                    icon={
                      pinned.includes(p.id) ? (
                        <PushpinFilled />
                      ) : (
                        <PushpinOutlined />
                      )
                    }
                    onClick={() => onTogglePin(p.id)}
                  />
                </Tooltip>
                <Tooltip title="删除项目">
                  <Button
                    type="text"
                    className="rewrite-delete-button"
                    size="small"
                    aria-label={`删除项目 ${p.name}`}
                    icon={<DeleteOutlined />}
                    disabled={
                      projectActionBusy ||
                      (selectedID === p.id && mediaDisabled)
                    }
                    onClick={() => onRemove(p.id)}
                  />
                </Tooltip>
              </div>
            )}
          </article>
        ))}
        {!visibleProjects.length && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={trash ? "回收站为空" : "暂无匹配项目"}
          />
        )}
      </div>
      <div className="project-rail-settings">
        <Button
          type="text"
          icon={<SettingOutlined />}
          onClick={() => onSelect("")}
        >
          项目与模型管理
        </Button>
      </div>
    </aside>
  );
}
