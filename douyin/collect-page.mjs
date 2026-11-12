// Runs in the page. Read only rendered work elements, never browser storage,
// framework state, comments, or recommended-video payloads.
export function readRenderedVideo(expected) {
 if (!/^\d{10,25}$/.test(expected)) return null;
 const roots = [...document.querySelectorAll('[data-e2e="video-detail"]')];
 for (const root of roots) {
  const player = root.querySelector('[data-e2e="player-container"].video_' + expected);
  const info = root.querySelector('[data-e2e="detail-video-info"]');
  const heading = info?.querySelector('h1');
  if (!player || !heading?.textContent?.trim()) continue;
  const videos = [...player.querySelectorAll('video')].filter(v => v.currentSrc || v.getAttribute('src'));
  if (videos.length !== 1) continue;
  const video = videos[0];
  let src;
  try {
   const u = new URL(video.currentSrc || video.getAttribute('src'), location.href);
   if (u.protocol !== 'https:' || u.username || u.password || u.port) continue;
   const targets = u.searchParams.getAll('target').filter(Boolean);
   if (targets.some(id => id !== expected)) continue;
   src = u.href;
  } catch { continue; }
  const count = name => {
   const nodes = [...root.querySelectorAll('[data-e2e="' + name + '"]')];
   const values = [...new Set(nodes.map(x => x.textContent?.trim()).filter(Boolean))];
   // Rounded values such as 1.2万 are not exact interaction counts.
   if (values.length !== 1 || !/^\d+$/.test(values[0])) return null;
   const n = Number(values[0]); return Number.isSafeInteger(n) ? n : null;
  };
  const authors = [...root.querySelectorAll('[data-e2e="user-info"] a[href*="/user/"]')]
   .map(a => ({name:a.textContent?.trim(),href:a.getAttribute('href')})).filter(a=>a.name);
  const unique = [...new Map(authors.map(a=>[a.href,a])).values()];
  let author = {};
  if (unique.length === 1) {
   try {const u=new URL(unique[0].href,location.href);if(u.hostname==='www.douyin.com' && /^\/user\/[\w-]+$/.test(u.pathname)) author={nickname:unique[0].name,sec_uid:u.pathname.split('/').pop()};} catch {}
  }
  const time = info.querySelector('[data-e2e="detail-video-publish-time"]')?.textContent?.match(/发布时间[：:]\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
  const timestamp = time ? Date.parse(time[1]+'T'+time[2]+':00+08:00')/1000 : undefined;
  // Cover must belong to this player, never the related-video carousel.
  const cover = video.poster || [...player.querySelectorAll('img[src]')].map(x=>x.getAttribute('src')).find(s=>{try{return new URL(s).searchParams.get('sc')==='origin_cover'}catch{return false}}) || '';
  return {aweme_id:expected,desc:heading.textContent.trim(),author,
   create_time:Number.isFinite(timestamp)?timestamp:undefined,
   text_extra:[...heading.querySelectorAll('a')].map(x=>({hashtag_name:x.textContent?.trim().replace(/^#/, '')})),
   video:{play_addr:{url_list:[src]},origin_cover:{url_list:cover?[cover]:[]}},
   statistics:{digg_count:count('video-player-digg'),collect_count:count('video-player-collect'),comment_count:count('video-player-comment')}};
 }
 return null;
}

export function responseVideo(body, expected) {
 if (!expected || body?.status_code !== 0) return null;
 const candidates = [body.aweme_detail, body.awemeDetail, body.data?.aweme_detail,
  ...(Array.isArray(body.aweme_list)?body.aweme_list:[])];
 return candidates.find(d=>d?.aweme_id===expected) || null;
}
