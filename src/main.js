import './style.css';
import "./library-theme.css";
import "./videostore-theme.css";
import "./v049-upgrade.css";
import "./v050-departure.css";
import "./v0531-podium-fix.css";
import "./v054-mobile-fix.css";
import "./v056-flow.css";
import "./v057-archive.css";
import "./v058-design.css";
import "./v059-refinement.css";
import "./v060-flowing-gallery.css";
import "./v061-collection-pages.css";
import "./v062-import-flow.css";
import "./v066-collection-export.css";
import "./v067-poster-score.css";
import {readSheetFile,parseImportRows,normalizedName} from "./sheetImport.js";
import {loadCollectionForExport,buildCollectionExportRows,collectionToCsv,collectionToXlsx} from './collectionExport.js';
import {posterScoreTone,posterScoreTier,posterScoreLabel,evaluateImportMatch} from "./importLookup.js";
import {isValidPersonalRating} from "./scoreBands.js";
import {prepareImportRow,applyImportDecision,confirmImportCandidate,clearImportCandidate,toggleImportRow,canSelectImportRow,getImportLookupJobs,getImportSelectionSummary,hasConfirmedImportItem,importReviewBucket,orderedImportRowIndices} from "./importSelection.js";
import {getPersonalStats} from "./personalStats.js";
import {createImportPacer,searchImportWithRetry,IMPORT_SEARCH_TIMEOUT_MS} from "./importSearchScheduler.js";
import {findPostSubjects} from "./postSearch.js";
import {paginate} from './pagination.js';
import {db, ready} from './cloud.js';
import {findExistingCatalogItem} from './catalogMatch.js';
import {coverImageUrl} from './coverUrl.js';

