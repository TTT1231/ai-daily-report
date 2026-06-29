import {spawnSync} from "node:child_process";

// POSIX 上 SIGTERM 后给进程的优雅退出宽限，超时再 SIGKILL 强杀；
// Windows 的 taskkill /f 本身就是强杀，无需宽限。
const POSIX_GRACE_MS = 1500;
const POLL_INTERVAL_MS = 100;

// terminateProcessTree 终止 child 及其全部后代。
// Windows 用 taskkill /t 递归杀整棵树；POSIX 上递归收集所有后代 pid——仅 kill 直接子进程
// 会孤儿化孙进程（如 Remotion Studio 派生的 Chromium）——先 SIGTERM 整棵树，宽限后对残留
// SIGKILL（原实现没有升级，忽略 SIGTERM 的子进程永远不会被回收）。杀失败会打 warning，不静默。
export function terminateProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return;

  if (process.platform === "win32") {
    const result = spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    // status 128 = taskkill 报告「进程不存在」（已自行退出），不算失败。
    if (result.error || (result.status !== 0 && result.status !== 128)) {
      console.warn(
        `[process-tree] taskkill 未能终止 pid=${child.pid} (status=${result.status ?? "?"}${result.error ? `, ${result.error.message}` : ""})`,
      );
    }
    return;
  }

  const pids = collectDescendantPids(child.pid);
  signalAll(pids, "SIGTERM");
  // 宽限内轮询；全部退出就提前结束，超时则对残留 SIGKILL。
  const deadline = Date.now() + POSIX_GRACE_MS;
  while (Date.now() < deadline && pids.some(isAlive)) {
    sleepSync(POLL_INTERVAL_MS);
  }
  const survivors = pids.filter(isAlive);
  if (survivors.length) {
    signalAll(survivors, "SIGKILL");
  }
}

// collectDescendantPids 从 rootPid 出发 BFS 收集它本身与全部后代 pid。
// childrenOfFn 可注入（默认走 pgrep -P），便于单测覆盖遍历逻辑而不依赖真实进程。
export function collectDescendantPids(rootPid, childrenOfFn = childrenOf) {
  const all = [];
  const seen = new Set();
  const queue = [rootPid];
  while (queue.length) {
    const pid = queue.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    all.push(pid);
    for (const cpid of childrenOfFn(pid)) queue.push(cpid);
  }
  return all;
}

// childrenOf 用 pgrep -P <pid> 列出直接子进程；pgrep 缺失或无子进程返回 []（降级为只杀 root）。
function childrenOf(pid) {
  const r = spawnSync("pgrep", ["-P", String(pid)], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (r.error || r.status !== 0 || !r.stdout) return [];
  return r.stdout
    .toString()
    .split(/\s+/)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalAll(pids, signal) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // 已退出则忽略。
    }
  }
}

// sleepSync 阻塞当前线程 ms 毫秒（终止流程是同步的，调用方未 await）。
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    // SharedArrayBuffer 不可用时退化为忙等（极少见）。
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* spin */
    }
  }
}
