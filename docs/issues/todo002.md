# MIDI Playground TODO 002

リリース後に順番に進める改善。00のNative YM2612 + Sega PSG試作を実装中。01以降は未着手。
既存機能の残課題は [todo.md](todo.md) を参照。

## 進め方

- まず00の確認用MIDI受信音源を用意する。その後01で演奏先とAPIの責務を固め、02の補完、03のexamples、04のライブラリガイドへ進む。
- 各工程で必要な自動テストを追加し、完了した項目と残る制約を更新する。
- タイミング・停止・所有権は仮想時計や模擬MIDI出力で検証し、手動確認を最小限にする。
- 既存のグローバル`play()`、Keyboardタブ、Run / Stop / Apply、外部Clockの動作を維持する。

## 00. 内蔵Native YM2612確認用音源

方針更新: 別アプリ・矩形波音源の案から、同じプロセス内のYM2612 + Sega PSGへ変更。WebViewは設定と表示のみ。PCMはNative内で生成・リサンプル・MIXし、CPAL → macOS Core Audioへ出力する。

- [x] ymfmのOPNソースをライセンスと共に同梱し、C++ → Rustの小さなFFIでネイティブビルドする。親リポジトリやWASMファイルへの実行時依存なし。
- [x] YM2612は固定FM音色6音。Sega PSGは矩形波3音（CH1〜9 / 11〜16）と固定ノイズ1音（CH10）。空きvoice割り当て・同音再発音・最古voiceの置換に対応。既存Sega PSGコアをNativeビルドして再利用。
- [x] macOS仮想MIDI入力`Tetorica YM2612` / `Tetorica Sega PSG`を公開。通常のMIDI outputから選択し、Keyboardや既存playで試せる。
- [x] Helperの横にYM2612 / Sega PSG / Mixerタブを追加。各音源のCH発音表示、音源別音量・パン・ミュート、マスター音量、Panic。
- [x] MIDI connectionsで有効化したときだけ音声とMIDIポートを開始。無効化・アプリ終了で解放。既定音声出力は有効化時に取得する。
- [x] MIDI受信から音声スレッドへ固定容量キュー。PCMはWebViewへ送らない。過負荷時は全音停止とエラー表示。画面更新は200ms間隔。
- [x] Note Off、velocity 0、CC120 / CC123、Stop、Panicに対応。DC除去、簡易線形リサンプル、ゲインの平滑化、最終クリップを実装。
- [x] PCMの発音・A4ピッチ・消音を44.1/48/96kHzで自動テスト。voice置換、CH分離、FM/PSG分離、パン・ミュート、キューあふれ、Stop直後の新規ノートを検証。
- [ ] 実機で仮想ポート受信 → 音声出力とUI操作を通し確認する。CPU負荷・音切れも測定する。
- [ ] CH別の音色設定・音量・ミュートは後続。現在のMixerは音源単位。サステイン、Pitch Bend、Program Change、音色編集は未対応。
- [ ] 切断・デバイス変更時の復旧を実機確認する。現在は無効化→再有効化で再接続。音声デバイス選択UIとメーターは後続。

確認手順: アプリを再起動 → MIDI connectionsでEnable → MIDI設定で`Tetorica YM2612`を選択 → KeyboardまたはRunで発音。Sega PSGも同様（CH10はノイズ）。詳細は[Native synth](native_synth.md)。

### GarageBandへPCMを渡す拡張（後続）

- [ ] BlackHole等の仮想Core Audioデバイスを出力先にし、GarageBandのオーディオトラックで受ける手順を検証する。ドライバーの同梱やインストールは今回行わない。
- [ ] FM/PSGをGarageBand側で別々にMIXする場合は、合成前の音を別の音声チャンネルへ出す。現段階は内蔵Mixerによるステレオ合成のみ。

MIDIポート名とDAWのトラック名は別。examplesの共通接続先は内蔵音源を使う。GarageBandのトラック別MIDI CH振り分けを前提にしない。

## 01. 複数MIDI出力・チャンネル

出力ポートとチャンネルをまとめた演奏先をJavaScriptから作成する。以下は希望するAPIの例であり、まだ実行できない。

```js
await enableSoundChip("ym2612");
await enableSoundChip("sega-psg");

const piano = midi.output("tetorica-ym2612", { channel: 1 });
const bass  = midi.output("tetorica-sega-psg", { channel: 2 });
const synth = midi.output("tetorica-ym2612", { channel: 3 });

liveLoop("piano", async () => {
  piano.play("C4", { duration: 0.8 });
  await beat(1);
});

liveLoop("bass", async () => {
  bass.play("C3", { duration: 0.4 });
  await beat(0.5);
});

liveLoop("fm", async () => {
  synth.play("G4", { duration: 0.2 });
  await beat(0.25);
});
```

