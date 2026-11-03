/** 同频 V0.6.8 · 旅途年鉴
 * Standalone integration on #travel. Existing homepage, auth, place search and
 * friend ranking stay intact. Own records are read/written under Supabase RLS.
 */
import {db,ready} from './cloud.js';
import {ARCHIVE_PAGE_SIZE,normalizeTravelRecord,normalizeTravelDate,formatTravelDate,buildTravelArchive,groupArchiveByYear} from './travelArchiveModel.js';
import './v068-travel-archive.css';

const page=document.getElementById('page');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={userId:null,circleId:null,places:[],records:[],year:'all',sort:'recent',page:1,wishPage:1,
  loading:false,error:'',mount:null,seq:0,selection:null,remote:[],searchSerial:0,searchAbort:null};
let dialog=document.createElement('div');dialog.id='v068-dialog-root';document.body.append(dialog);
let queryTimer=null;

function findById(id){return state.places.find(p=>p.id===id)}
function ownRecord(itemId){return state.records.find(r=>r.item_id===itemId)}
function getThemeLabel(record){return record.visibility==='circle'?'👥 圈内可见':'🔒 仅自己可见'}
function stamp(record){return formatTravelDate(record.visited_on,record.visit_date_precision)}
function showMessage(text){const toast=document.getElementById('toast');if(toast){toast.textContent=text;toast.classList.add('visible');setTimeout(()=>{if(toast.textContent===text)toast.classList.remove('visible')},3700)}}
function message(err){return err?.message||String(err)}
function errorIf(result){if(result?.error)throw result.error;return result?.data}
async function getPagewise(table,select,scope,order){
  const rows=[],size=300;
  for(let offset=0;offset<12000;offset+=size){
    let q=db.from(table).select(select);
    if(scope)q=q.eq(scope[0],scope[1]);
    if(order)q=q.order(order,{ascending:true});
    else q=q.order('updated_at',{ascending:false});
    q=q.order('id',{ascending:true});
    const {data,error}=await q.range(offset,offset+size-1);
    if(error)throw error;
    if(!Array.isArray(data))throw Error('云端返回的记录格式无效');
    rows.push(...data);
    if(data.length<size)return rows;
  }
  throw Error('旅行记录较多，当前安全分页上限为 12000 条');
}
async function fetchArchive(){
  if(!ready||!db)return;
  const current=++state.seq;state.loading=true;state.error='';updatePanels();
  try{
    const {data:auth,error:authError}=await db.auth.getUser();if(authError||!auth?.user){state.userId=null;state.circleId=null;state.records=[];state.places=[];return;}
    const uid=auth.user.id;
    const member=errorIf(await db.from('circle_members').select('circle_id').eq('user_id',uid).maybeSingle());
    if(!member?.circle_id){state.userId=null;state.circleId=null;state.records=[];state.places=[];return;}
    const [places,records]=await Promise.all([
      getPagewise('catalog_items','id,category,name,subtitle,provider,provider_item_id,place_latitude,place_longitude,place_coordinate_system', ['category','place'],'created_at'),
      getPagewise('experiences','id,user_id,item_id,status,rating,note,spoiler,visibility,visited_on,visit_date_precision,updated_at',['user_id',uid],null)
    ]);
    if(current!==state.seq)return;
    state.userId=uid;state.circleId=member.circle_id;state.places=places;state.records=records;
  }catch(err){if(current!==state.seq)return;state.error=message(err);}
  finally{if(current===state.seq){state.loading=false;updatePanels()}}
}
function pageSlice(rows,n,size=ARCHIVE_PAGE_SIZE){const max=Math.max(1,Math.ceil(rows.length/size));const p=Math.min(max,Math.max(1,n));return {rows:rows.slice((p-1)*size,p*size),page:p,total:max}}
function paging(action,page,total){return total<=1?'':`<div class="v68-pagination"><button type="button" data-v68-action="${action}" data-page="${page-1}" ${page<=1?'disabled':''}>上一页</button><span>${page} / ${total}</span><button type="button" data-v68-action="${action}" data-page="${page+1}" ${page>=total?'disabled':''}>下一页</button></div>`}
function card(record,ordinal){const place=record.place;
  const hasDate=!!record.visited_on,score=record.rating!=null?Number(record.rating).toFixed(1)+' / 10':'未评分';
  return `<button class="v68-ticket" type="button" data-v68-action="edit" data-id="${esc(place.id)}" aria-label="编辑 ${esc(place.name)} 的旅行记录">
    <span class="v68-ticket-head"><b>RES · JOURNEY ${String(ordinal).padStart(3,'0')}</b><small>${hasDate?esc(stamp(record)):'DATE UNKNOWN'}</small></span>
    <strong>${esc(place.name)}</strong><span class="v68-ticket-sub">${esc(place.subtitle||'我的旅行地点')}</span>
    ${record.note?`<span class="v68-ticket-note">“${esc(record.note.slice(0,100))}${record.note.length>100?'…':''}”</span>`:'<span class="v68-ticket-note v68-note-empty">点击写下旅途中值得记住的事</span>'}
    <span class="v68-ticket-foot"><span>${esc(getThemeLabel(record))}${!hasDate?' · 日期未记':''}</span><b>${esc(score)}</b></span>
    <span class="v68-arrived">ARRIVED</span>
  </button>`
}
function wishlistCard(r){return `<button class="v68-wish-ticket" type="button" data-v68-action="edit" data-id="${esc(r.place.id)}">
  <span class="v68-wish-kicker">NEXT STOP · 未启程</span><strong>${esc(r.place.name)}</strong>
  <small>${esc(r.place.subtitle||'未来的目的地')}</small>
  <span class="v68-wish-bottom">${esc(getThemeLabel(r))}<b>记录到访 ↗</b></span></button>`}
