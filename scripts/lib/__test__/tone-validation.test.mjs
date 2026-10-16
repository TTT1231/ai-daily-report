import test from "node:test";
import assert from "node:assert/strict";
import { validateTone } from "../tone-validation.mjs";

// ============================================================================
// validateTone —— supplied 专用 strict-tone 口吻闸
// 阻断：证据媒介叙述模板；警告：匿名归因 + 编辑式填空；可能/意味着等合法表达不报。
// ============================================================================
function reportWith(overrides = {}) {
  return {
    stories: [
      {
        id: "story-1",
        contentTitle: "完整标题",
        tabs: [
          { id: "tab-1", title: "卡一", summary: "**事实一**成立。" },
          { id: "tab-2", title: "卡二", summary: "**事实二**成立。" },
        ],
        scenes: [{ id: "scene-1", subtitle: "一段正常的口播字幕。" }],
        ...overrides,
      },
    ],
  };
}

test("clean report produces no tone errors or warnings", () => {
  assert.deepEqual(validateTone(reportWith()), { errors: [], warnings: [] });
});

test("news narration rejects audit prose but keeps accountable attribution", () => {
  for (const subtitle of [
    "微软支持页说明，从2027年1月起备份方式调整。",
    "Anthropic 发布新模型；官方页面标注发布日期为10月7日。",
    "DeepSeek Monitor Archive 在 Chat 存档中出现多因素验证提示。",
    "开放平台存档也记录到 MFA 设置项更新。",
    "当前可核实证据只确认涉及多个团队。",
    "Cline 提供 `deepseek-v4.1-flash` 模型。",
  ]) {
    const result = validateTone(reportWith({scenes: [{subtitle}]}));
    assert.equal(result.errors.length, 1, subtitle);
  }
  for (const subtitle of [
    "微软计划从2027年1月起调整备份方式。",
    "据 DeepSeek Monitor 监测，DeepSeek 聊天端出现多因素验证入口。",
    "Business Insider 报道，亚马逊多个团队出现新一轮裁员。",
    "Anthropic 扩大受控访问，符合条件的安全人员可以申请。",
    "微软更新支持页面，新增个人账号备份说明。",
    "这项早期试验仍未证明减重或健康获益。",
  ]) assert.deepEqual(validateTone(reportWith({scenes: [{subtitle}]})), {errors: [], warnings: []}, subtitle);
});

test("source-reading incident phrases are caught in both narration and summaries", () => {
  const samples = [
    "Google 的 ERQA 机器人相关问答图表中，Gemini 4 Argon 得 87%；测试标注为 Tool off、样本量 N=400。",
    "Google ERQA 图表中 Argon 得 87%；测试未启用工具，样本量为 400。",
    "OpenCode Go 已列出 Gemini 4 Argon Contributor；文档提示，提示词与回答可能被用于训练未来 Google 模型。",
    "页面说明应用仅创建者本人可见并能安装。",
    "页面标明应用只对创建者可见、可安装，且不经过 Play 审核。",
    "Command Code 把 DeepSeek V4.1 Flash 的活动额度提高到 100 美元，限未来三天，帖子给出的截止日是 10 月 16 日。",
    "帖子把额度调整标为仅限接下来 3 天。",
    "Anthropic 的基准图显示，开发环境拉取最新代码用时由 Git 的 87 秒降至新系统的 3.5 秒。",
    "图表在 9 月 9 日记下 30,401 次合并变更。",
    "性能图中，拉取代码用时从 87 秒降至 3.5 秒。",
    "活动页标出 Remote，时间为 2026 年 11 月 2 日至 10 日。",
    "该模型得分为 87%，测试标注为 Tool off、N=400。",
  ];
  for (const text of samples) {
    const report = reportWith({
      tabs: [{ summary: text }],
      scenes: [{ subtitle: text }],
    });
    const original = JSON.parse(JSON.stringify(report));
    const { errors } = validateTone(report);
    assert.equal(errors.length, 2, text);
    assert.match(errors[0], /^stories\[0\]\.tabs\[0\]\.summary:/);
    assert.match(errors[1], /^stories\[0\]\.scenes\[0\]\.subtitle:/);
    assert.deepEqual(report, original, "validation must not silently rewrite facts");
  }
});

test("Markdown cannot hide source prose in a summary; overlapping phrases report once", () => {
  const { errors } = validateTone(reportWith({
    tabs: [{ summary: "页面**说明** `AI Studio` 应用只对创建者可见；截图显示安装入口。" }],
  }));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /页面说明/);
});

