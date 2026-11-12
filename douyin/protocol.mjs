import {createHash} from 'node:crypto';
export const workID = x => typeof x === 'string' && /^\d{10,25}$/.test(x);
export function videoURL(raw) {
 const u = new URL(raw);
 if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port) throw Error('invalid_link');
 if (u.hostname === 'v.douyin.com' && /^\/[\w-]+\/?$/.test(u.pathname)) return '';
 if (!['www.douyin.com','douyin.com'].includes(u.hostname)) throw Error('invalid_link');
 let path;try{path=decodeURIComponent(u.pathname)}catch{throw Error('invalid_link')}
 if (['/','/jingxuan','/jingxuan/'].includes(path) || /^\/(jingxuan\/)?search\/[^/]+\/?$/.test(path)) {
  const ids=u.searchParams.getAll('modal_id');
  if(ids.length!==1 || !workID(ids[0])) throw Error('invalid_link');
  return ids[0];
 }
 const m = u.pathname.match(/^\/video\/(\d{10,25})\/?$/);
 if (!['www.douyin.com','douyin.com'].includes(u.hostname) || !m) throw Error('invalid_link');
 return m[1];
}
export function canonicalVideoURL(raw) {
 const id=videoURL(raw);
 return id ? 'https://www.douyin.com/video/'+id : raw;
}
export function verifiedAccount(main, creator) {
 // Publishing belongs to the authenticated creator account. Main-site login
 // is optional and must never stand in for creator identity or block it.
 if (!(typeof creator?.uid==='string'||Number.isSafeInteger(creator?.uid))) throw Error('identity_unverified');
 const uid = String(creator.uid);
 if (!/^\d{1,30}$/.test(uid) || typeof creator.nickname !== 'string' || !creator.nickname.trim()) throw Error('identity_unverified');
 const mainVerified=(typeof main?.uid==='string'||Number.isSafeInteger(main?.uid))&&String(main.uid)===uid;
 return {user_id:uid, username:creator.nickname, is_logged_in:true, main_verified:mainVerified, creator_verified:true,state:'success'};
}
export function accountProgress(main, creator) {
 const mainID=(typeof main?.uid==='string'||Number.isSafeInteger(main?.uid))?String(main.uid):'';
 const creatorID=(typeof creator?.uid==='string'||Number.isSafeInteger(creator?.uid))?String(creator.uid):'';
 const validMain=/^\d{1,30}$/.test(mainID), validCreator=/^\d{1,30}$/.test(creatorID);
 const nickname=typeof creator?.nickname==='string'?creator.nickname.trim():'';
 if(validCreator&&nickname)return verifiedAccount(main,creator);
 if(validMain&&!creatorID)return {user_id:mainID,username:'',is_logged_in:false,main_verified:true,creator_verified:false,state:'main_connected'};
 return {user_id:'',username:'',is_logged_in:false,main_verified:false,creator_verified:false,state:'unverified'};
}
export function normalizeVideo(d, expected='') {
 // Large identifiers must arrive as strings, never rounded IEEE754 numbers.
 if (!workID(d?.aweme_id) || expected && d.aweme_id !== expected) throw Error('collect_failed');
 if (d.images?.length || d.image_post_info || !d.video) throw Error('unsupported_media');
 const pick = x => x?.url_list?.find(s => typeof s === 'string' && s.startsWith('https://'));
 const media = pick(d.video.play_addr); if (!media) throw Error('collect_failed');
 const number = x => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : null;
 return {'作品ID':d.aweme_id,'作品类型':'视频','作品标题':d.preview_title || (d.desc || '').slice(0,80), '作品描述':d.desc || '', '作品标签':(d.text_extra || []).map(x=>x.hashtag_name).filter(x=>typeof x==='string'&&x), '作者昵称':d.author?.nickname || '', '作者ID':String(d.author?.uid || d.author?.sec_uid || ''), '发布时间':typeof d.create_time==='number'&&Number.isFinite(d.create_time)&&Math.abs(d.create_time)<8640000000000?new Date(d.create_time*1000).toISOString():'', '下载地址':[media], '封面地址':pick(d.video.origin_cover)||pick(d.video.cover)||'', '点赞数量':number(d.statistics?.digg_count),'收藏数量':number(d.statistics?.collect_count),'评论数量':number(d.statistics?.comment_count)};
}
export const signature = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function receiptFrom(data) {
 const d=data?.aweme || data?.aweme_detail || data?.data?.aweme || data?.data;
 const id=d?.aweme_id || data?.aweme_id;
 if (data?.status_code !== 0 || !workID(id)) throw Error('unknown');
 // A successful submit is not evidence that moderation/publication has finished.
 return {work_id:id,state:'submitted'};
}
