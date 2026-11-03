/** Tongpin V0.6.11 · pure model for a single user's historical travel atlas.
 * Input records MUST be fetched under the current user's Supabase RLS with user_id filter.
 * Private records may appear only to their owner in this personal view.
 */
import {validLocation,mapPoint,chronologicallyCertainSegments} from './travelCrossingModel.js';

export function buildPersonalTravelMap(records, catalog, userId) {
  const id=typeof userId==='string'?userId:'';
  if(!id)return {participantIds:[],tracksById:{},segmentsById:{},places:[],crossings:[],unmapped:[]};
  const placesById=new Map((Array.isArray(catalog)?catalog:[])
    .filter(p=>p?.id&&p.category==='place').map(p=>[p.id,p]));
  const seen=new Set(),mapped=[],unmapped=[];
  for(const record of Array.isArray(records)?records:[]){
    if(!record||record.user_id!==id||record.status!=='done'||!record.item_id||seen.has(record.item_id))continue;
    seen.add(record.item_id);
    const place=placesById.get(record.item_id);
    if(!place)continue;
    const entry={
      traveler_id:id,item_id:place.id,place_name:place.name,place_subtitle:place.subtitle||'',
      longitude:place.place_longitude,latitude:place.place_latitude,
      coordinate_system:place.place_coordinate_system,
      visited_on:record.visited_on||null,visit_date_precision:record.visit_date_precision||null,
      status:record.status,visibility:record.visibility,rating:record.rating,
      note:record.note||'',spoiler:!!record.spoiler
    };
    if(validLocation(entry))mapped.push({...entry,point:mapPoint(entry)});
    else unmapped.push({item_id:place.id,name:place.name,subtitle:place.subtitle||''});
  }
  mapped.sort((a,b)=>{
    const aDate=a.visited_on||'',bDate=b.visited_on||'';
    return (aDate&&bDate?bDate.localeCompare(aDate):aDate?-1:bDate?1:0)||
      a.place_name.localeCompare(b.place_name,'zh-CN');
  });
  const places=mapped.map(r=>({
    item_id:r.item_id,name:r.place_name,subtitle:r.place_subtitle,
    point:r.point,visits:[r],count:1,shared:false,sameDay:false,sameYear:false
  }));
  return {
    participantIds:[id],tracksById:{[id]:mapped},segmentsById:{[id]:chronologicallyCertainSegments(mapped)},
    places,crossings:[],unmapped
  };
}
