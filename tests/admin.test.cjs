const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require.resolve('../kintoneConfigLens.user.js'), 'utf8');
const { adminContext, adminUrl, ADMIN_GROUPS } = require('../kintoneConfigLens.user.js');
const wait = () => new Promise(resolve => setTimeout(resolve, 140));
const fixture = '<main><h1>設定画面</h1><input aria-label="設定名"><textarea></textarea><div contenteditable="true">編集</div></main>';
function setup(path, markup = fixture) {
  const dom = new JSDOM(markup, { url: 'https://example.cybozu.com' + path, runScripts: 'outside-only', pretendToBeVisual: true });
  dom.requests = 0; dom.window.fetch = () => { dom.requests++; throw new Error('Navigation must not fetch settings'); };
  dom.window.eval(source); return dom;
}
function hotkey(dom, key = '2', extra = {}, target = dom.window) {
  const event = new dom.window.KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true, ...extra });
  target.dispatchEvent(event); return event;
}

test('QuickTabs全10ページ・flowのURLと通常/ゲストのアプリ識別を往復できる', () => {
  for (const prefix of ['/k', '/k/guest/7']) {
    const ctx = { prefix, app: '12' };
    assert.deepEqual(adminContext('https://example.cybozu.com' + adminUrl(ctx, 'flow')), { ...ctx, page: 'flow', group: null });
    for (const group of ADMIN_GROUPS) for (const [page] of group.pages) {
      assert.deepEqual(adminContext('https://example.cybozu.com' + adminUrl(ctx, page)), { ...ctx, page, group: group.id });
    }
  }
  assert.equal(adminContext('https://example.cybozu.com/k/admin/app/notification?trigger=record&other=1&app=12#top').page, 'notification:record');
  assert.equal(adminContext('https://example.kintone.com/k/admin/app/acl/field/?app=12').page, 'acl/field');
  for (const path of ['/k/12/', '/k/admin/app/flowXYZ?app=12', '/k/admin/app/acl/app?app=bad', '/k/admin/app/acl/app?app=0', '/k/admin/app/notification?app=12&trigger=invalid', '/k/admin/app/plugin?app=12', '/k/admin/app/12/plugin/?app=99', '/k/admin/app/12/plugin/#/config/abc', '/k/admin/app/customize/other?app=12']) {
    assert.equal(adminContext('https://example.cybozu.com' + path), null, path);
  }
});

test('各設定ページには同一カテゴリのタブだけを追加しAPIは0回', () => {
  for (const group of ADMIN_GROUPS) for (const [page, label] of group.pages) {
    const ctx = { prefix: '/k', app: '12' }, dom = setup(adminUrl(ctx, page));
    try {
      const d = dom.window.document, nav = d.querySelector('#nrfd-admin-nav');
      assert.ok(nav); assert.equal(nav.parentElement.tagName, 'MAIN');
      assert.equal(nav.querySelector('[aria-current="page"]').textContent, label);
      assert.equal(nav.querySelectorAll('[data-shortcut]').length, group.pages.length);
      assert.equal(nav.querySelectorAll('.nrfd-admin-extra a').length, group.id === 'customize' ? 0 : 2);
      const pageLinks = [...nav.querySelectorAll('a')].filter(a => !a.closest('.nrfd-admin-extra'));
      assert.deepEqual(pageLinks.map(a => a.getAttribute('href')), group.pages.map(([id]) => adminUrl(ctx, id)), 'カテゴリ横断や独自の戻るリンクを追加しない');
      assert.equal(d.querySelector('#nrfd-root'), null, '個別設定ページに比較機能は起動しない');
      assert.equal(dom.requests, 0);
    } finally { dom.window.close(); }
  }
});

test('ゲストスペースを維持し共通管理リンクだけ同じ環境の管理へ開く', () => {
  const dom = setup('/k/guest/7/admin/app/acl/app?app=12');
  try {
    const nav = dom.window.document.querySelector('#nrfd-admin-nav');
    for (const a of nav.querySelectorAll('a')) {
      assert.equal(new URL(a.href).origin, 'https://example.cybozu.com');
      if (a.closest('.nrfd-admin-extra')) { assert.equal(a.target, '_blank'); assert.match(a.rel, /noopener/); }
      else assert.ok(a.getAttribute('href').startsWith('/k/guest/7/admin/app/'));
    }
  } finally { dom.window.close(); }
});

