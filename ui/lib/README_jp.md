# ライブラリ

再利用するJavaScriptをFILESのlibに置きます。特別な実行領域ではなく、整理用のフォルダです。
`examples/09_library.js`をRun fileに選んでRunすると、内蔵YM2612を有効化し、`lib/phrase.js`を使って3音を繰り返します。Stopで終了します。

## 相対import

`/index.js`からは:
```js
const { playPhrase } = await import("./lib/phrase.js");
```
`/examples/09_library.js`からは:
```js
const { playPhrase } = await import("../lib/phrase.js");
```
パスは呼び出すファイルを基準にし、`.js`または`.mjs`を含めます。Run fileでは`await import(...)`を使い、静的importやexportは使いません。import先のモジュールでは静的な相対importとexportが使えます。循環import・npm・外部URL・計算したimportパス・`import.meta`は未対応です。

## playPhrase

`await playPhrase(context, output, notes, options)`で音を順番に鳴らします。outputは`midi.output(...)`の戻り値、notesはMIDI番号または音名の配列です。optionsは拍単位のdurationとvelocityで、省略時はplayと同じ0.5拍・90です。空配列は何も鳴らしません。モジュール自身は接続を開きません。

`liveLoop`が受け取るcontextを引数で渡します:
```js
liveLoop("phrase", async context => {
  await playPhrase(context, instrument, ["C4", "E4", "G4"], { duration: 0.5 });
  await context.beat(1);
});
```
import先ではRun fileのローカルなヘルパーを参照できません。グローバルplayに頼らず、contextと出力を引数で渡してください。`context.playOutput`を使うことでawaitをまたいだ発音も呼び出し元ループに属し、Stop・Applyの停止対象になります。

## 補完と編集

`lib/phrase.js`には`@param`・`@returns`と、`TetoricaContext`・`MidiOutput`・`MidiNote[]`・`MidiPlayOptions`の型を記載しています。相対import経由でもMonacoが補完・ホバーに使用します。実行時の型検証を追加するものではありません。

FILESでライブラリを編集し、自作の例から再利用できます。保存済みのライブラリコードとexamplesはアップデートでも保持します。このREADMEは読取専用の同梱ガイドで、アプリ更新時に更新されます。exportするモジュールではなく、呼び出すexampleをRun fileに指定してください。

FM2612ブラウザ版固有のオペレーター操作・サンプル再生・CH1定数は提供しません。MIDI出力ハンドルとNativeのYM2612／Mixerタブを使います。VSTホストやDAWトラックの検出機能も対象外です。
