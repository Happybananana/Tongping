/** Tongpin V0.6.8: pure travel-memory models; no browser or database dependencies. */
export const ARCHIVE_PAGE_SIZE = 12;

export function normalizeTravelDate(precision, year, month, day) {
  const p=String(precision || 'unknown');
  if(p==='unknown' || !p) return {visited_on:null,visit_date_precision:null};
  if(!['year','month','day'].includes(p)) throw Error('请选择合法的日期精度');
  const y=Number(year),m=p==='year'?1:Number(month),d=p==='day'?Number(day):1;
  if(!Number.isInteger(y)||y<1900||y>2100)throw Error('请输入 1900～2100 之间的年份');
  if(!Number.isInteger(m)||m<1||m>12)throw Error('月份需要在 1～12 之间');
  if(!Number.isInteger(d)||d<1||d>31)throw Error('请选择正确的到访日期');
  const date=new Date(Date.UTC(y,m-1,d));
  if(date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)throw Error('到访日期无效');
  const iso=[String(y).padStart(4,'0'),String(m).padStart(2,'0'),String(d).padStart(2,'0')].join('-');
  const today=new Date(),localToday=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
  if(iso>localToday)throw Error('到访日期不能晚于今天');
  return {visited_on:iso,visit_date_precision:p};
}
export function formatTravelDate(iso,precision) {
  if(!iso||!precision)return '日期未记';
  const s=String(iso);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return '日期未记';
  if(precision==='year')return `${s.slice(0,4)} 年`;
  if(precision==='month')return `${s.slice(0,4)} 年 ${Number(s.slice(5,7))} 月`;
  return `${s.slice(0,4)} 年 ${Number(s.slice(5,7))} 月 ${Number(s.slice(8,10))} 日`;
}
export function isValidTravelRating(value) {
  return value===null || (typeof value==='number' && Number.isFinite(value) && value>=.5 && value<=10 && Math.abs(value*10-Math.round(value*10))<1e-7);
}
export function normalizeTravelRecord(input) {
  const status=input?.status==='want'?'want':'done';
  const rating=status==='want'||input?.rating===''||input?.rating==null ? null:Number(input.rating);
  if(!isValidTravelRating(rating))throw Error('评分必须为 0.5～10.0 的一位小数');
  const note=String(input?.note??'').trim();
  if(note.length>2000)throw Error('旅行感想不能超过 2000 字');
  const date=status==='want' ? {visited_on:null,visit_date_precision:null} :
    normalizeTravelDate(input?.precision,input?.year,input?.month,input?.day);
  return {status,rating,note,visibility:input?.visibility==='circle'?'circle':'private',...date};
}
export function buildTravelArchive(records,places,options={}) {
  const placeMap=new Map(places.filter(x=>x?.category==='place').map(x=>[x.id,x]));
  const joined=records.filter(r=>placeMap.has(r.item_id)).map(r=>({...r,place:placeMap.get(r.item_id)}));
  const done=joined.filter(r=>r.status==='done');
  const wishes=joined.filter(r=>r.status==='want');
  const years=[...new Set(done.map(r=>r.visited_on?.slice(0,4)).filter(Boolean))].sort((a,b)=>b.localeCompare(a));
  const selectedYear=String(options.year||'all');
  const sort=['recent','oldest','rating'].includes(options.sort)?options.sort:'recent';
  const filtered=done.filter(r=>selectedYear==='all' || (selectedYear==='undated'?!r.visited_on:r.visited_on?.startsWith(selectedYear)));
  const comparator=(a,b)=>{
    if(sort==='rating'){
      const aR=a.rating==null?-Infinity:Number(a.rating),bR=b.rating==null?-Infinity:Number(b.rating);
      if(aR!==bR)return bR-aR;
    }
    const aDate=a.visited_on||'',bDate=b.visited_on||'';
    if(Boolean(aDate)!==Boolean(bDate))return aDate?-1:1;
    if(aDate!==bDate)return sort==='oldest'?aDate.localeCompare(bDate):bDate.localeCompare(aDate);
    return String(b.updated_at||'').localeCompare(String(a.updated_at||''));
  };
  filtered.sort(comparator);
  wishes.sort((a,b)=>String(b.updated_at||'').localeCompare(String(a.updated_at||'')));
  return {done,wishes,years,filtered,wishList:wishes,yearCount:years.length,
    geoReady:joined.filter(r=>r.status==='done'&&r.place.place_latitude!=null&&r.place.place_longitude!=null).length};
}
export function groupArchiveByYear(records) {
  const groups=[];
  for(const r of records){const label=r.visited_on?String(r.visited_on).slice(0,4):'日期未记';
    let group=groups.find(x=>x.year===label);if(!group){group={year:label,records:[]};groups.push(group)}
    group.records.push(r);
  }
  return groups;
}
export function exactPlaceMatch(a,b) {
  if(!a||!b)return false;
  if(a.id&&b.id&&a.id===b.id)return true;
  return Boolean(a.provider&&a.provider_item_id&&a.provider===b.provider&&String(a.provider_item_id)===String(b.provider_item_id));
}