test('Alt+数字は1回だけ通常リンクをクリックし、入力中・モーダル・複合キーでは動かない', async () => {
  const dom = setup('/k/admin/app/customize?app=12');
  try {
    const d = dom.window.document, clicks = [];
    d.addEventListener('click', e => { if (e.target.closest('a')) { clicks.push(e.target.closest('a').getAttribute('href')); e.preventDefault(); } });
    assert.equal(hotkey(dom, '4').defaultPrevented, true); assert.deepEqual(clicks, ['/k/admin/app/webhook?app=12']);
    for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { repeat: true }, { isComposing: true }]) hotkey(dom, '2', options);
    for (const input of d.querySelectorAll('input,textarea,[contenteditable]')) hotkey(dom, '2', {}, input);
    const dialog = d.createElement('dialog'); dialog.open = true; d.body.append(dialog); hotkey(dom); dialog.remove();
    hotkey(dom, '5'); assert.equal(clicks.length, 1);
    d.querySelector('h1').textContent = '再描画'; await wait();
    dom.window.eval(source); hotkey(dom, '2');
    assert.equal(clicks.length, 2, '再描画・重複実行でもショートカットを多重登録しない');
    assert.equal(d.querySelectorAll('#nrfd-admin-nav').length, 1);
    assert.equal(dom.requests, 0);
  } finally { dom.window.close(); }
});

test('遅延描画・URL変更・再描画・ページキャッシュ復帰に追従しポーリングしない', async () => {
  const dom = setup('/k/admin/app/acl/app?app=12', '<div id="root"></div>');
  try {
    const d = dom.window.document;
    assert.equal(d.querySelector('#nrfd-admin-nav'), null);
    d.querySelector('#root').innerHTML = fixture; await wait();
    assert.ok(d.querySelector('#nrfd-admin-nav'));
    dom.window.history.pushState({}, '', '/k/admin/app/notification?trigger=reminder&app=12');
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
    assert.equal(d.querySelector('[aria-current="page"]').textContent, 'リマインダー');
    dom.window.history.pushState({}, '', '/k/admin/app/flow?app=12#section=settings');
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
    assert.equal(d.querySelector('#nrfd-admin-nav'), null);
    dom.window.history.pushState({}, '', '/k/admin/app/notification?app=12&trigger=record');
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate'));
    assert.equal(d.querySelector('[aria-current="page"]').textContent, 'レコードの条件通知');
    d.querySelector('main').remove(); d.querySelector('#root').innerHTML = fixture; await wait();
    assert.equal(d.querySelectorAll('#nrfd-admin-nav').length, 1);
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide', { persisted: true }));
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pageshow', { persisted: true }));
    assert.equal(d.querySelectorAll('#nrfd-admin-nav').length, 1);
    assert.equal(dom.requests, 0);
  } finally { dom.window.close(); }
});

test('旧QuickTabsが先/後に読み込まれても新しいバーとショートカットを重ねない', async () => {
  for (const before of [true, false]) {
    const old = '<div id="tm-admin-toolbar-row--acl-app" class="tm-admin-toolbar-row"><span>旧QuickTabs</span></div>';
    const dom = setup('/k/admin/app/acl/app?app=12', fixture + (before ? old : ''));
    try {
      const d = dom.window.document;
      if (!before) { d.body.insertAdjacentHTML('beforeend', old); await wait(); }
      assert.equal(d.querySelector('#nrfd-admin-nav').hidden, true);
      assert.equal(hotkey(dom).defaultPrevented, false);
      d.querySelector('.tm-admin-toolbar-row').remove(); await wait();
      assert.equal(d.querySelector('#nrfd-admin-nav').hidden, false);
      assert.equal(dom.requests, 0);
    } finally { dom.window.close(); }
  }
});

test('flowに移動用UIを追加せず、未取得と固定バーを維持', async () => {
  const dom = setup('/k/admin/app/flow?app=12', '<main><button role="tab" id="form" aria-selected="true">フォーム</button><button data-testid="formSaveButton">フォームを保存</button></main>');
  try {
    await wait(); const d = dom.window.document, nav = d.querySelector('#nrfd-admin-nav');
    assert.equal(nav, null);
    assert.equal(d.querySelector('.nrfd-floating-tools').hidden, false);
    assert.match(d.querySelector('.nrfd-status').textContent, /はじめに/);
    assert.equal(hotkey(dom).defaultPrevented, false, 'flowにAlt+数字を割り当てない');
    assert.equal(dom.requests, 0);
  } finally { dom.window.close(); }
});

test('対象外ページとプラグイン個別設定ではUIもAPI通信も追加しない', () => {
  for (const path of ['/k/12/', '/k/admin/app/12/plugin/#/config/test', '/k/admin/app/acl/app?app=bad']) {
    const dom = setup(path);
    try { assert.equal(dom.window.document.querySelector('[id^="nrfd-"]'), null); assert.equal(dom.requests, 0); }
    finally { dom.window.close(); }
  }
});
