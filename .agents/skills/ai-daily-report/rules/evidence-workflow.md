# 证据生产与增量审核

本文件负责取证到导出的执行顺序；事实选型、口播和来源质量仍由
[`supplied-source-mode.md`](./supplied-source-mode.md) 负责。

## 网页取证：先定位事实区域，一次批量处理

先用 agent-browser 打开原文，通过正文文本或 scoped snapshot 定位所有需要的事实区域。
不要靠连续滚动截图寻找段落；不要默认等待广告请求永远不停的 networkidle，等待目标正文即可。
已有来源图片可直接采用，不需要为运行此工具再打开网页。

确定目标 CSS selector 后，在本次 OS 临时工作区写 `capture.json`。selector 和隐藏目标必须来自当前页面观察，不能猜测；`expectedText` 是目标区域里实际存在的事实文本。

```json
{
  "url": "https://example.com/release",
  "hideSelectors": ["#observed-ad", "#observed-cookie-banner"],
  "targets": [
    {"fact": "SIM 支持组合", "selector": "#sim-specification", "expectedText": ["nano-SIM", "eSIM"]}
  ]
}
```

```bash
bun run evidence:capture -- --plan=<temp>/capture.json --session=<当前页面的agent-browser会话>
```

命令核对当前 URL、目标唯一性和事实文本，批量隐藏指定干扰元素，截取目标元素后恢复页面样式。它不改正文、不拼装摘录卡、不添加伪造来源标识。若隐藏目标含所需事实或是正文祖先，会直接拒绝。每个目标保存到 `capture-ledger.json`，包含原文 URL、事实、selector、截图哈希、次数和耗时。

- 再运行会复用已捕获且文件哈希未变的结果；`captured` 只表示正文文本在 DOM 中匹配且 PNG 已保存，不能证明文字实际画进截图。`suspect-blank` 表示 PNG 的信息量异常低，保留原图核对，不能当作已取得证据。
- 不合格时先查明原因，修正定位/隐藏范围后显式重试：加 `--retry-fact="SIM 支持组合" --reason="具体问题及修正"`。
- **每个事实区域一次初始元素截图、最多一次纠正**；同页不同事实区域独立计数。改文件名、换会话和恢复上下文不会清空工作区中的计数。相同像素会标记 `unchanged`，不再重复目视或试截。
- 若已在原文页面核对正文，而元素截图空白、裁掉发布方，或整页截图把正文缩成不可读的小块，在同一页面滚动到该段，等待文字实际显示，再用 agent-browser 的普通视口截图（`screenshot <path>`，不传元素 selector）取一张可见画面；必要时从这张原图忠实裁剪，保留发布方或文章身份与关键事实。记录原文 URL、视口原图和最终裁剪图。此回退是换取图方法，不重置或继续消耗该事实的元素截图预算；不要为同一事实无限试截。
- 元素截图两次仍不合格且视口回退也失败时，记录为「已核实原文，取证技术受阻」，报告原文链接、失败图片和 ledger 路径；不要称来源不可信，也不要无声删除用户选定的 Story。此类来源在 TTS/渲染前作为生产阻断说明。只有原文及其它可信材料本身无法支撑核心事实时，才按来源不足排除 Story。不重命名同一事实来重置预算，也不把一句话拆成多个假“事实区域”。
- 缺乏合适元素容器时，使用已有截图做一次保留原文上下文的精确裁剪；不要为裁剪再试截整页。截图工具不负责判断广告或语义，未确认的选择器不能批量隐藏。

## 合格边界

判定对象是最终证据区域，不是整个网站。关键事实、限定条件和出处必须可见、可读；广告/推荐不得进入证据区域或遮挡事实。小型来源导航、作者行、日期、官方产品抬头属于可保留上下文，不因其不是正文就反复清理。不能为了保留网站 Logo 带入整块导航，更不能为了清理页面裁掉证据事实。纯文字证据应保留可辨识的出处；已有作者/来源行足够时不强求再补完整品牌页头。

