import './style.css';
import "./library-theme.css";
import "./videostore-theme.css";
import "./v049-upgrade.css";
import "./v050-departure.css";
import "./v0531-podium-fix.css";
import "./v054-mobile-fix.css";
import "./v056-flow.css";
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
    {id:'circle',name:'好友频道',icon:'users'},
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
  let remote = {items:[],notices:[],state:'idle',query:'',category:''};
  const detailLookups = new Set(); // per-session on-demand hydration for legacy Bangumi entries
  const detailMetadata = new Map(); // retain hydrated fields across normal background refreshes
  let searchTimer = null;
  let searchSerial = 0;
  let travelSearchTimer = null;
  let travelSearchSerial = 0;
  let travelRemote = {items:[],notices:[],state:'idle',query:'',category:'place',page:1,hasMore:false};
  let view = {page:'feed',detailId:'',returnPage:'discover',category:'all',rankCategory:'all',rankMode:'average',rankPage:1,feedPage:1,minThree:false,search:'',personalCategory:'all',personalStatus:'all',personalSort:'recent',personalDisplay:'shelf',localPage:1,remotePage:1,travelSearch:'',travelLocalPage:1,travelRemotePage:1,travelMinThree:false};
  try { if(localStorage.getItem('tongpin:archive-display')==='list')view.personalDisplay='list'; } catch(_) {}
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
    const build=(mobile=false)=>NAV.map(n=>mobile
      ? `<button class="${(view.page===n.id||(view.page==='detail'&&view.returnPage===n.id))?'active':''}" data-action="navigate" data-page="${n.id}"><span class="bottom-icon">${icon(n.icon,21)}</span><span>${n.name}</span></button>`
      : `<button class="nav-button ${view.page===n.id?'active':''}" data-action="navigate" data-page="${n.id}"><span class="nav-icon">${icon(n.icon,19)}</span><span>${n.name}</span>${(n.id===view.page||(view.page==='detail'&&n.id===view.returnPage))?'<span class="nav-active-dot"></span>':''}</button>`).join('');
    $('side-nav').innerHTML=build();
    $('bottom-nav').innerHTML=build(true);
    $('top-nav').innerHTML=NAV.map(n=>`<button class="top-nav-link ${(view.page===n.id||(view.page==='detail'&&view.returnPage===n.id))?'active':''}" data-action="navigate" data-page="${n.id}"><span>${n.name}</span></button>`).join('');
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
  function feed(){const events=allShared().filter(r=>itemById(r.itemId)?.category!=='place').slice().sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));const mine=ownRecords().length;const feedInfo=paginate(events,view.feedPage,FEED_PAGE_SIZE);view.feedPage=feedInfo.page;return `
    <section class="hero gallery-hero immersive-hero video-store-hero" data-motion="hero" aria-label="同频录像店首页">
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
    ${featuredSelections()}
    <div class="feed-section-head"><div><span class="eyebrow">NEW RELEASES / FRIEND FREQUENCY <span class="eyebrow-dot">✧</span></span><h2 class="section-title">朋友正在播放<span class="tiny-spark"> ✳</span></h2><p class="section-sub">新番与新游，每一天都有新节目；旅行故事请到「沿途车站」。</p><div class="feed-section-meta"><span class="feed-count">${feedInfo.total} 条动态</span>${feedInfo.totalPages>1?`<span class="feed-page-chip">PAGE ${feedInfo.page}/${feedInfo.totalPages}</span>`:''}</div></div><button class="btn-ghost feed-head-btn" data-action="navigate" data-page="circle">圈内榜单 ${icon('arrow',15)}</button></div>
    <div class="feed-list">${!feedInfo.items.length?'<div class="panel empty-state"><strong>圈子里还没有动态</strong><p>记录第一条体验，和朋友一起慢慢积累回忆。</p><button class="primary-btn" data-action="navigate" data-page="discover">⌕ 去找片并记录</button></div>':''}${feedInfo.items.map((r,index)=>{const item=itemById(r.itemId);if(!item)return '';return `<article class="panel feed-card ${index===0?'feed-card-feature':''}"><div class="feed-user">${avatar(r.userId)}<div><div class="name">${esc(userById(r.userId).name)} <span class="user-action">${esc(labelStatus(item.category,r.status))}了</span></div><div class="meta">${notifyAge(r.updatedAt)} · 分享了一条体验</div></div><span class="spacer"></span><span class="tag tag-${item.category}">${CAT_EMOJI[item.category]} ${CAT_NAME[item.category]}</span></div>
      <div class="content-row">${cover(item)}<div class="feed-detail"><div class="feed-item-sub">${esc(item.subtitle||CAT_NAME[item.category])}</div><button class="record-title clickable" data-action="detail" data-id="${item.id}">${esc(item.name)}</button><div class="feed-ratingline">${isRated(r)?`<span class="rating" aria-label="个人评分 ${r.rating.toFixed(1)} / 10"><em>MY SCORE</em><strong>${r.rating.toFixed(1)}</strong><small> / 10</small></span><span class="rating-label">${r.rating>=9?'特别喜欢':r.rating>=8?'值得体验':'我的评分'}</span>`:`<span class="tag gray">暂未评分</span>`}</div>${r.note?`<div class="note">${r.spoiler?'◈ 剧透内容已隐藏，进入作品详情后可查看':`“${esc(r.note)}”`}</div>`:''}</div></div><div class="subbar"><span>${icon('users',14)} ${visibleRatings(item.id).length} 位伙伴打过分</span><span class="spacer"></span><button class="action-link" data-action="detail" data-id="${item.id}">查看评价 ${icon('arrow',14)}</button></div></article>`}).join('')}</div>
    ${feedInfo.totalPages>1?`<div class="feed-pager-wrap"><span class="pagination-summary">最新动态分页展示 · 每页 ${FEED_PAGE_SIZE} 条</span>${renderPager('feed',feedInfo.page,feedInfo.totalPages)}</div>`:''}`}
  const FEED_PAGE_SIZE = 8;
  const LOCAL_PAGE_SIZE = 10;
  const TRAVEL_PAGE_SIZE = 9;
  function renderPager(scope,page,totalPages){
    if(totalPages<=1)return '';
    const start=Math.max(1,Math.min(page-2,totalPages-4));
    const end=Math.min(totalPages,start+4);
    const buttons=[];
    for(let i=start;i<=end;i++)buttons.push(`<button type="button" class="pager-page ${i===page?'active':''}" data-action="page-change" data-scope="${scope}" data-page="${i}" aria-label="第 ${i} 页" aria-current="${i===page?'page':'false'}">${i}</button>`);
    const aria=scope==='feed'?'朋友正在播放':scope==='local'?'共享作品':scope==='travel-local'?'旅行地点':scope==='rank'?'好友频道排行榜':'线上搜索';return `<nav class="page-controls" aria-label="${aria}分页"><button type="button" data-action="page-change" data-scope="${scope}" data-page="${page-1}" ${page===1?'disabled':''}>← 上一页</button><span class="pager-number-group">${buttons.join('')}</span><button type="button" data-action="page-change" data-scope="${scope}" data-page="${page+1}" ${page>=totalPages?'disabled':''}>下一页 →</button><span class="pager-page-label">${page} / ${totalPages}</span></nav>`;
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
    return `<div class="ranking-console"><div class="rank-console-controls"><label class="toggle rank-toggle"><input type="checkbox" id="min-three" ${view.minThree?'checked':''}/> <span>只看 ≥ 3 人评分</span></label><label class="rank-mode-wrap"><span>播放模式</span><select id="rank-mode" class="sort-select" aria-label="榜单类型"><option value="average" ${view.rankMode==='average'?'selected':''}>最高评分</option><option value="difference" ${view.rankMode==='difference'?'selected':''}>最大分歧</option></select></label></div>
    <div class="rank-console-intro"><span>LIVE BROADCAST / RANKING TRANSMISSION</span><strong>${view.rankMode==='average'?'谁是本期主角？':'谁让频道吵翻了？'}</strong><small>${view.minThree?'仅统计至少三位成员打分的条目':'默认呈现所有已评分条目'} · ${list.length} 个候选</small></div>
    ${top.length?`<div class="rank-broadcast">${top.map((x,i)=>`<button type="button" class="broadcast-tape broadcast-no-${i+1}" data-action="detail" data-id="${esc(x.item.id)}" aria-label="榜单第${i+1}名，${esc(x.item.name)}，${metric}${val(x)}"><span class="broadcast-rank-marker">${String(i+1).padStart(2,'0')}<small>${i===0?'TOP RENTAL':'CHART PICK'}</small></span><span class="broadcast-image">${cover(x.item,'broadcast-cover')}</span><span class="broadcast-content"><span class="broadcast-category">${CAT_EMOJI[x.item.category]} ${CAT_NAME[x.item.category]}</span><strong>${esc(x.item.name)}</strong><span class="broadcast-people">${x.count} 人评分 ${x.count<3?'· 样本较少':''}</span></span><span class="broadcast-score">${val(x)}<small>${metric}</small></span></button>`).join('')}</div>`:'<div class="empty-state">当前没有符合筛选条件的作品。试着关闭三人筛选或邀请朋友评分。</div>'}
    ${list.length?`<div class="rank-rest"><div class="rank-rest-head"><div class="rank-rest-label">THE COMPLETE CHART / 完整榜单 <span>${rest.length?`第 4—${list.length} 名 · 分页浏览`:'当前只有前三名作品'}</span></div>${rest.length?`<span class="rank-rest-count">PAGE ${restPage.page}/${restPage.totalPages}</span>`:''}</div>${rest.length?restPage.items.map((x,i)=>{const rankNumber=(restPage.page-1)*restPage.pageSize+i+4;return `<button type="button" class="rank-track" data-action="detail" data-id="${esc(x.item.id)}"><span class="rank-track-num">${String(rankNumber).padStart(2,'0')}</span>${cover(x.item,'rank-track-cover')}<span class="rank-track-title"><strong>${esc(x.item.name)}</strong><small>${x.count} 人打分 · ${CAT_NAME[x.item.category]}</small></span><span class="rank-track-score">${val(x)}</span><span class="rank-track-arrow">↗</span></button>`}).join('')+renderPager('rank',restPage.page,restPage.totalPages):'<div class="rank-rest-empty">当前榜单已全部展示完毕。</div>'}</div>`:''}</div>`;
  }
  function circle(){const diff=data.items.filter(x=>x.category!=='place').map(summarize).filter(x=>x.spread!==null).sort((a,b)=>b.spread-a.spread)[0];return `<section class="channel-hero"><div class="channel-hero-copy"><span>ON AIR · PRIVATE CHANNEL / 03</span><h2>我们的<br><em>HOT 100*</em></h2><p>*不一定凑满一百部，但每个分数都来自真正的朋友。</p></div><div class="channel-disc" aria-hidden="true"><div class="disc-label"><span>RESONANCE</span><b>33⅓</b><small>PLAY IT AGAIN</small></div></div></section>
    <section class="ranking-hub"><div class="rank-hub-heading"><div><span class="eyebrow">CHANNEL CHARTS / THE TASTEMAKERS</span><h2>本期上榜 <b>↗</b></h2><p>前三名登上播放主舞台，其余作品进入可分页的完整曲目表。</p></div><div class="rank-mini-stats"><b>${data.items.filter(x=>x.category!=='place').map(summarize).filter(x=>x.count).length}</b><span>入榜作品</span></div></div>${cats(view.rankCategory,'rank-category')}<div id="ranking-list">${rankingHTML()}</div></section>
    ${diff?`<section class="channel-debate"><div><span class="eyebrow">THE ARGUMENT / 本周争议</span><h3>这部，大家意见很大。</h3><p>评分最高和最低相差 <strong>${diff.spread.toFixed(1)}</strong> 分。</p></div><button data-action="detail" data-id="${esc(diff.item.id)}">${cover(diff.item,'debate-cover')}<span>${esc(diff.item.name)}<small>${diff.count} 人参与评分 ↗</small></span></button></section>`:''}
    <section class="crew-room"><div class="crew-heading"><span>BEHIND THE COUNTER</span><h2>店内伙伴 / ${USERS.length}</h2></div><div class="crew-grid">${USERS.map((u,i)=>`<div class="crew-card"><div class="crew-card-code">STAFF / ${String(i+1).padStart(2,'0')}</div>${avatar(u.id)}<strong>${esc(u.name)}</strong><span>${data.records.filter(r=>r.userId===u.id&&isRated(r)).length} 条评分 · ${data.records.filter(r=>r.userId===u.id).length} 条记录</span></div>`).join('')}</div>${activeCircle?.owner_id===ME?`<div class="invite-box"><strong>邀请更多同频伙伴</strong><p>把邀请码私下发送给朋友。</p><div class="invite-code">${esc(inviteCode||'加载中…')}</div><button class="btn-ghost" data-action="copy-invite">复制邀请码</button></div>`:''}</section>`;}
  function filteredPersonalRecords(){return ownRecords().filter(r=>{const item=itemById(r.itemId);return item&&item.category!=='place'&&(view.personalCategory==='all'||item.category===view.personalCategory)&&(view.personalStatus==='all'||r.status===view.personalStatus)}).slice().sort((a,b)=>view.personalSort==='rating'?((isRated(b)?b.rating:-1)-(isRated(a)?a.rating:-1) || new Date(b.updatedAt)-new Date(a.updatedAt)):new Date(b.updatedAt)-new Date(a.updatedAt));}
  function libraryTier(records,label,serial){
    if(!records.length)return '';
    return `<section class="mix-section"><div class="mix-section-heading"><div><span>${serial} / REWIND TO PLAY</span><h3>${esc(label)}</h3></div><span class="mix-tape-count">${records.length} TAPES <b>↗</b></span></div><div class="mix-scroll" tabindex="0" aria-label="${esc(label)}的收藏，横向滚动查看更多">${records.map((r,i)=>{const item=itemById(r.itemId);return `<button type="button" class="mix-tape" data-action="detail" data-id="${esc(item.id)}" aria-label="查看${esc(item.name)}的详情" style="--tilt:${[-5,4,-2,5,-4,2][i%6]}deg;--cassette-index:${i}"><span class="mix-tape-case"><span class="mix-cassette-spine">R · ${serial} · ${String(i+1).padStart(2,'0')}</span>${cover(item,'mix-tape-cover')}<span class="mix-tape-sticker">${CAT_NAME[item.category]} / ${esc(labelStatus(item.category,r.status))}</span><span class="mix-tape-reels"><b></b><b></b></span></span><span class="mix-tape-info"><strong>${esc(item.name)}</strong><span>${isRated(r)?`MY SCORE <b>${r.rating.toFixed(1)}</b>`:'未评分'} ${item.bangumiScore?' · BGM '+Number(item.bangumiScore).toFixed(1):''}</span></span></button>`}).join('')}</div><span class="mix-scroll-hint">← SCROLL THE RACK →</span></section>`;
  }
  function personalList(){const mine=filteredPersonalRecords();if(!mine.length)return '<div class="empty-state"><strong>还没有符合条件的磁带</strong><p>去「找片」添加你的第一部作品。</p></div>';
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
  function me(){const mine=ownRecords(),rated=mine.filter(isRated);return `<div class="locker-utility"><span>MY VIDEO LOCKER / 04 · 私人录像柜</span><button class="primary-btn" data-action="navigate" data-page="discover">⌕ 去找片</button></div>
    <div class="stats"><div class="stat"><strong>${mine.filter(r=>itemById(r.itemId)?.category==='game').length}</strong><span>🎮 游戏</span></div><div class="stat"><strong>${mine.filter(r=>itemById(r.itemId)?.category==='anime').length}</strong><span>📺 动画</span></div><button type="button" class="stat stat-travel-gate" data-action="navigate" data-page="travel"><strong>${mine.filter(r=>itemById(r.itemId)?.category==='place').length}</strong><span>🚆 地点 · 去沿途车站 ↗</span></button></div>
    <section class="locker-controls"><div class="panel-head"><div><h2 class="section-title">我的收藏与评分</h2><div class="section-sub">${mine.length} 条记录，其中 ${rated.length} 条已评分</div></div><div class="display-toggle" role="group" aria-label="收藏展示方式"><button data-action="personal-display" data-display="shelf" class="${view.personalDisplay==='shelf'?'selected':''}" aria-pressed="${view.personalDisplay==='shelf'}">▣ MIXTAPE 磁带馆</button><button data-action="personal-display" data-display="list" class="${view.personalDisplay==='list'?'selected':''}" aria-pressed="${view.personalDisplay==='list'}">☷ 列表</button></div></div>${cats(view.personalCategory,'personal-category')}<div class="filter-line"><select id="personal-status" class="sort-select"><option value="all">全部状态</option><option value="want" ${view.personalStatus==='want'?'selected':''}>想体验</option><option value="doing" ${view.personalStatus==='doing'?'selected':''}>进行中</option><option value="done" ${view.personalStatus==='done'?'selected':''}>已完成 / 去过</option><option value="paused" ${view.personalStatus==='paused'?'selected':''}>搁置</option></select><select id="personal-sort" class="sort-select" aria-label="我的记录排序"><option value="recent" ${view.personalSort==='recent'?'selected':''}>最近更新</option><option value="rating" ${view.personalSort==='rating'?'selected':''}>个人评分榜（高到低）</option></select></div><div id="personal-list">${personalList()}</div></section>
    <div class="panel"><h2 class="section-title">账号与云端档案</h2><p class="help-copy">已登录：${esc(authUser?.email||'')}。个人记录保存在 Supabase；导入旧版记录时默认设为“仅自己可见”。</p>
    <form id="nickname-form" class="account-form"><label>圈内昵称</label><input name="nickname" class="form-control" maxlength="40" required value="${esc(userById(ME).name)}"/><button class="btn-ghost" type="submit">更新昵称</button></form>
    <form id="password-form" class="account-form"><label for="new-password">设置 / 修改登录密码</label><input id="new-password" name="newPassword" class="form-control" type="password" autocomplete="new-password" minlength="8" maxlength="128" required placeholder="新密码（8 位以上）"/><input name="confirmPassword" class="form-control" type="password" autocomplete="new-password" minlength="8" maxlength="128" required placeholder="确认新密码"/><button class="btn-ghost" type="submit">保存密码</button></form><p class="help-copy">旧版 Magic Link 用户：如当前仍已登录，可在此设置密码以保留原账号 ID、圈子和评分。若开启了 Supabase 的安全密码变更验证，旧会话可能还需重新认证。</p>
    <div class="filters" style="margin:15px 0 0"><button class="btn-ghost" data-action="export">⇩ 导出数据</button><button class="btn-ghost" data-action="import">⇧ 导入旧版备份</button><button class="btn-ghost danger" data-action="logout">退出登录</button></div></div>`}
  function displayError(error){
    const raw=String(error?.message||error||'未知错误');
    if(/Failed to fetch|NetworkError|fetch failed/i.test(raw))return '网络连接失败，请检查大陆网络到 Supabase Auth 的连通性';
    if(/Invalid login credentials/i.test(raw))return '邮箱或密码不正确（仅用旧 Magic Link 登录的账号可能尚未设置密码）';
    if(/User already registered/i.test(raw))return '这个邮箱已注册，请返回登录；如果还没设过密码，请使用原登录会话设置密码';
    if(/relation .* does not exist|schema cache|Could not find the function|PGRST202|PGRST205/i.test(raw))return '数据库还未正确初始化，请先运行 supabase/schema.sql';
    return raw.slice(0,170);
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
  function mapCatalog(i){return {id:i.id,category:i.category,name:i.name,subtitle:i.subtitle||'',description:i.description||'',coverUrl:i.cover_url||'',sourceUrl:i.source_url||'',wikiTitle:i.wiki_title||'',emoji:i.emoji||CAT_EMOJI[i.category],year:i.year||'',tags:i.tags||[],provider:i.provider||null,providerItemId:i.provider_item_id||null,platform:i.bangumi_platform||'',bangumiScore:i.bangumi_score==null?null:Number(i.bangumi_score),bangumiRatingTotal:i.bangumi_rating_total??null,bangumiRank:i.bangumi_rank??null,...(detailMetadata.get(i.id)||{})}};
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
    }finally{if(run===refreshSerial){loading=false;render();if(view.page==='detail')void hydrateBangumiDetail(view.detailId)}}
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
    nav();$('page').dataset.page=view.page;
    $('page').innerHTML=({feed,discover,circle,travel,me,detail:detailPage}[view.page]||feed)();side();initVisualMotion();
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
  function closeModal(){$('modal-root').innerHTML=''}
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
    <div class="form-grid"><div class="form-field"><label for="record-status">体验状态</label><select class="form-control" id="record-status" name="status">${selectionOptions(STATUS[cat],rec?.status||'done')}</select></div><div class="form-field"><label for="record-rating">我的评分（可选）</label><input class="form-control" id="record-rating" name="rating" type="number" inputmode="decimal" placeholder="暂不评分" step="0.5" min="0.5" max="10" value="${rec&&isRated(rec)?rec.rating:''}"/></div></div>
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
          <div class="detail-hero-actions"><button class="primary-btn" data-action="record" data-id="${esc(item.id)}">${myRecord?'✎ 编辑我的体验':'＋ 记录我的体验'}</button>${source?`<a class="btn-ghost detail-source" href="${esc(source)}" target="_blank" rel="noopener noreferrer">查看资料来源 ↗</a>`:''}</div>
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
    else if(['feed','discover','circle','travel','me'].includes(h)){view.page=h;view.detailId=''}
    else {view.page='feed';view.detailId=''}
    render();if(view.page==='discover'&&view.search.trim().length>=2&&(remote.query!==view.search.trim()||remote.page!==view.remotePage))startRemoteSearch();if(view.page==='travel'&&view.travelSearch.trim().length>=2&&(travelRemote.query!==view.travelSearch.trim()||travelRemote.page!==view.travelRemotePage))startTravelSearch();if(view.page==='detail')void hydrateBangumiDetail(view.detailId);window.scrollTo({top:0,behavior:'instant'});
  }
  function handleAction(target,clickEvent){const action=target.dataset.action;
    if(action==='navigate'){location.hash=target.dataset.page;syncRoute()}
    else if(action==='new-record'){location.hash='discover';syncRoute()}
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
    }
    else if(action==='rank-category'){view.rankCategory=target.dataset.category;view.rankPage=1;render()}
    else if(action==='personal-category'){view.personalCategory=target.dataset.category;render()}
    else if(action==='personal-display'){view.personalDisplay=target.dataset.display==='list'?'list':'shelf';try{localStorage.setItem('tongpin:archive-display',view.personalDisplay)}catch(_){}render()}
    else if(action==='delete'){if(confirm('确认从云端删除自己的这条记录？'))deleteExperience(target.dataset.id)}
    else if(action==='refresh')refreshAll(true)
    else if(action==='logout')logout()
    else if(action==='auth-mode'){authMode=target.dataset.mode==='register'?'register':'login';render()}
    else if(action==='copy-invite'){if(inviteCode)navigator.clipboard.writeText(inviteCode).then(()=>toast('邀请码已复制')).catch(()=>toast('复制失败，请手动选择邀请码'))}
    else if(action==='export')exportData();
    else if(action==='import')$('import-file').click();
  }
  document.addEventListener('click', e=>{const target=e.target.closest('[data-action]');if(target)handleAction(target,e)});
  document.addEventListener('input', e=>{if(e.target.id==='search-input'){view.search=e.target.value;view.localPage=1;view.remotePage=1;$('discover-list').innerHTML=discoverList();$('discover-pager').innerHTML=discoverPager();const picks=document.querySelector('.search-quick-picks');if(picks)picks.hidden=!!view.search.trim();startRemoteSearch()}else if(e.target.id==='travel-search-input'){view.travelSearch=e.target.value;view.travelLocalPage=1;view.travelRemotePage=1;renderTravelResults();startTravelSearch()}});
  document.addEventListener('change', e=>{
    const t=e.target;
    if(t.id==='min-three'){view.minThree=t.checked;view.rankPage=1;$('ranking-list').innerHTML=rankingHTML()}
    else if(t.id==='travel-three'){view.travelMinThree=t.checked;$('travel-ranking').innerHTML=travelRankingHTML()}
    else if(t.id==='rank-mode'){view.rankMode=t.value;view.rankPage=1;$('ranking-list').innerHTML=rankingHTML()}
    else if(t.id==='personal-status'){view.personalStatus=t.value;$('personal-list').innerHTML=personalList()}
    else if(t.id==='personal-sort'){view.personalSort=t.value;$('personal-list').innerHTML=personalList()}
    else if(t.id==='import-file')importData(t);
  });
  document.addEventListener('submit', async e=>{
    const form=e.target, id=form.id;
    if(!['record-form','item-form','password-login-form','register-form','password-form','create-circle-form','join-circle-form','nickname-form'].includes(id))return;
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
