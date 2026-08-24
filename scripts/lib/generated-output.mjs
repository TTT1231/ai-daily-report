import {mkdir, open, readFile, readdir, rename, rm, stat, unlink, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";

const LOCK_POLL_INTERVAL_MS = 250;
const LOCK_TIMEOUT_MS = 10 * 60 * 1000;
// 仅作为兜底：锁内容不可读（写了一半/损坏）时按年龄回收。持有进程的存活判定
// 优先走 pid 探测，崩溃残留的锁能被立即回收，不必干等这里的时间阈值。
const STALE_LOCK_MS = 30 * 60 * 1000;
const RENAME_RETRY_ATTEMPTS = 10;
const RENAME_RETRY_DELAY_MS = 100;

// 单文件 rename-replace（如 .data-generate.json.staging -> data-generate.json）在
// Windows 上偶发 EACCES/EBUSY/EPERM（别的进程短暂读它），带退避重试即可原子完成。
async function renameWithRetry(source, destination) {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      const retryable = ["EACCES", "EBUSY", "EPERM"].includes(error.code);
      if (!retryable || attempt >= RENAME_RETRY_ATTEMPTS - 1) {
        throw error;
      }
      await sleep(RENAME_RETRY_DELAY_MS * (attempt + 1));
    }
  }
}

// 判断锁持有进程是否已死。process.kill(pid, 0) 不发送真实信号，只做存在性探测：
// 存活（含无权限的 EPERM）视为持锁中，ESRCH 说明进程已不存在（崩溃/被杀没清锁）。
// pid 被无关进程复用的极端情况会误判为存活，最终由 LOCK_TIMEOUT_MS 兜底报错。
function isLockHolderDead(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}

// 读取锁内容里的 pid；内容损坏（写一半崩溃）返回 null，交由年龄阈值兜底回收。
async function readLockPid(lockPath) {
  const content = await readFile(lockPath, "utf8").catch(() => null);
  if (content == null) return null;
  try {
    const pid = JSON.parse(content)?.pid;
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

async function acquireTransactionLock(lockPath) {
  const startedAt = Date.now();

  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(
        `${JSON.stringify({pid: process.pid, createdAt: new Date().toISOString()})}\n`,
      );
      let released = false;

      return async () => {
        if (released) return;
        released = true;
        await handle.close();
        await rm(lockPath, {force: true});
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;

      const lockStat = await stat(lockPath).catch(() => null);
      const lockAgeMs = lockStat ? Date.now() - lockStat.mtimeMs : 0;
      const holderPid = lockStat ? await readLockPid(lockPath) : null;
      const reclaimable =
        (holderPid != null && isLockHolderDead(holderPid)) ||
        (holderPid == null && lockStat != null && lockAgeMs >= STALE_LOCK_MS);
      if (reclaimable && lockStat) {
        // TOCTOU 防护：读取内容期间锁可能已被其它等待者回收并重建，删除前复查
        // mtime，不一致说明手上这份是旧锁，回到循环重新评估新锁。
        const mtimeNowMs = await stat(lockPath)
          .then((s) => s.mtimeMs)
          .catch(() => null);
        if (mtimeNowMs === lockStat.mtimeMs) {
          await rm(lockPath, {force: true});
        }
        continue;
      }
      if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
        throw new Error(
          `Timed out waiting for another TTS process to release ${lockPath}.`,
        );
      }
      await sleep(LOCK_POLL_INTERVAL_MS);
    }
  }
}