test("score-list and account wording request review without rejecting legitimate attribution", () => {
  for (const text of [
    "SimpleQA Verified 榜单中，Argon 为 76.0%±1.4，GPT-6 Astra 为 75.6%±1.4；误差范围重叠。",
    "Command Code 官方账号称，DeepSeek V4.1 Flash 的活动使用额度提高至 100 美元。",
  ]) {
    const { errors, warnings } = validateTone(reportWith({
      tabs: [{ summary: text }], scenes: [{ subtitle: text }],
    }));
    assert.deepEqual(errors, []);
    assert.equal(warnings.length, 2, text);
    assert.match(warnings[0], /^stories\[0\]\.tabs\[0\]\.summary:/);
    assert.match(warnings[1], /^stories\[0\]\.scenes\[0\]\.subtitle:/);
  }
});

test("direct news copy preserves evaluation conditions, uncertainty and actual source events", () => {
  const samples = [
    "在 Google 的 ERQA 评测中，Gemini 4 Argon 得分为 87%。测试未启用工具，样本量为 400。",
    "在 SimpleQA Verified 评测中，Argon 得分为 76.0%±1.4，GPT-6 Astra 为 75.6%±1.4。两者误差区间重叠。",
    "OpenCode Go 将 Gemini 4 Argon Contributor 加入模型目录。使用该选项时，提示词和回答可能用于训练未来的 Google 模型。",
    "这些应用仅创建者本人可见、可安装，且不经过 Play 审核。",
    "Command Code 将 DeepSeek V4.1 Flash 的活动额度提高至 100 美元，活动截至 10 月 16 日。",
    "在 Anthropic 自家的测试中，新系统将开发环境拉取最新代码的用时从 Git 的 87 秒缩短到 3.5 秒。",
    "据某机构监测，模型目录新增一个型号；是否已经开放调用尚未确认。",
    "Anthropic 预计，小型模型可能在数月后具备自主复制能力。",
    "自称攻击者声称使用了弱口令，丹麦管理方尚未证实这一说法。",
    "OpenCode Go 更新了使用文档，删除了旧版模型的配置示例。",
    "该模型在榜单中排名第二，榜单新增了三款模型。",
    "公司官方账号被盗，随后恢复访问并删除了冒充公告。",
    "该功能可以从图表中提取数据，识别图片中的文字。",
  ];
  for (const text of samples) {
    assert.deepEqual(validateTone(reportWith({
      tabs: [{ summary: text }], scenes: [{ subtitle: text }],
    })), { errors: [], warnings: [] }, text);
  }
});

test("tone checks skip malformed shapes while preserving healthy sibling paths", () => {
  const report = reportWith({
    tabs: [null, { summary: "截图显示事实成立。" }],
    scenes: [null, { subtitle: "配图展示更新。" }],
  });
  report.stories.unshift(null, { tabs: "invalid", scenes: "invalid" });
  report.intro = [];
  const { errors } = validateTone(report);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /^stories\[2\]\.tabs\[1\]\.summary:/);
  assert.match(errors[1], /^stories\[2\]\.scenes\[1\]\.subtitle:/);
  for (const invalid of [null, [], "invalid", { stories: "invalid" }]) {
    assert.deepEqual(validateTone(invalid), { errors: [], warnings: [] });
  }
});

// ---------- 阻断：证据媒介叙述 ----------
test("medium-reference narration in a subtitle is a blocking error with scene path", () => {
  const r = reportWith({
    scenes: [{ id: "scene-1", subtitle: "截图显示，额度将在月底重置。" }],
  });
  const { errors, warnings } = validateTone(r);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^stories\[0\]\.scenes\[0\]\.subtitle: /);
  assert.match(errors[0], /截图显示/);
  assert.deepEqual(warnings, []);
});

test("medium-reference phrasing in a tab summary is a blocking error with tab path", () => {
  const r = reportWith();
  r.stories[0].tabs[1].summary = "配图展示企业展台，主题聚焦 AI 投入。";
  const { errors } = validateTone(r);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^stories\[0\]\.tabs\[1\]\.summary: /);
  assert.match(errors[0], /配图展示/);
});

test("medium-reference phrasing in contentTitle and introTitle is caught", () => {
  const r = reportWith({
    contentTitle: "画面展示新模型发布",
    introTitle: "请看截图了解详情",
  });
  const { errors } = validateTone(r);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /^stories\[0\]\.contentTitle: /);
  assert.match(errors[1], /^stories\[0\]\.introTitle: /);
});

test("each blocked field reports one medium error even with multiple templates", () => {
  const r = reportWith({
    scenes: [
      { id: "scene-1", subtitle: "配图展示展台，另一张截图标题称涨价 15%。" },
    ],
  });
  const { errors } = validateTone(r);
  assert.equal(errors.length, 1);
});

