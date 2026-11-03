/** 同频 V0.6.10 · 轨迹交汇 / WHERE WE CROSS · 最多四人（含自己）
 * All historical friend data comes from the existing permission-checked RPC.
 * No direct client query to other users' private experiences is made.
 */
import {db,ready} from './cloud.js';
import {formatTravelDate} from './travelArchiveModel.js';
import {WORLD_PATHS} from './travelWorldMap.js';
import {buildGroupTravelCrossings,initialViewport,clampViewport,zoomViewport} from './travelCrossingModel.js';
import './v069-crossing.css';

const root=document.getElementById('page');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const COLORS=['#8EE2BD','#F0D28A','#97AFF7','#EAA2BE'];
const MAX_FRIENDS=3; // Own account + three friends = four participants total.
const st={mount:null,me:null,circle:null,friends:[],chosen:[],enabled:false,
  state:'idle',error:'',data:null,view:null,selected:'',filter:1,serial:0};
const notification=msg=>{const toast=document.getElementById('toast');if(!toast)return;toast.textContent=msg;
  toast.classList.add('visible');setTimeout(()=>{if(toast.textContent===msg)toast.classList.remove('visible')},3300)};
const problem=err=>err?.message||String(err);
const unwrap=r=>{if(r?.error)throw r.error;return r?.data};
const participants=()=>[st.me,...st.chosen].filter(Boolean);
const travelerName=id=>id===st.me?'我':st.friends.find(f=>f.id===id)?.name||'圈内好友';
const travelerColor=id=>COLORS[Math.max(0,participants().indexOf(id))]||COLORS[0];

function mount(){
  if(root?.dataset.page!=='travel'||!ready||!db)return;
  const world=root.querySelector('.railway-world'),wrap=world?.querySelector('.v68-archive-wrap');
  if(!world||!wrap||world.dataset.v69==='1')return;
  world.dataset.v69='1';
  const section=document.createElement('section');section.id='v69-crossing';section.className='station-panel v69-crossing';
  section.setAttribute('aria-label','与好友的多人轨迹交汇');
  const wishlist=wrap.querySelector('.v68-wishlist');
  if(wishlist)wishlist.insertAdjacentElement('afterend',section);else wrap.append(section);
  st.mount=section;st.state='loading';st.data=null;st.selected='';st.view=null;st.filter=1;
  const search=world.querySelector('.station-search .station-section-heading>span');
  if(search)search.textContent='05 / FIND YOUR NEXT STOP';
  const ranking=world.querySelector('.station-scoreboard > div:first-child > span');
  if(ranking)ranking.textContent='06 / FRIENDS’ RECOMMENDATIONS';
  render();void loadViewer();
}
const observer=new MutationObserver(()=>mount());
observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['data-page']});
if(root?.dataset.page==='travel')mount();

async function loadViewer(){
  const request=++st.serial;st.state='loading';st.error='';render();
  try{
    const {data:auth,error:authError}=await db.auth.getUser();
    if(authError||!auth?.user)throw Error('登录状态已失效，请重新登录');
    const me=auth.user.id;
    const mem=unwrap(await db.from('circle_members').select('circle_id').eq('user_id',me).maybeSingle());
    if(!mem?.circle_id)throw Error('请先加入好友圈');
    const circle=mem.circle_id;
    const [members,settings]=await Promise.all([
      db.from('circle_members').select('user_id').eq('circle_id',circle),
      db.from('travel_share_settings').select('enabled').eq('user_id',me).maybeSingle()
    ]);
    const ids=(unwrap(members)||[]).map(x=>x.user_id).filter(x=>x&&x!==me);
    const profiles=ids.length?unwrap(await db.from('profiles').select('id,nickname').in('id',ids))||[]:[];
    const profileMap=new Map(profiles.map(x=>[x.id,x.nickname]));
    if(request!==st.serial||!st.mount?.isConnected)return;
    st.me=me;st.circle=circle;st.enabled=!!unwrap(settings)?.enabled;
    st.friends=ids.map(uid=>({id:uid,name:profileMap.get(uid)||'圈内好友'}))
      .sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
    st.chosen=st.chosen.filter(uid=>ids.includes(uid)).slice(0,MAX_FRIENDS);
    if(!st.chosen.length&&st.friends.length)st.chosen=[st.friends[0].id];
    st.state='ready';render();
    if(st.enabled&&st.chosen.length)await loadTracks();
  }catch(err){if(request!==st.serial)return;st.state='error';st.error=problem(err);render()}
}