### 内蔵音源の準備と固定ID（合意した方針・未実装）

examplesは手動のEnableやDAWの準備を前提にせず、コード内で音源を有効化してから演奏先を作る。

- [ ] `await enableSoundChip("ym2612")` / `await enableSoundChip("sega-psg")`を追加。音源と接続先が利用可能になるまで待機し、初期化失敗は呼び出し元へ理由を返す。未知のIDはエラーにする。
- [ ] 有効化済みの音源への再呼び出しは再初期化しない。並行呼び出しでも二重生成せず、既存の発音や設定をリセットしない。
- [ ] `tetorica-ym2612` / `tetorica-sega-psg`を内蔵音源の固定IDとして解決する。表示名やOSのポート列挙順に依存させず、同名の外部ポートへ誤接続しない。
- [ ] 現在は2音源をまとめて有効化するRackなので、音源単位の有効状態と共有オーディオ出力の寿命を整理する。コードとMIDI connectionsのEnable表示を同期する。
- [ ] Stopは発音と処理中の演奏要求を停止するが、有効化した音源はKeyboard用に残す。初期化待機中のStop・再Runで古い処理が演奏を再開しないようにする。音源の明示的な無効化・アプリ終了時には資源を解放する。
- [ ] 初期化成功・失敗・重複呼び出し・Stopとの競合・固定ID解決を自動テストする。

### 名前指定とMIDIタブの論理出力（未実装）

外部音源向けには名前の直接指定と、MIDIタブで接続先を割り当てる方法も用意する。チャンネルはコード側で指定する。

```js
const external = midi.output("GarageBand", { channel: 1 });
const piano = midi.output(MIDI_OUTPUT_01, { channel: 1 });
const bass = midi.output(MIDI_OUTPUT_01, { channel: 2 });
const lead = midi.output(MIDI_OUTPUT_02, { channel: 1 });
```

- [ ] MIDIタブに`MIDI_OUTPUT_01`などの接続先割り当てを用意し、設定を保存する。スロット数と未指定時のチャンネル既定値は実装時に定義する。
- [ ] 固定ID・外部ポート名・論理出力を同じ演奏先interfaceへ解決する。論理出力は名前文字列と混同しない識別子にする。
- [ ] 未設定・接続先消失・同名候補の重複を明確なエラーにする。列挙順による別ポートへの自動接続を避ける。
- [ ] Run時に使用する割り当てを検証し、未設定なら「MIDI_OUTPUT_02の接続先を設定してください」のように案内する。演奏中の割り当て変更時の停止・再接続契約を定義する。
- [ ] 保存・復元・未設定・ポート消失と、同じ接続先を複数スロットで使う場合をテストする。

実装順: 出力管理の調査 → 内蔵音源有効化と固定ID → 複数出力のノート所有権 → 論理出力設定 → 補完・examples。

### 共通の出力・ノート管理

- [ ] 現在のWorker / UI / nativeの出力接続・ノート管理を調査し、複数出力への拡張方針を決める。
- [ ] `midi.output(name, { channel })`の契約を定義する。チャンネルは1〜16、出力一覧の取得、名前の不一致・重複、接続タイミング、非同期エラーの伝え方を整理する。
- [ ] 同じポートの接続を共有し、異なるポートへの同時送信に対応する。
- [ ] 演奏先の`play()`の引数・戻り値・待機動作を決める。例のようにawaitせず発音予約でき、送信失敗も報告できるようにする。`duration`と`beat()`は既存MIDI版の拍単位に合わせる。`sleep()`はこの例のためだけに追加しない。
- [ ] 出力・チャンネル・音程・ループ所有者を管理する。ループ外で作った演奏先でも呼び出し元ループの停止・置換に追従させる。現在の暗黙コンテキストの制約を踏まえ、並行async処理で所有者を取り違えない設計にする。
- [ ] 同音の再発音、個別ループ停止、Apply、全停止、切断・再接続、外部Clock停止でNote Offを適切に送る。古い要求で新しい演奏を止めない。
- [ ] 画面で選んだ出力を使う既存`play()`とKeyboardタブとの共存を検証する。
- [ ] 模擬出力とWorker / nativeテストで、同一ポートのCH1・CH2、複数ポート、異常系と解放処理を検証する。

