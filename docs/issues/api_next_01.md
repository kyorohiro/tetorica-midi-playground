> 2026-09-24更新：公開APIのchannelは0〜15（CH1〜CH16）へ移行済み。以下の旧1〜16表記は当時の要件。現行仕様と移行は [channel_index_01.md](channel_index_01.md) を参照。SysExのwire形式は変更なし。

Tetorica MIDI Playground の MIDI API を拡張してください。

現在は play() を中心とした高レベルAPIしかなく、MIDIを直接操作するには不足しています。

既存の play(), beat(), nextBeat(), liveLoop() などのAPIと挙動は壊さず、MIDIの低レベル操作APIを追加してください。

追加するAPI

最低限、以下を追加してください。

noteOn(note, { channel, velocity });
noteOff(note, { channel, velocity });
cc(controller, value, { channel });
programChange(program, { channel });
pitchBend(value, { channel });
channelPressure(value, { channel });
polyPressure(note, value, { channel });
send(bytes);

noteOn / noteOff

noteOn("C4", { channel: 1, velocity: 100 });
noteOff("C4", { channel: 1 });

* note は既存 play() と同じnote name / MIDI note numberの扱いにしてください。
* channel は既存APIと同様にユーザー向けには 1–16 としてください。
* velocity は 1–127。
* noteOff() のvelocityについてはMIDIとして適切なデフォルト値を設定してください。
* 既存のnote tracking / Stop時のall notes off処理と矛盾しないようにしてください。

cc

cc(1, 64, { channel: 1 });
cc(7, 100, { channel: 1 });
cc(10, 64, { channel: 1 });
cc(64, 127, { channel: 1 });

controller/value は 0–127。

programChange

programChange(30, { channel: 1 });

program はraw MIDI値として 0–127 を基本としてください。

pitchBend

pitchBend(0, { channel: 1 });
pitchBend(0.5, { channel: 1 });
pitchBend(-1, { channel: 1 });

JavaScript側では扱いやすいように、

* -1 = minimum
* 0 = center
* 1 = maximum

として、内部で14-bit MIDI Pitch Bendへ変換してください。

既存コードに別のpitch bend表現がある場合は、既存設計との整合性を優先し、READMEに仕様を明記してください。

channelPressure / polyPressure

channelPressure(80, { channel: 1 });
polyPressure("C4", 80, { channel: 1 });

値は0–127。

send

raw MIDI messageを送信できるescape hatchを用意してください。

send([0x90, 60, 100]);
send(new Uint8Array([0xB0, 1, 64]));

通常のchannel messageだけに限定せず、現在のMIDI backendで安全に送信可能なraw messageを送れる設計にしてください。

ただし、SysExがOS/backend側のpermissionや初期化変更を必要とする場合は、今回無理にSysEx対応を追加しないでください。

APIのレイヤー

概念的には以下の3層にしてください。

raw
  send()
MIDI primitives
  noteOn()
  noteOff()
  cc()
  programChange()
  pitchBend()
  channelPressure()
  polyPressure()
convenience / live coding
  play()
  chord()
  beat()
  nextBeat()
  liveLoop()

既存の play() は削除・置換せず、そのまま便利APIとして維持してください。

可能であれば play() の内部実装から新しい noteOn() / noteOff() の共通処理を利用してください。ただし、そのために既存挙動を大きく変更する必要があるなら、無理なリファクタリングはしないでください。

liveLoopとの統合

現在のloop-local cancellationとnote cleanupを維持してください。

特に、

liveLoop("bend", async ({ play, beat }) => {
  // ...
});

の既存コードを壊さないこと。

noteOn() をliveLoop内で使用した場合についても、Stop / Run restart時にstuck noteが発生しない設計が可能なら対応してください。

ただしraw send() については、送信内容を完全には追跡できないため、自動cleanup対象外でも構いません。その場合はREADMEに明記してください。

Validation

不正な値を黙って壊れたMIDI messageに変換しないでください。

少なくとも、

* channel: 1–16
* velocity: 0–127 または既存仕様
* controller: 0–127
* CC value: 0–127
* program: 0–127
* pressure: 0–127
* pitchBend: -1～1

について既存APIの方針に合わせてvalidationしてください。

Documentation

README / Quick start のAPI一覧を更新してください。

簡単なexampleも追加してください。

setBpm(120);
programChange(30, { channel: 1 });
noteOn("C4", { channel: 1, velocity: 100 });
for (let i = 0; i <= 20; i++) {
  pitchBend(i / 20, { channel: 1 });
  await beat(0.025);
}
noteOff("C4", { channel: 1 });
pitchBend(0, { channel: 1 });

CC exampleも1つ追加してください。

Scope

今回はMIDIの基本的なlow-level APIを提供することが目的です。

以下について専用high-level APIを大量に追加する必要はありません。

* SysEx
* MIDI Clock
* Start / Stop / Continue
* MTC
* RPN
* NRPN
* Bank Select helper

raw send() で実現可能なものは、まずraw APIをescape hatchとして利用できれば十分です。

既存機能との互換性を最優先し、必要以上にUIやアーキテクチャを変更しないでください。

実装前に既存のMIDI送信経路、Workerとのmessage passing、note cleanup、play() の実装を確認し、既存設計に沿った最小限の変更で実装してください。

実装後は既存テストを実行し、追加したMIDI messageについて可能な範囲でunit testも追加してください。

## 実装メモ（2026-09-22）

- グローバル／pg／loop callbackに8つのAPIを追加。送信先は既存のグローバルplayと同じ、UIで選択した出力。midi.outputハンドルの拡張は今回の範囲外。
- MIDIのエンコードはui/midi-primitives.js、環境依存の呼び出しはapp.jsのWorker→Tauri接続に分離。
- noteOnは期限なしのノートとして既存ネイティブ追跡に統合。playの期限付き発音・待機方式は維持。
- noteOn velocityは1–127、noteOffは0–127（既定0）。Pitch Bendは-1→0、0→8192、1→16383。
- Stop／Run再開始／所有ループの解放でノートを消音。cc経由のサステイン・ソステヌートも解除。他のコントローラーは自動復元しない。
- raw sendは1つの完全なメッセージ（最大65536バイト）。System Common・Realtime・フレーム済みSysExを既存バックエンドへ送信可能。rawは自動cleanup対象外。
- 内蔵でテストするという追加要望に合わせ、YM2612／PSGに±2半音ベンド、CC1/7/10/11/64/66/120/121/123、channel/poly pressureを追加。pressureとCC1は5 Hzビブラートに割当。FMパンはハードウェア3段階、PSGはソフトウェアパン。音色番号のProgram Change割当は未決定のため保留。内蔵Stop/Panicはコントローラーをリセットして音色編集は保持。
- README、Quick start、型定義・補完とサンプル11/12を追加。実機での音源ごとの対応確認は別途必要。
