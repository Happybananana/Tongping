/** Batch search pacing/retry logic. No dependency on the DOM or Supabase. */
export const IMPORT_SEARCH_INTERVAL_MS = 3400; // 17.6 launches/min, leaving room under 30/min server budget.
export const IMPORT_SEARCH_TIMEOUT_MS = 32_000;
export const IMPORT_SEARCH_ATTEMPTS = 3;

export function retryAfterMs(value, now=Date.now()) {
  if(value == null || String(value).trim()==='')return 0;
  const raw=String(value).trim();
  const ms=/^\d+(?:\.\d+)?$/.test(raw)?Number(raw)*1000:Date.parse(raw)-now;
  return Number.isFinite(ms)?Math.max(0,Math.min(90_000,Math.ceil(ms))):0;
}

export function isTemporaryEmptySearch(payload) {
  if(!payload || !Array.isArray(payload.items))return true;
  if(payload.items.length)return false;
  if(typeof payload.temporaryFailure==='boolean')return payload.temporaryFailure;
  // Backward compatibility for an older /api/search deployed during a rolling update.
  return Array.isArray(payload.notices) && payload.notices.some(s=>/暂时不可用|连接失败|请求超时|检索失败|网络错误/.test(String(s)));
}

export function abortableWait(ms,signal) {
  if(signal?.aborted)return Promise.reject(signal.reason||new DOMException('Aborted','AbortError'));
  return new Promise((resolve,reject)=>{
    let timer;
    const cancel=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(signal?.reason||new DOMException('Aborted','AbortError'))};
    timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve()},Math.max(0,ms));
    signal?.addEventListener('abort',cancel,{once:true});
  });
}

/** One pacer shared by all workers and retries. A 429 delays the whole batch. */
export function createImportPacer({intervalMs=IMPORT_SEARCH_INTERVAL_MS,now=Date.now,wait=abortableWait}={}){
  let next=0,blocked=0;
  return {
    cooldown(ms){const until=now()+Math.max(0,ms);blocked=Math.max(blocked,until);next=Math.max(next,blocked)},
    async takeTurn({signal,paused=()=>false,onWait=()=>{}}={}){
      while(true){
        if(signal?.aborted)throw signal.reason||new Error('已取消');
        if(paused())return false;
        const at=now(),remaining=Math.max(next,blocked)-at;
        if(remaining<=0){next=at+intervalMs;return true;}
        onWait(remaining);
        await wait(Math.min(remaining,1000),signal);
      }
    }
  };
}

/** Return typed outcomes, so no-results is never confused with an unavailable API. */
export async function searchImportWithRetry({request,pacer,signal,paused=()=>false,onRetry=()=>{},maxAttempts=IMPORT_SEARCH_ATTEMPTS,wait=abortableWait}={}){
  if(typeof request!=='function'||!pacer)throw new TypeError('Missing search request or pacer');
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    if(paused())return {kind:'paused'};
    const allowed=await pacer.takeTurn({signal,paused});
    if(!allowed)return {kind:'paused'};
    let retryable=false,status=0,message='搜索暂时不可用',cooldown=0;
    try{
      const response=await request();
      status=response.status;
      const payload=await response.json().catch(()=>({}));
      if(response.ok && !isTemporaryEmptySearch(payload))return {kind:'ok',payload,attempts:attempt};
      retryable=response.ok || status===429 || status===408 || status>=500;
      message=response.ok?'作品数据源暂不可用':String(payload.error||`HTTP ${status}`);
      if(status===429){
        cooldown=retryAfterMs(response.headers?.get?.('Retry-After'))||retryAfterMs(payload.retryAfter)||60_000;
        pacer.cooldown(cooldown);
      }
    }catch(error){
      if(signal?.aborted)throw error;
      retryable=true;
      message=error?.name==='TimeoutError'?'搜索超时':String(error?.message||error);
    }
    if(!retryable)return {kind:'error',attempts:attempt,status,message,retryable:false};
    if(attempt>=maxAttempts)return {kind:'error',attempts:attempt,status,message,retryable:true};
    const delay=status===429?0:Math.min(16_000,2500*Math.pow(2,attempt-1));
    onRetry({attempt,nextAttempt:attempt+1,status,message,waitMs:Math.max(delay,cooldown)});
    if(delay)await wait(delay,signal);
  }
  return {kind:'error',message:'搜索重试次数已耗尽',retryable:true};
}
