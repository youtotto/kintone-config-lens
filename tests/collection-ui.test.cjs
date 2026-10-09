const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require.resolve('../kintoneConfigLens.user.js'), 'utf8');
const { good } = require('./fixtures.cjs');
const { carryKey } = require('../kintoneConfigLens.user.js');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const row = name => `<tr><td><button>並べ替え</button></td><td>${name}</td><td><button>編集</button></td></tr>`;
const markup = `<main><nav role="tablist">${['form','view','report','settings'].map(id => `<button role="tab" id="${id}" aria-selected="${id === 'view'}">${id}</button>`).join('')}</nav><section role="tabpanel" aria-labelledby="view"><div data-testid="viewTable"><table><tbody>${row('進行中案件')}${row('（すべて）')}</tbody></table></div></section><section role="tabpanel" aria-labelledby="report"><div data-testid="reportTable"><table><tbody>${row('集計')}</tbody></table></div></section></main>`;
async function setup(fetcher = good, cached = null) {
  const dom = new JSDOM(markup, { url: 'https://example.cybozu.com/k/admin/app/flow?app=12', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.requests = 0; dom.window.fetch = url => { dom.requests++; return fetcher(url); };
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  if (cached) dom.window.sessionStorage.setItem(carryKey({ app: '12', prefix: '/k' }), cached);
  dom.window.eval(source); await wait(20); return dom;
}
async function load(dom) { [...dom.window.document.querySelectorAll('button')].find(b => b.textContent === '設定を読み込む').click(); await wait(40); }
function tab(dom, id) { const d = dom.window.document; for (const t of d.querySelectorAll('[role="tab"]')) t.setAttribute('aria-selected', String(t.id === id)); }

test('一覧行とタブは取得後だけ表示し、概要ホバー・差分・標準操作を追加APIなしで併用', async () => {
  const dom = await setup();
  try {
    const d = dom.window.document;
    assert.equal(d.querySelectorAll('.nrfd-row-tools,.nrfd-tab-chip').length, 0);
    await load(dom);
    assert.equal(dom.requests, 34); assert.equal(d.querySelectorAll('.nrfd-tab-chip').length, 4);
    assert.equal(d.querySelector('#settings .nrfd-tab-chip').textContent, '変更あり');
    assert.match(d.querySelector('.nrfd-status').textContent, /差分あり \d+カテゴリ ／ 全16カテゴリ/);
    assert.equal(d.querySelectorAll('#nrfd-root input[type="checkbox"]').length, 0);
    const rows = d.querySelectorAll('[data-testid="viewTable"] tr');
    assert.equal(rows[0].querySelector('.nrfd-row-badge').textContent, '変更');
    assert.equal(rows[1].querySelector('.nrfd-row-tools'), null, 'APIにない組み込み一覧は変更なしと誤表示しない');
    rows[0].dispatchEvent(new dom.window.Event('pointerenter')); await wait(270);
    assert.match(d.querySelector('[role="tooltip"]').textContent, /B → A/);
    assert.match(d.querySelector('[role="tooltip"]').textContent, /一覧ID：10/);
    rows[0].dispatchEvent(new dom.window.Event('pointerdown')); assert.equal(d.querySelector('[role="tooltip"]'), null);
    let edits = 0; const edit = rows[0].lastElementChild.querySelector('button'); edit.addEventListener('click', () => edits++); edit.click(); assert.equal(edits, 1);
    rows[0].querySelector('.nrfd-row-badge').click(); assert.match(d.querySelector('dialog').textContent, /案件一覧/);
    d.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel', { cancelable: true }));
    d.querySelector('#report').focus(); assert.match(d.querySelector('[role="tooltip"]').textContent, /集計/);
    assert.equal(d.querySelector('#view').getAttribute('aria-selected'), 'true', 'ホバー/フォーカスではタブを切り替えない');
    d.querySelector('[aria-label="差分チップ"]').click(); d.querySelector('[aria-label="設定チップ"]').click();
    assert.equal(d.querySelectorAll('.nrfd-row-tools,.nrfd-tab-chip').length, 0);
    assert.equal(d.querySelector('.nrfd-floating-tools').hidden, false);
    rows[0].dispatchEvent(new dom.window.Event('pointerenter')); await wait(270); assert.equal(d.querySelector('[role="tooltip"]'), null);
    tab(dom, 'settings'); await wait(160);
    assert.equal(d.querySelector('.nrfd-floating-tools').hidden, false, '設定タブでも固定バーから差分を再表示できる');
    d.querySelector('[aria-label="差分チップ"]').click();
    assert.equal(d.querySelectorAll('.nrfd-tab-chip').length, 4);
    assert.equal(dom.requests, 34);
  } finally { dom.window.close(); }
});

test('グラフ概要は分類・集計・絞り込みを表示し、同名・未保存改名には推測で付けない', async () => {
  const dom = await setup(async url => { const response = await good(url), data = await response.json(); if (data.reports) { data.reports.集計.groups = [{ code: '日付', per: 'MONTH' }]; data.reports.集計.aggregations = [{ type: 'SUM', code: '金額' }]; data.reports.集計.filterCond = '金額 > 0'; } return { ...response, json: async () => data }; });
  try {
    await load(dom); tab(dom, 'report'); await wait(160);
    const d = dom.window.document, row = d.querySelector('[data-testid="reportTable"] tr');
    row.querySelector('.nrfd-info-button').click();
    assert.match(d.querySelector('dialog').textContent, /日付（月）/); assert.match(d.querySelector('dialog').textContent, /合計：金額/); assert.match(d.querySelector('dialog').textContent, /金額 > 0/);
    d.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel', { cancelable: true }));
    row.children[1].textContent = '未保存の名前'; await wait(160); assert.equal(row.querySelector('.nrfd-row-tools'), null);
    row.children[1].textContent = '集計'; row.after(row.cloneNode(true)); await wait(160);
    assert.equal(d.querySelectorAll('[data-testid="reportTable"] .nrfd-row-tools').length, 0);
    assert.equal(dom.requests, 34);
  } finally { dom.window.close(); }
});

test('取得失敗と保存後の古い比較を区別し、古い行へ現在の状態として付けない', async () => {
  const dom = await setup(async url => url.includes('/app/reports.json') ? { ok: false, status: 403, json: async () => ({ code: 'DENIED' }) } : good(url));
  try {
    await load(dom); const d = dom.window.document;
    assert.equal(d.querySelector('#report .nrfd-tab-chip').textContent, '取得失敗');
    d.dispatchEvent(new dom.window.Event('nrfd-save-attempt'));
    assert.equal(d.querySelector('#view .nrfd-tab-chip').textContent, '比較未更新');
    assert.equal(d.querySelectorAll('.nrfd-row-tools').length, 0);
    d.querySelector('#view').focus(); assert.match(d.querySelector('[role="tooltip"]').textContent, /比較未更新/);
  } finally { dom.window.close(); }
});

test('変更なしの一覧も概要を表示し、保存済みスナップショットを0APIで復元', async () => {
  const dom = await setup(async url => { const response = await good(url), data = await response.json(); if (data.views) data.views = { 進行中案件: { id: '10', name: '進行中案件', type: 'CALENDAR', date: '日付', title: '件名', filterCond: '', sort: '' } }; return { ...response, json: async () => data }; });
  let restored;
  try {
    await load(dom); dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide'));
    const cached = dom.window.sessionStorage.getItem(carryKey({ app: '12', prefix: '/k' })); restored = await setup(good, cached);
    const d = restored.window.document;
    assert.equal(restored.requests, 0); assert.equal(d.querySelector('#view .nrfd-tab-chip').textContent, '変更なし');
    assert.equal(d.querySelector('.nrfd-row-badge').textContent, '変更なし');
    d.querySelector('.nrfd-row-tools button').click(); assert.match(d.querySelector('dialog').textContent, /カレンダー/); assert.match(d.querySelector('dialog').textContent, /タイトル件名/);
  } finally { dom.window.close(); restored?.window.close(); }
});
