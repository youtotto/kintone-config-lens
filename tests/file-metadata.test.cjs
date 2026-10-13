const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CATEGORIES, compareCategory, collectSettings, saveCarry, readCarry, carryKey } = require('../kintoneConfigLens.user.js');
const { good, responseFor } = require('./fixtures.cjs');
const file = (key, extra = {}) => ({ type: 'FILE', file: { fileKey: key, name: 'sample.js', contentType: 'text/javascript', size: '6950', ...extra } });
const general = icon => ({ revision: '133', name: '検証', description: '<b>説明</b>', icon });
const customize = entry => ({ revision: '133', scope: 'ALL', desktop: { js: [entry], css: [entry] }, mobile: { js: [entry], css: [entry] } });
const compare = (id, a, b) => compareCategory(CATEGORIES.find(c => c.id === id), a, b,
  new Map(['live-key', 'preview-key', 'a', 'b'].map(key => [key, 'verified-same-content'])));

test('同一リビジョンでも変わるアイコンとPC・モバイルJS/CSSのfileKeyを差分にしない', () => {
  for (const [id, wrap] of [['general', general], ['customize', customize]]) {
    const a = wrap(file('live-key')), b = wrap(file('preview-key'));
    const originals = JSON.stringify([a, b]);
    const result = compare(id, a, b);
    assert.equal(result.state, 'ok');
    assert.deepEqual(result.entries, []);
    assert.equal(JSON.stringify([a, b]), originals, 'API応答を変更しない');
    for (const delta of [{ name: 'new.js' }, { size: '6951' }, { contentType: 'text/css' }, { futureProperty: true }]) {
      assert.ok(compare(id, a, wrap(file('preview-key', delta))).entries.length, JSON.stringify(delta));
    }
  }
});

test('説明文・組込みアイコン・ファイル種別・URL・適用範囲と順序の実変更を保持する', () => {
  const a = general(file('a'));
  assert.deepEqual(compare('general', a, { ...general(file('b')), description: '<b>新しい説明</b>' }).entries.map(e => e.code), ['description']);
  assert.ok(compare('general', a, general({ type: 'PRESET', key: 'APP72' })).entries.length);
  assert.ok(compare('general', general({ type: 'PRESET', key: 'APP72' }), general({ type: 'PRESET', key: 'APP73' })).entries.length);
  const old = customize(file('a'));
  assert.ok(compare('customize', old, { ...old, scope: 'ADMIN' }).entries.length);
  assert.ok(compare('customize', old, customize({ type: 'URL', url: 'https://example.invalid/a.js' })).entries.length);
  for (const device of ['desktop', 'mobile']) for (const kind of ['js', 'css']) {
    const before = customize(file('a')), after = customize(file('b'));
    before[device][kind].push({ type: 'URL', url: 'https://example.invalid/a.js' });
    after[device][kind].push({ type: 'URL', url: 'https://example.invalid/a.js' });
    assert.deepEqual(compare('customize', before, after).entries, []);
    after[device][kind].reverse();
    assert.equal(compare('customize', before, after).entries.length, 1);
    after[device][kind].reverse();
    after[device][kind][1].url = 'https://example.invalid/b.js';
    assert.equal(compare('customize', before, after).entries.length, 1);
    after[device][kind] = [];
    assert.equal(compare('customize', before, after).entries.length, 1);
  }
});

test('fileKey以外の情報が不足するファイルを変更なしと扱わない', () => {
  for (const [id, wrap] of [['general', general], ['customize', customize]]) {
    for (const key of ['name', 'size', 'contentType']) {
      const incomplete = file('a'); delete incomplete.file[key];
      assert.throws(() => compare(id, wrap(incomplete), wrap(incomplete)), /ファイル/);
    }
  }
});

test('旧比較ロジックのキャッシュを復元しない', async () => {
  const ctx = { app: '12', prefix: '/k' }, values = new Map();
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  const results = await collectSettings(ctx, undefined, good);
  saveCarry(storage, ctx, results);
  const data = JSON.parse(storage.getItem(carryKey(ctx)));
  data.version = 2;
  storage.setItem(carryKey(ctx), JSON.stringify(data));
  assert.equal(readCarry(storage, ctx), null);
});

function downloadFixture(content = 'AAAA', failure = false) {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/file.json?')) {
      const key = new URL(url, 'https://example.invalid').searchParams.get('fileKey');
      if (failure && key === 'b') return { ok: false, status: 403 };
      const bytes = Buffer.from(key === 'b' ? content : 'AAAA');
      return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    }
    let data = responseFor(url);
    const entry = file(url.includes('/preview/') ? 'b' : 'a', { size: '4' });
    if (url.includes('/app/settings.json')) data = general(entry);
    if (url.includes('/app/customize.json')) data = customize(entry);
    // The entire fixture is one revision, matching the reported false positive.
    data.revision = '133';
    return { ok: true, json: async () => data };
  };
  return { fetcher, requests };
}

test('別キーの同じ内容は変更なし、同名・同サイズの異なる内容は変更あり', async () => {
  for (const content of ['AAAA', 'BBBB']) {
    const { fetcher, requests } = downloadFixture(content);
    const results = await collectSettings({ app: '12', prefix: '/k/guest/7' }, undefined, fetcher);
    for (const id of ['general', 'customize']) {
      const r = results.find(r => r.category.id === id);
      assert.equal(r.state, 'ok');
      assert.equal(r.entries.length > 0, content === 'BBBB', id);
      if (content === 'BBBB') assert.match(JSON.stringify(r.entries), /contentHash/);
    }
    const files = requests.filter(r => r.url.includes('/file.json?'));
    assert.equal(files.length, 2, '同じキーは1回の取得で共有');
    assert.ok(files.every(r => r.url.startsWith('/k/guest/7/v1/file.json?') && r.options.method === 'GET' && r.options.credentials === 'same-origin'));
    assert.equal(requests.length, 36, '外部URLは取得しない');
  }
});

