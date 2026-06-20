/**
 * biliup-readiness.mjs
 *
 * 决定某条 bili 命令执行前要不要按需补齐 biliup：
 *   - 投稿(upload)需要 biliup.exe
 *   - 发评论/置顶(comment/stick)需要 cookies.json（cookie）
 *   - login 必须用 biliup.exe 跑（扫码），所以「要登录但 exe 不在」时必须先下载
 *
 * 纯函数、无副作用：只依据「文件在不在」和「这次操作需要什么」给出动作清单，
 * 真正的下载/登录由 scripts/publish/bili/ensure-biliup.mjs 执行。
 *
 * @param {{exeExists:boolean, cookieExists:boolean, needExe:boolean, needCookie:boolean}} s
 * @returns {{download:boolean, login:boolean, ready:boolean}}
 */
export function planBiliupReadiness({ exeExists, cookieExists, needExe, needCookie }) {
  const login = needCookie && !cookieExists;
  // 要登录就必须先有 exe（login 子进程靠它跑扫码）；不需要登录时，
  // 仅当本次操作确实需要 exe 且 exe 不在才下载。
  const download = login ? !exeExists : needExe && !exeExists;
  const ready = !download && !login;
  return { download, login, ready };
}
