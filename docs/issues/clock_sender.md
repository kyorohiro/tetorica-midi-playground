# Clock sender: DAWなしで外部Clockを試す（macOS）

開発用の小さな送信ツールです。仮想MIDI出力 `Tetorica Test Clock` を作成するため、IAC設定やClock送信用DAWは不要です。音源は内蔵していないので、発音確認にはGarageBand等を使います。配布アプリへの同梱機能ではありません。

## 起動・接続

1. このリポジトリ直下で `npm run clock:send` を実行して、ターミナルを開いたままにする。
2. 別ターミナルで `npm run dev`。MIDI settings → Refresh。
3. Clock inputで **Tetorica Test Clock** を選択し、**Connect input**。
4. Note outputをGarageBandの仮想入力などへ接続。GarageBandではソフトウェア音源トラックを選択する。
5. Beat clockを **External MIDI (beat waits only)** にし、下のコードをRunする。

```js
liveLoop("clock-test", async ({play, nextBeat}) => {
  await nextBeat();
  log("beat");
  await play("C4", {duration: 0.1});
});
```

6. 送信ツールのターミナルで `start` と入力しEnter。

## 確認する操作

| 入力するコマンド | 期待する結果 |
| --- | --- |
| `start` | Start + 24 Clock/拍を送信。Runが待機状態から動き、初期120 BPMなら約0.5秒ごとに発音・log |
| `bpm 60` | 拍間隔が約1秒に変化。音長はTetoricaのBPM指定のまま |
| `bpm 180` | 拍間隔が約1/3秒に変化 |
| `stop` | Stop送信。TetoricaのRun終了、ノート解放 |
| `drop` | Stopを送らずClockだけ途絶。約1秒後にTetoricaがRun終了・ノート解放 |
| `continue` | Continue + Clock。終了済みRunは復活しないので、先にTetoricaでRunを押し直す |
| `quit` | Stop送信後にツールを終了し、仮想ポートを閉じる |

再テストでは先に `stop` → TetoricaでRun → `start`。実行中の再Startは、Tetorica側ではRunを終了させる仕様です。

`bpm`は20〜300。送信ツールはOSタイマーを使い、遅延時にClockをまとめて送ることはありません。精密なタイミング基準器ではなく、動作確認用です。Ctrl+Cで強制終了した場合はStop送信を保証しません（Clock途絶の検出対象になります）。

## 自動テスト

```sh
npm run clock:test
npm run clock:send -- --self-test
```

前者はコマンド・テンポの単体テスト。後者は専用の仮想出力と入力を同一プロセスで接続し、Start・24パルス・Stop・Continueの実CoreMIDI送受信を確認します。通常の音源や外部MIDI機器へは接続しません。TetoricaのUI/Worker/発音の通しテストは上記手順で別途確認してください。
