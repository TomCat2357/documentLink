/**
 * 議会答弁ノートリンク — Google Docs エディタアドオン
 *
 * エントリポイント。
 *  - onOpen（単純トリガー）: メニュー生成と、自文書内のごく軽い検証のみ（仕様 6.3）。
 *    認証が必要な処理・他文書への書き込みはここでは行わない。
 *  - 他文書への波及（逆引き更新）は、サイドバーの「今すぐ同期」ボタンによる
 *    明示実行（syncNow）でのみ行う。
 */

/**
 * ドキュメントを開いたとき／アドオンインストール直後に呼ばれる単純トリガー。
 * メニューを生成するだけ。重い処理・他文書書き込みはしない。
 */
function onOpen(e) {
  DocumentApp.getUi()
    .createAddonMenu()
    .addItem('リンク サイドバーを開く', 'showSidebar')
    .addSeparator()
    .addItem('今すぐ同期', 'menuSyncNow')
    .addItem('本文の外部リンクをスキャン', 'menuScanExternal')
    .addToUi();
}

/**
 * アドオンインストール時。onOpen を呼んでメニューを出す。
 */
function onInstall(e) {
  onOpen(e);
}

/**
 * サイドバーを表示する。
 */
function showSidebar() {
  var html = HtmlService.createTemplateFromFile('Sidebar')
    .evaluate()
    .setTitle('議会答弁ノートリンク')
    .setWidth(360);
  DocumentApp.getUi().showSidebar(html);
}

/**
 * HTML テンプレートに別 HTML を埋め込むための標準ヘルパー。
 * Sidebar.html 内で <?!= include('Stylesheet') ?> のように使う。
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * サイドバー初期化用コンテキスト。
 * 自文書フォルダの中身（候補初期母集団）＋自文書の outbound/inbound を返す。
 * @return {{folder:Object, outbound:Array, inbound:Array}}
 */
function getInitialContext() {
  return {
    folder: getCurrentFolderContents(),
    outbound: readLinks(OUTBOUND_KEY),
    inbound: readLinks(INBOUND_KEY)
  };
}

/* ───────────── メニューからの明示実行ラッパー ───────────── */

function menuSyncNow() {
  var summary = syncNow();
  DocumentApp.getUi().alert(
    '同期結果',
    '順方向: ' + summary.outboundUpdated + ' 件更新 / ' +
    'broken: ' + summary.broken.length + ' 件 / ' +
    '逆引き波及: ' + summary.inboundPushed + ' 件',
    DocumentApp.getUi().ButtonSet.OK);
}

function menuScanExternal() {
  showSidebar();
}

/* ───────────── 自己検証（純粋関数の軽量テスト） ───────────── */

/**
 * エディタから手動実行する軽量テスト。Logger に結果を出す。
 * CI で回しにくい Apps Script の制約に対する最小限の保証。
 */
function runSelfTest() {
  var results = [];
  function check(name, cond) {
    results.push((cond ? 'PASS' : 'FAIL') + ' : ' + name);
  }

  // extractFileId
  check('extractFileId from /d/<id>/edit',
    extractFileId('https://docs.google.com/document/d/1AbC_xyz/edit') === '1AbC_xyz');
  check('extractFileId from open?id=',
    extractFileId('https://drive.google.com/open?id=1AbC_xyz') === '1AbC_xyz');
  check('extractFileId from bare id',
    extractFileId('1AbC_xyz-123') === '1AbC_xyz-123');
  check('extractFileId rejects junk',
    extractFileId('not a link') === null);

  // buildFileUrl round-trip
  check('buildFileUrl round-trip',
    extractFileId(buildFileUrl('1ZZZ')) === '1ZZZ');

  // upsertLink: insert then update by fileId (dedup)
  var arr = [];
  arr = upsertLink(arr, { fileId: 'A', displayName: 'a1' });
  arr = upsertLink(arr, { fileId: 'B', displayName: 'b1' });
  arr = upsertLink(arr, { fileId: 'A', displayName: 'a2' });
  check('upsertLink dedup length', arr.length === 2);
  check('upsertLink updates entry',
    arr.filter(function (x) { return x.fileId === 'A'; })[0].displayName === 'a2');

  // removeLinkById
  var arr2 = removeLinkById(arr, 'A');
  check('removeLinkById removes', arr2.length === 1 && arr2[0].fileId === 'B');

  // status decision (path change)
  check('decideStatus path change',
    decideStatus({ folderPath: '/x/' }, { resolvedById: true, currentPath: '/y/' }).status === 'path_updated');
  check('decideStatus ok',
    decideStatus({ folderPath: '/x/' }, { resolvedById: true, currentPath: '/x/' }).status === 'ok');
  check('decideStatus id_relinked',
    decideStatus({ folderPath: '/x/' }, { resolvedById: false, relinkedId: 'NEW' }).status === 'id_relinked');
  check('decideStatus broken',
    decideStatus({ folderPath: '/x/' }, { resolvedById: false, relinkedId: null }).status === 'broken');

  Logger.log(results.join('\n'));
  return results;
}
