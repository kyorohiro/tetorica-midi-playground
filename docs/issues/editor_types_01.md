# MIDI Playgroundの型サポート改善

2026-11-03。FM2612 Playground本体と比べ、MIDI版の型サポートが弱く感じられるという報告への対応。実装前のTODO。

## 変更前に確認した差分

- `ui/editor.js`は型・構文診断を両方無効にしている。本体はJavaScriptの型チェックを有効にしている。
- 言語サービスのテストは`allowJs`・`checkJs`・ESNext module等を独自に設定しており、実アプリと同じ条件を検証していない。
- FILESのJavaScriptを個別moduleとして扱う指定がなく、Run fileごとのローカル変数やJSDocが別ファイルへ混ざる可能性がある。

## TODO

- [x] 本体とMIDI版の言語設定・型定義・モデル同期を比較し、問題を実際のMonaco言語サービスで再現する。
- [x] 実アプリとテストで同じ言語設定を使う。ECMAScript標準とMIDI APIの補完を維持し、DOM候補を除外する。
- [x] JavaScriptの型・構文診断とファイルごとのスコープを整える。Run fileがasync関数内で実行される仕様との違いを検証する。
- [x] 補完・ホバー・引数ヒント・JSDoc・相対importを確認し、既存の演奏APIに即して不足を修正する。
- [x] FILESの新規・読込・プロジェクト置換で言語モデルが正しく更新されるか確認する。
- [x] 英日ガイドの古い制約説明を更新し、検証結果と残る制約を記録する。

Nativeの演奏処理や公開APIの呼び方、バージョン、リリースは変更しない。補完の確認に使うブラウザーはエディターの検証用であり、ブラウザー版の実装ではない。

## 実装した内容

- `configureJavaScript()`で`checkJs`、ESNext module、NodeJsの相対import解決、`moduleDetection: Force`を明示。構文・型診断を有効化した。未選択の別サンプルにある同名変数・JSDocが混ざらなくなった。
- `test/editor-language.test.mjs`は独自の強い設定を作らず、実アプリの設定を取得してMonaco同梱の言語サービスで検証する。
- `enableSoundChip()`の型でPSGへの`roundRobin`指定を検出する。4種類の音源IDの補完と、音源IDのunion変数からの呼び出しは維持する。
- MIDIオプション、YM2612のOP・音色パラメーターのホバーに、実装で受け付ける値の範囲・既定値を追加した。数値の範囲チェック自体は従来の実行時処理が担当する。
- Example 13の共有状態へのJSDoc型指定を修正。新しい型チェックでも同梱サンプルが診断なしで使える。保存済みユーザーファイルは書き換えない。
- 新規・単体importは`open()`でモデルを作成し、起動時に全JSを登録、プロジェクト置換で旧モデルを廃棄する既存経路を確認。Undo・編集内容・プロジェクト置換の既存テストを維持した。

## 検証

- `node scripts/prepare.mjs`で型定義・英日ガイド・examplesの生成物を更新。
- `node --test test/*.test.mjs`：118件すべて成功。`git diff --check`も成功。Nativeコードは変更していないため、今回Rustテストは再実行していない。
- 全19個の同梱example／libraryのJSを同時に登録し、型・構文診断なし。相対import先の補完、JSDoc、ホバー、引数ヒントも検証した。
- Chromium／WebKitで本番の`ui/editor.js`とローカル同梱Monacoを使い、実Worker・補完widgetまで確認。`velocity:"loud"`にTS2322を表示し、修正後に診断が消える。`piano.`に7メンバーを表示し、別ファイルの`rogue`・`leakedHelper`は混入しない。ホバーと`MidiPlayOptions`の引数ヒント、早期returnを確認。両engineでpage errorなし。
- ブラウザー検証用の一時スクリプト：`/private/tmp/check-midi-editor-types.cjs`、結果：`/private/tmp/midi-editor-type-report.json`。Tauri実アプリの操作・実聴を実施したという意味ではない。

## 残る制約と別TODO

- [ ] API宣言のモデルとFILES用openerを用意し、定義ジャンプを本体と同じように利用できるようにする。今回は補完・ホバー・引数ヒント・診断の改善まで。
- `context`／`pg.context`はユーザー定義の状態なので、既定の値型は`unknown`。中身の補完にはExample 10のようにJSDocで型を指定する。
- API宣言はグローバル登録のため、import先でもRun用の`play`・`midi`等が候補に出る。import先にそれらが実際に注入されるわけではなく、必要なヘルパーを引数で渡す。
- Run fileで有効なトップレベル`return`の診断1108を抑制する。この設定はimport先にも適用されるため、import先の不正なトップレベルreturnをエディターで検出できない。実行時には通常のmodule構文制約が適用される。
- 静的import／exportなどのRun file固有の制約、音源の接続状態、数値の範囲など、エディターの型チェックだけでは保証しない。配布アプリへの反映には再ビルドが必要。
