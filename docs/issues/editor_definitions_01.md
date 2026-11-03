# MIDI Playgroundの型定義・実装コード表示

2026-11-03。FM2612 Playgroundと同様に、補完・ホバーの説明から型の中身や実装コードを読めるようにする。実装前のTODO。

## 対象

- `MidiOutput`などのAPI型と、そのメンバーを読取専用の画面で開く。
- 型定義内の関連型をたどり、必要な箇所ではJavaScriptの実装も開く。
- 補完・ホバーの説明から表示へ進める入口と、F12／Go to Definitionを用意する。
- FILESの自作関数・相対import先への定義ジャンプも、実際のファイル選択と連動させる。
- 内部ソースはアプリに含まれる実際のファイルを読む。FILES・プロジェクトZIP・実行コードへ追加しない。

## TODO

- [x] 本体の定義ビューアーとMonacoの補完説明・ホバーを調査し、MIDI APIに必要な入口とソース対応を決める。
- [x] API宣言のモデル、読取専用ビューアー、関連型・JavaScript実装への移動を実装する。
- [x] エディター・FILESとの接続、補完説明・ホバーからの入口、F12を追加する。
- [x] `MidiOutput`から`MidiPlayOptions`、`midi.output()`、`play`／`setVoice`などをたどって確認する。
- [x] ユーザー定義・相対import、ローカル変数の優先、閉じた後の編集・Undo・保存、プロジェクト置換を確認する。
- [x] 英日ガイドと既存TODOを更新し、実画面・自動テストの結果を残す。

Nativeの演奏処理や音色、バージョン、公開作業は変更しない。JavaScript側の実装閲覧が対象で、Rust／C++音源コア全体の閲覧は今回追加しない。

## 実装

- `ui/editor-definitions.js`：API宣言をMonacoモデルへ登録し、読取専用dialogで表示。API型・メンバーから実際のJavaScriptファイルの関数へ対応付け、同梱ソースを遅延取得する。実装内の相対importもF12でたどれる。ソースは実行しない。
- `ui/editor-definition-links.js`：API型・メンバーのリンクを登録。`file:///tetorica-definition/...`をアプリ内で処理し、既知のシンボルをビューアーへ渡す。JavaScript／TypeScriptのホバーにも関連型への入口を補う。
- `ui/playground-api.d.ts`のJSDocに型リンクを追加し、`scripts/prepare.mjs`で生成物を更新。Monaco標準のTypeScript補完プロバイダーを使ったまま、補完説明にリンクを表示する。独自URIスキームはMonacoのMarkdownで除去されるため使わない。リンクは署名の下の説明に表示し、署名文字列そのものはリンクに変更しない。
- FILES内の定義は通常のエディターとファイル選択へ接続。API・内部ソースのモデルはFILESの所有モデルと分け、プロジェクトの保存・ZIPへ追加しない。
- Monaco 0.52.2のWordHighlighterはモデル切替時に未処理の`Canceled`を発生させる場合がある。メインと読取専用ビューアーの`occurrencesHighlight`を`off`にし、該当処理を開始しない構成にした。全体のエラー無視は追加していない。補完・型診断・定義ジャンプ・選択ハイライトは維持する。

## 検証

- `node --test test/*.test.mjs`：130件すべて成功。既存の演奏・停止・カセット・プロジェクト置換テストも含む。
- 型宣言の選択位置、継承メンバー、実装位置、コメント／不明な対象の除外、相対import・取得可能な同梱ソースの範囲を検証。
- 実際のMonaco TypeScript Workerで、`midi.output`・`play`・`setVoice`・JSDoc型補完の説明に型リンクが残ることを検証。ホバーはローカル定義を優先することをテストした。
- Chromium／WebKitで`ui/index.html`と本番同梱Monacoを使用。補完のRead More→MidiOutputリンク、ホバーからのMidiOutputリンク、関連型F12→MidiPlayOptions、View implementation、実装内import先F12、Back／Close、メインのJSDocからのF12、自作FILESのimport宣言からの移動を実操作した。元のテキスト、Undo、編集可能状態、FILES一覧と保存データを確認。両engineでpage errorなし。
- ブラウザー検証のNative呼出はstubで、ユーザーの実アプリデータや音声出力へは接続していない。検証スクリプト：`/private/tmp/check-midi-definitions.cjs`、結果：`/private/tmp/midi-definitions-report.json`。
- 型定義・JavaScript実装の画面画像を両engineで取得し、読取専用表示、ボタン、表示位置を目視確認した（`/private/tmp/midi-definitions-{chromium,webkit}-{type,source}.png`）。
- 初期のブラウザー検証では説明を開く操作の待機不足、定義候補が複数ある箇所を単一遷移として扱うテストの誤り、WordHighlighterのキャンセルエラーを検出した。説明の読み込みと実際のRead More操作を待ち、import宣言から単一定義への遷移を検証。キャンセルは上記設定で原因の処理を止めて再検証した。

## 制約

- 同じ定義ファイル内のF12移動はMonaco自身が処理するため、ビューアーのBack履歴には入らない。型リンクや実装表示、別の実装ファイルへ進む操作は履歴に入る。
- 動的importした関数の使用箇所など、TypeScriptがローカル束縛と元の関数の両方を返す場合は定義候補から選ぶ。importの束縛名からは元の関数を直接開ける。
- 静的なグローバルヘルパー補完候補はAPIの説明として表示する。同名のローカル変数がある場合も、この候補自身のリンクはAPIへ進む。型サービス側の候補・ホバー・F12は実際の束縛を使う。
- `tetorica-api.d.ts`および`tetorica-runtime/`は内部モデルの識別に使う。ユーザーの同名モデルを内部ソースとして再利用・破棄しない。衝突時は定義表示のエラーを記録し、メインのエディターを維持する。
- Native実アプリでの操作確認は別途。開発用の反映は`npm run dev`で起動し直し、配布アプリへは再ビルドする。