function updatePanels(){const world=state.mount;if(!world?.isConnected)return;
  const archive=world.querySelector('#v68-archive'),wish=world.querySelector('#v68-wishlist');
  if(!archive||!wish)return;
  if(state.loading){archive.innerHTML='<div class="v68-loading">正在整理你的旅行回忆…</div>';wish.innerHTML='';return}
  if(state.error){archive.innerHTML=`<div class="v68-error"><strong>旅行档案暂时无法载入</strong><p>${esc(state.error)}</p><p>请确认已先执行 migration_v068.sql。</p><button type="button" data-v68-action="reload">重试</button></div>`;wish.innerHTML='';return}
  const dataset=buildTravelArchive(state.records,state.places,{year:state.year,sort:state.sort});
  const allYears=dataset.years.map(y=>`<option value="${esc(y)}" ${state.year===y?'selected':''}>${esc(y)} 年</option>`).join('');
  const sectionHead=`<div class="v68-section-title"><div><span>02 / THE JOURNEY ARCHIVE</span><h2>我的旅行年鉴</h2><p>按真实到访时间整理回忆，不再使用编辑时间冒充旅行时间。</p></div><button type="button" class="v68-main-btn" data-v68-action="new">＋ 记录一段旅程</button></div>`;
  const controls=`<div class="v68-toolbar"><label>年份 <select data-v68-control="year"><option value="all">全部年份</option>${allYears}<option value="undated" ${state.year==='undated'?'selected':''}>日期未记</option></select></label><label>排序 <select data-v68-control="sort"><option value="recent" ${state.sort==='recent'?'selected':''}>最近到访</option><option value="oldest" ${state.sort==='oldest'?'selected':''}>最早到访</option><option value="rating" ${state.sort==='rating'?'selected':''}>评分最高</option></select></label><span>${dataset.done.length} 张已抵达车票</span></div>`;
  const paged=pageSlice(dataset.filtered,state.page);state.page=paged.page;
  const grouping=state.sort==='rating'?[{year:'按评分排序',records:paged.rows}]:groupArchiveByYear(paged.rows);
  const tickets=grouping.map((g,i)=>`<div class="v68-year-group"><h3><span>${esc(g.year)}</span><i></i><small>${g.records.length} 张车票</small></h3><div class="v68-ticket-grid">${g.records.map((r,j)=>card(r,(state.page-1)*ARCHIVE_PAGE_SIZE+j+1)).join('')}</div></div>`).join('');
  archive.innerHTML=sectionHead+controls+(tickets||'<div class="v68-empty">这里还没有对应的旅行回忆。<button type="button" data-v68-action="new">记录我的第一段旅程 →</button></div>')+paging('archive-page',paged.page,paged.total);
  const wishes=pageSlice(dataset.wishList,state.wishPage,9);state.wishPage=wishes.page;
  wish.innerHTML=`<div class="v68-section-title"><div><span>03 / NEXT STATION</span><h2>下一站想去</h2><p>愿望不需要评分。等真正抵达，再为它盖上一枚旅途印章。</p></div><b>${dataset.wishes.length} 个心愿</b></div>`+
    (wishes.rows.length?`<div class="v68-wishlist-grid">${wishes.rows.map(wishlistCard).join('')}</div>`:'<div class="v68-empty">还没有想去的地点。你可以先收藏一座城市，把出发留给未来。</div>')+
    paging('wish-page',wishes.page,wishes.total);
  const board=world.querySelector('.railway-departure small');if(board)board.textContent=`${dataset.done.length} 张已抵达车票 · ${dataset.wishes.length} 个未来目的地`;
  const heroStats=world.querySelector('#v68-hero-stats');if(heroStats)heroStats.innerHTML=`<span><b>${dataset.done.length}</b> 已去过</span><span><b>${dataset.wishes.length}</b> 想去</span><span><b>${dataset.yearCount}</b> 旅行年份</span>`;
}
function mount(){
  if(page.dataset.page!=='travel')return;
  const world=page.querySelector('.railway-world');if(!world||world.dataset.v68==='1')return;
  world.dataset.v68='1';state.mount=world;
  world.querySelector('.station-collection')?.remove(); // replaced by our own itinerary, old records remain in DB
  const afterHero=world.querySelector('.railway-hero');if(!afterHero)return;
  const sections=document.createElement('div');sections.className='v68-archive-wrap';
  sections.innerHTML='<section id="v68-archive" class="station-panel v68-archive" aria-label="我的旅行年鉴"></section><section id="v68-wishlist" class="station-panel v68-wishlist" aria-label="下一站想去"></section>';
  afterHero.insertAdjacentElement('afterend',sections);
  const search=world.querySelector('.station-search'),ranking=world.querySelector('.station-scoreboard');
  const title=search?.querySelector('.station-section-heading>span');if(title)title.textContent='04 / FIND YOUR NEXT STOP';
  const rhead=ranking?.querySelector('div:first-child > span');if(rhead)rhead.textContent='05 / FRIENDS’ RECOMMENDATIONS';
  const hero=document.createElement('div');hero.className='v68-hero-panel';
  hero.innerHTML=`<div id="v68-hero-stats"><span>旅途档案准备中…</span></div><button type="button" data-v68-action="new">＋ 记录一段旅程</button>`;
  afterHero.append(hero);
  const tools=document.createElement('div');tools.className='v68-tools';
  tools.innerHTML=`<span>YOUR MEMORY, YOUR ROUTE</span><button type="button" data-v68-action="export">导出旅行档案 JSON</button><button type="button" data-v68-action="import">恢复旅行档案 JSON</button><input id="v68-import-input" type="file" accept="application/json,.json" hidden>`;
  sections.append(tools);
  updatePanels();void fetchArchive();
}
const observer=new MutationObserver(()=>{if(page.dataset.page==='travel')mount();});
observer.observe(page,{childList:true,attributes:true,attributeFilter:['data-page']});
if(page.dataset.page==='travel')mount();

