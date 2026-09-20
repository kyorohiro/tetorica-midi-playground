# Tetorica MIDI Playground — はじめに

For English instructions, open README.md in FILES.

JavaScriptでGarageBandの楽器を演奏してみましょう。
TetoricaはMIDI（演奏指示）を送り、GarageBandが音を鳴らします。

## 必要なもの

- Macと、そのCPUに合った配布版アプリ
- GarageBand
- Tetorica MIDI Playgroundアプリ

配布されたアプリを使う場合、Node.jsやRustは不要です。

## 1. GarageBandを準備する

1. GarageBandで「空のプロジェクト」を作成。
2. 「ソフトウェア音源」トラックを追加してピアノなどを選択。
3. そのトラックを選択したままにします。再生・録音ボタンは不要です。

## 2. MIDI出力を選ぶ

1. Tetoricaの **MIDI settings** を開いて **Refresh ports**。
2. **Choose MIDI output** にGarageBandの仮想入力があれば選択。
3. 選択すると自動接続します。緑色の接続表示と接続先名を確認してください。

Clock inputは任意です。スクリプトで音を鳴らすだけなら不要です。

## 3. テスト音を鳴らす

**Test sound — Play C4** を押すと、ノート60をチャンネル1で250ms送ります。
接続表示は発音を保証するものではありません。GarageBandの音源トラックを選択してください。

### 別の方法: IACバス

GarageBandの仮想入力が出ない場合はIACバスも使えます。
「Audio MIDI設定」→「ウインドウ」→「MIDIスタジオを表示」→「IACドライバ」で
「装置はオンライン」を有効にし、「Tetorica Notes」というバスを追加して出力先に選びます。
GarageBandの仮想入力がある場合、この設定は不要です。

## 4. JavaScriptで演奏する

「Run file」で「/index.js」を選んで「Run」を押します。この説明を開いたままでも実行できます。
既定のleadはStopまで繰り返します。melody.jsはC・E・G・Cの順に鳴ります。「loop.js」は「Stop」まで繰り返します。

    setBpm(120);
    await play("C4", { duration: 0.5 });
    await play("E4", { duration: 0.5 });
    await play("G4", { duration: 1 });

- duration: 拍数（0.5なら八分音符）。playは音の長さだけ待ちます。
- channel: MIDIチャンネル1〜16。省略すると1。
- velocity: 強さ1〜127。省略すると90。
- await beat(1): 1拍休む。
- log("hello"): Consoleに表示。
- Run: 全ループを停止してコードを最初から実行。
- Stop: 実行と発音を停止。
- Cmd+Enter: Run / Shift+Escape: Stop。

このREADME自体は実行されません。Runは「Run file」で選んだコードを実行します。

## 保存

編集したコードはアプリ内に自動保存されます。
「Export file」で別ファイルにバックアップできます。
「Import」でJavaScriptファイルを追加できます。自動実行はしません。

## 音が鳴らないとき

- GarageBandを開いてからRefresh ports。IACを使う場合は「装置はオンライン」を確認。
- 接続表示と接続先を確認。再試行はReconnect output。
- GarageBandのソフトウェア音源トラックを選択。
- トラックのミュート・音量・macのスピーカー出力を確認。
- IAC準備前にGarageBandを開いていたら、GarageBandを再起動。
- Tetoricaの下部とConsoleに出るエラーを確認。

## 今回の実験版の範囲

既定では内部BPMで動きます。試験的な外部拍待機は末尾の説明を参照してください。GarageBandのテンポとは自動同期しません。
MIDIタブのClock受信テストと、コード実行はまだ別です。
FM音源、音声出力、エフェクト、Monaco、外部Clockでのコード実行は未搭載。
読み込むJavaScriptは自分で内容を確認したものを使ってください。

終了時はStop、MIDI settingsのDisconnectを押してください。


## Run file

Runは、エディターで開いているファイルとは別に、**Run file**で選んだスクリプトを実行します。既定は単一チャンネルのEマイナーペンタトニックのleadループ `/index.js` です。この説明を開いたままでも実行できます。`melody.js`や`loop.js`を実行する場合は、先に **Run file** で選んでください。保存済みのコードは保持されます。

`scale(root, name, octaves)` は major / minor / majorPentatonic / minorPentatonic に対応。`cycle(values)` は順に値を返し、カウンターはRun内で共有します。`cycle("lead", values)` で別のカウンターを指定できます。Runでリセットします。`nextBeat()` はRun開始を基準とする次の内部拍境界まで待機します。既存プロジェクトでは `/lead.js` をRun fileで選ぶと新しい初期サンプルを試せます。

タイミング: BPM変更時も現在の拍位置を保ち、待機中のnextBeatにも反映します。拍の境界で呼ぶと次の拍まで待ちます。Workerタイマーは遅延する場合があり、サンプル精度や外部MIDI Clock同期は保証しません。

