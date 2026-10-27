/** Deterministic, bounded client-side pagination for the shared catalog. */
export function paginate(items,page=1,pageSize=10){
  const size=Number.isSafeInteger(pageSize)&&pageSize>0?Math.min(pageSize,100):10;
  const total=items.length;
  const totalPages=Math.max(1,Math.ceil(total/size));
  const requested=Number(page);
  const current=Number.isSafeInteger(requested)?Math.max(1,Math.min(totalPages,requested)):1;
  return {items:items.slice((current-1)*size,current*size),page:current,pageSize:size,total,totalPages,hasPrevious:current>1,hasNext:current<totalPages};
}
