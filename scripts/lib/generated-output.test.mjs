import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, writeFile, open, readFile, rm} from "node:fs/promises";
import {existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createGeneratedOutputTransaction} from "./generated-output.mjs";

// 复现并锁定 Windows EPERM 真凶：Remotion Studio 在播放/拖动时会持有 audio/<id>.mp3
// 的打开读句柄（in-flight HTTP Range 请求）。旧的 commit 第一步是
// rename(audio/ -> .audio-backup/)，而 Windows 不允许重命名"含打开文件"的目录，
// renameWithRetry 重试 ~4.5s 后抛 EPERM，整次 tts abort → 用户必须 Ctrl+C 重启。
// 新的逐文件 commit 必须在这种情况下仍能成功。
test("commit succeeds while a reader holds an open handle on a reused audio file (Windows EPERM guard)", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "gen-out-"));
  const audioDir = join(dataDir, "audio");
  await mkdir(audioDir);
  // 上一轮已存在的、本轮复用的音频
  await writeFile(join(audioDir, "scene-1.mp3"), Buffer.alloc(1024, 1));

  const tx = await createGeneratedOutputTransaction(dataDir);
  await tx.stageExistingAudio("scene-1");
  await tx.stageGeneratedAudio("scene-2", Buffer.alloc(2048, 2));
  await tx.stageReport({$schema: "../config/data.schema.json", date: "2026-01-01", stories: []});

  // 模拟 Studio 持有 scene-1.mp3 的 in-flight 读句柄
  const handle = await open(join(audioDir, "scene-1.mp3"), "r");

  // 关键断言：不得抛错（旧实现在此抛 EPERM）
  await tx.commit();

  await handle.close();

  assert.ok(existsSync(join(audioDir, "scene-1.mp3")), "复用的音频仍在");
  assert.ok(existsSync(join(audioDir, "scene-2.mp3")), "新生成的音频已写入");
  const manifest = JSON.parse(
    await readFile(join(dataDir, "data-generate.json"), "utf8"),
  );
  assert.equal(manifest.date, "2026-01-01", "manifest 已发布");

  await rmForce(dataDir);
});

// commit 写入新音频 + 原子发布 manifest 的基础契约。
test("commit writes generated audio and atomically publishes the manifest", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "gen-out-"));
  const audioDir = join(dataDir, "audio");
  await mkdir(audioDir);

  const tx = await createGeneratedOutputTransaction(dataDir);
  const bytes = Buffer.from("new-audio-bytes");
  await tx.stageGeneratedAudio("scene-1", bytes);
  await tx.stageReport({$schema: "../config/data.schema.json", date: "2026-02-02", stories: []});
  await tx.commit();

  const written = await readFile(join(audioDir, "scene-1.mp3"));
  assert.deepEqual(written, bytes, "生成的音频按原字节写入 audio/");
  const manifest = JSON.parse(
    await readFile(join(dataDir, "data-generate.json"), "utf8"),
  );
  assert.equal(manifest.date, "2026-02-02");
  assert.ok(!existsSync(join(dataDir, ".data-generate.json.staging")), "staging 已清理");

  await rmForce(dataDir);
});

// 删除 story 后，其孤儿音频应在 manifest 发布后被清理（best-effort）。
test("commit removes orphaned audio for scenes no longer present", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "gen-out-"));
  const audioDir = join(dataDir, "audio");
  await mkdir(audioDir);
  await writeFile(join(audioDir, "scene-keep.mp3"), Buffer.alloc(8, 1));
  await writeFile(join(audioDir, "scene-gone.mp3"), Buffer.alloc(8, 2));

  const tx = await createGeneratedOutputTransaction(dataDir);
  await tx.stageExistingAudio("scene-keep"); // 本轮仅保留这一个
  await tx.stageReport({$schema: "../config/data.schema.json", date: "2026-03-03", stories: []});
  await tx.commit();

  assert.ok(existsSync(join(audioDir, "scene-keep.mp3")), "保留的音频还在");
  assert.ok(!existsSync(join(audioDir, "scene-gone.mp3")), "孤儿音频已清理");

  await rmForce(dataDir);
});

// abort 不得发布 manifest，也不得改动已存在的 audio/（失败回退语义）。
test("abort does not publish manifest or remove existing audio", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "gen-out-"));
  const audioDir = join(dataDir, "audio");
  await mkdir(audioDir);
  await writeFile(join(audioDir, "scene-1.mp3"), Buffer.alloc(16, 1));

  const tx = await createGeneratedOutputTransaction(dataDir);
  await tx.stageGeneratedAudio("scene-2", Buffer.alloc(32, 2));
  await tx.stageReport({$schema: "../config/data.schema.json", date: "2026-04-04", stories: []});
  await tx.abort();

  assert.ok(!existsSync(join(dataDir, "data-generate.json")), "abort 不发布 manifest");
  assert.ok(existsSync(join(audioDir, "scene-1.mp3")), "已有音频不动");
  assert.ok(!existsSync(join(audioDir, "scene-2.mp3")), "未提交的新音频不落盘");
  assert.ok(!existsSync(join(dataDir, ".data-generate.json.staging")), "staging 已清理");

  await rmForce(dataDir);
});

async function rmForce(target) {
  await rm(target, {recursive: true, force: true});
}
