/** 同频 V0.6.9 · 轨迹交汇 / WHERE WE CROSS
 * Read-only dual history map. Every friend row comes from an opt-in-gated,
 * authenticated Supabase RPC, NOT the existing generic experiences feed.
 * Natural Earth world outlines are included offline; NO new map key needed.
 */
import {db,ready} from './cloud.js';
import {formatTravelDate} from './travelArchiveModel.js';
import {WORLD_PATHS} from './travelWorldMap.js';
import {buildTravelCrossings,initialViewport,clampViewport,zoomViewport} from './travelCrossingModel.js';
import './v069-crossing.css';

const root=document.getElementById('page');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const st={mount:null,me:null,circle:null,friends:[],friend:'',enabled:false,
  state:'idle',error:'',data:null,map:null,view:null,selected:'',filter:'all',serial:0};
const notification=msg=>{const toast=document.getElementById('toast');if(!toast)return;toast.textContent=msg;toast.classList.add('visible');setTimeout(()=>{if(toast.textContent===msg)toast.classList.remove('visible')},3300)};
const problem=err=>err?.message||String(err);
const unwrap=r=>{if(r?.error)throw r.error;return r?.data};
const friendName=()=>st.friends.find(f=>f.id===st.friend)?.name||'好友';

function mount(){
  if(root?.dataset.page!=='travel'||!ready||!db)return;
  const world=root.querySelector('.railway-world'),wrap=world?.querySelector('.v68-archive-wrap');
  if(!world||!wrap||world.dataset.v69==='1')return;
  world.dataset.v69='1';
  const section=document.createElement('section');section.id='v69-crossing';section.className='station-panel v69-crossing';
  section.setAttribute('aria-label','与好友的轨迹交汇');
  const wishlist=wrap.querySelector('.v68-wishlist');
  if(wishlist)wishlist.insertAdjacentElement('afterend',section);else wrap.append(section);
  st.mount=section;st.state='loading';st.data=null;st.selected='';st.map=null;st.view=null;
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
  const id=++st.serial;st.state='loading';st.error='';render();
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
    if(id!==st.serial||!st.mount?.isConnected)return;
    st.me=me;st.circle=circle;st.enabled=!!unwrap(settings)?.enabled;
    st.friends=ids.map(uid=>({id:uid,name:profileMap.get(uid)||'圈内好友'})).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
    if(!st.friends.some(f=>f.id===st.friend))st.friend=st.friends[0]?.id||'';
    st.state='ready';render();
    if(st.enabled&&st.friend)await loadTracks();
  }catch(err){if(id!==st.serial)return;st.state='error';st.error=problem(err);render()}
}

async function toggleShare(enabled){
  if(!st.me||!st.circle)return;
  const original=st.enabled;++st.serial;st.state='saving';
  if(!enabled){st.data=null;st.selected='';st.map=null;st.view=null;} // instant local revoke
  render();
  try{
    unwrap(await db.from('travel_share_settings').upsert({user_id:st.me,circle_id:st.circle,enabled,
      updated_at:new Date().toISOString()},{onConflict:'user_id'}));
    st.enabled=enabled;st.state='ready';render();
    notification(enabled?'已开启足迹交汇分享':'已关闭足迹交汇分享');
    if(enabled&&st.friend)await loadTracks();
  }catch(err){st.enabled=original;st.state='ready';render();notification('更新分享设置失败：'+problem(err));
    if(original&&st.friend)void loadTracks();}
}

async function loadTracks(){
  if(!st.enabled||!st.me||!st.friend)return;
  const id=++st.serial,friend=st.friend;
  st.error='';st.state='loading-tracks';st.data=null;st.selected='';st.map=null;st.view=null;render();
  try{
    const rows=unwrap(await db.rpc('get_travel_crossing_tracks',{p_friend_id:friend}));
    if(id!==st.serial||!st.enabled||st.friend!==friend)return;
    st.data=buildTravelCrossings(rows||[],st.me,friend);
    st.view=initialViewport(st.data.places);
    st.state='ready';render();
  }catch(err){if(id!==st.serial)return;st.state='ready';st.error='足迹读取失败：'+problem(err);render()}
}

