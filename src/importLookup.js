// Source-agnostic, pure matching helpers. Suggestions are *never* approved automatically.
import {normalizedName} from './sheetImport.js';

export function posterScoreTone(score){
  const value=Number(score);
  if(!Number.isFinite(value)||value<0.5||value>10)return 'unrated';
  return value>=8?'positive':value>=6?'mixed':'negative';
}

export function scoreImportCandidate(row,candidate){
  if(!row||!candidate||candidate.category!==row.category||!candidate.name)return -1;
  const wanted=[row.name,row.subtitle].map(normalizedName).filter(Boolean);
  const possible=[candidate.name,candidate.subtitle].map(normalizedName).filter(Boolean);
  const exact=wanted.some(a=>possible.some(b=>a===b));
  const partial=wanted.some(a=>possible.some(b=>a.length>=3&&b.length>=3&&(a.includes(b)||b.includes(a))));
  if(!exact&&!partial)return -1;
  let score=exact?100:40;
  if(row.providerId&&candidate.provider==='bangumi'&&String(candidate.providerId)===String(row.providerId))score+=80;
  const year=String(row.year||'').slice(0,4),foundYear=String(candidate.year||'').slice(0,4);
  if(/^\d{4}$/.test(year)&&/^\d{4}$/.test(foundYear))score+=year===foundYear?20:-25;
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