// 逐文件提交的事务。
//
// 设计动机：旧实现把整轮音频先写进 .audio-staging/，commit 时 rename 整个 audio/
// 目录（audio/ -> .audio-backup/，.audio-staging/ -> audio/）。在 Windows 上，
// Remotion Studio 播放/拖动时会持有 audio/<id>.mp3 的打开读句柄（in-flight HTTP
// Range 请求），而 Windows 不允许重命名"含有打开文件"的目录，于是第一步 rename
// 抛 EPERM，renameWithRetry 重试 ~4.5s 后整次 tts abort → dev 提示"自动同步失败"
// → 用户必须 Ctrl+C 重启。这是 dev 阶段约 40% 间歇性 HMR 失败的真凶。
//
// 新模型改为"逐文件"操作，经实测（repro-aperm.mjs）在句柄被占用时全部安全：
//   - writeFile 覆盖被占用的文件  ✅（Node 以 FILE_SHARE_WRITE 打开）
//   - writeFile 新增同目录另一文件 ✅
//   - unlink   删除被占用的文件    ✅
// 只有"rename 目录"和"rename 覆盖被占用文件"会 EPERM，这两样本实现都不再做。
//
// 提交顺序（与 Remotion 消费侧契合，见审计结论）：先逐文件写音频 → 再原子发布
// data-generate.json（单文件 rename，Studio 只在它 mtime 变化时 reload）→ 最后
// best-effort 清理孤儿音频。任何时刻崩溃都留下"manifest 与音频一致，或仅多出
// 无害孤儿"的状态；缺失/不匹配音频对 Remotion 也只 warn 不崩。
// 供 tts 事务之外的写盘方（generate-svg 的快照提交/回滚）复用同一把 .tts.lock：
// 两者都会改写 data-generate.json，不共享锁时回滚可能覆盖并发 tts commit 的写入。
export async function withTransactionLock(dataDir, fn) {
  const releaseLock = await acquireTransactionLock(resolve(dataDir, ".tts.lock"));
  try {
    return await fn();
  } finally {
    await releaseLock();
  }
}

export async function createGeneratedOutputTransaction(dataDir) {
  const audioDir = resolve(dataDir, "audio");
  const generatedPath = resolve(dataDir, "data-generate.json");
  const stagedGeneratedPath = resolve(dataDir, ".data-generate.json.staging");
  const lockPath = resolve(dataDir, ".tts.lock");
  const releaseLock = await acquireTransactionLock(lockPath);

  try {
    await mkdir(audioDir, {recursive: true});
    // 清理上次崩溃可能残留的 staging manifest（旧实现的 .audio-backup/.audio-staging
    // 目录不再产生，无需对账恢复）。
    await rm(stagedGeneratedPath, {force: true});
  } catch (error) {
    await releaseLock();
    throw error;
  }

  const generatedAudio = new Map(); // sceneId -> Buffer（本轮新生成的音频字节）
  const reusedIds = new Set(); // sceneId（复用、已在 audio/ 原样保留的）
  let stagedReportWritten = false;

  return {
    existingAudioPath(sceneId) {
      return resolve(audioDir, `${sceneId}.mp3`);
    },
    async stageExistingAudio(sceneId) {
      // 复用的音频已在 audio/ 中，无需拷贝；登记 id 供孤儿清理时排除。
      reusedIds.add(sceneId);
    },
    async stageGeneratedAudio(sceneId, audio) {
      generatedAudio.set(sceneId, audio);
    },
    async stageReport(report) {
      await writeFile(stagedGeneratedPath, `${JSON.stringify(report, null, 2)}\n`);
      stagedReportWritten = true;
    },
    async commit() {
      try {
        // 1) 逐文件写入本轮新生成/变化的音频（覆盖或新增）。writeFile 即使在 Studio
        //    持有该文件读句柄时也能成功，不再触发目录重命名的 EPERM。
        for (const [sceneId, audio] of generatedAudio) {
          await writeFile(resolve(audioDir, `${sceneId}.mp3`), audio);
        }

        // 2) 原子发布 manifest（单文件 rename，非目录；Studio 不长期持其句柄，
        //    偶发占用由 renameWithRetry 退避重试解决）。
        if (stagedReportWritten) {
          await renameWithRetry(stagedGeneratedPath, generatedPath);
        }

        // 3) best-effort 清理孤儿音频（已删除 scene 的 mp3）。删除失败（被占用）
        //    则忽略：孤儿无害，下次再清。
        //    ⚠ 调用方不变式：本轮每个 scene 必须调 stageExistingAudio 或
        //    stageGeneratedAudio 之一，其 id 才会进 currentIds；否则该 scene 的
        //    mp3 会被当孤儿删掉。generate-tts.mjs 的 scene 循环是二选一的
        //    if/else，满足该不变式；新增调用方需遵守。
        const currentIds = new Set([...generatedAudio.keys(), ...reusedIds]);
        let entries = [];
        try {
          entries = await readdir(audioDir);
        } catch {
          entries = [];
        }
        for (const entry of entries) {
          if (!entry.endsWith(".mp3")) continue;
          const id = entry.slice(0, -".mp3".length);
          if (currentIds.has(id)) continue;
          await unlink(resolve(audioDir, entry)).catch(() => {});
        }
      } finally {
        await releaseLock();
      }
    },
    async abort() {
      try {
        await rm(stagedGeneratedPath, {force: true});
      } finally {
        await releaseLock();
      }
    },
  };
}