注意: CH1とCH2を送信しても、自動で別の楽器になるとは限らない。受信アプリ側のチャンネル振り分け対応・設定が必要。GarageBandでの接続確認と、複数チャンネルの振り分け確認は区別する。

## 02. context・JSDoc・補完の強化

- [ ] 実際に公開している`context`と関連ヘルパーのAPIを調査し、実装と型定義を一致させる。存在しないメンバーを補完に出さない。
- [ ] `context.`のメンバー、引数、戻り値、説明が補完・ホバーで表示されるようにする。
- [ ] `enableSoundChip()`の音源ID、内蔵出力の固定ID、`MIDI_OUTPUT_01`等の識別子を補完・ホバーに追加する。
- [ ] `midi.output()`の引数と戻り値を型定義し、`const piano = midi.output(...)`から`piano.play()`とオプションの補完をつなげる。
- [ ] ユーザーのJSDoc（`@param`、`@returns`、`@typedef`）による引数・オブジェクトの補完を確認する。公開する演奏先の型名・参照方法も決める。
- [ ] FILES内の相対import先の型・JSDocがどこまで解決されるか確認し、対応範囲と制約を明記する。
- [ ] 通常は型推論で補完でき、推論できない関数引数などをJSDocで補える例を用意する。
- [ ] Monacoの言語サービスを使うテストで、実際の補完候補・説明を検証する。`screenLeft`など不要なDOM候補の除外も維持する。

## 03. FILESから試せるexamples

初心者が開いてRun fileに指定し、そのまま試せるコードを用意する。以下のファイル名は案。

共通の接続先は00の内蔵音源とする。各演奏例は必要な音源を`await enableSoundChip(...)`で準備し、固定IDで`midi.output(...)`を作る。初回からRunだけで発音でき、手動Enableや出力選択を不要にする。外部ポートの名前指定・論理出力の割り当ては別の例として案内し、利用者のDAWトラック名を仮定しない。PSGの低音域制限とCH10のノイズ割り当てを踏まえて音域・CHを選ぶ。

- [ ] `examples/01_first_note.js`: 内蔵YM2612を有効化し、固定IDで1音を鳴らす。
- [ ] `examples/02_live_loop.js`: メロディの繰り返し、拍、音の長さ。
- [ ] `examples/03_multi_channel.js`: 同じ出力のCH1 / CH2へ送る。
- [ ] `examples/04_multi_output.js`: YM2612とSega PSGをコードで有効化し、両方へ同時に送る。
- [ ] `examples/05_context.js`: 実装に即した`context`の使い方。
- [ ] `examples/06_jsdoc.js`: 自作関数や設定のJSDoc補完。
- [ ] 外部ポート名指定と`MIDI_OUTPUT_01`等の割り当てを使う追加例を用意する。内蔵音源のみの例とは準備手順を分ける。
- [ ] 各例の冒頭に準備・期待する動作・変更して遊べる箇所を短く記載する。出力名の変更、受信側設定が必要な例では明記する。
- [ ] FILESへの同梱・更新方法を整える。既存ユーザーの保存済みコードを上書きしない。
- [ ] 英語を基本とし、日本語ガイドにもexamplesの入口と実行手順を記載する。
- [ ] サンプルを模擬出力で実行し、送信先・チャンネル・ノートと終了時の解放を検証する。

## 04. lib/README.mdとライブラリ利用ガイド

- [ ] FM2612 Playgroundの`lib/README.md`とFILES内のライブラリ構成を確認する。
- [ ] MIDI版のFILESにも`lib/README.md`を用意し、ライブラリの役割・相対import・公開関数・利用例を記載する。
- [ ] FM固有機能はそのまま案内せず、MIDI版で使える機能と制約を説明する。
- [ ] examplesからライブラリを使う例と、JSDocで補完を補う例を結びつける。
- [ ] READMEの閲覧、非実行扱い、相対import、保存済みファイルの保護を検証する。必要に応じて日本語版も用意する。

## 最終確認

- [ ] 自動テストが通り、既存の演奏・編集機能に回帰がない。
- [ ] GarageBandなどへの発音とKeyboardタブの共存を実機で確認する。
- [ ] 00の確認用音源で、DAWなしのexamples実行、複数出力・チャンネルの送受信と発音を確認する。受信アプリ側の音色設定と切り分ける。
- [ ] FILES内のガイド・examples・補完の説明が最終APIと一致している。
