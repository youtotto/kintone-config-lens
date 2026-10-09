const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CATEGORIES, compareCategory, collectSettings, formatSetting } = require('../kintoneConfigLens.user.js');
const { fixtures, responseFor, good } = require('./fixtures.cjs');
const category = id => CATEGORIES.find(c => c.id === id);
const compare = (id, a, b) => compareCategory(category(id), { revision: '8', ...a }, { revision: '9', ...b });

test('正式16カテゴリの変更検出・リビジョンのみの変更を除外', () => {
  for (const c of CATEGORIES) {
    assert.ok(compare(c.id, fixtures(false)[c.id], fixtures(true)[c.id]).entries.length, c.id);
    assert.deepEqual(compare(c.id, fixtures(false)[c.id], fixtures(false)[c.id]).entries, [], c.id);
  }
});
test('一覧・グラフ・アクションの名称変更をIDで対応付ける', () => {
  for (const id of ['views', 'reports', 'actions']) {
    const c = category(id), old = Object.values(fixtures()[id][c.collection])[0];
    const r = compare(id, { [c.collection]: { old } }, { [c.collection]: { new: { ...old, name: '新名称' } } });
    assert.equal(r.entries.length, 1); assert.equal(r.entries[0].kind, 'changed');
    assert.deepEqual(r.entries[0].rows, [{ path: ['name'], before: old.name, after: '新名称' }]);
  }
});
test('同名でもIDが異なれば追加・削除にし、ID欠落や重複は取得失敗にする', () => {
  const v = { id: '1', name: '同名' };
  const r = compare('views', { views: { a: v } }, { views: { a: { ...v, id: '2' } } });
  assert.deepEqual(r.entries.map(e => e.kind), ['deleted', 'added']);
  assert.throws(() => compare('views', { views: {} }, { views: { a: { name: 'test' } } }), /識別情報/);
  assert.throws(() => compare('views', { views: {} }, { views: { a: v, b: v } }), /重複/);
});
test('通知・権限・プロセスのアクション・JSは配列の順序を保持する', () => {
  for (const [id, key] of [['notifyRecord', 'notifications'], ['aclApp', 'rights'], ['aclRecord', 'rights'], ['process', 'actions']]) {
    const base = fixtures()[id], a = [{ name: 'A' }, { name: 'B' }];
    const r = compare(id, { ...base, [key]: a }, { ...base, [key]: [...a].reverse() });
    assert.equal(r.entries.length, 1, id); assert.deepEqual(r.entries[0].rows[0].after, [...a].reverse());
  }
  const a = fixtures().customize, js = [{ type: 'URL', url: 'A' }, { type: 'URL', url: 'B' }];
  assert.equal(compare('customize', { ...a, desktop: { js, css: [] } }, { ...a, desktop: { js: [...js].reverse(), css: [] } }).entries.length, 1);
});
test('フィールド権限とプラグインは外側の配列順を差分にせず、内側の優先順は保持', () => {
  for (const [id, key, idKey] of [['aclField', 'rights', 'code'], ['plugins', 'plugins', 'id']]) {
    const rows = [{ [idKey]: 'A', entities: [1, 2] }, { [idKey]: 'B', entities: [3] }];
    assert.equal(compare(id, { [key]: rows }, { [key]: [...rows].reverse() }).entries.length, 0);
    assert.equal(compare(id, { [key]: rows }, { [key]: [{ ...rows[0], entities: [2, 1] }, rows[1]] }).entries.length, 1);
  }
});
test('未設定プロセスのnullは正常、アクションコピー先のnullは一部比較不可', () => {
  assert.equal(compare('process', { enable: false, states: null, actions: null }, { enable: false, states: null, actions: null }).state, 'ok');
  const a = { actions: { x: { id: '1', name: 'x', destApp: null, mappings: null } } };
  const r = compare('actions', a, a); assert.equal(r.state, 'partial'); assert.equal(r.entries.length, 0); assert.ok(r.warnings.length);
});
test('未設定リマインダーのtimezone:nullは正常で、初回設定も検知する', () => {
  const empty = { notifications: [], timezone: null };
  assert.equal(compare('notifyReminder', empty, empty).state, 'ok');
  assert.deepEqual(compare('notifyReminder', empty, empty).entries, []);
  assert.equal(compare('notifyReminder', empty, { ...empty, timezone: 'Asia/Tokyo' }).entries[0].code, 'timezone');
});
test('リビジョンや必須キーの欠落・誤った型を正常扱いしない', () => {
  assert.throws(() => compareCategory(category('views'), { views: {} }, { revision: '1', views: {} }), /リビジョン/);
  assert.throws(() => compare('views', { views: {} }, { views: [] }), /応答形式/);
  assert.throws(() => compare('notifyApp', { notifications: [] }, { notifications: [] }), /notifyToCommenter/);
});
test('GETのみ・最大同時6リクエスト・全カテゴリと終端リビジョンの取得', async () => {
  let active = 0, max = 0; const requests = [];
  const result = await collectSettings({ app: '12', prefix: '/k/guest/5' }, new AbortController().signal, async (url, options) => {
    requests.push({ url, options }); max = Math.max(max, ++active);
    await new Promise(resolve => setImmediate(resolve)); active--; return good(url);
  });
  assert.equal(result.length, 16); assert.ok(result.every(r => r.state === 'ok'));
  assert.equal(requests.length, 34); assert.ok(max <= 6);
  assert.ok(requests.every(r => r.url.startsWith('/k/guest/5/v1/') && r.options.method === 'GET' && r.options.credentials === 'same-origin'));
  assert.ok(requests.some(r => r.url.includes('/preview/record/acl.json')));
});
test('一部APIの403は他カテゴリを保持、片側失敗を全件追加にしない', async () => {
  const result = await collectSettings({ app: '12', prefix: '/k' }, new AbortController().signal,
    url => url.includes('/preview/app/views.json') ? Promise.resolve({ ok: false, status: 403, json: async () => ({ code: 'CB_NO02' }) }) : good(url));
  assert.equal(result.find(r => r.category.id === 'views').state, 'error');
  assert.deepEqual(result.find(r => r.category.id === 'views').entries, []);
  assert.equal(result.filter(r => r.state === 'ok').length, 15);
});
test('取得途中・終端でのリビジョン変化を検知し古い差分を表示しない', async () => {
  for (const atEnd of [false, true]) {
    let calls = 0;
    const result = await collectSettings({ app: '12', prefix: '/k' }, new AbortController().signal, async url => {
      const data = responseFor(url); calls++;
      if (atEnd ? calls > 32 : url.includes('/app/views.json')) data.revision = '99';
      return { ok: true, json: async () => data };
    });
    assert.ok(result.every(r => r.state === 'error' && r.entries.length === 0));
    assert.match(result[0].error, /取得中に設定が変更/);
  }
});
test('通信中断後はキューのAPIを新規送信しない', async () => {
  const controller = new AbortController(); let count = 0;
  await assert.rejects(collectSettings({ app: '1', prefix: '/k' }, controller.signal, async url => {
    count++; controller.abort(); return good(url);
  }), /中断/);
  assert.ok(count <= 6);
});
test('配列の比較表は対象・操作を日本語で表示し、特殊なキー名も値として扱う', () => {
  assert.match(formatSetting([{ entity: { type: 'GROUP', code: 'everyone' }, recordViewable: true }]), /レコード閲覧：はい/);
  assert.match(formatSetting(JSON.parse('{"__proto__":"x","constructor":"y"}')), /__proto__：x/);
});
