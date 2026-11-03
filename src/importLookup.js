// Source-agnostic match helpers. Only unambiguous exact matches can be approved automatically.
import {normalizedName} from './sheetImport.js';
export {posterScoreTone,posterScoreTier,posterScoreLabel} from './scoreBands.js';

const yearOf=value=>{const year=String(value||'').trim().slice(0,4);return /^\d{4}$/.test(year)?year:'';};
const titlesOf=value=>[value?.name,value?.subtitle].map(normalizedName).filter(Boolean);
const exactTitle=(row,item)=>titlesOf(row).some(a=>titlesOf(item).includes(a));

export function scoreImportCandidate(row,candidate){
  if(!row||!candidate||candidate.category!==row.category||!candidate.name)return -1;
  const wanted=titlesOf(row),possible=titlesOf(candidate);
  const exact=wanted.some(a=>possible.includes(a));
  const partial=wanted.some(a=>possible.some(b=>a.length>=3&&b.length>=3&&(a.includes(b)||b.includes(a))));
  if(!exact&&!partial)return -1;
  let score=exact?100:40;
  if(row.providerId&&candidate.provider==='bangumi'&&String(candidate.providerId)===String(row.providerId))score+=80;
  const year=yearOf(row.year),foundYear=yearOf(candidate.year);
  if(year&&foundYear)score+=year===foundYear?20:-25;
  if(candidate.coverUrl)score+=2;
  return score;
}
export function rankImportCandidates(row,results,max=3){
  const seen=new Set();
  return (Array.isArray(results)?results:[]).map(item=>({item,rank:scoreImportCandidate(row,item)}))
    .filter(x=>x.rank>=35)
    .sort((a,b)=>b.rank-a.rank)
    .filter(({item})=>{const key=[item.category,item.provider,item.providerId||normalizedName(item.name)].join(':');if(seen.has(key))return false;seen.add(key);return true;})
    .slice(0,max).map(x=>x.item);
}
/** Never silently guess between editions, sequels, remakes, or different sources.
 * Returns a suggested list + an explicitly marked high-confidence choice or null.
 * The caller still displays the choice and obtains final user confirmation before writing.
 */
export function evaluateImportMatch(row,results){
  const candidates=rankImportCandidates(row,results,3);
  // Keep distinct editions even when an upstream provider omitted an ID.
  const seen=new Set(),all=[];
  for(const item of Array.isArray(results)?results:[]){
    if(scoreImportCandidate(row,item)<35)continue;
    const key=[item.category,item.provider,item.providerId||normalizedName(item.name),yearOf(item.year)].join(':');
    if(seen.has(key))continue;seen.add(key);all.push(item);
  }
  const year=yearOf(row.year);
  const compatible=item=>!year||!yearOf(item.year)||year===yearOf(item.year);
  const byId=String(row.providerId||'').trim()
    ?all.filter(item=>item.provider==='bangumi'&&String(item.providerId)===String(row.providerId)&&compatible(item)) : [];
  let choice=null,reason='需确认候选作品';
  if(byId.length===1){choice=byId[0];reason='Bangumi ID 对应一致';}
  else{
    const exact=all.filter(item=>exactTitle(row,item));
    const matches=year?exact.filter(item=>yearOf(item.year)===year):exact;
    const uncertain=year&&exact.some(item=>!yearOf(item.year));
    if(!uncertain&&matches.length===1){choice=matches[0];reason=year?'标题与年份一致':'仅有一条标题完全匹配';}
    else if(exact.length>1)reason='存在多个同名版本或来源';
    else if(year&&exact.length)reason='年份不一致或缺少年份';
  }
  if(choice&&!candidates.includes(choice))candidates.splice(2,1,choice);
  return {candidates,choice,confidence:choice?'high':'review',reason};
}
