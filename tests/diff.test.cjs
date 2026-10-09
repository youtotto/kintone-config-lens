const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compare, format, context } = require('../kintoneConfigLens.user.js');
const field = (code, extra = {}) => ({ type: 'SINGLE_LINE_TEXT', code, label: code, required: false, ...extra });

test('変更・追加・削除と名前が同じ別フィールドを区別する', () => {
  const result = compare({ A: field('A'), B: field('B') }, { A: field('A', { label: 'B', required: true }), C: field('C', { label: 'B' }) });
  assert.equal(result.length, 3);
  assert.deepEqual(Object.fromEntries(result.map(e => [e.code, e.kind])), { A: 'changed', B: 'deleted', C: 'added' });
  assert.equal(result.find(e => e.code === 'A').rows.length, 2);
});
test('オブジェクトのキー順だけの違いを差分にしない', () => {
  assert.deepEqual(compare({ A: field('A', { options: { X: { label: 'X', index: '0' }, Y: { label: 'Y', index: '1' } } }) },
    { A: field('A', { options: { Y: { index: '1', label: 'Y' }, X: { index: '0', label: 'X' } } }) }), []);
});
test('選択肢の並び替え・削除・追加は明示的な順序で表示', () => {
  const before = { X: { label: 'X', index: '0' }, Y: { label: 'Y', index: '1' } };
  const after = { Y: { label: 'Y', index: '0' }, Z: { label: 'Z', index: '1' } };
  const [e] = compare({ A: field('A', { options: before }) }, { A: field('A', { options: after }) });
  assert.equal(e.rows.length, 1); assert.equal(format(e.rows[0].after, ['options']), '1. Y\n2. Z');
});
test('テーブル内の変更を親に重複計上せず、追加・削除も比較', () => {
  const table = fields => field('T', { type: 'SUBTABLE', fields });
  const result = compare({ T: table({ A: field('A'), B: field('B') }) }, { T: table({ A: field('A', { required: true }), C: field('C') }) });
  assert.equal(result.length, 3); assert.ok(result.every(e => e.code !== 'T'));
  assert.equal(result.find(e => e.code === 'A').after.parent, 'T');
});
test('テーブル間の所属変更を検知', () => {
  const result = compare({ T: field('T', { type: 'SUBTABLE', fields: { A: field('A') } }), U: field('U', { type: 'SUBTABLE', fields: {} }) },
    { T: field('T', { type: 'SUBTABLE', fields: {} }), U: field('U', { type: 'SUBTABLE', fields: { A: field('A') } }) });
  assert.deepEqual(result[0].rows, [{ path: ['parent'], before: 'T', after: 'U' }]);
});
test('コード変更を名前の類似で結合せず削除＋追加にする', () => {
  const result = compare({ A: field('A', { label: '同じ名前' }) }, { B: field('B', { label: '同じ名前' }) });
  assert.deepEqual(result.map(e => e.kind), ['deleted', 'added']);
});
test('ルックアップの深い差分・配列順序・nullを処理', () => {
  const a = field('A', { lookup: { relatedApp: { app: '1' }, lookupPickerFields: ['X', 'Y'] } });
  const b = field('A', { lookup: { relatedApp: { app: '2' }, lookupPickerFields: ['Y', 'X'] } });
  assert.equal(compare({ A: a }, { A: b })[0].rows.length, 2);
  assert.equal(compare({ A: a }, { A: { ...a, lookup: null } })[0].rows[0].after, null);
  assert.equal(format(null), '取得不可／未設定');
});
test('空文字・未定義・false・ゼロを混同しない', () => {
  assert.equal(compare({ A: field('A', { defaultValue: '0' }) }, { A: field('A', { defaultValue: '' }) })[0].rows.length, 1);
  assert.equal(format(false), 'いいえ'); assert.equal(format('0'), '0'); assert.equal(format(undefined), '—');
});
test('フォーム外のシステム項目を対象外にする', () => {
  assert.deepEqual(compare({ S: field('S', { type: 'STATUS', enabled: false }) }, { S: field('S', { type: 'STATUS', enabled: true }) }), []);
});
test('通常・ゲスト・不正URLの範囲を制限', () => {
  assert.deepEqual(context('https://test.cybozu.com/k/admin/app/flow?app=12#section=form'), { app: '12', prefix: '/k' });
  assert.deepEqual(context('https://test.cybozu.com/k/guest/7/admin/app/flow?app=12'), { app: '12', prefix: '/k/guest/7' });
  for (const path of ['/k/12/', '/k/admin/app/flow?app=bad', '/k/admin/app/flowXYZ?app=12']) assert.equal(context('https://test.cybozu.com' + path), null);
});
