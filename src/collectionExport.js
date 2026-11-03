/**
 * Portable collection export for the user's own anime/game records.
 * No server upload and no extra runtime dependencies. The first worksheet
 * matches the existing bulk import header aliases (sheetImport.js).
 */
export const EXPORT_HEADERS = Object.freeze([
  '作品名','类别','我的评分','状态','备注','年份','别名','Bangumi ID',
  '资料来源','来源条目ID','来源链接','封面链接','记录可见性','是否剧透','最后更新'
]);

const LABELS = {
  anime: {want:'想看',doing:'观看中',done:'已看完',paused:'已搁置'},
  game: {want:'想玩',doing:'游玩中',done:'已通关',paused:'已搁置'}
};
const text = value => value == null ? '' : String(value);

export function buildCollectionExportRows({items=[],records=[],userId}={}){
  if(!userId) throw Error('导出需要已登录的当前用户');
  const itemMap=new Map(items.map(item=>[item.id,item]));
  return records.filter(record=>record.userId===userId)
    .map(record=>({record,item:itemMap.get(record.itemId)}))
    .filter(({item})=>item && (item.category==='anime'||item.category==='game'))
    .sort((a,b)=>text(b.record.updatedAt).localeCompare(text(a.record.updatedAt)))
    .map(({record,item})=>[
      text(item.name), item.category==='anime'?'动画':'游戏',
      Number.isFinite(record.rating) && record.rating>=.5 && record.rating<=10 ? record.rating : '',
      LABELS[item.category][record.status]||'想体验',text(record.note),text(item.year),
      text(item.subtitle),item.provider==='bangumi'?text(item.providerItemId):'',
      text(item.provider),text(item.providerItemId),text(item.sourceUrl),text(item.coverUrl),
      record.visibility==='private'?'仅自己可见':'圈内可见',record.spoiler?'是':'否',text(record.updatedAt)
    ]);
}

/** Read every record using pages, instead of trusting the initial shared-feed query
 * (PostgREST commonly caps that query to 1,000 rows). RLS still applies.
 */
export async function loadCollectionForExport(db,userId,{pageSize=400}={}){
  if(!db||!userId)throw Error('请先登录，再导出个人收藏');
  if(!Number.isInteger(pageSize)||pageSize<1||pageSize>1000)throw Error('无效的导出分页大小');
  const records=[];
  for(let offset=0;;offset+=pageSize){
    const {data,error}=await db.from('experiences')
      .select('user_id,item_id,rating,status,note,visibility,spoiler,updated_at,id')
      .eq('user_id',userId).order('updated_at',{ascending:false}).order('id',{ascending:true})
      .range(offset,offset+pageSize-1);
    if(error)throw Error(`读取个人记录失败：${error.message}`);
    if(!Array.isArray(data))throw Error('个人记录返回格式异常');
    records.push(...data.map(r=>({userId:r.user_id,itemId:r.item_id,rating:r.rating==null?null:Number(r.rating),status:r.status,note:r.note||'',visibility:r.visibility,spoiler:!!r.spoiler,updatedAt:r.updated_at})));
    if(data.length<pageSize)break;
    if(records.length>=20000)throw Error('导出记录超过 20,000 条，请联系维护者分批处理');
  }
  const ids=[...new Set(records.map(r=>r.itemId))];
  const items=[];
  for(let offset=0;offset<ids.length;offset+=100){
    const chunk=ids.slice(offset,offset+100);
    const {data,error}=await db.from('catalog_items')
      .select('id,category,name,subtitle,year,provider,provider_item_id,cover_url,source_url')
      .in('id',chunk);
    if(error)throw Error(`读取作品资料失败：${error.message}`);
    if(!Array.isArray(data))throw Error('作品资料返回格式异常');
    items.push(...data.map(i=>({id:i.id,category:i.category,name:i.name,subtitle:i.subtitle,year:i.year,
      provider:i.provider,providerItemId:i.provider_item_id,coverUrl:i.cover_url,sourceUrl:i.source_url})));
  }
  const known=new Set(items.map(i=>i.id));
  const missing=ids.filter(id=>!known.has(id));
  if(missing.length)throw Error(`有 ${missing.length} 个作品资料无法读取，未生成不完整的导出文件`);
  return {records,items};
}

