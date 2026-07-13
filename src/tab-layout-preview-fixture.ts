// TabLayoutPreview 预览组件用的示例数据。仅服务于 Layout-Tests 调试组合，
// 不属于正式渲染内容，单独成文件以免和生产渲染代码混在一起。

export interface PreviewTab {
  id: string;
  title: string;
  summary: string;
}

export const previewTabs: PreviewTab[] = [
  {
    id: "preview-1",
    title: "核心能力",
    summary:
      "新系统可拆分复杂任务并协调多个 **Agent** 并行处理，同时共享执行状态、校验关键结果并记录失败原因；遇到长链路工作时，`任务调度器` 会按依赖顺序推进，确保信息完整展示。接近110单位的完整摘要也不会在密集布局中提前截断。",
  },
  {
    id: "preview-2",
    title: "上下文管理",
    summary: "共享任务状态，减少跨步骤的信息损耗。",
  },
  {
    id: "preview-3",
    title: "质量控制",
    summary: "在提交前自动执行 `检查`、测试与评审。",
  },
  {
    id: "preview-4",
    title: "团队协作",
    summary: "让团队成员清楚掌握进度、风险与下一步。",
  },
  {
    id: "preview-5",
    title: "交付闭环",
    summary: "串联编码、验证和提交，形成完整工作流。",
  },
  {
    id: "preview-6",
    title: "风险反馈",
    summary: "失败步骤会保留具体原因与上下文，便于快速定位并安全重试。",
  },
];
