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

**纯改 `.env`，不动代码。** 改完 `bun run tts:force`（强制重生，因为 hash 会变，`--force` 更省心）或 `bun run tts`（按 hash 自动判断）。

```ini
MINIMAX_TTS_MODEL=speech-2.8-hd        # 模型
MINIMAX_TTS_VOICE_ID=Chinese (Mandarin)_Warm_Girl   # 音色
MINIMAX_TTS_SPEED=1.18                  # 0.5 ~ 2
```

其它可调（节流 / 重试 / 尾部静音 / ffmpeg 音质检测开关）见 `.env.example` 的 MiniMax 段。想调 `vol` / `pitch` 必须改 `scripts/render/generate-tts.mjs` 的 `config`。

### 情况二：换成别的 TTS 供应商（阿里、字节、OpenAI TTS 等）

需要改**三个文件 + `.env`**。动手前先跟用户确认要换成哪家、用什么接口，再改：

| 文件 | 改什么 |
| --- | --- |
| `scripts/lib/minimax-tts.mjs` | HTTP 客户端。这里发的是 MiniMax 专属请求体（`voice_setting`、`audio_setting`、`output_format: "hex"`、`base_resp.status_code`、`extra_info.audio_length`）。新供应商的请求/响应结构多半不一样，要么改这个文件，要么新写一个 `scripts/lib/<provider>-tts.mjs` 并在 `render/generate-tts.mjs` 里换 `createMinimaxClient` 的导入。 |
| `scripts/render/generate-tts.mjs` | 1) `config` 里读你的新 env（key/endpoint/model/voice/speed 等）。2) `getSceneHash` 里把 `provider: "minimax"` 改成新名字、把参与 hash 的字段对齐。3) 写回 `scene.tts` 的 `provider` 也改。4) `vol`/`pitch` 若新供应商要支持，从硬编码改成 env。 |
| `data.schema.json` | `ttsMetadata.provider` 现在是 `const: "minimax"`，改成你的供应商名，或改成 `enum` / `type: "string"` 放开。 |
| `.env` | 加新供应商的 key/endpoint/voice 等，替换掉 `MINIMAX_*`。 |

## 缓存说明（为什么换供应商不用 `--force`）

`getSceneHash` 对 `provider + endpoint + model + voiceId + speed + vol + pitch + text` 算 SHA-256（见 `generate-tts.mjs` 的 `getSceneHash`）。只要这些变了，hash 就变，旧的缓存音频会被判为不可复用自动重生。所以：

- 换模型/音色/语速/供应商 → hash 变 → 自动重生，**不用** `--force`。
- `--force` 适合「啥都没变但我怀疑音频有问题想全部重做」的场景。

## 怎么验证改对了

按顺序，从便宜到贵：

```bash
# 1. 不花钱，只打印计划（会走完校验，但不调 API、不改文件）
bun run tts:dry-run

# 2. 真生成一个 scene 试试（确认接口通、参数对）
bun run tts

# 3. 校验渲染态 data-generate.json 合法
bun run check-data-json:render

# 4. 预览听一下
bun run dev
```

如果 `tts:dry-run` 能跑通且打印的 provider/voice 正确，说明配置读对了；真跑 `tts` 才会验证供应商接口本身。

## 注意

- 改完 schema 的 provider 后，**旧的 `data-generate.json` 会校验失败**（provider 还是 `minimax`）。跑一次 `bun run tts` 重新生成即可，不用手动改。
- `scripts/lib/minimax-tts.mjs` 里有 RPM 节流（`requestIntervalMs`）和 429 退避，换供应商时按新供应商的限流策略调整，别直接套用 MiniMax 的 2200ms。
