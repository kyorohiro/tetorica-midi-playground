# MIDI Playground TODO

FM2612 Playgroundとの機能差を整理する。MIDI版は基本的な演奏機能を移した段階であり、同名APIも完全互換ではない。

## 現在の対応範囲

- `play` / `beat` / `nextBeat` / `setBpm`、MIDIチャンネル・velocity指定。
- `choose` / `scale` / `cycle` / `chord` / `rand` / `rrange` / `randInt` / `lerp`。
- `liveLoop`、画面のRun / Stop。Runごとに全ループを再起動する。
- Run file選択（既定 `/index.js`）、ファイル保存・import/export。
- MIDI出力選択時の自動接続、接続先・状態の表示。
- 外部MIDI Clockの監視とC4テスト。既定は内部BPM、外部拍待機は試験対応（play音長は内部BPM）。

## 優先1: 拍・ループの互換性

- [x] `nextBeat()`：Run開始基準の内部拍境界まで待機。BPM変更で拍位相を保ち、待機中にも反映。境界上では次の拍へ進む。仮想時計によるテストを追加。Workerタイマーによる遅延はあり、サンプル精度ではない。FM版のループcursorBeatとの完全互換は後続工程。
- [x] `stopLoop(name)` / `stopAllLoops()`を公開。専用ヘルパーはawait後の停止を確認し、後続ノートを送信しない。
- [x] `liveLoop(name, async ({play, beat, nextBeat, cycle}) => ...)` のループ専用ヘルパー。
- [x] 専用`cycle`をループ単位・反復内の呼び出し順単位で分離。名前付きキーもループ内で独立。
- [x] 同じRun内の同名ループ置換。旧専用ヘルパーを停止し、新しいカウンターで開始。
- [x] Workerテストで並行ループ、await、同名置換、個別/全停止を検証。
- [ ] グローバルヘルパーを使う従来記法の暗黙コンテキスト互換。現状は反復境界で停止し、cycleのカウンターはRun内で共有。
- [x] 専用ヘルパーで送信したノートを個別停止時に即時Note Off。ループ世代IDで所有権を管理し、同一チャンネル・同一音は最後に発音した所有者を優先。旧ループ停止は新しい所有者の音を消さない。送信と解放はUI側で順序化。グローバルplayは個別所有権の対象外、画面Stopは全ノート解放。
- [ ] Runをまたぐホット差し替え。継続・リセットする状態を定義する。現状はRunで全停止・再起動。
- [x] 専用beat/nextBeatにループ別cursorBeatを導入。現在拍とのmaxを基準に進み、待機中のBPM変更も反映。過ぎた拍のまとめ再生はしない。
- [ ] FM版スケジューラーとの完全互換・実測タイミング確認。Workerタイマーの遅延は残る。
- [ ] GarageBand実機で並行ループ・停止・再実行の確認。タイミングの実測・許容誤差の整理。

## 優先2: 音楽用ヘルパー

- [x] `chord()`。FM版と同じ5種類の音名配列。MIDI音域外はエラー。
- [x] `rand` / `rrange` / `randInt` / `lerp`。数値文字列にも対応。不正値・空の整数範囲はエラー。
- [x] `noteLerp(from, to, t)`：MIDI版は音名/番号を補間し、最寄りの整数MIDIノートを返す。中間値は上へ丸める。tはクランプせず、音域外は丸め前にエラー。FM版のピッチオブジェクトとは非互換、Pitch Bendは送らない。
- [x] 今回追加したchord・乱数・補間の引数と戻り値をFM版と照合。MIDI音域・不正値の検証差分をガイドに記載。
- [x] `play`の単位差を確認・記載。FM版はdurationが秒・チャンネル0始まり、MIDI版は拍・1〜16。
- [x] `play` / `beat` / `scale`の主要な引数・境界条件・待機動作を比較しテスト。beatのBPM固定、playの1〜10000ms制限・送信失敗、scale全4種類・octave制限をガイドに明記。
- [x] 比較テストで判明した`scale(root, "minor")`の実装漏れを修正。
- [x] 専用beatを拍位置ベースへ変更（優先1）。グローバルbeatは従来の相対待機を維持。累積遅延の完全解消は保証しない。
- [x] 追加したchord・乱数・補間の境界値、Worker内の通常スクリプトとループ専用APIからMIDI送信までのテスト。
- [x] `noteLerp`の端点・下降・中間値・外挿・音域外・不正値・play連携とWorker専用APIのテスト。

