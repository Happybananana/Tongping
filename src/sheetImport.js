import {isValidPersonalRating} from './scoreBands.js';
// Browser-safe spreadsheet import: no network calls while parsing, no formula evaluation.
export const MAX_SHEET_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 300;
export function parseCsv(text){
  const rows=[];let row=[],cell='',quoted=false;
  const str=String(text||'').replace(/^\uFEFF/,'');
  for(let i=0;i<str.length;i++){
    const c=str[i];
    if(quoted){if(c==='"'&&str[i+1]==='"'){cell+='"';i++;}else if(c==='"'){quoted=false;}else cell+=c;}
    else if(c==='"'&&cell===''){quoted=true;}
    else if(c===','){row.push(cell);cell='';}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&str[i+1]==='\n')i++;row.push(cell);if(row.some(x=>String(x).trim()))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quoted)throw Error('CSV 引号未闭合');
  row.push(cell);if(row.some(x=>String(x).trim()))rows.push(row);
  return rows;
}
const HEADER_ALIASES={
 title:['作品名','名称','番剧名','游戏名','标题','title','name','番剧','作品','游戏'],
 category:['类别','类型','分类','媒介','kind','category','type'],
 rating:['我的评分','个人评分','评分','我的分数','分数','myscore','myrating','rating','score'],
 status:['状态','进度状态','收藏状态','status','观看状态','游戏状态'],
 note:['短评','评价','评论','备注','笔记','感想','comment','note','review'],
 year:['年份','推出年份','发行年份','year','releaseyear'],
 subtitle:['别名','原名','英文名','日文名','副标题','subtitle','originaltitle'],
 providerId:['bangumiid','bgmid','subjectid','作品id','bangumi条目id']
};
const normalizeHeader=x=>String(x??'').replace(/\s|[\-_.:：/()（）]/g,'').toLowerCase();
export function guessMapping(headers){
  const norm=headers.map(normalizeHeader), mapping={};
  for(const [key,values] of Object.entries(HEADER_ALIASES)){
    const candidates=values.map(normalizeHeader);
    const index=norm.findIndex(h=>candidates.includes(h));
    mapping[key]=index;
  }
  return mapping;
}
export function normalizeCategory(raw,fallback='anime'){
  const s=String(raw??'').trim().toLowerCase();
  if(/game|游戏|电玩|pc|主机|steam|ps5|switch/.test(s))return 'game';
  if(/anime|动画|番剧|动漫|番组|animation/.test(s))return 'anime';
  return fallback==='game'?'game':'anime';
}
export function normalizeStatus(raw,category='anime'){
  const s=String(raw??'').trim().toLowerCase();
  if(/想|计划|未开始|待看|未玩|wish|want|plan/.test(s))return 'want';
  if(/正在|进行|追番|在看|在玩|游玩中|观看中|playing|watching|doing|progress/.test(s))return 'doing';
  if(/弃|搁置|暂停|放弃|paused|drop|hold/.test(s))return 'paused';
  if(/完|通关|看过|玩过|已看|已玩|完成|done|complete|finish/.test(s))return 'done';
  return 'want'; // 缺省状态不应被误判为已经看完/通关
}
export function validateScore(raw){
  if(raw==null||String(raw).trim()==='')return null;
  const n=Number(String(raw).trim());
  if(!isValidPersonalRating(n))throw Error('评分须为 0.5～10，步长 0.1');
  return n;
}
export function parseImportRows(grid,{fallbackCategory='anime',maxRows=MAX_IMPORT_ROWS}={}){
  if(!Array.isArray(grid)||grid.length<2)throw Error('至少需要标题行和一行作品数据');
  const headerRow=Math.max(0,grid.slice(0,Math.min(10,grid.length)).findIndex(line=>guessMapping((line||[]).map(x=>String(x??'').trim())).title>=0));
  const headers=(grid[headerRow]||[]).map(x=>String(x??'').trim());
  const map=guessMapping(headers);
  if(map.title<0)throw Error('未识别作品名称列。请将表头设为「作品名」「名称」或「Title」');
  if(grid.length-headerRow-1>maxRows)throw Error(`一次最多导入 ${maxRows} 行，请分批处理`);
  const rows=[];
  for(let i=headerRow+1;i<grid.length;i++){
    const cells=grid[i]||[], get=k=>map[k]<0?'':String(cells[map[k]]??'').trim();
    const name=get('title').slice(0,100);if(!name)continue;
    const category=normalizeCategory(get('category'),fallbackCategory);
    const row={line:i+1,name,category,status:normalizeStatus(get('status'),category),rating:null,note:get('note').slice(0,2000),subtitle:get('subtitle').slice(0,120),year:get('year').slice(0,8),providerId:get('providerId'),error:'',selected:true};
    try{row.rating=validateScore(get('rating'));}catch(e){row.error=e.message;row.selected=false;}
    rows.push(row);
  }
  if(!rows.length)throw Error('没有可导入的作品行');
  return {headers,mapping:map,rows};
}
export async function readSheetFile(file){
  if(!file||file.size>MAX_SHEET_BYTES)throw Error('文件不能超过 2MB');
  const name=file.name.toLowerCase();
  if(name.endsWith('.csv')){const buf=await file.arrayBuffer();let value=new TextDecoder('utf-8').decode(buf);if(value.includes('�')){try{value=new TextDecoder('gb18030').decode(buf)}catch(_){}}return parseCsv(value);}
  if(name.endsWith('.xls'))throw Error('旧版 .xls 请在 Excel 或 WPS 中另存为 .xlsx 或 .csv');
  if(!name.endsWith('.xlsx'))throw Error('仅支持 .xlsx 或 .csv');
  const {readSheet}=await import('read-excel-file/browser');
  return readSheet(file);
}
export const normalizedName=s=>String(s??'').toLocaleLowerCase().replace(/[\s:：·・\-—_「」【】\[\]()（）]/g,'');
