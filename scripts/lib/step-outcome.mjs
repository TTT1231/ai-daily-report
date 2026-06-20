// 把子进程的退出结果归类为成功/失败，便于 prepare-video 编排与单元测试。
// code 为数字退出码；signal 在子进程被信号杀死时为字符串（如 "SIGTERM"）。
// 被信号终止视为失败：prepare-video 串行流程中，前一步被异常杀死后继续执行下一步，
// 可能在不完整的工作区（例如 archive:check 没归档完）上操作，造成数据不一致。
export function classifyStepOutcome(code, signal) {
  if (code === 0) {
    return {ok: true};
  }
  if (code === null && signal) {
    return {ok: false, signal};
  }
  return {ok: false, exitCode: code ?? null};
}

