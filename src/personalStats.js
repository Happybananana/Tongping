export function getPersonalStats(records,items){
  const itemMap=new Map(items.map(x=>[x.id,x]));
  const all=records.filter(r=>itemMap.has(r.itemId));
  const rated=all.filter(r=>Number.isFinite(r.rating)&&r.rating>=.5&&r.rating<=10);
  const statusCounts={want:0,doing:0,done:0,paused:0};const categoryCounts={anime:0,game:0,place:0};
  for(const r of all){if(r.status in statusCounts)statusCounts[r.status]++;const cat=itemMap.get(r.itemId).category;if(cat in categoryCounts)categoryCounts[cat]++;}
  const dist=[{label:'9–10',low:9,high:10},{label:'8–9',low:8,high:9},{label:'7–8',low:7,high:8},{label:'6–7',low:6,high:7},{label:'0.5–6',low:.5,high:6}].map(({label,low,high},i)=>({label,count:rated.filter(x=>i===4?x.rating>=low&&x.rating<=high:x.rating>low&&x.rating<=high).length}));
  const years=new Map();for(const r of all){const y=String(itemMap.get(r.itemId).year||'').slice(0,4);if(/^\d{4}$/.test(y))years.set(y,(years.get(y)||0)+1);}
  const yearCounts=[...years].sort((a,b)=>a[0].localeCompare(b[0])).slice(-8).map(([year,count])=>({year,count}));
  return {total:all.length,rated:rated.length,avg:rated.length?rated.reduce((n,r)=>n+r.rating,0)/rated.length:null,statusCounts,categoryCounts,distribution:dist,releaseYears:yearCounts,done:statusCounts.done,completionRate:all.length?Math.round(statusCounts.done/all.length*100):0};
}