test("known bad variants from the incident sample are all blocked", () => {
  const samples = [
    "截图显示，企业的 Token 消耗记录正在被纳入贷款评估。",
    "另一张更新截图显示，xhigh 档约为 40/100。",
    "配图展示一名用户独处时使用设备。",
    "截图标题称，内存成本飙升将推动服务器涨价。",
    "更新截图标题与正文称，旧版可被越狱。",
    "画面展示全球 AI 基础设施宣传屏。",
  ];
  for (const subtitle of samples) {
    const r = reportWith({ scenes: [{ id: "scene-1", subtitle }] });
    assert.ok(
      validateTone(r).errors.length === 1,
      `expected a blocking error for: ${subtitle}`,
    );
  }
});

// ---------- 阻断：常见规避变体 ----------
test("medium-narration evasion variants are blocked", () => {
  const samples = [
    "从截图中可以看到两个档位的思考值。",
    "从图中可见完整的限定条款。",
    "如图所示，额度将在月底重置。",
    "这张截图来自 DeepSeek 官方通知。",
    "截图中列出了全部扣费明细。",
    "上图展示新档位对比，下图显示计费规则。",
  ];
  for (const subtitle of samples) {
    const r = reportWith({ scenes: [{ id: "scene-1", subtitle }] });
    assert.ok(
      validateTone(r).errors.length === 1,
      `expected a blocking error for: ${subtitle}`,
    );
  }
});

test("medium-reference phrasing in a tab title is caught with tab path", () => {
  const r = reportWith();
  r.stories[0].tabs[0].title = "上图显示的规则";
  const { errors } = validateTone(r);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^stories\[0\]\.tabs\[0\]\.title: /);
});

// ---------- 复合词不得误报 ----------
test("compound words containing target substrings are not flagged", () => {
  const samples = [
    "该图书馆将向公众免费开放。",
    "该图像模型采用全新架构，将开源权重。",
    "新模型进入欧洲版图中，份额持续提升。",
    "支持比如图片和视频等多模态输入。",
  ];
  for (const subtitle of samples) {
    const r = reportWith({ scenes: [{ id: "scene-1", subtitle }] });
    assert.deepEqual(
      validateTone(r),
      { errors: [], warnings: [] },
      `unexpected findings for: ${subtitle}`,
    );
  }
});

// ---------- 警告：匿名归因 ----------
test("anonymous attribution warns without blocking", () => {
  const r = reportWith({
    scenes: [
      {
        id: "scene-1",
        subtitle: "消息称，所有付费订阅的使用量将完整重置一次。",
      },
    ],
  });
  const { errors, warnings } = validateTone(r);
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /消息称/);
});

test("clause-start 官方表示/回应 warns, named-subject 官方表示 does not", () => {
  const anonymous = reportWith({
    scenes: [{ id: "scene-1", subtitle: "官方表示，修复将在本周完成。" }],
  });
  assert.ok(validateTone(anonymous).warnings.some((w) => w.includes("官方")));

  const anonymousReply = reportWith({
    scenes: [{ id: "scene-1", subtitle: "官方回应，修复已在进行。" }],
  });
  assert.ok(
    validateTone(anonymousReply).warnings.some((w) => w.includes("官方")),
  );

  const named = reportWith({
    scenes: [
      { id: "scene-1", subtitle: "DeepSeek 官方表示，修复将在本周完成。" },
    ],
  });
  assert.ok(!validateTone(named).warnings.some((w) => w.includes("官方")));
});

// ---------- 警告：评价/建议/免责填空 ----------
test("editorial filler phrases warn without blocking", () => {
  const cases = [
    "用户和开发者**应等待修复**并保持关注。",
    "这不代表长期配额规则已经改变。",
    "用户仍应留意后续正式的额度规则说明。",
    "建议避免把敏感内容交给旧模型处理。",
    "如果月底前未修复，将影响部分订阅用户。",
  ];
  for (const summary of cases) {
    const r = reportWith();
    r.stories[0].tabs[0].summary = summary;
    const { errors, warnings } = validateTone(r);
    assert.deepEqual(errors, [], `unexpected blocking error for: ${summary}`);
    assert.ok(warnings.length > 0, `expected a warning for: ${summary}`);
  }
});

// ---------- 合法表达不得误报 ----------
test("legal impact wording is never flagged", () => {
  const r = reportWith({
    scenes: [
      {
        id: "scene-1",
        subtitle: "自研芯片可能影响未来推理成本，意味着供应格局或将调整。",
      },
    ],
  });
  r.stories[0].tabs[1].summary = "研究团队发现，新机制**将影响推理速度**。";
  assert.deepEqual(validateTone(r), { errors: [], warnings: [] });
});

// ---------- intro / outro 存在时同样覆盖 ----------
test("intro and outro text fields are checked when present", () => {
  const r = reportWith();
  r.intro = {
    contentTitle: "今日概览",
    tabs: [{ id: "t1", summary: "**概览**成立。" }],
    scenes: [{ id: "i1", subtitle: "图片显示今日重点。" }],
  };
  const { errors } = validateTone(r);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^intro\.scenes\[0\]\.subtitle: /);
});
