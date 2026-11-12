export const publisherLoginLabels: Record<string, string> = {
  waiting_scan: "等待扫码，请在手机上确认登录",
  verifying: "验证中，正在核实账号",
  verification_required: "需要完成官方验证",
  expired: "二维码已过期，请重新获取",
  failed: "登录未完成，请查看提示",
  success: "已登录",
  logged_out: "未登录，请扫码连接",
};
export const loginTerminal = (state?: string) =>
  state === "expired" || state === "failed";
