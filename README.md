# 議会答弁ノートリンク — Google Docs エディタアドオン

議会答弁（代表質問・委員会質疑）の Google ドキュメント群に対し、Obsidian の `[[ ]]`
リンクに相当する **案件間の順方向リンク・文書単位の逆引き** を、**本文を汚さず**に
実現する Google Docs エディタアドオンです（仕様書 v2 準拠）。

リンク情報は本文テキストではなく **DocumentProperties** に持ち、各リンクは
**物理フォルダパス**と**ファイル URL（＝ファイル ID）**の両方を保持して、移動・差し替えに
追従します。

## 主な機能

1. **順方向リンクの作成補助** — 同一フォルダの候補表示・名前絞り込み・フォルダ階層たどり・URL/ID 直接指定
2. **順方向リンクの保存** — 自文書 `outboundLinks`（物理パス＋ファイル URL）
3. **逆引きリンク** — 参照先文書の `inboundLinks`（文書単位）に materialize
4. **検証・更新** — 解決アルゴリズム（ID 優先 → パス再解決）で `ok`/`path_updated`/`id_relinked`/`broken` を判定
5. **外部リンクの取り込み** — 本文中の手書き URL/ID を検出し、確認のうえ `source:"external"` で取り込み

## 動作方針（重要）

ユーザー確定方針に従い:

- **開封時（単純 `onOpen`）**: メニュー生成のみ。重い処理・他文書書き込みはしない（認証不要範囲）。
- **他文書への波及（逆引き）**: サイドバーの **「今すぐ同期」** ボタンによる**明示実行のみ**。
  インストール型トリガーは使いません。
- **外部リンク取り込み**: **手動（確認あり）**。スキャン → 候補選択 → 取り込み。

### Apps Script の制約に関する設計メモ

`PropertiesService.getDocumentProperties()` は常に「アクティブな文書」を対象にし、
`DocumentApp.openById` で開いた**他文書の DocumentProperties は読み書きできません**。
そのため文書間の逆引き伝播は、`ScriptProperties` 上の共有レジストリ（`Registry.gs`）を
チャネルとして実現しています。各文書の `outboundLinks`/`inboundLinks` は従来どおり
その文書自身の DocumentProperties に保持されます（仕様の per-doc モデルを維持）。

- 順方向リンク A→B を作る → A の `outboundLinks` に保存 ＋ レジストリに「B ← A」を登録
- B を開いて「今すぐ同期」 → レジストリから「B の参照元」を読み、B の `inboundLinks` に materialize

## ファイル構成

| ファイル | 役割 |
|---|---|
| `appsscript.json` | マニフェスト（V8 / OAuth スコープ / Docs アドオン） |
| `Code.gs` | エントリポイント（`onOpen`/`showSidebar`/`getInitialContext`/`runSelfTest`） |
| `LinkStore.gs` | DocumentProperties 読み書き・エントリ操作・URL/ID ユーティリティ |
| `DriveIndex.gs` | フォルダ探索・物理パス算出（第1親正規化）・キャッシュ |
| `Resolver.gs` | 解決アルゴリズムと status 判定 |
| `Registry.gs` | 文書間逆引き伝播の共有レジストリ（ScriptProperties） |
| `Sync.gs` | リンク追加/削除・全同期（`syncNow`） |
| `ExternalLinks.gs` | 本文走査による外部リンク検出・取り込み |
| `Sidebar.html` / `Stylesheet.html` / `JavaScript.html` | サイドバー UI |

## 導入手順（clasp）

[clasp](https://github.com/google/clasp) を使って Apps Script へ push します。

```bash
npm install -g @google/clasp
clasp login

# 新規にコンテナバインド型の Docs プロジェクトを作る場合
clasp create --type docs --title "議会答弁ノートリンク"
#  → 生成された scriptId を控える

# あるいは既存の Apps Script プロジェクトに紐づける場合
cp .clasp.json.example .clasp.json
#  → .clasp.json の scriptId を編集

clasp push
```

push 後、対象の Google ドキュメントを開くと **「拡張機能」メニュー** にアドオンが現れます。

## 使い方

1. 拡張機能メニュー →「議会答弁ノートリンク」→「リンク サイドバーを開く」。
2. **リンク追加**: 同一フォルダの候補から「リンク」、またはフォルダを潜って絞り込み、
   もしくは URL/ID を直接入力して追加。
3. **今すぐ同期**: 順方向の検証・更新と、逆引きの materialize を実行。
4. **本文をスキャン**: 手書きの外部リンク候補を表示 → チェックして取り込み。

## 解決優先順位（早見表）

| 状況 | ファイル URL(ID) | 物理パス | 動作 | status |
|---|---|---|---|---|
| 健全 | 解決可 | 一致 | 何もしない | `ok` |
| ファイル移動 | 解決可 | 不一致 | folderPath を更新 | `path_updated` |
| 差し替え・再作成 | 解決不可 | 同名あり | fileUrl/fileId を張り直し | `id_relinked` |
| 喪失 | 解決不可 | 同名なし | 要確認 | `broken` |

## 自己テスト

純粋関数（`extractFileId` / `upsertLink` / `decideStatus` など）の軽量テストを同梱しています。
Apps Script エディタで関数 `runSelfTest` を実行し、ログ（表示 → 実行ログ）で `PASS`/`FAIL` を確認できます。

## 既知の制約 / 未決事項

- 物理フォルダパスは**第1親に正規化**します（Drive は複数親を許すため）。
- `ScriptProperties` レジストリには容量上限（合計約 500KB）があります。議会案件単位なら十分収まる想定です。
- 単純 `onOpen` は 30 秒制限・無認証で動くことがあるため、開封時に重い処理は行いません。
