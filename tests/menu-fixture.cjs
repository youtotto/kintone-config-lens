// Destinations and semantic panel structure observed on the native settings screen.
const sections = [
  ['一般設定', [['general', 'アイコンと説明'], ['theme', 'デザインテーマ'], ['status', 'プロセス管理']]],
  ['通知', [['notification', 'アプリの条件通知', 'app'], ['notification', 'レコードの条件通知', 'record'], ['notification', 'リマインダーの条件通知', 'reminder']]],
  ['アクセス権', [['acl/app', 'アプリ'], ['acl/record', 'レコード'], ['acl/field', 'フィールド']]],
  ['カスタマイズ／サービス連携', [['plugin', 'プラグイン'], ['customize', 'JavaScript / CSSでカスタマイズ'], ['apitoken', 'APIトークン'], ['webhook', 'Webhook']]],
  ['その他の設定', [['category', 'カテゴリー'], ['resource', '言語ごとの名称'], ['title', 'レコードのタイトル'], ['info', '高度な設定'], ['action', 'アクション']]],
  ['運用管理', [['reference', 'このアプリを参照しているアプリ'], ['history', '設定変更の履歴']]]
];
function menuFixture(app = '12', prefix = '/k') {
  return `<nav role="tablist"><button role="tab" id="form" aria-selected="false">フォーム</button><button role="tab" id="settings" aria-selected="true">設定</button></nav><div role="tabpanel" aria-labelledby="settings" class="demo-settings">${sections.map(([title, links]) => `<section><h3>${title}</h3>${links.map(([page, label, trigger]) => `<div><a href="${prefix}/admin/app/${page === 'plugin' ? `${app}/plugin/#/` : `${page}?app=${app}${trigger ? '&trigger=' + trigger : ''}`}"><span>${label}</span></a></div>`).join('')}</section>`).join('')}</div>`;
}
module.exports = { menuFixture };