## Loop-local helpers

```js
liveLoop("lead", async ({play, beat, cycle, nextBeat}) => {
  await nextBeat();
  await play(cycle(["E4", "G4", "B4"]), {duration: 0.08});
  await beat(0.04);
});
// Elsewhere in your script:
// stopLoop("lead");
// stopAllLoops();
```
コールバック引数のヘルパーを使うと、cycleのカウンターがループごと・呼び出し順ごとに分かれ、await後の停止も有効になります。名前付きcycleもループ内で独立します。同名ループの置換はカウンターをリセットし、旧ループの専用ヘルパーを停止します。専用playで送信したノートは個別停止時にMIDI Note Offで解放します。同一チャンネル・同一音を別ループが再発音した場合は最後の発音元が所有し、旧ループの停止では消しません。グローバルplayには個別所有権がありません。画面のStopは全ノートを解放します。Run fileの直接inline・引数なし・ブロック形式のコールバックも自動束縛します。別関数などでは専用ヘルパーを渡してください。Runで全再起動する仕様は変わりません。

## Music helpers

```js
for (const note of chord("E4", "minor7")) {
  await play(note, {duration: 0.25, velocity: randInt(70, 100)});
}
```

- `chord(root, name)`: major, minor, major7, minor7, dominant7.
- `rand()`: 0 <= value < 1.
- `rrange(min, max)`: random interpolation between two values.
- `randInt(min, max)`: integer between ceil(min) and floor(max), inclusive.
- `lerp(a, b, t)`: linear interpolation; t is not clamped.
`chord`は音名の配列を返し、自動では同時発音しません。生成音はMIDI 0〜127に制限し、不正な数値や整数範囲はエラーにします。ループのコールバック引数からも使えます。`noteLerp(from, to, t)` は音名またはMIDI番号を補間し、playに渡せる整数MIDI番号を返します。最寄りの半音へ丸め、中間値は上の音になります。tは制限せず、補間結果が音域外なら丸める前にエラーにします。FM版のピッチオブジェクトとは異なり、Pitch Bendは送りません。FM版playは秒・0始まりのチャンネルですが、MIDI版playは拍・1〜16のチャンネルです。

## FM / MIDI API differences

| API | MIDI Playground |
| --- | --- |
| `play` | duration in beats (default 0.5), channel 1–16 (default 1), velocity 1–127 (default 90) |
| `beat(count = 1)` | 0 < count <= 1024; global: captures BPM; loop-local: follows BPM changes |
| `nextBeat()` | shared internal beat boundary; pending wait follows BPM changes |
| `scale(root, name, octaves = 1)` | four documented scales; octaves must be an integer 1–11; every note must fit MIDI 0–127 |

FM版playは秒（既定0.2）・0始まりのチャンネルです。内部ClockモードのMIDI版playは拍数をミリ秒へ丸め、1〜10000msかつ128拍以下に制限します。送信失敗はエラーになります。待機中のplayとグローバルbeatはBPM変更後も元の待ち時間を使います。専用beat/nextBeatはループごとの拍位置を管理し、待機中のBPM変更も反映します。ループの拍位置と現在の拍の遅い方を基準に進み、過ぎた拍をまとめて再実行しません。タイマー遅延は起こり得るためサンプル精度は保証しません。scaleは音名に加えて整数MIDI番号のrootも受け付け、octavesの整数制限はFM版より厳格です。完全互換ではありません。

## Keyboard input

```js
onKeyboardPressKey("piano", async (event) => {
  const notes = {KeyA: "C4", KeyS: "E4", KeyD: "G4"};
  if (notes[event.code]) await play(notes[event.code], {duration: 0.25});
});
onKeyboardReleaseKey("piano", (event) => log("Released", event.code));
```
Run後、エディター上の **Keyboard input** をクリックしてA/S/Dを押してください。この領域にフォーカスがあるときだけ送信するため、編集中の文字入力では発音しません。Tab/EscapeとCtrl/Alt/Command付き操作は対象外です。フォーカスを失うと送信済みの押下キーのreleaseを送ります。eventにはkey/code/type/repeatと修飾キー情報が入り、DOMメソッドはありません。キーリピートは無視し、非同期コールバックの実行中はそのハンドラーへの新規イベントをスキップします。同種の同名ハンドラーは置換、最大32個です。StopでWorkerと登録を破棄し、Runで新規開始します。発音はduration指定で、押している間だけ伸ばす仕様ではありません。

## FILES内のモジュール

```js
// notes.js (add this file to FILES using Import)
export const notes = ["E4", "G4", "B4"];
```

```js
// index.js (Run file)
const {notes} = await import("./notes.js");
for (const note of notes) await play(note, {duration: 0.25});
```

