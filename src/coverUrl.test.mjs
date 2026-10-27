import test from 'node:test';
import assert from 'node:assert/strict';
import {coverImageUrl} from './coverUrl.js';
const path='/pic/cover/l/c2/0a/12_24O6L.jpg';
test('Bangumi HTTPS/旧版 HTTP 地址都改为同域封面 API',()=>{
  assert.equal(coverImageUrl('https://lain.bgm.tv'+path),'/api/cover?path='+encodeURIComponent(path));
  assert.equal(coverImageUrl('http://lain.bgm.tv'+path+'?r=1409'),'/api/cover?path='+encodeURIComponent(path));
});
test('兼容 Bangumi 缩略图路径',()=>{
  const img='/r/400/pic/cover/l/9d/d1/245665_5an54.jpg';
  assert.equal(coverImageUrl('https://lain.bgm.tv'+img),'/api/cover?path='+encodeURIComponent(img));
});
test('拒绝不允许的 Bangumi 路径与非 Bangumi HTTP',()=>{
  assert.equal(coverImageUrl('https://lain.bgm.tv/private/foo.jpg'),'');
  assert.equal(coverImageUrl('http://other.example/foo.jpg'),'');
});
test('IGDB 等已知国外图床统一走同域安全图片网关',()=>{
  const img='https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg';
  assert.equal(coverImageUrl(img),'/api/media?provider=igdb&path='+encodeURIComponent('/igdb/image/upload/t_cover_big/abc.jpg'));
});

test('旧版内置四部动画的 Bangumi 封面自动改为服务端代理',()=>{
 for(const id of ['400602','10380','183878','1428'])assert.equal(coverImageUrl(`https://api.bgm.tv/v0/subjects/${id}/image?type=large`),`/api/cover?subject=${id}`);
});
test('MAL、RAWG 和 Steam 封面均改为同域图片代理',()=>{
 assert.equal(coverImageUrl('https://cdn.myanimelist.net/images/anime/100/12345.jpg'),'/api/media?provider=mal&path='+encodeURIComponent('/images/anime/100/12345.jpg'));
 assert.equal(coverImageUrl('https://media.rawg.io/media/games/aa/abc.jpg'),'/api/media?provider=rawg&path='+encodeURIComponent('/media/games/aa/abc.jpg'));
 assert.equal(coverImageUrl('https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1245620/library_600x900.jpg'),'/api/media?provider=steam&path='+encodeURIComponent('/store_item_assets/steam/apps/1245620/library_600x900.jpg'));
});
