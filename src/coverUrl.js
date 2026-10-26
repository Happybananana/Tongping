/**
 * 将 Bangumi 的封面 URL 转成同频同域名图片 API，避免浏览器直连 lain.bgm.tv。
 * 其他 HTTPS 图片沿用现有行为；HTTP 非 Bangumi 链接仍然拒绝。
 */
const BGM_PATH = /^\/(?:r\/(?:100|200|400|600)\/)?pic\/cover\/[lcmsg]\/[a-z0-9]{2}\/[a-z0-9]{2}\/[a-z0-9_-]+\.(?:jpe?g|png|webp)$/i;
export function coverImageUrl(value) {
  try {
    const u = new URL(String(value || '').trim());
    if (u.hostname.toLowerCase() === 'lain.bgm.tv' && !u.port && (u.protocol === 'http:' || u.protocol === 'https:')) {
      return BGM_PATH.test(u.pathname) ? `/api/cover?path=${encodeURIComponent(u.pathname)}` : '';
    }
    return u.protocol === 'https:' ? u.href : '';
  } catch { return ''; }
}
