# 换 TTS 模型 / 供应商

> 这是 `ai-daily-report` skill 的细节文件。主线在 [`../SKILL.md`](../SKILL.md)。

## 现状

- **唯一适配的 TTS 供应商是 MiniMax。** 项目所有 TTS 代码（`scripts/lib/minimax-tts.mjs`、`scripts/render/generate-tts.mjs`）都是按 MiniMax 的 `t2a_v2` 接口写的。
- RSS 用的 AI 总结模型（`AI_MODEL`）可以随便换，只改 `.env` 即可，**不涉及这里**。
- `TTS_REQUIRE=false` 是 TTS 总开关：会跳过 MiniMax 请求、音频生成和 ffmpeg 音质检测。适合只准备数据、不需要旁白，或暂时没有 MiniMax Key 的场景。
- `REQUIRE_VOICE_QUALITY_FFMPEG=false` 只关闭 ffmpeg 音质检测：MiniMax 仍会生成旁白，适合没装 ffmpeg 但仍要出音频的场景。
- `data.schema.json` 里 `ttsMetadata.provider` 是 `const: "minimax"`（写死的枚举）。
- `generate-tts.mjs` 里 `vol`、`pitch` 是**硬编码**的（`vol: 1`、`pitch: 0`），没有对应环境变量。

## 两种情况

### 情况一：只想换 MiniMax 的模型 / 音色 / 语速

**纯改 `.env`，不动代码。** 改完运行 `bun run tts`；模型、音色或语速参与缓存 hash，变化后会自动重生。只有配置没变但明确要丢弃缓存重做时才用 `bun run tts:force`。

```ini
MINIMAX_TTS_MODEL=speech-2.8-hd        # 模型
MINIMAX_TTS_VOICE_ID=Chinese (Mandarin)_Warm_Girl   # 用户选定的温暖女声
MINIMAX_TTS_SPEED=1.0                   # 新闻按正常语速合成，观众自行倍速
MINIMAX_TTS_LANGUAGE_BOOST=auto         # 中英混读，不固定强制中文
MINIMAX_TTS_TEXT_NORMALIZATION=true     # 中英文数字读法规范化
MINIMAX_TTS_PRONUNCIATION_FILE=config/tts-pronunciation.json
```

其它可调（节流 / 重试 / 尾部静音 / ffmpeg 音质检测开关）见 `.env.example` 的 MiniMax 段。想调 `vol` / `pitch` 必须改 `scripts/render/generate-tts.mjs` 的 `config`。

### 情况二：换成别的 TTS 供应商（阿里、字节、OpenAI TTS 等）

需要修改客户端、编排、缓存参数、Schema 和 `.env`。先确定目标供应商及接口，再改：

| 文件 | 改什么 |
| --- | --- |
| `scripts/lib/minimax-tts.mjs` | HTTP 客户端。这里发的是 MiniMax 专属请求体（`voice_setting`、`audio_setting`、`output_format: "hex"`、`base_resp.status_code`、`extra_info.audio_length`）。新供应商的请求/响应结构多半不一样，要么改这个文件，要么新写一个 `scripts/lib/<provider>-tts.mjs` 并在 `render/generate-tts.mjs` 里换 `createMinimaxClient` 的导入。 |
| `scripts/render/generate-tts.mjs` | `config` 读取新 env（key/endpoint/model/voice/speed 等），按需替换客户端。 |
| `scripts/lib/tts-speech-settings.mjs` / `tts-timeline.mjs` | 更新 `getSceneHash` 的供应商和有效请求参数；写回 `scene.tts` 的供应商也要同步。 |
| `data.schema.json` | `ttsMetadata.provider` 现在是 `const: "minimax"`，改成你的供应商名，或改成 `enum` / `type: "string"` 放开。 |
| `.env` | 加新供应商的 key/endpoint/voice 等，替换掉 `MINIMAX_*`。 |

## 缓存说明（为什么换供应商不用 `--force`）

`scripts/lib/tts-speech-settings.mjs` 的 `getSceneHash` 对供应商、接口、模型、音色、语速、音量、音高、自动语言识别、数字规范化、当前文本命中的发音规则及文本算 SHA-256。更改这些有效参数会使对应缓存失效；新增不相关专名不重生整期。所以：

- 换模型/音色/语速/供应商 → hash 变 → 自动重生，**不用** `--force`。
- `--force` 适合「啥都没变但我怀疑音频有问题想全部重做」的场景。

## 怎么验证改对了

按顺序，从便宜到贵：

```bash
# 1. 不花钱，只打印计划（会走完校验，但不调 API、不改文件）
bun run tts:dry-run

# 2. 付费生成一条独立短试听，附本地保留音高的 1x / 1.5x / 2x 版本，不写当前日报
bun run tts:preview

# 可指定另一个音色对照；默认语速固定 1.0，输出 out/tts-preview/<音色>/
bun run tts:preview -- --voice="Chinese (Mandarin)_IntellectualGirl"

# 3. 文案和试听确定后，才按当前配置重建正式日报音频
bun run tts

# 4. 校验渲染态 data-generate.json 合法
bun run check-data-json:render

# 5. 预览听一下
bun run dev
```

如果 `tts:dry-run` 能跑通且打印的 provider/voice 正确，说明配置读对了；真跑 `tts` 才会验证供应商接口本身。

## 发音与倍速听感

- `config/tts-pronunciation.json` 使用 MiniMax 的 `tone: ["原文/读法"]`，支持括号内 IPA / 带声调拼音。仅在请求层标注，不把音标或谐音写进 `subtitle`；字幕、证据审核仍保留准确原文。读法配置错误必须在付费请求前报错。
- 通用英文描述优先在写稿时准确译为中文；品牌、型号才保留必要英文。语言自动识别与发音词典是辅助，不能宣称保证所有专名读对。
- 按 `tts:preview` 同一短稿比较原速、1.5 倍、2 倍；重点听条件句、年份、金额、版本和中英切换。`atempo` 生成试听变速文件，不把音高跟随速度一起抬高；不同播放器的实际变速处理仍可能不同。
- ffmpeg 音质闸只检查孤立爆音，不能判断漏词、发音准确性或音色偏好。只有实际试听后才能给出听感结论。

## 注意

- 改完 schema 的 provider 后，**旧的 `data-generate.json` 会校验失败**（provider 还是 `minimax`）。跑一次 `bun run tts` 重新生成即可，不用手动改。
- `scripts/lib/minimax-tts.mjs` 里有 RPM 节流（`requestIntervalMs`）和 429 退避，换供应商时按新供应商的限流策略调整，别直接套用 MiniMax 的 2200ms。