function closeDialog(){state.searchAbort?.abort();state.searchSerial++;state.selection=null;dialog.innerHTML=''}
function editPlace(itemId){const place=findById(itemId);if(place)openEditor(place)}
function openPicker(){if(state.loading){showMessage('正在同步旅行地点，请稍后再操作');return}if(state.error){showMessage('旅行数据尚未加载，请先检查 SQL 迁移');return}state.selection=null;state.remote=[];dialog.innerHTML=`<div class="v68-modal-shade"><div class="v68-modal v68-picker" role="dialog" aria-modal="true" aria-label="选择旅行地点">
  <div class="v68-modal-head"><div><span>NEW JOURNEY / START</span><h2>这段旅程，发生在哪里？</h2></div><button data-v68-action="close-dialog" aria-label="关闭">×</button></div>
  <label class="v68-search-label">搜索已收藏地点或高德地标<input id="v68-place-query" type="search" placeholder="例如：杭州西湖、京都、北京故宫" autocomplete="off" autofocus /></label>
  <div id="v68-picker-results"></div><p class="v68-picker-hint">无须开启位置权限；这里只搜索地点名称，不读取你的实时位置。</p>
  <button type="button" class="v68-inline-btn" data-v68-action="manual">＋ 手动创建一个新地点</button>
 </div></div>`;renderPicker();dialog.querySelector('#v68-place-query')?.focus()}
