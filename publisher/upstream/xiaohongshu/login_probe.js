() => {
  // Read only the authenticated-user branch, never a feed author's profile.
  const unwrap = v => v && typeof v === "object" && "value" in v ? v.value : v;
  const visible = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden" && getComputedStyle(e).display !== "none";
  const result = state => ({state, nickname: "", userId: ""});
  if (!["www.xiaohongshu.com", "xiaohongshu.com"].includes(location.hostname)) return result("verification_required");
  const dialogs = [...document.querySelectorAll('.login-container, [role="dialog"], .captcha-container')].filter(visible);
  const text = dialogs.map(e => e.innerText || "").join("\n");
  if (dialogs.some(e => /安全验证|拖动滑块|完成验证|短信验证|身份验证/.test(e.innerText || "")) ||
      [...document.querySelectorAll('iframe[src*="captcha"]')].some(visible)) return result("verification_required");
  if (/二维码.*(?:失效|过期)|(?:失效|过期).*二维码/.test(text)) return result("expired");
  const user = unwrap(window.__INITIAL_STATE__?.user);
  const info = unwrap(user?.userInfo);
  const id = String(info?.userId || info?.user_id || "");
  const valid = v => /^[a-f0-9]{24}$/i.test(v);
  const guest = info?.guest === true || info?.guest === 1 || info?.guest === "true";
  const loginVisible = [...document.querySelectorAll('.login-container')].some(visible);
  if (!loginVisible && !guest && valid(id)) return {state: "authenticated", userId: id, nickname: typeof info.nickname === "string" ? info.nickname.slice(0, 200) : ""};
  // A sidebar's own-account link is an independent identity signal when page state is absent.
  const own = [...document.querySelectorAll('nav a[href*="/user/profile/"], [role="navigation"] a[href*="/user/profile/"], .side-bar a[href*="/user/profile/"], .sidebar a[href*="/user/profile/"], .main-container .user a[href*="/user/profile/"]')]
    .filter(e => visible(e) && /^(我|我的|个人主页)$/.test((e.innerText || "").trim()))
    .map(e => { try { const u = new URL(e.href, location.href); return u.origin === location.origin ? u.pathname.match(/^\/user\/profile\/([a-f0-9]{24})\/?$/i)?.[1] : undefined; } catch { return undefined; } })
    .filter(Boolean);
  const ids = [...new Set(own)];
  if (!loginVisible && !guest && ids.length === 1 && (!valid(id) || id === ids[0])) return {state: "authenticated", userId: ids[0], nickname: ""};
  if (/扫码成功|扫描成功|手机.*确认|确认.*登录/.test(text)) return result("verifying");
  return result("waiting_scan");
}
