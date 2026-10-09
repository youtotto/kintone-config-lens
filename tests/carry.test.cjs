const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require.resolve('../kintoneConfigLens.user.js'), 'utf8');
const { collectSettings, saveCarry, readCarry, carryKey, CARRY_TTL, pageDiffContext, saveMarkerKey, hasSaveMarker } = require('../kintoneConfigLens.user.js');
const { good } = require('./fixtures.cjs');
const { menuFixture } = require('./menu-fixture.cjs');
const ctx = { app: '12', prefix: '/k' };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function setup(path, data, markup = '<main><h1>標準の設定画面</h1><input value="未保存の編集"></main>', saveMarker) {
  const dom = new JSDOM(markup, { url: 'https://example.cybozu.com' + path, runScripts: 'outside-only', pretendToBeVisual: true });
  dom.requests = 0;
  dom.window.fetch = url => { dom.requests++; return good(url); };
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  if (data) dom.window.sessionStorage.setItem(carryKey(ctx), data);
  if (saveMarker) dom.window.sessionStorage.setItem(saveMarkerKey(ctx), saveMarker);
  dom.window.eval(source);
  return dom;
}

test('実際の取得結果を画面間で引き継ぎ、個別画面は0APIで変更前後を表示する', async () => {
  const flow = setup('/k/admin/app/flow?app=12', null, menuFixture());
  let inner;
  try {
    const d = flow.window.document;
    [...d.querySelectorAll('button')].find(b => b.textContent === '設定を読み込む').click(); await wait(40);
    assert.equal(flow.requests, 34);
    const data = flow.window.sessionStorage.getItem(carryKey(ctx)); assert.ok(data);
    assert.equal(JSON.parse(data).results.length, 16);
    assert.deepEqual(JSON.parse(data).results.filter(r => r.snapshots).map(r => r.id), ['fields', 'layout', 'views', 'reports']);
    inner = setup('/k/admin/app/acl/app?app=12', data);
    const page = inner.window.document;
    assert.match(page.querySelector('#nrfd-page-diff').textContent, /変更あり.*差分を見る/);
    assert.match(page.querySelector('#nrfd-page-diff').textContent, /運用中 r8 → 保存済みプレビュー r9/);
    assert.equal(page.querySelector('details').open, false);
    page.querySelector('summary').click(); assert.equal(page.querySelector('details').open, true);
    assert.equal(page.querySelectorAll('#nrfd-page-diff table').length, 1);
    assert.match(page.querySelector('tbody td').textContent, /レコード追加/);
    assert.equal(page.querySelector('input').value, '未保存の編集');
    page.querySelector('main').appendChild(page.createElement('div')); await wait(150);
    assert.equal(page.querySelector('details').open, true, '編集DOMの更新で折りたたみ状態をリセットしない');
    page.querySelector('#nrfd-page-diff').remove(); await wait(150);
    assert.equal(page.querySelectorAll('#nrfd-page-diff').length, 1);
    assert.equal(inner.requests, 0);
    [...d.querySelectorAll('button')].find(b => b.textContent === '設定を再取得').click();
    assert.equal(flow.window.sessionStorage.getItem(carryKey(ctx)), null, '再取得開始時に前の結果を無効化');
    await wait(40);
  } finally { inner?.window.close(); flow.window.close(); }
});

test('一般設定の個別画面は該当キーだけ、未取得と未対応・別アプリを区別する', async () => {
  const results = await collectSettings(ctx, undefined, good);
  const memory = new Map(), storage = { getItem: k => memory.get(k) || null, setItem: (k,v) => memory.set(k,v), removeItem: k => memory.delete(k) };
  saveCarry(storage, ctx, results);
  for (const [path, label, count] of [['general', '変更あり', 1], ['theme', '変更なし', 0], ['info', '変更あり', 2], ['title', '変更なし', 0]]) {
    const dom = setup(`/k/admin/app/${path}?app=12`, storage.getItem(carryKey(ctx)));
    try { assert.match(dom.window.document.querySelector('#nrfd-page-diff').textContent, new RegExp(label)); assert.equal(dom.window.document.querySelectorAll('#nrfd-page-diff table').length, count); assert.equal(dom.requests, 0); }
    finally { dom.window.close(); }
  }
  for (const path of ['/k/admin/app/status?app=13', '/k/guest/7/admin/app/status?app=12']) {
    const dom = setup(path, storage.getItem(carryKey(ctx)));
    try { assert.match(dom.window.document.querySelector('#nrfd-page-diff').textContent, /未取得・期限切れ/); assert.equal(dom.requests, 0); } finally { dom.window.close(); }
  }
  assert.equal(pageDiffContext('https://example.cybozu.com/k/admin/app/apitoken?app=12'), null);
  assert.equal(pageDiffContext('https://example.cybozu.com/k/admin/app/12/plugin/#/config/test'), null);
});

