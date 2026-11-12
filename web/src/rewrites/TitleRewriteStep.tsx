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
import { WorkflowActionBar, WorkflowResultPanel } from "./WorkflowControls";
import TitleIdeaWheel from "./TitleIdeaWheel";
import RewriteSourceNote from "./RewriteSourceNote";
import "./title-rewrite.css";

export default function TitleRewriteStep({
  reference,
  assets,
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
  candidates,
  limit,
  feedback,
  sourceControl,
  generationKey,
  customTitle,
  customSelected,
  canGenerate,
  onEditCandidate,
  onCustomEdit,
  onCustomSelect,
  onRequirements,
  onCount,
  onGenerate,
  onSelect,
  onConfirm,
  onPublish,
}: {
  reference: { title: string; body: string; topics: string[] };
  assets: Asset[];
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
  candidates: string[];
  limit: number;
  feedback: ReactNode;
  sourceControl?: ReactNode;
  generationKey: string;
  customTitle: string;
  customSelected: boolean;
  canGenerate: boolean;
  onEditCandidate: (index: number, text: string) => void;
  onCustomEdit: (text: string) => void;
  onCustomSelect: (selected: boolean) => void;
  onRequirements: (text: string) => void;
  onCount: (count: number) => void;
  onGenerate: () => void;
  onSelect: (index: number | null) => void;
  onConfirm: () => void;
  onPublish: () => void;
}) {
  const invalid =
    (!customSelected && selectedIndex < 0) ||
    !selected.trim() ||
    Array.from(selected.trim()).length > limit;
  return (
    <section
      className="workflow-panel title-rewrite-panel"
      aria-label="标题仿写"
    >
      {sourceControl ?? (
        <RewriteSourceNote reference={reference} assets={assets} />
      )}
      {promptControl || (
        <label className="workflow-field">
          <span>系统提示词</span>
          <Input.TextArea
            aria-label="系统提示词"
            readOnly
            value={systemPrompt}
            autoSize={{ minRows: 3, maxRows: 6 }}
            className="title-system-prompt"
          />
        </label>
      )}
      <GenerationComposer
        label="标题仿写"
        value={requirements}
        onChange={onRequirements}
        working={working}
        disabled={working || !modelReady || !canGenerate}
        loading={generating}
        onGenerate={onGenerate}
        options={[
          {
            key: "model",
            label: "标题仿写模型",
            icon: <RobotOutlined />,
            value: modelName,
            content: modelControl,
          },
          {
            key: "count",
            label: "标题生成数量",
            icon: <CopyOutlined />,
            value: `${count} 个`,
            content: (
              <Select
                aria-label="标题生成数量"
                value={count}
                onChange={onCount}
                disabled={working}
                options={[1, 3, 5].map((value) => ({
                  value,
                  label: `${value} 个`,
                }))}
              />
            ),
          },
        ]}
      />
      {feedback}
      <WorkflowResultPanel
        title="仿写标题"
        className="title-result-panel title-wheel-panel"
      >
        <TitleIdeaWheel
          candidates={candidates}
          generationKey={generationKey}
          customTitle={customTitle}
          customSelected={customSelected}
          selectedIndex={selectedIndex}
          disabled={working}
          limit={limit}
          onSelect={onSelect}
          onEdit={onEditCandidate}
          onCustomEdit={onCustomEdit}
          onCustomSelect={onCustomSelect}
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
