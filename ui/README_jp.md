# Tetorica MIDI Playground — はじめに

For English instructions, open README.md in FILES.

JavaScriptでGarageBandの楽器を演奏してみましょう。
TetoricaはMIDI（演奏指示）を送り、GarageBandが音を鳴らします。

## 必要なもの

- Apple SiliconのMac（今回の配布版）
- GarageBand
- Tetorica MIDI Playgroundアプリ

配布されたアプリを使う場合、Node.jsやRustは不要です。

## 1. macの仮想MIDIバスを作る

「Audio MIDI設定」を開きます。見つからなければSpotlightで
「Audio MIDI」と検索するか、ターミナルで次を実行します。

    open -a "Audio MIDI Setup"

1. 「ウインドウ」→「MIDIスタジオを表示」。
2. 「IACドライバ」をダブルクリック。
3. 「装置はオンライン」にチェック。
4. ポート一覧の＋でバスを追加し「Tetorica Notes」と命名。

この名前は自分で付けます。TetoricaやGarageBandという名前が
自動で現れるわけではありません。発音の確認にはバス1つで十分です。

## 2. GarageBandを準備する

1. 「空のプロジェクト」を作成。
2. 「ソフトウェア音源」のトラックを作成。
3. ピアノなどの音色を選択。
4. そのトラックを選択したままにします。

再生・録音ボタンを押す必要はありません。

## 3. Tetoricaからテスト音を送る

1. 右上の「MIDI settings」を押す。
2. 「Refresh ports」を押す。
3. 「Note output」で「Tetorica Notes」を含むポートを選択。
4. 「Connect output」を押す。
5. 「Play C4 (250 ms)」を押す。

短い音が鳴れば接続成功！ ノート番号60、チャンネル1を送ります。
この段階ではClock inputの接続は不要です。

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

- IACの「装置はオンライン」を確認してRefresh ports。
- 出力を選択した後、Connect outputを押したか確認。
- GarageBandのソフトウェア音源トラックを選択。
- トラックのミュート・音量・macのスピーカー出力を確認。
- IAC準備前にGarageBandを開いていたら、GarageBandを再起動。
- Tetoricaの下部とConsoleに出るエラーを確認。

## 今回の実験版の範囲

スクリプトは内部BPMで動きます。GarageBandのテンポとは自動同期しません。
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
コールバック引数のヘルパーを使うと、cycleのカウンターがループごと・呼び出し順ごとに分かれ、await後の停止も有効になります。名前付きcycleもループ内で独立します。同名ループの置換はカウンターをリセットし、旧ループの専用ヘルパーを停止します。送信済みノートは指定時間（最大10秒）でNote Offになります。画面のStopは全ノートを即時解放します。引数を使わずグローバルヘルパーを呼ぶ従来コードは反復の境界で停止し、cycleは共有のままです。Runで全再起動する仕様は変わりません。