test('保存操作後は比較未更新を引き継ぎ、キャンセルのみでは付けず、再取得で解除する', async () => {
  const results = await collectSettings(ctx, undefined, good);
  const memory = new Map(), storage = { getItem: k => memory.get(k) || null, setItem: (k,v) => memory.set(k,v), removeItem: k => memory.delete(k) };
  saveCarry(storage, ctx, results);
  const controls = '<main><button data-testid="shared-admin-pageActionBar-CancelButton">キャンセル</button><button data-testid="shared-admin-pageActionBar-SaveButton"><span>保存</span></button></main>';
  const inner = setup('/k/admin/app/acl/app?app=12', storage.getItem(carryKey(ctx)), controls);
  let returned;
  try {
    const d = inner.window.document, time = JSON.parse(inner.window.sessionStorage.getItem(carryKey(ctx))).time;
    d.querySelector('[data-testid$="CancelButton"]').click();
    assert.equal(d.querySelector('.nrfd-stale-warning'), null);
    assert.equal(JSON.parse(inner.window.sessionStorage.getItem(carryKey(ctx))).stale, undefined);
    const save = d.querySelector('[data-testid$="SaveButton"]');
    let prevented;
    save.addEventListener('click', e => { prevented = e.defaultPrevented; });
    save.querySelector('span').click();
    assert.equal(prevented, false);
    assert.match(d.querySelector('.nrfd-stale-warning').textContent, /比較未更新.*保存操作/);
    // A failed save has no confirmed result; retain the warning even if cancel follows.
    d.querySelector('[data-testid$="CancelButton"]').click();
    const saved = inner.window.sessionStorage.getItem(carryKey(ctx));
    assert.equal(JSON.parse(saved).time, time); assert.equal(JSON.parse(saved).stale, true);
    returned = setup('/k/admin/app/flow?app=12', saved, menuFixture());
    const rd = returned.window.document;
    assert.equal(rd.querySelector('.nrfd-stale-warning').hidden, false);
    assert.equal(rd.querySelectorAll('.nrfd-menu-chip').length, 12, '取得時点の差分は残す');
    assert.match(rd.querySelector('.nrfd-menu-chip').title, /比較未更新/);
    const refresh = [...rd.querySelectorAll('button')].find(b => b.textContent === '設定を再取得');
    assert.equal(refresh.classList.contains('nrfd-start-button'), true);
    assert.equal(returned.requests, 0); assert.equal(inner.requests, 0);
    returned.window.dispatchEvent(new returned.window.PageTransitionEvent('pagehide', { persisted: true }));
    returned.window.dispatchEvent(new returned.window.PageTransitionEvent('pageshow', { persisted: true }));
    assert.equal(rd.querySelector('.nrfd-stale-warning').hidden, false);
    refresh.click(); await wait(40);
    assert.equal(rd.querySelector('.nrfd-stale-warning').hidden, true);
    assert.equal(JSON.parse(returned.window.sessionStorage.getItem(carryKey(ctx))).stale, undefined);
    assert.equal(returned.requests, 34);
  } finally { inner.window.close(); returned?.window.close(); }
});

