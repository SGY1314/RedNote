import type { ReactNode as PromptReactNode } from "react";
import type { ReactNode } from "react";
import { Button, Input, Select } from "antd";
import {
  CheckOutlined,
  CopyOutlined,
  RobotOutlined,
  SendOutlined,
} from "@ant-design/icons";
import GenerationComposer from "./GenerationComposer";
import type { Asset } from "../api";
import RewriteSourceNote from "./RewriteSourceNote";
import { WorkflowActionBar, WorkflowResultPanel } from "./WorkflowControls";
import "./title-rewrite.css";
import CopyLetter from "./CopyLetter";

export default function CopyRewriteStep({
  reference,
  original,
  originalLabel = "原始文案",
  assets,
  title,
  systemPrompt,
  promptControl,
  requirements,
  modelControl,
  modelName,
  count,
  working,
  generating,
  modelReady,
  selected,
  selectedIndex,
  topics,
  candidates,
  feedback,
  sourceControl,
  onRequirements,
  onCount,
  onGenerate,
  onSelect,
  onOriginal,
  onText,
  onTopics,
  onConfirm,
  onPublish,
}: {
  reference: { title: string; body: string; topics: string[] };
  original: { body: string; topics: string[] };
  originalLabel?: string;
  assets: Asset[];
  title: string;
  systemPrompt: string;
  promptControl?: PromptReactNode;
  requirements: string;
  modelControl: ReactNode;
  modelName: string;
  count: number;
  working: boolean;
  generating: boolean;
  modelReady: boolean;
  selected: string;
  selectedIndex: number;
  topics: string[];
  candidates: { body: string; topics: string[] }[];
  feedback: ReactNode;
  sourceControl?: ReactNode;
  onRequirements: (text: string) => void;
  onCount: (count: number) => void;
  onGenerate: () => void;
  onSelect: (index: number | null) => void;
  onOriginal: () => void;
  onText: (index: number, text: string) => void;
  onTopics: (index: number, topics: string[]) => void;
  onConfirm: () => void;
  onPublish: () => void;
}) {
  const invalid =
    !(selectedIndex < 0 ? original.body : selected).trim() ||
    Array.from(selectedIndex < 0 ? original.body : selected).length > 12000;
  return (
    <section
      className="workflow-panel title-rewrite-panel copy-rewrite-panel"
      aria-label="文案仿写"
    >
      {sourceControl ?? (
        <RewriteSourceNote
          reference={reference}
          assets={assets}
          title={title}
        />
      )}
      {promptControl || (
        <label className="workflow-field">
          <span>系统提示词</span>
          <Input.TextArea
            aria-label="系统提示词"
            value={systemPrompt}
            readOnly
            autoSize={{ minRows: 3, maxRows: 6 }}
            className="title-system-prompt"
          />
        </label>
      )}
      <GenerationComposer
        label="文案仿写"
        value={requirements}
        onChange={onRequirements}
        working={working}
        disabled={working || !modelReady}
        loading={generating}
        onGenerate={onGenerate}
        options={[
          {
            key: "model",
            label: "文案仿写模型",
            icon: <RobotOutlined />,
            value: modelName,
            content: modelControl,
          },
          {
            key: "count",
            label: "文案生成份数",
            icon: <CopyOutlined />,
            value: `${count} 份`,
            content: (
              <Select
                aria-label="文案生成份数"
                value={count}
                onChange={onCount}
                disabled={working}
                options={[1, 2, 3, 4, 5].map((value) => ({
                  value,
                  label: `${value} 份`,
                }))}
              />
            ),
          },
        ]}
      />
      {feedback}
      <WorkflowResultPanel
        title="仿写文案"
        className="title-result-panel copy-letter-panel"
      >
        <CopyLetter
          original={original}
          originalLabel={originalLabel}
          candidates={candidates}
          selectedIndex={selectedIndex}
          text={selected}
          topics={topics}
          disabled={working}
          onSelect={onSelect}
          onOriginal={onOriginal}
          onText={onText}
          onTopics={onTopics}
        />
      </WorkflowResultPanel>
      <WorkflowActionBar>
        <Button
          type="primary"
          icon={<CheckOutlined />}
          disabled={working || invalid}
          onClick={onConfirm}
        >
          确认
        </Button>
        <Button
          icon={<SendOutlined />}
          disabled={working || invalid}
          onClick={onPublish}
        >
          准备发布
        </Button>
      </WorkflowActionBar>
    </section>
  );
}