function safeCsvCell(value){
  if(typeof value==='number' && Number.isFinite(value))return String(value);
  let cell=text(value);
  // Prevent spreadsheet formula injection when untrusted title or review text
  // is opened in Excel/WPS. Text XLSX cells are explicitly inline strings.
  if(/^[\s\x00-\x1f]*[=+\-@]/.test(cell))cell="'"+cell;
  return '"'+cell.replace(/"/g,'""')+'"';
}
export function collectionToCsv(rows){
  return '\uFEFF'+[EXPORT_HEADERS,...rows].map(row=>row.map(safeCsvCell).join(',')).join('\r\n')+'\r\n';
}

const enc = new TextEncoder();
const xmlEscape = value => text(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,'')
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
function colName(index){let n=index+1,s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)}return s}
function cellXml(value,row,col,header=false){
  const ref=colName(col)+row;
  if(typeof value==='number'&&Number.isFinite(value))return `<c r="${ref}" s="2"><v>${value}</v></c>`;
  const content=xmlEscape(value);
  return `<c r="${ref}" t="inlineStr" s="${header?1:0}"><is><t xml:space="preserve">${content}</t></is></c>`;
}
function worksheetXml(data,widths,{filter=false}={}){
  const columns=widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('');
  const lines=data.map((row,i)=>`<row r="${i+1}"${i===0?' ht="28" customHeight="1"':''}>${row.map((v,j)=>cellXml(v,i+1,j,i===0)).join('')}</row>`).join('');
  const last=`${colName(widths.length-1)}${data.length}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="19"/><cols>${columns}</cols><sheetData>${lines}</sheetData>${filter?`<autoFilter ref="A1:${last}"/>`:''}</worksheet>`;
}
const GUIDE = [
  ['同频收藏导出 · 使用说明','本表由当前登录用户的个人收藏生成，不包含好友私密记录。'],
  ['工作表「收藏数据」','包含游戏和动画收藏。第一行表头和同频「批量导入」兼容。'],
  ['重新导入同频','选择「收藏数据」作为 Excel 第一张表，上传后检查匹配候选，再确认导入。'],
  ['已有记录','同频批量导入会跳过当前用户已经存在的作品记录，不会覆盖原有评分。'],
  ['未评分作品','我的评分列留空，仍会保留收藏状态。'],
  ['可见性 / 剧透','额外信息列仅供备份参考；当前批量导入默认私人可见，剧透标记不会自动恢复。'],
  ['旅行记录','不在此 Excel / CSV 中，若要完整保存旅行数据，请使用账号中的 JSON 备份。'],
  ['其它资料','来源 ID、封面、链接仅用于参考；表格导入主要按作品名/Bangumi ID 匹配。'],
  ['文件安全','本地生成，不上传 Excel / CSV 到第三方。请妥善保管私人笔记。']
];

// Minimum standards-compliant ZIP writer (STORE method) for .xlsx; no CDN or
// third-party package. The input consists only of small generated XML parts.
const crcTable = (()=>{
  const t=new Uint32Array(256);
  for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}
  return t;
})();
function crc32(bytes){let c=0xFFFFFFFF;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0}
function u16(buf,at,v){buf[at]=v&255;buf[at+1]=(v>>>8)&255}
function u32(buf,at,v){u16(buf,at,v&65535);u16(buf,at+2,(v>>>16)&65535)}
function zipStore(parts){
  const entries=[],blocks=[];let offset=0;
  for(const [path,xml] of Object.entries(parts)){
    const name=enc.encode(path),data=enc.encode(xml),crc=crc32(data);
    const local=new Uint8Array(30+name.length);u32(local,0,0x04034b50);u16(local,4,20);
    u16(local,6,0x0800);u16(local,8,0);u32(local,14,crc);u32(local,18,data.length);u32(local,22,data.length);u16(local,26,name.length);local.set(name,30);
    blocks.push(local,data);entries.push({name,crc,size:data.length,offset});offset+=local.length+data.length;
  }
  const directory=[];let directorySize=0;
  for(const e of entries){const cen=new Uint8Array(46+e.name.length);
    u32(cen,0,0x02014b50);u16(cen,4,20);u16(cen,6,20);u16(cen,8,0x0800);
    u32(cen,16,e.crc);u32(cen,20,e.size);u32(cen,24,e.size);u16(cen,28,e.name.length);
    u32(cen,42,e.offset);cen.set(e.name,46);directory.push(cen);directorySize+=cen.length;
  }
  const end=new Uint8Array(22);u32(end,0,0x06054b50);u16(end,8,entries.length);u16(end,10,entries.length);u32(end,12,directorySize);u32(end,16,offset);
  return new Blob([...blocks,...directory,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
export function collectionToXlsx(rows){
  const widths=[34,10,12,16,48,12,30,16,16,22,38,38,16,12,28];
  const files={
    '[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="收藏数据" sheetId="1" r:id="rId1"/><sheet name="使用说明" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.0"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Aptos"/><color rgb="FF263C40"/></font><font><b/><sz val="11"/><name val="Aptos"/><color rgb="FFFFFFFF"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF284D40"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml':worksheetXml([EXPORT_HEADERS,...rows],widths,{filter:true}),
    'xl/worksheets/sheet2.xml':worksheetXml(GUIDE,[26,86])
  };
  return zipStore(files);
}
