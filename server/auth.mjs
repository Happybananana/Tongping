/** Verify the current Supabase access token with Supabase Auth, not a decoded JWT claim. */
export async function verifySupabaseUser(jwt, {fetcher=fetch,env=process.env}={}) {
  const supabaseUrl=String(env.SUPABASE_URL||'').replace(/\/$/,'');
  const publicKey=String(env.SUPABASE_PUBLISHABLE_KEY||'');
  if(!/^https:\/\/[^/]+$/.test(supabaseUrl) || !publicKey) {
    throw Object.assign(new Error('搜索服务缺少 Supabase 验证配置'),{status:503});
  }
  if(!jwt || jwt.length>8000)throw Object.assign(new Error('请先登录后搜索'),{status:401});
  let result;
  try {
    result=await fetcher(`${supabaseUrl}/auth/v1/user`,{
      headers:{Authorization:`Bearer ${jwt}`,apikey:publicKey},
      signal:AbortSignal.timeout(7500)
    });
  } catch {
    throw Object.assign(new Error('暂时无法连接账号验证服务，请稍后重试'),{status:503});
  }
  if(result.status===401 || result.status===403)throw Object.assign(new Error('登录已过期，请重新登录'),{status:401});
  if(!result.ok)throw Object.assign(new Error('账号验证服务暂时不可用'),{status:503});
  let user;
  try{user=await result.json()}catch{throw Object.assign(new Error('账号验证响应异常'),{status:503})}
  if(!user?.id)throw Object.assign(new Error('无法识别用户'),{status:401});
  return user.id;
}
