// The official uploader may show an enabled publish button after upload failure.
// Never use that button alone as evidence of successful file transfer.
export async function assertUploadNotFailed(page) {
 const failure=page.getByText(/^\s*上传失败\s*[,，]?\s*(?:重新上传)?\s*$/).filter({visible:true});
 if(await failure.count()>0)throw Error('upload_failed');
}

// Bounded, credential-free diagnostics: no paths, query strings, headers or bodies.
export function recordNetworkIssue(entries,raw,type,reason,status) {
 if(!['policy','dns','address','request','http'].includes(reason))return;
 let hostname;
 try {hostname=new URL(raw).hostname;}catch{return;}
 if(!hostname||hostname.length>253)return;
 const resourceType=['xhr','fetch','media','image','script','document','stylesheet','font','other'].includes(type)?type:'other';
 const key=JSON.stringify([hostname,resourceType,reason,status]);
 const existing=entries.find(x=>x.key===key);
 if(existing){existing.count++;return;}
 if(entries.length>=80)return;
 entries.push({key,hostname,resourceType,reason,...(Number.isInteger(status)&&status>=400&&status<=599?{status}:{}),count:1});
}
export function networkSummary(entries) {
 return entries.map(({key,...entry})=>({...entry}));
}
