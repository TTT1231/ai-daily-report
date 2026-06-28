import {existsSync} from "node:fs";

// TTS scene-loop 的纯装配逻辑，从 generate-tts.mjs 抽出以便单测覆盖「整条 loop
// 装配出的时间线自洽」契约，而无需调用 MiniMax / 触网 / 落盘事务。
// config 形状与 generate-tts.mjs 的 config 对象一致：model/voiceId/speed/vol/pitch/tailPaddingMs。

/**
 * 计算一个 scene 的 audioSrc/timing/tts 字段，以及推进后的时间线游标。
 *
 * durationMs = audioLengthMs + tailPaddingMs（与 validateReport 的 tts 不变量对齐）；
 * nextCursorMs = cursorMs + durationMs，供 loop 累计下一个 scene 的 startMs，保证整条
 * 时间线连续无 gap。audioLengthMs 是唯一来自外部的输入——钉住它，整条 generated
 * 结构（durationMs / startMs / videoStartMs）就被完全确定。
 */
export function sceneAudioFields(sceneId, hash, audioLengthMs, cursorMs, config) {
  const durationMs = audioLengthMs + config.tailPaddingMs;
  return {
    audioSrc: `audio/${sceneId}.mp3`,
    timing: {startMs: cursorMs, durationMs},
    tts: {
      provider: "minimax",
      hash,
      model: config.model,
      voiceId: config.voiceId,
      speed: config.speed,
      vol: config.vol,
      pitch: config.pitch,
      audioLengthMs,
      tailPaddingMs: config.tailPaddingMs,
    },
    nextCursorMs: cursorMs + durationMs,
  };
}

/**
 * 判断一个 scene 是否可复用上一轮已合成且仍有效的音频（generate-tts loop 的缓存命中分支）。
 * 命中条件：非强制重生、音频文件存在、cached 音频路径匹配、字幕/参数哈希匹配、cached 时长为正整数。
 */
export function isReusable(scene, cachedScene, hash, outputPath, force) {
  return (
    !force &&
    existsSync(outputPath) &&
    cachedScene?.audioSrc === `audio/${scene.id}.mp3` &&
    cachedScene?.tts?.hash === hash &&
    Number.isInteger(cachedScene.tts.audioLengthMs) &&
    cachedScene.tts.audioLengthMs > 0
  );
}
