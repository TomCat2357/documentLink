/**
 * ExternalLinks — 本文中に手書きされたファイル URL / ID の取り込み（仕様 7 章 / 機能 5）。
 *
 * ユーザー確定: 取り込みは「手動（確認あり）」。スキャンで候補を提示し、
 * ユーザーが選択・確認してから importExternalLinks で取り込む。自動取り込みはしない。
 */

/**
 * 本文（テキストと埋め込みリンク URL）を走査し、まだ outbound に無い
 * ファイル ID 候補を解決して返す。
 * @return {{ok:boolean, candidates:Array<{fileId,name,url,folderPath,resolvable:boolean}>}}
 */
function scanExternalLinks() {
  var doc = DocumentApp.getActiveDocument();
  var selfId = doc.getId();
  var existing = readLinks(OUTBOUND_KEY);
  var found = collectFileIds_(doc.getBody());

  var seen = {};
  var candidates = [];
  found.forEach(function (fid) {
    if (fid === selfId) return;            // 自分自身は除外
    if (seen[fid]) return;
    seen[fid] = true;
    if (findLinkById(existing, fid)) return; // 既に取り込み済みは除外

    var resolved = resolveInput(fid);
    if (resolved.ok) {
      candidates.push({
        fileId: resolved.fileId,
        name: resolved.name,
        url: resolved.url,
        folderPath: resolved.folderPath,
        resolvable: true
      });
    } else {
      candidates.push({
        fileId: fid,
        name: '(解決不能)',
        url: buildFileUrl(fid),
        folderPath: '',
        resolvable: false
      });
    }
  });

  return { ok: true, candidates: candidates };
}

/**
 * 選択された外部リンク候補を source:"external" として取り込む。
 * 解決不能な ID も broken エントリとして記録（要確認リストに出る）。
 * @param {Array<string>} fileIds
 * @return {{ok:boolean, imported:number, outbound:Array}}
 */
function importExternalLinks(fileIds) {
  var ids = fileIds || [];
  var imported = 0;
  for (var i = 0; i < ids.length; i++) {
    var result = addOutboundLink(ids[i], 'external');
    if (result.ok) {
      imported++;
    } else {
      // 解決できなかった ID は broken エントリとして自文書 outbound に残す
      var outbound = upsertLink(readLinks(OUTBOUND_KEY), {
        fileUrl: buildFileUrl(ids[i]),
        fileId: ids[i],
        folderPath: '',
        displayName: '(解決不能)',
        source: 'external',
        lastVerifiedAt: nowIso(),
        status: 'broken'
      });
      writeLinks(OUTBOUND_KEY, outbound);
    }
  }
  return { ok: true, imported: imported, outbound: readLinks(OUTBOUND_KEY) };
}

/* ───────────── 抽出 ───────────── */

/**
 * Body 配下のテキストとリンク URL からファイル ID を収集する。
 * @private
 * @param {Body} body
 * @return {Array<string>}
 */
function collectFileIds_(body) {
  var ids = [];

  // 1) 本文プレーンテキストから URL を拾う
  var text = body.getText() || '';
  var urlRe = /https?:\/\/[^\s)）」』】>]+/g;
  var m;
  while ((m = urlRe.exec(text)) !== null) {
    var fid = extractFileIdFromUrl_(m[0]);
    if (fid) ids.push(fid);
  }

  // 2) 各要素に付与されたリンク URL（getLinkUrl）を走査
  collectLinkUrls_(body, ids);

  return ids;
}

/**
 * 要素ツリーを再帰し、Text 要素のリンク URL を集める。
 * @private
 */
function collectLinkUrls_(element, ids) {
  var type = element.getType();
  if (type === DocumentApp.ElementType.TEXT) {
    var textEl = element.asText();
    var s = textEl.getText();
    var idxs = textEl.getTextAttributeIndices();
    for (var i = 0; i < idxs.length; i++) {
      var url = textEl.getLinkUrl(idxs[i]);
      if (url) {
        var fid = extractFileIdFromUrl_(url);
        if (fid) ids.push(fid);
      }
    }
    // テキスト長末尾のリンクも一応確認
    if (s && s.length > 0) {
      var lastUrl = textEl.getLinkUrl(s.length - 1);
      if (lastUrl) {
        var fid2 = extractFileIdFromUrl_(lastUrl);
        if (fid2) ids.push(fid2);
      }
    }
    return;
  }
  if (element.getNumChildren) {
    var n = element.getNumChildren();
    for (var c = 0; c < n; c++) {
      collectLinkUrls_(element.getChild(c), ids);
    }
  }
}

/**
 * URL 専用の ID 抽出（裸 ID は拾わない＝本文の通常テキストを誤検出しないため）。
 * @private
 * @param {string} url
 * @return {string|null}
 */
function extractFileIdFromUrl_(url) {
  if (!url) return null;
  var m = String(url).match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = String(url).match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return null;
}