async function toggleShare(enabled){
  if(!st.me||!st.circle)return;
  const original=st.enabled;++st.serial;st.state='saving';
  if(!enabled){st.data=null;st.selected='';st.view=null;}
  render();
  try{
    unwrap(await db.from('travel_share_settings').upsert({user_id:st.me,circle_id:st.circle,enabled,
      updated_at:new Date().toISOString()},{onConflict:'user_id'}));
    st.enabled=enabled;st.state='ready';render();
    notification(enabled?'已开启足迹交汇分享':'已关闭足迹交汇分享');
    if(enabled&&st.chosen.length)await loadTracks();
  }catch(err){st.enabled=original;st.state='ready';render();notification('更新分享设置失败：'+problem(err));
    if(original&&st.chosen.length)void loadTracks()}
}

/** Run 1–3 independent SECURITY DEFINER queries. Every pair is independently
 * checked by Supabase for BOTH users' opt-in and current circle membership.
 * A revoked/non-consenting friend returns no records, never client-side hidden data.
 */
async function loadTracks(){
  if(!st.enabled||!st.me||!st.chosen.length)return;
  const request=++st.serial,chosen=[...st.chosen];
  st.error='';st.state='loading-tracks';st.data=null;st.selected='';st.view=null;render();
  try{
    const results=await Promise.all(chosen.map(friend=>db.rpc('get_travel_crossing_tracks',{p_friend_id:friend})));
    const seen=new Set(),rows=[];
    for(const response of results){
      const chunk=unwrap(response)||[];
      for(const row of chunk){
        if(!row?.traveler_id||!row?.item_id)continue;
        const key=row.traveler_id+'\u0000'+row.item_id;
        if(!seen.has(key)){seen.add(key);rows.push(row)}
      }
    }
    if(request!==st.serial||!st.enabled||chosen.join('|')!==st.chosen.join('|')||!st.mount?.isConnected)return;
    st.data=buildGroupTravelCrossings(rows,[st.me,...chosen]);
    st.filter=Math.min(st.filter,participants().length);
    st.view=initialViewport(st.data.places);
    st.state='ready';render();
  }catch(err){if(request!==st.serial)return;st.state='ready';st.error='足迹读取失败：'+problem(err);render()}
}

