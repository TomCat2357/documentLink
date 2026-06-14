/**
 * DriveIndex — Drive フォルダ階層の探索、名前→ID 索引、物理フォルダパス算出。
 *
 * 物理フォルダパスは「Drive フォルダ階層の文字列化」（例 /議会/委員会/2025定例会/）。
 * Drive は複数親を許すが、本アドオンでは第1親に正規化する（仕様 10章2 の確定方針）。
 *
 * パフォーマンス: 同一フォルダの名前→ID 索引と folderId→パスを CacheService に
 * 短期キャッシュして反復解決のコストを抑える（仕様 9 章）。
 */

var CACHE_TTL_SEC = 300; // 5 分

/**
 * 指定フォルダの中身（サブフォルダ・ファイル）を列挙する。
 * @param {string} folderId
 * @return {{folderId:string, folderName:string, path:string,
 *           parentId:(string|null), folders:Array, files:Array}}
 */
function listFolderContents(folderId) {
  var folder = DriveApp.getFolderById(folderId);
  var folders = [];
  var it = folder.getFolders();
  while (it.hasNext()) {
    var f = it.next();
    folders.push({ id: f.getId(), name: f.getName(), kind: 'folder' });
  }
  var files = [];
  var fit = folder.getFiles();
  while (fit.hasNext()) {
    var file = fit.next();
    files.push({
      id: file.getId(),
      name: file.getName(),
      kind: 'file',
      url: file.getUrl(),
      mimeType: file.getMimeType()
    });
  }
  folders.sort(byNameJa_);
  files.sort(byNameJa_);

  return {
    folderId: folder.getId(),
    folderName: folder.getName(),
    path: folderPathOf_(folder),
    parentId: firstParentId_(folder),
    folders: folders,
    files: files
  };
}

/**
 * フォルダ内をクライアント入力で絞り込む（前方一致優先・部分一致も含む）。
 * @param {string} folderId
 * @param {string} query
 * @return {Object} listFolderContents と同形だが folders/files を絞り込み済み
 */
function searchInFolder(folderId, query) {
  var data = listFolderContents(folderId);
  var q = (query || '').toLowerCase().trim();
  if (!q) return data;

  function match(name) {
    return name.toLowerCase().indexOf(q) !== -1;
  }
  function rank(a, b) {
    // 前方一致を優先
    var ap = a.name.toLowerCase().indexOf(q) === 0 ? 0 : 1;
    var bp = b.name.toLowerCase().indexOf(q) === 0 ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return byNameJa_(a, b);
  }
  data.folders = data.folders.filter(function (x) { return match(x.name); }).sort(rank);
  data.files = data.files.filter(function (x) { return match(x.name); }).sort(rank);
  return data;
}

/**
 * アクティブドキュメントが属するフォルダ（第1親）の中身を返す。
 * 自文書のフォルダを候補の初期母集団にする（仕様 4.1）。
 * @return {Object}
 */
function getCurrentFolderContents() {
  var docId = DocumentApp.getActiveDocument().getId();
  var file = DriveApp.getFileById(docId);
  var parents = file.getParents();
  if (!parents.hasNext()) {
    // マイドライブ直下など親が取れない場合のフォールバック
    return {
      folderId: null,
      folderName: '(親フォルダなし)',
      path: '/',
      parentId: null,
      folders: [],
      files: []
    };
  }
  var folder = parents.next();
  return listFolderContents(folder.getId());
}

/**
 * URL/ID 直接入力を解決し、ファイルのメタ情報を返す（仕様 4.1 任意指定）。
 * @param {string} urlOrId
 * @return {{ok:boolean, fileId:(string|null), error:(string|undefined),
 *           name:string, url:string, folderPath:string}}
 */
function resolveInput(urlOrId) {
  var fileId = extractFileId(urlOrId);
  if (!fileId) return { ok: false, fileId: null, error: 'URL または ID を認識できませんでした。' };
  try {
    var file = DriveApp.getFileById(fileId);
    return {
      ok: true,
      fileId: file.getId(),
      name: file.getName(),
      url: file.getUrl(),
      folderPath: folderPathOfFile_(file)
    };
  } catch (err) {
    return { ok: false, fileId: fileId, error: '指定 ID を解決できませんでした（権限または存在しない）。' };
  }
}

/* ───────────── 物理フォルダパス算出 ───────────── */

/**
 * ファイルの物理フォルダパス（第1親）を返す。
 * @param {File} file
 * @return {string} 末尾 / 付き。例 /議会/委員会/2025定例会/
 */
function folderPathOfFile_(file) {
  var parents = file.getParents();
  if (!parents.hasNext()) return '/';
  return folderPathOf_(parents.next());
}

/**
 * フォルダの物理パスを算出（第1親を辿ってルートまで）。
 * folderId→パスを CacheService にキャッシュする。
 * @param {Folder} folder
 * @return {string}
 */
function folderPathOf_(folder) {
  var cache = CacheService.getDocumentCache();
  var cacheKey = 'path:' + folder.getId();
  if (cache) {
    var hit = cache.get(cacheKey);
    if (hit) return hit;
  }

  var segments = [];
  var cur = folder;
  var guard = 0;
  while (cur && guard < 50) {
    segments.unshift(cur.getName());
    var parents = cur.getParents();
    cur = parents.hasNext() ? parents.next() : null;
    guard++;
  }
  var path = '/' + segments.join('/') + '/';
  if (cache) cache.put(cacheKey, path, CACHE_TTL_SEC);
  return path;
}

/**
 * @private 第1親フォルダ ID（無ければ null）
 */
function firstParentId_(folder) {
  var parents = folder.getParents();
  return parents.hasNext() ? parents.next().getId() : null;
}

/**
 * folderPath + displayName で同名ファイルを再解決する（解決アルゴリズム step2）。
 * パス文字列から末尾フォルダを特定し、その中で同名の Docs を探す。
 * @param {string} folderPath 末尾 / 付き
 * @param {string} displayName
 * @return {File|null}
 */
function findFileByPathAndName(folderPath, displayName) {
  var folder = resolveFolderByPath_(folderPath);
  if (!folder) return null;
  var it = folder.getFilesByName(displayName);
  if (it.hasNext()) return it.next();
  return null;
}

/**
 * 物理パス文字列を辿って末尾フォルダを得る。
 * @private
 * @param {string} folderPath
 * @return {Folder|null}
 */
function resolveFolderByPath_(folderPath) {
  if (!folderPath) return null;
  var parts = folderPath.split('/').filter(function (s) { return s.length > 0; });
  if (parts.length === 0) return DriveApp.getRootFolder();

  // ルート直下から名前で辿る。
  var current = DriveApp.getRootFolder();
  for (var i = 0; i < parts.length; i++) {
    var sub = current.getFoldersByName(parts[i]);
    if (!sub.hasNext()) return null;
    current = sub.next();
  }
  return current;
}

/* ───────────── ソート ───────────── */

/**
 * @private 日本語対応のロケール比較
 */
function byNameJa_(a, b) {
  return a.name.localeCompare(b.name, 'ja');
}
