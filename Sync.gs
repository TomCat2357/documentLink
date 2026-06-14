/**
 * Sync — 順方向リンクの作成・削除・検証、および逆引きの伝播・materialize。
 *
 * 設計（仕様 6.3 / ユーザー確定: 明示実行 + onOpen 軽量チェックのみ）:
 *   - 他文書への波及は syncNow（サイドバーの「今すぐ同期」）でのみ実行する。
 *   - 文書間伝播は Registry.gs（ScriptProperties）を経由する。
 *   - 各文書の outbound/inbound はその文書の DocumentProperties に保持する。
 */

/* ───────────── 順方向リンクの作成・削除（仕様 4.2 / 機能 2） ───────────── */

/**
 * 順方向リンクを 1 件追加する。
 *   - 自文書 outboundLinks に upsert（物理パス＋ファイル URL の両方を保存）。
 *   - レジストリに「target ← 自文書」を登録（逆引きの伝播）。
 * @param {string} fileId 参照先ファイル ID
 * @param {string=} source "manual"(既定) | "external"
 * @return {{ok:boolean, error:(string|undefined), outbound:Array}}
 */
function addOutboundLink(fileId, source) {
  var src = source || 'manual';
  var resolved = resolveInput(fileId);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error, outbound: readLinks(OUTBOUND_KEY) };
  }

  var entry = {
    fileUrl: resolved.url,
    fileId: resolved.fileId,
    folderPath: resolved.folderPath,
    displayName: resolved.name,
    source: src,
    lastVerifiedAt: nowIso(),
    status: 'ok'
  };

  var outbound = upsertLink(readLinks(OUTBOUND_KEY), entry);
  writeLinks(OUTBOUND_KEY, outbound);

  // 逆引き伝播: 参照先のレジストリへ自文書を登録
  registryAddReferrer(resolved.fileId, getSelfEntry_());

  return { ok: true, outbound: outbound };
}

/**
 * 順方向リンクを 1 件削除する。レジストリの逆引きからも自文書を外す。
 * @param {string} fileId
 * @return {{ok:boolean, outbound:Array}}
 */
function removeOutboundLink(fileId) {
  var outbound = removeLinkById(readLinks(OUTBOUND_KEY), fileId);
  writeLinks(OUTBOUND_KEY, outbound);
  registryRemoveReferrer(fileId, getSelfId_());
  return { ok: true, outbound: outbound };
}

/* ───────────── 検証・全同期（仕様 6.4 / 6.5 / 機能 4） ───────────── */

/**
 * 今すぐ同期（明示実行）。
 *   1. 自文書 outbound を全件解決・更新（移動追従・差し替え張り直し・broken 判定）。
 *   2. 解決済み outbound 各先のレジストリへ自文書を再登録（逆引き伝播）。
 *      ID が張り替わった場合は旧 ID の逆引きを外し、新 ID に付け替える。
 *   3. レジストリから自文書の参照元を読み、自文書 inboundLinks に materialize。
 *      参照元エントリも解決して最新化（孤立・broken を反映）。
 * @return {{outboundUpdated:number, inboundPushed:number, broken:Array, outbound:Array, inbound:Array}}
 */
function syncNow() {
  var selfEntry = getSelfEntry_();
  var selfId = selfEntry.fileId;
  var broken = [];
  var outboundUpdated = 0;

  // 1 & 2: outbound 解決＋逆引き伝播
  var outbound = readLinks(OUTBOUND_KEY);
  var newOutbound = [];
  for (var i = 0; i < outbound.length; i++) {
    var before = outbound[i];
    var after = resolveEntry(before);
    if (after.status !== 'ok') outboundUpdated++;
    if (after.status === 'broken') {
      broken.push({ where: 'outbound', displayName: after.displayName, folderPath: after.folderPath });
    } else {
      // ID 張り替えがあれば旧 ID の逆引きを外す
      if (before.fileId && after.fileId && before.fileId !== after.fileId) {
        registryRemoveReferrer(before.fileId, selfId);
      }
      registryAddReferrer(after.fileId, selfEntry);
    }
    newOutbound.push(after);
  }
  writeLinks(OUTBOUND_KEY, newOutbound);

  // 3: inbound を materialize（レジストリ → 自文書 DocumentProperties）
  var referrers = registryGetReferrers(selfId);
  var newInbound = [];
  for (var j = 0; j < referrers.length; j++) {
    var ref = resolveEntry(referrers[j]);
    if (ref.status === 'broken') {
      broken.push({ where: 'inbound', displayName: ref.displayName, folderPath: ref.folderPath });
    }
    newInbound.push(ref);
  }
  writeLinks(INBOUND_KEY, newInbound);

  return {
    outboundUpdated: outboundUpdated,
    inboundPushed: newInbound.length,
    broken: broken,
    outbound: newOutbound,
    inbound: newInbound
  };
}

/* ───────────── 自文書メタ ───────────── */

/**
 * @private 自文書の ID
 */
function getSelfId_() {
  return DocumentApp.getActiveDocument().getId();
}

/**
 * @private 逆引きに登録する自文書エントリを生成する。
 * @return {Object}
 */
function getSelfEntry_() {
  var doc = DocumentApp.getActiveDocument();
  var file = DriveApp.getFileById(doc.getId());
  return {
    fileUrl: file.getUrl(),
    fileId: file.getId(),
    folderPath: folderPathOfFile_(file),
    displayName: file.getName(),
    source: 'manual',
    lastVerifiedAt: nowIso(),
    status: 'ok'
  };
}
