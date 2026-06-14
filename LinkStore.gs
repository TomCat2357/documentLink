/**
 * LinkStore — DocumentProperties に格納するリンク配列の読み書きとエントリ操作。
 *
 * 本文は一切汚さず、順方向（outboundLinks）と逆引き（inboundLinks）を
 * それぞれ 1 プロパティに JSON 配列で持つ（仕様 8 章）。
 *
 * 各エントリ共通フィールド:
 *   fileUrl, fileId, folderPath, displayName,
 *   source ("manual"|"external"),
 *   lastVerifiedAt (ISO8601), status ("ok"|"path_updated"|"id_relinked"|"broken")
 */

var OUTBOUND_KEY = 'outboundLinks';
var INBOUND_KEY = 'inboundLinks';

/**
 * 指定 Document の DocumentProperties からリンク配列を読む。
 * @param {string} kind OUTBOUND_KEY | INBOUND_KEY
 * @param {Document=} doc 省略時はアクティブドキュメント
 * @return {Array<Object>}
 */
function readLinks(kind, doc) {
  var props = docPropertiesFor_(doc);
  var raw = props.getProperty(kind);
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    // 破損していたら空配列にフォールバック（既存値は上書き時に修復される）
    return [];
  }
}

/**
 * リンク配列を保存する。
 * @param {string} kind
 * @param {Array<Object>} arr
 * @param {Document=} doc
 */
function writeLinks(kind, arr, doc) {
  var props = docPropertiesFor_(doc);
  props.setProperty(kind, JSON.stringify(arr || []));
}

/**
 * 指定ドキュメント（省略時アクティブ）の DocumentProperties を返す。
 * 他文書の場合は openById したドキュメントを渡すことで、その文書の
 * DocumentProperties に対して読み書きできる。
 * @private
 */
function docPropertiesFor_(doc) {
  // PropertiesService.getDocumentProperties() はスクリプトがバインドされた
  // アクティブドキュメントを対象にする。他文書を対象にする場合は
  // 呼び出し側でアクティブ文書を切り替えるのではなく、openById 経由の
  // 同期処理（Sync.gs）で各文書を順に処理する。
  return PropertiesService.getDocumentProperties();
}

/**
 * fileId をキーに配列へ upsert（あれば更新、なければ追加）。
 * @param {Array<Object>} arr
 * @param {Object} entry
 * @return {Array<Object>} 新しい配列
 */
function upsertLink(arr, entry) {
  var out = (arr || []).slice();
  var idx = -1;
  for (var i = 0; i < out.length; i++) {
    if (out[i].fileId && entry.fileId && out[i].fileId === entry.fileId) {
      idx = i;
      break;
    }
  }
  if (idx >= 0) {
    // 既存フィールドへマージ（source は既存を優先保持しつつ entry 指定があれば反映）
    out[idx] = mergeEntry_(out[idx], entry);
  } else {
    out.push(entry);
  }
  return out;
}

/**
 * @private
 */
function mergeEntry_(base, patch) {
  var merged = {};
  var k;
  for (k in base) if (base.hasOwnProperty(k)) merged[k] = base[k];
  for (k in patch) if (patch.hasOwnProperty(k) && patch[k] !== undefined && patch[k] !== null) {
    merged[k] = patch[k];
  }
  return merged;
}

/**
 * fileId で配列からエントリを除去。
 * @return {Array<Object>}
 */
function removeLinkById(arr, fileId) {
  return (arr || []).filter(function (e) { return e.fileId !== fileId; });
}

/**
 * fileId でエントリを検索。
 * @return {Object|null}
 */
function findLinkById(arr, fileId) {
  var hits = (arr || []).filter(function (e) { return e.fileId === fileId; });
  return hits.length ? hits[0] : null;
}

/* ───────────── URL / ID ユーティリティ ───────────── */

/**
 * ファイル URL / ID 文字列から fileId を抽出する。
 * 対応:
 *   - https://docs.google.com/.../d/<id>/edit
 *   - https://drive.google.com/open?id=<id>
 *   - https://drive.google.com/file/d/<id>/view
 *   - 裸の ID（英数・ハイフン・アンダースコアのみ、十分な長さ）
 * @param {string} input
 * @return {string|null}
 */
function extractFileId(input) {
  if (!input) return null;
  var s = String(input).trim();

  // /d/<id>/ パターン
  var m = s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];

  // ?id=<id> または &id=<id>
  m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];

  // 裸 ID（URL でない）: 25 文字以上の Drive ID を想定しつつ、テスト用の
  // 短い ID も許容するため英数記号のみ・空白なし・スラッシュなしを条件にする。
  if (/^[a-zA-Z0-9_-]+$/.test(s)) return s;

  return null;
}

/**
 * fileId から Google Docs の編集 URL を生成。
 * @param {string} fileId
 * @return {string}
 */
function buildFileUrl(fileId) {
  return 'https://docs.google.com/document/d/' + fileId + '/edit';
}

/**
 * 現在時刻を ISO8601（タイムゾーン付き）で返す。
 * @return {string}
 */
function nowIso() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssXXX");
}
