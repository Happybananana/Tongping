/**
 * Import selection is intentionally separate from lookup scheduling.
 * Searching a row never constitutes consent to import it.
 */
export const hasConfirmedImportItem = row => Boolean(row?.match || row?.remoteChoice);

export function canSelectImportRow(row,{allowManualCreation=false}={}){
  return Boolean(row && !row.error && (hasConfirmedImportItem(row) || allowManualCreation));
}

/** Only the three explicitly trusted categories default to checked. */
export function shouldDefaultSelectImportRow(row){
  return Boolean(row && !row.error && (
    row.match || (row.remoteChoice && (row.autoChosen || row.manualConfirmed))
  ));
}

/** Initialize one parsed spreadsheet row without changing parser semantics. */
export function prepareImportRow(row){
  row.selectionTouched=false;
  row.manualConfirmed=false;
  row.selected=shouldDefaultSelectImportRow(row);
  return row;
}

/** Lookup can finish after a user explicitly changes the checkbox. */
export function applyImportDecision(row,decision){
  row.suggestions=Array.isArray(decision.candidates)?decision.candidates:[];
  row.remoteChoice=decision.choice||null;
  row.autoChosen=!!decision.choice;
  row.manualConfirmed=false;
  row.matchReason=decision.reason||'';
  row.lookupState='done';
  if(!row.selectionTouched)row.selected=shouldDefaultSelectImportRow(row);
  return row;
}

export function confirmImportCandidate(row,candidate){
  if(!row || !candidate || !row.suggestions?.includes(candidate))return false;
  row.remoteChoice=candidate;
  row.autoChosen=false;
  row.manualConfirmed=true;
  row.selected=true;
  row.selectionTouched=false;
  return true;
}

export function clearImportCandidate(row){
  if(!row)return;
  row.remoteChoice=null;
  row.autoChosen=false;
  row.manualConfirmed=false;
  row.selected=false;
  row.selectionTouched=false;
}

/** Explicitly opting in to manual creation is separate from the default. */
export function toggleImportRow(row,checked,{allowManualCreation=false}={}){
  if(!canSelectImportRow(row,{allowManualCreation})){
    if(row)row.selected=false;
    return false;
  }
  row.selected=Boolean(checked);
  row.selectionTouched=true;
  return true;
}

export function getImportLookupJobs(rows){
  return (Array.isArray(rows)?rows:[])
    .map((row,i)=>row && !row.error && !row.match && row.lookupState==='queued'?i:-1)
    .filter(i=>i>=0);
}

export function getImportSelectionSummary(rows){
  const values=Array.isArray(rows)?rows:[];
  const selected=values.filter(row=>row.selected && !row.error);
  const eligible=values.filter(row=>!row.error && !row.match);
  return {
    total:values.length,
    selected:selected.length,
    local:selected.filter(row=>row.match).length,
    auto:selected.filter(row=>row.remoteChoice && row.autoChosen).length,
    reviewed:selected.filter(row=>row.remoteChoice && !row.autoChosen && row.manualConfirmed).length,
    manual:selected.filter(row=>!hasConfirmedImportItem(row)).length,
    pendingReview:eligible.filter(row=>row.lookupState==='done' && !row.remoteChoice && row.suggestions?.length).length,
    noResults:eligible.filter(row=>row.lookupState==='done' && !row.remoteChoice && !row.suggestions?.length).length,
    failed:eligible.filter(row=>row.lookupState==='error').length,
    finished:eligible.filter(row=>['done','error'].includes(row.lookupState)).length,
    searchTotal:eligible.length,
    pending:eligible.filter(row=>row.lookupState==='queued').length
  };
}

/** Review filter is independent from whether an item will be imported. */
export function importReviewBucket(row){
  if(!row || row.error)return 'invalid';
  if(row.match || row.remoteChoice)return 'matched';
  if(row.lookupState==='done')return row.suggestions?.length?'review':'missing';
  if(row.lookupState==='error')return 'missing';
  return 'searching';
}
export function orderedImportRowIndices(rows){
  const weight={review:0,searching:1,matched:2,missing:3,invalid:4};
  return (rows||[]).map((row,i)=>({i,rank:weight[importReviewBucket(row)]??5}))
    .sort((a,b)=>a.rank-b.rank||a.i-b.i).map(x=>x.i);
}
