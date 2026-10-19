// Keep these explicit templates aligned with ingest/news_copy.go. Both paths
// exercise test/fixtures/news-copy-cases.json; this is not a semantic fact check.
const rules = [
  {
    code: "claim-classification",
    pattern: /属于[^，,。！？；;：:\n]{0,12}(?:预测|推测|推断|观点|判断|说法|表述)(?:[，,。！？；;]|$)/u,
    guidance: "把预测或观点写进事实句：谁预计何时发生什么；不要朗读事实类别或审核结论。",
  },
  {
    code: "source-as-actor",
    pattern: /(?:项目仓库|代码仓库|仓库|README|自述文件|发布页)(?:中)?(?:(?:将|把)(?:其|它|该(?:项目|框架|模型|工具|系统|软件))?(?:描述|介绍|定位)为|(?:描述|介绍|说明|声称|称|展示|显示))/u,
    guidance: "用项目、功能或实际行为方作主语，直接解释能力与条件；仓库和发布页的位置留在证据记录。",
  },
  {
    code: "attribution-stack",
    pattern: /(?:报道|报导)[，,:：]\s*[^，,。！？；;：:\n]{1,24}(?:称|表示|声称|透露)(?:[，,:：]|\s|使用|用|已|将|会|可|其|该|这|有|在|能|现有|目前|新)/u,
    guidance: "合并转述链，只保留影响理解的一层归因；不能把媒体改成创作者，也不能把自述改成独立证实。",
  },
  {
    code: "supplementary-preface",
    pattern: /(?:官方|公司|团队|厂商|开发者)(?:又|还|随后)?补充说明[，,:：]/u,
    guidance: "直接讲补充的升级、资格或使用规则；需要报道更正或否认时明确说更正了什么、否认了什么。",
  },
  {
    code: "evidence-absence",
    pattern: /(?:报道|原文|来源|(?:现有|已知)(?:资料|证据))(?:中)?(?:未|没有)(?:显示|证实|确认|提及|提到|表明)/u,
    guidance: "把未采用主张及缺证原因留在台账，成稿讲有证据的事件；有新闻价值的否认、未证实结果仍须自然保留。",
  },
  {
    code: "product-policy-preface",
    pattern: /(?:^|[。！？；，,])\s*[\p{L}\p{N}.+&/ -]{1,40}(?:称|表示)[，,:：]?\s*(?:现有|新版|新版本|用户|V[0-9])[^，,。！？；;：:\n]{0,48}(?:升级|免费|开放|支持|新增|功能|候补)/u,
    guidance: "已核实的产品功能和用户权益直接讲规则、对象和条件，不套公司发言前缀；争议或自测须保留具体归因。",
  },
];

export function newsCopyTemplateIssues(text) {
  const plain = text.replace(/\*\*|`/gu, "");
  return rules.flatMap(({code, pattern, guidance}) => {
    const match = plain.match(pattern);
    return match ? [{code, match: match[0], guidance}] : [];
  });
}

// All Raw authoring paths share this gate, including direct TTS. Strict-tone
// adds the supplied-source medium checks; it is not required for these rules.
export function validateNewsCopy(report) {
  const errors = [];
  const stories = Array.isArray(report?.stories) ? report.stories : [];
  for (const [storyIndex, story] of stories.entries()) {
    for (const [collection, field] of [["tabs", "summary"], ["scenes", "subtitle"]]) {
      const entries = Array.isArray(story?.[collection]) ? story[collection] : [];
      for (const [index, entry] of entries.entries()) {
        if (typeof entry?.[field] !== "string") continue;
        const path = `stories[${storyIndex}].${collection}[${index}].${field}`;
        for (const issue of newsCopyTemplateIssues(entry[field])) {
          errors.push(`${path}: news-copy template [${issue.code}] ("${issue.match}"); ${issue.guidance}`);
        }
      }
    }
  }
  return errors;
}
