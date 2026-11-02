/** Only items already in the shared catalog may be linked to a post. */
export function findPostSubjects(items, term, limit=12) {
  const q=String(term??'').trim().toLocaleLowerCase().replace(/[\s:：·・\-_]/g,'');
  const clean=(s)=>String(s??'').toLocaleLowerCase().replace(/[\s:：·・\-_]/g,'');
  if (!q) return (items||[]).filter(x=>x?.category==='anime'||x?.category==='game').slice(0,limit);
  return (items||[]).filter(x=>['anime','game'].includes(x?.category)&&[x.name,x.subtitle,...(x.tags||[])].some(s=>clean(s).includes(q))).slice(0,limit);
}
