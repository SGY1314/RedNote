import type { MobileSession as CloudHandoffSession, MobileState as HandoffState } from './mobile-types';

export function cloudEffectiveState(session: CloudHandoffSession, now: number): HandoffState {
  if (session.state === 'cancelled' || session.state === 'expired') return session.state;
  const expires = Date.parse(session.expires_at);
  return !Number.isFinite(expires) || expires <= now ? 'expired' : session.state;
}

export function preserveCloudLaunch(previous: CloudHandoffSession | undefined, next: CloudHandoffSession): CloudHandoffSession {
  if (previous?.id !== next.id) return next;
  return { ...next, ticket: previous.ticket,
    qr_image: previous.qr_image, qr_error: previous.qr_error, launch_path: previous.launch_path,
    miniapp_scheme_url: previous.miniapp_scheme_url };
}

export function cloudMiniappSchemeURL(session: CloudHandoffSession | undefined): string | undefined {
  if (!session?.miniapp_scheme_url || !session.ticket || !/^[A-Za-z0-9_-]{32}$/.test(session.ticket)) return undefined;
  try {
    const url = new URL(session.miniapp_scheme_url);
    if (url.protocol === 'xhsdiscover:') return validMiniappURL(url, session.ticket) ? url.href : undefined;
    if (!session.miniapp_scheme_url.startsWith('https://www.xiaohongshu.com/miniapp/status?')
      || url.protocol !== 'https:' || url.host !== 'www.xiaohongshu.com' || url.username || url.password || url.hash
      || url.pathname !== '/miniapp/status') return undefined;
    const params = [...url.searchParams];
    if (params.length !== 2 || url.searchParams.getAll('link').length !== 1
      || url.searchParams.getAll('fullscreen').length !== 1 || url.searchParams.get('fullscreen') !== 'true') return undefined;
    const launch = new URL(url.searchParams.get('link')!);
    return validMiniappURL(launch, session.ticket, true) ? url.href : undefined;
  } catch { return undefined; }
}

function validMiniappURL(url: URL, ticket: string, trialOnly = false): boolean {
  if (url.protocol !== 'xhsdiscover:' || url.host !== 'miniapp' || url.username || url.password || url.hash
    || !/^\/[A-Za-z0-9]{24}(?:_trial)?\/pages\/publish\/index$/.test(url.pathname)
    || (trialOnly && !/^\/[A-Za-z0-9]{24}_trial\//.test(url.pathname))) return false;
  const params = [...url.searchParams];
  return params.length === 1 && params[0][0] === 'scene' && params[0][1] === ticket;
}