## 優先3: 編集・実行環境

- [x] onKeyboardPressKey / onKeyboardReleaseKey。専用Keyboard input領域のフォーカス中のみ送信。編集入力・ショートカット・リピートを除外。同名置換、非同期処理中のイベントスキップ、最大32登録、Run / Stop時にWorkerごと破棄。フォーカス離脱で保持キーのrelease送信。
- [ ] キーボード領域のフォーカス・ウィンドウ離脱をTauri実機で確認（Workerと登録管理は自動テスト済み）。
- [x] FILES間の相対module import。Run fileはawait import、読み込んだJS/MJSはstatic import・再exportにも対応。Runごとにスナップショットとキャッシュを作成。循環・動的パス・外部URL等は明確なエラー。ヘルパーは関数引数で渡す。
- [ ] Tauri実機でblob module読み込みとGarageBand発音を確認（CSP変更のため再ビルドが必要）。
- [x] Monacoをローカル同梱。JavaScript色分け・検索・補完（MIDIヘルパー）、ファイル別Undo履歴・カーソル位置保持、ガイドはread-only。読み込み失敗時はtextareaへフォールバック。
- [x] Monacoの標準ライブラリーをECMAScriptへ限定。screenLeftなどWindow/DOM候補を除外し、標準JS・ローカル変数の補完は維持。設定の回帰テストを追加。
- [ ] Tauri実機でMonacoの表示・補完・Runショートカットを確認。JSの型診断・module間の型解決は今回対象外。
- [x] 追加した拍同期・ループ専用ヘルパー・音楽ヘルパーをHelper画面と英語/日本語READMEに記載。
- [x] 英日FILESガイドとルートREADMEの接続手順を更新。GarageBand仮想入力→自動接続を先に案内、IACとClock設定は任意へ。
- [ ] 全サンプルの実機通し確認。

## 別工程: 外部MIDI Clockとの同期

- [ ] Clock監視・テストから、スクリプト演奏の同期へ拡張する。
- [x] Start / Continue / Stop・Clock途絶・切断の拍位置管理を定義し、環境非依存の状態管理とテストを追加。詳細は[external_clock.md](external_clock.md)。
- [x] native受信からTauri ChannelでWorkerへ直接Clockを転送。Run ID・入力接続世代・連番で古い/重複イベントを除外。画面snapshotポーリングとは分離。
- [x] 外部拍Clock試験モード。Start/Continueまで待機、beat/nextBeatをパルス駆動。Stop・再Start・途絶でRun終了、nativeでNote Offと古い要求の拒否。再開にはRunが必要。
- [ ] play音長を外部拍へ追従させる。現時点はBPM欄による固定ミリ秒のまま。実機の切断・再接続・IPC遅延を含む統合検証は未完了。
- [ ] 実機のClock入力からChannel経由の連続イベント配信を確認する。
- [ ] `nextBeat()`による内部拍同期と、外部Clock同期を区別して説明・検証する。

## MIDI版への導入方針を別途検討するもの

FM音色、PSG、DAC、サンプル、エフェクトは現在未搭載。
これらはFM版の内蔵音源に関わるため、そのまま全移植するTODOにはしない。
必要に応じて、外部音源へのMIDI制御として実現する機能と、内蔵音声処理を必要とする機能を分けて検討する。

## 完了の目安

- 対応APIと互換性の差がドキュメントから分かる。
- 複数ループでも状態が混ざらず、Stop後に不要なノートが送信されない。
- 自動テストに加え、GarageBandでRun / Stop・再実行を確認する。

## 検証記録

- 直近のJSテスト: 41件成功（外部Clockの受信世代・順序・24pulse転送を追加）。
- 英日ガイド更新後の生成内容一致テスト: 成功。
- 今回のループ・音楽ヘルパー追加後のGarageBand実機確認: 未実施。
- `chord`は音名配列を生成するだけで、自動で同時発音はしない。

- Rust: ノート所有権、別チャンネル保護、旧Runの解放無視、再発音・期限切れの所有権消去を追加検証。