Run fileでは文字列の相対パスで `await import()` を使います。読み込む `.js` / `.mjs` 内ではstatic import・再export・dynamic importが使えます。拡張子を含め、FILES内の `./` / `../` で指定してください。同一モジュールの評価はRunごとに一度だけで、編集は次回Runに反映されます。条件分岐内のimportも含め、参照先は実行前にすべて解決します。

モジュール内でplayやbeatが必要な場合は関数の引数として渡してください。Run fileのヘルパーは自動的には引き継ぎません。循環import、変数で作るパス、npm・外部URL、import属性、import.metaは未対応です。参照の深さは64まで。Run file自体ではstatic import・exportは使えません。

## エディター

MonacoでJavaScriptの色分け、検索（Command/Ctrl+F）、補完（Ctrl+Space）、ファイル別Undo・カーソル位置保持が使えます。MIDIヘルパーの補完にはこのアプリの仕様を表示します。ガイドは編集できません。Command/Ctrl+EnterでRun fileを実行、Shift+Escapeで停止します。ローカル同梱のためCDN接続は不要で、読み込み失敗時はtextareaを使えます。Run fileはヘルパーを渡したasync関数内で実行するため、JavaScriptの型・構文診断は無効です。モジュール間の型解決は未対応です。

補完はECMAScript標準とMIDIヘルパーを対象にし、screenLeftなどのWindow/DOMグローバルを除外します。ローカル変数・JavaScript標準メソッドの補完は維持します。

## 外部拍Clock（試験版）

MIDI設定でClock入力を接続し、**External MIDI (trial)** を選択してRunを押した後、送信元でStartまたはContinueを送ります。スクリプトはその受信まで待ちます。beat・nextBeatは24パルス＝1拍で待機し、setBpmでは変化しません。playの音長もClockパルスに追従します。詳細な制限は末尾を参照してください。

Stop・再Start・1秒のClock途絶でRunを終了し、Note Offを送ります。再開はRunを押し直してから送信元を開始してください。Continueは新しく待機中のRunを開始できますが、終了したスクリプトを再開するものではありません。接続先・Clockモード変更でも停止します。DAWでのタイミング実測は未実施です。

## Applyとループコンテキスト

Runは全停止・再開始、**Apply**はWorkerとBPM・拍位置を維持してRun fileを再評価します。同名ループは旧専用ノートを解放して置換、cycleはリセット。他のループは継続し、新しいコードから削除したループも残るためstopLoopで明示停止します。トップレベル処理は再実行、ローカル変数は新規です。前の評価がawait中ならApplyはConsoleへ通知してスキップします。エラー時はRun全体を停止します。

Run file内の直接inline `liveLoop("lead", async () => { ... })` はplay/beat/nextBeat/cycleをループ内へ束縛し、await後も分離します。明示引数と先頭階層のローカル宣言は維持します。別関数・import先・別名・式だけのコールバックには専用ヘルパーを引数で渡してください。汎用的な非同期コンテキスト伝播ではありません。

外部playのNote Offはnative側でClockパルス数を数えます。1/24拍単位で端数切り上げ、128拍まで。BPM欄/setBpmは外部音長へ影響せず、発音中のテンポ変更にも残り音長が追従します。Worker待機はMIDI応答後から数えるため、IPC・タイマー遅延によりコード再開がnative Note Offより遅れる場合があります。Stop・途絶・再StartでRun終了する仕様は維持します。

## Keyboardタブ：コードを書く前の試奏

MIDI outputをGarageBandなどに接続して **Keyboard** タブを開きます。Runやコードは不要です。画面のキーを押し続けるか、表示に対応する数字・英字のPCキーで演奏し、離すとNote Offを送ります。MIDIチャンネル1〜16・velocity1〜127を指定でき、同じチャンネルで和音も弾けます。楽器・フレットの選択はFM版と同じ指板配置を変えるもので、音色はDAW側で選びます。

タブ・チャンネル・配置変更、ウィンドウ離脱、Release notes、Stopで保持音を解放します。Code上のKeyboard inputはスクリプトイベント用で、別機能です。同じチャンネル・音程が重なる場合は最後の発音元を優先し、古いキー解放で新しい音を消さないようにします。

## 内蔵YM2612で試す（macOS試験版）

DAWなしで確認できます。**MIDI connections**で**YM2612 A / B**を有効にし、MIDI設定で**Tetorica YM2612 A**を選んで、KeyboardまたはRunで演奏してください。Bは独立したもう1つのポートです。各音源はMIDI CH1〜16で6音を共有する固定FM音色です。Mixerで音源別の音量・パン・ミュートとマスター音量を調整できます。有効化時のmacOS既定音声出力を使います。デバイス変更後は無効化→再有効化し、MIDI出力も再接続してください。音色編集・サステイン・Pitch Bendは未対応です。
