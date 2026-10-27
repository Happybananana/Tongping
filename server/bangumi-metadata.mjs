/** Bangumi v0 public metadata → Tongpin stable catalog format.
 * User's community ratings are not part of this object and never mixed into rankings.
 */
const str = (v, limit=180) => typeof v === 'string' ? v.trim().slice(0,limit) : '';
const nonnegInt = v => Number.isSafeInteger(Number(v)) && Number(v)>=0 ? Number(v) : null;
const score = v => {
  const n=Number(v);
  return v !== '' && v != null && Number.isFinite(n) && n > 0 && n <= 10 ? Math.round(n*100)/100 : null;
};
function httpsCover(raw) {
  try {
    const u=new URL(raw);
    if (!['http:','https:'].includes(u.protocol))return '';
    if (u.hostname.toLowerCase() === 'lain.bgm.tv' && !u.port) {u.protocol='https:';return u.href;}
    return u.protocol==='https:' ? u.href : '';
  } catch {return '';}
}
export function bangumiTags(subject, max=8){
  const tags=Array.isArray(subject?.tags)?subject.tags:[];
  const curated=Array.isArray(subject?.meta_tags)?subject.meta_tags:[];
  const names=[...curated.map(x=>str(x,30)), ...tags.slice().sort((a,b)=>(Number(b?.count)||0)-(Number(a?.count)||0)).map(x=>str(typeof x==='string'?x:x?.name,30))];
  return [...new Set(names.filter(Boolean))].slice(0,max);
}
export function normalizeBangumiSubject(subject,category){
  if (!subject || !Number.isSafeInteger(Number(subject.id)) || Number(subject.id)<=0) return null;
  const type=category==='anime'?2:category==='game'?4:0;
  if(!type || (subject.type != null && Number(subject.type)!==type))return null;
  const name=str(subject.name_cn || subject.name,100) || '未命名作品';
  const rating=subject.rating && typeof subject.rating==='object'?subject.rating:{};
  const rank=nonnegInt(rating.rank);
  return {
    category,provider:'bangumi',providerId:String(subject.id),name,
    subtitle:str(subject.name_cn?subject.name:'',120),
    description:str(subject.summary,500),
    coverUrl:httpsCover(subject.images?.large || subject.images?.common || subject.images?.medium || ''),
    sourceUrl:`https://bgm.tv/subject/${subject.id}`,
    year:/^\d{4}/.test(String(subject.date||''))?String(subject.date).slice(0,4):'',
    emoji:category==='anime'?'📺':'🎮',
    platform:str(subject.platform,80),
    tags:bangumiTags(subject),
    bangumiScore:score(rating.score),
    bangumiRatingTotal:nonnegInt(rating.total),
    bangumiRank:rank && rank>0 ? rank : null
  };
}
