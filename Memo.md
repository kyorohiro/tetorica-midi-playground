# macOSでGarageBandの音を鳴らす

2026-09-20: TetoricaからMIDIノートを送り、GarageBandで音が鳴ることを手元で確認。
ここでは音の送信までを確認する。MIDI Clock同期は別の試験。

音が出る経路:

```text
Tetorica → IACの「Tetorica Notes」バス → GarageBandのソフトウェア音源 → スピーカー
```

Tetorica自体が音声を生成するのではなく、GarageBandへ演奏指示（MIDI）を送る。

## 1. IACの仮想MIDIポートを用意する

「Audio MIDI設定」アプリを開く。見つからない場合はターミナルで:

```sh
open -a "Audio MIDI Setup"
```

1. メニューバーの「ウインドウ」→「MIDIスタジオを表示」を選ぶ。
2. 「IACドライバ」をダブルクリックする。
3. 「装置はオンライン」にチェックを入れる。
4. ポート一覧の「＋」でバスを追加し、`Tetorica Notes`という名前にする。

`Tetorica Notes`は自分で付ける名前。DAWやTetoricaというアプリがMIDIスタジオに自動で現れるわけではない。
音を鳴らすだけならバスは1つでよい。Clock受信用の`DAW Clock`はこの手順では不要。

## 2. GarageBandに音源を用意する

1. GarageBandを開き、「空のプロジェクト」を作成する。
2. 「ソフトウェア音源」のトラックを作成する。
3. ピアノなどの音色を選ぶ。
4. そのソフトウェア音源トラックを選択した状態にしておく。

GarageBandの再生・録音ボタンを押す必要はない。

## 3. Tetoricaを起動して接続する

このリポジトリのディレクトリで実行する:

```sh
cd /Users/kyorohiro/development8/wfm/hello_ymfm/w/tetorica-midi-playground
# 初回、または依存関係を更新した場合
npm ci
npm run dev
```

1. Tetoricaの「Refresh ports」を押す。
2. 「Note output」で`Tetorica Notes`を含むポートを選ぶ。
3. 「Connect output」を押す。
4. 「Play C4 (250 ms)」を押す。

GarageBandから短い音が鳴れば成功。送信するのはMIDIチャンネル1、ノート番号60。
DAWによってオクターブの表示名が違う場合がある。

この試験では「Clock input」の接続や、四分音符ごとのテスト音のチェックは不要。

## 音が鳴らない場合

- ポートが出ない: IACがオンラインか確認し、Tetoricaで「Refresh ports」を押す。
- 出力先を選んだだけになっていないか: 「Connect output」も押す。
- GarageBandでソフトウェア音源トラックが選択されているか確認する。
- トラックのミュート、音量、macの音声出力先を確認する。
- IACを用意する前にGarageBandを起動していた場合は、GarageBandを起動し直して試す。
- Tetoricaにエラーが表示されていれば、その内容を確認する。

終了時はTetoricaの「Stop notes」、続いて「Disconnect」を押す。

## 外部MIDI Clockの確認（テスト送信ツール＋GarageBand）

今回の確認経路は次のとおり。GarageBandは音源として使い、Clockは専用ツールから送る。GarageBandの仮想入力が選べる環境では、上記のIAC設定は不要。

```text
Tetorica Test Clock → TetoricaのClock input
TetoricaのNote output → GarageBandの仮想入力 → スピーカー
```

### 1. 送信ツールを起動する

```sh
cd /Users/kyorohiro/development8/wfm/hello_ymfm/w/tetorica-midi-playground
npm run clock:send
```

`MIDI source: Tetorica Test Clock` が出たら、ターミナルを開いたままにする。起動直後はClock送信が止まっている。
`--self-test`は付けない（自動テスト後に終了してポートが消える）。

### 2. Tetorica側を接続する