test('フォーム保存も比較未更新にし、無効な保存ボタンやキャンセルは除外する', async () => {
  const results = await collectSettings(ctx, undefined, good);
  const memory = new Map(), storage = { getItem: k => memory.get(k) || null, setItem: (k,v) => memory.set(k,v), removeItem: k => memory.delete(k) };
  saveCarry(storage, ctx, results);
  const dom = setup('/k/admin/app/flow?app=12', storage.getItem(carryKey(ctx)), '<main><nav role="tablist"><button role="tab" id="form" aria-selected="true">フォーム</button></nav><button data-testid="formSaveButton" disabled>保存</button></main>');
  try {
    const d = dom.window.document, save = d.querySelector('[data-testid="formSaveButton"]');
    save.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(d.querySelector('.nrfd-stale-warning').hidden, true);
    save.disabled = false; save.click();
    assert.equal(d.querySelector('.nrfd-stale-warning').hidden, false);
    assert.equal(JSON.parse(dom.window.sessionStorage.getItem(carryKey(ctx))).stale, true);
    assert.equal(dom.requests, 0);
  } finally { dom.window.close(); }
});

test('初回未取得の保存を結果なしでも記録し、戻り先・履歴復帰で警告を出す', async () => {
  const inner = setup('/k/admin/app/acl/app?app=12', null, '<main><button data-testid="shared-admin-pageActionBar-CancelButton">キャンセル</button><button data-testid="shared-admin-pageActionBar-SaveButton">保存</button></main>');
  let returned;
  try {
    inner.window.document.querySelector('[data-testid$="CancelButton"]').click();
    assert.equal(inner.window.sessionStorage.getItem(saveMarkerKey(ctx)), null);
    inner.window.document.querySelector('[data-testid$="SaveButton"]').click();
    const marker = inner.window.sessionStorage.getItem(saveMarkerKey(ctx)); assert.ok(marker);
    assert.equal(inner.window.sessionStorage.getItem(carryKey(ctx)), null);
    returned = setup('/k/admin/app/flow?app=12', null, menuFixture(), marker);
    const d = returned.window.document;
    assert.equal(d.querySelector('.nrfd-stale-warning').hidden, false);
    assert.match(d.querySelector('.nrfd-status').textContent, /はじめに/);
    assert.equal(returned.requests, 0);
    returned.window.dispatchEvent(new returned.window.PageTransitionEvent('pageshow', { persisted: true }));
    assert.equal(d.querySelector('.nrfd-stale-warning').hidden, false);
    [...d.querySelectorAll('button')].find(b => b.textContent === '設定を読み込む').click(); await wait(40);
    assert.equal(d.querySelector('.nrfd-stale-warning').hidden, true);
    assert.equal(returned.window.sessionStorage.getItem(saveMarkerKey(ctx)), null);
    assert.equal(returned.requests, 34);
  } finally { inner.window.close(); returned?.window.close(); }
});

test('期限切れ結果で保存しても警告を残し、別アプリ・空間・期限外の保存記録を使わない', async () => {
  const results = await collectSettings(ctx, undefined, good);
  const memory = new Map(), storage = { getItem: k => memory.get(k) || null, setItem: (k,v) => memory.set(k,v), removeItem: k => memory.delete(k) };
  saveCarry(storage, ctx, results, Date.now() - CARRY_TTL);
  const dom = setup('/k/admin/app/acl/app?app=12', storage.getItem(carryKey(ctx)), '<main><button data-testid="shared-admin-pageActionBar-SaveButton">保存</button></main>');
  try {
    dom.window.document.querySelector('button[data-testid]').click();
    assert.equal(hasSaveMarker(dom.window.sessionStorage, ctx), true);
    assert.equal(hasSaveMarker(dom.window.sessionStorage, { ...ctx, app: '13' }), false);
    assert.equal(hasSaveMarker(dom.window.sessionStorage, { ...ctx, prefix: '/k/guest/7' }), false);
    assert.match(dom.window.document.querySelector('#nrfd-page-diff').textContent, /比較未更新.*未取得・期限切れ/s);
    for (const value of ['bad', '', String(Date.now() + 100000), String(Date.now() - CARRY_TTL)]) {
      dom.window.sessionStorage.setItem(saveMarkerKey(ctx), value);
      assert.equal(hasSaveMarker(dom.window.sessionStorage, ctx), false);
    }
    assert.equal(dom.requests, 0);
  } finally { dom.window.close(); }
});

