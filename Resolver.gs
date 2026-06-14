/**
 * Resolver — 個々のリンクエントリの解決と status 判定（仕様 6.4 / 付録）。
 *
 * 優先キーはファイル URL（ID）。
 *   1. fileId で解決 → 成功なら現在パスを取得（一致=ok / 不一致=path_updated）
 *   2. 失敗なら folderPath + displayName で再解決（成功=id_relinked / 失敗=broken）
 */

/**
 * 1 エントリを解決し、更新済みエントリを返す（純粋に近い形：Drive 参照のみ副作用）。
 * @param {Object} entry outbound/inbound のエントリ
 * @return {Object} 更新後エントリ（status / folderPath / fileUrl / fileId / lastVerifiedAt を更新）
 */
function resolveEntry(entry) {
  var updated = shallowCopy_(entry);
  var probe;

  // step1: fileId で解決
  var byId = tryResolveById_(entry.fileId);
  if (byId.ok) {
    probe = { resolvedById: true, currentPath: byId.folderPath };
    var d1 = decideStatus(entry, probe);
    updated.status = d1.status;
    updated.displayName = byId.name;       // 表示名も最新化
    updated.fileUrl = byId.url;
    if (d1.status === 'path_updated') {
      updated.folderPath = byId.folderPath; // 移動に追従
    } else {
      updated.folderPath = byId.folderPath; // ok の場合も最新値で正規化
    }
    updated.lastVerifiedAt = nowIso();
    return updated;
  }

  // step2: folderPath + displayName で再解決
  var relinked = findFileByPathAndName(entry.folderPath, entry.displayName);
  if (relinked) {
    probe = { resolvedById: false, relinkedId: relinked.getId() };
    updated.status = decideStatus(entry, probe).status; // id_relinked
    updated.fileId = relinked.getId();
    updated.fileUrl = relinked.getUrl();
    updated.folderPath = folderPathOfFile_(relinked);
    updated.lastVerifiedAt = nowIso();
    return updated;
  }

  // 喪失
  updated.status = decideStatus(entry, { resolvedById: false, relinkedId: null }).status; // broken
  updated.lastVerifiedAt = nowIso();
  return updated;
}

/**
 * status を判定する純粋関数（テスト対象）。
 * @param {Object} entry 元エントリ（folderPath を参照）
 * @param {Object} probe 解決結果
 *   - resolvedById:boolean
 *   - currentPath:string  （resolvedById=true のとき）
 *   - relinkedId:(string|null) （resolvedById=false のとき）
 * @return {{status:string}}
 */
function decideStatus(entry, probe) {
  if (probe.resolvedById) {
    if (probe.currentPath && entry.folderPath &&
        normalizePath_(probe.currentPath) === normalizePath_(entry.folderPath)) {
      return { status: 'ok' };
    }
    return { status: 'path_updated' };
  }
  // ID で解決できなかった
  if (probe.relinkedId) return { status: 'id_relinked' };
  return { status: 'broken' };
}

/* ───────────── 内部ヘルパー ───────────── */

/**
 * @private fileId で Drive 解決を試みる
 * @return {{ok:boolean, name:string, url:string, folderPath:string}}
 */
function tryResolveById_(fileId) {
  if (!fileId) return { ok: false };
  try {
    var file = DriveApp.getFileById(fileId);
    return {
      ok: true,
      name: file.getName(),
      url: file.getUrl(),
      folderPath: folderPathOfFile_(file)
    };
  } catch (err) {
    return { ok: false };
  }
}

/**
 * @private パス比較の正規化（末尾スラッシュ・前後空白を吸収）
 */
function normalizePath_(p) {
  if (!p) return '';
  var s = String(p).trim();
  if (s.charAt(s.length - 1) !== '/') s += '/';
  return s;
}

/**
 * @private 浅いコピー
 */
function shallowCopy_(obj) {
  var out = {};
  for (var k in obj) if (obj.hasOwnProperty(k)) out[k] = obj[k];
  return out;
}