function summary(){const d=st.data;
  if(!d)return '';
  return `<div class="v69-summary" aria-label="双人足迹统计"><span><b>${d.own.length}</b> 我的公开足迹</span><span><b>${d.friend.length}</b> 好友公开足迹</span><span class="v69-summary-cross"><b>${d.crossings.length}</b> 交汇站</span></div>`;
}
function selectOptions(){return st.friends.map(f=>`<option value="${esc(f.id)}" ${st.friend===f.id?'selected':''}>${esc(f.name)}</option>`).join('')}
function render(){
  if(!st.mount?.isConnected)return;
  const head=`<div class="v69-heading"><div><span class="v69-eyebrow">04 / WHERE WE CROSS · 轨迹交汇</span><h2>我们走过不同的路，<em>却曾抵达同一站。</em></h2><p>选择一位好友，在历史旅行地图上查看彼此的公开足迹与共同抵达的地点。</p></div><span class="v69-seal" aria-hidden="true">✦<small>SHARED<br>JOURNEY</small></span></div>`;
  const explain='<p class="v69-privacy-note">🔒 足迹分享默认关闭。双方都主动开启后，地图才会显示「圈内可见、去过、带坐标」的车票，以及其中公开的日期、评分和感想。私人记录不参与，不会读取实时位置。</p>';
  if(st.state==='loading')return void(st.mount.innerHTML=head+'<div class="v69-loading">正在读取你的好友圈和分享设置…</div>');
  if(st.state==='error')return void(st.mount.innerHTML=head+`<div class="v69-error" role="alert"><strong>暂时无法读取轨迹设置</strong><p>${esc(st.error)}</p><p>如果是首次升级，请确认已执行 V0.6.9 SQL。</p><button type="button" data-v69-action="reload">重试</button></div>`);
  const controls=`<div class="v69-controls"><label class="v69-share-switch"><input type="checkbox" id="v69-share" ${st.enabled?'checked':''} ${st.state==='saving'?'disabled':''}/><span class="v69-switch-visual" aria-hidden="true"></span><span><b>允许好友查看我的公开旅行足迹</b><small>${st.enabled?'已开启 · 仅对同意分享的圈内好友生效':'默认关闭 · 可随时撤销'}</small></span></label><div class="v69-peer"><label for="v69-friend">与谁交汇？</label><select id="v69-friend" ${st.state==='saving'||!st.friends.length?'disabled':''}>${selectOptions()}</select><button type="button" data-v69-action="reload" title="重新同步足迹">↻ 同步</button></div></div>`;
  let content='';
  if(!st.friends.length)content='<div class="v69-no-data">还没有其他圈内好友。邀请朋友加入同频后，就可以探索你们的共同旅行记忆。</div>';
  else if(!st.enabled)content='<div class="v69-no-data"><strong>开启分享，点亮两条旅程。</strong><p>双方开启后，只会比较各自明确设为「圈内可见」的历史旅行记录。私人车票不会参与交汇。</p></div>';
  else if(st.state==='loading-tracks')content='<div class="v69-loading">正在核对双方的分享许可与地理足迹…</div>';
  else if(st.data){
    const d=st.data;
    content=summary()+`<div class="v69-map-tools"><div class="v69-legend"><span><i class="v69-dot-mine"></i> 我的轨迹</span><span><i class="v69-dot-friend"></i> ${esc(friendName())}的轨迹</span><span><i class="v69-dot-cross"></i> 共同到访</span></div><div class="v69-map-buttons"><button type="button" data-v69-action="show-all" ${st.filter==='all'?'aria-pressed="true"':''}>全部足迹</button><button type="button" data-v69-action="show-shared" ${st.filter==='shared'?'aria-pressed="true"':''}>只看交汇</button><button type="button" data-v69-action="fit">定位全部</button><button type="button" data-v69-action="zoom-out" aria-label="缩小地图">−</button><button type="button" data-v69-action="zoom-in" aria-label="放大地图">+</button></div></div>
      <div class="v69-map-surface" id="v69-map" role="region" aria-label="双人历史足迹交汇地图，支持拖动与缩放">
        <svg id="v69-world-svg" viewBox="0 0 1000 500" preserveAspectRatio="none" aria-hidden="true">
          <rect width="1000" height="500" fill="#12372F"/>
          <g class="v69-graticule">${Array.from({length:11},(_,i)=>`<line x1="${i*100}" y1="0" x2="${i*100}" y2="500"/>`).join('')}${Array.from({length:5},(_,i)=>`<line x1="0" y1="${i*100+50}" x2="1000" y2="${i*100+50}"/>`).join('')}</g>
          <g class="v69-land">${WORLD_PATHS.map(path=>`<path d="${path}"/>`).join('')}</g><g class="v69-routes" id="v69-route-lines"></g>
        </svg><div class="v69-map-markers" id="v69-markers"></div>
        <div class="v69-map-foot">可拖动、滚轮缩放 · Natural Earth（公共领域）地图轮廓 · 仅为历史足迹示意</div>
      </div><div class="v69-map-explainer">连线只表示有明确日期先后顺序的到访地点，<strong>不是</strong>真实交通路线。日期不完整、时间顺序不确定的地点只显示位置点。</div>
      ${d.places.length?'':`<div class="v69-no-data"><strong>尚无可绘制的公开足迹</strong><p>可能是另一位好友尚未开启分享，或双方没有「圈内可见、去过、带坐标」的记录。以前的地点如未保存经纬度也不会显示，系统不会猜测位置。</p></div>`}
      <div class="v69-crossing-list"><div class="v69-crossing-title"><h3>交汇站纪事</h3><span>${d.crossings.length} STATIONS</span></div>
      ${d.crossings.length?`<div class="v69-shared-grid">${d.crossings.map((p,i)=>`<button type="button" data-v69-action="station" data-id="${esc(p.item_id)}"><small>CROSSING ${String(i+1).padStart(2,'0')}</small><strong>${esc(p.name)}</strong><span>${p.sameDay?'同日到访 · 不代表同行':p.sameYear?'同年到访':'曾在不同旅程中抵达'} ↗</span></button>`).join('')}</div>`:'<p class="v69-empty-crossings">暂时没有两个人都到过的同一处站点。共同地点按同频共享地点 ID 精确匹配，不根据相似名称猜测。</p>'}</div>
      <div id="v69-memory-card" class="v69-memory-card" aria-live="polite"></div>`;
  }
  st.mount.innerHTML=head+controls+explain+`<div class="v69-viewport">${st.error?`<p class="v69-soft-error" role="alert">${esc(st.error)}</p>`:''}${content}</div>`;
  if(st.data){initializeMap();renderMemory()}
}

