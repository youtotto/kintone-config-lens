const { test } = require('node:test');
const assert = require('node:assert/strict');
const { layoutMarks } = require('../kintoneConfigLens.user.js');
const field = (code, width = '200') => ({ type: 'SINGLE_LINE_TEXT', code, size: { width } });
const row = (...fields) => ({ type: 'ROW', fields });
const mark = (side, path) => side.get(path);
test('同名でもコードで位置・幅・追加削除を区別し、寸法変更を両側に表示', () => {
  const a = [row(field('A'), field('B')), row(field('Old'))];
  const b = [row(field('B'), field('A', '320')), row(field('New'))];
  const marks = layoutMarks(a, b);
  assert.equal(mark(marks[0], '0/fields/0').key, 'code:A');
  assert.equal(mark(marks[1], '0/fields/1').key, 'code:A');
  assert.match(mark(marks[1], '0/fields/1').text, /配置位置.*寸法/);
  assert.equal(mark(marks[0], '1/fields/0').kind, 'deleted');
  assert.equal(mark(marks[1], '1/fields/0').kind, 'added');
});
test('グループ・テーブル子の順序と項目設定を反映し、子変更を親へ重複しない', () => {
  const a = [{ type: 'GROUP', code: 'G', layout: [row(field('A'))] }, { type: 'SUBTABLE', code: 'T', fields: [field('X'), field('Y')] }];
  const b = structuredClone(a); b[1].fields.reverse();
  const marks = layoutMarks(a, b, { A: { code: 'A', label: '同名' } }, { A: { code: 'A', label: '同名', required: true } });
  assert.equal(mark(marks[1], '0/layout/0/fields/0').text, '項目設定');
  assert.equal(mark(marks[1], '1/fields/0').text, '配置位置');
  assert.equal(mark(marks[1], '1').kind, '');
});
test('IDなし部品の位置比較・ID付き部品の対応・差分なしを扱う', () => {
  const label = { type: 'LABEL', label: '案内', size: { width: '200' } };
  const a = [row(label, { type: 'SPACER', elementId: 'S' })];
  const b = [row({ ...label, label: '変更' }, { type: 'SPACER', elementId: 'S' })];
  const marks = layoutMarks(a, b);
  assert.equal(mark(marks[1], '0/fields/0').anonymous, true);
  assert.equal(mark(marks[1], '0/fields/0').kind, 'changed');
  assert.equal(mark(marks[1], '0/fields/1').key, 'element:S');
  assert.ok([...layoutMarks(a, a)[0].values()].every(v => v.kind === ''));
});