function renderPicker(){const slot=dialog.querySelector('#v68-picker-results');if(!slot)return;
  const q=String(dialog.querySelector('#v68-place-query')?.value||'').trim().toLocaleLowerCase();
  const local=state.places.filter(p=>!q||`${p.name} ${p.subtitle||''}`.toLocaleLowerCase().includes(q)).slice(0,12);
  const localHtml=local.map(p=>`<button class="v68-pick-row" data-v68-action="select-local" data-id="${esc(p.id)}"><span>📍 <b>${esc(p.name)}</b><small>${esc(p.subtitle||'共享车站')}</small></span><em>${ownRecord(p.id)?'已有车票':'选择 →'}</em></button>`).join('');
  const remoteHtml=state.remote.map((p,i)=>`<button class="v68-pick-row" data-v68-action="select-remote" data-index="${i}"><span>🗺 <b>${esc(p.name)}</b><small>${esc(p.subtitle||'高德 POI')}</small></span><em>${p.location?'含地理坐标':'高德地点'} →</em></button>`).join('');
  slot.innerHTML=`<h3>共享车站 ${q?'· 匹配结果':''}</h3>${localHtml||'<p class="v68-muted">未找到已有车站</p>'}`+
    (q.length>=2?`<h3>高德地点检索</h3><div id="v68-online-results">${remoteHtml||'<p class="v68-muted">输入关键词后显示在线结果</p>'}</div>`:'');
}
async function remoteSearch(){const q=String(dialog.querySelector('#v68-place-query')?.value||'').trim();const token=++state.searchSerial;
  state.searchAbort?.abort();state.remote=[];renderPicker();if(q.length<2)return;
  const results=dialog.querySelector('#v68-online-results');if(results)results.innerHTML='<p class="v68-muted">高德检索中…</p>';
  const controller=new AbortController();state.searchAbort=controller;
  try{
    const session=errorIf(await db.auth.getSession())?.session;
    if(!session?.access_token)throw Error('登录已过期，请重新登录');
    const base=(import.meta.env.VITE_SEARCH_API_BASE||'').trim().replace(/\/$/,'');
    const response=await fetch(`${base}/api/travel-places?q=${encodeURIComponent(q)}`,{headers:{Authorization:`Bearer ${session.access_token}`},signal:controller.signal});
    const body=await response.json().catch(()=>({}));if(!response.ok)throw Error(body.error||'高德搜索失败');
    if(token!==state.searchSerial)return;
    state.remote=Array.isArray(body.items)?body.items:[];
    renderPicker();
    const box=dialog.querySelector('#v68-online-results');if(box&&!state.remote.length)box.innerHTML='<p class="v68-muted">没有找到匹配的高德地点。可以调整关键词或手动创建。</p>';
  }catch(error){if(token!==state.searchSerial||controller.signal.aborted)return;
    const box=dialog.querySelector('#v68-online-results');if(box)box.innerHTML=`<p class="v68-muted">${esc(message(error))}</p>`;
  }
}
function showManual(){state.selection={type:'manual',name:'',subtitle:''};openEditor(null)}
function chooseRemote(i){const item=state.remote[i];if(!item)return;
  const existing=state.places.find(p=>p.provider==='amap'&&p.provider_item_id===item.providerItemId);
  if(existing)return openEditor(existing);
  state.selection={type:'remote',...item};openEditor(null);
}
function formatDateParts(record){const s=String(record?.visited_on||'');
  return {year:/^\d{4}/.test(s)?s.slice(0,4):'',month:/^\d{4}-\d{2}/.test(s)?Number(s.slice(5,7)):'',day:record?.visit_date_precision==='day'?Number(s.slice(8,10)):''};
}
function openEditor(place){const old=place?ownRecord(place.id):null,source=state.selection,hasPlace=!!place;
  state.selection=hasPlace?{type:'local',itemId:place.id}:source;
  const rec=old||{status:'done',rating:null,note:'',visibility:'private',visit_date_precision:null,visited_on:null};
  const parts=formatDateParts(rec),status=rec.status==='want'?'want':'done',precision=rec.visit_date_precision||'unknown';
  const name=hasPlace?place.name:source?.name||'';const subtitle=hasPlace?place.subtitle:source?.subtitle||'';
  dialog.innerHTML=`<div class="v68-modal-shade"><form class="v68-modal v68-editor" id="v68-journey-form" role="dialog" aria-modal="true" aria-label="记录旅行">
    <div class="v68-modal-head"><div><span>MY JOURNEY / PERSONAL MEMORY</span><h2>${hasPlace?'编辑旅行车票':'写下一张旅行车票'}</h2></div><button type="button" data-v68-action="close-dialog" aria-label="关闭">×</button></div>
    <div class="v68-place-focus"><span>📍</span><div><strong>${esc(name||'新地点')}</strong><small>${esc(subtitle||'你的专属旅行地点')}</small></div></div>
    ${source?.type==='manual'?`<div class="v68-form-row"><label>地点名称 *<input name="placeName" maxlength="100" value="${esc(name)}" required placeholder="例如：青岛"/></label><label>地区 / 备注<input name="placeSubtitle" maxlength="120" value="${esc(subtitle)}" placeholder="例如：中国 · 山东"/></label></div>`:''}
    <div class="v68-form-row"><label>旅程状态<select name="status" id="v68-status"><option value="done" ${status==='done'?'selected':''}>✓ 已经去过</option><option value="want" ${status==='want'?'selected':''}>↗ 下一站想去</option></select></label><label>可见范围<select name="visibility"><option value="private" ${rec.visibility==='private'?'selected':''}>🔒 仅自己可见</option><option value="circle" ${rec.visibility==='circle'?'selected':''}>👥 圈内可见</option></select></label></div>
    <div id="v68-visit-fields"><div class="v68-form-row"><label>到访日期精度<select name="precision" id="v68-precision"><option value="unknown" ${precision==='unknown'?'selected':''}>日期未记</option><option value="year" ${precision==='year'?'selected':''}>只记得年份</option><option value="month" ${precision==='month'?'selected':''}>记得年、月</option><option value="day" ${precision==='day'?'selected':''}>记得具体日期</option></select></label><label>个人评分（可选）<input name="rating" type="number" inputmode="decimal" min="0.5" max="10" step="0.1" placeholder="不评分也可以保存" value="${rec.rating==null?'':esc(rec.rating)}"/></label></div>
      <div class="v68-form-row" id="v68-date-fields"><label>年份<input type="number" inputmode="numeric" name="year" min="1900" max="2100" value="${esc(parts.year)}" placeholder="例如 2024"/></label><label class="v68-month-field">月份<input type="number" inputmode="numeric" name="month" min="1" max="12" value="${esc(parts.month)}" placeholder="1–12"/></label><label class="v68-day-field">日期<input type="number" inputmode="numeric" name="day" min="1" max="31" value="${esc(parts.day)}" placeholder="1–31"/></label></div></div>
    <label class="v68-note-label">${status==='want'?'这次想去的理由':'旅行感想（可选）'}<textarea name="note" maxlength="2000" rows="4" placeholder="这一站，有什么值得你记住？">${esc(rec.note||'')}</textarea></label>
    <p class="v68-privacy-hint">旅行日期和感想只在你选择「圈内可见」后才能被其他圈内成员看到。不会读取实时位置。</p>
    <div id="v68-form-error" role="alert"></div>
    <div class="v68-form-actions">${old?`<button class="v68-danger" type="button" data-v68-action="delete" data-id="${esc(place.id)}">删除车票</button>`:''}<button class="v68-secondary" type="button" data-v68-action="close-dialog">取消</button><button class="v68-main-btn" type="submit" id="v68-save">保存旅行车票</button></div>
  </form></div>`;syncEditorFields();dialog.querySelector('[name="status"]')?.focus();
}
function syncEditorFields(){const form=dialog.querySelector('#v68-journey-form');if(!form)return;
  const done=form.elements.status.value==='done',precision=form.elements.precision.value;
  const fields=form.querySelector('#v68-visit-fields');fields.hidden=!done;
  const dateFields=form.querySelector('#v68-date-fields');dateFields.hidden=!done||precision==='unknown';
  form.querySelector('.v68-month-field').hidden=precision==='year';
  form.querySelector('.v68-day-field').hidden=precision!=='day';
  form.querySelector('.v68-note-label').firstChild.textContent=done?'旅行感想（可选）':'这次想去的理由';
}
async function resolvePlace(form){const selection=state.selection;if(!selection)throw Error('请先选择一个地点');
  if(selection.type==='local'){const place=findById(selection.itemId);if(!place)throw Error('共享地点不存在，请重新选择');return place}
  const manual=selection.type==='manual',name=String(manual?form.elements.placeName.value:selection.name||'').trim().slice(0,100),
    subtitle=String(manual?form.elements.placeSubtitle.value:selection.subtitle||'').trim().slice(0,120);
  if(!name)throw Error('请输入地点名称');
  const matching=state.places.find(p=>!manual&&p.provider==='amap'&&p.provider_item_id===selection.providerItemId);
  if(matching)return matching;
  const existing=manual?state.places.find(p=>p.name.trim().toLocaleLowerCase()===name.toLocaleLowerCase()&&p.subtitle.trim().toLocaleLowerCase()===subtitle.toLocaleLowerCase()):null;
  if(existing)return existing;
  const location=!manual&&selection.location?selection.location:null;
  const coords=location&&Number.isFinite(location.latitude)&&Number.isFinite(location.longitude)?{
    place_latitude:location.latitude,place_longitude:location.longitude,place_coordinate_system:'GCJ-02'}:{};
  const payload={category:'place',name,subtitle,provider:manual?null:'amap',provider_item_id:manual?null:selection.providerItemId||null,
    circle_id:state.circleId,created_by:state.userId,emoji:'📍',...coords};
  const {data,error}=await db.from('catalog_items').insert(payload).select('id,category,name,subtitle,provider,provider_item_id,place_latitude,place_longitude,place_coordinate_system').single();
  if(error){
    if(error.code==='23505'&&!manual&&selection.providerItemId){
      const fallback=errorIf(await db.from('catalog_items').select('id,category,name,subtitle,provider,provider_item_id,place_latitude,place_longitude,place_coordinate_system')
        .eq('category','place').eq('provider','amap').eq('provider_item_id',selection.providerItemId).eq('circle_id',state.circleId).maybeSingle());
      if(fallback){state.places.push(fallback);return fallback}
    }
    throw error;
  }
  state.places.push(data);return data;
}
async function saveForm(form){const save=form.querySelector('#v68-save'),warn=form.querySelector('#v68-form-error');warn.textContent='';save.disabled=true;
  try{
    if(!state.userId||!state.circleId)throw Error('请先登录并加入圈子');
    const f=new FormData(form);
    const r=normalizeTravelRecord({status:f.get('status'),rating:f.get('rating'),precision:f.get('precision'),year:f.get('year'),month:f.get('month'),day:f.get('day'),note:f.get('note'),visibility:f.get('visibility')});
    // For a new manual place, avoid creating a catalogue item if the record input is invalid.
    const place=await resolvePlace(form);
    const payload={user_id:state.userId,item_id:place.id,circle_id:r.visibility==='circle'?state.circleId:null,
      visibility:r.visibility,status:r.status,rating:r.rating,note:r.note,spoiler:!!ownRecord(place.id)?.spoiler,
      visited_on:r.visited_on,visit_date_precision:r.visit_date_precision,updated_at:new Date().toISOString()};
    errorIf(await db.from('experiences').upsert(payload,{onConflict:'user_id,item_id'}));
    closeDialog();showMessage(r.status==='done'?'旅行回忆已保存':'下一站已加入心愿清单');await fetchArchive();document.dispatchEvent(new Event('tongpin:travel-archive-updated'));
  }catch(err){warn.textContent=message(err)}finally{save.disabled=false}
}
async function deleteTicket(itemId){if(!itemId||!confirm('确定删除这张旅行车票？个人评分和感想也会删除，此操作不可撤销。'))return;
  try{errorIf(await db.from('experiences').delete().eq('user_id',state.userId).eq('item_id',itemId));closeDialog();showMessage('旅行车票已删除');await fetchArchive();document.dispatchEvent(new Event('tongpin:travel-archive-updated'))}
  catch(err){const warn=dialog.querySelector('#v68-form-error');if(warn)warn.textContent=message(err)}
}
function downloadFile(name,content){const blob=new Blob([content],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000)}
function exportArchive(){if(!state.userId)return showMessage('请先登录并同步旅行档案');
  const ids=new Set(state.records.map(r=>r.item_id));const places=state.places.filter(p=>ids.has(p.id));
  const placeIds=new Set(places.map(p=>p.id));
  const payload={app:'tongpin-travel',version:1,exportedAt:new Date().toISOString(),places,records:state.records.filter(r=>placeIds.has(r.item_id))};
  downloadFile(`同频-旅行档案-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(payload,null,2));showMessage('已导出旅行车票及到访日期');
}
async function importArchive(input){const file=input.files?.[0];if(!file)return;
  try{
    if(file.size>2*1024*1024)throw Error('旅行档案文件不能超过 2 MB');
    const payload=JSON.parse(await file.text());
    if(payload?.app!=='tongpin-travel'||payload.version!==1||!Array.isArray(payload.places)||!Array.isArray(payload.records)||payload.records.length>300||payload.places.length>300)throw Error('请选择 V0.6.8 旅行档案 JSON，单次最多 300 条');
    if(!confirm('将仅恢复当前账号没有的旅行车票；恢复记录一律设为私密，不覆盖现有记录。是否继续？'))return;
    const placeMap=new Map(payload.places.filter(p=>p&&typeof p.id==='string').map(p=>[p.id,p]));let saved=0,skipped=0;
    const seen=new Set();
    for(const item of payload.records){
      try{
        if(!item||typeof item.item_id!=='string'||seen.has(item.item_id)){skipped++;continue}seen.add(item.item_id);
        const p=placeMap.get(item.item_id);if(!p||p.category!=='place'||typeof p.name!=='string'||!p.name.trim()){skipped++;continue}
        const r=normalizeTravelRecord({status:item.status,rating:item.rating,precision:item.visit_date_precision||'unknown',
          year:String(item.visited_on||'').slice(0,4),month:Number(String(item.visited_on||'').slice(5,7))||1,
          day:Number(String(item.visited_on||'').slice(8,10))||1,note:item.note||'',visibility:'private'});
        let actual=state.places.find(x=>x.id===p.id)||(p.provider&&p.provider_item_id?state.places.find(x=>x.provider===p.provider&&x.provider_item_id===p.provider_item_id):null);
        if(!actual){
          // No name-only automatic merge; similarly named places may be different POIs.
          const incoming={type:'remote',name:p.name,subtitle:p.subtitle||'',providerItemId:p.provider_item_id,
            location:Number.isFinite(Number(p.place_latitude))&&p.place_latitude!=null&&p.place_longitude!=null&&p.place_coordinate_system==='GCJ-02'
              ?{latitude:Number(p.place_latitude),longitude:Number(p.place_longitude)}:null};
          if(p.provider==='amap'&&p.provider_item_id){state.selection=incoming;actual=await resolvePlace({elements:{}})}
          else {state.selection={type:'manual',name:p.name,subtitle:p.subtitle||''};
            // Use a minimal form object to re-use catalog creation validation.
            actual=await resolvePlace({elements:{placeName:{value:p.name},placeSubtitle:{value:p.subtitle||''}}});}
        }
        if(ownRecord(actual.id)){skipped++;continue}
        const {error}=await db.from('experiences').insert({user_id:state.userId,item_id:actual.id,circle_id:null,visibility:'private',
          status:r.status,rating:r.rating,note:r.note,spoiler:!!item.spoiler,visited_on:r.visited_on,visit_date_precision:r.visit_date_precision});
        if(error)throw error;
        state.records.push({user_id:state.userId,item_id:actual.id,...r,updated_at:new Date().toISOString()});saved++;
      }catch(err){console.warn('[同频旅行档案] 跳过一条恢复记录',err);skipped++}
    }
    showMessage(`旅行档案已恢复 ${saved} 条，跳过 ${skipped} 条`);await fetchArchive();document.dispatchEvent(new Event('tongpin:travel-archive-updated'));
  }catch(err){showMessage('恢复失败：'+message(err))}finally{input.value='';state.selection=null}
}
document.addEventListener('click',event=>{
  const legacy=event.target.closest('[data-action]');
  if(!legacy)return;
  const original=legacy.dataset.action;
  if(original==='travel-record'&&page.dataset.page==='travel'){
    event.preventDefault();event.stopImmediatePropagation();openPicker();return;
  }
  if(original!=='record')return;
  const placeId=legacy.dataset.id;
  if(!placeId)return;
  const found=findById(placeId);
  if(!found&&!document.body.classList.contains('travel-detail-mode'))return;
  event.preventDefault();event.stopImmediatePropagation();
  if(found)openEditor(found);
  else void fetchArchive().then(()=>{const item=findById(placeId);if(item)openEditor(item);else showMessage('尚未加载地点，请回到沿途车站重试')});
},true);

document.addEventListener('click',event=>{
  const t=event.target.closest('[data-v68-action]');if(!t)return;
  const action=t.dataset.v68Action;
  if(action==='new')openPicker();
  else if(action==='edit')editPlace(t.dataset.id);
  else if(action==='close-dialog')closeDialog();
  else if(action==='select-local')editPlace(t.dataset.id);
  else if(action==='select-remote')chooseRemote(Number(t.dataset.index));
  else if(action==='manual')showManual();
  else if(action==='reload')void fetchArchive();
  else if(action==='archive-page'){state.page=Math.max(1,Number(t.dataset.page)||1);updatePanels()}
  else if(action==='wish-page'){state.wishPage=Math.max(1,Number(t.dataset.page)||1);updatePanels()}
  else if(action==='delete')void deleteTicket(t.dataset.id);
  else if(action==='export')exportArchive();
  else if(action==='import')document.getElementById('v68-import-input')?.click();
});
document.addEventListener('click',event=>{if(event.target.classList?.contains('v68-modal-shade'))closeDialog()});
document.addEventListener('change',event=>{
  const t=event.target;if(t.dataset.v68Control==='year'){state.year=t.value;state.page=1;updatePanels()}
  else if(t.dataset.v68Control==='sort'){state.sort=t.value;state.page=1;updatePanels()}
  else if(t.id==='v68-status'||t.id==='v68-precision')syncEditorFields();
  else if(t.id==='v68-import-input')void importArchive(t);
});
document.addEventListener('input',event=>{
  if(event.target.id==='v68-place-query'){renderPicker();clearTimeout(queryTimer);queryTimer=setTimeout(()=>void remoteSearch(),330)}
});
document.addEventListener('submit',event=>{
  if(event.target.id!=='v68-journey-form')return;event.preventDefault();void saveForm(event.target);
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&dialog.innerHTML)closeDialog()});
window.addEventListener('focus',()=>{if(page.dataset.page==='travel'&&state.mount?.isConnected&&!state.loading)void fetchArchive()});