function friendPicker(){
  const count=st.chosen.length,disabled=st.state==='saving';
  return `<div class="v69-friend-panel"><div class="v69-friend-head"><strong>选择参与对比的好友</strong><span>我 + ${count} 位好友 · 最多 4 人</span></div>
    <div class="v69-friend-list" role="group" aria-label="选择参与足迹比较的好友，最多三位">
    ${st.friends.map(f=>{
      const selected=st.chosen.includes(f.id),locked=disabled||(!selected&&count>=MAX_FRIENDS);
      return `<button type="button" class="v69-friend-chip ${selected?'is-active':''}" data-v69-action="toggle-friend" data-id="${esc(f.id)}" aria-pressed="${selected}" ${locked?'disabled':''}>
      <i style="background:${selected?travelerColor(f.id):'#AEB5A7'}" aria-hidden="true"></i>${esc(f.name)} ${selected?'✓':'＋'}</button>`;
    }).join('')}</div><small>可选择 1～3 位好友，加上自己共 2～4 人。没有选中时不会加载地图。</small></div>`;
}
function summary(){
  const d=st.data;if(!d)return '';
  const totals=Object.values(d.tracksById).reduce((n,list)=>n+list.length,0);
  return `<div class="v69-summary" aria-label="多人足迹统计"><span><b>${participants().length}</b> 当前参与人数</span><span><b>${totals}</b> 公开足迹记录</span><span class="v69-summary-cross"><b>${d.crossings.length}</b> 交汇站</span></div>`;
}
function currentPlaces(){return st.data?.places.filter(p=>p.count>=st.filter)||[]}
function filterButtons(){
  const n=participants().length;
  return `<button type="button" data-v69-action="set-filter" data-value="1" aria-pressed="${st.filter===1}">全部足迹</button>`+
    Array.from({length:Math.max(0,n-1)},(_,i)=>i+2).map(k=>`<button type="button" data-v69-action="set-filter" data-value="${k}" aria-pressed="${st.filter===k}">${k===n?'全员 '+n+' 人':`至少 ${k} 人`}交汇</button>`).join('');
}
function render(){
  if(!st.mount?.isConnected)return;
  const head=`<div class="v69-heading"><div><span class="v69-eyebrow">04 / WHERE WE CROSS · 轨迹交汇</span>
    <h2>我们走过不同的路，<em>却曾抵达同一站。</em></h2>
    <p>选择最多三位好友，加上自己，在同一张地图上寻找 2～4 人的旅行交集。</p></div>
    <span class="v69-seal" aria-hidden="true">✦<small>SHARED<br>JOURNEY</small></span></div>`;
  const explain='<p class="v69-privacy-note">🔒 仅比较双方分别同意分享、且原记录为「圈内可见、已去过、带坐标」的历史足迹。任一好友未授权，其足迹不会返回；私人记录、实时定位均不参与。交汇是同一地点，并不表示结伴旅行。</p>';
  if(st.state==='loading')return void(st.mount.innerHTML=head+'<div class="v69-loading">正在读取你的好友圈和分享设置…</div>');
  if(st.state==='error')return void(st.mount.innerHTML=head+`<div class="v69-error" role="alert"><strong>暂时无法读取轨迹设置</strong><p>${esc(st.error)}</p><p>首次使用请先运行单独的 V0.6.9 SQL。</p><button type="button" data-v69-action="reload">重试</button></div>`);
  const controls=`<div class="v69-controls"><label class="v69-share-switch"><input type="checkbox" id="v69-share" ${st.enabled?'checked':''} ${st.state==='saving'?'disabled':''}/>
    <span class="v69-switch-visual" aria-hidden="true"></span><span><b>允许好友查看我的公开旅行足迹</b><small>${st.enabled?'已开启 · 仅对同意分享的圈内好友生效':'默认关闭 · 可随时撤销'}</small></span></label>
    <div class="v69-peer"><strong>2～4 人足迹交汇</strong><span>我 + 最多三位好友</span><button type="button" data-v69-action="reload" title="重新同步足迹">↻ 同步</button></div></div>`;
  let content='';
  if(!st.friends.length)content='<div class="v69-no-data">还没有其他圈内好友。邀请朋友加入后，即可一起探索旅行交汇点。</div>';
  else if(!st.enabled)content='<div class="v69-no-data"><strong>开启分享，点亮你们的旅程。</strong><p>分享默认关闭，且每位好友都需要分别同意。只有公开、已到访、有坐标的旅行足迹会参与比较。</p></div>';
  else if(!st.chosen.length)content='<div class="v69-no-data">请至少选择一位好友，开始双人或多人足迹对比。</div>';
  else if(st.state==='loading-tracks')content='<div class="v69-loading">正在逐一核对好友授权，并读取可公开的历史足迹…</div>';
  else if(st.data){
    const d=st.data;
    const legend=participants().map(id=>`<span><i style="background:${travelerColor(id)}"></i>${esc(travelerName(id))}</span>`).join('');
    const visible=currentPlaces();
    const crossings=d.crossings.filter(p=>p.count>=Math.max(st.filter,2));
    content=summary()+`<div class="v69-map-tools"><div class="v69-legend">${legend}<span><i class="v69-dot-cross"></i> 交汇点</span></div>
      <div class="v69-map-buttons">${filterButtons()}<button type="button" data-v69-action="fit">定位全部</button>
      <button type="button" data-v69-action="zoom-out" aria-label="缩小地图">−</button><button type="button" data-v69-action="zoom-in" aria-label="放大地图">+</button></div></div>
      <div class="v69-map-surface" id="v69-map" role="region" aria-label="${participants().length}人历史旅行足迹地图，支持拖动与缩放">
        <svg id="v69-world-svg" viewBox="0 0 1000 500" preserveAspectRatio="none" aria-hidden="true">
          <rect width="1000" height="500" fill="#12372F"/>
          <g class="v69-graticule">${Array.from({length:11},(_,i)=>`<line x1="${i*100}" y1="0" x2="${i*100}" y2="500"/>`).join('')}${Array.from({length:5},(_,i)=>`<line x1="0" y1="${i*100+50}" x2="1000" y2="${i*100+50}"/>`).join('')}</g>
          <g class="v69-land">${WORLD_PATHS.map(path=>`<path d="${path}"/>`).join('')}</g><g class="v69-routes" id="v69-route-lines"></g>
        </svg><div class="v69-map-markers" id="v69-markers"></div>
        <div class="v69-map-foot">历史足迹示意 · 世界地理轮廓 · 可拖动缩放</div></div>
      <div class="v69-map-explainer">虚线只连接能确定时间先后的历史足迹，<strong>不代表</strong>真实行驶路线或同行。只有年份或无日期的地点不会强行连线。</div>
      ${!d.places.length?'<div class="v69-no-data"><strong>当前没有可绘制的公开足迹</strong><p>可能有好友尚未授权，或你们暂时没有带坐标、已去过、圈内可见的记录。旧地点不会按名称猜测坐标。</p></div>':''}
      <div class="v69-crossing-list"><div class="v69-crossing-title"><h3>交汇站纪事</h3><span>${crossings.length} STATIONS · ${st.filter===1?'至少 2 人':`至少 ${st.filter} 人`}</span></div>
      ${crossings.length?`<div class="v69-shared-grid">${crossings.map((p,i)=>`<button type="button" data-v69-action="station" data-id="${esc(p.item_id)}">
        <small>CROSSING ${String(i+1).padStart(2,'0')} · ${p.count} 人到访</small><strong>${esc(p.name)}</strong>
        <span>${p.sameDay?'同日到访（不代表同行）':p.sameYear?'同年到访':'各自旅途曾抵达'} ↗</span></button>`).join('')}</div>`:
      '<p class="v69-empty-crossings">这个人数条件下还没有交汇点。只按同一个共享地点 ID 判断，不因名称相似而匹配。</p>'}</div>
      <div id="v69-memory-card" class="v69-memory-card" aria-live="polite"></div>`;
    if(!visible.length&&d.places.length)content+='<p class="v69-empty-crossings">当前筛选条件下没有地图站点，可以切回「全部足迹」。</p>';
  }
  st.mount.innerHTML=head+controls+friendPicker()+explain+`<div class="v69-viewport">${st.error?`<p class="v69-soft-error" role="alert">${esc(st.error)}</p>`:''}${content}</div>`;
  if(st.data){initializeMap();renderMemory()}
}