function filteredPlaces(){return st.data?.places.filter(p=>st.filter==='all'||p.shared)||[]}
function drawMap(){
  const svg=st.mount?.querySelector('#v69-world-svg'),lines=st.mount?.querySelector('#v69-route-lines');
  const markers=st.mount?.querySelector('#v69-markers');if(!svg||!markers||!st.view||!st.data)return;
  const v=st.view;svg.setAttribute('viewBox',`${v.x} ${v.y} ${v.w} ${v.h}`);
  const sw=(v.w/800)*3.1;
  const segmentPath=s=>`M${s.from.x.toFixed(2)},${s.from.y.toFixed(2)} L${s.to.x.toFixed(2)},${s.to.y.toFixed(2)}`;
  lines.innerHTML=st.filter==='shared'?'':[
    ...st.data.mySegments.map(s=>`<path d="${segmentPath(s)}" stroke="#8EE2BD" stroke-width="${sw}"/>`),
    ...st.data.friendSegments.map(s=>`<path d="${segmentPath(s)}" stroke="#F0D28A" stroke-width="${sw}"/>`)
  ].join('');
  markers.innerHTML=filteredPlaces().filter(p=>p.point).map(p=>{
    const x=(p.point.x-v.x)/v.w*100,y=(p.point.y-v.y)/v.h*100;
    if(x<0||x>100||y<0||y>100)return '';
    const type=p.shared?'shared':p.mine?'mine':'friend';
    return `<button type="button" class="v69-pin v69-pin-${type} ${st.selected===p.item_id?'is-selected':''}" data-v69-action="station" data-id="${esc(p.item_id)}" title="${esc(p.name)}" aria-label="${esc(p.name)} · ${p.shared?'共同到访':p.mine?'我的足迹':'好友的足迹'}" style="left:${x.toFixed(3)}%;top:${y.toFixed(3)}%"><span>${p.shared?'✦':''}</span></button>`;
  }).join('');
}
function initializeMap(){
  const el=st.mount?.querySelector('#v69-map');if(!el)return;
  if(!st.view)st.view=initialViewport(st.data.places);
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
function note(record,label){if(!record)return `<div class="v69-memory-empty"><b>${esc(label)}</b><p>没有这张公开车票</p></div>`;
  const dt=formatTravelDate(record.visited_on,record.visit_date_precision);
  const score=record.rating==null?'未评分':Number(record.rating).toFixed(1)+' / 10';
  const safe=esc(record.note||'');
  return `<div class="v69-person-memory"><span>${esc(label)}</span><strong>${esc(dt)}</strong><small>${esc(score)}</small>${record.note?
    record.spoiler?`<p>此回忆包含剧透，默认隐藏。</p><button type="button" data-v69-action="reveal" aria-expanded="false">展开感想</button><p class="v69-hidden-note" hidden>${safe}</p>`:`<p>“${safe}”</p>`:'<p>没有写下旅行感想。</p>'}</div>`;
}
function renderMemory(){const el=st.mount?.querySelector('#v69-memory-card');if(!el||!st.data)return;
  const selected=st.data.places.find(p=>p.item_id===st.selected);
  if(!selected){el.innerHTML='<p class="v69-memory-placeholder">点击地图站点或下方交汇卡片，就能翻阅两个人在同一地点留下的回忆。</p>';return}
  el.innerHTML=`<div class="v69-memory-head"><span>${selected.shared?'CROSSING STATION · 我们的交汇':'JOURNEY STATION · 旅途档案'}</span><h3>${esc(selected.name)}</h3><p>${esc(selected.subtitle||'')}</p>${selected.sameDay?'<strong>✦ 同一天到访，但不代表共同出行</strong>':''}</div>
    <div class="v69-memories">${note(selected.mine,'我的足迹')}${note(selected.friend,friendName()+'的足迹')}</div>`;
}

st.map=null;
document.addEventListener('click',ev=>{
  const t=ev.target.closest('[data-v69-action]');if(!t||!st.mount?.contains(t))return;
  const a=t.dataset.v69Action;
  if(a==='reload')void loadViewer();
  else if(a==='station'){
    st.selected=t.dataset.id;drawMap();renderMemory();
    st.mount.querySelector('#v69-memory-card')?.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  else if(a==='fit'){st.view=initialViewport(filteredPlaces());drawMap()}
  else if(a==='zoom-in'){st.view=zoomViewport(st.view,.72);drawMap()}
  else if(a==='zoom-out'){st.view=zoomViewport(st.view,1.38);drawMap()}
  else if(a==='show-all'||a==='show-shared'){
    st.filter=a==='show-all'?'all':'shared';st.view=initialViewport(filteredPlaces());render();
  }
  else if(a==='reveal'){
    const p=t.nextElementSibling;if(!p)return;
    p.hidden=!p.hidden;t.setAttribute('aria-expanded',String(!p.hidden));t.textContent=p.hidden?'展开感想':'收起感想';
  }
});
document.addEventListener('change',ev=>{
  if(!st.mount?.contains(ev.target))return;
  if(ev.target.id==='v69-share')void toggleShare(ev.target.checked);
  else if(ev.target.id==='v69-friend'){
    st.friend=ev.target.value;st.data=null;st.selected='';st.error='';st.view=null;st.filter='all';
    if(st.enabled)void loadTracks();else render();
  }
});
const refreshOnResume=()=>{if(document.visibilityState==='visible'&&root.dataset.page==='travel'&&st.mount?.isConnected&&st.state==='ready')void loadViewer()};
document.addEventListener('visibilitychange',refreshOnResume);
window.addEventListener('focus',refreshOnResume);