test('ファイル取得失敗・不完全な本文は比較不可で、キーや片側のハッシュを差分にしない', async () => {
  for (const [content, failure] of [['BBBB', true], ['short', false]]) {
    const { fetcher } = downloadFixture(content, failure);
    const results = await collectSettings({ app: '12', prefix: '/k' }, undefined, fetcher);
    for (const id of ['general', 'customize']) {
      const r = results.find(r => r.category.id === id);
      assert.equal(r.state, 'partial');
      assert.deepEqual(r.entries, []);
      assert.match(r.warnings.join(), /内容.*比較できません/);
    }
    assert.equal(results.find(r => r.category.id === 'fields').state, 'ok');
  }
});

test('本文を照合していない同期比較は変更なしを保証しない', () => {
  const r = compareCategory(CATEGORIES.find(c => c.id === 'general'), general(file('a')), general(file('b')));
  assert.equal(r.state, 'partial');
  assert.deepEqual(r.entries, []);
});

test('同名・同サイズのファイルを並べ替えた場合も内容で検出する', () => {
  const before = customize(file('a')), after = customize(file('b'));
  before.desktop.js = [file('a'), file('b')];
  after.desktop.js = [file('b'), file('a')];
  before.desktop.css = after.desktop.css = [];
  before.mobile = after.mobile = { js: [], css: [] };
  const r = compareCategory(CATEGORIES.find(c => c.id === 'customize'), before, after, new Map([['a', 'hash-A'], ['b', 'hash-B']]));
  assert.equal(r.entries.length, 1);
  assert.deepEqual(r.entries[0].rows[0].path, ['desktop', 'js']);
});

test('内容取得中も同時通信6件以下を守り、取得後の設定変更と中断を検出する', async () => {
  const ctx = { app: '12', prefix: '/k' };
  for (const mode of ['normal', 'revision', 'abort']) {
    const { fetcher } = downloadFixture(), controller = new AbortController();
    let active = 0, max = 0, fileRead = false;
    const collect = collectSettings(ctx, controller.signal, async (url, options) => {
      max = Math.max(max, ++active);
      try {
        await new Promise(resolve => setImmediate(resolve));
        const response = await fetcher(url, options);
        if (url.includes('/file.json?')) {
          fileRead = true;
          if (mode === 'abort') controller.abort();
        } else if (fileRead && mode === 'revision') {
          const data = await response.json(); data.revision = '134';
          return { ...response, json: async () => data };
        }
        return response;
      } finally { active--; }
    });
    if (mode === 'abort') await assert.rejects(collect, /中断/);
    else {
      const results = await collect;
      if (mode === 'revision') assert.ok(results.every(r => r.state === 'error' && !r.entries.length));
      else assert.ok(results.every(r => r.state === 'ok'));
    }
    assert.ok(max <= 6);
  }
});

test('内容比較の結果をメニューと個別画面へ引き継ぎ、再表示でダウンロードしない', async () => {
  const { JSDOM } = require('jsdom');
  const { webcrypto } = require('node:crypto');
  const source = require('node:fs').readFileSync(require.resolve('../kintoneConfigLens.user.js'), 'utf8');
  const { menuFixture } = require('./menu-fixture.cjs');
  const wait = () => new Promise(resolve => setTimeout(resolve, 180));
  for (const [content, failure, label] of [['AAAA', false, '変更なし'], ['BBBB', false, '変更あり'], ['AAAA', true, '一部比較不可']]) {
    const { fetcher, requests } = downloadFixture(content, failure);
    const dom = new JSDOM(menuFixture(), { url: 'https://example.cybozu.com/k/admin/app/flow?app=12', runScripts: 'outside-only', pretendToBeVisual: true });
    let inner;
    try {
      dom.window.fetch = fetcher;
      Object.defineProperty(dom.window.crypto, 'subtle', { value: webcrypto.subtle });
      dom.window.eval(source);
      [...dom.window.document.querySelectorAll('button')].find(b => b.textContent === '設定を読み込む').click();
      await wait();
      for (const path of ['general', 'customize']) {
        const badge = dom.window.document.querySelector(`a[href="/k/admin/app/${path}?app=12"] .nrfd-menu-chip`);
        assert.equal(badge?.textContent || '変更なし', label);
      }
      const cache = dom.window.sessionStorage.getItem(carryKey({ app: '12', prefix: '/k' }));
      assert.ok(cache);
      assert.doesNotMatch(cache, /fileKey|AAAA|BBBB/);
      inner = new JSDOM('<main></main>', { url: 'https://example.cybozu.com/k/admin/app/customize?app=12', runScripts: 'outside-only' });
      inner.window.fetch = () => { throw new Error('個別画面から取得しない'); };
      inner.window.sessionStorage.setItem(carryKey({ app: '12', prefix: '/k' }), cache);
      inner.window.eval(source);
      assert.ok(inner.window.document.querySelector('#nrfd-page-diff').textContent.includes(label));
      assert.equal(requests.length, 36);
    } finally { dom.window.close(); inner?.window.close(); }
  }
});
