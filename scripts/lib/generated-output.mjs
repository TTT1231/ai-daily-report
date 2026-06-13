import {existsSync} from "node:fs";
import {copyFile, mkdir, rename, rm, writeFile} from "node:fs/promises";
import {resolve} from "node:path";

export async function createGeneratedOutputTransaction(dataDir) {
  const audioDir = resolve(dataDir, "audio");
  const stagedAudioDir = resolve(dataDir, ".audio-staging");
  const backupAudioDir = resolve(dataDir, ".audio-backup");
  const generatedPath = resolve(dataDir, "data-generate.json");
  const stagedGeneratedPath = resolve(dataDir, ".data-generate.json.staging");

  if (existsSync(backupAudioDir) && existsSync(stagedGeneratedPath)) {
    await rm(audioDir, {recursive: true, force: true});
    await rename(backupAudioDir, audioDir);
  } else if (existsSync(backupAudioDir) && !existsSync(audioDir)) {
    await rename(backupAudioDir, audioDir);
  }
  await rm(stagedAudioDir, {recursive: true, force: true});
  if (existsSync(backupAudioDir) && existsSync(audioDir)) {
    await rm(backupAudioDir, {recursive: true, force: true});
  }
  await rm(stagedGeneratedPath, {force: true});
  await mkdir(stagedAudioDir, {recursive: true});

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
      let backedUpAudio = false;
      let installedAudio = false;
      try {
        if (existsSync(audioDir)) {
          await rename(audioDir, backupAudioDir);
          backedUpAudio = true;
        }
        await rename(stagedAudioDir, audioDir);
        installedAudio = true;
        await rename(stagedGeneratedPath, generatedPath);
      } catch (error) {
        if (installedAudio) await rm(audioDir, {recursive: true, force: true});
        if (backedUpAudio) await rename(backupAudioDir, audioDir);
        throw error;
      }
      await rm(backupAudioDir, {recursive: true, force: true}).catch(() => {});
    },
    async abort() {
      await rm(stagedAudioDir, {recursive: true, force: true});
      await rm(stagedGeneratedPath, {force: true});
    },
  };
}
