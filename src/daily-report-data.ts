export type DailyTab = {
  id: string;
  title: string;
  summary: string;
};

export type DailyScene = {
  durationMs: number;
  activeTab: string;
  subtitle: string;
  overlay?: {
    src: string;
    caption: string;
  };
};

export type DailyStory = {
  id: string;
  topTitle: string;
  bottomTitle: string;
  contentTitle: string;
  tabs: DailyTab[];
  scenes: DailyScene[];
};

export type DailyReport = {
  date: string;
  label: string;
  stories: DailyStory[];
};

export const dailyReport: DailyReport = {
  date: "2026-06-10",
  label: "AI DAILY",
  stories: [
    {
      id: "intro",
      topTitle: "Intro",
      bottomTitle: "Intro",
      contentTitle: "2026-06-10 AI 日报概览",
      tabs: [
        {id: "headline", title: "今日要闻", summary: "关注 **GPT-5.6** 候选版本测试动态。"},
        {id: "development", title: "开发生态", summary: "追踪 `Mythos`、`Trae Work` 与 AI 开放平台。"},
        {id: "industry", title: "行业动态", summary: "观察 **DeepSeek** 的开放与工程化进展。"},
      ],
      scenes: [
        {
          durationMs: 4500,
          activeTab: "headline",
          subtitle: "欢迎收看今天的 AI 日报，先快速浏览今日重点。",
        },
      ],
    },
    {
      id: "gpt-5-6",
      topTitle: "要闻",
      bottomTitle: "GPT-5.6",
      contentTitle: "据称 OpenAI GPT-5.6 候选版本短暂现身测试平台后移除",
      tabs: [
        {
          id: "capability",
          title: "核心能力",
          summary: "强化 **代码与推理能力**，候选模型进入 `内部测试` 阶段。",
        },
        {
          id: "performance",
          title: "性能提升",
          summary: "**响应速度** 与复杂任务稳定性可能得到进一步改善。",
        },
        {
          id: "impact",
          title: "开发者影响",
          summary: "未来可能通过 `API` 开放，并影响现有开发工作流。",
        },
        {
          id: "foundation",
          title: "底层能力",
          summary: "模型基础能力与 `工具调用` 链路得到持续增强。",
        },
        {
          id: "training",
          title: "训练方法",
          summary: "引入新的 **评测与训练机制**，提升复杂任务稳定性。",
        },
        {
          id: "ecosystem",
          title: "生态计划",
          summary: "围绕 `API`、开发工具与 **合作生态** 逐步开放。",
        },
      ],
      scenes: [
        {
          durationMs: 4000,
          activeTab: "capability",
          subtitle: "GPT-5.6 将进一步强化代码与推理能力。",
        },
        {
          durationMs: 5000,
          activeTab: "performance",
          subtitle: "测试平台曾短暂出现 GPT-5.6 候选版本。",
          overlay: {
            src: "gpt56-source.svg",
            caption: "测试平台原始截图",
          },
        },
        {
          durationMs: 3500,
          activeTab: "impact",
          subtitle: "该模型未来可能通过 API 向开发者开放。",
        },
      ],
    },
    {
      id: "mythos",
      topTitle: "开发生态",
      bottomTitle: "Mythos",
      contentTitle: "Mythos 展示面向复杂项目的多智能体协作开发流程",
      tabs: [
        {id: "workflow", title: "协作流程", summary: "多个 Agent 围绕同一代码库分工协作。"},
        {id: "context", title: "上下文", summary: "共享任务状态，减少跨步骤的信息损耗。"},
        {id: "review", title: "质量控制", summary: "在提交前自动执行 **检查与评审**。"},
      ],
      scenes: [
        {durationMs: 4500, activeTab: "workflow", subtitle: "Mythos 将复杂开发任务拆分给多个智能体协作。"},
        {durationMs: 3500, activeTab: "review", subtitle: "自动检查与评审让协作结果更容易落地。"},
      ],
    },
    {
      id: "trae-work",
      topTitle: "开发生态",
      bottomTitle: "Trae Work",
      contentTitle: "Trae Work 推出面向团队的 AI 编程任务协作能力",
      tabs: [
        {id: "task", title: "任务驱动", summary: "从需求描述直接组织编码与验证步骤。"},
        {id: "team", title: "团队协作", summary: "任务进度与产出在团队内保持可见。"},
        {id: "delivery", title: "交付闭环", summary: "串联 `编码`、测试与提交环节。"},
      ],
      scenes: [
        {durationMs: 4000, activeTab: "task", subtitle: "Trae Work 从任务出发组织完整开发流程。"},
        {durationMs: 4000, activeTab: "delivery", subtitle: "编码、测试与交付被串联为统一闭环。"},
      ],
    },
    {
      id: "open-platform",
      topTitle: "开发生态",
      bottomTitle: "AI 开放平台",
      contentTitle: "AI 开放平台加速模型、工具与企业工作流连接",
      tabs: [
        {id: "model", title: "模型接入", summary: "统一接口降低多模型接入成本。"},
        {id: "tool", title: "工具连接", summary: "通过受控工具调用扩展模型能力。"},
        {id: "enterprise", title: "企业落地", summary: "权限、审计与稳定性成为关键。"},
      ],
      scenes: [
        {durationMs: 3500, activeTab: "model", subtitle: "开放平台正在降低多模型接入门槛。"},
        {durationMs: 3500, activeTab: "enterprise", subtitle: "企业落地更关注权限、审计与稳定性。"},
      ],
    },
    {
      id: "deepseek",
      topTitle: "行业动态",
      bottomTitle: "DeepSeek",
      contentTitle: "DeepSeek 持续推动高性能模型的开放与工程化应用",
      tabs: [
        {id: "efficiency", title: "推理效率", summary: "以更优资源消耗处理复杂任务。"},
        {id: "open", title: "开放生态", summary: "开放能力推动社区快速验证与迭代。"},
        {id: "industry", title: "行业影响", summary: "高性能模型加速进入实际业务场景。"},
      ],
      scenes: [
        {durationMs: 4000, activeTab: "efficiency", subtitle: "推理效率仍是模型工程化竞争的核心。"},
        {durationMs: 4000, activeTab: "open", subtitle: "开放生态让新能力更快进入真实应用。"},
      ],
    },
    {
      id: "outro",
      topTitle: "Outro",
      bottomTitle: "Outro",
      contentTitle: "今天的 AI 日报到这里",
      tabs: [
        {id: "recap", title: "今日回顾", summary: "模型发布、开发生态与行业动态均有新的进展。"},
        {id: "focus", title: "持续关注", summary: "继续关注 **模型能力** 与 `开发者工具` 的变化。"},
        {id: "ending", title: "明日再见", summary: "感谢观看，我们将在下一期继续更新。"},
      ],
      scenes: [
        {
          durationMs: 3500,
          activeTab: "ending",
          subtitle: "今天的 AI 日报播送完毕，我们明天见。",
        },
      ],
    },
  ],
};
