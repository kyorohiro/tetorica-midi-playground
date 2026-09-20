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