## 审核分为素材与口播映射

写 Raw 后、TTS 前执行：

```bash
bun run check-data-json --strict-tone
bun run check-evidence
bun run evidence:prepare-review
```

最后一条生成/刷新 `data-scheme/evidence-preflight.json`，不改 Raw 或 Generated：

- `assets` 按文件内容哈希去重，逐张填写原始 `source` URL/本地来源路径，目视确认 `upright`、`readable`、`sourceIdentifiable`、`unobstructed`。同图多段不用重复判断图片本身。
- 已在取证阶段目视确认且最终文件哈希未变的结果直接记录，无需再打开一次图片；最终裁剪、替换内容或新口播映射需要重新检查。
- `scenes` 始终逐段列出完整口播、新闻标题和图片哈希。逐项核对后填写 `supportsSubtitle` 和 `supportNotes`，写清对应的可见事实/段落位置；不能只写“通过”或复述字幕充当证据。**原文有、最终截图没有的事实不能判通过。**
- 所有新检查默认 `null`，不得批量自动填 `true`。缺证据记 `false`；查完本批所有问题后统一修图或改口播，再刷新。
- 图片换内容：该素材及依赖它的全部口播审核失效。只改一句口播/标题：对应映射失效，未改素材的检查保留。TTS 时间线和图标变化不会重置事实审核。替换截图后必须重新核对全部关联口播。
- 同图可以支持一段或多段讲解；Scene 不与 Tab 一一对应。两句仅换说法、没有新增事实或必要解释时合并，不能为了 Tab 下限拆重复口播。

```bash
bun run evidence:check-preflight
# 通过后才进行 TTS 和可见图标生成
```

此检查核对审核记录是否完整、是否与当前图片/口播一致，不会自动识别事实真伪。

## 排版预览与导出

Generated 和可见图标就绪后，多模态 supplied-source 首次导出 MP4 前先用同一批量 PNG 流程预览全部 Scene（含 Intro/Outro），把可读性、来源标识、字幕与画面的对应关系和遮挡问题在编码前集中修完。局部修改只预览受影响的 Scene：

```bash
bun run evidence:preview -- --all-scenes
# 局部修复只复查修改涉及的具体 Scene：
bun run evidence:preview -- --scenes=<scene-id>,<scene-id>
```

不带参数时每个 Story 的相同图片/scale 只出一个代表帧，供日常排版排错；`--all-scenes` 和显式 Scene 选择逐段保留。整批只打包一次、共用一个浏览器，不合成音频、不编码 MP4。输出到 OS 临时目录，`manifest.json` 给出帧路径、完整口播、耗时。原素材明显的广告直接修正，不需要预览来证明。

`bun run render:mp4` 现在会先检查数据、证据文件、**可见图标和当前证据预检记录**，未审核、失败或已过期的事实映射均不允许进入编码。不要用裸 `remotion render` 绕过命令链。

成片继续使用 `evidence:frames` 和 `check-evidence-review`；PNG 预览不能冒充成片审核。首次成片审完所有抽帧；发现问题先收集本轮全部失败项，再集中修复、刷新预检和派生数据、局部 PNG 验证，之后统一重渲染。重渲染后仍全量抽帧，传入上一轮 `--previous-manifest=<旧 manifest.json>`；只有 Story/Scene、口播、overlay 路径和抽帧像素哈希均不变，且旧帧文件与旧审核记录仍匹配时，才继承该帧的五项通过结果。只目视复查新审核表中的待审帧，最后的 checker 仍核对当前 MP4、Generated 与全部新抽帧哈希。保留旧抽帧目录到继承和新审核完成。

用户要求不渲染 MP4 时遵从其范围；修改流程的测试使用隔离 fixture，不擅自重做当期内容。阶段计时记录在本次临时工作区，重复阶段报告次数与累计耗时，不只报最后一次 render。
