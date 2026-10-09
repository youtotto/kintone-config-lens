const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fieldOverviews, fieldCounts } = require('../kintoneConfigLens.user.js');
const lookup = (code, dest = 'Name') => ({ type: 'SINGLE_LINE_TEXT', code, label: code, lookup: {
  relatedApp: { app: '99', code: 'MASTER' }, relatedKeyField: 'Key',
  fieldMappings: [{ field: dest, relatedField: 'MasterName' }], lookupPickerFields: ['Key', 'MasterName'], filterCond: '', sort: 'Key asc'
} });
test('差分のない参照・コピー先・計算式も収集し、複数ルックアップの対応を失わない', () => {
  const properties = { B: lookup('B'), A: lookup('A'), Name: { type: 'SINGLE_LINE_TEXT', code: 'Name', label: '同名' },
    Table: { type: 'SUBTABLE', code: 'Table', fields: { InTable: lookup('InTable', 'Qty'), Qty: { type: 'NUMBER', code: 'Qty' } } },
    Calc: { type: 'CALC', code: 'Calc', expression: 'SUM(Qty)' }, TextCalc: { type: 'SINGLE_LINE_TEXT', code: 'TextCalc', expression: 'Name&"!"' },
    Plain: { type: 'SINGLE_LINE_TEXT', code: 'Plain', expression: '' },
    Ref: { type: 'REFERENCE_TABLE', code: 'Ref', referenceTable: { relatedApp: { app: '100' }, condition: { field: 'Name', relatedField: 'Client' }, displayFields: ['Date'], size: '5', filterCond: '', sort: 'Date desc' } }
  };
  const result = fieldOverviews(properties);
  assert.deepEqual(result.get('Plain').sections, []);
  assert.deepEqual(result.get('Name').groups.map(g => [g.id, g.code, g.role]), [[1, 'A', 'コピー先'], [2, 'B', 'コピー先']]);
  assert.match(result.get('A').sections[0].rows.flat().join('\n'), /MasterName → Name/);
  assert.match(result.get('Name').sections[0].rows.flat().join('\n'), /MasterName/);
  assert.equal(result.get('Qty').parent, 'Table');
  assert.equal(result.get('InTable').groups[0].id, result.get('Qty').groups[0].id);
  assert.equal(result.get('Calc').sections[0].rows[0][1], 'SUM(Qty)');
  assert.equal(result.get('TextCalc').sections[0].kind, '計算式');
  assert.match(result.get('Ref').sections[0].rows.flat().join('\n'), /このアプリ：Name ＝ 参照先：Client/);
  assert.deepEqual(result.get('A').sections[0].rows.map(r => r[0]), ['参照先アプリ', 'キー（参照先 → このアプリ）', 'ほかのフィールドのコピー（参照先 → このアプリ）', 'フィルター（初期設定）']);
  assert.deepEqual(result.get('Ref').sections[0].rows.map(r => r[0]), ['参照先アプリ', '紐付け条件', 'フィルター']);
  assert.equal(result.get('Calc').sections.length, 1);
});
test('参照設定nullは未設定ではなく取得不可、空配列・空文字と区別', () => {
  const fields = { L: { type: 'NUMBER', code: 'L', lookup: null }, R: { type: 'REFERENCE_TABLE', code: 'R', referenceTable: null }, E: lookup('E') };
  fields.E.lookup.fieldMappings = ''; fields.E.lookup.lookupPickerFields = '';
  const result = fieldOverviews(fields);
  for (const code of ['L', 'R']) assert.match(result.get(code).sections[0].rows[0][1], /取得不可/);
  assert.match(result.get('E').sections[0].rows.flat().join('\n'), /指定なし/);
});
test('選択肢4種類を表示順で返し、フィルターの未設定と取得不可を区別する', () => {
  const properties = Object.fromEntries(['DROP_DOWN', 'RADIO_BUTTON', 'CHECK_BOX', 'MULTI_SELECT'].map(type => [type, { code: type, type, options: { later: { label: '<後>', index: '10' }, first: { label: '先', index: '2' } } }]));
  properties.L = lookup('L'); properties.L.lookup.filterCond = 'Active in ("有効")';
  properties.Empty = lookup('Empty'); properties.Unknown = lookup('Unknown'); properties.Unknown.lookup.filterCond = null;
  const result = fieldOverviews(properties);
  for (const type of ['DROP_DOWN', 'RADIO_BUTTON', 'CHECK_BOX', 'MULTI_SELECT']) assert.deepEqual(result.get(type).sections, [{ kind: '選択肢', rows: [['表示順', '先\n<後>']] }]);
  assert.deepEqual(result.get('L').sections[0].rows.at(-1), ['フィルター（初期設定）', 'Active in ("有効")']);
  assert.equal(result.get('Empty').sections[0].rows.at(-1)[1], '指定なし');
  assert.equal(result.get('Unknown').sections[0].rows.at(-1)[1], '取得不可');
});

test('フィールド数はテーブル子を総数に含め、コンテナとシステム項目を分ける', () => {
  assert.deepEqual(fieldCounts({ A: { type: 'SINGLE_LINE_TEXT' }, T: { type: 'SUBTABLE', fields: { B: { type: 'NUMBER' }, C: { type: 'CALC' } } },
    G: { type: 'GROUP' }, R: { type: 'REFERENCE_TABLE' }, Sys: { type: 'RECORD_NUMBER' }, S: { type: 'STATUS' }, Creator: { type: 'CREATOR' } }),
  { fields: 4, tableFields: 2, tables: 1, groups: 1 });
});
