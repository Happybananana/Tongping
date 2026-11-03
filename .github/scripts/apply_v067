#!/usr/bin/env python3
# 同频 V0.6.7 仅运行在 GitHub Actions 中，用户无需安装或执行脚本。
# 从现有 V0.6.6 源代码直接升级并提交完整修改后的文件。
import json
import sys
from pathlib import Path

RELEASE = "0.6.7"

def once(content: str, old: str, new: str, where: str) -> str:
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f'{where}: 预期找到 1 处匹配，实际找到 {count} 处；要求 V0.6.6 基线。')
    return content.replace(old,new,1)

def new_content(repo: Path) -> dict[str, str]:
    def read(path: str) -> str:
        file = repo / path
        if not file.is_file():
            raise RuntimeError(f'缺少源码文件：{path}')
        return file.read_text(encoding='utf-8')

    changes: dict[str, str] = {}
    main = read('src/main.js')
    main = once(main,
        'import "./v066-collection-export.css";',
        'import "./v066-collection-export.css";\nimport "./v067-poster-score.css";',
        'src/main.js CSS 引入')
    main = once(main,
        'import {posterScoreTone,evaluateImportMatch} from "./importLookup.js";',
        'import {posterScoreTone,posterScoreTier,posterScoreLabel,evaluateImportMatch} from "./importLookup.js";\nimport {isValidPersonalRating} from "./scoreBands.js";',
        'src/main.js 模块引入')
    main = once(main,
        "const isRated = rec => typeof rec.rating === 'number' && Number.isFinite(rec.rating) && rec.rating>=0.5 && rec.rating<=10;",
        "const isRated = rec => isValidPersonalRating(rec?.rating);",
        'src/main.js 评分判断')
    main = once(main,
        'class="poster-score score-${posterScoreTone(r.rating)}" title="我的评分 ${r.rating.toFixed(1)} / 10"',
        'class="poster-score score-${posterScoreTone(r.rating)} score-tier-${posterScoreTier(r.rating)}" title="我的评分 ${r.rating.toFixed(1)} / 10 · ${posterScoreLabel(r.rating)}"',
        'src/main.js 海报墙牌')
    main = once(main,
        '个人评分采用分色方框：8–10 绿 / 6–7.5 黄 / 0.5–5.5 红；与 Bangumi 和圈内分数独立。',
        '个人评分采用六档分色牌：低于 7 红 / 7–不足 8 黄 / 8–10 绿（再分四档）；与 Bangumi 和圈内分数独立。',
        'src/main.js 颜色说明')
    main = once(main,
        '<span><i class="g"></i>8–10 推荐</span><span><i class="y"></i>6–7.5 尚可</span><span><i class="r"></i>0.5–5.5 不太喜欢</span>',
        '<span><i class="r"></i>低于 7.0</span><span><i class="y"></i>7.0–7.9</span><span><i class="g"></i>8.0–10.0 · 四级绿色</span>',
        'src/main.js 图例')
    main = once(main,
        'placeholder="暂不评分" step="0.5" min="0.5" max="10"',
        'placeholder="暂不评分" step="0.1" min="0.5" max="10"',
        'src/main.js 评分输入框')
    main = once(main,
        "if(rating!==null&&(!Number.isFinite(rating)||rating<.5||rating>10||rating*2!==Math.round(rating*2)))throw Error('评分需要在 0.5～10 之间，步长为 0.5');",
        "if(rating!==null&&!isValidPersonalRating(rating))throw Error('评分需要在 0.5～10 之间，步长为 0.1');",
        'src/main.js 保存评分校验')
    main = once(main,
        'if(rating!==null&&(!Number.isFinite(rating)||rating<0.5||rating>10||rating*2!==Math.round(rating*2))){skipped++;continue}',
        'if(rating!==null&&!isValidPersonalRating(rating)){skipped++;continue}',
        'src/main.js JSON 备份恢复校验')
    changes['src/main.js'] = main

    lookup = read('src/importLookup.js')
    lookup = once(lookup,
        "import {normalizedName} from './sheetImport.js';",
        "import {normalizedName} from './sheetImport.js';\nexport {posterScoreTone,posterScoreTier,posterScoreLabel} from './scoreBands.js';",
        'src/importLookup.js 导出评分映射')
    lookup = once(lookup,
        "export function posterScoreTone(score){\n  const value=Number(score);\n  if(!Number.isFinite(value)||value<0.5||value>10)return 'unrated';\n  return value>=8?'positive':value>=6?'mixed':'negative';\n}\n",
        '', 'src/importLookup.js 旧三档颜色逻辑')
    changes['src/importLookup.js'] = lookup

    sheet = read('src/sheetImport.js')
    sheet = once(sheet,
        '// Browser-safe spreadsheet import: no network calls while parsing, no formula evaluation.',
        "import {isValidPersonalRating} from './scoreBands.js';\n// Browser-safe spreadsheet import: no network calls while parsing, no formula evaluation.",
        'src/sheetImport.js 引入评分校验')
    sheet = once(sheet,
        "if(!Number.isFinite(n)||n<0.5||n>10||Math.abs(n*2-Math.round(n*2))>.00001)throw Error('评分须为 0.5～10，步长 0.5');",
        "if(!isValidPersonalRating(n))throw Error('评分须为 0.5～10，步长 0.1');",
        'src/sheetImport.js 导入评分校验')
    changes['src/sheetImport.js'] = sheet

    itest = read('src/importLookup.test.mjs')
    itest = once(itest,
        "[[10,'positive'],[8,'positive'],[7.5,'mixed'],[6,'mixed'],[5.5,'negative'],[.5,'negative'],[null,'unrated'],['abc','unrated']]",
        "[[10,'positive'],[8,'positive'],[7.5,'mixed'],[7,'mixed'],[6.9,'negative'],[6,'negative'],[5.5,'negative'],[.5,'negative'],[null,'unrated'],['abc','unrated']]",
        'src/importLookup.test.mjs 原三档测试')
    changes['src/importLookup.test.mjs'] = itest

    stest = read('src/sheetImport.test.mjs')
    stest = once(stest,
        "test('reject invalid fractional rating',()=>{assert.throws(()=>validateScore(8.3));assert.equal(validateScore(''),null);assert.equal(validateScore(0.5),0.5)});",
        "test('allow one decimal but reject two or more decimals',()=>{assert.equal(validateScore(8.3),8.3);assert.equal(validateScore(7.6),7.6);assert.equal(validateScore(9.7),9.7);assert.throws(()=>validateScore(8.35));assert.throws(()=>validateScore(0));assert.equal(validateScore(''),null);assert.equal(validateScore(0.5),0.5)});",
        'src/sheetImport.test.mjs 小数精度测试')
    stest = once(stest,
        "test('invalid rows flagged without aborting all',()=>{const x=parseImportRows([['Title','Rating'],['A',8.3],['B',9]]);assert.ok(x.rows[0].error);assert.equal(x.rows[1].rating,9)});",
        "test('invalid rows flagged without aborting all',()=>{const x=parseImportRows([['Title','Rating'],['A',8.35],['B',7.6],['C',9]]);assert.ok(x.rows[0].error);assert.equal(x.rows[1].rating,7.6);assert.equal(x.rows[2].rating,9)});",
        'src/sheetImport.test.mjs 错误行测试')
    changes['src/sheetImport.test.mjs'] = stest

    etest = read('src/collectionExport.test.mjs')
    if 'export preserves 0.1-increment decimal ratings' in etest:
        raise RuntimeError('src/collectionExport.test.mjs: 测试已存在，不重复运行升级')
    etest += """

test('export preserves 0.1-increment decimal ratings through CSV import',()=>{
  const rows=buildCollectionExportRows({items:[{id:'x',category:'game',name:'示例游戏'}],
    records:[{userId:'me',itemId:'x',rating:7.6,status:'done',note:'',updatedAt:'2026-11-03'}],userId:'me'});
  assert.equal(rows[0][2],7.6);
  const imported=parseImportRows(parseCsv(collectionToCsv(rows)));
  assert.equal(imported.rows[0].rating,7.6);
});
"""
    changes['src/collectionExport.test.mjs'] = etest

    schema = read('supabase/schema.sql')
    schema = once(schema,
        'rating numeric(3,1) check (rating is null or (rating between 0.5 and 10 and rating*2=trunc(rating*2))),',
        'rating numeric(3,1) check (rating is null or (rating between 0.5 and 10 and rating*10=trunc(rating*10))),',
        'supabase/schema.sql 新数据库默认约束')
    changes['supabase/schema.sql'] = schema

    html = read('index.html')
    html = once(html, 'PLAYING NOW · 0.6.6', 'PLAYING NOW · 0.6.7', 'index.html 版本标记')
    changes['index.html'] = html

    pkg = json.loads(read('package.json'))
    if pkg.get('version') != '0.6.6':
        raise RuntimeError('package.json 的版本不是 0.6.6')
    pkg['version'] = RELEASE
    test_command = pkg.get('scripts', {}).get('test:features', '')
    if 'src/scoreBands.test.mjs' in test_command:
        raise RuntimeError('package.json 已包含 V0.6.7 测试')
    pkg['scripts']['test:features'] += ' src/scoreBands.test.mjs'
    changes['package.json'] = json.dumps(pkg, ensure_ascii=False, indent=2) + '\n'

    for name in [
        'src/scoreBands.js', 'src/scoreBands.test.mjs', 'src/v067-poster-score.css',
        'supabase/migration_v067.sql', 'docs/FEATURES_V067.md', 'README.md'
    ]:
        if not (repo / name).is_file():
            raise RuntimeError(f'缺少升级包文件：{name}。请把 ZIP 内所有文件拖入 GitHub 仓库根目录')
        # 这些文件已由用户拖入 GitHub，自动升级只需修改原有源码。

    changes['PATCH_INSTRUCTIONS.txt'] = (
        '同频 V0.6.7：从 V0.6.6 升级。先在已有 Supabase 数据库执行 '
        'supabase/migration_v067.sql，然后覆盖同路径源码并运行测试构建。'
        '本版本将评分步长改为 0.1；不要重跑 schema.sql。\n'
    )
    changes['UPGRADE.txt'] = (
        '同频 V0.6.7：海报墙六档评分牌、个人评分步长 0.1。'
        '先运行 supabase/migration_v067.sql，再更新源码；无需新增环境变量。\n'
    )
    return changes



def main():
    repo=Path(__file__).resolve().parents[2]
    package=json.loads((repo/'package.json').read_text(encoding='utf-8'))
    if package.get('version') == '0.6.7':
        print('项目已是 V0.6.7，无需重复升级。')
        return 0
    if package.get('version') != '0.6.6':
        print('升级拒绝：预期基线是 V0.6.6，当前为 '+str(package.get('version')),file=sys.stderr)
        return 1
    changes=new_content(repo)  # 所有锚点检查完成后才写入
    for name, content in changes.items():
        target=repo/name
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_text(content,encoding='utf-8')
    print(f'已完成 V0.6.7 源码升级：{len(changes)} 个文件')
    return 0

if __name__=='__main__':
    try: sys.exit(main())
    except (OSError,ValueError,RuntimeError) as exc:
        print('升级未完成：'+str(exc),file=sys.stderr)
        sys.exit(1)