test('キャンセル相当の通常遷移で戻ると全カテゴリ・メニューチップ・フォーム情報と表示設定を0APIで復元する', async () => {
  const original = setup('/k/admin/app/flow?app=12', null, menuFixture());
  let returned, form;
  try {
    const d = original.window.document;
    [...d.querySelectorAll('button')].find(b => b.textContent === '設定を読み込む').click(); await wait(40);
    const select = d.querySelector('[aria-label="比較カテゴリ"]'); select.value = 'general'; select.dispatchEvent(new original.window.Event('change'));
    d.querySelector('[aria-label="フィールドコード"]').click();
    d.querySelector('[aria-label="差分チップ"]').click();
    original.window.dispatchEvent(new original.window.PageTransitionEvent('pagehide', { persisted: false }));
    const cached = original.window.sessionStorage.getItem(carryKey(ctx)), time = JSON.parse(cached).time;
    returned = setup('/k/admin/app/flow?app=12#section=settings', cached, menuFixture());
    const rd = returned.window.document;
    assert.equal(returned.requests, 0);
    assert.equal(rd.querySelector('[aria-label="比較カテゴリ"]').value, 'general');
    assert.equal(rd.querySelector('[aria-label="フィールドコード"]').checked, true);
    assert.equal(rd.querySelector('[aria-label="差分チップ"]').checked, false);
    assert.match(rd.querySelector('.nrfd-status').textContent, /一般設定・高度な設定.*項目に差分/);
    assert.equal(rd.querySelectorAll('.nrfd-menu-chip').length, 0, '差分チップOFFは設定メニューでも維持');
    rd.querySelector('[aria-label="差分チップ"]').click();
    assert.equal(rd.querySelectorAll('.nrfd-menu-chip').length, 12);
    assert.ok([...rd.querySelectorAll('button')].some(b => b.textContent === '設定を再取得'));
    assert.equal(JSON.parse(returned.window.sessionStorage.getItem(carryKey(ctx))).time, time, '復元で保持期限を延長しない');
    const markup = '<main><nav role="tablist"><button role="tab" id="form" aria-selected="true">フォーム</button></nav><button data-testid="formSaveButton">保存</button><div data-testid="field-A"><div data-testid="fieldMovable"><label>案件名</label></div></div></main>';
    form = setup('/k/admin/app/flow?app=12#section=form', cached, markup);
    const fd = form.window.document;
    assert.match(fd.querySelector('.nrfd-field-count').textContent, /フィールド 2/);
    assert.equal(fd.querySelector('[data-testid="field-A"] .nrfd-chip'), null, '再読み込み後も差分チップの非表示を維持');
    assert.ok(fd.querySelector('[data-testid="field-A"] .nrfd-info-button'));
    const fs = fd.querySelector('[aria-label="比較カテゴリ"]'); fs.value = 'layout'; fs.dispatchEvent(new form.window.Event('change'));
    [...fd.querySelectorAll('button')].find(b => b.textContent === 'フォーム配置を見る').click();
    assert.equal(fd.querySelectorAll('.nrfd-layout-side').length, 2);
    assert.equal(form.requests, 0);
  } finally { original.window.close(); returned?.window.close(); form?.window.close(); }
});

test('復帰時に期限切れや再取得中の結果を復元せず、取得失敗をそのまま復元する', async () => {
  const results = await collectSettings(ctx, undefined, good);
  const memory = new Map(), storage = { getItem: k => memory.get(k) || null, setItem: (k,v) => memory.set(k,v), removeItem: k => memory.delete(k) };
  saveCarry(storage, ctx, results, Date.now() - CARRY_TTL);
  const expired = setup('/k/admin/app/flow?app=12', storage.getItem(carryKey(ctx)), menuFixture());
  try { assert.equal(expired.requests, 0); assert.match(expired.window.document.querySelector('.nrfd-status').textContent, /はじめに/); assert.equal(expired.window.document.querySelectorAll('.nrfd-menu-chip').length, 0); } finally { expired.window.close(); }
  const process = results.find(r => r.category.id === 'process'); process.state = 'error'; process.error = '取得不可'; process.entries = [];
  saveCarry(storage, ctx, results);
  const restored = setup('/k/admin/app/flow?app=12', storage.getItem(carryKey(ctx)), menuFixture());
  try {
    assert.match(restored.window.document.querySelector('.nrfd-status').textContent, /取得失敗 1/);
    assert.equal(restored.window.document.querySelector('a[href*="/status?"] .nrfd-menu-chip').textContent, '取得失敗');
    restored.window.sessionStorage.removeItem(carryKey(ctx));
    restored.window.dispatchEvent(new restored.window.PageTransitionEvent('pageshow', { persisted: true }));
    assert.match(restored.window.document.querySelector('.nrfd-status').textContent, /はじめに/);
    assert.equal(restored.requests, 0);
  } finally { restored.window.close(); }
});

