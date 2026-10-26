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
test('保持 IGDB 等其他 HTTPS 图片路径不变',()=>{
  const img='https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg';
  assert.equal(coverImageUrl(img),img);
});
