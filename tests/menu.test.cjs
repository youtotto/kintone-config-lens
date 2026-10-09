const { test } = require('node:test');
const assert = require('node:assert/strict');
const { menuTarget } = require('../kintoneConfigLens.user.js');

test('設定メニューの対応付けは同じ環境・アプリ・ゲスト空間だけを対象にする', () => {
  for (const prefix of ['/k', '/k/guest/7']) {
    const base = `https://example.cybozu.com${prefix}/admin/app/flow?app=12#section=settings`;
    const path = `${prefix}/admin/app/`;
    assert.deepEqual(menuTarget(path + 'notification?trigger=reminder&app=12', base), { category: 'notifyReminder' });
    assert.deepEqual(menuTarget(path + '12/plugin/#/', base), { category: 'plugins' });
    assert.deepEqual(menuTarget(path + 'title?app=12', base), { category: 'general', keys: ['titleField'] });
    for (const href of [path + 'status?app=13', path + 'status?app=12&app=13', path + '13/plugin/#/', path + '12/plugin/#/config', path + 'webhook?app=12', path + 'category?app=12', path + 'constructor?app=12', path + 'notification?app=12&trigger=app&trigger=record', 'https://other.cybozu.com' + path + 'status?app=12', '/k/guest/8/admin/app/status?app=12']) assert.equal(menuTarget(href, base), null, href);
  }
});