function drawMap(){
  const svg=st.mount?.querySelector('#v69-world-svg'),lines=st.mount?.querySelector('#v69-route-lines');
  const markers=st.mount?.querySelector('#v69-markers');if(!svg||!markers||!st.view||!st.data)return;
  const v=st.view;svg.setAttribute('viewBox',`${v.x} ${v.y} ${v.w} ${v.h}`);
  const sw=(v.w/800)*3.1;
  const segmentPath=s=>`M${s.from.x.toFixed(2)},${s.from.y.toFixed(2)} L${s.to.x.toFixed(2)},${s.to.y.toFixed(2)}`;
  lines.innerHTML=st.filter>1?'':participants().flatMap(id=>(st.data.segmentsById[id]||[]).map(s=>
    `<path d="${segmentPath(s)}" stroke="${travelerColor(id)}" stroke-width="${sw}"/>`)).join('');
  markers.innerHTML=currentPlaces().filter(p=>p.point).map(p=>{
    const x=(p.point.x-v.x)/v.w*100,y=(p.point.y-v.y)/v.h*100;
    if(x<0||x>100||y<0||y>100)return '';
    const shared=p.count>=2;
    const color=shared?'#FFF0BD':travelerColor(p.visits[0].traveler_id);
    return `<button type="button" class="v69-pin ${shared?'v69-pin-shared':'v69-pin-single'} ${st.selected===p.item_id?'is-selected':''}"
      data-v69-action="station" data-id="${esc(p.item_id)}" title="${esc(p.name)} · ${p.count} 人到访"
      aria-label="${esc(p.name)} · ${p.count} 位选中的成员到访" style="left:${x.toFixed(3)}%;top:${y.toFixed(3)}%;--v69-pin-color:${color}"><span>${shared?p.count:''}</span></button>`;
  }).join('');
}
function initializeMap(){
  const el=st.mount?.querySelector('#v69-map');if(!el)return;
  if(!st.view)st.view=initialViewport(currentPlaces());
  drawMap();
  let dragging=false,startX=0,startY=0,origin=null;
  el.addEventListener('pointerdown',ev=>{
    if(ev.button!==0||ev.target.closest('button'))return;
    dragging=true;startX=ev.clientX;startY=ev.clientY;origin={...st.view};
    try{el.setPointerCapture(ev.pointerId)}catch(_){}
    el.classList.add('is-dragging');
  });
  el.addEventListener('pointermove',ev=>{
    if(!dragging||!origin)return;
    const bounds=el.getBoundingClientRect();if(!bounds.width||!bounds.height)return;
    st.view=clampViewport({...origin,x:origin.x-(ev.clientX-startX)/bounds.width*origin.w,
      y:origin.y-(ev.clientY-startY)/bounds.height*origin.h});drawMap();
  });
  const stop=()=>{dragging=false;origin=null;el.classList.remove('is-dragging')};
  el.addEventListener('pointerup',stop);el.addEventListener('pointercancel',stop);
  el.addEventListener('wheel',ev=>{
    if(!st.view)return;ev.preventDefault();const r=el.getBoundingClientRect();
    const fx=Math.max(0,Math.min(1,(ev.clientX-r.left)/r.width));
    const fy=Math.max(0,Math.min(1,(ev.clientY-r.top)/r.height));
    st.view=zoomViewport(st.view,ev.deltaY>0?1.18:.84,fx,fy);drawMap();
  },{passive:false});
}
function note(record,id){
  const label=travelerName(id),color=travelerColor(id);
  if(!record)return `<div class="v69-memory-empty" style="--v69-person-color:${color}"><b>${esc(label)}</b><p>没有可展示的公开车票，或尚未同意分享</p></div>`;
  const dt=formatTravelDate(record.visited_on,record.visit_date_precision);
  const score=record.rating==null?'未评分':Number(record.rating).toFixed(1)+' / 10';
  const safe=esc(record.note||'');
  return `<div class="v69-person-memory" style="--v69-person-color:${color}"><span>${esc(label)}</span><strong>${esc(dt)}</strong><small>${esc(score)}</small>${record.note?
    record.spoiler?`<p>这段感想标记为剧透，默认隐藏。</p><button type="button" data-v69-action="reveal" aria-expanded="false">展开感想</button><p class="v69-hidden-note" hidden>${safe}</p>`:
    `<p>“${safe}”</p>`:'<p>没有写下旅行感想。</p>'}</div>`;
}
function renderMemory(){
  const el=st.mount?.querySelector('#v69-memory-card');if(!el||!st.data)return;
  const selected=st.data.places.find(p=>p.item_id===st.selected);
  if(!selected){el.innerHTML='<p class="v69-memory-placeholder">点击地图站点或交汇卡，就能翻阅最多四个人在同一地点留下的公开旅行回忆。</p>';return}
  el.innerHTML=`<div class="v69-memory-head"><span>${selected.shared?'CROSSING STATION · 我们的交汇':'JOURNEY STATION · 旅途档案'}</span>
    <h3>${esc(selected.name)}</h3><p>${esc(selected.subtitle||'')} · ${selected.count} 人到访</p>
    ${selected.sameDay?'<strong>✦ 同一天到访，不代表共同出行</strong>':''}</div>
    <div class="v69-memories">${participants().map(id=>note(selected.visits.find(r=>r.traveler_id===id),id)).join('')}</div>`;
}
document.addEventListener('click',ev=>{
  const t=ev.target.closest('[data-v69-action]');if(!t||!st.mount?.contains(t))return;
  const a=t.dataset.v69Action;
  if(a==='reload')void loadViewer();
  else if(a==='toggle-friend'){
    const id=t.dataset.id;if(!st.friends.some(f=>f.id===id))return;
    if(st.chosen.includes(id))st.chosen=st.chosen.filter(x=>x!==id);
    else if(st.chosen.length<MAX_FRIENDS)st.chosen=[...st.chosen,id];
    ++st.serial;st.error='';st.data=null;st.selected='';st.view=null;st.filter=1;st.state='ready';render();
    if(st.enabled&&st.chosen.length)void loadTracks();
  }
  else if(a==='station'){
    st.selected=t.dataset.id;drawMap();renderMemory();
    st.mount.querySelector('#v69-memory-card')?.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  else if(a==='fit'){st.view=initialViewport(currentPlaces());drawMap()}
  else if(a==='zoom-in'){st.view=zoomViewport(st.view,.72);drawMap()}
  else if(a==='zoom-out'){st.view=zoomViewport(st.view,1.38);drawMap()}
  else if(a==='set-filter'){
    const next=Number(t.dataset.value);
    if(!Number.isInteger(next)||next<1||next>participants().length)return;
    st.filter=next;st.view=initialViewport(currentPlaces());
    if(!currentPlaces().some(p=>p.item_id===st.selected))st.selected='';render();
  }
  else if(a==='reveal'){
    const p=t.nextElementSibling;if(!p)return;
    p.hidden=!p.hidden;t.setAttribute('aria-expanded',String(!p.hidden));t.textContent=p.hidden?'展开感想':'收起感想';
  }
});
document.addEventListener('change',ev=>{
  if(!st.mount?.contains(ev.target))return;
  if(ev.target.id==='v69-share')void toggleShare(ev.target.checked);
});
const refreshOnResume=()=>{
  if(document.visibilityState==='visible'&&root.dataset.page==='travel'&&st.mount?.isConnected&&st.state==='ready')void loadViewer();
};
document.addEventListener('visibilitychange',refreshOnResume);
window.addEventListener('focus',refreshOnResume);
