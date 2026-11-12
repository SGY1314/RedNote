export const hookOptions = [
  {
    value: "auto",
    label: "自动选择（推荐）",
    description: "根据内容和读者选择合适的开头，默认自然表达。",
  },
  {
    value: "pain",
    label: "痛点共鸣",
    description: "从读者可能遇到的具体问题切入，不制造焦虑。",
  },
  {
    value: "benefit",
    label: "明确收益",
    description: "说明本文能提供的知识或方法，避免夸大效果。",
  },
  {
    value: "question",
    label: "提问悬念",
    description: "用具体问题引出正文，并在文中回答。",
  },
  {
    value: "contrast",
    label: "反差切入",
    description: "用有依据的差异或对比引出观点。",
  },
  {
    value: "story",
    label: "故事切入",
    description: "依据你提供的真实经历或场景展开；没有依据时自然直述。",
  },
  {
    value: "plain",
    label: "自然直述",
    description: "直接进入主题，适合知识说明和日常记录。",
  },
];
export const hookLabel = (hook?: string) =>
  hookOptions.find((option) => option.value === hook)?.label || "未记录";
