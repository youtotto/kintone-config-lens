// Synthetic public-API shapes. No customer settings or credentials.
const field = (code, extra = {}) => ({ type: 'SINGLE_LINE_TEXT', code, label: '案件名', required: false, ...extra });
function fixtures(preview = false) {
  const entity = { type: 'GROUP', code: 'everyone' };
  return {
    fields: { properties: preview ? { A: field('A', { required: true, defaultValue: '<img src=x onerror=alert(1)>' }), B: field('B') } : { A: field('A'), C: field('C') } },
    layout: { layout: [{ type: 'ROW', fields: [{ type: 'SINGLE_LINE_TEXT', code: 'A', size: { width: preview ? '280' : '200' } }] }] },
    views: { views: { [preview ? '進行中案件' : '案件一覧']: { id: '10', name: preview ? '進行中案件' : '案件一覧', type: 'LIST', fields: preview ? ['B', 'A'] : ['A', 'B'], index: '0', filterCond: '', sort: 'レコード番号 desc' } } },
    process: { enable: preview, states: { 未処理: { name: '未処理', index: '0', assignee: { type: 'ONE', entities: [] } } }, actions: preview ? [{ name: '完了する', from: '未処理', to: '完了', filterCond: '' }] : [] },
    notifyApp: { notifications: [{ entity, includeSubs: false, recordAdded: preview, recordEdited: false }], notifyToCommenter: false },
    notifyRecord: { notifications: preview ? [{ title: '要確認', filterCond: 'A = "確認"', targets: [{ entity, includeSubs: false }] }] : [] },
    notifyReminder: { notifications: [{ title: '期限前', filterCond: '', timing: { code: '期限', daysLater: preview ? '-2' : '-1', time: '09:00' }, targets: [{ entity, includeSubs: false }] }], timezone: 'Asia/Tokyo' },
    aclApp: { rights: [{ entity, includeSubs: false, appEditable: false, recordViewable: true, recordAddable: !preview }] },
    aclRecord: { rights: [{ filterCond: 'A = "確認"', entities: [{ entity, viewable: true, editable: !preview, deletable: false }] }] },
    aclField: { rights: [{ code: 'A', entities: [{ entity, accessibility: preview ? 'READ' : 'WRITE', includeSubs: false }] }] },
    general: { name: '検証アプリ', description: preview ? '<b>検証中</b>' : '', theme: 'WHITE', enableBulkDeletion: !preview, numberPrecision: { digits: '16', decimalPlaces: preview ? '2' : '4', roundingMode: 'HALF_EVEN' } },
    reports: { reports: { 集計: { id: '20', name: '集計', index: '0', chartType: preview ? 'BAR' : 'COLUMN', chartMode: 'NORMAL', groups: [], aggregations: [{ type: 'COUNT' }], filterCond: '', sorts: [], periodicReport: { active: false } } } },
    actions: { actions: { コピー: { id: '30', name: 'コピー', index: '0', destApp: { app: '2', code: '' }, mappings: [{ srcType: 'FIELD', srcField: 'A', destField: preview ? 'Y' : 'X' }], entities: [entity], filterCond: '' } } },
    customize: { scope: 'ALL', desktop: { js: [{ type: 'URL', url: preview ? 'https://example.invalid/v2.js' : 'https://example.invalid/v1.js' }], css: [] }, mobile: { js: [], css: [] } },
    plugins: { plugins: [{ id: 'test-plugin', name: '検証用プラグイン', enabled: preview }] },
    notes: { content: preview ? '<div>リリース前確認</div>' : '', includeInTemplateAndDuplicates: false }
  };
}
const { CATEGORIES } = require('../kintoneConfigLens.user.js');
function responseFor(url) {
  const category = CATEGORIES.find(c => new URL(url, 'https://example.test').pathname.endsWith('/' + c.path + '.json'));
  if (!category) throw new Error('Unexpected API: ' + url);
  const preview = url.includes('/preview/');
  return { revision: preview ? '9' : '8', ...fixtures(preview)[category.id] };
}
const good = async url => ({ ok: true, status: 200, json: async () => responseFor(url) });
module.exports = { fixtures, responseFor, good };
