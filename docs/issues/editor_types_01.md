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
- Example 13の共有状態へのJSDoc型指定を修正。新しい型チェックでも同梱サンプルが診断なしで使える。保存済みの旧同梱版の更新は追補を参照。ユーザーの編集は保持する。
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

## 追補：保存済みExample 13のTS2739

2026-11-03。ソースの型指定は修正したが、既にFILESへ保存された旧Example 13は古いコードのまま残り、`lead`／`ready`が不足する診断2739を表示する。前回の検証は最新の同梱ソースだけを対象にしており、保存済みサンプルの更新が不足していた。

- [x] 修正前の同梱Example 13を再現し、保存済みデータからの更新を追加する。
- [x] 内容が旧同梱版と完全一致するときだけ更新し、ユーザーの編集や他ファイルを保持する。
- [x] New Project／Import後の`exactFiles`でも、ファイルの追加をせずに既存の旧同梱版を更新できるようにする。
- [x] 移行後の型診断・補完と、既存プロジェクト保存・読込・演奏の回帰を確認する。

`ui/legacy-type-examples.js`に修正前の同梱全文を記録し、`upgradeExampleTypes()`で既存の正規パスが完全一致するときだけ更新する。起動時とImport／New Projectの置換時に適用し、更新した内容を保存・エディターへ同時に渡す。カセットの純粋な入出力処理は変更していない。

Monacoは期待する型と初期化式の型の不一致を正しく報告している。変数宣言の`@type`は、`unknown`の共有状態に既に値が入っている場合の型まで保証しない。初期化式全体へのJSDocキャストに直すことで、サンプルが自分で保持する`lead`／`ready`の型を明示する。これは実行時のデータ検証を追加するものではない。

検証結果：`node --test test/*.test.mjs`120件すべて成功。旧全文でTS2739を再現し、移行後の診断ゼロ、`lead.play`／`lead.setVoice`補完、`ready`のboolean型を確認した。Chromium／WebKitで実際の`ui/index.html`を読み込み、保存済みexactプロジェクトの起動、旧カセットのImport、再読み込みを検証。未編集の旧版だけ更新され、編集版、他ファイル、ファイル一覧、BPM、exactFilesが保持される。Native呼出は検証用stubで、実アプリのデータや音源へは接続していない。

ブラウザー検証スクリプト：`/private/tmp/check-midi-example13-migration.cjs`、結果：`/private/tmp/midi-example13-migration-report.json`。両engine・未編集／編集済みの4ケースでpage errorなし。編集済みの場合は自動更新しないため、必要なら共有状態の型指定を手動で同梱最新版と同じ位置へ修正する。
