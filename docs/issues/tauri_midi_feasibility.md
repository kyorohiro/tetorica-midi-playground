# Tauri / CoreMIDI feasibility investigation

調査日: 2026-09-20。資料・SDK・既存コードの確認結果。アプリの実装、ビルド、DAWとの実測はまだ行っていない。

## 結論

Tauriで、JavaScriptからMIDI出力を操作し、外部DAWのMIDI Clockへ追従する実験版は構成できる。
TauriはUIとJavaScript/Rust間の橋渡しを担当し、CoreMIDIを使うネイティブ側が入出力と同期状態を担当する。
同期精度は別途実測する必要がある。Tauriを選んだだけでリアルタイム性が保証されるわけではない。

```text
DAW ── MIDI Clock / Start / Continue / Stop ──> CoreMIDI input
                                                   │
                                         native transport / clock
                                                   │ state snapshots
existing Playground UI + JavaScript <── Tauri IPC ───┤
             │                                     │
             └── note / CC / scheduled events ──> native output queue
                                                   │
                                              CoreMIDI output
                                                   │
                                              DAW / instrument
```

## 確認できたこと

- TauriのWebViewはHTML/CSS/JavaScriptを実行し、Rustのcore processがOSアクセスを担当する。
  `invoke`でJavaScriptからRust commandを呼べる。Web MIDI APIのブラウザ対応には依存しない。
  [Process Model](https://v2.tauri.app/concept/process-model/)、[Calling Rust](https://v2.tauri.app/develop/calling-rust/)
- Rustの`midir`はmacOSでCoreMIDI backendを使い、ポート列挙、入力callback、出力、仮想ポートを提供する。
  入力callbackには接続中に共通の基準を持つマイクロ秒timestampが付く。
  [Input API](https://docs.rs/midir/latest/midir/struct.MidiInput.html)、[macOS backend](https://github.com/Boddlnagg/midir/blob/master/src/backend/coremidi/mod.rs)
- `midir::MidiOutputConnection::send(message)`には送出時刻の引数がない。
  調査したbackendの`coremidi_send_timestamped`も現在時刻を付ける機能であり、任意の未来時刻を指定するAPIではない。
  [Output API](https://docs.rs/midir/latest/midir/struct.MidiOutputConnection.html)、上記backend実装。
- AppleのCoreMIDIは未来timestampを持つイベントの予約送出を提供する。
  ローカルXcode SDKの`CoreMIDI.framework/Headers/MIDIServices.h`に、`MIDISendEventList` / `MIDISend`のfuture deliveryと、受信callbackが別の高優先度threadから呼ばれることを確認した。
  [Apple MIDISend](https://developer.apple.com/documentation/coremidi/midisend(_:_:_:))、[Rust PacketBuffer](https://chris-zen.github.io/coremidi/coremidi/struct.PacketBuffer.html)
- MIDI Timing Clockは四分音符あたり24回。Start / Continue / Stopと合わせてテンポ・走行状態を扱う。
  [MIDI Association](https://midi.org/about-midi-part-3midi-messages)
- macOSのIAC Driverでアプリ間のMIDI接続を試せる。
  [Apple IAC手順](https://support.apple.com/guide/audio-midi-setup/transfer-midi-information-between-apps-ams1013/mac)

## 推奨する責務分離（設計判断）

JavaScriptは音楽のロジック、音符生成、UI操作を担当する。MIDI ClockをUIに転送して、
JavaScriptの`setTimeout`だけで拍と送出を駆動する設計は避ける。

ネイティブ側では受信timestampからテンポ・拍位置・transport状態を管理する。
受信callbackでは最小のデータ受け渡しに留め、UI通信や重い計算を直接行わない。
表示用の通知は間引き、Clockの全イベントをUIで消化する必要がない形にする。

音符は少し先の拍までまとめてネイティブのqueueへ渡す方式を検討する。
ただし先読み量とライブ編集への反応はトレードオフになる。テンポ変更、Stop、再実行、
接続解除に対するqueue取消・Note Off処理も一緒に設計する。
CoreMIDIへ渡す未来のtimestampはネイティブのhost clockへ変換する。
JavaScriptの`performance.now()`の値をそのままCoreMIDIへ渡さない。

最初の疎通は`midir`の即時送信で足りる。同期送出の実験では、native workerで送信時機を管理するか、
CoreMIDI wrapper / FFIでtimestamp付き送出を使うかを測定で比較する。
`midir`を採用すれば予約送信も解決する、とは扱わない。依存versionの固定・lockfile作成は実装時に行う。

## Windows移植の見通し（2026-09-20追記）

資料上、WindowsでもMIDI入出力と外部Clockへの追従は実現可能。JS向けinterfaceを維持できる見通しがある。
Windowsでのビルド・DAW接続・同期精度は未検証。対応OSの最低versionは実装時に確定する。

- `midir`はWindowsのWinMMおよび任意選択のWinRT backendを提供する。
  ただしWindowsで仮想ポートを作成するAPIは提供しない。既存の接続先を開くことと、仮想ポートの作成を分ける。
  [midir対応backend](https://docs.rs/crate/midir/latest)
- Windows MIDI Servicesの新SDKにはtimestampによる送出予約とアプリ間接続がある。
  従来のWinMM/WinRT MIDI 1.0 API経由で、新SDKの予約送信機能が自動的に使えるわけではない。
  利用時には対象Windows環境のservice/SDK導入条件を確認する。
  [Microsoft overview](https://microsoft.github.io/MIDI/overview/)
- 互換性を重視する経路は`midir`とアプリ内native scheduler、新APIを使う経路はWindows MIDI Services adapter。
  いずれも候補であり、mac実験段階で両方を実装する必要はない。後者のRust連携と配布条件も未検証。

共通interfaceの最小案（実装済みAPIではない）:

| 責務 | 共通の契約 | OS adapterの責務 |
| --- | --- | --- |
| 接続 | ポート列挙、opaque IDでopen/close | CoreMIDI/Windowsのポートやendpointを解決 |
| 入力 | MIDI 1.0 messageとnative共通単調時刻 | OS timestampを共通単位・基準へ変換 |
| 演奏予約 | run ID・拍位置・MIDI messageのbatchをenqueue | 共通schedulerの期限をOS時刻へ変換して送信 |
| 同期 | BPM、拍位置、走行状態、同期喪失のsnapshot | 入力の受け渡し。24 PPQN/transportの解釈は共通層 |
| 停止 | 未送出queue取消と発音中noteの停止 | OSへ渡した予約の取消可否を処理 |

JSにはOSの生timestampやCoreMIDI型を渡さない。拍から期限への変換はnative共通層に置き、
テンポ変更時に未送出分を再計算する。入力timestampの精度がOS間で同一とは保証しない。
Windows MIDI Services内部のUMPへの変換はadapter内で扱い、初期JS APIはMIDI 1.0の範囲に限定できる。

予約送信の方式（OS予約/native worker）と仮想ポート作成可否はcapabilitiesで返す。
同じJS APIでも同じ遅延・jitterを保証するものではない。特にOSへ既に渡した未来イベントの取消は
backendごとに確認が必要。自前queueで保持する期間とOSへ渡す短い先読み期間を分け、
取消不能なイベントを無制限に先行送信しない。停止直後にNote Onが再発するケースを移植時の必須試験にする。

まずmacで実装し、fake MIDI adapterによるClock/queue/取消テストを共通層に用意する。
Windows移植時は接続、timestamp変換、送出方法を実装し、同じ共通テストと実DAW測定で確認する。
macのIAC固有操作はUIの接続手順に留め、JS実行の必須条件にしない。

## 既存Playgroundとの接点

`hello_ymfm/docs/playground`が既存UI。次のファイルは`docs/js`側への互換entry pointになっている。

- `playground_live.js`
- `playground_music.js`
- `playground_clock.js`
- `playground_execution.js`

共通実装側にも整理が必要:

- `docs/js/playground_clock.js`: 現在はAudioContextまたはperformance clockと`runtime.bpm`で拍を計算する。
  `beat()`が内部clockで待つ構造なので、外部transportへBPM値を代入するだけでは位相同期にならない。
- `docs/js/playground_live.js`: `megaDrive.clearFXChain()`等の音源・effect管理が残る。
- `docs/js/playground_music.js`: `synth`等の注入点はあるが、FM用pitch変換への依存もある。

まず小さなMIDI接続実験を通し、その結果を`ClockSource` / `MidiOutput`の境界へ反映して既存runtimeへつなぐ。
既存エディタ・ライブ実行環境全体のコピーや再実装を初手にしない。
macOS固有のCoreMIDIオブジェクトはユーザースクリプトへ露出させない。

## 最初の実験と判定基準

1. 最小Tauriアプリからポートを列挙し、JavaScript経由でNote On / Offを送る。
2. DAW → TetoricaのClock入力と、Tetorica → DAWのNote出力を別IAC busに分ける。
   DAWのMIDI Thruによるループを作らない設定で試す。
3. DAWをmasterとしてStart / Stop / Continue、Clock受信数、BPM・拍位置を表示する。
   Stop後にClockだけ流れる場合も、演奏位置を進めない。
4. JavaScriptが用意した短いフレーズを外部Clockに同期させてDAWへ録音する。
5. 定常テンポ、テンポ変更、停止・再開、入力消失、再接続、UI負荷時を試す。
   受信timestamp・送信予定・実際の送出/受信時刻とDAW録音位置から遅延・揺れ・長期driftを記録する。
6. Stop / script再実行 / window終了時のNote Offとqueue取消を確認する。

Clockの単体テストは、合成timestamp列による24 PPQN、Start位置reset、Continue、Stop、
テンポ変更、欠落時の扱いで行う。IAC loopbackの成功と実DAW録音での同期精度の確認は分けて記録する。
途中位置からの再生はSong Position Pointer対応とDAW側送出仕様を確認してから対応範囲に入れる。
MIDI Clock単体から拍子・曲の小節構造・任意の再生位置が得られるとはみなさない。

## 「DAWをJavaScriptでcontrol」の範囲

最初に成立させるのは、DAW内の音源へNote/CCを送り、DAWのClockに演奏を追従させること。
JavaScriptからのNote/CCで何が操作できるかは、受信側のMIDI routing / mappingに依存する。

DAWの再生・停止を外から操作できるか、トラック作成やplugin挿入までできるかは、
各DAWの外部同期・remote control・scripting対応を別途確認する必要がある。
「MIDI出力できる」ことと「すべてのDAW機能を操作できる」ことを混同しない。
今回の実験でCoreAudio出力、VST host、Windows backendまで作る必要はない。