test('一時保持は30分で失効し、不正データ・保存容量不足は古い結果を残さない', async () => {
  const results = await collectSettings(ctx, undefined, good);
  const memory = new Map(), storage = { getItem: k => memory.get(k) || null, setItem: (k,v) => memory.set(k,v), removeItem: k => memory.delete(k) };
  assert.equal(saveCarry(storage, ctx, results, 100), true);
  assert.ok(readCarry(storage, ctx, 100 + CARRY_TTL - 1));
  assert.equal(readCarry(storage, ctx, 100 + CARRY_TTL), null);
  assert.equal(storage.getItem(carryKey(ctx)), null);
  for (const mutate of [d => d.time = Date.now() + 100000, d => d.app = '99', d => d.results[0].entries[0].rows = {}, d => d.results[0].id = d.results[1].id]) {
    saveCarry(storage, ctx, results); const data = JSON.parse(storage.getItem(carryKey(ctx))); mutate(data); storage.setItem(carryKey(ctx), JSON.stringify(data));
    assert.equal(readCarry(storage, ctx), null);
  }
  saveCarry(storage, ctx, results);
  assert.equal(saveCarry({ ...storage, setItem: () => { throw new Error('Quota exceeded'); } }, ctx, results), false);
  assert.equal(storage.getItem(carryKey(ctx)), null);
});

test('取得失敗・部分比較・期限切れを個別画面で明示し、HTMLとして解釈しない', async () => {
  const results = await collectSettings(ctx, undefined, good), process = results.find(r => r.category.id === 'process');
  process.state = 'error'; process.entries = []; process.error = '<img src=x onerror=alert(1)>';
  const memory = new Map(), storage = { getItem: k => memory.get(k) || null, setItem: (k,v) => memory.set(k,v), removeItem: k => memory.delete(k) };
  saveCarry(storage, ctx, results);
  const dom = setup('/k/admin/app/status?app=12', storage.getItem(carryKey(ctx)));
  try {
    const d = dom.window.document;
    assert.match(d.querySelector('#nrfd-page-diff').textContent, /取得失敗/);
    assert.equal(d.querySelector('#nrfd-page-diff img'), null);
    const data = JSON.parse(dom.window.sessionStorage.getItem(carryKey(ctx))); data.time = Date.now() - CARRY_TTL;
    dom.window.sessionStorage.setItem(carryKey(ctx), JSON.stringify(data)); dom.window.dispatchEvent(new dom.window.Event('focus'));
    assert.match(d.querySelector('#nrfd-page-diff').textContent, /未取得・期限切れ/);
    assert.doesNotMatch(d.querySelector('#nrfd-page-diff').textContent, /取得失敗/);
    assert.equal(dom.requests, 0);
  } finally { dom.window.close(); }
  const action = results.find(r => r.category.id === 'actions'); action.state = 'partial'; action.warnings = ['一部比較不可']; action.entries = [];
  saveCarry(storage, ctx, results);
  const partial = setup('/k/admin/app/action?app=12', storage.getItem(carryKey(ctx)));
  try { assert.match(partial.window.document.querySelector('#nrfd-page-diff').textContent, /一部比較不可/); assert.doesNotMatch(partial.window.document.querySelector('#nrfd-page-diff').textContent, /変更なし/); }
  finally { partial.window.close(); }
});
