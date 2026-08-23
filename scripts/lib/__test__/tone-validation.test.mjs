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
      { id: "scene-1", subtitle: "消息称，所有付费订阅的使用量将完整重置一次。" },
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
  assert.ok(
    validateTone(anonymous).warnings.some((w) => w.includes("官方")),
  );

  const anonymousReply = reportWith({
    scenes: [{ id: "scene-1", subtitle: "官方回应，修复已在进行。" }],
  });
  assert.ok(
    validateTone(anonymousReply).warnings.some((w) => w.includes("官方")),
  );

  const named = reportWith({
    scenes: [{ id: "scene-1", subtitle: "DeepSeek 官方表示，修复将在本周完成。" }],
  });
  assert.ok(
    !validateTone(named).warnings.some((w) => w.includes("官方")),
  );
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