/* 同频 V0.5.1: V0.4.9 visuals restored; cover preservation + discovery paging + railway travel channel; Supabase/Auth/RLS unchanged. */
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
  let authMode = 'login';
  const NAV = [
    {id:'feed',name:'店内放映',icon:'home'}, {id:'discover',name:'找片',icon:'compass'},
    {id:'circle',name:'好友频道',icon:'users'}, {id:'posts',name:'圈内讨论',icon:'message'},
    {id:'travel',name:'沿途车站',icon:'train'}, {id:'me',name:'我的录像柜',icon:'user'}
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
    bookmark:'<path d="M5 3h14v18l-7-5-7 5z"/>',
    message:'<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H6l-4 2v-7.5a8.5 8.5 0 1 1 19-3z"/>',
    train:'<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 11h14M8 21l3-3m5 3-3-3M8 15h.01M16 15h.01"/>'
  };
  const icon = (name,size=18) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]||ICON_PATHS.spark}</svg>`;
  const CATEGORIES = [
    {id:'all',name:'全部'}, {id:'game',name:'🎮 游戏'},
    {id:'anime',name:'📺 动画'}
  ];
  const CAT_NAME = {game:'游戏',anime:'动画',place:'旅行地点'};
  const CAT_EMOJI = {game:'🎮',anime:'📺',place:'📍'};
  const STATUS = {
    game:[['want','想玩'],['doing','游玩中'],['done','已通关'],['paused','已搁置']],
    anime:[['want','想看'],['doing','观看中'],['done','已看完'],['paused','已搁置']],
    place:[['want','想去'],['done','去过']]
  };
  let data = {items:[], records:[]};
  let threadData={posts:[],comments:[],loading:false,error:'',circleId:'',loadedAt:0};
  let threadSerial=0, bulkDraft=null, sheetLookupSerial=0;
  let collectionExportRunning=false;
  let theme='club';try{theme=localStorage.getItem('tongpin:ui-theme')==='archive'?'archive':'club'}catch(_){}
  document.body.classList.toggle('theme-archive',theme==='archive');
  let remote = {items:[],notices:[],state:'idle',query:'',category:''};
  const detailLookups = new Set(); // per-session on-demand hydration for legacy Bangumi entries
  const detailMetadata = new Map(); // retain hydrated fields across normal background refreshes
  let searchTimer = null;
  let searchSerial = 0;
  let travelSearchTimer = null;
  let travelSearchSerial = 0;
  let travelRemote = {items:[],notices:[],state:'idle',query:'',category:'place',page:1,hasMore:false};
  let view = {page:'feed',detailId:'',postId:'',postCategory:'all',postPage:1,returnPage:'discover',category:'all',rankCategory:'all',rankMode:'average',rankPage:1,feedPage:1,minThree:false,search:'',personalCategory:'all',personalStatus:'all',personalSort:'recent',personalDisplay:'shelf',posterPage:1,localPage:1,remotePage:1,travelSearch:'',travelLocalPage:1,travelRemotePage:1,travelMinThree:false};
  try { const display=localStorage.getItem('tongpin:archive-display');if(['list','poster','shelf'].includes(display))view.personalDisplay=display;else if(theme==='archive')view.personalDisplay='poster'; } catch(_) {if(theme==='archive')view.personalDisplay='poster'}
  const $ = id => document.getElementById(id);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const itemById = id => data.items.find(x=>x.id===id);
  const userById = id => USERS.find(x=>x.id===id)||{name:id===ME?'我':'未知用户',id};
  const own = id => data.records.find(x=>x.userId===ME && x.itemId===id);
  const allShared = () => data.records.filter(x=>x.visibility==='circle');
  const ownRecords = () => data.records.filter(x=>x.userId===ME);
  const isRated = rec => isValidPersonalRating(rec?.rating);
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
  const bangumiBadge=(item,small=false)=>item.provider==='bangumi'&&Number(item.bangumiScore)>0
    ? `<span class="bangumi-badge ${small?'bangumi-badge-small':''}" title="Bangumi 社区评分，不计入圈子榜单">BGM <b>${Number(item.bangumiScore).toFixed(1)}</b></span>` : '';
  const externalBadge=item=>item.externalScoreSource && Number(item.externalScore)>0?`<span class="kind-chip" title="外部社区评分，不参与圈内平均分">${esc(item.externalScoreSource)} <b>${Number(item.externalScore).toFixed(1)} / ${item.externalScoreMax||10}</b></span>`:'';
  const itemKinds=item=>[item.platform, ...(Array.isArray(item.tags)?item.tags:[])].filter(Boolean).slice(0,5);
  const cover=(item,cl='')=>{
    const src = coverImageUrl(coverCache[item.id] || item.coverUrl);
    return `<div class="cover ${esc(item.category)} ${cl} cover-${esc(item.id)}" data-cover-id="${esc(item.id)}" role="img" aria-label="${esc(item.name)}封面或占位插图"><span class="cover-glow"></span><span class="cover-symbol">${esc(item.emoji||CAT_EMOJI[item.category])}</span><span class="cover-grain"></span><span class="cover-caption">RES·COVER</span>${src?`<img class="cover-backdrop" src="${esc(src)}" alt="" aria-hidden="true" loading="lazy" decoding="async" onerror="this.remove()"/><img class="cover-photo" src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.remove()"/>`:''}</div>`
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
  function nav(){
    const archiveNames={feed:'资料首页',discover:'发现作品',circle:'圈内榜单',posts:'讨论室',travel:'旅行档案',me:'我的收藏'};
    const displayName=n=>theme==='archive'?(archiveNames[n.id]||n.name):n.name;
    const build=(mobile=false)=>(mobile?NAV.filter(n=>n.id!=='posts'):NAV).map(n=>mobile
      ? `<button class="${(view.page===n.id||(view.page==='detail'&&view.returnPage===n.id)||(view.page==='posts'&&n.id==='circle')||(view.page==='post'&&n.id==='circle'))?'active':''}" data-action="navigate" data-page="${n.id}"><span class="bottom-icon">${icon(n.icon,21)}</span><span>${displayName(n)}</span></button>`
      : `<button class="nav-button ${view.page===n.id?'active':''}" data-action="navigate" data-page="${n.id}"><span class="nav-icon">${icon(n.icon,19)}</span><span>${displayName(n)}</span>${(n.id===view.page||(view.page==='detail'&&n.id===view.returnPage))?'<span class="nav-active-dot"></span>':''}</button>`).join('');
    $('side-nav').innerHTML=build();
    $('bottom-nav').innerHTML=build(true);
    $('top-nav').innerHTML=NAV.map(n=>`<button class="top-nav-link ${(view.page===n.id||(view.page==='detail'&&view.returnPage===n.id))?'active':''}" data-action="navigate" data-page="${n.id}"><span>${displayName(n)}</span></button>`).join('');
  }
  function side(){const rated=ownRecords().filter(isRated);const ranked=data.items.map(summarize).filter(x=>x.count).sort((a,b)=>b.average-a.average).slice(0,3);$('right-rail').innerHTML=`
    <div class="side-welcome"><span class="side-flower">✺</span><div class="side-welcome-kicker">A NOTE FROM THE VIDEO STORE</div><h3>生活值得<br>被认真收藏。</h3><p>一场游戏，一段旅程，一部留在心里的动画。把这些微小的闪光，慢慢整理成自己的片单。</p><div class="side-line"></div><span class="side-welcome-footer">${icon('spark',15)} SOMEWHERE TO BELONG</span></div>
    <div class="panel side-panel"><div class="panel-head"><h4>圈内好评 <span class="side-dot">●</span></h4><button class="action-link" data-action="navigate" data-page="circle">更多 ${icon('arrow',13)}</button></div><div class="small-stack">${ranked.map((x,i)=>`<button class="clickable side-rank" data-action="detail" data-id="${x.item.id}"><span class="side-rank-num">0${i+1}</span>${cover(x.item,'rank-cover')}<span class="side-rank-name">${esc(x.item.name)}<small>${x.count} 人评价</small></span><b>${x.average.toFixed(1)}</b></button>`).join('')}</div></div>
    <div class="side-summary">${icon('lock',15)} <span>私密圈子 · 评分已保存到云端</span></div>`}
  function header(eyebrow,title,desc,right=''){return `<section class="intro editorial-intro"><div class="editorial-intro-copy"><div class="eyebrow">${eyebrow}</div><h1 class="headline">${title}</h1><p class="subhead">${desc}</p></div><div class="editorial-intro-aside"><span class="intro-seal">✳</span><span class="intro-vert">A LITTLE CULTURE, A LOT OF STORIES</span>${right}</div></section>`}
  function featuredSelections(){
    const selections=data.items.filter(item=>item.category!=='place').map(item=>({...summarize(item)})).filter(x=>x.count>=1).sort((a,b)=>b.average-a.average||b.count-a.count).slice(0,4);
    if(!selections.length)return `<section class="gallery-feature-empty"><span class="eyebrow">CURATOR'S SELECTION / 精选片架</span><p>这里会出现朋友们真正喜欢的作品。先记录一部，开启第一格橱窗。</p><button class="btn-ghost" data-action="navigate" data-page="discover">探索作品 ${icon('arrow',14)}</button></section>`;
    return `<section class="gallery-feature immersive-feature"><div class="gallery-feature-head"><div><span class="eyebrow">SIDE A / THE STAFF PICKS</span><h2>本周热门<br><i>正在热映。</i></h2><p class="editorial-deck">没有算法投喂，只有朋友的私藏片单。</p></div><button class="text-arrow" data-action="navigate" data-page="circle">查看完整榜单 ${icon('arrow',15)}</button></div><div class="gallery-feature-grid">${selections.map((x,i)=>`<button class="feature-volume" data-action="detail" data-id="${esc(x.item.id)}" aria-label="打开${esc(x.item.name)}详情"><span class="feature-cover-wrap">${cover(x.item,'feature-cover')}<span class="feature-volume-index">NO. 0${i+1}</span></span><span class="feature-volume-info"><span class="feature-volume-title">${esc(x.item.name)}</span><span class="feature-volume-sub">${esc(CAT_NAME[x.item.category])} / ${x.count} 位朋友打分</span></span><span class="feature-volume-rating">${x.average.toFixed(1)}</span></button>`).join('')}</div></section>`;
  }
  function chapterPassage(){
    const spotlight=data.items.filter(item=>item.category!=='place').map(summarize).filter(x=>x.count).sort((a,b)=>b.count-a.count||b.average-a.average)[0];
    return `<section class="chapter-passage"><div class="chapter-giant">01<span>/</span>03</div><div class="chapter-copy"><span class="eyebrow">SIDE B / FROM THE ARCHIVE</span><p>每一个瞬间，<br>都值得<span>按下 REC。</span></p><div class="chapter-copy-note"><small>放进去的是经历，倒带时就能看见彼此。</small></div></div>${spotlight?`<button class="chapter-postcard" data-action="detail" data-id="${esc(spotlight.item.id)}"><span class="chapter-postcard-label">TOP RENTAL / 本期热门</span>${cover(spotlight.item,'chapter-postcard-cover')}<span class="chapter-postcard-name">${esc(spotlight.item.name)}</span><span class="chapter-postcard-foot">${spotlight.count} 人评分 · 查看影片 ↗</span></button>`:`<button class="chapter-postcard chapter-postcard-empty" data-action="navigate" data-page="discover"><span class="chapter-postcard-label">A SPACE FOR STORIES</span><span class="chapter-postcard-empty-mark">✳</span><span class="chapter-postcard-name">第一盒磁带，等你录制。</span><span class="chapter-postcard-foot">进入探索 ↗</span></button>`}</section>`;
  }
  function archiveFlowingWall(){
    // Use the actual shared catalog. No remote discovery fetch and no simulated posters.
    // Prefer covers that are already in the shared library; animation only affects the CSS transform.
    const eligible=data.items.filter(item=>['game','anime'].includes(item.category) && coverImageUrl(coverCache[item.id] || item.coverUrl));
    const sorted=eligible.map((item,index)=>({item,index,summary:summarize(item)}))
      .sort((a,b)=>b.summary.count-a.summary.count || (b.summary.average||0)-(a.summary.average||0) || a.index-b.index)
      .slice(0,18).map(entry=>entry.item);
    if(!sorted.length)return `<div class="atlas-flow-wall atlas-flow-empty"><span class="atlas-wall-heading">SHARED ARCHIVE / 共享影像库</span><p>还没有可展示的游戏或动画封面。</p><button type="button" data-action="navigate" data-page="discover">去找片，添加第一部作品 ↗</button></div>`;
    const columns=[[],[],[]];sorted.forEach((item,index)=>columns[index%3].push(item));
    columns.forEach((col,index)=>{if(!col.length)col.push(sorted[index%sorted.length])});
    // Repeat each track for seamless vertical movement; decorative copies cannot receive focus.
    const art=(item,interactive)=>{
      const src=coverImageUrl(coverCache[item.id] || item.coverUrl);
      const img=`<img src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.closest('.atlas-flow-poster')?.classList.add('is-missing')"/>`;
      return interactive?`<button type="button" class="atlas-flow-poster" data-action="detail" data-id="${esc(item.id)}" aria-label="查看${esc(item.name)}" title="${esc(item.name)}">${img}</button>`:`<span class="atlas-flow-poster" aria-hidden="true">${img}</span>`;
    };
    return `<div class="atlas-flow-wall" aria-label="共享作品海报流"><span class="atlas-wall-heading">THE SHARED COLLECTION <i>● LIVE</i></span><div class="atlas-flow-stage">${columns.map((col,index)=>{
      // Columns with too few unique works loop over the same shared entries, never fabricated entries.
      const repeated=Array.from({length:Math.max(1,Math.ceil(4/col.length))},()=>col).flat();
      return `<div class="atlas-flow-lane atlas-lane-${index+1}"><div class="atlas-flow-track"><div class="atlas-flow-sequence">${repeated.map(item=>art(item,true)).join('')}</div><div class="atlas-flow-sequence" aria-hidden="true">${repeated.map(item=>art(item,false)).join('')}</div></div></div>`;
    }).join('')}</div><div class="atlas-wall-foot"><span>REAL TITLES · YOUR CIRCLE</span><span>${sorted.length} / ${eligible.length} COVERS</span></div></div>`;
  }
  function archiveLanding(){
    return `<section class="atlas-landing atlas-landing-flow"><div class="atlas-landing-copy"><span class="atlas-overline">RESONANCE / THE COLLECTION · VOL. 001</span><h1>为所有热爱，<br><em>建立一份索引。</em></h1><p>游戏、动画，和朋友留下的那些独特视角。<br>这是一个不断生长的私人影像档案。</p><div class="atlas-actions"><button class="primary-btn" data-action="navigate" data-page="discover">探索作品 ↗</button><button class="btn-ghost" data-action="navigate" data-page="me">查看我的收藏</button></div><div class="atlas-counters"><span><strong>${data.items.filter(i=>i.category!=='place').length}</strong> 共享作品</span><span><strong>${threadData.posts.length}</strong> 圈内讨论</span><span><strong>${USERS.length}</strong> 位成员</span></div></div>${archiveFlowingWall()}</section><div class="atlas-section-label"><span>01 / CURATED SELECTION</span><strong>本期精选</strong><button data-action="navigate" data-page="circle">查看完整榜单 ↗</button></div>${featuredSelections()}`;
  }
  function homePosts(){
    const posts=threadData.posts.filter(p=>itemById(p.itemId)&&['game','anime'].includes(itemById(p.itemId).category)).slice(0,3);
    return `<section class="home-discussions" aria-label="最新圈内讨论"><div class="home-posts-head"><div><span class="eyebrow">AFTER THE CREDITS / LATEST CONVERSATIONS</span><h2>刚刚开聊 <em>↗</em></h2><p>除了给作品打分，也来看看朋友们最近想聊什么。</p></div><button class="btn-ghost" data-action="navigate" data-page="posts">进入讨论区 ↗</button></div>${threadData.error?`<p class="discussion-empty">${esc(threadData.error)}</p>`:posts.length?`<div class="home-posts-grid">${posts.map(p=>{const item=itemById(p.itemId),comments=threadData.comments.filter(c=>c.postId===p.id).length;return `<button type="button" class="home-post-entry" data-action="open-post" data-id="${esc(p.id)}"><span class="home-post-cover">${cover(item,'home-post-thumb')}</span><span class="home-post-copy"><small>${esc(CAT_NAME[item.category])} / ${esc(item.name)}</small><strong>${esc(p.title)}</strong><span>${esc(userById(p.userId).name)} · ${notifyAge(p.createdAt)} · ${comments} 回复</span><em>${p.spoiler?'◈ 含剧透，点击查看':esc(p.body.slice(0,56))}</em></span><span class="home-post-arrow">↗</span></button>`}).join('')}</div>`:'<div class="home-posts-empty"><span>暂无帖子，来聊聊最近玩过或看过的作品。</span><button type="button" class="btn-ghost" data-action="new-post">＋ 发起话题</button></div>'}</section>`;
  }
  function feed(){const events=allShared().filter(r=>itemById(r.itemId)?.category!=='place').slice().sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));const mine=ownRecords().length;const feedInfo=paginate(events,view.feedPage,FEED_PAGE_SIZE);view.feedPage=feedInfo.page;return `
    ${theme==='archive'?archiveLanding():`<section class="hero gallery-hero immersive-hero video-store-hero" data-motion="hero" aria-label="同频录像店首页">
      <div class="store-backdrop" aria-hidden="true"></div><div class="store-halftone" aria-hidden="true"></div>
      <div class="gallery-hero-top"><span><i></i> ON AIR / RESONANCE VIDEO CLUB</span><span>OPEN ALL NIGHT · EST. 2026</span></div>
      <div class="hero-content"><span class="hero-kicker">YOUR LITTLE CORNER OF POP CULTURE</span>
        <h1>生活不止<br><span class="headline-serif">一种频道<span class="period">。</span></span></h1>
        <p>正在追的番、刚通关的游戏、想去的地方。<br>把热爱录成磁带，分享给同频的朋友。</p>
        <div class="hero-actions"><button class="hero-button" data-action="navigate" data-page="discover">⌕ 找片并记录 <span>${icon('arrow',17)}</span></button><button class="hero-text-button" data-action="navigate" data-page="discover">浏览全部片单 ${icon('arrow',15)}</button></div>
      </div>
      <div class="hero-showcase" aria-hidden="true"><div class="showcase-disc">● REC <small>00:04:08</small></div><div class="showcase-vhs tape-one"><span>◉</span><strong>PLAY<br>YOUR<br>STORY</strong><small>001 / ANIME</small></div><div class="showcase-vhs tape-two"><span>▶</span><strong>NO SIGNAL?<br>KEEP PLAYING.</strong><small>002 / GAMES</small></div><div class="showcase-vhs tape-three"><span>✳</span><strong>TRAVEL<br>LOG</strong><small>003 / PLACES</small></div><div class="showcase-sticker">GOOD<br>VIBES<br>ONLY <b>↗</b></div></div>
      <div class="hero-index"><span>↓ SCROLL TO TUNE IN</span><span class="scroll-track"><b></b></span><span>CH. 01 / 04</span></div>
    </section>
    <div class="gallery-marquee" aria-label="频道栏目"><div class="marquee-line"><span>✳ ALWAYS REWIND</span><span>▶ GAME / ANIME / TRAVEL</span><span>✳ YOUR FRIENDS ARE ON AIR</span><span>▶ NO ALGORITHM JUST TASTE</span><span>同频 · 录像俱乐部</span></div></div>
    <div class="overview-row"><div class="overview-item"><div class="overview-icon icon-lilac">${icon('bookmark',19)}</div><div><strong>${mine}</strong><span>我的记录</span></div></div><div class="overview-divider"></div><div class="overview-item"><div class="overview-icon icon-peach">${icon('star',19)}</div><div><strong>${allShared().filter(isRated).length}</strong><span>圈内评分</span></div></div><div class="overview-divider"></div><div class="overview-item"><div class="overview-icon icon-sage">${icon('users',19)}</div><div><strong>${USERS.length}</strong><span>同频伙伴</span></div></div></div>
    ${chapterPassage()}
    ${featuredSelections()}`}
    <div class="feed-section-head"><div><span class="eyebrow">NEW RELEASES / FRIEND FREQUENCY <span class="eyebrow-dot">✧</span></span><h2 class="section-title">${theme==='archive'?'伙伴的近期记录':'朋友正在播放'}<span class="tiny-spark"> ✳</span></h2><p class="section-sub">新番与新游，每一天都有新节目；旅行故事请到「沿途车站」。</p><div class="feed-section-meta"><span class="feed-count">${feedInfo.total} 条动态</span>${feedInfo.totalPages>1?`<span class="feed-page-chip">PAGE ${feedInfo.page}/${feedInfo.totalPages}</span>`:''}</div></div><button class="btn-ghost feed-head-btn" data-action="navigate" data-page="circle">圈内榜单 ${icon('arrow',15)}</button></div>
    <div class="feed-list">${!feedInfo.items.length?'<div class="panel empty-state"><strong>圈子里还没有动态</strong><p>记录第一条体验，和朋友一起慢慢积累回忆。</p><button class="primary-btn" data-action="navigate" data-page="discover">⌕ 去找片并记录</button></div>':''}${feedInfo.items.map((r,index)=>{const item=itemById(r.itemId);if(!item)return '';return `<article class="panel feed-card ${index===0?'feed-card-feature':''}"><div class="feed-user">${avatar(r.userId)}<div><div class="name">${esc(userById(r.userId).name)} <span class="user-action">${esc(labelStatus(item.category,r.status))}了</span></div><div class="meta">${notifyAge(r.updatedAt)} · 分享了一条体验</div></div><span class="spacer"></span><span class="tag tag-${item.category}">${CAT_EMOJI[item.category]} ${CAT_NAME[item.category]}</span></div>
      <div class="content-row">${cover(item)}<div class="feed-detail"><div class="feed-item-sub">${esc(item.subtitle||CAT_NAME[item.category])}</div><button class="record-title clickable" data-action="detail" data-id="${item.id}">${esc(item.name)}</button><div class="feed-ratingline">${isRated(r)?`<span class="rating" aria-label="个人评分 ${r.rating.toFixed(1)} / 10"><em>MY SCORE</em><strong>${r.rating.toFixed(1)}</strong><small> / 10</small></span><span class="rating-label">${r.rating>=9?'特别喜欢':r.rating>=8?'值得体验':'我的评分'}</span>`:`<span class="tag gray">暂未评分</span>`}</div>${r.note?`<div class="note">${r.spoiler?'◈ 剧透内容已隐藏，进入作品详情后可查看':`“${esc(r.note)}”`}</div>`:''}</div></div><div class="subbar"><span>${icon('users',14)} ${visibleRatings(item.id).length} 位伙伴打过分</span><span class="spacer"></span><button class="action-link" data-action="detail" data-id="${item.id}">查看评价 ${icon('arrow',14)}</button></div></article>`}).join('')}</div>
    ${feedInfo.totalPages>1?`<div class="feed-pager-wrap"><span class="pagination-summary">最新动态分页展示 · 每页 ${FEED_PAGE_SIZE} 条</span>${renderPager('feed',feedInfo.page,feedInfo.totalPages)}</div>`:''}
    ${homePosts()}`;}
  const FEED_PAGE_SIZE = 8;
  const LOCAL_PAGE_SIZE = 10;
  const TRAVEL_PAGE_SIZE = 9;
  function renderPager(scope,page,totalPages){
    if(totalPages<=1)return '';
    const start=Math.max(1,Math.min(page-2,totalPages-4));
    const end=Math.min(totalPages,start+4);
    const buttons=[];
    for(let i=start;i<=end;i++)buttons.push(`<button type="button" class="pager-page ${i===page?'active':''}" data-action="page-change" data-scope="${scope}" data-page="${i}" aria-label="第 ${i} 页" aria-current="${i===page?'page':'false'}">${i}</button>`);
    const aria=scope==='feed'?'朋友正在播放':scope==='local'?'共享作品':scope==='travel-local'?'旅行地点':scope==='rank'?'好友频道排行榜':scope==='posts'?'圈内帖子':scope==='poster'?'我的海报墙':'线上搜索';return `<nav class="page-controls" aria-label="${aria}分页"><button type="button" data-action="page-change" data-scope="${scope}" data-page="${page-1}" ${page===1?'disabled':''}>← 上一页</button><span class="pager-number-group">${buttons.join('')}</span><button type="button" data-action="page-change" data-scope="${scope}" data-page="${page+1}" ${page>=totalPages?'disabled':''}>下一页 →</button><span class="pager-page-label">${page} / ${totalPages}</span></nav>`;
  }
  function discoverMatches(){const search=view.search.trim().toLocaleLowerCase();return data.items.filter(x=>x.category!=='place'&&(view.category==='all'||x.category===view.category)&&(!search||`${x.name} ${x.subtitle||''}`.toLocaleLowerCase().includes(search)));}
  function discoverList(){const matches=discoverMatches(),info=paginate(matches,view.localPage,LOCAL_PAGE_SIZE);view.localPage=info.page;
    return info.items.length?info.items.map(x=>{const s=summarize(x);return `<div class="item-card">${cover(x,'rank-cover')}<div class="item-text"><button class="clickable" data-action="detail" data-id="${esc(x.id)}"><strong>${esc(x.name)}</strong></button><small>${esc(x.subtitle||CAT_NAME[x.category])} · ${s.count?s.average.toFixed(1)+'圈内分 · '+s.count+'人':'暂无圈内评分'}</small><div class="remote-meta">${bangumiBadge(x,true)}${externalBadge(x)}${x.platform?`<span class="kind-chip">${esc(x.platform)}</span>`:''}</div></div><button class="small-btn" data-action="record" data-id="${esc(x.id)}">${own(x.id)?'编辑记录':'＋ 记录'}</button></div>`}).join(''):'<div class="empty-state"><strong>片库暂无匹配条目</strong><p>试试下方在线搜索；如果没有结果，也可以手动创建。</p></div>';
  }
  function discoverPager(){const info=paginate(discoverMatches(),view.localPage,LOCAL_PAGE_SIZE);return `<span class="pagination-summary">已收录 ${info.total} 部作品 · 每页 ${LOCAL_PAGE_SIZE} 部</span>${renderPager('local',info.page,info.totalPages)}`;}
  function localMatch(remoteItem){
    return findExistingCatalogItem(data.items,remoteItem);
  }
  function remoteResultsHTML(source=remote, category=view.category, query=view.search){
    const q=query.trim();
    if(q.length<2)return '<p class="search-prompt">至少输入 2 个字符，开始在线搜索。</p>';
        if(source.state==='loading')return '<p class="search-prompt">正在搜索外部资料…</p>';
    if(source.state==='error')return `<p class="search-prompt search-error">${esc(source.error)} · 可继续使用共享库或手动创建。</p>`;
    if(source.category!==category||source.query!==q)return '<p class="search-prompt">准备搜索…</p>';
    const isTravel=category==='place';
    const cards=source.items.map((x,index)=>{
      const local=localMatch(x);
      return `<div class="item-card remote-card ${isTravel?'station-remote-card':''}"><div class="remote-cover"><span>${CAT_EMOJI[x.category]}</span>${coverImageUrl(x.coverUrl)?`<img src="${esc(coverImageUrl(x.coverUrl))}" alt="" loading="lazy" decoding="async" onerror="this.remove()"/>`:''}</div><div class="item-text"><strong>${esc(x.name)}</strong><small>${esc(x.subtitle||CAT_NAME[x.category])} · ${esc(x.provider==='amap'?'高德地图':x.provider==='igdb'?'IGDB':x.provider==='jikan'?'MAL / Jikan':x.provider==='rawg'?'RAWG':'Bangumi')}</small>${httpsUrl(x.sourceUrl)?`<a class="source-attribution" href="${esc(httpsUrl(x.sourceUrl))}" target="_blank" rel="noopener noreferrer">访问 ${esc(x.provider==='rawg'?'RAWG':x.provider==='jikan'?'MyAnimeList':'资料来源')} ↗</a>`:''}<div class="remote-meta">${bangumiBadge(x,true)}${externalBadge(x)}${x.platform?`<span class="kind-chip">${esc(x.platform)}</span>`:''}${(x.tags||[]).slice(0,2).map(t=>`<span class="kind-chip">${esc(t)}</span>`).join('')}</div></div><button class="small-btn" data-action="import-remote" data-source="${isTravel?'travel':'discover'}" data-index="${index}">${local?'已有条目 · 记录':'加入并评分'}</button></div>`;
    }).join('');
    const tips=source.notices.length?`<p class="search-notices">${source.notices.map(esc).join('；')}</p>`:'';
    const current=Number(source.page)||1;
    const paging=source.items.length||current>1?`<div class="remote-page-controls"><button type="button" data-action="page-change" data-scope="${isTravel?'travel-remote':'remote'}" data-page="${current-1}" ${current===1?'disabled':''}>← 上一页</button><span>在线结果 / 第 ${current} 页</span><button type="button" data-action="page-change" data-scope="${isTravel?'travel-remote':'remote'}" data-page="${current+1}" ${!source.hasMore?'disabled':''}>下一页 →</button></div>`:'';
    return `${tips}${cards||'<div class="empty-state"><strong>暂无匹配结果</strong><p>游戏可以试试中文名、英文名或日文原名；若出现数据源故障提示，请检查 Vercel 日志。也可手动创建。</p></div>'}${paging}`;
  }
  function discover(){const q=view.search.trim();return `
    <section class="tape-search-hero">
      <div class="archive-search-header" aria-hidden="false">
        <div class="archive-search-copy"><span class="archive-search-kicker">RESOURCES / 01 · COLLECTION INDEX</span><h1>发现下一段<br><em>值得收藏的故事。</em></h1><p>从朋友们的共享作品库出发，继续查找动画与游戏资料。每一次收藏，都是一次新的探索。</p><div class="archive-search-counts"><span><b>${data.items.filter(x=>x.category!=='place').length}</b> 部已收录</span><span><b>${data.items.filter(x=>x.category==='anime').length}</b> 部动画</span><span><b>${data.items.filter(x=>x.category==='game').length}</b> 部游戏</span></div></div>
        <div class="archive-search-index"><span class="archive-index-overline">CATALOGUE / FIELD GUIDE</span><div class="archive-index-glyph" aria-hidden="true">⌕</div><strong>从一个名字开始。</strong><p>搜索共享馆藏，或前往外部资料库发现更多作品。</p><div class="archive-index-footer">RESONANCE · PRIVATE COLLECTION <span>01 / 03</span></div></div>
      </div>
      <div class="search-signal" aria-hidden="true"><span class="search-signal-dot"></span> INPUT / CH. 02 <span>● LIVE SEARCH</span></div>
      <div class="search-intro-grid"><div><div class="eyebrow">THE VIDEO FINDER / 02</div><h1>找点<br><span>新鲜的。</span></h1><p>用一个名字开启搜寻。先翻找共同片库，再检索 Bangumi；已配置的游戏备源也会一起参与。地点搜索有自己的列车专线。</p></div>
      <div class="search-retro-screen" aria-hidden="true"><span class="search-screen-top">RESONANCE SEARCH ENGINE / 2026</span><b>⌕</b><strong>FIND YOUR<br>NEXT FIX.</strong><span class="search-wave">▂▄▆█▅▃▅█▄▂</span></div></div>
      <div class="search-control-deck"><label class="searchbar searchbar-v49"><span>⌕</span><input id="search-input" type="search" aria-label="搜索游戏、动画或旅行地点" placeholder="输入游戏或动画的名称…" value="${esc(view.search)}" autocomplete="off"/><span class="search-shortcut">SEARCH / ENTER</span></label>
      <div class="search-deck-footer"><span class="search-channel-label">选择搜索频道</span>${cats(view.category,'category')}<button type="button" class="search-create" data-action="new-item">＋ 手动建档</button></div></div>
      ${!q?`<div class="search-quick-picks"><span>TRY A TITLE ↘</span><button data-action="search-preset" data-category="anime" data-query="葬送的芙莉莲">葬送的芙莉莲 ↗</button><button data-action="search-preset" data-category="game" data-query="空洞骑士">空洞骑士 ↗</button><button data-action="navigate" data-page="travel">旅行地点去沿途车站 ↗</button></div>`:''}
    </section>
    <section class="search-results-stage" aria-live="polite"><div class="search-chapter-head"><span>01 / IN OUR COLLECTION</span><h2>店内现货 <i>LOCAL FINDS</i></h2><small>${discoverMatches().length} 份匹配作品 · 每页 ${LOCAL_PAGE_SIZE} 项</small></div><div id="discover-list" class="catalog-find-list">${discoverList()}</div><div id="discover-pager">${discoverPager()}</div></section>
    <section class="search-results-stage online-stage"><div class="search-chapter-head"><span>02 / BEYOND THE SHELVES</span><h2>新片到货 <i>ONLINE FINDS</i></h2><small>全部频道会同时搜索动画与游戏；也可以选单一频道缩小范围</small></div><div id="remote-results" class="catalog-find-list">${remoteResultsHTML()}</div></section>`}
  function startRemoteSearch(){
    clearTimeout(searchTimer);const serial=++searchSerial;
    const q=view.search.trim(), category=view.category;
    if(q.length<2){
      remote={items:[],notices:[],state:'idle',query:q,category,page:1,hasMore:false};
      if($('remote-results'))$('remote-results').innerHTML=remoteResultsHTML();
      return;
    }
    remote={items:[],notices:[],state:'loading',query:q,category,page:view.remotePage,hasMore:false};
    if($('remote-results'))$('remote-results').innerHTML=remoteResultsHTML();
    searchTimer=setTimeout(async()=>{
      try{
        const {data:sessionData,error:sessionError}=await db.auth.getSession();
        if(sessionError||!sessionData.session?.access_token)throw new Error('请重新登录后搜索');
        const base=(import.meta.env.VITE_SEARCH_API_BASE||'').trim().replace(/\/$/,'');
        const url=`${base}/api/search?category=${encodeURIComponent(category)}&q=${encodeURIComponent(q)}&page=${view.remotePage}`;
        const response=await fetch(url,{headers:{Authorization:`Bearer ${sessionData.session.access_token}`},signal:AbortSignal.timeout(35000)});
        const payload=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(payload.error||`搜索接口 HTTP ${response.status}`);
        if(serial!==searchSerial)return;
        remote={items:Array.isArray(payload.items)?payload.items:[],notices:payload.notices||[],state:'ready',query:q,category,page:view.remotePage,hasMore:!!payload.hasMore};
      }catch(err){
        if(serial!==searchSerial)return;
        remote={items:[],notices:[],state:'error',error:String(err.message||err),query:q,category,page:view.remotePage,hasMore:false};
      }
      if($('remote-results'))$('remote-results').innerHTML=remoteResultsHTML();
    },320);
  }
  async function fetchBangumiDetail(item){
    if(item.provider!=='bangumi' || !['anime','game'].includes(item.category) || !/^\d+$/.test(String(item.providerId||'')))return null;
    const {data:sessionData,error} = await db.auth.getSession();
    if(error || !sessionData.session?.access_token)return null;
    const base=(import.meta.env.VITE_SEARCH_API_BASE||'').trim().replace(/\/$/,'');
    const url=`${base}/api/subject?category=${encodeURIComponent(item.category)}&id=${encodeURIComponent(item.providerId)}`;
    const resp=await fetch(url,{headers:{Authorization:`Bearer ${sessionData.session.access_token}`},signal:AbortSignal.timeout(7000)});
    if(!resp.ok)throw new Error(`Bangumi 详情 HTTP ${resp.status}`);
    const result=await resp.json();
    return result.item?.providerId===String(item.providerId)?result.item:null;
  }
  async function hydrateBangumiDetail(id){
    const item=itemById(id);
    if(!item||item.provider!=='bangumi'||!item.providerItemId||detailLookups.has(id))return;
    detailLookups.add(id);
    // Existing catalog entries created in previous versions may lack metadata.
    // Query once on opening detail, displaying the fresh value without granting
    // browser clients arbitrary UPDATE rights over shared official scores.
    try{
      const found=await fetchBangumiDetail({...item,providerId:item.providerItemId});
      if(!found)return;
      const updates={bangumiScore:found.bangumiScore,bangumiRatingTotal:found.bangumiRatingTotal,
        bangumiRank:found.bangumiRank,platform:found.platform||item.platform,
        tags:found.tags?.length?found.tags:item.tags,
        description:item.description||found.description};
      Object.assign(item,updates);detailMetadata.set(id,updates);
      if(view.page==='detail'&&view.detailId===id)$('page').innerHTML=detailPage();
    }catch(e){console.info('[同频] Bangumi 资料暂时不可用',e.message)}
  }
  async function importRemote(index,origin='discover',button=null){
    if(isBusy)return;
    const item=(origin==='travel'?travelRemote:remote).items[Number(index)];
    if(!item)return;
    const originalLabel=button?.textContent;
    try{
      isBusy=true;
      if(button){button.disabled=true;button.textContent='正在加入片库…'}
      let existing=localMatch(item);
      if(!existing){
        // Search response already has enough data to import. Do not block scoring
        // on an additional Bangumi detail request that may time out cross-region.
        existing=await createCatalogItem({
          category:item.category,name:item.name,subtitle:item.subtitle,description:item.description,
          coverUrl:item.coverUrl,sourceUrl:item.sourceUrl,year:item.year,
          provider:item.provider,providerItemId:item.providerId,emoji:item.emoji,
          tags:item.tags,platform:item.platform,bangumiScore:item.bangumiScore,
          bangumiRatingTotal:item.bangumiRatingTotal,bangumiRank:item.bangumiRank
        });
      }
      // The selected catalog row is authoritative. Never fall back to the first game.
      if(!existing?.id)throw Error('无法确认导入作品，请稍后重试');
      if(!itemById(existing.id))data.items.push(existing);
      recordForm(existing.id);
    }catch(err){toast('导入条目失败：'+displayError(err));}
    finally{isBusy=false;if(button?.isConnected){button.disabled=false;button.textContent=originalLabel}}
  }
  // 旅行地点独立子频道：保留同一个 catalog_items + experiences 数据源，不迁移/复制原记录。
  function travelMatches(){const q=view.travelSearch.trim().toLocaleLowerCase();return data.items.filter(x=>x.category==='place'&&(!q||`${x.name} ${x.subtitle||''}`.toLocaleLowerCase().includes(q)));}
  function travelLocalHTML(){const pg=paginate(travelMatches(),view.travelLocalPage,TRAVEL_PAGE_SIZE);view.travelLocalPage=pg.page;
    const cards=pg.items.map((x,i)=>{const s=summarize(x),r=own(x.id);return `<button class="rail-destination" type="button" data-action="detail" data-id="${esc(x.id)}"><span class="dest-counter">STATION ${String((pg.page-1)*TRAVEL_PAGE_SIZE+i+1).padStart(2,'0')}</span><strong>${esc(x.name)}</strong><span>${esc(x.subtitle||'旅行地点')}</span><span class="destination-foot">${r?esc(labelStatus('place',r.status)):'尚未记录'} <b>${s.count?s.average.toFixed(1)+' / 10':'待评分'}</b></span></button>`;}).join('');
    return `${cards||'<div class="station-empty">还没有符合条件的地点，尝试在线搜索或手动创建。</div>'}${renderPager('travel-local',pg.page,pg.totalPages)}`;
  }
  function travelRankingHTML(){const list=data.items.filter(x=>x.category==='place').map(summarize).filter(x=>x.count>=1&&(!view.travelMinThree||x.count>=3)).sort((a,b)=>b.average-a.average||b.count-a.count);
    if(!list.length)return '<div class="station-empty">暂时还没有符合条件的车站评分。</div>';
    return list.slice(0,8).map((x,i)=>`<button class="station-score" data-action="detail" data-id="${esc(x.item.id)}"><span>${String(i+1).padStart(2,'0')}</span><strong>${esc(x.item.name)}</strong><small>${x.count} 人评价</small><b>${x.average.toFixed(1)}</b></button>`).join('');
  }
  function travelPersonalHTML(){const records=ownRecords().filter(r=>itemById(r.itemId)?.category==='place').sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
    if(!records.length)return '<div class="station-empty">行李箱还空着。先标记一座想去或去过的地方吧。</div>';
    return records.map((r,i)=>{const item=itemById(r.itemId);return `<button class="boarding-pass" data-action="detail" data-id="${esc(item.id)}"><span class="pass-route"><b>1T4 RAIL</b><small>BOARDING PASS / ${String(i+1).padStart(2,'0')}</small></span><strong>${esc(item.name)}</strong><span class="pass-details">${esc(labelStatus('place',r.status))} <b>${isRated(r)?r.rating.toFixed(1)+' / 10':'尚未评分'}</b></span><i>↗</i></button>`;}).join('');
  }
  function renderTravelResults(){if($('travel-local-results'))$('travel-local-results').innerHTML=travelLocalHTML();if($('travel-online-results'))$('travel-online-results').innerHTML=remoteResultsHTML(travelRemote,'place',view.travelSearch)}
  function travel(){const placeCount=data.items.filter(x=>x.category==='place').length,travelOwn=ownRecords().filter(r=>itemById(r.itemId)?.category==='place').length;
    return `<div class="railway-world"><section class="railway-hero"><div class="railway-route-top"><span>RESONANCE RAILWAYS</span><span>旅行站台 / CH. 05</span></div><div class="railway-headline"><p>NOT ALL WHO WANDER ARE LOST</p><h1>下一站，<br><em>去看看世界。</em></h1><span>车窗里的城市，走过的街道，和朋友们分享的目的地。<br>每一站，都值得留下一张车票。</span></div><div class="railway-departure"><b>DEPARTURE BOARD</b><strong>TRAVEL / LOG</strong><small>${travelOwn} 张个人车票 · ${placeCount} 处共享地点</small></div><div class="railway-tracks" aria-hidden="true"></div></section>
    <section class="station-panel station-search"><div class="station-section-heading"><span>01 / TICKET OFFICE</span><h2>目的地查询</h2><p>先找圈内已有车站；没有的话，再通过高德搜索或手动创建。</p></div><label class="station-searchbar"><span>⌕</span><input id="travel-search-input" type="search" aria-label="搜索旅行地点" placeholder="搜索城市、地区或景点…" value="${esc(view.travelSearch)}" autocomplete="off"/></label><div class="station-shortcuts"><button data-action="travel-preset" data-query="杭州">杭州 ↗</button><button data-action="travel-preset" data-query="京都">京都 ↗</button><button data-action="travel-new-item">＋ 手动新增地点</button><button data-action="travel-record">＋ 记录去过的地点</button></div><div class="travel-columns"><div><h3>ALREADY ON THE MAP · 共享车站</h3><div id="travel-local-results" class="travel-grid">${travelLocalHTML()}</div></div><div><h3>NEW DESTINATIONS · 在线检索</h3><div id="travel-online-results" class="travel-remote">${remoteResultsHTML(travelRemote,'place',view.travelSearch)}</div></div></div></section>
    <section class="station-scoreboard"><div><span>02 / PASSENGERS' CHOICE</span><h2>站台人气榜</h2><label class="station-toggle"><input type="checkbox" id="travel-three" ${view.travelMinThree?'checked':''}/> 仅显示至少 3 人评分</label></div><div id="travel-ranking" class="station-score-list">${travelRankingHTML()}</div></section>
    <section class="station-panel station-collection"><div class="station-section-heading"><span>03 / MY TICKETS</span><h2>我的旅行车票</h2><p>按下时间顺序摆放，也可以点击车票回看自己的评分和感想。</p></div><div class="boarding-grid">${travelPersonalHTML()}</div></section></div>`;
  }
  function startTravelSearch(){clearTimeout(travelSearchTimer);const serial=++travelSearchSerial;const q=view.travelSearch.trim();const page=view.travelRemotePage;
    if(q.length<2){travelRemote={items:[],notices:[],state:'idle',query:q,category:'place',page:1,hasMore:false};renderTravelResults();return}
    travelRemote={items:[],notices:[],state:'loading',query:q,category:'place',page,hasMore:false};renderTravelResults();
    travelSearchTimer=setTimeout(async()=>{try{const {data:sessionData,error}=await db.auth.getSession();if(error||!sessionData.session?.access_token)throw Error('请重新登录后搜索');
      const base=(import.meta.env.VITE_SEARCH_API_BASE||'').trim().replace(/\/$/,'');
      const response=await fetch(`${base}/api/search?category=place&q=${encodeURIComponent(q)}&page=${page}`,{headers:{Authorization:`Bearer ${sessionData.session.access_token}`},signal:AbortSignal.timeout(35000)});
      const payload=await response.json().catch(()=>({}));if(!response.ok)throw Error(payload.error||`搜索 HTTP ${response.status}`);
      if(serial!==travelSearchSerial)return;travelRemote={items:Array.isArray(payload.items)?payload.items:[],notices:payload.notices||[],state:'ready',query:q,category:'place',page,hasMore:!!payload.hasMore};
    }catch(e){if(serial!==travelSearchSerial)return;travelRemote={items:[],notices:[],state:'error',error:String(e.message||e),query:q,category:'place',page,hasMore:false}}renderTravelResults();},320);
  }
  function ranking(){let list=data.items.filter(x=>x.category!=='place').map(summarize).filter(x=>x.count>=1&&(view.rankCategory==='all'||x.item.category===view.rankCategory));if(view.minThree)list=list.filter(x=>x.count>=3);if(view.rankMode==='difference')list=list.filter(x=>x.count>=2).sort((a,b)=>b.spread-a.spread||(b.count-a.count));else list.sort((a,b)=>b.average-a.average||(b.count-a.count)||a.item.name.localeCompare(b.item.name,'zh-CN'));return list}
  function rankingHTML(){const list=ranking(), top=list.slice(0,3), rest=list.slice(3);const val=x=>(view.rankMode==='average'?x.average:x.spread).toFixed(1);const metric=view.rankMode==='average'?'圈内平均分':'评分极差';
    const restPage=paginate(rest,view.rankPage,8);view.rankPage=restPage.page;
    return `<div class="ranking-console"><div class="rank-console-controls"><label class="toggle rank-toggle"><input type="checkbox" id="min-three" ${view.minThree?'checked':''}/> <span>只看 ≥ 3 人评分</span></label><label class="rank-mode-wrap"><span><span class="club-label">播放模式</span><span class="archive-label">排序依据</span></span><select id="rank-mode" class="sort-select" aria-label="榜单类型"><option value="average" ${view.rankMode==='average'?'selected':''}>最高评分</option><option value="difference" ${view.rankMode==='difference'?'selected':''}>最大分歧</option></select></label></div>
    <div class="rank-console-intro"><span class="club-label">LIVE BROADCAST / RANKING TRANSMISSION</span><span class="archive-label">RANKING NOTES / COMMUNITY VOICES</span><strong>${view.rankMode==='average'?'谁是本期主角？':'谁让频道吵翻了？'}</strong><small>${view.minThree?'仅统计至少三位成员打分的条目':'默认呈现所有已评分条目'} · ${list.length} 个候选</small></div>
    ${top.length?`<div class="rank-broadcast">${top.map((x,i)=>`<button type="button" class="broadcast-tape broadcast-no-${i+1}" data-action="detail" data-id="${esc(x.item.id)}" aria-label="榜单第${i+1}名，${esc(x.item.name)}，${metric}${val(x)}"><span class="broadcast-rank-marker">${String(i+1).padStart(2,'0')}<small>${i===0?'TOP RENTAL':'CHART PICK'}</small></span><span class="broadcast-image">${cover(x.item,'broadcast-cover')}</span><span class="broadcast-content"><span class="broadcast-category">${CAT_EMOJI[x.item.category]} ${CAT_NAME[x.item.category]}</span><strong>${esc(x.item.name)}</strong><span class="broadcast-people">${x.count} 人评分 ${x.count<3?'· 样本较少':''}</span></span><span class="broadcast-score">${val(x)}<small>${metric}</small></span></button>`).join('')}</div>`:'<div class="empty-state">当前没有符合筛选条件的作品。试着关闭三人筛选或邀请朋友评分。</div>'}
    ${list.length?`<div class="rank-rest"><div class="rank-rest-head"><div class="rank-rest-label">THE COMPLETE CHART / 完整榜单 <span>${rest.length?`第 4—${list.length} 名 · 分页浏览`:'当前只有前三名作品'}</span></div>${rest.length?`<span class="rank-rest-count">PAGE ${restPage.page}/${restPage.totalPages}</span>`:''}</div>${rest.length?restPage.items.map((x,i)=>{const rankNumber=(restPage.page-1)*restPage.pageSize+i+4;return `<button type="button" class="rank-track" data-action="detail" data-id="${esc(x.item.id)}"><span class="rank-track-num">${String(rankNumber).padStart(2,'0')}</span>${cover(x.item,'rank-track-cover')}<span class="rank-track-title"><strong>${esc(x.item.name)}</strong><small>${x.count} 人打分 · ${CAT_NAME[x.item.category]}</small></span><span class="rank-track-score">${val(x)}</span><span class="rank-track-arrow">↗</span></button>`}).join('')+renderPager('rank',restPage.page,restPage.totalPages):'<div class="rank-rest-empty">当前榜单已全部展示完毕。</div>'}</div>`:''}</div>`;
  }
  function circle(){const diff=data.items.filter(x=>x.category!=='place').map(summarize).filter(x=>x.spread!==null).sort((a,b)=>b.spread-a.spread)[0];const archivePicks=data.items.filter(x=>x.category!=='place').map(summarize).filter(x=>x.count).sort((a,b)=>b.average-a.average||b.count-a.count).slice(0,3);return `<section class="archive-chart-hero"><div class="archive-chart-copy"><span class="archive-chart-kicker">COMMUNITY INDEX / 02 · RESONANCE</span><h1>我们共同的<br><em>作品榜单。</em></h1><p>每一份评分，都是朋友留下的观看与游玩笔记。把彼此的喜好，编成一份不断更新的收藏目录。</p><div class="archive-chart-note"><span>由圈子成员评分生成</span><span>${data.items.filter(x=>x.category!=='place').map(summarize).filter(x=>x.count).length} 部作品参与排行</span></div></div><div class="archive-chart-side"><span class="archive-chart-side-top">OUR HIGHEST SCORES / ALL TITLES</span><div class="archive-chart-picks">${archivePicks.length?archivePicks.map((x,i)=>`<button class="archive-chart-pick" type="button" data-action="detail" data-id="${esc(x.item.id)}"><span class="archive-chart-pick-num">${String(i+1).padStart(2,'0')}</span>${cover(x.item,'archive-chart-cover')}<span class="archive-chart-pick-name">${esc(x.item.name)}</span><strong>${x.average.toFixed(1)}</strong></button>`).join(''):'<p class="archive-chart-empty">邀请朋友评分，一起形成第一份榜单。</p>'}</div><span class="archive-chart-side-foot">COLLECTION / COMMUNITY CHARTS</span></div></section><section class="channel-hero"><div class="channel-hero-copy"><span>ON AIR · PRIVATE CHANNEL / 03</span><h2>我们的<br><em>HOT 100*</em></h2><p>*不一定凑满一百部，但每个分数都来自真正的朋友。</p></div><div class="channel-disc" aria-hidden="true"><div class="disc-label"><span>RESONANCE</span><b>33⅓</b><small>PLAY IT AGAIN</small></div></div></section>
    <section class="community-door"><div><span>DISCUSSION / AFTER THE CREDITS</span><h2>看完还想聊？</h2><p>给刚追完的番、通关的游戏开个话题，只在我们的圈子里交流。</p></div><button class="primary-btn" data-action="navigate" data-page="posts">进入圈内讨论 ↗</button></section>
    <section class="ranking-hub"><div class="rank-hub-heading"><div><span class="eyebrow">CHANNEL CHARTS / THE TASTEMAKERS</span><h2>本期上榜 <b>↗</b></h2><p>前三名登上播放主舞台，其余作品进入可分页的完整曲目表。</p></div><div class="rank-mini-stats"><b>${data.items.filter(x=>x.category!=='place').map(summarize).filter(x=>x.count).length}</b><span>入榜作品</span></div></div>${cats(view.rankCategory,'rank-category')}<div id="ranking-list">${rankingHTML()}</div></section>
    ${diff?`<section class="channel-debate"><div><span class="eyebrow">THE ARGUMENT / 本周争议</span><h3>这部，大家意见很大。</h3><p>评分最高和最低相差 <strong>${diff.spread.toFixed(1)}</strong> 分。</p></div><button data-action="detail" data-id="${esc(diff.item.id)}">${cover(diff.item,'debate-cover')}<span>${esc(diff.item.name)}<small>${diff.count} 人参与评分 ↗</small></span></button></section>`:''}
    <section class="crew-room"><div class="crew-heading"><span>BEHIND THE COUNTER</span><h2>店内伙伴 / ${USERS.length}</h2></div><div class="crew-grid">${USERS.map((u,i)=>`<div class="crew-card"><div class="crew-card-code">STAFF / ${String(i+1).padStart(2,'0')}</div>${avatar(u.id)}<strong>${esc(u.name)}</strong><span>${data.records.filter(r=>r.userId===u.id&&isRated(r)).length} 条评分 · ${data.records.filter(r=>r.userId===u.id).length} 条记录</span></div>`).join('')}</div>${activeCircle?.owner_id===ME?`<div class="invite-box"><strong>邀请更多同频伙伴</strong><p>把邀请码私下发送给朋友。</p><div class="invite-code">${esc(inviteCode||'加载中…')}</div><button class="btn-ghost" data-action="copy-invite">复制邀请码</button></div>`:''}</section>`;}
  function filteredPersonalRecords(){return ownRecords().filter(r=>{const item=itemById(r.itemId);return item&&item.category!=='place'&&(view.personalCategory==='all'||item.category===view.personalCategory)&&(view.personalStatus==='all'||r.status===view.personalStatus)}).slice().sort((a,b)=>view.personalSort==='rating'?((isRated(b)?b.rating:-1)-(isRated(a)?a.rating:-1) || new Date(b.updatedAt)-new Date(a.updatedAt)):new Date(b.updatedAt)-new Date(a.updatedAt));}
  function libraryTier(records,label,serial){
    if(!records.length)return '';
    return `<section class="mix-section"><div class="mix-section-heading"><div><span>${serial} / REWIND TO PLAY</span><h3>${esc(label)}</h3></div><span class="mix-tape-count">${records.length} TAPES <b>↗</b></span></div><div class="mix-scroll" tabindex="0" aria-label="${esc(label)}的收藏，横向滚动查看更多">${records.map((r,i)=>{const item=itemById(r.itemId);return `<button type="button" class="mix-tape" data-action="detail" data-id="${esc(item.id)}" aria-label="查看${esc(item.name)}的详情" style="--tilt:${[-5,4,-2,5,-4,2][i%6]}deg;--cassette-index:${i}"><span class="mix-tape-case"><span class="mix-cassette-spine">R · ${serial} · ${String(i+1).padStart(2,'0')}</span>${cover(item,'mix-tape-cover')}<span class="mix-tape-sticker">${CAT_NAME[item.category]} / ${esc(labelStatus(item.category,r.status))}</span><span class="mix-tape-reels"><b></b><b></b></span></span><span class="mix-tape-info"><strong>${esc(item.name)}</strong><span>${isRated(r)?`MY SCORE <b>${r.rating.toFixed(1)}</b>`:'未评分'} ${item.bangumiScore?' · BGM '+Number(item.bangumiScore).toFixed(1):''}</span></span></button>`}).join('')}</div><span class="mix-scroll-hint">← SCROLL THE RACK →</span></section>`;
  }
  function posterWall(records){
    const page=paginate(records,view.posterPage,24);view.posterPage=page.page;
    const cards=page.items.map((r,i)=>{const item=itemById(r.itemId);if(!item)return '';const official=item.provider==='bangumi'&&Number(item.bangumiScore)>0?`BGM ${Number(item.bangumiScore).toFixed(1)}`:'';
      return `<button type="button" class="poster-card" data-action="detail" data-id="${esc(item.id)}" aria-label="打开 ${esc(item.name)}"><span class="poster-art">${cover(item,'poster-cover')}<span class="poster-status">${esc(labelStatus(item.category,r.status))}</span>${isRated(r)?`<span class="poster-score score-${posterScoreTone(r.rating)} score-tier-${posterScoreTier(r.rating)}" title="我的评分 ${r.rating.toFixed(1)} / 10 · ${posterScoreLabel(r.rating)}">${r.rating.toFixed(1)}</span>`:''}</span><span class="poster-info"><strong>${esc(item.name)}</strong><span>${esc(item.year||'年份未详')} · ${esc(CAT_NAME[item.category])}</span><span class="poster-foot">${official?`<b>${official}</b>`:'<b>MY ARCHIVE</b>'}${r.visibility==='private'?'<small>私密记录</small>':'<small>圈内可见</small>'}</span></span></button>`;}).join('');
    return `<div class="poster-gallery-head"><div><span>POSTER INDEX / ${records.length} TITLES</span><h3>让喜欢的作品，自己说话。</h3><p>个人评分采用六档分色牌：低于 7 红 / 7–不足 8 黄 / 8–10 绿（再分四档）；与 Bangumi 和圈内分数独立。</p></div><span class="poster-count">${String(page.page).padStart(2,'0')} / ${String(page.totalPages).padStart(2,'0')}</span></div><div class="poster-score-guide" aria-label="个人评分颜色说明"><span><i class="r"></i>低于 7.0</span><span><i class="y"></i>7.0–7.9</span><span><i class="g"></i>8.0–10.0 · 四级绿色</span></div><div class="poster-wall">${cards}</div>${renderPager('poster',page.page,page.totalPages)}`;
  }
  function personalList(){const mine=filteredPersonalRecords();if(!mine.length)return '<div class="empty-state"><strong>还没有符合条件的磁带</strong><p>去「找片」添加你的第一部作品。</p></div>';
    if(view.personalDisplay==='poster')return posterWall(mine);
    if(view.personalDisplay==='shelf'){
      const rated=mine.filter(isRated),feature=(rated.slice().sort((a,b)=>b.rating-a.rating)[0]||mine[0]),heroItem=itemById(feature.itemId);
      const anime=mine.filter(r=>itemById(r.itemId)?.category==='anime'), games=mine.filter(r=>itemById(r.itemId)?.category==='game');
      const avgScore=rated.length?(rated.reduce((sum,r)=>sum+r.rating,0)/rated.length).toFixed(1):'—';
      const pending=mine.filter(r=>!isRated(r)).length;
      const focus=anime.length===games.length?'动画 / 游戏':anime.length>games.length?'动画偏爱':'游戏偏爱';
      return `<div class="mixtape-archive"><div class="mixtape-head"><div><span>THE MIXTAPE COLLECTION / SIDE A</span><h2>你的私人<br><em>音像带。</em></h2><p>每一盒都有故事。把最喜欢的一盒放到播放机上，其他的让它们随手可翻。</p></div><span class="mixtape-mark">R<span>↗</span></span></div>
      <div class="mixtape-overview"><div class="mixtape-stat"><span>TAPES</span><strong>${mine.length}</strong><small>已收入录像柜</small></div><div class="mixtape-stat"><span>MY AVG SCORE</span><strong>${avgScore}</strong><small>${rated.length} 盒已评分</small></div><div class="mixtape-stat"><span>MOOD</span><strong>${focus}</strong><small>${pending?`${pending} 盒等待打分`:'全部已评分'}</small></div></div>
      <button class="now-playing-tape" data-action="detail" data-id="${esc(heroItem.id)}"><span class="now-playing-caption">NOW ON DECK / MY PICK</span><span class="now-playing-art">${cover(heroItem,'now-playing-cover')}<span class="now-tape-object">▣<small>RESONANCE · SIDE A</small></span></span><span class="now-playing-copy"><span>PERSONAL FEATURE / ${CAT_NAME[heroItem.category]}</span><strong>${esc(heroItem.name)}</strong><span>${esc(labelStatus(heroItem.category,feature.status))} · ${isRated(feature)?'我的评分 '+feature.rating.toFixed(1):'尚未评分'}</span><b>抽出这盒磁带 ↗</b></span></button>
      ${libraryTier(anime,'动画录影架 / ANIME','01')}${libraryTier(games,'游戏录影架 / GAME','02')}
</div>`;
    }
    return mine.map(r=>{const item=itemById(r.itemId);return `<div class="item-card">${cover(item,'rank-cover')}<div class="item-text"><button class="clickable" data-action="detail" data-id="${item.id}"><strong>${esc(item.name)}</strong></button><small>${CAT_NAME[item.category]} · ${labelStatus(item.category,r.status)} · ${r.visibility==='private'?'🔒 仅自己可见':'👥 圈内可见'}</small><div class="remote-meta">${bangumiBadge(item,true)}</div></div><div style="text-align:right"><div class="rating" style="font-size:17px">${isRated(r)?r.rating.toFixed(1):'—'}</div><button class="link-btn" data-action="record" data-id="${item.id}">编辑</button></div></div>`}).join('');
  }
  function me(){const mine=ownRecords(),rated=mine.filter(isRated);return `<div class="locker-utility"><span>MY MEDIA ARCHIVE / 04 · 个人收藏档案</span><button class="primary-btn" data-action="navigate" data-page="discover">⌕ 去找片</button></div>
    <div class="stats"><div class="stat"><strong>${mine.filter(r=>itemById(r.itemId)?.category==='game').length}</strong><span>🎮 游戏</span></div><div class="stat"><strong>${mine.filter(r=>itemById(r.itemId)?.category==='anime').length}</strong><span>📺 动画</span></div><button type="button" class="stat stat-travel-gate" data-action="navigate" data-page="travel"><strong>${mine.filter(r=>itemById(r.itemId)?.category==='place').length}</strong><span>🚆 地点 · 去沿途车站 ↗</span></button></div>
    ${statsPanel()}
    <div class="import-entry panel"><div><span class="eyebrow">IMPORT / FROM YOUR ARCHIVE</span><h3>把过去的收藏，一次带进同频。</h3><p>支持 CSV / XLSX，先匹配和预览，再选择导入。默认只对你自己可见，不覆盖已有记录。</p></div><button class="primary-btn" data-action="sheet-import">⇧ 批量导入表格</button></div>
    <div class="collection-export-panel panel"><div class="collection-export-copy"><span class="eyebrow">EXPORT / YOUR COLLECTION</span><h3>把你的收藏，带在身边。</h3><p>一键保存所有动画和游戏收藏的个人评分、状态、备注与作品资料。导出的首张表兼容同频批量导入；不包含好友记录。</p></div><div class="collection-export-actions"><button type="button" class="primary-btn" data-action="export-xlsx">⇩ 一键导出 Excel</button><button type="button" class="btn-ghost" data-action="export-csv">CSV 表格</button><small>不限当前筛选条件 · 旅行记录请使用下方完整 JSON 备份</small></div></div>
    <section class="locker-controls"><div class="panel-head"><div><h2 class="section-title">我的收藏与评分</h2><div class="section-sub">${mine.length} 条记录，其中 ${rated.length} 条已评分</div></div><div class="display-toggle" role="group" aria-label="收藏展示方式"><button data-action="personal-display" data-display="shelf" class="${view.personalDisplay==='shelf'?'selected':''}" aria-pressed="${view.personalDisplay==='shelf'}">▣ MIXTAPE 磁带馆</button><button data-action="personal-display" data-display="poster" class="${view.personalDisplay==='poster'?'selected':''}" aria-pressed="${view.personalDisplay==='poster'}">▦ 海报墙</button><button data-action="personal-display" data-display="list" class="${view.personalDisplay==='list'?'selected':''}" aria-pressed="${view.personalDisplay==='list'}">☷ 列表</button></div></div>${cats(view.personalCategory,'personal-category')}<div class="filter-line"><select id="personal-status" class="sort-select"><option value="all">全部状态</option><option value="want" ${view.personalStatus==='want'?'selected':''}>想体验</option><option value="doing" ${view.personalStatus==='doing'?'selected':''}>进行中</option><option value="done" ${view.personalStatus==='done'?'selected':''}>已完成 / 去过</option><option value="paused" ${view.personalStatus==='paused'?'selected':''}>搁置</option></select><select id="personal-sort" class="sort-select" aria-label="我的记录排序"><option value="recent" ${view.personalSort==='recent'?'selected':''}>最近更新</option><option value="rating" ${view.personalSort==='rating'?'selected':''}>个人评分榜（高到低）</option></select></div><div id="personal-list">${personalList()}</div></section>
    <div class="panel"><div class="theme-settings"><div><h2 class="section-title">页面主题</h2><p>VIDEO CLUB 复古录像店 / COLLECTION 编辑式影像资料库</p></div><button class="btn-ghost" data-action="theme-toggle">${theme==='archive'?'切换到 VIDEO CLUB':'切换到 COLLECTION'} ⇄</button></div></div>
    <div class="panel"><h2 class="section-title">账号与云端档案</h2><p class="help-copy">已登录：${esc(authUser?.email||'')}。个人记录保存在 Supabase；导入旧版记录时默认设为“仅自己可见”。</p>
    <form id="nickname-form" class="account-form"><label>圈内昵称</label><input name="nickname" class="form-control" maxlength="40" required value="${esc(userById(ME).name)}"/><button class="btn-ghost" type="submit">更新昵称</button></form>
    <form id="password-form" class="account-form"><label for="new-password">设置 / 修改登录密码</label><input id="new-password" name="newPassword" class="form-control" type="password" autocomplete="new-password" minlength="8" maxlength="128" required placeholder="新密码（8 位以上）"/><input name="confirmPassword" class="form-control" type="password" autocomplete="new-password" minlength="8" maxlength="128" required placeholder="确认新密码"/><button class="btn-ghost" type="submit">保存密码</button></form><p class="help-copy">旧版 Magic Link 用户：如当前仍已登录，可在此设置密码以保留原账号 ID、圈子和评分。若开启了 Supabase 的安全密码变更验证，旧会话可能还需重新认证。</p>
    <div class="filters" style="margin:15px 0 0"><button class="btn-ghost" data-action="export">⇩ 完整 JSON 备份</button><button class="btn-ghost" data-action="import">⇧ 导入旧版备份</button><button class="btn-ghost danger" data-action="logout">退出登录</button></div></div>`}
  function displayError(error){
    const raw=String(error?.message||error||'未知错误');
    if(/Failed to fetch|NetworkError|fetch failed/i.test(raw))return '网络连接失败，请检查大陆网络到 Supabase Auth 的连通性';
    if(/Invalid login credentials/i.test(raw))return '邮箱或密码不正确（仅用旧 Magic Link 登录的账号可能尚未设置密码）';
    if(/User already registered/i.test(raw))return '这个邮箱已注册，请返回登录；如果还没设过密码，请使用原登录会话设置密码';
    if(/relation .* does not exist|schema cache|Could not find the function|PGRST202|PGRST205/i.test(raw))return '数据库还未正确初始化，请先运行 supabase/schema.sql';
    return raw.slice(0,170);
  }

  // Private-circle discussion: fetched on demand so initial startup remains responsive.
  function postCards(list){
    if(threadData.loading&&!threadData.posts.length)return '<div class="discussion-empty">正在读取圈内帖子…</div>';
    if(threadData.error)return `<div class="discussion-empty">${esc(threadData.error)}<p>请先执行 supabase/migration_v057.sql。</p></div>`;
    if(!list.length)return '<div class="discussion-empty">这里还没有帖子。分享你的第一份通关感想或追番心得吧。</div>';
    return `<div class="post-grid">${list.map(p=>{const item=itemById(p.itemId);if(!item)return '';const comments=threadData.comments.filter(c=>c.postId===p.id).length;
      return `<button class="post-tile" type="button" data-action="open-post" data-id="${esc(p.id)}"><span class="post-tile-cover">${cover(item,'post-cover')}</span><span class="post-tile-copy"><span class="post-kicker">${esc(CAT_NAME[item.category])} · ${esc(item.name)}</span><strong>${esc(p.title)}</strong><small>${esc(userById(p.userId).name)} · ${notifyAge(p.createdAt)} · ${comments} 条回复</small><span class="post-teaser">${p.spoiler?'◈ 含剧透内容，点击后查看':esc(p.body.slice(0,88))}</span></span><span class="post-arrow">↗</span></button>`}).join('')}</div>`;
  }
  function posts(){
    const list=threadData.posts.filter(p=>view.postCategory==='all'||itemById(p.itemId)?.category===view.postCategory);
    const pg=paginate(list,view.postPage,10);view.postPage=pg.page;
    return `<section class="discussion-hero"><span>AFTER THE CREDITS · PRIVATE DISCUSSION</span><h1>看完之后，<br><em>还有话想说。</em></h1><p>聊喜欢的动画、争议的剧情、刚通关的游戏。这里是只属于圈内成员的放映后谈话室。</p><button class="primary-btn" data-action="new-post">＋ 发起一个话题 ↗</button></section>
      <div class="discussion-head"><div><h2>频道讨论 <small>${threadData.posts.length} POSTS</small></h2><p>帖子仅同圈成员可见，内容关联具体的动画或游戏。</p></div><div class="filters"><button class="filter-btn ${view.postCategory==='all'?'selected':''}" data-action="post-category" data-category="all">全部</button><button class="filter-btn ${view.postCategory==='anime'?'selected':''}" data-action="post-category" data-category="anime">动画</button><button class="filter-btn ${view.postCategory==='game'?'selected':''}" data-action="post-category" data-category="game">游戏</button></div></div>
      ${postCards(pg.items)}${renderPager('posts',pg.page,pg.totalPages)}`;
  }
  function postPage(){
    const p=threadData.posts.find(x=>x.id===view.postId);if(!p)return `<div class="panel discussion-empty">${threadData.loading?'正在载入帖子…':threadData.error?esc(threadData.error):'未找到帖子或你没有权限查看。'}<p><button class="btn-ghost" data-action="navigate" data-page="posts">返回讨论区</button></p></div>`;
    const item=itemById(p.itemId),comments=threadData.comments.filter(c=>c.postId===p.id);
    return `<div class="post-detail"><button class="back-link" data-action="navigate" data-page="posts">← 返回圈内讨论</button><article class="panel post-article"><div class="post-article-top"><span class="eyebrow">AFTER THE CREDITS / ${esc(CAT_NAME[item?.category]||'作品')}</span><span class="post-date">${notifyAge(p.createdAt)}</span></div><h1>${esc(p.title)}</h1><button class="post-subject" data-action="detail" data-id="${esc(p.itemId)}">${item?cover(item,'post-subject-cover'):''}<span><small>本帖讨论作品</small><strong>${esc(item?.name||'作品已删除')}</strong></span><b>查看作品 ↗</b></button><div class="post-article-user">${avatar(p.userId)}<strong>${esc(userById(p.userId).name)}</strong><span>发布于圈内</span>${p.userId===ME?`<button data-action="delete-post" data-id="${esc(p.id)}" class="btn-ghost danger">删除帖子</button>`:''}</div>${p.spoiler?`<div class="spoiler-note"><span>◈ 本帖包含剧透</span><button class="btn-ghost" data-action="reveal-spoiler" type="button">展开正文</button><p class="spoiler-text post-body" hidden>${esc(p.body)}</p></div>`:`<div class="post-body">${esc(p.body)}</div>`}</article><section class="panel post-replies"><div class="panel-head"><h2>朋友的回复</h2><span>${comments.length} REPLIES</span></div>${comments.length?comments.map(c=>`<div class="post-comment">${avatar(c.userId)}<div><strong>${esc(userById(c.userId).name)}</strong><small>${notifyAge(c.createdAt)}</small><p>${esc(c.body)}</p></div>${c.userId===ME?`<button class="btn-ghost danger" data-action="delete-comment" data-id="${esc(c.id)}">删除</button>`:''}</div>`).join(''):'<p class="discussion-empty">还没有回复，来聊聊你的看法。</p>'}<form id="comment-form" class="comment-form"><input type="hidden" name="postId" value="${esc(p.id)}"/><label for="comment-body">回复这个话题</label><textarea name="body" id="comment-body" required maxlength="1000" rows="3" placeholder="说说你的想法…"></textarea><button type="submit" class="primary-btn">发布回复 ↗</button></form></section></div>`;
  }
  async function loadPosts(force=false){
    if(!activeCircle||!db||threadData.loading)return;
    if(!force&&threadData.circleId===activeCircle.id&&Date.now()-threadData.loadedAt<25000)return;
    const serial=++threadSerial,cid=activeCircle.id;
    threadData.loading=true;threadData.error='';
    const [postsResult,commentsResult]=await Promise.all([
      db.from('circle_posts').select('id,user_id,item_id,circle_id,title,body,spoiler,created_at').eq('circle_id',cid).order('created_at',{ascending:false}).limit(200),
      db.from('post_comments').select('id,post_id,user_id,circle_id,body,created_at').eq('circle_id',cid).order('created_at',{ascending:true}).limit(600)
    ]);
    if(serial!==threadSerial||activeCircle?.id!==cid)return;
    if(postsResult.error||commentsResult.error){threadData.error='帖子暂不可用：'+displayError(postsResult.error||commentsResult.error);threadData.posts=[];threadData.comments=[];}
    else{threadData.posts=postsResult.data.map(p=>({id:p.id,userId:p.user_id,itemId:p.item_id,title:p.title,body:p.body,spoiler:p.spoiler,createdAt:p.created_at}));threadData.comments=commentsResult.data.map(c=>({id:c.id,postId:c.post_id,userId:c.user_id,body:c.body,createdAt:c.created_at}));threadData.loadedAt=Date.now();}
    threadData.circleId=cid;threadData.loading=false;
    if(['feed','posts','post','detail'].includes(view.page))render();
  }
  function renderPostChoices(term=''){
    const options=findPostSubjects(data.items,term,10),el=$('post-subject-options');if(!el)return;
    el.innerHTML=options.length?options.map(i=>`<button type="button" role="option" class="post-pick-option" data-action="post-pick-item" data-id="${esc(i.id)}"><span class="post-pick-image">${cover(i,'post-pick-cover')}</span><span><strong>${esc(i.name)}</strong><small>${esc(CAT_NAME[i.category])} · ${esc(i.subtitle||'共享作品')}</small></span><b>选择 ↗</b></button>`).join(''):'<p class="post-pick-noresult">没有匹配作品。可以先去「找片」收录，再回来发帖。</p>';
  }
  function pickPostSubject(id){
    const item=itemById(id),input=$('post-item'),preview=$('post-picked'),results=$('post-subject-options');
    if(!input||!preview||!item||!['game','anime'].includes(item.category))return;
    input.value=item.id;
    preview.innerHTML=`<span class="post-pick-image">${cover(item,'post-pick-cover')}</span><span><small>已绑定讨论作品 · ${esc(CAT_NAME[item.category])}</small><strong>${esc(item.name)}</strong></span><button type="button" data-action="post-pick-clear" aria-label="重新选择作品">更换 ↗</button>`;
    preview.hidden=false;results.hidden=true;
    const search=$('post-item-search');if(search)search.value=item.name;
  }
  function postForm(itemId=''){
    if(!data.items.some(i=>['anime','game'].includes(i.category))){toast('请先在「找片」中加入游戏或动画作品');return}
    openModal(`${modalTop('发起圈内讨论')}<form id="post-form" class="post-editor"><p class="help-copy">只对同圈成员可见。搜索圈内现有动画或游戏，再选择要讨论的作品。</p><div class="form-field post-picker"><label for="post-item-search">讨论作品 · 关键词搜索</label><input id="post-item-search" type="search" class="form-control" placeholder="输入中文名、原名或英文名…" autocomplete="off" aria-controls="post-subject-options"/><input id="post-item" name="itemId" type="hidden" value=""/><div id="post-picked" class="post-picked" hidden></div><div id="post-subject-options" class="post-pick-results" role="listbox" aria-label="可选择的共享作品"></div></div><div class="form-field"><label for="post-title">帖子标题</label><input id="post-title" class="form-control" name="title" minlength="2" maxlength="80" required placeholder="为什么这部作品值得聊一整晚？"/></div><div class="form-field"><label for="post-body">正文</label><textarea id="post-body" name="body" class="form-control" minlength="1" maxlength="5000" rows="7" required placeholder="分享剧情感想、通关心得、分析或提问…"></textarea></div><label class="spoiler-switch"><input type="checkbox" name="spoiler"/> 含有剧透，读者需主动展开</label><div class="modal-actions"><button type="button" class="btn-ghost" data-action="close">取消</button><button type="submit" class="primary-btn">发布到圈内 ↗</button></div></form>`);
    renderPostChoices();if(itemId)pickPostSubject(itemId);
  }
  async function deletePost(id){if(!confirm('删除这条帖子及其回复？'))return;try{unwrap(await db.from('circle_posts').delete().eq('id',id).eq('user_id',ME));await loadPosts(true);location.hash='posts';syncRoute();toast('帖子已删除')}catch(e){toast('删除失败：'+displayError(e))}}
  async function deleteComment(id){if(!confirm('删除自己的回复？'))return;try{unwrap(await db.from('post_comments').delete().eq('id',id).eq('user_id',ME));await loadPosts(true);toast('回复已删除')}catch(e){toast('删除失败：'+displayError(e))}}
  function statsPanel(){
    const stats=getPersonalStats(ownRecords(),data.items);const maxYear=Math.max(1,...stats.releaseYears.map(x=>x.count));
    const statusName={want:'想体验',doing:'进行中',done:'已完成',paused:'暂时搁置'};
    return `<section class="panel archive-stats"><div class="stats-title"><span class="eyebrow">MY COLLECTION / INSIGHTS</span><h2>我的收藏统计 <span>COLLECTION REPORT</span></h2><p>基于当前已保存的游戏、动画和地点记录，不包含其他成员的私密评分。</p></div><div class="stats-tiles"><div><span>收藏总量</span><strong>${stats.total}</strong><small>条个人记录</small></div><div><span>我的平均分</span><strong>${stats.avg==null?'—':stats.avg.toFixed(1)}</strong><small>${stats.rated} 条有效评分</small></div><div><span>完成率</span><strong>${stats.completionRate}%</strong><small>已完成 / 已看完 / 去过</small></div><div><span>游戏 · 动画</span><strong>${stats.categoryCounts.game} : ${stats.categoryCounts.anime}</strong><small>${stats.categoryCounts.place} 个旅行地点</small></div></div><div class="stats-viz"><div><h3>体验状态</h3><div class="stat-statuses">${Object.entries(stats.statusCounts).map(([k,v])=>`<span>${statusName[k]} <strong>${v}</strong></span>`).join('')}</div><h3>个人评分分布</h3><div class="stat-distribution">${stats.distribution.map(x=>`<div><small>${x.label}</small><span><b style="width:${stats.rated?Math.max(2,x.count/stats.rated*100):0}%"></b></span><em>${x.count}</em></div>`).join('')}</div></div><div><h3>作品发行年份分布 <small>非游玩/观看日期</small></h3>${stats.releaseYears.length?`<div class="stats-years">${stats.releaseYears.map(x=>`<div><span>${x.count}</span><i style="height:${Math.max(6,x.count/maxYear*86)}px"></i><small>${x.year}</small></div>`).join('')}</div>`:'<p class="help-copy">暂无已知发行年份资料。</p>'}</div></div></section>`;
  }
  // Preview → online suggestions → explicit candidate selection → commit.
  // Only unambiguous matches are selected automatically; every write still needs final confirmation.
  function sheetDialog(){bulkDraft?.abortController?.abort();sheetLookupSerial++;bulkDraft=null;openModal(`${modalTop('批量导入已有收藏')}<section class="sheet-dialog"><p>支持 .xlsx 和 .csv，最大 2MB，每次不超过 300 行。先匹配圈内共享库，再自动连续联网找片；明确匹配的作品会自动勾选，遇到同名版本等疑点时留给你集中确认。</p><div class="sheet-template-actions"><a class="sheet-template-link" href="/templates/tongpin-import-template.xlsx" download="同频-收藏导入模板.xlsx">↓ 下载 Excel 模板</a><a class="sheet-template-link secondary" href="/templates/tongpin-import-template.csv" download="同频-收藏导入模板.csv">CSV 模板</a><small>模板第一张表填写数据；导入个人记录不覆盖旧评分。</small></div><div class="form-field"><label>表格没有类别列时</label><select id="sheet-category" class="form-control"><option value="anime">动画 / 番剧</option><option value="game">游戏</option></select></div><div class="form-field"><label for="sheet-file">选择表格文件</label><input id="sheet-file" type="file" accept=".csv,.xlsx" class="form-control"/></div><div id="sheet-preview" aria-live="polite"><p class="help-copy">文件在浏览器解析；联网搜索通过同频服务端，不将文件本身上传第三方。</p></div></section>`)}
  function matchedImportItem(row){
    const norm=normalizedName(row.name),alias=normalizedName(row.subtitle),year=String(row.year||'').slice(0,4);
    const candidates=data.items.filter(item=>item.category===row.category);
    const byId=row.providerId?candidates.filter(item=>item.provider==='bangumi'&&String(item.providerItemId)===String(row.providerId)):[];
    const matches=byId.length?byId:candidates.filter(item=>[item.name,item.subtitle].some(name=>{
      const value=normalizedName(name);return value&&(value===norm||(alias&&value===alias));
    }));
    const viable=matches.filter(item=>!year||!String(item.year||'').slice(0,4)||String(item.year).slice(0,4)===year);
    if(viable.length!==1)return null;
    // When a year was supplied, do not silently select a local record that has none.
    if(year&&String(viable[0].year||'').slice(0,4)!==year)return null;
    return viable[0];
  }
  function sheetMatchDescription(row,i){
    if(row.error)return `<small class="sheet-error">${esc(row.error)}</small>`;
    if(row.match)return '<span class="sheet-match">已匹配圈内共享库</span>';
    const candidates=row.suggestions||[];
    const status=row.lookupState==='loading'?'正在在线搜索…':row.lookupState==='retrying'?'网络拥堵，自动退避重试…':row.lookupState==='error'?'临时检索失败 · 可单条重试':row.lookupState==='done'&&!candidates.length?'在线无可靠候选':row.lookupState==='done'?'请审核候选并选择':row.lookupState==='queued'?'等待自动搜索':'尚未联网匹配';
    return `<div class="sheet-candidate-box" id="sheet-candidates-${i}"><span class="sheet-lookup-state">${row.remoteChoice?(row.autoChosen?'✓ 高置信度自动匹配 · 可更换':'✓ 已手动确认网络作品')+' · '+esc(row.remoteChoice.provider):status}</span>${candidates.length?`<div class="sheet-candidate-list">${candidates.map((c,j)=>`<button type="button" class="sheet-candidate ${row.remoteChoice===c?'is-picked':''}" data-action="sheet-select-candidate" data-row="${i}" data-candidate="${j}" aria-pressed="${row.remoteChoice===c}">${coverImageUrl(c.coverUrl)?`<img class="sheet-candidate-cover" src="${esc(coverImageUrl(c.coverUrl))}" alt="" loading="lazy" onerror="this.remove()"/>`:''}<b>${row.remoteChoice===c?'✓ ':'○ '}${esc(c.name)}</b><small>${esc(c.provider==='bangumi'?'Bangumi':c.provider==='jikan'?'MAL / Jikan':c.provider==='igdb'?'IGDB':c.provider==='rawg'?'RAWG':c.provider||'在线资料')} · ${esc(c.year||'年份未知')} ${c.platform?`· ${esc(c.platform)}`:''}</small></button>`).join('')}</div>`:''}${row.lookupState==='retrying'&&row.lookupError?`<small class="sheet-retry-note">${esc(row.lookupError)}</small>`:''}${row.remoteChoice?`<button type="button" class="sheet-unpick" data-action="sheet-clear-candidate" data-row="${i}">取消该匹配</button>`:''}${row.lookupState==='error'?`<span class="sheet-error">${esc(row.lookupError||'暂时不可用')}</span><button type="button" class="sheet-unpick" data-action="sheet-retry" data-row="${i}">↻ 重新搜索该条</button>`:''}</div>`;
  }
  function syncSheetCheckbox(i){
    const row=bulkDraft?.rows?.[i],checkbox=$(`sheet-check-${i}`);
    if(!row||!checkbox)return;
    checkbox.checked=!!row.selected;
    checkbox.disabled=!canSelectImportRow(row,{allowManualCreation:!!$('sheet-create-missing')?.checked});
    checkbox.title=row.error?row.error:row.match?'已匹配共享作品':row.remoteChoice?'已确认网络作品':$('sheet-create-missing')?.checked?'你已允许手动建档，可自行勾选':'尚无确认作品，先等待匹配或选择候选';
  }
  function updateSheetRow(i){const row=bulkDraft?.rows?.[i],holder=$(`sheet-match-${i}`);if(row&&holder)holder.innerHTML=sheetMatchDescription(row,i);syncSheetCheckbox(i);updateSheetSummary();}
  async function previewSheetFile(input){const file=input.files?.[0];if(!file)return;bulkDraft?.abortController?.abort();const serial=++sheetLookupSerial;try{
    $('sheet-preview').textContent='正在解析表格与匹配共享作品…';const grid=await readSheetFile(file);
    if(serial!==sheetLookupSerial||!$('sheet-preview'))return;
    bulkDraft={...parseImportRows(grid,{fallbackCategory:$('sheet-category')?.value||'anime'}),paused:false,lookingUp:false,reviewFilter:'all',abortController:new AbortController()};
    const seen=new Set();for(const row of bulkDraft.rows){const key=row.category+':'+normalizedName(row.name)+':'+String(row.year||'')+':'+String(row.providerId||'');row.match=matchedImportItem(row);row.suggestions=[];row.remoteChoice=null;row.autoChosen=false;row.lookupState=row.match?'matched':'queued';if(seen.has(key)){row.error='表格内重复作品';}seen.add(key);if(row.match&&own(row.match.id)){row.error='已有个人记录，不会覆盖';}prepareImportRow(row);}
    const rows=bulkDraft.rows.map((r,i)=>`<tr data-sheet-row="${i}"><td><input type="checkbox" id="sheet-check-${i}" data-action="bulk-row-toggle" data-row="${i}" ${r.selected?'checked':''} ${canSelectImportRow(r)?'':'disabled'} aria-label="选择第${r.line}行"/></td><td>${r.line}</td><td><strong>${esc(r.name)}</strong><small>${esc(CAT_NAME[r.category])}${r.year?' · '+esc(r.year):''}</small></td><td>${r.rating==null?'—':r.rating.toFixed(1)}</td><td id="sheet-match-${i}">${sheetMatchDescription(r,i)}</td></tr>`).join('');
    $('sheet-preview').innerHTML=`<div class="sheet-summary" id="sheet-summary" role="status"></div><div class="sheet-online-bar"><div><strong>联网自动找片</strong><span>自动搜索全部未匹配作品（即使尚未勾选），最多同时 2 个请求、每分钟约 25 次；遇限流/临时网络错误自动重试。默认仅勾选共享库匹配、高置信度自动匹配及手动确认候选；其余留待审核。</span></div><button type="button" class="btn-ghost" data-action="sheet-lookup-toggle" id="sheet-lookup-toggle">暂停搜索</button></div><div class="sheet-lookup-progress"><progress id="sheet-lookup-progress" value="0" max="1"></progress><span id="sheet-lookup-detail" aria-live="polite"></span></div><div class="sheet-review-controls" role="group" aria-label="导入结果筛选"><button type="button" class="sheet-review-filter active" data-action="sheet-review-filter" data-filter="all" aria-pressed="true">全部</button><button type="button" class="sheet-review-filter" data-action="sheet-review-filter" data-filter="review" aria-pressed="false">只看待审核 <b id="sheet-review-count">0</b></button><button type="button" class="sheet-review-filter" data-action="sheet-review-filter" data-filter="missing" aria-pressed="false">无结果 / 失败 <b id="sheet-missing-count">0</b></button><small>搜索完成后自动按「待审核 → 已匹配 → 无结果」排序。</small></div><div class="sheet-table-scroll"><table><thead><tr><th>选</th><th>行</th><th>作品</th><th>我的评分</th><th>匹配情况 / 候选选择</th></tr></thead><tbody>${rows}</tbody></table></div><label class="sheet-opt"><input id="sheet-create-missing" type="checkbox"/> 可选：允许手动勾选未匹配作品并按表格名称建档（默认不选，不自动创建）</label><label class="sheet-opt"><input id="sheet-share" type="checkbox"/> 将导入记录公开给圈内伙伴（默认仅自己可见）</label><div class="modal-actions"><button class="btn-ghost" data-action="close">取消</button><button class="primary-btn" data-action="confirm-sheet" id="sheet-confirm">确认导入已选条目</button></div>`;
    updateSheetSummary();void autoFindSheetMatches(serial);
  }catch(e){if(serial!==sheetLookupSerial)return;bulkDraft=null;if($('sheet-preview'))$('sheet-preview').textContent='解析失败：'+String(e.message||e)}}
  function syncSheetReviewView(){
    if(!bulkDraft)return;
    const rows=bulkDraft.rows,filter=bulkDraft.reviewFilter||'all';
    const tbody=document.querySelector('.sheet-table-scroll tbody');
    if(tbody){
      // Preserve stable row ids for async lookup results and candidate selection.
      // Reorder only after all search workers have finished; avoid jumping controls mid-review.
      if(!bulkDraft.lookingUp && !rows.some(r=>r.lookupState==='queued'||r.lookupState==='loading'||r.lookupState==='retrying')){
        for(const index of orderedImportRowIndices(rows)){
          const tr=tbody.querySelector(`[data-sheet-row="${index}"]`);
          if(tr)tbody.appendChild(tr);
        }
      }
      for(let index=0;index<rows.length;index++){
        const tr=tbody.querySelector(`[data-sheet-row="${index}"]`);
        if(tr)tr.hidden=filter!=='all'&&importReviewBucket(rows[index])!==filter;
      }
    }
    const review=rows.filter(r=>importReviewBucket(r)==='review').length;
    const missing=rows.filter(r=>importReviewBucket(r)==='missing').length;
    if($('sheet-review-count'))$('sheet-review-count').textContent=String(review);
    if($('sheet-missing-count'))$('sheet-missing-count').textContent=String(missing);
    document.querySelectorAll('.sheet-review-filter').forEach(button=>{
      const selected=button.dataset.filter===filter;
      button.classList.toggle('active',selected);
      button.setAttribute('aria-pressed',String(selected));
    });
  }
  function updateSheetSummary(){
    const el=$('sheet-summary');if(!el||!bulkDraft)return;
    const draft=bulkDraft,info=getImportSelectionSummary(draft.rows);
    syncSheetReviewView();
    el.textContent=`识别 ${info.total} 条 · 默认/已选 ${info.selected} 条 · 共享库 ${info.local} 条 · 高置信度 ${info.auto} 条 · 人工确认 ${info.reviewed} 条 · 待审核 ${info.pendingReview} 条 · 无结果 ${info.noResults} 条`;
    const progress=$('sheet-lookup-progress');if(progress){progress.max=Math.max(1,info.searchTotal);progress.value=Math.min(info.finished,info.searchTotal)}
    const detail=$('sheet-lookup-detail');if(detail)detail.textContent=`已搜索 ${info.finished}/${info.searchTotal} · 失败 ${info.failed} · ${draft.paused?'已暂停':draft.lookingUp?'正在自动匹配…':info.pending?'等待开始…':'搜索完成'}`;
    const pending=draft.rows.filter(r=>!r.error&&!r.match&&r.lookupState==='queued');
    const button=$('sheet-lookup-toggle');if(button){button.disabled=!pending.length&&!draft.lookingUp;button.textContent=draft.paused?'继续自动搜索':(draft.lookingUp?'暂停搜索':pending.length?'开始搜索':'搜索已完成');}
    const confirm=$('sheet-confirm');if(confirm){confirm.disabled=!!draft.lookingUp;confirm.title=draft.lookingUp?'匹配正在进行，可暂停并等待当前请求结束后确认':'';}
  }
  async function autoFindSheetMatches(serial=sheetLookupSerial){
    const draft=bulkDraft;if(!draft||draft.lookingUp||draft.paused)return;
    const queued=getImportLookupJobs(draft.rows);
    if(!queued.length){updateSheetSummary();return;}
    draft.lookingUp=true;updateSheetSummary();
    const current=()=>serial===sheetLookupSerial&&bulkDraft===draft&&!draft.abortController.signal.aborted&&!!$('sheet-preview');
    try{
      const {data:sessionData,error}=await db.auth.getSession();
      if(error||!sessionData.session?.access_token)throw Error('登录状态失效，请重新登录');
      const token=sessionData.session.access_token,base=(import.meta.env.VITE_SEARCH_API_BASE||'').trim().replace(/\/$/,'');
      // Per-dialog shared pacing survives pause/resume and covers both workers and retries.
      const pacer=draft.pacer||(draft.pacer=createImportPacer());
      let cursor=0;
      async function worker(){
        while(current()&&!draft.paused&&cursor<queued.length){
          const i=queued[cursor++],row=draft.rows[i];
          if(row.error||row.match||row.lookupState!=='queued')continue;
          row.lookupState='loading';row.lookupError='';updateSheetRow(i);
          try{
            const url=`${base}/api/search?category=${encodeURIComponent(row.category)}&q=${encodeURIComponent(row.name)}&page=1`;
            const outcome=await searchImportWithRetry({
              pacer,signal:draft.abortController.signal,paused:()=>draft.paused,
              request:()=>fetch(url,{headers:{Authorization:`Bearer ${token}`},
                signal:AbortSignal.any([draft.abortController.signal,AbortSignal.timeout(IMPORT_SEARCH_TIMEOUT_MS)])}),
              onRetry:({attempt,message,waitMs})=>{
                if(!current())return;
                row.lookupState='retrying';row.lookupError=`第 ${attempt} 次未成功：${message.slice(0,55)}；将在约 ${Math.ceil(waitMs/1000)} 秒内重试`;
                updateSheetRow(i);
              }
            });
            if(!current())break;
            if(outcome.kind==='ok'){
              applyImportDecision(row,evaluateImportMatch(row,outcome.payload.items));
            }else if(outcome.kind==='paused'){
              row.lookupState='queued';row.lookupError='';
            }else{
              row.lookupState='error';row.lookupError=String(outcome.message||'在线检索暂不可用').slice(0,100);
            }
          }catch(e){
            if(!current())break;
            row.lookupState=draft.paused?'queued':'error';
            row.lookupError=draft.paused?'':String(e.message||e).slice(0,100);
          }
          updateSheetRow(i);
        }
      }
      await Promise.all([worker(),worker()]);
    }catch(e){
      if(current()){
        for(const row of draft.rows){if(!row.error&&!row.match&&row.lookupState==='queued'){row.lookupState='error';row.lookupError='登录验证失败';}}
        draft.rows.forEach((_,i)=>updateSheetRow(i));toast('联网找片失败：'+displayError(e));
      }
    }finally{
      if(bulkDraft===draft){draft.lookingUp=false;updateSheetSummary();
        // If resumed while the previous workers were still exiting, do not leave rows stranded.
        if(!draft.paused&&getImportLookupJobs(draft.rows).length&&current())void autoFindSheetMatches(serial);
      }
    }
  }
  async function confirmSheetImport(){if(isBusy||!bulkDraft||bulkDraft.lookingUp)return;
    const createMissing=!!$('sheet-create-missing')?.checked,share=!!$('sheet-share')?.checked;
    const selected=bulkDraft.rows.filter(r=>r.selected&&!r.error);
    if(!selected.length){toast('没有已勾选的可导入作品。请先审核候选或等待自动匹配');return}
    if(selected.some(r=>!canSelectImportRow(r,{allowManualCreation:createMissing}))){toast('包含未确认的作品，已阻止导入。请选择候选或单独允许手动建档');return}
    const countNetwork=selected.filter(r=>r.remoteChoice).length,countManual=selected.filter(r=>!r.match&&!r.remoteChoice).length;
    if(!confirm(`确认导入 ${selected.length} 条记录？联网资料 ${countNetwork} 条，手动建档 ${countManual} 条。${share?'这些记录将对圈内公开。':'默认仅自己可见。'} 已有评分不会被覆盖。`))return;
    isBusy=true;const button=$('sheet-confirm');if(button)button.disabled=true;
    let inserted=0,skipped=0,created=0;const errors=[];
    try{
      for(const row of selected){
        try{
          let item=matchedImportItem(row);
          if(!item&&row.remoteChoice)item=findExistingCatalogItem(data.items,row.remoteChoice);
          if(!item){const remoteItem=row.remoteChoice;item=await createCatalogItem(remoteItem?{
            category:remoteItem.category,name:remoteItem.name,subtitle:remoteItem.subtitle,description:remoteItem.description,year:remoteItem.year,coverUrl:remoteItem.coverUrl,sourceUrl:remoteItem.sourceUrl,provider:remoteItem.provider,providerItemId:remoteItem.providerId,platform:remoteItem.platform,tags:remoteItem.tags,bangumiScore:remoteItem.bangumiScore,bangumiRatingTotal:remoteItem.bangumiRatingTotal,bangumiRank:remoteItem.bangumiRank
          }:{category:row.category,name:row.name,subtitle:row.subtitle,year:row.year});created++;}
          if(own(item.id)){skipped++;continue}
          const {error}=await db.from('experiences').insert({user_id:ME,item_id:item.id,circle_id:share?activeCircle.id:null,visibility:share?'circle':'private',rating:row.rating,status:row.status,note:row.note,spoiler:false});
          if(error){if(error.code==='23505'){skipped++;continue}throw error}
          data.records.push({itemId:item.id,userId:ME,rating:row.rating,status:row.status,note:row.note,visibility:share?'circle':'private',updatedAt:new Date().toISOString()});inserted++;
        }catch(e){skipped++;errors.push(`${row.name}: ${displayError(e)}`)}
      }
      sheetLookupSerial++;closeModal();bulkDraft=null;await refreshAll(false);toast(`导入完成：新增 ${inserted} 条，跳过/失败 ${skipped} 条，新建作品 ${created} 条`);
      if(errors.length)alert('部分行未导入：\n'+errors.slice(0,12).join('\n'));
    }finally{isBusy=false}
  }

  function gate(kind){
    const title={setup:'请先连接 Supabase',loading:'正在连接你的私人圈子',login:'欢迎光临同频录像店',circle:'开通私人频道',error:'连接出现问题'}[kind];
    const content={
      setup:`<p>此版本需要 Supabase 项目才能保存真实成员和评分。先复制 <code>.env.example</code> 为 <code>.env</code>，填写项目 URL 和 <b>publishable key</b>，再运行数据库脚本。</p><div class="gate-tip">不要填写 secret / service_role key。具体步骤见项目 README.md。</div>`,
      loading:`<p>正在读取账号、成员和评分……</p><div class="gate-tip">第一次打开可能需要连接到 Supabase 服务器。</div>`,
      login:authMode==='register' ? `<p>创建一个同频账号。注册成功后仍需邀请码，才能加入朋友的私人圈子。</p><form class="gate-form" id="register-form"><label for="register-email">邮箱地址</label><input class="form-control" id="register-email" name="email" type="email" autocomplete="email" maxlength="254" required placeholder="you@example.com"/><label for="register-password">设置密码</label><input class="form-control" id="register-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required placeholder="至少 8 位，建议使用独立密码"/><label for="register-confirm">确认密码</label><input class="form-control" id="register-confirm" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required placeholder="再输入一遍密码"/><button class="primary-btn" type="submit">注册并进入同频 →</button><p class="auth-hint">本试运行版不验证邮箱所有权。请务必填写自己能长期使用的邮箱并记住密码；未配置 SMTP 时，无法通过邮件自助找回密码。</p></form><div class="auth-switch">已有账号？ <button class="link-btn" type="button" data-action="auth-mode" data-mode="login">返回登录</button></div>` : `<p>使用邮箱和密码登录你的私人兴趣档案，不需要邮件链接或验证码。</p><form class="gate-form" id="password-login-form"><label for="login-email">邮箱地址</label><input id="login-email" name="email" class="form-control" type="email" autocomplete="username" maxlength="254" required placeholder="you@example.com"/><label for="login-password">密码</label><input id="login-password" name="password" class="form-control" type="password" autocomplete="current-password" required placeholder="输入你的密码"/><button class="primary-btn" type="submit">登录同频 →</button><p class="auth-hint">以前只用 Magic Link 登录且没有设置过密码？请先在仍登录的设备上进入「我的」设置密码，或联系管理员协助处理。</p></form><div class="auth-switch">第一次来？ <button class="link-btn" type="button" data-action="auth-mode" data-mode="register">注册新账号</button></div>`,
      circle:`<p>你已经登录。现在可以创建一个私人圈子，或者输入朋友发送给你的邀请码加入现有圈子。</p><div class="gate-choice"><form id="create-circle-form" class="gate-form"><h3>✳ 创建圈子</h3><label>圈子名称</label><input name="circleName" class="form-control" maxlength="60" required placeholder="例如：我们的秘密基地"/><button class="primary-btn" type="submit">创建我的圈子</button></form><form id="join-circle-form" class="gate-form"><h3>✉ 加入朋友的圈子</h3><label>24 位邀请码</label><input name="inviteCode" class="form-control code-input" maxlength="24" minlength="24" autocapitalize="characters" required placeholder="粘贴邀请码"/><button class="btn-ghost" type="submit">加入圈子 →</button></form></div><button class="link-btn gate-logout" data-action="logout">切换登录账号</button>`,
      error:`<p>${esc(fetchError)}</p><div class="gate-tip">请检查是否已经在 Supabase SQL Editor 运行 <code>supabase/schema.sql</code>，以及项目 URL、认证与访问权限。</div><button class="primary-btn" data-action="refresh">重新连接</button><button class="link-btn gate-logout" data-action="logout">退出登录</button>`
    }[kind];
    return `<div class="gate-wrap"><div class="gate-orbit">✳</div><div class="eyebrow">RESONANCE VIDEO CLUB · MEMBERS ONLY</div><h1>${title}</h1>${content}</div>`;
  }

  const unwrap=(result)=>{if(result.error)throw result.error;return result.data};
  function mapCatalog(i){return {id:i.id,createdBy:i.created_by||null,circleId:i.circle_id||null,category:i.category,name:i.name,subtitle:i.subtitle||'',description:i.description||'',coverUrl:i.cover_url||'',sourceUrl:i.source_url||'',wikiTitle:i.wiki_title||'',emoji:i.emoji||CAT_EMOJI[i.category],year:i.year||'',tags:i.tags||[],provider:i.provider||null,providerItemId:i.provider_item_id||null,platform:i.bangumi_platform||'',bangumiScore:i.bangumi_score==null?null:Number(i.bangumi_score),bangumiRatingTotal:i.bangumi_rating_total??null,bangumiRank:i.bangumi_rank??null,...(detailMetadata.get(i.id)||{})}};
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
      if(wasCircle!==activeCircle.id){threadData={posts:[],comments:[],loading:false,error:'',circleId:'',loadedAt:0};subscribeToCircle();}
      // 地点图片不再在大陆用户浏览器中请求境外 Wikipedia；没有合法可用封面时使用占位。
      if(showToast)toast('圈子数据已同步');
    }catch(error){
      if(run===refreshSerial){fetchError=displayError(error);console.error('[同频] 数据同步失败',error)}
    }finally{if(run===refreshSerial){loading=false;render();if(view.page==='detail')void hydrateBangumiDetail(view.detailId);if(['feed','posts','post','detail'].includes(view.page)&&activeCircle)void loadPosts()}}
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
  async function deleteUnusedCatalogItem(itemId){
    if(isBusy||!ME||!activeCircle)return;
    const item=itemById(itemId);
    if(!item||item.createdBy!==ME||item.circleId!==activeCircle.id){toast('只能删除本人创建的圈内条目');return}
    if(!confirm(`确定永久删除共享作品《${item.name}》？\n只有无人收藏、无人评分且没有关联帖子时才能删除。此操作不能撤销。`))return;
    isBusy=true;
    try{
      // SECURITY DEFINER RPC checks all experiences (including private) and posts
      // transactionally; never trust the currently visible ratings in the client.
      const {data:deleted,error}=await db.rpc('delete_unused_catalog_item',{p_item_id:itemId});
      if(error)throw error;
      if(deleted!==true)throw Error('数据库未确认删除，操作已取消');
      data.items=data.items.filter(x=>x.id!==itemId);
      location.hash='discover';syncRoute();
      toast('空条目已从共享作品库删除');
      await refreshAll(false);
    }catch(e){toast('无法删除：'+displayError(e))}
    finally{isBusy=false}
  }
  async function createCatalogItem(item){
    const {data:inserted,error}=await db.from('catalog_items').insert({
      category:item.category,name:item.name.trim().slice(0,100),subtitle:(item.subtitle||'').slice(0,120),
      description:(item.description||'').slice(0,1500),cover_url:httpsUrl(item.coverUrl)||'',
      source_url:httpsUrl(item.sourceUrl)||'',year:String(item.year||'').slice(0,8),
      provider:item.provider||null,provider_item_id:item.providerItemId||null,
      emoji:item.emoji||CAT_EMOJI[item.category],created_by:ME,circle_id:activeCircle.id,
      tags:Array.isArray(item.tags)?item.tags.filter(t=>typeof t==='string').slice(0,8):[],
      bangumi_platform:item.provider==='bangumi'?String(item.platform||'').slice(0,80):'',
      bangumi_score:item.provider==='bangumi'&&Number(item.bangumiScore)>0?item.bangumiScore:null,
      bangumi_rating_total:item.provider==='bangumi'?(item.bangumiRatingTotal??null):null,
      bangumi_rank:item.provider==='bangumi'?(item.bangumiRank??null):null
    }).select('*').single();
    if(error){
      if(error.code==='23505'){
        await refreshAll(false);
        const existing=findExistingCatalogItem(data.items,{...item,providerId:item.providerItemId});
        if(existing)return existing;
      }
      throw error;
    }
    const created=mapCatalog(inserted);
    // Insert is committed and returned by Supabase. Make it available to the
    // rating form immediately, without waiting for a potentially stale refresh.
    if(!itemById(created.id))data.items.push(created);
    return created;
  }
  function validatedEmail(value){
    const email=String(value||'').trim().toLowerCase();
    if(!/^\S+@\S+\.\S+$/.test(email)||email.length>254)throw Error('请输入有效的邮箱地址');
    return email;
  }
  function validatedPassword(value){
    const password=String(value||'');
    if(password.length<8||password.length>128)throw Error('密码长度应为 8～128 位');
    return password;
  }
  async function finishSignIn(result){
    if(!result?.session?.access_token||!result?.user)throw Error('未获得登录会话。请检查 Supabase 是否关闭了 Confirm Email 设置。');
    authUser=result.user;
    loading=false;
    fetchError='';
    await refreshAll(false);
    render();
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
    document.body.classList.toggle('travel-detail-mode',active && view.page==='detail' && itemById(view.detailId)?.category==='place');
    if(!ready){$('page').innerHTML=gate('setup');return}
    if(loading){$('page').innerHTML=gate('loading');return}
    if(fetchError){$('page').innerHTML=gate('error');return}
    if(!authUser){$('page').innerHTML=gate('login');return}
    if(!activeCircle){$('page').innerHTML=gate('circle');return}
    $('rail-foot').innerHTML=`<div class="circle-avatar-stack">${USERS.slice(0,4).map(u=>`<span>${esc(u.name.slice(-1))}</span>`).join('')}</div><strong>${esc(activeCircle.name)}</strong><small>${USERS.length} 位成员 · 私密圈子</small><div class="private-hint">🔒 登录与 RLS 权限保护 · 成员评分已云端同步</div>`;
    nav();document.querySelector('.brand small').textContent=theme==='archive'?'THE COLLECTION / PERSONAL INDEX':'VIDEO CLUB / EST. 2026';$('page').dataset.page=view.page;
    $('page').innerHTML=({feed,discover,circle,posts,post:postPage,travel,me,detail:detailPage}[view.page]||feed)();side();initVisualMotion();
  }

  let motionObserver=null;
  function initVisualMotion(){
    motionObserver?.disconnect();
    const sections=document.querySelectorAll('#page .panel,#page .gallery-feature,#page .overview-row,#page .library-room,#page .hero,#page .intro');
    if(!('IntersectionObserver' in window)||matchMedia('(prefers-reduced-motion: reduce)').matches){sections.forEach(el=>el.classList.add('is-revealed'));return}
    motionObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-revealed');motionObserver.unobserve(entry.target)}}),{rootMargin:'0px 0px 35px 0px',threshold:.055});
    sections.forEach(el=>{el.classList.add('reveal-on-scroll');motionObserver.observe(el)});
  }
  // Motion: pointer-tracked highlights, not constant expensive page-wide animation.
  if(matchMedia('(hover:hover) and (pointer:fine)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches){
    let pending=false,lastEvent=null;
    document.addEventListener('pointermove',ev=>{
      const el=ev.target.closest('.gallery-hero,.shelf-book,.feature-volume');
      if(!el)return;lastEvent={el,x:ev.clientX,y:ev.clientY};
      if(pending)return;pending=true;
      requestAnimationFrame(()=>{pending=false;if(!lastEvent)return;const {el,x,y}=lastEvent;const rect=el.getBoundingClientRect();const px=(x-rect.left)/rect.width,py=(y-rect.top)/rect.height;
        el.style.setProperty('--pointer-x',`${(px*100).toFixed(1)}%`);el.style.setProperty('--pointer-y',`${(py*100).toFixed(1)}%`);
        if(el.classList.contains('shelf-book')){el.style.setProperty('--tilt-x',`${((.5-py)*9).toFixed(2)}deg`);el.style.setProperty('--tilt-y',`${((px-.5)*12).toFixed(2)}deg`)}
      });
    },{passive:true});
    document.addEventListener('pointerout',ev=>{const el=ev.target.closest('.shelf-book');if(el&&!el.contains(ev.relatedTarget)){el.style.removeProperty('--tilt-x');el.style.removeProperty('--tilt-y')}},{passive:true});
  }
  let scrollRaf=false;
  window.addEventListener('scroll',()=>{
    if(scrollRaf)return;scrollRaf=true;
    requestAnimationFrame(()=>{
      scrollRaf=false;
      const doc=document.documentElement, range=doc.scrollHeight-doc.clientHeight;
      const p=range>0?Math.max(0,Math.min(1,doc.scrollTop/range)):0;
      const bar=$('reading-progress');if(bar)bar.style.transform=`scaleX(${p})`;
      const hero=document.querySelector('.immersive-hero');
      if(hero && !matchMedia('(prefers-reduced-motion: reduce)').matches){
        const r=hero.getBoundingClientRect();
        if(r.bottom>0&&r.top<innerHeight){const depth=Math.max(-1,Math.min(1,-r.top/Math.max(1,r.height)));hero.style.setProperty('--hall-shift',`${(-depth*26).toFixed(1)}px`)}
      }
    });
  },{passive:true});
  function selectionOptions(items,selected) {return items.map(([value,label])=>`<option value="${value}" ${selected===value?'selected':''}>${esc(label)}</option>`).join('')}
  function openModal(html){$('modal-root').innerHTML=`<div class="modal-backdrop" data-action="modal-background"><div class="modal" role="dialog" aria-modal="true" aria-label="编辑体验">${html}</div></div>`}
  function closeModal(){if(bulkDraft){bulkDraft.abortController?.abort();sheetLookupSerial++;bulkDraft=null;}$('modal-root').innerHTML=''}
  function modalTop(title){return `<div class="modal-head"><h2>${title}</h2><button class="close-btn" data-action="close" aria-label="关闭">×</button></div>`}
  function recordForm(id){
    const item=itemById(id);
    if(!item?.id){toast('作品资料尚未载入，请返回「找片」重新选择');return}
    const rec=own(item.id),cat=item.category;
    openModal(`${modalTop(rec?'编辑我的体验':'为这部作品评分')}<form id="record-form">
    <div class="record-focus" aria-label="当前评分作品：${esc(item.name)}">
      ${cover(item,'record-focus-cover')}
      <div class="record-focus-copy"><span>NOW RECORDING / ${esc(CAT_NAME[cat])}</span><strong>${esc(item.name)}</strong><small>${esc(item.subtitle||'已加入同频共享片库')}</small><em>当前已锁定作品，避免评分错记。</em></div>
    </div>
    <input type="hidden" name="itemId" value="${esc(item.id)}"/>
    <div class="form-grid"><div class="form-field"><label for="record-status">体验状态</label><select class="form-control" id="record-status" name="status">${selectionOptions(STATUS[cat],rec?.status||'done')}</select></div><div class="form-field"><label for="record-rating">我的评分（可选）</label><input class="form-control" id="record-rating" name="rating" type="number" inputmode="decimal" placeholder="暂不评分" step="0.1" min="0.5" max="10" value="${rec&&isRated(rec)?rec.rating:''}"/></div></div>
    <div class="form-field"><label for="record-note">简短评价（可选）</label><textarea class="form-control" id="record-note" name="note" maxlength="2000" placeholder="你的真实感受，几句话就够了…">${esc(rec?.note||'')}</textarea><label class="spoiler-switch"><input type="checkbox" name="spoiler" ${rec?.spoiler?'checked':''}/> 这条短评包含剧透，默认隐藏</label></div><div class="form-field"><label for="record-visibility">可见范围</label><select class="form-control" id="record-visibility" name="visibility">${selectionOptions([['circle','👥 圈内可见'],['private','🔒 仅自己可见']],rec?.visibility||'circle')}</select></div>
    <div class="modal-actions">${rec?'<button type="button" class="btn-ghost danger" data-action="delete" data-id="'+esc(rec.itemId)+'">删除记录</button>':''}<button class="btn-ghost" type="button" data-action="close">取消</button><button class="primary-btn" type="submit">保存记录</button></div></form>`);
  }
  function newItemForm(initialCategory='game'){openModal(`${modalTop('创建一个新条目')}<form id="item-form"><div class="form-field"><label for="item-category">类别</label><select class="form-control" name="category" id="item-category">${selectionOptions([['game','🎮 游戏'],['anime','📺 动画'],['place','📍 旅行影像']],initialCategory)}</select></div><div class="form-field"><label for="item-name">名称 *</label><input class="form-control" name="name" id="item-name" maxlength="100" required placeholder="例如：京都、空洞骑士"/></div><div class="form-field"><label for="item-subtitle">补充信息（可选）</label><input class="form-control" name="subtitle" id="item-subtitle" maxlength="120" placeholder="例如：日本 · 城市 / 英文名"/></div><div class="form-field"><label for="item-cover">封面图片链接（可选）</label><input class="form-control" name="coverUrl" type="url" id="item-cover" placeholder="https://...（填写图片直链）"/><span class="field-hint">暂仅支持 HTTPS 图片链接；加载失败会显示渐变封面。</span></div><p class="help-copy">手动创建的条目可直接用于你的评分与圈内榜单。在线搜索目前已接入 Bangumi、IGDB 与高德；手动条目将独立保存到共享库。</p><div class="modal-actions"><button class="btn-ghost" type="button" data-action="close">取消</button><button class="primary-btn" type="submit">创建并记录</button></div></form>`)}
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
    const tags=itemKinds(item).map(t=>`<span class="detail-pill">${esc(t)}</span>`).join('');
    const source=httpsUrl(item.sourceUrl);
    return `<div class="detail-breadcrumb"><button data-action="back" class="back-link">${icon('arrow',16)} 返回${view.returnPage==='circle'?'榜单':view.returnPage==='feed'?'动态':view.returnPage==='me'?'我的档案':view.returnPage==='travel'?'沿途车站':'发现'}</button><span> / </span><span>${esc(CAT_NAME[item.category])}</span></div>
      <section class="detail-hero panel">
        <div class="detail-engraving" aria-hidden="true">✧</div><div class="detail-book-art">${cover(item,'detail-cover')}</div>
        <div class="detail-primary">
          <div class="eyebrow">${CAT_EMOJI[item.category]} ${CAT_NAME[item.category]} ${item.year?' / '+esc(item.year):''}</div>
          <h1>${esc(item.name)}</h1><div class="detail-original">${esc(item.subtitle||'')}</div>
          <p class="detail-description">${esc(item.description||'每个人的体验都不同。记录自己的感受，也来看看朋友的评价。')}</p>
          <div class="detail-pills">${tags}</div>
          <div class="detail-hero-actions"><button class="primary-btn" data-action="record" data-id="${esc(item.id)}">${myRecord?'✎ 编辑我的体验':'＋ 记录我的体验'}</button>${source?`<a class="btn-ghost detail-source" href="${esc(source)}" target="_blank" rel="noopener noreferrer">查看资料来源 ↗</a>`:''}${item.createdBy===ME&&item.circleId===activeCircle?.id?`<button type="button" class="btn-ghost danger delete-catalog-btn" data-action="delete-catalog-item" data-id="${esc(item.id)}" title="仅当无人收藏、评分或发帖时可删除">删除空条目</button>`:''}</div>
        </div>
      </section>
      ${item.provider==='bangumi'?`<div class="official-score-note panel"><div><span class="eyebrow">FROM BANGUMI · 社区参考</span><div class="official-score-title">Bangumi 评分 ${item.platform?`<span class="kind-chip">${esc(item.platform)}</span>`:''}</div><small>来自 Bangumi 社区的独立评分，不参与「同频」圈子榜单</small></div><div class="official-score-value">${item.bangumiScore!=null?Number(item.bangumiScore).toFixed(2):'—'}<span> / 10</span><small>${item.bangumiRatingTotal!=null?item.bangumiRatingTotal.toLocaleString('zh-CN')+' 人评分':'资料更新中或暂无评分'}${item.bangumiRank?' · 排名 #'+item.bangumiRank:''}</small></div></div>`:''}
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
      </section>
      ${item.category!=='place'?`<section class="panel item-posts"><div class="panel-head"><div><span class="eyebrow">AFTER THE CREDITS / 圈内讨论</span><h2 class="section-title">关于这部作品的帖子</h2></div><button class="primary-btn" data-action="new-post" data-id="${esc(item.id)}">＋ 发帖讨论</button></div>${postCards(threadData.posts.filter(p=>p.itemId===item.id).slice(0,5))}</section>`:''}`;
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
    else if(h.startsWith('post/')){view.postId=h.slice(5);view.page='post'}
    else if(['feed','discover','circle','posts','travel','me'].includes(h)){view.page=h;view.detailId=''}
    else {view.page='feed';view.detailId=''}
    render();if(view.page==='discover'&&view.search.trim().length>=2&&(remote.query!==view.search.trim()||remote.page!==view.remotePage))startRemoteSearch();if(view.page==='travel'&&view.travelSearch.trim().length>=2&&(travelRemote.query!==view.travelSearch.trim()||travelRemote.page!==view.travelRemotePage))startTravelSearch();if(view.page==='detail')void hydrateBangumiDetail(view.detailId);if(['feed','posts','post','detail'].includes(view.page))void loadPosts();window.scrollTo({top:0,behavior:'instant'});
  }
  function handleAction(target,clickEvent){const action=target.dataset.action;
    if(action==='navigate'){location.hash=target.dataset.page;syncRoute()}
    else if(action==='new-record'){location.hash='discover';syncRoute()}
    else if(action==='theme-toggle'){theme=theme==='archive'?'club':'archive';document.body.classList.toggle('theme-archive',theme==='archive');if(theme==='archive'&&view.personalDisplay==='shelf')view.personalDisplay='poster';try{localStorage.setItem('tongpin:ui-theme',theme);localStorage.setItem('tongpin:archive-display',view.personalDisplay)}catch(_){};render()}
    else if(action==='new-post')postForm(target.dataset.id||'');
    else if(action==='post-pick-item')pickPostSubject(target.dataset.id);
    else if(action==='post-pick-clear'){const hidden=$('post-item'),selected=$('post-picked'),results=$('post-subject-options'),search=$('post-item-search');if(hidden)hidden.value='';if(selected)selected.hidden=true;if(search){search.value='';search.focus()}if(results)results.hidden=false;renderPostChoices()}
    else if(action==='open-post'){location.hash='post/'+encodeURIComponent(target.dataset.id);syncRoute()}
    else if(action==='delete-post')void deletePost(target.dataset.id);
    else if(action==='delete-comment')void deleteComment(target.dataset.id);
    else if(action==='sheet-import')sheetDialog();
    else if(action==='sheet-review-filter'){if(bulkDraft){bulkDraft.reviewFilter=['all','review','missing'].includes(target.dataset.filter)?target.dataset.filter:'all';updateSheetSummary()}}
    else if(action==='confirm-sheet')void confirmSheetImport();
    else if(action==='sheet-lookup-toggle'){if(bulkDraft){bulkDraft.paused=!bulkDraft.paused;updateSheetSummary();if(!bulkDraft.paused)void autoFindSheetMatches()}}
    else if(action==='sheet-select-candidate'){const i=Number(target.dataset.row),j=Number(target.dataset.candidate),row=bulkDraft?.rows?.[i];if(confirmImportCandidate(row,row?.suggestions?.[j]))updateSheetRow(i)}
    else if(action==='sheet-clear-candidate'){const i=Number(target.dataset.row),row=bulkDraft?.rows?.[i];if(row){clearImportCandidate(row);updateSheetRow(i)}}
    else if(action==='sheet-retry'){const i=Number(target.dataset.row),row=bulkDraft?.rows?.[i];if(row&&!row.match&&!bulkDraft.lookingUp){row.lookupState='queued';row.lookupError='';bulkDraft.paused=false;updateSheetRow(i);void autoFindSheetMatches()}}
    else if(action==='bulk-row-toggle'){const i=Number(target.dataset.row),row=bulkDraft?.rows?.[i];if(row){toggleImportRow(row,target.checked,{allowManualCreation:!!$('sheet-create-missing')?.checked});syncSheetCheckbox(i);updateSheetSummary()}}
    else if(action==='travel-record'){$('travel-search-input')?.focus();toast('先搜索或选择地点，再记录体验')}
    else if(action==='record')recordForm(target.dataset.id);
    else if(action==='detail')detail(target.dataset.id);
    else if(action==='back'){location.hash=view.returnPage||'discover';syncRoute()}
    else if(action==='reveal-spoiler'){const box=target.closest('.spoiler-note'),p=box?.querySelector('.spoiler-text');if(p){p.hidden=!p.hidden;target.textContent=p.hidden?'点此查看':'收起剧透'}}
    else if(action==='new-item')newItemForm();
    else if(action==='travel-new-item')newItemForm('place');
    else if(action==='import-remote')importRemote(target.dataset.index,target.dataset.source||'discover',target);
    else if(action==='close')closeModal();
    else if(action==='modal-background'&&target===clickEvent.target)closeModal();
    else if(action==='travel-preset'){view.travelSearch=target.dataset.query;view.travelLocalPage=1;view.travelRemotePage=1;render();startTravelSearch();$('travel-search-input')?.focus()}
    else if(action==='search-preset'){view.category=target.dataset.category;view.search=target.dataset.query;view.localPage=1;view.remotePage=1;render();startRemoteSearch();$('search-input')?.focus()}
    else if(action==='category'){view.category=target.dataset.category;view.localPage=1;view.remotePage=1;render();startRemoteSearch();$('search-input')?.focus()}
    else if(action==='page-change'){
      const scope=target.dataset.scope,p=Number(target.dataset.page);
      if(!Number.isSafeInteger(p)||p<1)return;
      if(scope==='feed'){view.feedPage=paginate(allShared().filter(r=>itemById(r.itemId)?.category!=='place'),p,FEED_PAGE_SIZE).page;render()}
      else if(scope==='local'){view.localPage=paginate(discoverMatches(),p,LOCAL_PAGE_SIZE).page;$('discover-list').innerHTML=discoverList();$('discover-pager').innerHTML=discoverPager()}
      else if(scope==='remote'&&p<=view.remotePage+1){view.remotePage=p;startRemoteSearch()}
      else if(scope==='travel-local'){view.travelLocalPage=p;render()}
      else if(scope==='travel-remote'&&p<=view.travelRemotePage+1){view.travelRemotePage=p;startTravelSearch()}
      else if(scope==='rank'){view.rankPage=paginate(ranking().slice(3),p,8).page;$('ranking-list').innerHTML=rankingHTML()}
      else if(scope==='poster'){view.posterPage=paginate(filteredPersonalRecords(),p,24).page;$('personal-list').innerHTML=personalList()}
      else if(scope==='posts'){const filtered=threadData.posts.filter(x=>view.postCategory==='all'||itemById(x.itemId)?.category===view.postCategory);view.postPage=paginate(filtered,p,10).page;render()}
    }
    else if(action==='post-category'){view.postCategory=target.dataset.category;view.postPage=1;render()}
    else if(action==='rank-category'){view.rankCategory=target.dataset.category;view.rankPage=1;render()}
    else if(action==='personal-category'){view.personalCategory=target.dataset.category;view.posterPage=1;render()}
    else if(action==='personal-display'){view.personalDisplay=['shelf','list','poster'].includes(target.dataset.display)?target.dataset.display:'shelf';try{localStorage.setItem('tongpin:archive-display',view.personalDisplay)}catch(_){}render()}
    else if(action==='delete-catalog-item')void deleteUnusedCatalogItem(target.dataset.id);
    else if(action==='delete'){if(confirm('确认从云端删除自己的这条记录？'))deleteExperience(target.dataset.id)}
    else if(action==='refresh')refreshAll(true)
    else if(action==='logout')logout()
    else if(action==='auth-mode'){authMode=target.dataset.mode==='register'?'register':'login';render()}
    else if(action==='copy-invite'){if(inviteCode)navigator.clipboard.writeText(inviteCode).then(()=>toast('邀请码已复制')).catch(()=>toast('复制失败，请手动选择邀请码'))}
    else if(action==='export-xlsx'||action==='export-csv')void exportCollection(action==='export-xlsx'?'xlsx':'csv');
    else if(action==='export')exportData();
    else if(action==='import')$('import-file').click();
  }
  document.addEventListener('click', e=>{const target=e.target.closest('[data-action]');if(target)handleAction(target,e)});
  document.addEventListener('input', e=>{if(e.target.id==='post-item-search'){const hidden=$('post-item'),selected=$('post-picked'),results=$('post-subject-options');if(hidden)hidden.value='';if(selected)selected.hidden=true;if(results)results.hidden=false;renderPostChoices(e.target.value)}else if(e.target.id==='search-input'){view.search=e.target.value;view.localPage=1;view.remotePage=1;$('discover-list').innerHTML=discoverList();$('discover-pager').innerHTML=discoverPager();const picks=document.querySelector('.search-quick-picks');if(picks)picks.hidden=!!view.search.trim();startRemoteSearch()}else if(e.target.id==='travel-search-input'){view.travelSearch=e.target.value;view.travelLocalPage=1;view.travelRemotePage=1;renderTravelResults();startTravelSearch()}});
  document.addEventListener('change', e=>{
    const t=e.target;
    if(t.id==='min-three'){view.minThree=t.checked;view.rankPage=1;$('ranking-list').innerHTML=rankingHTML()}
    else if(t.id==='travel-three'){view.travelMinThree=t.checked;$('travel-ranking').innerHTML=travelRankingHTML()}
    else if(t.id==='rank-mode'){view.rankMode=t.value;view.rankPage=1;$('ranking-list').innerHTML=rankingHTML()}
    else if(t.id==='personal-status'){view.personalStatus=t.value;view.posterPage=1;$('personal-list').innerHTML=personalList()}
    else if(t.id==='personal-sort'){view.personalSort=t.value;view.posterPage=1;$('personal-list').innerHTML=personalList()}
    else if(t.id==='import-file')importData(t);
    else if(t.id==='sheet-file')void previewSheetFile(t);
    else if(t.id==='sheet-create-missing'&&bulkDraft){
      // Disabling manual creation also removes any unchecked-by-default raw rows
      // that the user had explicitly opted into creating.
      if(!t.checked)for(const row of bulkDraft.rows)if(!hasConfirmedImportItem(row)){row.selected=false;row.selectionTouched=false;}
      bulkDraft.rows.forEach((_,i)=>syncSheetCheckbox(i));updateSheetSummary();
    }
  });
  document.addEventListener('submit', async e=>{
    const form=e.target, id=form.id;
    if(!['record-form','item-form','password-login-form','register-form','password-form','create-circle-form','join-circle-form','nickname-form','post-form','comment-form'].includes(id))return;
    e.preventDefault();
    if(isBusy)return;
    const f=new FormData(form);
    try{
      isBusy=true;
      if(id==='password-login-form'){
        const email=validatedEmail(f.get('email'));
        const password=String(f.get('password')||'');
        const {data:result,error}=await db.auth.signInWithPassword({email,password});
        if(error)throw error;
        await finishSignIn(result);
        toast('登录成功，欢迎回来！');
      } else if(id==='register-form'){
        const email=validatedEmail(f.get('email'));
        const password=validatedPassword(f.get('password'));
        if(password!==String(f.get('confirmPassword')||''))throw Error('两次输入的密码不一致');
        const {data:result,error}=await db.auth.signUp({email,password});
        if(error)throw error;
        if(!result?.session)throw Error('注册已提交，但未获得登录会话。请在 Supabase → Authentication → Email 中关闭 Confirm Email，再重试登录。');
        await finishSignIn(result);
        toast('注册成功！请选择创建圈子或输入邀请码加入圈子。');
      } else if(id==='password-form'){
        const password=validatedPassword(f.get('newPassword'));
        if(password!==String(f.get('confirmPassword')||''))throw Error('两次输入的密码不一致');
        const {error}=await db.auth.updateUser({password});
        if(error)throw error;
        form.reset();
        toast('密码已设置或更新。后续可以通过邮箱和密码登录。');
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
      } else if(id==='post-form'){
        const item=itemById(String(f.get('itemId')||''));if(!item||!['game','anime'].includes(item.category))throw Error('请选择游戏或动画作品');
        const title=String(f.get('title')||'').trim(),body=String(f.get('body')||'').trim();
        if(title.length<2||title.length>80||body.length<1||body.length>5000)throw Error('标题需要 2～80 字，正文需要 1～5000 字');
        unwrap(await db.from('circle_posts').insert({user_id:ME,circle_id:activeCircle.id,item_id:item.id,title,body,spoiler:f.has('spoiler')}));
        closeModal();await loadPosts(true);location.hash='posts';syncRoute();toast('帖子已发布到圈内');
      } else if(id==='comment-form'){
        const post=threadData.posts.find(x=>x.id===String(f.get('postId')));const body=String(f.get('body')||'').trim();
        if(!post||body.length<1||body.length>1000)throw Error('回复需要 1～1000 字');
        unwrap(await db.from('post_comments').insert({user_id:ME,circle_id:activeCircle.id,post_id:post.id,body}));
        await loadPosts(true);toast('回复已发布');
      } else if(id==='record-form'){
        const item=itemById(String(f.get('itemId')));
        if(!item)throw Error('请先创建或选择条目');
        const raw=String(f.get('rating')||'').trim();const rating=raw===''?null:Number(raw);
        if(rating!==null&&!isValidPersonalRating(rating))throw Error('评分需要在 0.5～10 之间，步长为 0.1');
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
  async function exportCollection(format='xlsx'){
    if(collectionExportRunning||!db||!authUser||!ME)return;
    collectionExportRunning=true;
    const buttons=[...document.querySelectorAll('[data-action="export-xlsx"],[data-action="export-csv"]')];
    buttons.forEach(b=>b.disabled=true);
    try{
      toast('正在整理你的全部个人收藏…');
      const snapshot=await loadCollectionForExport(db,ME);
      const rows=buildCollectionExportRows({...snapshot,userId:ME});
      if(!rows.length){toast('当前没有可导出的动画或游戏收藏');return;}
      const blob=format==='xlsx'?collectionToXlsx(rows):new Blob([collectionToCsv(rows)],{type:'text/csv;charset=utf-8'});
      const stamp=new Date().toISOString().slice(0,10);
      const name=`同频-个人收藏-${stamp}.${format}`;
      const href=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=href;a.download=name;a.style.display='none';document.body.append(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(href),10000);
      toast(`已生成 ${rows.length} 条个人收藏的 ${format==='xlsx'?'Excel':'CSV'} 文件`);
    }catch(err){toast('导出失败：'+displayError(err));}
    finally{collectionExportRunning=false;buttons.forEach(b=>b.disabled=false)}
  }
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
        if(rating!==null&&!isValidPersonalRating(rating)){skipped++;continue}
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
