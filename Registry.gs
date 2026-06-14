/**
 * Registry — 文書間の逆引き伝播のための共有レジストリ。
 *
 * 【なぜ必要か / Apps Script の制約】
 *   PropertiesService.getDocumentProperties() は常に「アクティブな文書」を対象にし、
 *   DocumentApp.openById で開いた他文書の DocumentProperties は読み書きできない。
 *   そのため「文書 A から文書 B の inboundLinks（DocumentProperties）へ直接書き込む」
 *   ことは技術的に不可能。
 *
 * 【解決】
 *   ScriptProperties に「targetFileId → 参照元エントリ配列」のレジストリを 1 つ持ち、
 *   これを伝播チャネルにする。各文書の inboundLinks/outboundLinks は従来どおり
 *   その文書自身の DocumentProperties に保持（仕様の per-doc モデルを維持）。
 *   - 順方向リンク A→B を作るとき: A の outbound に保存 ＋ registry[B] に A を登録。
 *   - B を開いて同期したとき: registry[B] を読んで B の inboundLinks に materialize。
 *
 *   ScriptProperties はスクリプトプロジェクト単位で共有されるため、同一アドオンを
 *   利用するドキュメント間で逆引き情報を受け渡せる。容量上限（合計 500KB）に留意。
 */

var REGISTRY_KEY = 'linkRegistry';

/**
 * @private レジストリ全体（map）を読む。
 * @return {Object<string, Array<Object>>}
 */
function registryReadAll_() {
  var raw = PropertiesService.getScriptProperties().getProperty(REGISTRY_KEY);
  if (!raw) return {};
  try {
    var parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (err) {
    return {};
  }
}

/**
 * @private レジストリ全体を保存する。
 */
function registryWriteAll_(map) {
  PropertiesService.getScriptProperties().setProperty(REGISTRY_KEY, JSON.stringify(map || {}));
}

/**
 * 参照元 referrer を target の逆引きに登録（fileId キーで upsert）。
 * 並行更新に備え LockService で保護。
 * @param {string} targetFileId
 * @param {Object} referrerEntry source 等を含む参照元エントリ
 */
function registryAddReferrer(targetFileId, referrerEntry) {
  withRegistryLock_(function () {
    var map = registryReadAll_();
    var list = map[targetFileId] || [];
    map[targetFileId] = upsertLink(list, referrerEntry);
    registryWriteAll_(map);
  });
}

/**
 * target の逆引きから referrer を除去。
 * @param {string} targetFileId
 * @param {string} referrerFileId
 */
function registryRemoveReferrer(targetFileId, referrerFileId) {
  withRegistryLock_(function () {
    var map = registryReadAll_();
    if (!map[targetFileId]) return;
    map[targetFileId] = removeLinkById(map[targetFileId], referrerFileId);
    if (map[targetFileId].length === 0) delete map[targetFileId];
    registryWriteAll_(map);
  });
}

/**
 * target を参照している参照元エントリ配列を返す。
 * @param {string} targetFileId
 * @return {Array<Object>}
 */
function registryGetReferrers(targetFileId) {
  var map = registryReadAll_();
  return (map[targetFileId] || []).slice();
}

/**
 * @private LockService でレジストリ更新を直列化。
 */
function withRegistryLock_(fn) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    // ロック取得失敗時はベストエフォートで続行（短時間の競合のみ想定）
  }
  try {
    fn();
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}
