const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { layoutElementContainers } = require('../kintoneConfigLens.user.js');
const { good } = require('./fixtures.cjs');
const row = (...fields) => ({ type: 'ROW', fields });
const layout = [row({type:'SINGLE_LINE_TEXT',code:'A'}, {type:'LABEL',elementId:'heading',label:'<b>案内</b>'}), row({type:'SPACER',elementId:'space'}, {type:'HR',elementId:'line'})];
const part = (id, type, content='') => `<div data-testid="field-${id}"><div data-testid="fieldMovable"><div data-testid="${type}-${id}">${content}</div></div></div>`;
const markup = `<div data-testid="formCanvas"><div data-testid="row-random1">${part('A','singleLineText')}${part('randomLabel','label','案内')}</div><div data-testid="row-random2">${part('randomSpace','spacer')}${part('randomLine','hr')}</div></div>`;
function match(dom, data=layout) { return layoutElementContainers(data, dom.window.document.querySelector('[data-testid="formCanvas"]')); }
test('レイアウトと行・コード・種別・ラベルを照合し、匿名識別子に要素IDを対応付ける', () => {
  const dom = new JSDOM(markup);
  try { assert.deepEqual([...match(dom)].map(([id,n])=>[id,n.dataset.testid]), [['heading','field-randomLabel'],['space','field-randomSpace'],['line','field-randomLine']]); } finally { dom.window.close(); }
});
test('追加・コード変更・並び替え・ラベル変更や種別不一致では位置を推測しない', () => {
  for (const edit of [s=>s.replace('field-A','field-B'), s=>s.replace('案内','変更'), s=>s.replace('label-randomLabel','spacer-randomLabel'), s=>s.replace('row-random2','row-random2"><div data-testid="field-extra"></div><div'), s=>s.replace(part('A','singleLineText')+part('randomLabel','label','案内'),part('randomLabel','label','案内')+part('A','singleLineText'))]) {
    const dom = new JSDOM(edit(markup)); try { assert.equal(match(dom).size,0); } finally { dom.window.close(); }
  }
});
test('同じラベルは区別できないためIDを割り当てない', () => {
  const dom = new JSDOM(`<div data-testid="formCanvas"><div data-testid="row-x">${part('x','label','案内')}${part('y','label','案内')}</div></div>`);
  try { assert.equal(match(dom,[row({type:'LABEL',elementId:'a',label:'案内'},{type:'LABEL',elementId:'b',label:'案内'})]).size,0); } finally { dom.window.close(); }
});
test('テーブル子を行の部品として数えず、グループ内は独立したレイアウトで照合', () => {
  const dom = new JSDOM(`<div data-testid="formCanvas"><div data-testid="row-table"><div data-testid="field-T">${part('X','number')}</div></div><div data-testid="row-group"><div data-testid="field-G"><div data-testid="row-inner">${part('anon','label','内側')}</div></div></div></div>`);
  try { assert.equal(match(dom,[{type:'SUBTABLE',code:'T',fields:[{type:'NUMBER',code:'X'}]}, {type:'GROUP',code:'G',layout:[row({type:'LABEL',elementId:'inner',label:'内側'})]}]).get('inner').dataset.testid,'field-anon'); } finally { dom.window.close(); }
});
test('匿名部品のチップを追加APIなしで表示し、保存後は再取得まで対応付けを停止', async () => {
  const dom = new JSDOM(`<button role="tab" id="form" aria-selected="true">フォーム</button><button data-testid="formSaveButton">保存</button>${markup}`, {url:'https://example.cybozu.com/k/admin/app/flow?app=12',runScripts:'outside-only',pretendToBeVisual:true});
  let count=0;
  dom.window.fetch = async url => { count++; const r=await good(url), d=await r.json(); if(d.layout)d.layout=layout; return {...r,json:async()=>d}; };
  try {
    dom.window.eval(fs.readFileSync(require.resolve('../kintoneConfigLens.user.js'),'utf8'));
    [...dom.window.document.querySelectorAll('#nrfd-root button')].find(b=>b.textContent==='設定を読み込む').click();
    await new Promise(r=>setTimeout(r,80));
    const d=dom.window.document, chip=()=>d.querySelector('[data-testid="field-randomLabel"] .nrfd-info-button');
    assert.equal(chip(),null);
    d.querySelector('[aria-label="フィールドコード"]').click();
    assert.ok(chip()); chip().dispatchEvent(new dom.window.Event('pointerenter'));
    assert.equal(d.querySelector('[role="tooltip"]'),null);
    assert.equal(chip().title,'要素ID：heading'); assert.equal(count,34);
    d.querySelector('[data-testid="formSaveButton"]').click(); assert.equal(chip(),null);
    assert.match(d.querySelector('.nrfd-status').textContent,/フォーム保存が完了してから設定を再取得/);
  } finally { dom.window.close(); }
});
