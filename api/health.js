/** Public liveness check; does not reveal credentials or user data. */
export default function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({error:'仅支持 GET'});
  res.setHeader('Cache-Control','no-store');
  return res.status(200).json({ok:true,service:'tongpin-search-v0.4-vercel'});
}
