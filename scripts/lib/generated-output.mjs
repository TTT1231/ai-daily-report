import {existsSync} from "node:fs";
import {copyFile, mkdir, open, rename, rm, stat, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";

const LOCK_POLL_INTERVAL_MS = 250;
const LOCK_TIMEOUT_MS = 10 * 60 * 1000;
const STALE_LOCK_MS = 30 * 60 * 1000;
const RENAME_RETRY_ATTEMPTS = 10;
const RENAME_RETRY_DELAY_MS = 100;

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

      const lockAgeMs = await stat(lockPath)
        .then((lockStat) => Date.now() - lockStat.mtimeMs)
        .catch(() => 0);
      if (lockAgeMs >= STALE_LOCK_MS) {
        await rm(lockPath, {force: true});
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

export async function createGeneratedOutputTransaction(dataDir) {
  const audioDir = resolve(dataDir, "audio");
  const stagedAudioDir = resolve(dataDir, ".audio-staging");
  const backupAudioDir = resolve(dataDir, ".audio-backup");
  const generatedPath = resolve(dataDir, "data-generate.json");
  const stagedGeneratedPath = resolve(dataDir, ".data-generate.json.staging");
  const lockPath = resolve(dataDir, ".tts.lock");
  const releaseLock = await acquireTransactionLock(lockPath);

  try {
    if (existsSync(backupAudioDir) && existsSync(stagedGeneratedPath)) {
      await rm(audioDir, {recursive: true, force: true});
      await renameWithRetry(backupAudioDir, audioDir);
    } else if (existsSync(backupAudioDir) && !existsSync(audioDir)) {
      await renameWithRetry(backupAudioDir, audioDir);
    }
    await rm(stagedAudioDir, {recursive: true, force: true});
    if (existsSync(backupAudioDir) && existsSync(audioDir)) {
      await rm(backupAudioDir, {recursive: true, force: true});
    }
    await rm(stagedGeneratedPath, {force: true});
    await mkdir(stagedAudioDir, {recursive: true});
  } catch (error) {
    await releaseLock();
    throw error;
  }

  return {
    existingAudioPath(sceneId) {
      return resolve(audioDir, `${sceneId}.mp3`);
    },
    async stageExistingAudio(sceneId) {
      await copyFile(
        resolve(audioDir, `${sceneId}.mp3`),
        resolve(stagedAudioDir, `${sceneId}.mp3`),
      );
    },
    async stageGeneratedAudio(sceneId, audio) {
      await writeFile(resolve(stagedAudioDir, `${sceneId}.mp3`), audio);
    },
    async stageReport(report) {
      await writeFile(stagedGeneratedPath, `${JSON.stringify(report, null, 2)}\n`);
    },
    async commit() {
      try {
        let backedUpAudio = false;
        let installedAudio = false;
        try {
          if (existsSync(audioDir)) {
            await renameWithRetry(audioDir, backupAudioDir);
            backedUpAudio = true;
          }
          await renameWithRetry(stagedAudioDir, audioDir);
          installedAudio = true;
          await renameWithRetry(stagedGeneratedPath, generatedPath);
        } catch (error) {
          if (installedAudio) {
            // 移开刚装好的新音频而不是直接删除，让旧音频的恢复先成功。恢复若也失败，
            // 下一次运行的启动期对账仍能从 .audio-backup 恢复（见上方 setup 块），
            // 新音频则留在 .audio-staging 等待清理，避免任何路径下 audio/ 被删空且无备份。
            await renameWithRetry(audioDir, stagedAudioDir).catch(async () => {
              await rm(audioDir, {recursive: true, force: true}).catch(() => {});
            });
          }
          if (backedUpAudio) await renameWithRetry(backupAudioDir, audioDir);
          throw error;
        }
        await rm(backupAudioDir, {recursive: true, force: true}).catch(() => {});
      } finally {
        await releaseLock();
      }
    },
    async abort() {
      try {
        await rm(stagedAudioDir, {recursive: true, force: true});
        await rm(stagedGeneratedPath, {force: true});
      } finally {
        await releaseLock();
      }
    },
  };
}
