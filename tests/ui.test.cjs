const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require.resolve('../kintoneConfigLens.user.js'), 'utf8');
const fixture = `<button role="tab" id="form" aria-selected="true">フォーム</button><div role="tabpanel"><div data-testid="appForm"><aside><div><button data-testid="formSaveButton">フォームを保存</button></div></aside><div data-testid="field-A"><div role="button" data-testid="fieldMovable"><label id="field-label-A">案件名</label></div></div><div data-testid="field-B"><label id="field-label-B">案件名</label></div></div></div>`;
const f = (code, extra = {}) => ({ type: 'SINGLE_LINE_TEXT', code, label: '案件名', required: false, ...extra });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function setup(fetcher, path = '/k/admin/app/flow?app=12', start = true, markup = fixture) {
  const dom = new JSDOM(markup, { url: 'https://example.cybozu.com' + path, runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.fetch = fetcher;
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  dom.window.eval(source); await wait(30);
  if (start) {
    [...dom.window.document.querySelectorAll('#nrfd-root button')].find(b => b.textContent === '設定を読み込む').click(); await wait(30);
  }
  if (start) selectCategory(dom, 'fields');
  return dom;
}
function selectCategory(dom, id) { const select = dom.window.document.querySelector('[aria-label="比較カテゴリ"]'); select.value = id; select.dispatchEvent(new dom.window.Event('change')); }
function openCategory(dom, id) { selectCategory(dom, id); [...dom.window.document.querySelectorAll('#nrfd-root button')].find(b => b.textContent === (id === 'layout' ? 'フォーム配置を見る' : '差分一覧')).click(); }
const { good } = require('./fixtures.cjs');
const { menuFixture } = require('./menu-fixture.cjs');

test('設定メニューは取得済みの差分だけを表示し、一般設定を分割、標準リンクを保持する', async () => {
  let requests = 0;
  const dom = await setup(url => { requests++; return good(url); }, undefined, false, menuFixture());
  try {
    const d = dom.window.document;
    const links = [...d.querySelectorAll('[role="tabpanel"] a')];
    const original = links.map(a => a.getAttribute('href'));
    const badge = name => links.find(a => a.firstElementChild.textContent === name).querySelector('.nrfd-menu-chip');
    assert.equal(d.querySelectorAll('.nrfd-menu-chip').length, 0);
    assert.equal(requests, 0);
    [...d.querySelectorAll('#nrfd-root button')].find(b => b.textContent === '設定を読み込む').click(); await wait(30);
    for (const name of ['アイコンと説明', '高度な設定', 'プロセス管理', 'アプリの条件通知', 'レコードの条件通知', 'リマインダーの条件通知', 'アプリ', 'レコード', 'フィールド', 'プラグイン', 'JavaScript / CSSでカスタマイズ', 'アクション']) assert.equal(badge(name)?.textContent, '変更あり', name);
    for (const name of ['デザインテーマ', 'レコードのタイトル', 'APIトークン', 'Webhook', 'カテゴリー', '言語ごとの名称', '設定変更の履歴']) assert.equal(badge(name), null, name);
    assert.deepEqual(links.map(a => a.getAttribute('href')), original);
    assert.equal(d.querySelectorAll('[role="tabpanel"] button').length, 0);
    let observed;
    links[0].addEventListener('click', e => { observed = e.defaultPrevented; e.preventDefault(); });
    badge('アイコンと説明').click(); assert.equal(observed, false, 'チップはネイティブリンクのクリックを妨げない');
    selectCategory(dom, 'general'); await wait(150);
    assert.equal(d.querySelectorAll('.nrfd-menu-chip').length, 12, '重複表示しない');
    // Native React menu replacement and tab switches reuse the same results.
    const panel = d.querySelector('[role="tabpanel"]'); panel.innerHTML = panel.innerHTML.replace(/<span class="nrfd-menu-chip"[\s\S]*?<\/span>/g, '');
    await wait(170); assert.equal(d.querySelectorAll('.nrfd-menu-chip').length, 12);
    d.getElementById('settings').setAttribute('aria-selected', 'false'); await wait(170);
    assert.equal(d.querySelectorAll('.nrfd-menu-chip').length, 0);
    d.getElementById('settings').setAttribute('aria-selected', 'true'); await wait(170);
    assert.equal(d.querySelectorAll('.nrfd-menu-chip').length, 12);
    assert.equal(requests, 34);
  } finally { dom.window.close(); }
});

test('メニューの再取得中は古いチップを消し、取得失敗・一部比較不可を区別する', async () => {
  let phase = 'ok', release;
  const gate = new Promise(resolve => { release = resolve; });
  const dom = await setup(async url => {
    if (phase === 'waiting') await gate;
    if (phase === 'error' && url.includes('/app/status.json')) return { ok: false, status: 403, json: async () => ({ message: '取得不可' }) };
    const response = await good(url), data = await response.json();
    if (phase === 'error' && data.actions && !Array.isArray(data.actions)) Object.values(data.actions).forEach(a => { a.destApp = null; a.mappings = null; });
    return { ...response, json: async () => data };
  }, undefined, true, menuFixture());
  try {
    const d = dom.window.document;
    const badge = path => d.querySelector(`[role="tabpanel"] a[href="/k/admin/app/${path}?app=12"] .nrfd-menu-chip`);
    assert.equal(badge('status').textContent, '変更あり');
    phase = 'waiting'; [...d.querySelectorAll('#nrfd-root button')].find(b => b.textContent === '設定を再取得').click();
    assert.equal(d.querySelectorAll('.nrfd-menu-chip').length, 0);
    phase = 'error'; release(); await wait(40);
    assert.equal(badge('status').textContent, '取得失敗');
    assert.equal(badge('action').textContent, '一部比較不可');
    assert.equal(badge('status').dataset.state, 'error');
  } finally { release(); dom.window.close(); }
});

test('テーマだけの変更は他の一般設定に付けず、差分が解消したらチップを除去する', async () => {
  let changed = true;
  const dom = await setup(async url => {
    const response = await good(url), data = await response.json();
    if (data.name) Object.assign(data, { name: url.includes('/preview/') ? '名称のみ変更' : '元名称', description: '', enableBulkDeletion: false, numberPrecision: {}, theme: changed && url.includes('/preview/') ? 'RED' : 'WHITE' });
    return { ...response, json: async () => data };
  }, undefined, true, menuFixture());
  try {
    const d = dom.window.document;
    const count = page => d.querySelectorAll(`a[href="/k/admin/app/${page}?app=12"] .nrfd-menu-chip`).length;
    assert.equal(count('theme'), 1);
    for (const page of ['general', 'info', 'title']) assert.equal(count(page), 0);
    changed = false; [...d.querySelectorAll('#nrfd-root button')].find(b => b.textContent === '設定を再取得').click(); await wait(40);
    assert.equal(count('theme'), 0);
  } finally { dom.window.close(); }
});

test('テーブル親子のチップを各入力領域の外へ配置し、非表示で専用行を除去する', async () => {
  let requests = 0;
  const markup = `<button role="tab" id="form" aria-selected="true">フォーム</button><button data-testid="formSaveButton">フォームを保存</button>
    <div data-testid="field-T"><div class="native-table"><table><tbody><tr>
      <td><div data-testid="field-A"><div role="button" data-testid="fieldMovable"><input value="検証用"></div></div></td>
      <td><div data-testid="field-B"><div role="button" data-testid="fieldMovable"><span>自動計算</span></div></div></td>
    </tr></tbody></table></div></div>`;
  const dom = await setup(async url => {
    requests++; const response = await good(url), data = await response.json();
    if (data.properties) data.properties = { T: f('T', { type: 'SUBTABLE', fields: { A: f('A'), B: f('B', { type: 'CALC', expression: '1+1' }) } }) };
    return { ...response, json: async () => data };
  }, undefined, false, markup);
  try {
    const d = dom.window.document, natives = [...d.querySelectorAll('[data-testid="fieldMovable"]')];
    const before = natives.map(n => n.outerHTML);
    [...d.querySelectorAll('#nrfd-root button')].find(b => b.textContent === '設定を読み込む').click(); await wait(30);
    d.querySelector('[aria-label="フィールドコード"]').click();
    for (const code of ['T', 'A', 'B']) {
      const field = d.querySelector(`[data-testid="field-${code}"]`), footer = field.querySelector(':scope > .nrfd-field-info');
      assert.ok(footer, `${code} の専用行`);
      assert.equal(footer.previousElementSibling, field.firstElementChild);
    }
    assert.deepEqual(natives.map(n => n.outerHTML), before, '元の入力・ドラッグ領域を変更しない');
    assert.equal(d.querySelectorAll('.nrfd-field-info').length, 3);
    d.querySelector('[aria-label="設定チップ"]').click();
    d.querySelector('[aria-label="フィールドコード"]').click();
    assert.equal(d.querySelectorAll('.nrfd-field-info, .nrfd-anchor').length, 0, '非表示時に余白を残さない');
    d.querySelector('[aria-label="フィールドコード"]').click();
    assert.equal(d.querySelectorAll('.nrfd-field-info').length, 3);
    assert.equal(requests, 34, '表示の切替に追加APIは不要');
  } finally { dom.window.close(); }
});
test('初期表示・カテゴリ切替・履歴復帰は0GET、比較は毎回全16カテゴリ34GET', async () => {
  const requests = [];
  const dom = await setup(url => { requests.push(url); return good(url); }, undefined, false);
  try {
    const d = dom.window.document, category = d.querySelector('[aria-label="比較カテゴリ"]');
    const click = text => [...d.querySelectorAll('#nrfd-root button')].find(b => b.textContent === text).click();
    assert.equal(requests.length, 0);
    assert.equal(d.querySelector('[aria-label="取得範囲"]'), null);
    assert.equal(category.options.length, 17);
    assert.equal(category.value, 'all');
    assert.ok(![...d.querySelectorAll('#nrfd-root button')].some(b => b.textContent === '全カテゴリ'));
    const compare = [...d.querySelectorAll('#nrfd-root button')].find(b => b.textContent === '設定を読み込む');
    assert.equal(compare.nextElementSibling.textContent, 'API：通常34回');
    assert.ok(compare.classList.contains('nrfd-start-button'));
    assert.match(d.querySelector('.nrfd-status').textContent, /はじめに「設定を読み込む」/);
    assert.equal(compare.parentElement.nextElementSibling, category);
    category.value = 'views'; category.dispatchEvent(new dom.window.Event('change'));
    dom.window.dispatchEvent(new dom.window.HashChangeEvent('hashchange'));
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pageshow', { persisted: true }));
    await wait(150); assert.equal(requests.length, 0);
    click('設定を読み込む'); await wait(30);
    assert.equal(requests.length, 34);
    assert.equal(compare.textContent, '設定を再取得');
    assert.equal(compare.classList.contains('nrfd-start-button'), false);
    assert.doesNotMatch(d.querySelector('.nrfd-status').textContent, /はじめに/);
    assert.match(d.querySelector('.nrfd-status').textContent, /一覧：1 項目に差分/);
    openCategory(dom, 'all'); assert.equal(d.querySelectorAll('.nrfd-summary button').length, 16);
    assert.doesNotMatch(d.querySelector('dialog').textContent, /取得失敗/);
    d.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel', { cancelable: true }));
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide', { persisted: true }));
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pageshow', { persisted: true }));
    await wait(30); assert.equal(requests.length, 34);
    assert.match(d.querySelector('.nrfd-status').textContent, /r8/);
    category.value = 'fields'; category.dispatchEvent(new dom.window.Event('change'));
    await wait(30); assert.equal(requests.length, 34);
    click('設定を再取得'); await wait(30); assert.equal(requests.length, 68);
    assert.equal(compare.nextElementSibling.textContent, 'API：通常34回');
    openCategory(dom, 'all'); assert.equal(d.querySelectorAll('.nrfd-summary button').length, 16);
  } finally { dom.window.close(); }
});

test('全チップ非表示で標準配置に戻し、常設バーから差分を独立して再表示できる', async () => {
  let requests = 0;
  const dom = await setup(url => { requests++; return good(url); });
  try {
    const d = dom.window.document, floating = d.querySelector('.nrfd-floating-tools');
    assert.equal(d.querySelectorAll('#nrfd-root input[type="checkbox"]').length, 0, 'ヘッダーには表示切替を重複させない');
    assert.equal(d.querySelectorAll('[aria-label="差分チップ"]').length, 1);
    assert.equal(d.querySelector('.nrfd-help').open, false, '説明は初期状態で折りたたむ');
    assert.equal(floating.hidden, false, '初期表示でもフォームの表示切替を常設');
    d.dispatchEvent(new dom.window.Event('scroll'));
    assert.equal(floating.hidden, false);
    const floatingCode = floating.querySelector('[aria-label="フィールドコード"]');
    floatingCode.focus(); floatingCode.click();
    assert.equal(floatingCode.checked, true);
    assert.equal(floatingCode.nextElementSibling.nextElementSibling.textContent, '表示中');
    assert.equal(d.querySelectorAll('.nrfd-code-segment').length, 2);
    assert.equal(d.activeElement, floatingCode, '切替後も固定バーにフォーカスを保持する');
    d.dispatchEvent(new dom.window.Event('scroll'));
    assert.equal(floating.hidden, false, '上部の操作欄が戻っても固定バーを残す');
    floatingCode.click();
    assert.equal(floatingCode.checked, false);
    const floatingInfo = floating.querySelector('[aria-label="設定チップ"]');
    floatingInfo.click();
    assert.equal(d.querySelectorAll('.nrfd-info-button').length, 0);
    assert.equal(d.querySelectorAll('.nrfd-field-info > .nrfd-chip').length, 2, '差分チップは両方OFFでも入力欄の下に残す');
    const floatingDiff = floating.querySelector('[aria-label="差分チップ"]');
    floatingDiff.click();
    assert.equal(floatingDiff.checked, false);
    assert.equal(d.querySelectorAll('.nrfd-chip,.nrfd-field-info,.nrfd-anchor').length, 0, 'チップとレイアウト変更用の領域・クラスをすべて除去');
    assert.equal(floating.hidden, false, 'すべてオフでも消さない');
    assert.ok([...floating.querySelectorAll('.nrfd-option-state')].every(n => n.textContent === '非表示'));
    [...d.querySelectorAll('#nrfd-root button')].find(b => b.textContent === '差分一覧').click();
    assert.ok(d.querySelector('.nrfd-list button'), '非表示でも比較結果は一覧から確認できる');
    d.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel', { cancelable: true }));
    floatingDiff.click();
    assert.equal(d.querySelectorAll('.nrfd-field-info > .nrfd-chip').length, 2);
    assert.equal(d.querySelectorAll('.nrfd-info-button').length, 0, '差分だけ再表示できる');
    floatingDiff.click();
    d.dispatchEvent(new dom.window.Event('scroll'));
    dom.window.dispatchEvent(new dom.window.Event('resize'));
    assert.equal(floating.hidden, false, 'フォーム縮小によるスクロール補正後も操作できる');
    floatingCode.focus(); floatingCode.click();
    assert.equal(d.querySelectorAll('.nrfd-code-segment').length, 2);
    assert.equal(d.querySelectorAll('.nrfd-chip').length, 0, 'コード再表示で非表示の差分を戻さない');
    assert.equal(floatingCode.checked, true);
    assert.equal(d.activeElement, floatingCode);
    assert.equal(floating.hidden, false);
    d.getElementById('form').setAttribute('aria-selected', 'false'); await wait(160);
    assert.equal(floating.hidden, true);
    d.getElementById('form').setAttribute('aria-selected', 'true'); await wait(160);
    assert.equal(floating.hidden, false);
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide', { persisted: true }));
    assert.equal(floating.hidden, true);
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pageshow', { persisted: true }));
    assert.equal(floating.hidden, false);
    assert.equal(requests, 34);
  } finally { dom.window.close(); }
});
test('実際に確認したDOMへコード単位で配置し、クリック伝播・HTML注入を防ぐ', async () => {
  const requests = [];
  const dom = await setup((url, options) => { requests.push({ url, options }); return good(url); });
  try {
    const d = dom.window.document;
    assert.equal(d.getElementById('nrfd-root').nextElementSibling.getAttribute('data-testid'), 'appForm');
    assert.equal(requests.length, 34); assert.ok(requests.every(r => r.options.method === 'GET'));
    assert.ok(requests.every(r => r.options.headers['X-Requested-With'] === 'XMLHttpRequest'));
    assert.equal(d.querySelectorAll('button.nrfd-chip').length, 2);
    const chip = d.querySelector('[data-testid="field-A"] > .nrfd-field-info > button.nrfd-chip');
    assert.equal(chip.textContent, '変更 2');
    let bubbled = false; d.querySelector('[data-testid="field-A"]').addEventListener('click', () => { bubbled = true; });
    chip.focus(); chip.click(); assert.equal(bubbled, false);
    assert.match(d.querySelector('dialog').textContent, /必須項目/);
    assert.match(d.querySelector('dialog').textContent, /<img src=x onerror=alert\(1\)>/);
    assert.equal(d.querySelector('dialog img'), null);
    await wait(200);
    d.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel', { cancelable: true }));
    assert.equal(d.querySelector('dialog'), null);
    assert.equal(d.activeElement, chip);
    d.querySelector('.nrfd-deleted').click(); assert.match(d.querySelector('dialog').textContent, /C/);
  } finally { dom.window.close(); }
});
test('取得エラーを差分なしや全件追加とせず、前回チップを消す', async () => {
  let fail = false;
  const dom = await setup(url => fail ? Promise.resolve({ ok: false, status: 403, json: async () => ({ code: 'CB_NO02' }) }) : good(url));
  try {
    const d = dom.window.document; fail = true;
    [...d.querySelectorAll('#nrfd-root button')].find(b => b.textContent === '設定を再取得').click(); await wait(30);
    assert.equal(d.querySelectorAll('button.nrfd-chip').length, 0);
    assert.equal(d.querySelector('.nrfd-status').dataset.error, 'true');
    assert.match(d.querySelector('.nrfd-status').textContent, /CB_NO02/);
    assert.equal(d.querySelector('.nrfd-added').textContent, '追加 —');
  } finally { dom.window.close(); }
});
test('再描画・タブ切替でチップが重複せず、APIを連打しない', async () => {
  let count = 0; const dom = await setup(url => { count++; return good(url); });
  try {
    const d = dom.window.document;
    const old = d.querySelector('[data-testid="field-A"]'); const replacement = old.cloneNode(true);
    replacement.querySelector('.nrfd-chip').remove(); old.replaceWith(replacement); await wait(200);
    assert.equal(d.querySelectorAll('button.nrfd-chip').length, 2); assert.equal(count, 34);
    d.getElementById('form').setAttribute('aria-selected', 'false'); await wait(200);
    assert.equal(d.getElementById('nrfd-root').hidden, false); assert.equal(d.querySelectorAll('button.nrfd-chip').length, 0);
    d.getElementById('form').setAttribute('aria-selected', 'true'); await wait(200);
    assert.equal(d.querySelectorAll('button.nrfd-chip').length, 2); assert.equal(count, 34);
  } finally { dom.window.close(); }
});
test('ゲストスペースのAPIへGETし、未配置差分も一覧へ残す', async () => {
  const urls = [];
  const dom = await setup(url => { urls.push(url); return good(url).then(async r => ({ ...r, json: async () => {
    const data = await r.json(); if (url.includes('/preview/') && data.properties) data.properties.Unmounted = f('Unmounted'); return data;
  } })); }, '/k/guest/5/admin/app/flow?app=12');
  try {
    const d = dom.window.document;
    assert.ok(urls.every(u => u.startsWith('/k/guest/5/v1/')));
    assert.match(d.querySelector('.nrfd-status').textContent, /配置できない 1 件/);
    d.querySelector('.nrfd-added').click(); assert.match(d.querySelector('dialog').textContent, /Unmounted/);
    d.querySelector('[data-testid="formSaveButton"]').click(); assert.match(d.querySelector('.nrfd-status').textContent, /保存が完了/);
  } finally { dom.window.close(); }
});
test('カテゴリ選択・全カテゴリ・一覧の名称変更と左右比較を表示', async () => {
  const dom = await setup(good);
  try {
    const d = dom.window.document, select = d.querySelector('[aria-label="比較カテゴリ"]');
    select.value = 'views'; select.dispatchEvent(new dom.window.Event('change'));
    assert.match(d.querySelector('.nrfd-status').textContent, /一覧：1 項目に差分/);
    [...d.querySelectorAll('#nrfd-root button')].find(b => b.textContent === '差分一覧').click();
    d.querySelector('.nrfd-list button').click();
    assert.match(d.querySelector('dialog').textContent, /進行中案件/); assert.match(d.querySelector('dialog').textContent, /案件一覧/);
    [...d.querySelectorAll('dialog button')].find(b => b.textContent === '全カテゴリへ').click();
    assert.equal(d.querySelectorAll('.nrfd-summary button').length, 16);
    assert.match(d.querySelector('dialog').textContent, /APIラボ/);
    const acl = [...d.querySelectorAll('.nrfd-summary button')].find(b => b.textContent.startsWith('アクセス権：アプリ'));
    acl.click(); d.querySelector('.nrfd-list button').click();
    assert.match(d.querySelector('dialog').textContent, /レコード追加：いいえ/);
  } finally { dom.window.close(); }
});
test('カテゴリ単位の失敗と一部比較不可を全カテゴリ画面に表示', async () => {
  const dom = await setup(async url => {
    if (url.includes('/app/views.json')) return { ok: false, status: 403, json: async () => ({ code: 'CB_NO02' }) };
    const response = await good(url), data = await response.json();
    if (data.actions && !Array.isArray(data.actions)) for (const action of Object.values(data.actions)) { action.destApp = null; action.mappings = null; }
    return { ...response, json: async () => data };
  });
  try {
    const d = dom.window.document;
    assert.match(d.querySelector('.nrfd-status').textContent, /1 カテゴリが取得失敗/);
    openCategory(dom, 'all');
    const cards = [...d.querySelectorAll('.nrfd-summary button')];
    assert.match(cards.find(b => b.textContent.startsWith('一覧')).textContent, /取得失敗/);
    assert.match(cards.find(b => b.textContent.startsWith('アプリアクション')).textContent, /一部比較不可/);
    cards.find(b => b.textContent.startsWith('一覧')).click();
    assert.match(d.querySelector('dialog').textContent, /CB_NO02/);
    assert.doesNotMatch(d.querySelector('dialog').textContent, /対象の差分はありません/);
  } finally { dom.window.close(); }
});
test('設定タブでも共通タブバーの直後に表示し、フォームチップはフォーム時だけ', async () => {
  const dom = await setup(good);
  try {
    const d = dom.window.document;
    const tabs = d.createElement('div'); tabs.setAttribute('role', 'tablist');
    const formTab = d.getElementById('form'); formTab.before(tabs); tabs.append(formTab);
    formTab.setAttribute('aria-selected', 'false');
    d.querySelector('[role="tabpanel"]').remove();
    await wait(200);
    assert.equal(tabs.nextElementSibling.id, 'nrfd-root');
    assert.equal(d.querySelector('#nrfd-root').hidden, false);
    assert.equal(d.querySelectorAll('button.nrfd-chip').length, 0);
  } finally { dom.window.close(); }
});
test('レイアウトを両側に再現し、倍率・対応位置・HTMLを実行しないラベルを確認', async () => {
  let count = 0;
  const dom = await setup(async url => {
    count++; const response = await good(url), data = await response.json();
    if (data.layout) data.layout.push({ type: 'GROUP', code: 'G', layout: [{ type: 'ROW', fields: [
      { type: 'LABEL', label: '<b>案内</b><img src="https://example.invalid/pixel" onerror="alert(1)"><script>alert(1)</script>', size: { width: '240' } },
      { type: 'SPACER', elementId: 'S', size: { width: '100', height: '80' } }, { type: 'HR', size: { width: '200' } }
    ] }] }, { type: 'SUBTABLE', code: 'T', fields: [{ type: 'NUMBER', code: 'N', size: { width: '120' } }] });
    return { ...response, json: async () => data };
  });
  try {
    const d = dom.window.document; selectCategory(dom, 'layout');
    const opener = [...d.querySelectorAll('#nrfd-root button')].find(b => b.textContent === 'フォーム配置を見る');
    opener.focus(); opener.click();
    assert.equal(d.querySelectorAll('.nrfd-layout-side').length, 2);
    assert.equal(d.querySelectorAll('.nrfd-layout-container').length, 4);
    assert.equal(d.querySelectorAll('dialog img, dialog script, dialog iframe').length, 0);
    assert.match(d.querySelector('.nrfd-layout-label').textContent, /案内/);
    assert.equal(d.querySelector('.nrfd-layout-node[data-code="A"]').style.width, '200px');
    const zoom = d.querySelector('[aria-label="レイアウト表示倍率"]'); zoom.value = '50'; zoom.dispatchEvent(new dom.window.Event('change'));
    assert.ok([...d.querySelectorAll('.nrfd-layout-canvas')].every(n => n.style.zoom === '0.5'));
    d.querySelector('.nrfd-layout-codebutton').click(); assert.equal(d.querySelectorAll('.nrfd-layout-selected').length, 2);
    assert.equal(count, 34, '表示操作では再取得しない');
    d.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel', { cancelable: true })); assert.equal(d.activeElement, opener);
  } finally { dom.window.close(); }
});
test('配置差分ゼロでも左右表示でき、項目取得失敗やリビジョン競合時は描画しない', async () => {
  for (const failure of ['', 'fields', 'revision']) {
    const dom = await setup(async url => {
      const response = await good(url), data = await response.json();
      if (data.properties && failure === 'fields') return { ok: false, status: 403, json: async () => ({ code: 'DENIED' }) };
      if (data.layout) { data.layout = []; if (failure === 'revision') data.revision = '999'; }
      return { ...response, json: async () => data };
    });
    try {
      const d = dom.window.document; openCategory(dom, 'layout');
      if (failure) { assert.equal(d.querySelectorAll('.nrfd-layout-side').length, 0); assert.match(d.querySelector('dialog').textContent, /取得が必要/); }
      else { assert.equal(d.querySelectorAll('.nrfd-layout-side').length, 2); assert.match(d.querySelector('dialog').textContent, /配置された項目はありません/); }
    } finally { dom.window.close(); }
  }
});


test('保存済み設定のホバー・コピー先色・計算式・フィールド数、再取得失敗時の除去', async () => {
  let count = 0, fail = false;
  const dom = await setup(async url => {
    count++;
    if (fail && url.includes('/form/fields')) return { ok: false, status: 403, json: async () => ({ code: 'DENIED' }) };
    const response = await good(url), data = await response.json();
    if (data.properties) data.properties = {
      A: { type: 'SINGLE_LINE_TEXT', code: 'A', label: '同名', lookup: { relatedApp: { app: '99', code: '' }, relatedKeyField: 'Key', fieldMappings: [{ relatedField: '<img src=x onerror=alert(1)>', field: 'B' }], lookupPickerFields: ['Key'], filterCond: '', sort: 'Key asc' } },
      B: { type: 'SINGLE_LINE_TEXT', code: 'B', label: '同名', expression: '"<script>alert(1)</script>"' }
    };
    return { ...response, json: async () => data };
  });
  try {
    const d = dom.window.document, a = d.querySelector('[data-testid="field-A"]'), b = d.querySelector('[data-testid="field-B"]');
    assert.equal(count, 34); assert.equal(d.querySelectorAll('.nrfd-chip').length, 0, '差分なしでも概要を表示');
    assert.match(d.querySelector('.nrfd-field-count').textContent, /フィールド 2/);
    assert.equal(a.querySelector('.nrfd-info-segment').style.getPropertyValue('--nrfd-fill'), b.querySelector('.nrfd-info-segment').style.getPropertyValue('--nrfd-fill'));
    a.dispatchEvent(new dom.window.Event('pointerenter'));
    assert.equal(d.querySelector('[role="tooltip"]'), null, 'フィールド本体では概要を開かない');
    const setting = a.querySelector('[role="button"]');
    let opened = 0; setting.addEventListener('click', () => opened++); setting.click();
    assert.equal(opened, 1); assert.equal(d.querySelector('[role="tooltip"]'), null);
    a.querySelector('.nrfd-info-button').dispatchEvent(new dom.window.Event('pointerenter'));
    assert.match(d.querySelector('[role="tooltip"]').textContent, /保存済みプレビュー/);
    assert.match(d.querySelector('[role="tooltip"]').textContent, /Key → A/);
    d.dispatchEvent(new dom.window.Event('scroll'));
    assert.ok(d.querySelector('[role="tooltip"]'), 'フォーカス移動に伴うスクロールで概要を消さない');
    a.querySelector('.nrfd-info-button').dispatchEvent(new dom.window.Event('pointerleave'));
    d.querySelector('[role="tooltip"]').dispatchEvent(new dom.window.Event('pointerenter'));
    await wait(220); assert.ok(d.querySelector('[role="tooltip"]'), 'ポップアップへ移動しても読める');
    d.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(d.querySelector('[role="tooltip"]'), null);
    assert.ok([...b.querySelectorAll('.nrfd-info-segment')].some(segment => segment.textContent === 'fx'));
    assert.match(b.textContent, /L1 コピー先/);
    assert.equal(b.querySelectorAll('.nrfd-info-button').length, 1, '複数の概要を一つの操作対象にまとめる');
    d.querySelector('[aria-label="フィールドコード"]').click();
    assert.equal(b.querySelectorAll('.nrfd-info-button').length, 1);
    assert.equal(b.querySelector('.nrfd-code-segment').textContent, 'B');
    const info = b.querySelector('.nrfd-info-button'); info.focus();
    assert.match(d.querySelector('[role="tooltip"]').textContent, /計算式/);
    let bubbled = false; b.addEventListener('click', () => { bubbled = true; }); info.click();
    assert.equal(bubbled, false); assert.equal(d.querySelector('[role="tooltip"]'), null);
    assert.match(d.querySelector('dialog').textContent, /同名（A）/);
    assert.match(d.querySelector('dialog').textContent, /<script>alert\(1\)<\/script>/);
    assert.equal(d.querySelector('dialog img, dialog script'), null);
    d.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel', { cancelable: true }));
    assert.equal(d.activeElement, info); assert.equal(d.querySelector('[role="tooltip"]'), null);
    assert.equal(count, 34, '概要の操作では追加APIなし');
    d.getElementById('form').setAttribute('aria-selected', 'false'); await wait(180);
    assert.equal(d.querySelectorAll('.nrfd-info-button').length, 0);
    d.getElementById('form').setAttribute('aria-selected', 'true'); await wait(180);
    assert.equal(d.querySelectorAll('.nrfd-info-button').length, 2);
    fail = true; [...d.querySelectorAll('#nrfd-root button')].find(b => b.textContent === '設定を再取得').click(); await wait(50);
    assert.equal(d.querySelectorAll('.nrfd-info-button').length, 0);
    assert.match(d.querySelector('.nrfd-field-count').textContent, /取得不可/);
  } finally { dom.window.close(); }
});


test('設定チップとフィールドコードを独立して切り替え、要素IDをチップで確認', async () => {
  let count = 0;
  const dom = await setup(async url => {
    count++; const response = await good(url), data = await response.json();
    if (data.layout) data.layout = [{ type: 'ROW', fields: [
      { type: 'SPACER', elementId: 'space1', size: { width: '200', height: '80' } },
      { type: 'LABEL', elementId: 'label1', label: '<b>案内</b>', size: { width: '150' } },
      { type: 'HR', elementId: 'line1', size: { width: '300' } },
      { type: 'LABEL', elementId: 'unknown', label: '未照合' }
    ] }];
    return { ...response, json: async () => data };
  });
  try {
    const d = dom.window.document;
    const click = text => [...d.querySelectorAll('#nrfd-root button')].find(b => b.textContent === text).click();
    for (const [id, type] of [['space1','spacer'],['label1','label'],['line1','hr']]) {
      const container = d.createElement('div'); container.dataset.testid = 'field-' + id;
      const presenter = d.createElement('div'); presenter.dataset.testid = type + '-' + id; container.append(presenter); d.body.append(container);
    }
    await wait(180);
    assert.equal(d.querySelectorAll('.nrfd-info-button[aria-label*="要素ID："]').length, 0);
    const a = d.querySelector('[data-testid="field-A"]');
    a.dispatchEvent(new dom.window.Event('pointerenter'));
    assert.equal(d.querySelector('[role="tooltip"]'), null);
    d.querySelector('[aria-label="フィールドコード"]').click();
    assert.equal(d.querySelectorAll('.nrfd-info-button[aria-label*="要素ID："]').length, 3);
    assert.match(d.querySelector('.nrfd-status').textContent, /直接表示できない要素ID 1 件/);
    a.querySelector('.nrfd-info-button').dispatchEvent(new dom.window.Event('pointerenter'));
    assert.equal(d.querySelector('[role="tooltip"]'), null);
    a.querySelector('.nrfd-info-button').click();
    assert.equal(d.querySelector('dialog'), null);
    assert.equal(a.querySelector('.nrfd-info-button').title, 'フィールドコード：A');
    assert.equal(a.querySelector('.nrfd-info-button').textContent, 'A');
    const chips = d.querySelectorAll('.nrfd-chip').length;
    d.querySelector('[aria-label="設定チップ"]').click();
    assert.equal(d.querySelector('[aria-label="設定チップ"]').checked, false);
    assert.equal(d.querySelector('[aria-label="フィールドコード"]').checked, true);
    assert.equal(d.querySelectorAll('.nrfd-info-button[aria-label*="要素ID："]').length, 3);
    assert.equal(a.querySelector('.nrfd-info-button').textContent, 'A');
    assert.equal(d.querySelectorAll('.nrfd-chip').length, chips);
    assert.equal(d.querySelector('[role="tooltip"]'), null);
    d.querySelector('[aria-label="設定チップ"]').click();
    assert.equal(a.querySelector('.nrfd-info-button').textContent, 'A');
    assert.ok(![...d.querySelectorAll('#nrfd-root button')].some(b => /部品ID|要素ID一覧|レイアウト比較/.test(b.textContent)));
    d.querySelector('[aria-label="フィールドコード"]').click();
    assert.equal(d.querySelectorAll('.nrfd-info-button[aria-label*="要素ID："]').length, 0);
    d.querySelector('[aria-label="フィールドコード"]').click();
    const idChip = d.querySelector('.nrfd-info-button[aria-label*="要素ID：space1"]');
    assert.equal(idChip.textContent, 'space1');
    idChip.dispatchEvent(new dom.window.Event('pointerenter'));
    assert.equal(d.querySelector('[role="tooltip"]'), null);
    assert.equal(idChip.title, '要素ID：space1');
    idChip.click(); assert.equal(d.querySelector('dialog'), null);
    openCategory(dom, 'layout');
    assert.match(d.querySelector('dialog h2').textContent, /^フォーム配置$/);
    assert.equal(d.querySelectorAll('dialog .nrfd-table').length, 0);
    assert.doesNotMatch(d.querySelector('dialog').textContent, /配置の数値差分/);
    const unknown = [...d.querySelectorAll('dialog .nrfd-info-button')].find(b => b.getAttribute('aria-label').includes('unknown'));
    assert.equal(unknown.textContent, 'unknown');
    unknown.dispatchEvent(new dom.window.Event('pointerenter'));
    assert.match(d.querySelector('[role="tooltip"]').textContent, /要素ID：unknown/);
    assert.ok(d.querySelector('dialog').contains(d.querySelector('[role="tooltip"]')));
    assert.equal(count, 34);
  } finally { dom.window.close(); }
});
