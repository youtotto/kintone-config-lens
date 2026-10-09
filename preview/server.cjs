// Local visual fixture only. No connection to kintone; the shipped script executes unmodified.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { responseFor } = require('../tests/fixtures.cjs');
const field = (code, label, extra = {}) => ({ type: 'SINGLE_LINE_TEXT', code, label, noLabel: false, required: false, defaultValue: '', ...extra });
const live = { Subject: field('Subject', '件名'), Status: field('Status', '対応状況', { type: 'DROP_DOWN', options: { 未着手: { label: '未着手', index: '0' }, 完了: { label: '完了', index: '1' } } }), OldMemo: field('OldMemo', '旧メモ'), Owner: field('Owner', '担当者') };
const preview = { Subject: field('Subject', '案件名', { required: true, defaultValue: '未入力' }), Status: field('Status', '対応状況', { type: 'DROP_DOWN', options: { 未着手: { label: '未着手', index: '0' }, 進行中: { label: '進行中', index: '1' }, 完了: { label: '完了', index: '2' } } }), Deadline: field('Deadline', '対応期限', { type: 'DATE' }), Owner: field('Owner', '担当者') };
for (const properties of [live, preview]) {
  properties.Customer = field('Customer', '顧客コード', { lookup: { relatedApp: { app: '101', code: 'CUSTOMERS' }, relatedKeyField: 'CustomerCode', fieldMappings: [{ relatedField: 'Name', field: 'ClientName' }], lookupPickerFields: ['CustomerCode', 'Name'], filterCond: 'Active in ("有効")', sort: 'CustomerCode asc' } });
  properties.ClientName = field('ClientName', '顧客名');
  properties.Total = field('Total', '合計金額', { type: 'CALC', expression: 'SUM(Quantity) * 1000' });
  properties.Orders = field('Orders', '関連する受注', { type: 'REFERENCE_TABLE', referenceTable: { relatedApp: { app: '102', code: 'ORDERS' }, condition: { field: 'Customer', relatedField: 'CustomerCode' }, displayFields: ['OrderDate', 'Title', 'Amount'], filterCond: '', sort: 'OrderDate desc', size: '5' } });
  properties.Details = field('Details', '明細', { type: 'SUBTABLE', fields: { Item: field('Item', '品名'), Quantity: field('Quantity', '数量', { type: 'NUMBER' }) } });
  properties.Contact = field('Contact', '連絡先', { type: 'GROUP' });
}
const box = (code, width, type = 'SINGLE_LINE_TEXT') => ({ code, type, size: { width: String(width) } });
const row = (...fields) => ({ type: 'ROW', fields });
const formLayout = previewSide => [
  row({ type: 'LABEL', label: previewSide ? '<b>案件情報・更新後</b>' : '<b>案件情報</b>', elementId: 'heading', size: { width: '440' } }),
  row({ type: 'SPACER', elementId: 'customer_area', size: { width: '260', height: '100' } }, { type: 'HR', elementId: 'section_line', size: { width: '260' } }),
  row(box('Customer', 240), box('ClientName', 240)),
  row(box('Total', 240, 'CALC'), box('Orders', 360, 'REFERENCE_TABLE')),
  row(box('Subject', previewSide ? 300 : 220), box('Status', 180, 'DROP_DOWN')),
  row(box(previewSide ? 'Deadline' : 'OldMemo', 220, previewSide ? 'DATE' : 'SINGLE_LINE_TEXT')),
  { type: 'SUBTABLE', code: 'Details', fields: previewSide ? [box('Quantity', 140, 'NUMBER'), box('Item', 280)] : [box('Item', 240), box('Quantity', 140, 'NUMBER')] },
  { type: 'GROUP', code: 'Contact', layout: [row(box('Owner', 240), { type: 'SPACER', elementId: 'space', size: { width: previewSide ? '180' : '100', height: '70' } })] }
];
const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>kintone Config Lens — 動作プレビュー</title><style>
body{margin:0;background:#f3f5f8;color:#26364b;font:14px/1.6 "Segoe UI",sans-serif}header{padding:18px 30px;background:#263e5d;color:white}main{max-width:1100px;margin:25px auto}h1{font-size:24px}nav{padding:12px 20px;background:white;border-bottom:3px solid #3975d6}nav button{border:0;background:white;color:#205cae;font:inherit}.save{padding:15px}button{cursor:pointer}.save button{padding:8px 24px;background:#3772d1;border:0;color:white;border-radius:4px}.workspace{display:flex;background:white;margin:0 16px;border:1px solid #d5dfeb;min-height:420px}.palette{width:150px;padding:20px;background:#f6f8fb;border-right:1px solid #d5dfeb;color:#687b94}.palette div{padding:10px;margin:10px 0;background:white;border:1px solid #dbe3ed}.form{padding:30px;display:grid;grid-template-columns:1fr 1fr;gap:25px;width:700px;align-content:start}.field{border:1px dashed #b8c9dc;padding:12px;min-height:85px}.field label{display:block;font-weight:600}.input{border:1px solid #d6dfe9;height:32px;margin-top:10px;background:#fcfdff}.caption{color:#63758d;font-size:12px}
</style><header>Nest Rec / kintone Config Lens <span style="float:right">ローカルデモ・架空データ</span></header><main><p class="caption">検証用アプリ / アプリの設定</p><h1>案件管理 — フォーム設定</h1><nav><button role="tab" id="form" aria-selected="true">フォーム</button></nav><section><div class="save"><button data-testid="formSaveButton">フォームを保存</button></div><div class="workspace"><aside class="palette">フィールドを追加<div>文字列（1行）</div><div>数値</div><div>日付</div><div>ドロップダウン</div></aside><div class="form">${require('../kintoneConfigLens.user.js').layoutParts(formLayout(true)).filter(p=>p.code!=='space').map(p=>`<div class="field" data-testid="field-${p.code}"><div role="button" data-testid="fieldMovable"><div data-testid="${({LABEL:'label',SPACER:'spacer',HR:'hr'})[p.node.type]}-${p.code}">${p.settings.label}${p.node.type==='HR'?'<hr>':''}</div></div></div>`).join('')}${Object.values(preview).sort((a,b) => ['Customer','ClientName','Total','Orders'].includes(a.code) ? (['Customer','ClientName','Total','Orders'].includes(b.code) ? ['Customer','ClientName','Total','Orders'].indexOf(a.code)-['Customer','ClientName','Total','Orders'].indexOf(b.code) : -1) : ['Customer','ClientName','Total','Orders'].includes(b.code) ? 1 : 0).map(f=>`<div class="field" data-testid="field-${f.code}"><div role="button" data-testid="fieldMovable"><div data-testid="fieldContentArea"><label id="field-label-${f.code}">${f.label}</label><div class="input"></div></div></div></div>`).join('')}</div></div></section><p class="caption">実際のフォームで確認した data-testid / フィールドコード構造を使用。API応答はこのサーバーの架空データです。</p></main><script src="/kintoneConfigLens.user.js"></script></html>`;
const narrowCodes = ['見積金額_税抜_表示用', '見積金額_税込_表示用', '予算金額_計算結果_コピー'];
const narrowWidths = [100, 150, 220];
const narrowProperties = Object.fromEntries(narrowCodes.map((code, index) => [code, field(code, ['税抜金額', '税込金額', '予算金額'][index], { type: 'CALC', expression: '1000 * 1.1' })]));
const narrowHtml = html.replace(/<div class="form">[\s\S]*?<\/div><\/div><\/section>/,
  `<div class="form" style="display:flex;flex-wrap:wrap;gap:24px;align-items:start">${narrowCodes.map((code, index) => `<div class="field" style="width:${narrowWidths[index]}px" data-testid="field-${code}"><div role="button" data-testid="fieldMovable"><label>${narrowProperties[code].label}</label><div class="input">自動計算</div></div></div>`).join('')}</div></div></section>`);
// Reproduce native bottom padding and table wrappers whose 100% height can push a sibling footer outside a cell.
const footerProperties = {
  DateRenamed: field('DateRenamed', '日付', { type: 'DATE' }),
  Amount: field('Amount', '金額', { type: 'CALC', expression: '1000 * 1.1' }),
  Details: field('Details', 'テーブル', { type: 'SUBTABLE', fields: {
    Attachment: field('Attachment', '添付ファイル', { type: 'FILE' }),
    Check: field('Check', 'チェックボックス', { type: 'CHECK_BOX' }),
    Choice: field('Choice', 'ドロップダウン', { type: 'DROP_DOWN' }),
    TableTextWithLongFieldCode: field('TableTextWithLongFieldCode', '文字列（1行）')
  } }),
  Subject: field('Subject', '案件名')
};
const footerWidths = [200, 220, 170, 180];
const footerLayout = [row(box('DateRenamed', 120, 'DATE'), box('Amount', 120, 'CALC')),
  { type: 'SUBTABLE', code: 'Details', fields: Object.values(footerProperties.Details.fields).map((f, i) => box(f.code, footerWidths[i], f.type)) },
  row(box('Subject', 193))];
const footerField = (code, width, value, inTable = false) => `<div class="${inTable ? 'footer-table-field' : ''}" data-testid="field-${code}" style="width:${width}px"><div role="button" data-testid="fieldMovable"><div data-testid="fieldContentArea" style="width:${width}px"><div style="box-sizing:border-box;padding:8px">${inTable ? '' : `<label>${footerProperties[code].label}</label>`}<div class="input" style="box-sizing:border-box;height:${code === 'Check' ? 48 : 40}px;padding:6px;white-space:nowrap;margin-top:${inTable ? 0 : 8}px">${value}</div></div></div></div></div>`;
const footerHtml = html.replace(/<div class="form">[\s\S]*?<\/div><\/div><\/section>/,
  `<div class="form" style="display:flex;flex-direction:column;gap:24px;width:auto;min-width:0;padding:20px">
    <div style="display:flex;align-items:start;gap:16px">${footerField('DateRenamed', 120, '2026-10-09')}${footerField('Amount', 120, '自動計算')}</div>
    <div data-testid="field-Details" style="width:max-content"><div class="native-table"><label style="display:block;margin-bottom:10px">テーブル</label><table style="border-collapse:collapse;table-layout:fixed;height:1px"><thead><tr>${Object.values(footerProperties.Details.fields).map(f => `<th style="text-align:left;font-weight:normal;border:1px solid #bcc5ce;padding:4px 8px;background:#eee">${f.label}</th>`).join('')}</tr></thead><tbody><tr>${Object.keys(footerProperties.Details.fields).map((code, i) => `<td style="padding:0;border:1px solid #bcc5ce;vertical-align:top;height:100%">${footerField(code, footerWidths[i], ['ファイルを選択', '□ sample1　□ sample2', '-----　⌄', '検証用'][i], true)}</td>`).join('')}</tr></tbody></table></div></div>
    <div style="display:flex">${footerField('Subject', 193, 'テーブルの次のフィールド')}</div>
  </div></div></section>`).replace('</style>', `.footer-table-field{height:100%}.footer-table-field>[data-testid="fieldMovable"]{height:100%;display:flex;align-items:flex-start;position:relative}body{padding-bottom:600px}</style>`);
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  if (url.pathname === '/k/admin/app/flow' && url.searchParams.get('collections') === '1') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fs.readFileSync(path.join(__dirname, 'collections.html'))); return; }
  if (url.pathname === '/kintoneConfigLens.user.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(fs.readFileSync(path.join(__dirname, '..', 'kintoneConfigLens.user.js'))); return; }
  if (url.pathname.startsWith('/k/v1/')) {
    res.setHeader('Content-Type', 'application/json');
    try {
      const data = responseFor(url.href);
      if (data.properties) data.properties = url.searchParams.get('app') === '3' ? footerProperties : url.searchParams.get('app') === '2' ? narrowProperties : url.pathname.includes('/preview/') ? preview : live;
      if (data.properties && url.searchParams.get('app') === '3' && !url.pathname.includes('/preview/')) {
        data.properties = structuredClone(data.properties);
        delete data.properties.Details.fields.Attachment;
        data.properties.Details.fields.Choice.required = true;
      }
      if (data.layout) data.layout = url.searchParams.get('app') === '3' ? footerLayout : url.searchParams.get('app') === '2' ? [row(...narrowCodes.map((code, index) => box(code, narrowWidths[index], 'CALC')))] : formLayout(url.pathname.includes('/preview/'));
      res.end(JSON.stringify(data));
    } catch { res.writeHead(404); res.end(JSON.stringify({ code: 'NOT_FOUND' })); }
    return;
  }
  if (url.pathname === '/k/admin/app/flow' && url.searchParams.get('menu') === '1') {
    const { menuFixture } = require('../tests/menu-fixture.cjs');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="ja"><meta charset="utf-8"><title>設定メニュー差分 — ローカル検証</title><style>
      body{margin:0;background:#fff;color:#26364b;font:14px/1.6 "Segoe UI",sans-serif}header{padding:18px 30px;background:#263e5d;color:white}main{max-width:1240px;margin:20px auto}nav{padding:10px 20px;border-bottom:2px solid #3975d6}nav button{font:inherit;padding:8px 30px;border:0;background:white;color:#205cae}nav button[aria-selected=true]{background:#edf5ff}.demo-settings{display:grid;grid-template-rows:auto auto auto;grid-auto-flow:column;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:16px}.demo-settings section{background:#f7f7f7;border-radius:8px;padding:12px 18px}.demo-settings h3{font-size:16px;font-weight:normal;margin:0 0 8px}.demo-settings a{display:flex;align-items:center;padding:4px 12px;color:#0670d8;text-decoration:none}.demo-settings a:hover{background:#d9ebfc}
      </style><header>Nest Rec / 設定メニュー差分 <span style="float:right">ローカルデモ・架空データ</span></header><main>${menuFixture('1')}</main><script src="/kintoneConfigLens.user.js"></script></html>`); return;
  }
  if (url.pathname === '/k/admin/app/flow') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(url.searchParams.get('app') === '3' ? (url.searchParams.get('compact') === '1' ? footerHtml.replace('padding-bottom:600px', 'padding-bottom:300px') : footerHtml) : url.searchParams.get('app') === '2' ? narrowHtml : html); return; }
  const { adminContext, ADMIN_GROUPS } = require('../kintoneConfigLens.user.js');
  const admin = adminContext(url.href);
  if (admin && admin.page !== 'flow') {
    const label = ADMIN_GROUPS.flatMap(g => g.pages).find(([id]) => id === admin.page)[1];
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="ja"><meta charset="utf-8"><title>${label} — ローカル検証</title><style>body{margin:0;background:#f3f5f8;color:#26364b;font:14px/1.6 "Segoe UI",sans-serif}header{padding:18px 30px;background:#263e5d;color:white}main{max-width:1100px;margin:25px auto}.demo-content{background:white;padding:28px 32px;margin:16px;border:1px solid #d5dfeb}h1{font-size:24px}input{display:block;padding:8px;margin:10px 0;border:1px solid #bccada}p{color:#63758d}</style><header>Nest Rec / 設定画面ナビゲーション <span style="float:right">ローカルデモ・架空データ</span></header><main><div class="demo-content"><p>検証用アプリ / アプリの設定</p><h1>${label}</h1><label>入力中のショートカット確認<input aria-label="検証用入力欄" value="編集中はAlt＋数字で移動しません"></label><p>上のリンクまたはAlt＋数字で、同じアプリの設定ページを切り替えられます。</p><p>以下はローカル遷移の検証用です。設定保存の通信は行いません。</p><button type="button" data-testid="shared-admin-pageActionBar-CancelButton" onclick="location.href='/k/admin/app/flow?app=${admin.app}&menu=1#section=settings'">キャンセル</button> <button type="button" data-testid="shared-admin-pageActionBar-SaveButton" onclick="location.href='/k/admin/app/flow?app=${admin.app}&menu=1#section=settings'">保存</button></div></main><script src="/kintoneConfigLens.user.js"></script></html>`); return;
  }
  res.writeHead(404); res.end();
});
const port = Number(process.env.NRFD_PREVIEW_PORT || 43187);
server.listen(port, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${port}/k/admin/app/flow?app=1#section=form`));