1. 別ターミナルで同じディレクトリから `npm run dev`。
2. GarageBandでソフトウェア音源トラックを選択する。
3. Tetoricaの **MIDI settings → Refresh**。
4. **Clock input — optional** を開き、**Tetorica Test Clock** を選んで **Connect input**。
5. **Note output** はGarageBandの仮想入力を選ぶ（選択時に自動接続）。

`Tetorica Test Clock`が出るのは入力側。GarageBandが出る出力側とは別の欄なので注意。表示されない場合は送信ツールが起動中か確認し、Refreshする。

### 3. Runしてから送信を開始する

Run fileに次のコードを用意する。

```js
liveLoop("clock-test", async ({play, nextBeat}) => {
  await nextBeat();
  log("beat");
  await play("C4", {duration: 0.1});
});
```

1. **Beat clock → External MIDI (trial)** を選択。
2. **Run** を押す。
3. 画面下部に `Waiting for external MIDI Start / Continue.` が表示される。この時点で音が出ないのは正常。
4. **送信ツールのターミナル**に `start` と入力してEnter。
5. ターミナルに `Clock sending`、Tetoricaでは発音とConsoleの `beat` を確認する。

GarageBandの再生ボタンやKeyboard input領域のクリックは、この試験では不要。

### 4. テンポ変更・停止・途絶を確認する

送信ツールへ一行ずつ入力する。

| コマンド | 確認する動作 |
| --- | --- |
| `bpm 60` | 発音・beatログが約1秒間隔になる |
| `bpm 120` | 約0.5秒間隔に戻る |
| `stop` | Runが終了し、発音が止まる |
| `drop` | StopメッセージなしでClockだけ停止。約1秒後にRunが終了する |
| `quit` | Stopを送ってツールを終了する |

停止後は **TetoricaでRun → 送信ツールでstart** の順にやり直す。送信中から試験をやり直す場合は、先に送信ツールで `stop`。実行中に再び `start` を送るとRunは終了する仕様。

音が出ないときは、送信ツールの `Clock sending`、Tetorica画面下部の状態、Consoleのエラー、GarageBand側の音源選択を確認する。

更新後は **playの音長も外部Clockに追従**します（1/24拍単位、端数切り上げ）。durationを4などにして発音中にbpmを変え、残り音長とStop時の解放を確認してください。

確認状況: 今回はポート表示と基本動作についてユーザーから「大丈夫そう」と報告あり。テンポ変更・Stop・dropの各項目の確認結果とタイミング実測は、別途記録する。

詳しい仕様・自動テストは [Clock送信ツールの手順](docs/issues/clock_sender.md) を参照。

## 手動操作を減らす回帰テスト

基本の確認はリポジトリ直下で `npm test` を実行する。Clock送信コマンドを手で入力したり、Applyを押したりしなくても、次を自動確認する。

- 発音中に120→60 BPMへ変化：4拍のノートが合計3秒相当・96パルスでNote Off（仮想時刻なので実時間待機なし）。
- Clock途絶：999msでは保持、1000msで解放。古いRunの発音要求を拒否。
- 同じ音の再発音：古い所有者の解放で新しい音を消さない。
- Apply：同名ループを置換し、旧コールバックがawait後に発音しない。他ループは同じ所有者・cycle順序で継続。

CoreMIDI自体の送受信は `npm run clock:send -- --self-test` で確認できる。これは専用仮想ポート内で完結する。

これらは実際のTauri画面クリック→IPC→GarageBand発音までを丸ごと自動化したテストではない。手動はリリース時の接続・画面操作・実音の短い確認に絞り、タイミングや状態遷移の細かな組み合わせは自動テストに任せる。

## コードなしの試奏

GarageBandの音源を選び、TetoricaのMIDI outputを接続 → Keyboardタブ。画面のキーを押す、または表示されたPCキーを押すと発音、離すと停止。Run不要です。和音・チャンネル・velocityを試し、止めるときはRelease notesまたはStop。CodeタブのKeyboard inputとは別です。
