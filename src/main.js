import './style.css';
import {db, ready} from './cloud.js';
import {findExistingCatalogItem} from './catalogMatch.js';

/* 同频 V0.4：Supabase Auth / RLS + 服务端真实条目搜索 */
(() => {
  'use strict';
  let ME = null;
  let USERS = [];
  let authUser = null;
  let activeCircle = null;
  let inviteCode = '';
  let loading = true;
  let fetchError = '';
  let subscription = null;
  let refreshSerial = 0;
  let isBusy = false;
  let pendingOtpEmail = '';
  let lastOtpSentAt = 0;
  const NAV = [
    {id:'feed',name:'动态',icon:'home'}, {id:'discover',name:'发现',icon:'compass'},
    {id:'new',name:'记录',icon:'plus'}, {id:'circle',name:'圈子',icon:'users'},
    {id:'me',name:'我的',icon:'user'}
  ];

  const ICON_PATHS = {
    home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    compass:'<circle cx="12" cy="12" r="9"/><path d="m15.8 8.2-2.7 4.9-4.9 2.7 2.7-4.9z"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    users:'<path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-2a4 4 0 0 0-3-3.87M16 2.13a4 4 0 0 1 0 7.75"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    arrow:'<path d="M5 12h14m-7-7 7 7-7 7"/>',
    lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    spark:'<path d="m12 2 1.5 6.5L20 10l-6.5 1.5L12 18l-1.5-6.5L4 10l6.5-1.5zM19 17l.6 2.4L22 20l-2.4.6L19 23l-.6-2.4L16 20l2.4-.6z"/>',
    star:'<path d="m12 2.5 3 6.1 6.8 1-4.9 4.8 1.2 6.8-6.1-3.2-6.1 3.2 1.2-6.8L2.2 9.6l6.8-1z"/>',
    export:'<path d="M12 3v12m-4-4 4 4 4-4M5 17v4h14v-4"/>',
    bookmark:'<path d="M5 3h14v18l-7-5-7 5z"/>'
  };
  const icon = (name,size=18) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]||ICON_PATHS.spark}</svg>`;
  const CATEGORIES = [
    {id:'all',name:'全部'}, {id:'game',name:'🎮 游戏'},
    {id:'anime',name:'📺 动画'}, {id:'place',name:'📍 地点'}
  ];
  const CAT_NAME = {game:'游戏',anime:'动画',place:'旅行地点'};
  const CAT_EMOJI = {game:'🎮',anime:'📺',place:'📍'};
  const STATUS = {
    game:[['want','想玩'],['doing','游玩中'],['done','已通关'],['paused','已搁置']],
    anime:[['want','想看'],['doing','观看中'],['done','已看完'],['paused','已搁置']],
    place:[['want','想去'],['done','去过']]
  };
  let data = {items:[], records:[]};
  let remote = {items:[],notices:[],state:'idle',query:'',category:''};
  let searchTimer = null;
  let searchSerial = 0;
  let view = {page:'feed',detailId:'',returnPage:'discover',category:'all',rankCategory:'all',rankMode:'average',minThree:false,search:'',personalCategory:'all',personalStatus:'all',personalSort:'recent'};
  const $ = id => document.getElementById(id);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const itemById = id => data.items.find(x=>x.id===id);
  const userById = id => USERS.find(x=>x.id===id)||{name:id===ME?'我':'未知用户',id};
  const own = id => data.records.find(x=>x.userId===ME && x.itemId===id);
  const allShared = () => data.records.filter(x=>x.visibility==='circle');
  const ownRecords = () => data.records.filter(x=>x.userId===ME);
  const isRated = rec => typeof rec.rating === 'number' && Number.isFinite(rec.rating) && rec.rating>=0.5 && rec.rating<=10;
  const labelStatus = (category,status) => (STATUS[category]||[]).find(x=>x[0]===status)?.[1]||status;
  const visibleRatings = id => allShared().filter(x=>x.itemId===id && isRated(x));
  function summarize(item) {
    const recs = visibleRatings(item.id), scores = recs.map(x=>x.rating);
    return {item,count:recs.length,average:scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:null,spread:scores.length>=2?Math.max(...scores)-Math.min(...scores):null};
  }
  function persist(){/* V0.3 所有写入由 saveExperience / createCatalogItem 提交至云端 */}
  function notifyAge(iso){const days=Math.max(0,Math.round((Date.now()-new Date(iso).getTime())/86400000));return days===0?'今天':days===1?'昨天':days<30?`${days} 天前`:new Date(iso).toLocaleDateString('zh-CN',{month:'short',day:'numeric'})}
  const coverCache = {};
  function httpsUrl(value){try{const u=new URL(String(value||''));return u.protocol==='https:'?u.href:''}catch(_){return ''}}
  const cover=(item,cl='')=>{
    const src = httpsUrl(coverCache[item.id] || item.coverUrl);
    return `<div class="cover ${esc(item.category)} ${cl} cover-${esc(item.id)}" data-cover-id="${esc(item.id)}" role="img" aria-label="${esc(item.name)}封面或占位插图"><span class="cover-glow"></span><span class="cover-symbol">${esc(item.emoji||CAT_EMOJI[item.category])}</span><span class="cover-grain"></span>${src?`<img class="cover-photo" src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.remove()"/>`:''}</div>`
  };
  // 旅行地点从百科读取开放缩略图；只用于浏览器展示，不把图片二进制打包进项目。
  async function enrichPlaceImages(){
    const places=data.items.filter(x=>x.category==='place'&&x.wikiTitle);
    await Promise.all(places.map(async item=>{
      try{
        const res=await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(item.wikiTitle)}`,{signal:AbortSignal.timeout(6500)});
        if(!res.ok)return;
        const summary=await res.json();const img=httpsUrl(summary.thumbnail?.source||summary.originalimage?.source);
        if(!img)return;
        coverCache[item.id]=img;
        document.querySelectorAll(`[data-cover-id="${item.id}"]`).forEach(el=>{
          const existing=el.querySelector('img');if(existing)existing.remove();
          const image=document.createElement('img');image.className='cover-photo';image.alt='';image.loading='lazy';image.decoding='async';image.src=img;image.onerror=()=>image.remove();el.append(image);
        });
      }catch(_){/* 离线时继续显示占位插图 */}
    }));
  }
  const reviewNote=(r,context='detail')=>{
    if(!r.note)return '';
    if(r.spoiler){
      if(context==='feed')return '<div class="spoiler-muted">◈ 此短评包含剧透，进入详情后可选择查看</div>';
      return `<div class="spoiler-note"><span>◈ 包含剧透的评价</span><button class="btn-ghost" data-action="reveal-spoiler" type="button">点此查看</button><p class="spoiler-text" hidden>${esc(r.note)}</p></div>`;
    }
    return `<p class="review-paragraph">${esc(r.note)}</p>`;
  };
  const avatar=(uid)=>`<span class="avatar ${uid===ME?'':`user-${Math.max(0,USERS.findIndex(x=>x.id===uid))%5}`} ">${esc(userById(uid).name.slice(-1))}</span>`;
  function cats(active,action) {return `<div class="filters">${CATEGORIES.map(c=>`<button class="filter-btn ${active===c.id?'selected':''}" data-action="${action}" data-category="${c.id}">${c.name}</button>`).join('')}</div>`}
  function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('visible'),2700)}
  function nav(){const build=(mobile=false)=>NAV.map(n=>mobile?`<button class="${(view.page===n.id||(view.page==='detail'&&view.returnPage===n.id))?'active':''} ${n.id==='new'?'add-item':''}" data-action="${n.id==='new'?'new-record':'navigate'}" ${n.id==='new'?'':`data-page="${n.id}"`}><span class="bottom-icon">${icon(n.icon,21)}</span><span>${n.name}</span></button>`:`<button class="nav-button ${view.page===n.id?'active':''}" data-action="${n.id==='new'?'new-record':'navigate'}" ${n.id==='new'?'':`data-page="${n.id}"`}><span class="nav-icon">${icon(n.icon,19)}</span><span>${n.name}</span>${(n.id===view.page||(view.page==='detail'&&n.id===view.returnPage))?'<span class="nav-active-dot"></span>':''}</button>`).join('');$('side-nav').innerHTML=build();$('bottom-nav').innerHTML=build(true)}
  function side(){const rated=ownRecords().filter(isRated);const ranked=data.items.map(summarize).filter(x=>x.count).sort((a,b)=>b.average-a.average).slice(0,3);$('right-rail').innerHTML=`
    <div class="side-welcome"><span class="side-flower">✳</span><div class="side-welcome-kicker">YOUR LITTLE CORNER</div><h3>记录喜欢的，<br>也发现新的喜欢。</h3><p>生活里那些细小又珍贵的心动，都值得被好好收藏。</p><div class="side-line"></div><span class="side-welcome-footer">${icon('spark',15)} 同频生活提案</span></div>
    <div class="panel side-panel"><div class="panel-head"><h4>圈内好评 <span class="side-dot">●</span></h4><button class="action-link" data-action="navigate" data-page="circle">更多 ${icon('arrow',13)}</button></div><div class="small-stack">${ranked.map((x,i)=>`<button class="clickable side-rank" data-action="detail" data-id="${x.item.id}"><span class="side-rank-num">0${i+1}</span>${cover(x.item,'rank-cover')}<span class="side-rank-name">${esc(x.item.name)}<small>${x.count} 人评价</small></span><b>${x.average.toFixed(1)}</b></button>`).join('')}</div></div>
    <div class="side-summary">${icon('lock',15)} <span>私密圈子 · 评分已保存到云端</span></div>`}
  function header(eyebrow,title,desc,right=''){return `<div class="intro"><div><div class="eyebrow">${eyebrow}</div><h1 class="headline">${title}</h1><p class="subhead">${desc}</p></div>${right}</div>`}
  function feed(){const events=allShared().slice().sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)).slice(0,25);const mine=ownRecords().length;return `
    <div class="hero"><div class="hero-content"><span class="hero-kicker"><span class="kicker-sun">✳</span> 同频日常 · OUR LITTLE UNIVERSE</span><h1>把每一份喜欢，<br><em>悄悄收藏起来。</em></h1><p>在这里，发现朋友们最近的心动，<br>也为自己的每段体验留下一笔。</p><button class="hero-button" data-action="new-record">记录一次新体验 <span>${icon('arrow',17)}</span></button></div><div class="hero-art" aria-hidden="true"><div class="art-orbit art-orbit-one"></div><div class="art-orbit art-orbit-two"></div><div class="art-sun">✳</div><div class="art-card art-card-back">✿<span>soft moments</span></div><div class="art-card art-card-front"><span class="art-heart">♡</span><span class="art-card-title">日常里的<br>小小热爱</span><i>✦</i></div><div class="art-sparkle art-sparkle-a">✧</div><div class="art-sparkle art-sparkle-b">✺</div></div></div>
    <div class="overview-row"><div class="overview-item"><div class="overview-icon icon-lilac">${icon('bookmark',19)}</div><div><strong>${mine}</strong><span>我的记录</span></div></div><div class="overview-divider"></div><div class="overview-item"><div class="overview-icon icon-peach">${icon('star',19)}</div><div><strong>${allShared().filter(isRated).length}</strong><span>圈内评分</span></div></div><div class="overview-divider"></div><div class="overview-item"><div class="overview-icon icon-sage">${icon('users',19)}</div><div><strong>${USERS.length}</strong><span>同频伙伴</span></div></div></div>
    <div class="feed-section-head"><div><span class="eyebrow">THE LATEST</span><h2 class="section-title">朋友的最近动态<span class="tiny-spark"> ✳</span></h2><p class="section-sub">看看大家这段时间爱上了什么</p></div><button class="btn-ghost feed-head-btn" data-action="navigate" data-page="circle">圈内榜单 ${icon('arrow',15)}</button></div>
    <div class="feed-list">${!events.length?'<div class="panel empty-state"><strong>圈子里还没有动态</strong><p>记录第一条体验，和朋友一起慢慢积累回忆。</p><button class="primary-btn" data-action="new-record">＋ 记录体验</button></div>':''}${events.map(r=>{const item=itemById(r.itemId);if(!item)return '';return `<article class="panel feed-card"><div class="feed-user">${avatar(r.userId)}<div><div class="name">${esc(userById(r.userId).name)} <span class="user-action">${esc(labelStatus(item.category,r.status))}了</span></div><div class="meta">${notifyAge(r.updatedAt)} · 分享了一条体验</div></div><span class="spacer"></span><span class="tag tag-${item.category}">${CAT_EMOJI[item.category]} ${CAT_NAME[item.category]}</span></div>
      <div class="content-row">${cover(item)}<div class="feed-detail"><div class="feed-item-sub">${esc(item.subtitle||CAT_NAME[item.category])}</div><button class="record-title clickable" data-action="detail" data-id="${item.id}">${esc(item.name)}</button><div class="feed-ratingline">${isRated(r)?`<span class="rating">${r.rating.toFixed(1)}<small> / 10</small></span><span class="rating-label">${r.rating>=9?'特别喜欢':r.rating>=8?'值得体验':'我的评分'}</span>`:`<span class="tag gray">暂未评分</span>`}</div>${r.note?`<div class="note">${r.spoiler?'◈ 剧透内容已隐藏，进入作品详情后可查看':`“${esc(r.note)}”`}</div>`:''}</div></div><div class="subbar"><span>${icon('users',14)} ${visibleRatings(item.id).length} 位伙伴打过分</span><span class="spacer"></span><button class="action-link" data-action="detail" data-id="${item.id}">查看评价 ${icon('arrow',14)}</button></div></article>`}).join('')}</div>`}
  function discoverList(){const search=view.search.trim().toLocaleLowerCase();const matches=data.items.filter(x=>(view.category==='all'||x.category===view.category)&&(!search||`${x.name} ${x.subtitle}`.toLocaleLowerCase().includes(search)));return matches.length?matches.map(x=>{const s=summarize(x);return `<div class="item-card">${cover(x,'rank-cover')}<div class="item-text"><button class="clickable" data-action="detail" data-id="${x.id}"><strong>${esc(x.name)}</strong></button><small>${esc(x.subtitle||CAT_NAME[x.category])} · ${s.count?s.average.toFixed(1)+'分 · '+s.count+'人评分':'暂无圈内评分'}</small></div><button class="small-btn" data-action="record" data-id="${x.id}">${own(x.id)?'编辑记录':'＋ 记录'}</button></div>`}).join(''):'<div class="empty-state"><strong>共享库暂无匹配条目</strong><p>试试下方在线搜索；如果没有结果，也可以手动创建。</p></div>'}
  function localMatch(remoteItem){
    return findExistingCatalogItem(data.items,remoteItem);
  }
  function remoteResultsHTML(){
    if(view.search.trim().length<2)return '<p class="search-prompt">输入至少 2 个字符，在线查找作品和地点。</p>';
    if(view.category==='all')return '<p class="search-prompt">请先选择「游戏」「动画」或「地点」，再进行在线搜索；上方共享库依然支持全部分类查询。</p>';
    if(remote.state==='loading')return '<p class="search-prompt">正在查询第三方资料…</p>';
    if(remote.state==='error')return `<p class="search-prompt search-error">${esc(remote.error)} · 可以继续在共享库内搜索或手动创建。</p>`;
    if(remote.category!==view.category||remote.query!==view.search.trim())return '<p class="search-prompt">准备搜索…</p>';
    const cards=remote.items.map((x,index)=>{
      const local=localMatch(x);
      return `<div class="item-card remote-card"><div class="remote-cover">${x.coverUrl?`<img src="${esc(httpsUrl(x.coverUrl))}" alt="" loading="lazy" onerror="this.hidden=true"/>`:`<span>${CAT_EMOJI[x.category]}</span>`}</div><div class="item-text"><strong>${esc(x.name)}</strong><small>${esc(x.subtitle||CAT_NAME[x.category])} · ${esc(x.provider==='amap'?'高德地图':x.provider==='igdb'?'IGDB':'Bangumi')}</small></div><button class="small-btn" data-action="import-remote" data-index="${index}">${local?'已有条目 · 记录':'加入并评分'}</button></div>`;
    }).join('');
    const tips=remote.notices.length?`<p class="search-notices">${remote.notices.map(esc).join('；')}</p>`:'';
    return `${tips}${cards||'<div class="empty-state"><strong>暂未搜到结果</strong><p>可以换一个名称，或者手动创建条目。</p><button class="btn-ghost" data-action="new-item">＋ 手动创建</button></div>'}`;
  }
  function discover(){return `${header('DISCOVER / 条目库','发现下一次心动','查找圈内已有条目，也可以在线搜索动画、游戏和旅行地点。','<button class="btn-ghost" data-action="new-item">＋ 手动创建</button>')}
    <label class="searchbar"><span>⌕</span><input id="search-input" type="search" placeholder="搜索番剧、游戏、地点…" value="${esc(view.search)}" autocomplete="off"/></label>${cats(view.category,'category')}
    <div class="panel"><div class="panel-head"><h2 class="section-title">圈子共享条目库</h2><span class="meta">${data.items.length} 个条目</span></div><div id="discover-list">${discoverList()}</div></div>
    <div class="panel remote-panel"><div class="panel-head"><div><h2 class="section-title">在线搜索</h2><p class="section-sub">由独立搜索服务代理第三方接口，不在浏览器暴露密钥</p></div><span class="meta">V0.4</span></div><div id="remote-results">${remoteResultsHTML()}</div></div>`}
  function startRemoteSearch(){
    clearTimeout(searchTimer);const serial=++searchSerial;
    const q=view.search.trim(), category=view.category;
    if(q.length<2||category==='all'){
      remote={items:[],notices:[],state:'idle',query:q,category};
      if($('remote-results'))$('remote-results').innerHTML=remoteResultsHTML();
      return;
    }
    remote={items:[],notices:[],state:'loading',query:q,category};
    if($('remote-results'))$('remote-results').innerHTML=remoteResultsHTML();
    searchTimer=setTimeout(async()=>{
      try{
        const {data:sessionData,error:sessionError}=await db.auth.getSession();
        if(sessionError||!sessionData.session?.access_token)throw new Error('请重新登录后搜索');
        const base=(import.meta.env.VITE_SEARCH_API_BASE||'').trim().replace(/\/$/,'');
        const url=`${base}/api/search?category=${encodeURIComponent(category)}&q=${encodeURIComponent(q)}`;
        const response=await fetch(url,{headers:{Authorization:`Bearer ${sessionData.session.access_token}`},signal:AbortSignal.timeout(35000)});
        const payload=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(payload.error||`搜索接口 HTTP ${response.status}`);
        if(serial!==searchSerial)return;
        remote={items:Array.isArray(payload.items)?payload.items:[],notices:payload.notices||[],state:'ready',query:q,category};
      }catch(err){
        if(serial!==searchSerial)return;
        remote={items:[],notices:[],state:'error',error:String(err.message||err),query:q,category};
      }
      if($('remote-results'))$('remote-results').innerHTML=remoteResultsHTML();
    },380);
  }
  async function importRemote(index){
    if(isBusy)return;
    const item=remote.items[Number(index)];
    if(!item)return;
    try{
      isBusy=true;
      let existing=localMatch(item);
      if(!existing){
        existing=await createCatalogItem({
          category:item.category,name:item.name,subtitle:item.subtitle,description:item.description,
          coverUrl:item.coverUrl,sourceUrl:item.sourceUrl,year:item.year,
          provider:item.provider,providerItemId:item.providerId,emoji:item.emoji
        });
      }
      recordForm(existing.id);
    }catch(err){toast('导入条目失败：'+displayError(err));}
    finally{isBusy=false;}
  }
  function ranking(){let list=data.items.map(summarize).filter(x=>x.count>=1&&(view.rankCategory==='all'||x.item.category===view.rankCategory));if(view.minThree)list=list.filter(x=>x.count>=3);if(view.rankMode==='difference')list=list.filter(x=>x.count>=2).sort((a,b)=>b.spread-a.spread||(b.count-a.count));else list.sort((a,b)=>b.average-a.average||(b.count-a.count)||a.item.name.localeCompare(b.item.name,'zh-CN'));return list}
  function rankingHTML(){const list=ranking();return `<div class="filter-line"><label class="toggle"><input type="checkbox" id="min-three" ${view.minThree?'checked':''}/> 仅显示至少 3 人评分的条目</label><select class="sort-select" id="rank-mode" aria-label="榜单类型"><option value="average" ${view.rankMode==='average'?'selected':''}>圈内平均分</option><option value="difference" ${view.rankMode==='difference'?'selected':''}>评分分歧</option></select></div><div class="meta" style="margin-bottom:13px">${view.rankMode==='average'?'所有至少 1 人评分的条目均可上榜':'分歧榜至少需 2 人评分，按最高分与最低分的差值排序'} · 共 ${list.length} 项</div>
    ${list.length?list.map((x,i)=>`<div class="rank-card ${i<3?`rank-top rank-top-${i+1}`:''}"><span class="rank-number">${String(i+1).padStart(2,'0')}</span>${cover(x.item,'rank-cover')}<div class="rank-info"><button class="clickable" data-action="detail" data-id="${x.item.id}"><strong>${esc(x.item.name)}</strong></button><small>${CAT_EMOJI[x.item.category]} ${CAT_NAME[x.item.category]} · ${x.count} 人评分 ${x.count<3?'<span class="tag gray">样本较少</span>':''}</small></div><div class="rank-score">${(view.rankMode==='average'?x.average:x.spread).toFixed(1)}<span>${view.rankMode==='average'?'平均分':'分数极差'}</span></div></div>`).join(''):'<div class="empty-state"><strong>还没有满足条件的作品</strong><p>试试关闭人数筛选，或者记录更多作品。</p></div>'}`}
  function circle(){return `${header('OUR LITTLE CIRCLE','喜欢的事，我们一起聊','这些作品与地点是大家共同记录的小宇宙。','<span class="chip">'+icon('lock',13)+' 仅限圈子成员</span>')}
    <div class="circle-banner"><div><span class="eyebrow">TOGETHER, WE RANK</span><h2>我们的共同心头好<span>✳</span></h2><p>看看大家最爱的作品，也看看最有分歧的那一个。</p></div><div class="circle-banner-art" aria-hidden="true">✺<small>TOP PICKS</small></div></div>
    <div class="panel ranking-panel"><div class="panel-head"><div><h2 class="section-title">圈子评分榜</h2><div class="section-sub">游戏、动画、旅行地点共享排名</div></div><span class="rank-panel-spark">${icon('star',19)}</span></div>${cats(view.rankCategory,'rank-category')}<div id="ranking-list">${rankingHTML()}</div></div><div class="panel members-panel"><div class="panel-head"><div><h2 class="section-title">同频伙伴</h2><div class="section-sub">在这里交换彼此的喜欢</div></div><span class="member-count">${USERS.length} 人</span></div><div class="member-list">${USERS.map(u=>`<div class="member-card">${avatar(u.id)}<div style="flex:1"><strong>${esc(u.name)}</strong><small>${data.records.filter(r=>r.userId===u.id).length} 条记录 · ${data.records.filter(r=>r.userId===u.id&&isRated(r)).length} 个评分</small></div><span class="member-score">${icon('spark',18)}</span></div>`).join('')}</div><p class="footer-note">成员都是真实登录的好友。圈子榜单默认展示全部已评分条目，也可以筛选至少 3 人评分。</p>
    ${activeCircle?.owner_id===ME?`<div class="invite-box"><strong>邀请好友加入</strong><p>把邀请码私下发给朋友，不要发在公开社交平台。</p><div class="invite-code">${esc(inviteCode||'加载中…')}</div><button class="btn-ghost" data-action="copy-invite">复制邀请码</button></div>`:''}</div>`}
  function personalList(){const mine=ownRecords().filter(r=>{const item=itemById(r.itemId);return item&&(view.personalCategory==='all'||item.category===view.personalCategory)&&(view.personalStatus==='all'||r.status===view.personalStatus)}).slice().sort((a,b)=>view.personalSort==='rating'?( (isRated(b)?b.rating:-1)-(isRated(a)?a.rating:-1) || new Date(b.updatedAt)-new Date(a.updatedAt) ):new Date(b.updatedAt)-new Date(a.updatedAt));return mine.length?mine.map(r=>{const item=itemById(r.itemId);return `<div class="item-card">${cover(item,'rank-cover')}<div class="item-text"><button class="clickable" data-action="detail" data-id="${item.id}"><strong>${esc(item.name)}</strong></button><small>${CAT_NAME[item.category]} · ${labelStatus(item.category,r.status)} · ${r.visibility==='private'?'🔒 仅自己可见':'👥 圈内可见'}</small></div><div style="text-align:right"><div class="rating" style="font-size:17px">${isRated(r)?r.rating.toFixed(1):'—'}</div><button class="link-btn" data-action="record" data-id="${item.id}">编辑</button></div></div>`}).join(''):'<div class="empty-state"><strong>还没有相关记录</strong><p>从「发现」中找到感兴趣的条目并记录。</p></div>'}
  function me(){const mine=ownRecords(),rated=mine.filter(isRated);return `${header('MY ARCHIVE / 我的世界','每一次喜欢，都值得珍藏','这些记录属于你。你可以决定哪些内容分享给圈子。','<button class="primary-btn" data-action="new-record">＋ 添加记录</button>')}
    <div class="stats"><div class="stat"><strong>${mine.filter(r=>itemById(r.itemId)?.category==='game').length}</strong><span>🎮 游戏</span></div><div class="stat"><strong>${mine.filter(r=>itemById(r.itemId)?.category==='anime').length}</strong><span>📺 动画</span></div><div class="stat"><strong>${mine.filter(r=>itemById(r.itemId)?.category==='place').length}</strong><span>📍 地点</span></div></div>
    <div class="panel"><div class="panel-head"><div><h2 class="section-title">我的收藏与评分</h2><div class="section-sub">${mine.length} 条记录，其中 ${rated.length} 条已评分</div></div></div>${cats(view.personalCategory,'personal-category')}<div class="filter-line"><select id="personal-status" class="sort-select"><option value="all">全部状态</option><option value="want" ${view.personalStatus==='want'?'selected':''}>想体验</option><option value="doing" ${view.personalStatus==='doing'?'selected':''}>进行中</option><option value="done" ${view.personalStatus==='done'?'selected':''}>已完成 / 去过</option><option value="paused" ${view.personalStatus==='paused'?'selected':''}>搁置</option></select><select id="personal-sort" class="sort-select" aria-label="我的记录排序"><option value="recent" ${view.personalSort==='recent'?'selected':''}>最近更新</option><option value="rating" ${view.personalSort==='rating'?'selected':''}>个人评分榜（高到低）</option></select></div><div id="personal-list">${personalList()}</div></div>
    <div class="panel"><h2 class="section-title">账号与云端档案</h2><p class="help-copy">已登录：${esc(authUser?.email||'')}。个人记录保存在 Supabase；导入旧版记录时默认设为“仅自己可见”。</p>
    <form id="nickname-form" class="account-form"><label>圈内昵称</label><input name="nickname" class="form-control" maxlength="40" required value="${esc(userById(ME).name)}"/><button class="btn-ghost" type="submit">更新昵称</button></form>
    <div class="filters" style="margin:15px 0 0"><button class="btn-ghost" data-action="export">⇩ 导出数据</button><button class="btn-ghost" data-action="import">⇧ 导入旧版备份</button><button class="btn-ghost danger" data-action="logout">退出登录</button></div></div>`}
  function displayError(error){
    const raw=String(error?.message||error||'未知错误');
    if(/Failed to fetch|NetworkError|fetch failed/i.test(raw))return '网络连接失败，请检查 Supabase 地址与网络';
    if(/relation .* does not exist|schema cache|Could not find the function|PGRST202|PGRST205/i.test(raw))return '数据库还未正确初始化，请先运行 supabase/schema.sql';
    return raw.slice(0,170);
  }

  function gate(kind){
    const title={setup:'请先连接 Supabase',loading:'正在连接你的私人圈子',login:'欢迎来到同频',circle:'建立我们的秘密基地',error:'连接出现问题'}[kind];
    const content={
      setup:`<p>此版本需要 Supabase 项目才能保存真实成员和评分。先复制 <code>.env.example</code> 为 <code>.env</code>，填写项目 URL 和 <b>publishable key</b>，再运行数据库脚本。</p><div class="gate-tip">不要填写 secret / service_role key。具体步骤见项目 README.md。</div>`,
      loading:`<p>正在读取账号、成员和评分……</p><div class="gate-tip">第一次打开可能需要连接到 Supabase 服务器。</div>`,
      login:pendingOtpEmail ? `<p>验证码已发送至 <strong>${esc(pendingOtpEmail)}</strong>。无需打开邮件中的任何链接，直接将验证码输入下面即可登录。</p><form class="gate-form" id="otp-form"><label for="login-token">邮箱验证码</label><input id="login-token" name="token" class="form-control otp-input" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,8}" minlength="6" maxlength="8" required placeholder="输入邮件中的验证码"/><button class="primary-btn" type="submit">验证并登录 →</button><p class="auth-hint">验证码通常有效期为 1 小时；同一邮箱通常需要间隔 60 秒才能再次发送。请勿将验证码发给任何人。</p></form><div class="otp-secondary"><button class="link-btn" type="button" data-action="resend-otp">重新发送验证码</button><button class="link-btn" type="button" data-action="change-login-email">修改邮箱</button></div>` : `<p>登录后，每份体验都会保存在你的云端档案。使用邮箱验证码登录，新用户和已注册用户共用同一个入口，不需要点击验证链接。</p><form class="gate-form" id="login-form"><label for="login-email">邮箱地址</label><input id="login-email" name="email" class="form-control" type="email" autocomplete="email" required placeholder="you@example.com"/><button class="primary-btn" type="submit">发送验证码 ↗</button><p class="auth-hint">首次登录会自动创建账号。邮箱服务需在 Supabase 中正确配置；已注册账号无需重新注册。</p></form>`,
      circle:`<p>你已经登录。现在可以创建一个私人圈子，或者输入朋友发送给你的邀请码加入现有圈子。</p><div class="gate-choice"><form id="create-circle-form" class="gate-form"><h3>✳ 创建圈子</h3><label>圈子名称</label><input name="circleName" class="form-control" maxlength="60" required placeholder="例如：我们的秘密基地"/><button class="primary-btn" type="submit">创建我的圈子</button></form><form id="join-circle-form" class="gate-form"><h3>✉ 加入朋友的圈子</h3><label>24 位邀请码</label><input name="inviteCode" class="form-control code-input" maxlength="24" minlength="24" autocapitalize="characters" required placeholder="粘贴邀请码"/><button class="btn-ghost" type="submit">加入圈子 →</button></form></div><button class="link-btn gate-logout" data-action="logout">切换登录账号</button>`,
      error:`<p>${esc(fetchError)}</p><div class="gate-tip">请检查是否已经在 Supabase SQL Editor 运行 <code>supabase/schema.sql</code>，以及项目 URL、认证与访问权限。</div><button class="primary-btn" data-action="refresh">重新连接</button><button class="link-btn gate-logout" data-action="logout">退出登录</button>`
    }[kind];
    return `<div class="gate-wrap"><div class="gate-orbit">✳</div><div class="eyebrow">RESONANCE · PRIVATE CIRCLE</div><h1>${title}</h1>${content}</div>`;
  }

  const unwrap=(result)=>{if(result.error)throw result.error;return result.data};
  function mapCatalog(i){return {id:i.id,category:i.category,name:i.name,subtitle:i.subtitle||'',description:i.description||'',coverUrl:i.cover_url||'',sourceUrl:i.source_url||'',wikiTitle:i.wiki_title||'',emoji:i.emoji||CAT_EMOJI[i.category],year:i.year||'',tags:i.tags||[],provider:i.provider||null,providerItemId:i.provider_item_id||null}};
  function mapExperience(r){return {id:r.id,userId:r.user_id,itemId:r.item_id,rating:r.rating==null?null:Number(r.rating),status:r.status,note:r.note||'',spoiler:!!r.spoiler,visibility:r.visibility,updatedAt:r.updated_at}};

  let refreshTimer=null;
  function subscribeToCircle(){
    if(subscription){db.removeChannel(subscription);subscription=null}
    if(!activeCircle)return;
    const onChange=()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{if(document.visibilityState==='visible')refreshAll(false)},450)};
    subscription=db.channel('tongpin-live-'+activeCircle.id+'-'+Date.now())
      .on('postgres_changes',{event:'*',schema:'public',table:'experiences'},onChange)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'catalog_items'},onChange)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'circle_members'},onChange)
      .subscribe();
  }

  async function refreshAll(showToast=false){
    const run=++refreshSerial,wasCircle=activeCircle?.id;
    try{
      fetchError='';
      if(!db)throw Error('Supabase 尚未配置');
      if(!authUser){
        ME=null;USERS=[];activeCircle=null;inviteCode='';data={items:[],records:[]};
        if(subscription){db.removeChannel(subscription);subscription=null}
        return;
      }
      ME=authUser.id;
      let myProfile=unwrap(await db.from('profiles').select('id,nickname').eq('id',ME).maybeSingle());
      if(!myProfile){
        myProfile=unwrap(await db.from('profiles').insert({id:ME,nickname:'同频伙伴'}).select('id,nickname').single());
      }
      const membership=unwrap(await db.from('circle_members').select('circle_id').eq('user_id',ME).maybeSingle());
      if(!membership){
        activeCircle=null;inviteCode='';USERS=[{id:ME,name:myProfile.nickname}];data={items:[],records:[]};
        if(subscription){db.removeChannel(subscription);subscription=null}
        return;
      }
      const circleId=membership.circle_id;
      const [circleResult,memberResult,profileResult,itemResult,recordResult]=await Promise.all([
        db.from('circles').select('id,name,owner_id').eq('id',circleId).single(),
        db.from('circle_members').select('user_id').eq('circle_id',circleId),
        db.from('profiles').select('id,nickname'),
        db.from('catalog_items').select('*').order('created_at',{ascending:true}),
        db.from('experiences').select('*').order('updated_at',{ascending:false})
      ]);
      const theCircle=unwrap(circleResult),members=unwrap(memberResult),profiles=unwrap(profileResult),items=unwrap(itemResult),records=unwrap(recordResult);
      let code='';
      if(theCircle.owner_id===ME){const res=await db.rpc('get_invite_code');code=unwrap(res)||''}
      if(run!==refreshSerial)return;
      activeCircle=theCircle;inviteCode=code;
      const pmap=new Map(profiles.map(p=>[p.id,p.nickname]));
      USERS=members.map(m=>({id:m.user_id,name:pmap.get(m.user_id)||'圈子伙伴'})).sort((a,b)=>a.id===ME?-1:b.id===ME?1:a.name.localeCompare(b.name,'zh-CN'));
      data={items:items.map(mapCatalog),records:records.map(mapExperience)};
      if(wasCircle!==activeCircle.id)subscribeToCircle();
      // 地点图片不再在大陆用户浏览器中请求境外 Wikipedia；没有合法可用封面时使用占位。
      if(showToast)toast('圈子数据已同步');
    }catch(error){
      if(run===refreshSerial){fetchError=displayError(error);console.error('[同频] 数据同步失败',error)}
    }finally{if(run===refreshSerial){loading=false;render()}}
  }

  async function saveExperience(r){
    if(!authUser||!activeCircle)throw Error('需要先登录并加入圈子');
    const record={user_id:ME,item_id:r.itemId,circle_id:r.visibility==='circle'?activeCircle.id:null,
      visibility:r.visibility,status:r.status,rating:r.rating,note:r.note,spoiler:r.spoiler,updated_at:new Date().toISOString()};
    unwrap(await db.from('experiences').upsert(record,{onConflict:'user_id,item_id'}));
    await refreshAll(false);
  }
  async function deleteExperience(itemId){
    if(!ME)return;
    try{
      unwrap(await db.from('experiences').delete().eq('user_id',ME).eq('item_id',itemId));
      closeModal();await refreshAll(false);toast('记录已从云端删除');
    }catch(error){toast('删除失败：'+displayError(error))}
  }
  async function createCatalogItem(item){
    const {data:inserted,error}=await db.from('catalog_items').insert({
      category:item.category,name:item.name.trim().slice(0,100),subtitle:(item.subtitle||'').slice(0,120),
      description:(item.description||'').slice(0,1500),cover_url:httpsUrl(item.coverUrl)||'',
      source_url:httpsUrl(item.sourceUrl)||'',year:String(item.year||'').slice(0,8),
      provider:item.provider||null,provider_item_id:item.providerItemId||null,
      emoji:item.emoji||CAT_EMOJI[item.category],created_by:ME,circle_id:activeCircle.id
    }).select('*').single();
    if(error){
      if(error.code==='23505'){
        await refreshAll(false);
        const existing=findExistingCatalogItem(data.items,{...item,providerId:item.providerItemId});
        if(existing)return existing;
      }
      throw error;
    }
    await refreshAll(false);
    return mapCatalog(inserted);
  }
  async function sendLoginOtp(email){
    const normalized = String(email || '').trim().toLowerCase();
    if(!/^\S+@\S+\.\S+$/.test(normalized))throw new Error('请输入有效的邮箱地址');
    const elapsed = Date.now() - lastOtpSentAt;
    if(pendingOtpEmail===normalized && elapsed>0 && elapsed<60000){
      throw new Error(`请等待 ${Math.ceil((60000-elapsed)/1000)} 秒后再重新发送`);
    }
    const {error}=await db.auth.signInWithOtp({
      email:normalized,
      options:{shouldCreateUser:true}
    });
    if(error)throw error;
    pendingOtpEmail=normalized;
    lastOtpSentAt=Date.now();
    render();
    toast('验证码邮件已发送，请在此页面输入验证码');
  }
  async function logout(){
    if(!db)return;
    try{unwrap(await db.auth.signOut());authUser=null;fetchError='';loading=false;await refreshAll(false);location.hash='feed';toast('已退出登录')}
    catch(error){toast('退出登录失败：'+displayError(error))}
  }
  async function boot(){
    if(!ready){loading=false;render();return}
    try{
      const {data:{session},error}=await db.auth.getSession();if(error)throw error;
      authUser=session?.user||null;
      await refreshAll(false);
      db.auth.onAuthStateChange((event,session)=>{
        if(['SIGNED_IN','SIGNED_OUT','USER_UPDATED'].includes(event)){
          const nextId=session?.user?.id||null;
          if(nextId===authUser?.id&&event!=='USER_UPDATED')return;
          authUser=session?.user||null;
          setTimeout(()=>refreshAll(false),0);
        }
      });
      document.addEventListener('visibilitychange',()=>{
        if(document.visibilityState==='visible'&&authUser&&activeCircle)refreshAll(false);
      });
      // 对从圈内公开改为私密的记录，接收方可能不会收到 UPDATE 事件：
      // 定期重新走 RLS 查询，避免浏览器长期停留在旧的公开状态。
      setInterval(()=>{
        if(document.visibilityState==='visible'&&authUser&&activeCircle)refreshAll(false);
      },60000);
    }catch(error){fetchError=displayError(error);loading=false;render()}
  }

  function render(){
    const active=ready && !loading && authUser && activeCircle;
    document.body.classList.toggle('auth-mode',!active);
    if(!ready){$('page').innerHTML=gate('setup');return}
    if(loading){$('page').innerHTML=gate('loading');return}
    if(fetchError){$('page').innerHTML=gate('error');return}
    if(!authUser){$('page').innerHTML=gate('login');return}
    if(!activeCircle){$('page').innerHTML=gate('circle');return}
    $('rail-foot').innerHTML=`<div class="circle-avatar-stack">${USERS.slice(0,4).map(u=>`<span>${esc(u.name.slice(-1))}</span>`).join('')}</div><strong>${esc(activeCircle.name)}</strong><small>${USERS.length} 位成员 · 私密圈子</small><div class="private-hint">🔒 登录与 RLS 权限保护 · 成员评分已云端同步</div>`;
    nav();$('page').dataset.page=view.page;
    $('page').innerHTML=({feed,discover,circle,me,detail:detailPage}[view.page]||feed)();side();
  }
  function selectionOptions(items,selected) {return items.map(([value,label])=>`<option value="${value}" ${selected===value?'selected':''}>${esc(label)}</option>`).join('')}
  function openModal(html){$('modal-root').innerHTML=`<div class="modal-backdrop" data-action="modal-background"><div class="modal" role="dialog" aria-modal="true" aria-label="编辑体验">${html}</div></div>`}
  function closeModal(){$('modal-root').innerHTML=''}
  function modalTop(title){return `<div class="modal-head"><h2>${title}</h2><button class="close-btn" data-action="close" aria-label="关闭">×</button></div>`}
  function recordForm(id=''){const item = itemById(id)||null,rec=item?own(id):null;const cat=item?.category||'game';const first=(data.items.find(x=>x.category===cat)||{}).id||'';const selected=id||first;
    openModal(`${modalTop(rec?'编辑我的体验':'添加体验记录')}<form id="record-form"><div class="form-field"><label for="record-category">类别</label><select class="form-control" id="record-category" name="category">${selectionOptions([['game','🎮 游戏'],['anime','📺 动画'],['place','📍 旅行地点']],cat)}</select></div><div class="form-field"><label for="record-item">作品 / 地点</label><select class="form-control" id="record-item" name="itemId">${data.items.filter(x=>x.category===cat).map(x=>`<option value="${esc(x.id)}" ${x.id===selected?'selected':''}>${esc(x.name)}</option>`).join('')}</select><button type="button" class="link-btn" data-action="new-item" style="justify-self:start">找不到？手动创建新条目 →</button></div>
    <div class="form-grid"><div class="form-field"><label for="record-status">体验状态</label><select class="form-control" id="record-status" name="status">${selectionOptions(STATUS[cat],rec?.status||'done')}</select></div><div class="form-field"><label for="record-rating">我的评分（可选）</label><input class="form-control" id="record-rating" name="rating" type="number" inputmode="decimal" placeholder="暂不评分" step="0.5" min="0.5" max="10" value="${rec&&isRated(rec)?rec.rating:''}"/></div></div>
    <div class="form-field"><label for="record-note">简短评价（可选）</label><textarea class="form-control" id="record-note" name="note" maxlength="2000" placeholder="你的真实感受，几句话就够了…">${esc(rec?.note||'')}</textarea><label class="spoiler-switch"><input type="checkbox" name="spoiler" ${rec?.spoiler?'checked':''}/> 这条短评包含剧透，默认隐藏</label></div><div class="form-field"><label for="record-visibility">可见范围</label><select class="form-control" id="record-visibility" name="visibility">${selectionOptions([['circle','👥 圈内可见'],['private','🔒 仅自己可见']],rec?.visibility||'circle')}</select></div>
    <div class="modal-actions">${rec?'<button type="button" class="btn-ghost danger" data-action="delete" data-id="'+esc(rec.itemId)+'">删除记录</button>':''}<button class="btn-ghost" type="button" data-action="close">取消</button><button class="primary-btn" type="submit">保存记录</button></div></form>`)}
  function newItemForm(){openModal(`${modalTop('创建一个新条目')}<form id="item-form"><div class="form-field"><label for="item-category">类别</label><select class="form-control" name="category" id="item-category">${selectionOptions([['game','🎮 游戏'],['anime','📺 动画'],['place','📍 旅行地点']],'game')}</select></div><div class="form-field"><label for="item-name">名称 *</label><input class="form-control" name="name" id="item-name" maxlength="100" required placeholder="例如：京都、空洞骑士"/></div><div class="form-field"><label for="item-subtitle">补充信息（可选）</label><input class="form-control" name="subtitle" id="item-subtitle" maxlength="120" placeholder="例如：日本 · 城市 / 英文名"/></div><div class="form-field"><label for="item-cover">封面图片链接（可选）</label><input class="form-control" name="coverUrl" type="url" id="item-cover" placeholder="https://...（填写图片直链）"/><span class="field-hint">暂仅支持 HTTPS 图片链接；加载失败会显示渐变封面。</span></div><p class="help-copy">手动创建的条目可直接用于你的评分与圈内榜单。正式版将接入作品/地点搜索 API 并完善条目去重。</p><div class="modal-actions"><button class="btn-ghost" type="button" data-action="close">取消</button><button class="primary-btn" type="submit">创建并记录</button></div></form>`)}
  function ratingDistribution(id){
    const scores=visibleRatings(id).map(r=>r.rating);
    if(!scores.length)return '<div class="distribution-empty">还没有圈内评分，来成为第一个评价的人吧。</div>';
    const ranges=[[8,10,'8–10'],[6,8,'6–8'],[4,6,'4–6'],[2,4,'2–4'],[0,2,'0–2']];
    const max=Math.max(1,...ranges.map(([lower,upper])=>scores.filter(n=>n>lower&&n<=upper).length));
    return `<div class="dist-caption">圈内评分分布</div><div class="dist-list">${ranges.map(([lower,upper,label])=>{
      const count=scores.filter(n=>n>lower&&n<=upper).length;
      return `<div class="dist-line"><span>${label}</span><div class="dist-track"><i style="width:${count/max*100}%"></i></div><small>${count}</small></div>`
    }).join('')}</div>`;
  }
  function detailPage(){
    const item=itemById(view.detailId);if(!item)return '<div class="empty-state">未找到这个条目。<button class="btn-ghost" data-action="back">返回</button></div>';
    const summary=summarize(item),myRecord=own(item.id),shared=visibleRatings(item.id).sort((a,b)=>b.rating-a.rating);
    const all=allShared().filter(r=>r.itemId===item.id),otherStatus=all.filter(r=>!isRated(r));
    const tags=(item.tags||[]).map(t=>`<span class="detail-pill">${esc(t)}</span>`).join('');
    const source=httpsUrl(item.sourceUrl);
    return `<div class="detail-breadcrumb"><button data-action="back" class="back-link">${icon('arrow',16)} 返回${view.returnPage==='circle'?'榜单':view.returnPage==='feed'?'动态':view.returnPage==='me'?'我的档案':'发现'}</button><span> / </span><span>${esc(CAT_NAME[item.category])}</span></div>
      <section class="detail-hero panel">
        ${cover(item,'detail-cover')}
        <div class="detail-primary">
          <div class="eyebrow">${CAT_EMOJI[item.category]} ${CAT_NAME[item.category]} ${item.year?' / '+esc(item.year):''}</div>
          <h1>${esc(item.name)}</h1><div class="detail-original">${esc(item.subtitle||'')}</div>
          <p class="detail-description">${esc(item.description||'每个人的体验都不同。记录自己的感受，也来看看朋友的评价。')}</p>
          <div class="detail-pills">${tags}</div>
          <div class="detail-hero-actions"><button class="primary-btn" data-action="record" data-id="${esc(item.id)}">${myRecord?'✎ 编辑我的体验':'＋ 记录我的体验'}</button>${source?`<a class="btn-ghost detail-source" href="${esc(source)}" target="_blank" rel="noopener noreferrer">查看资料来源 ↗</a>`:''}</div>
        </div>
      </section>
      <div class="detail-metrics">
        <div class="panel rating-feature"><span class="metric-label">圈内平均评分</span><div class="metric-number">${summary.average===null?'—':summary.average.toFixed(1)}<small> / 10</small></div><div class="metric-context">${summary.count} 位伙伴已评分 ${summary.count<3?'· 样本较少':''}</div><div class="avatar-faces">${shared.slice(0,5).map(r=>avatar(r.userId)).join('')}</div></div>
        <div class="panel distribution-feature">${ratingDistribution(item.id)}</div>
      </div>
      <section class="panel personal-experience"><div class="panel-head"><div><div class="eyebrow">MY IMPRESSION</div><h2 class="section-title">我的体验</h2></div><button class="action-link" data-action="record" data-id="${esc(item.id)}">${myRecord?'编辑记录 →':'添加记录 →'}</button></div>
        ${myRecord?`<div class="my-experience-body"><div><span class="detail-status">${esc(labelStatus(item.category,myRecord.status))}</span><span class="detail-status">${myRecord.visibility==='private'?'🔒 仅自己可见':'👥 圈内可见'}</span></div><div class="personal-rating">${isRated(myRecord)?myRecord.rating.toFixed(1)+' <small>/ 10</small>':'暂未评分'}</div>${reviewNote(myRecord)}</div>`:'<p class="empty-personal">你还没有记录过这个条目。想看、正在玩，或者刚刚体验完，都可以从这里开始。</p>'}
      </section>
      <section class="panel friend-reviews"><div class="panel-head"><div><div class="eyebrow">FRIENDS' OPINIONS</div><h2 class="section-title">朋友们怎么说</h2></div><span class="subtle-count">${shared.length} 条评分</span></div>
        ${shared.length?shared.map(r=>`<div class="friend-review">${avatar(r.userId)}<div class="review-main"><div class="review-title"><strong>${esc(userById(r.userId).name)}</strong><span>${esc(labelStatus(item.category,r.status))}</span><span class="review-date">${notifyAge(r.updatedAt)}</span></div>${reviewNote(r)}${!r.note?'<div class="review-muted">还没有留下短评</div>':''}</div><div class="friend-score">${r.rating.toFixed(1)}<small>/10</small></div></div>`).join(''):'<div class="empty-state"><strong>暂时没有公开评分</strong><p>你可以给这个条目写下圈内第一条评价。</p></div>'}
        ${otherStatus.length?`<div class="watch-status">另有 ${otherStatus.length} 位伙伴已收藏或标记进度，尚未评分。</div>`:''}
        <p class="footer-note">圈子评分只统计当前公开的有效分数。你的私密记录不会进入好友榜单。</p>
      </section>`;
  }
  function detail(id){
    if(!itemById(id))return;
    if(view.page!=='detail')view.returnPage=view.page;
    location.hash='item/'+encodeURIComponent(id);
    syncRoute();
  }
  function syncRoute(){
    const h=decodeURIComponent(location.hash.replace(/^#/,''));
    if(h.startsWith('item/')){view.detailId=h.slice(5);view.page='detail'}
    else if(['feed','discover','circle','me'].includes(h)){view.page=h;view.detailId=''}
    else {view.page='feed';view.detailId=''}
    render();if(view.page==='discover'&&view.search.trim().length>=2&&remote.query!==view.search.trim())startRemoteSearch();window.scrollTo({top:0,behavior:'instant'});
  }
  function handleAction(target,clickEvent){const action=target.dataset.action;
    if(action==='navigate'){location.hash=target.dataset.page;syncRoute()}
    else if(action==='new-record')recordForm();
    else if(action==='record')recordForm(target.dataset.id);
    else if(action==='detail')detail(target.dataset.id);
    else if(action==='back'){location.hash=view.returnPage||'discover';syncRoute()}
    else if(action==='reveal-spoiler'){const box=target.closest('.spoiler-note'),p=box?.querySelector('.spoiler-text');if(p){p.hidden=!p.hidden;target.textContent=p.hidden?'点此查看':'收起剧透'}}
    else if(action==='new-item')newItemForm();
    else if(action==='import-remote')importRemote(target.dataset.index);
    else if(action==='close')closeModal();
    else if(action==='modal-background'&&target===clickEvent.target)closeModal();
    else if(action==='category'){view.category=target.dataset.category;render();startRemoteSearch()}
    else if(action==='rank-category'){view.rankCategory=target.dataset.category;render()}
    else if(action==='personal-category'){view.personalCategory=target.dataset.category;render()}
    else if(action==='delete'){if(confirm('确认从云端删除自己的这条记录？'))deleteExperience(target.dataset.id)}
    else if(action==='refresh')refreshAll(true)
    else if(action==='logout')logout()
    else if(action==='change-login-email'){pendingOtpEmail='';render()}
    else if(action==='resend-otp'){
      if(isBusy||!pendingOtpEmail)return;
      isBusy=true;
      sendLoginOtp(pendingOtpEmail).catch(err=>toast('发送失败：'+displayError(err))).finally(()=>{isBusy=false});
    }
    else if(action==='copy-invite'){if(inviteCode)navigator.clipboard.writeText(inviteCode).then(()=>toast('邀请码已复制')).catch(()=>toast('复制失败，请手动选择邀请码'))}
    else if(action==='export')exportData();
    else if(action==='import')$('import-file').click();
  }
  document.addEventListener('click', e=>{const target=e.target.closest('[data-action]');if(target)handleAction(target,e)});
  document.addEventListener('input', e=>{if(e.target.id==='search-input'){view.search=e.target.value;$('discover-list').innerHTML=discoverList();startRemoteSearch()}});
  document.addEventListener('change', e=>{
    const t=e.target;
    if(t.id==='min-three'){view.minThree=t.checked;$('ranking-list').innerHTML=rankingHTML()}
    else if(t.id==='rank-mode'){view.rankMode=t.value;$('ranking-list').innerHTML=rankingHTML()}
    else if(t.id==='personal-status'){view.personalStatus=t.value;$('personal-list').innerHTML=personalList()}
    else if(t.id==='personal-sort'){view.personalSort=t.value;$('personal-list').innerHTML=personalList()}
    else if(t.id==='record-category'){const category=t.value;$('record-item').innerHTML=data.items.filter(x=>x.category===category).map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');$('record-status').innerHTML=selectionOptions(STATUS[category],'done');const first=itemById($('record-item').value),rec=first?own(first.id):null;$('record-status').value=rec?.status||'done';$('record-rating').value=rec&&isRated(rec)?rec.rating:'';$('record-note').value=rec?.note||'';$('record-visibility').value=rec?.visibility||'circle';const spoiler=e.target.form?.querySelector('input[name="spoiler"]');if(spoiler)spoiler.checked=!!rec?.spoiler}
    else if(t.id==='record-item'){const item=itemById(t.value);if(!item)return;const rec=own(item.id);$('record-status').value=rec?.status||'done';$('record-rating').value=rec&&isRated(rec)?rec.rating:'';$('record-note').value=rec?.note||'';$('record-visibility').value=rec?.visibility||'circle';const spoiler=e.target.form?.querySelector('input[name="spoiler"]');if(spoiler)spoiler.checked=!!rec?.spoiler}
    else if(t.id==='import-file')importData(t);
  });
  document.addEventListener('submit', async e=>{
    const form=e.target, id=form.id;
    if(!['record-form','item-form','login-form','otp-form','create-circle-form','join-circle-form','nickname-form'].includes(id))return;
    e.preventDefault();
    if(isBusy)return;
    const f=new FormData(form);
    try{
      isBusy=true;
      if(id==='login-form'){
        await sendLoginOtp(f.get('email'));
      } else if(id==='otp-form'){
        if(!pendingOtpEmail)throw Error('请先填写邮箱并发送验证码');
        const token=String(f.get('token')||'').trim();
        if(!/^\d{6,8}$/.test(token))throw Error('请输入邮件中的数字验证码');
        const {data:result,error}=await db.auth.verifyOtp({email:pendingOtpEmail,token,type:'email'});
        if(error)throw error;
        if(!result?.session?.access_token||!result?.user)throw Error('验证后未获得登录会话，请重试');
        pendingOtpEmail='';
        lastOtpSentAt=0;
        authUser=result.user;
        fetchError='';
        loading=false;
        await refreshAll(false);
        render();
        toast('登录成功，欢迎来到同频！');
      } else if(id==='create-circle-form'){
        const {error}=await db.rpc('create_circle',{p_name:String(f.get('circleName')||'').trim()});
        if(error)throw error;
        await refreshAll(true);toast('圈子创建成功！');
      } else if(id==='join-circle-form'){
        const {error}=await db.rpc('join_circle',{p_code:String(f.get('inviteCode')||'').trim()});
        if(error)throw error;
        await refreshAll(true);toast('成功加入圈子！');
      } else if(id==='nickname-form'){
        const nickname=String(f.get('nickname')||'').trim().slice(0,40);
        if(!nickname)throw Error('请输入昵称');
        const {error}=await db.from('profiles').update({nickname}).eq('id',ME);
        if(error)throw error;
        await refreshAll(true);toast('昵称已更新');
      } else if(id==='record-form'){
        const item=itemById(String(f.get('itemId')));
        if(!item)throw Error('请先创建或选择条目');
        const raw=String(f.get('rating')||'').trim();const rating=raw===''?null:Number(raw);
        if(rating!==null&&(!Number.isFinite(rating)||rating<.5||rating>10||rating*2!==Math.round(rating*2)))throw Error('评分需要在 0.5～10 之间，步长为 0.5');
        const status=String(f.get('status'));
        if(!STATUS[item.category].some(x=>x[0]===status))throw Error('请选择正确的体验状态');
        await saveExperience({itemId:item.id,status,rating,note:String(f.get('note')||'').trim().slice(0,2000),visibility:f.get('visibility')==='private'?'private':'circle',spoiler:f.has('spoiler')});
        closeModal();toast('记录已保存到云端');
      } else if(id==='item-form'){
        const name=String(f.get('name')||'').trim().slice(0,100),category=String(f.get('category')),
              subtitle=String(f.get('subtitle')||'').trim().slice(0,120),rawCover=String(f.get('coverUrl')||'').trim();
        if(!name||!CAT_NAME[category])throw Error('请输入合法的条目名称');
        if(rawCover&&!httpsUrl(rawCover))throw Error('封面必须使用 HTTPS 图片直链');
        const existing=data.items.find(x=>x.category===category&&x.name.toLocaleLowerCase()===name.toLocaleLowerCase());
        if(existing){closeModal();recordForm(existing.id);toast('条目已存在，直接记录体验即可');return}
        const result=await createCatalogItem({category,name,subtitle,coverUrl:httpsUrl(rawCover)});
        closeModal();recordForm(result.id);toast('共享条目创建成功');
      }
    }catch(err){toast('操作失败：'+displayError(err));}
    finally{isBusy=false}
  });
  function exportData(){
    if(!authUser||!activeCircle)return;
    const mine=ownRecords(),included=new Set(mine.map(x=>x.itemId));
    const items=data.items.filter(x=>included.has(x.id)).map(x=>({...x,id:x.providerItemId||x.id}));
    const records=mine.map(x=>({...x,userId:'me',itemId:itemById(x.itemId)?.providerItemId||x.itemId}));
    const blob=new Blob([JSON.stringify({app:'同频',version:3,exportedAt:new Date().toISOString(),items,records},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='tongpin-cloud-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
    toast('已下载个人记录备份');
  }
  async function importData(input){
    const file=input.files?.[0];if(!file)return;
    try{
      const payload=JSON.parse(await file.text());
      if(!Array.isArray(payload.items)||!Array.isArray(payload.records)||payload.records.length>200||payload.items.length>200)throw Error('只支持含 items/records 的 JSON 备份，单次最多 200 条');
      if(!confirm('导入的历史记录将以“仅自己可见”保存到云端，现有评分不会被覆盖，继续吗？'))return;
      const alias=new Map();
      for(const item of payload.items){
        if(!item||!CAT_NAME[item.category]||typeof item.name!=='string'||!item.name.trim())throw Error('备份条目无效');
        let existing=data.items.find(x=>x.id===item.id||x.providerItemId===item.id||(x.category===item.category&&x.name.trim().toLowerCase()===item.name.trim().toLowerCase()));
        if(!existing)existing=await createCatalogItem({category:item.category,name:item.name.slice(0,100),subtitle:String(item.subtitle||'').slice(0,120),coverUrl:httpsUrl(item.coverUrl)});
        alias.set(item.id,existing.id);
      }
      let count=0,skipped=0;
      for(const r of payload.records){
        if(!r||typeof r.itemId!=='string'||typeof r.note!=='string'){skipped++;continue}
        const item=data.items.find(x=>x.id===alias.get(r.itemId)||x.providerItemId===r.itemId||x.id===r.itemId);
        if(!item||own(item.id)){skipped++;continue}
        const rating=r.rating==null?null:Number(r.rating);
        if(rating!==null&&(!Number.isFinite(rating)||rating<0.5||rating>10||rating*2!==Math.round(rating*2))){skipped++;continue}
        const status=(STATUS[item.category]||[]).some(x=>x[0]===r.status)?r.status:'want';
        const {error}=await db.from('experiences').insert({user_id:ME,item_id:item.id,circle_id:null,visibility:'private',rating,status,note:r.note.slice(0,2000),spoiler:!!r.spoiler});
        if(error){skipped++;continue}count++;
        await refreshAll(false);
      }
      await refreshAll(true);toast(`已导入 ${count} 条私人记录，跳过 ${skipped} 条`);
    }catch(err){toast('导入失败：'+displayError(err))}
    finally{input.value=''}
  }
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
  window.addEventListener('hashchange',syncRoute);
  syncRoute();
  boot();
})();
