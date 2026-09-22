# YM2612 voice transfer via MIDI SysEx

この文書は実装予定の仕様です。以下のAPI・動作は、実装済みであることを示すものではありません。

Tetorica MIDI Playground に、コードから内蔵 YM2612 の音色を指定できるAPIを追加してください。

目的は、ユーザー側では以下の3種類の入力を使えるようにすることです。

1. Tetorica FM2612 Playground の既存 Preset Object
2. TFI
3. VGI

ただし、MIDI / SysEx transport上ではJSONをそのまま送信しないでください。

Preset Objectを受け取った場合も、内部でTFI/VGI相当のcompactなYM2612 voice binary representationへ変換してからSysExとして送信してください。

Desired API

現在のコード:

await enableSoundChip("ym2612");
const lead = midi.output("tetorica-ym2612", { channel: 1 });
const bass = midi.output("tetorica-ym2612", { channel: 2 });

に対して、以下のように音色を指定できるようにしてください。

Preset Object

FM2612 Playgroundで現在使用しているPreset Objectを、そのまま渡せるようにしてください。

概念例:

const lead = midi.output("tetorica-ym2612", { channel: 1 });
await lead.setVoice({
  algorithm: 4,
  feedback: 3,
  operators: [
    // existing FM2612 Playground preset format
  ],
});

ここで新しいPreset schemaを作らないでください。

既存のFM2612 Playgroundで使用しているPreset Objectのschemaとconverter/parserを調査し、可能な限りそのまま再利用してください。

TFI

TFIファイルまたはTFI binary dataも直接指定できるようにしてください。

例えば既存FILES APIとの整合性を考慮して、

await lead.loadVoice("./lead.tfi");

または、

await lead.setVoice(tfiData, { format: "tfi" });

のようなAPIを提供してください。

VGI

既存コードでVGIを安全にparse/convertできる場合は、同様にVGIも受け付けてください。

await lead.loadVoice("./lead.vgi");

または、

await lead.setVoice(vgiData, { format: "vgi" });

APIの細部は既存設計に合わせて構いません。

### バイナリファイルの取り扱い

現在のプロジェクトファイル管理はテキスト前提です。`loadVoice()`には、音色変換だけでなくバイナリアセットの対応も必要です。

* TFI/VGIをプロジェクトに取り込み、文字列へ誤変換せず元のバイト列を保持してください。
* `loadVoice()`のパスはプロジェクト内のファイルを参照し、相対パスの解決規則は既存のモジュール・FILES設計と整合させて明記してください。
* プロジェクトの保存・再読み込み、およびカセットのExport / Importで、音色ファイルも欠落・変質なく復元してください。
* 既存のテキストファイルとカセットの読み込み互換性を維持してください。

バイナリアセット対応は独立した実装段階として扱って構いません。ただし、`setVoice(binary)`のみの対応でファイル対応まで完了したと扱わないでください。

重要なのは、

Preset Object
TFI
VGI
    ↓
YM2612 Voice
    ↓
compact binary representation
    ↓
MIDI SysEx
    ↓
CoreMIDI
    ↓
Native YM2612 Audio Engine

という経路にすることです。

Internal representation

JSONをSysEx payloadとして直接送信しないでください。

Preset Objectはまず既存のconverterを使って、TFI/VGIまたはそれに相当するcompactなYM2612 voice representationへ変換してください。

概念的には、

FM2612 Preset Object
       ↓
presetToVoice()
       ↓
TFI/VGI-compatible voice data
       ↓
SysEx

です。

TFI/VGIを入力した場合も、可能であれば同じcanonical YM2612 Voice representationを経由してください。

同じ音色変換ロジックを複数箇所にコピーしないでください。

SysEx

YM2612 voice dataはCoreMIDI経由のSysExとして送信してください。

現時点ではexperimental protocolで構いません。

Manufacturer IDについては正式取得を今回のscopeにしません。必要であればdevelopment用途として 0x7D を使用してください。

protocolには最低限、

* protocol/version
* command
* target MIDI channel（単一channelと全channel指定を区別できること）
* voice format/version
* voice payload

を含めてください。

TFI/VGI binaryに8-bit dataが含まれる場合は、MIDI 1.0 SysExとして安全な7-bit encodingを行ってください。

Native側で完全に元データへ復元してください。

Native YM2612 Audio Engine

Native側ではSysExを受信したら、指定されたMIDI channelに対応するYM2612 voiceへ音色を適用してください。

その後、

await lead.setVoice(leadPreset);
await context.playOutput(lead, "C4", { duration: 1 });

とした場合に、指定した音色で発音されることを期待します。

音色変更は演奏開始前だけでなく、演奏中にも送信可能にしてください。

await lead.setVoice(voiceA);
await context.playOutput(lead, "C4", { duration: 1 });
await lead.setVoice(voiceB);
await context.playOutput(lead, "E4", { duration: 1 });

発音中のYM2612 register変更については、実チップ相当の挙動を無理に抽象化する必要はありません。

### 適用単位と発音中の動作

音色はoutput handle固有ではなく、出力先＋MIDI channel単位で共有してください。同じ出力先・channelを参照する別handleにも変更が反映されます。単一channel指定時は別channelに影響せず、全channel指定時も別出力先には影響しないことを保証してください。

音色変更は次のNote Onから適用し、すでに発音中のvoiceは発音開始時の音色を維持してください。

`lead.setVoice()`は、そのhandleが参照する出力先へ送信してください。画面で選択中のデフォルト出力へ誤送信しないでください。

### channel省略時の全体利用

内蔵YM2612では、`channel`を指定したhandleはそのMIDI channelを使い、省略したhandleは音源全体を使う方針とします。

```js
// channel省略：音源全体を使い、音色を全MIDI channelへ適用する
const lead = midi.output("tetorica-ym2612", {});
await lead.setVoice(leadPreset);

// channel指定：指定したMIDI channelだけに音色を適用する
const bass = midi.output("tetorica-ym2612", { channel: 2 });
await bass.setVoice(bassPreset);
```

省略時の`setVoice()`／`loadVoice()`は、同じ出力先の全16 MIDI channelへ音色を設定してください。これはhandle専用の音色領域を作る機能ではありません。上の例で再び`lead.setVoice()`を呼ぶと、channel 2のbassの音色も上書きされます。最後に適用された音色を次のNote Onで使用し、発音中のvoiceは維持してください。

全channelへの設定でも、`await setVoice()`後のNote Onより先に対象全channelへの適用が行われるようにしてください。SysExの全channel指定の表現は、通常のchannel番号や不正な値と区別して定義してください。

### ラウンドロビンと物理voice割り当て

MIDIの16 channelは音色やCC等を共有する単位であり、YM2612の物理的な6発音channelとは別です。全16 MIDI channelへ音色を設定しても、同時発音数が16声になるわけではありません。

channel省略時にラウンドロビンで発音先を割り当てる案を検討します。ただし、ユーザー向けの「音源全体を使う／音色を一括適用する」方針と、割り当てをどの層で行うかは分けてください。MIDI channelを回す方式にするか、単一MIDI channelからNative音源側で6声を割り当てる方式にするかは実装前に決定し、ここに記録してください。和音のためだけにMIDI channelのラウンドロビンを必須とはしません。

MIDI channelをラウンドロビンする場合は、次の事項も定義・検証してください。

* 対象channelと巡回順、handle間で割り当て状態を共有するか、channel固定のhandleとの併用時の動作。
* Note Onに使用したchannelを各発音について記録し、Note Offを同じchannelへ返す。同音の重複発音、停止、キャンセル時も対応関係を保持する。
* handleに対するCCやpitch bend等の制御は対象channel全体へ適用し、次に選ばれるchannelでも制御状態が揃うようにする。
* Native側の空きvoice選択と、6声を超えた場合のvoice stealingをMIDI channelの巡回とは別に扱う。

この省略時の仕様は内蔵YM2612を対象とします。外部MIDI出力やSega PSGの既存の省略時動作を無条件に変更しないでください。

### 音色変更とNote Onの順序保証

`await lead.setVoice(A)`の後に送るNote OnにはAが適用されることを保証してください。Promiseの完了が「送信完了」なのか「音源への適用完了」なのかを明記し、CoreMIDIへの送信完了だけを音声処理への適用完了とみなさないでください。

現在のNative実装では音色変更とMIDIが別キューに入り、音色変更を先にまとめて処理しています。この仕組みをそのままSysExへ流用すると、同じ音声処理周期で受け取った `音色A → Note On → 音色B → Note On` が両方Bで発音する可能性があります。

SysExによる音色変更とNote Onを同じ順序付きイベント列で処理するなど、受信順を音源への適用順まで維持してください。固定時間のsleepによる回避はしないでください。音声コールバック内でのロックや動的メモリ確保も避けてください。

API design

ユーザー向けAPIでは、transportの詳細を意識させないでください。

理想的には、

await lead.setVoice(presetObject);

だけで、

Preset Object
↓
voice conversion
↓
binary
↓
7-bit encode
↓
SysEx
↓
CoreMIDI
↓
Native YM2612

まで行われるようにしてください。

ただし、advanced useのためにraw SysEx送信APIを提供することは問題ありません。

Existing FM2612 Playground compatibility

重要です。

FM2612 Playgroundの既存Preset Objectを、そのままMIDI Playgroundへコピーして利用できることを目標にしてください。

例えば、

const myVoice = {
  // copied from FM2612 Playground
};
await lead.setVoice(myVoice);

が成立するようにしてください。

FM2612 Playground側のPreset schemaを変更しないでください。

必要ならMIDI Playground側にadapter/converterを追加してください。

### 互換性の確認範囲

既存parserが存在するだけで対応完了とせず、入力・変換・転送・Native音源への適用まで各フィールドが保持されることを確認してください。

* 既存の`web/tfi.js`、`web/vgi.js`とFM2612 PlaygroundのPreset利用箇所を調査してください。operator配列の0始まり／1始まり、およびファイル内のoperator順序を混同しないでください。既存converter同士にも扱いの差があるため、実際のPresetとAnalyzer出力を使って検証してください。
* `dt`の符号表現、`sr`／`d2r`の別名と、省略フィールドの既定値を確認してください。
* 現在のNative音色定義にはTFIの`ssg`やVGIの`ams`／`pms`がありません。対応に必要な音源側の拡張も作業範囲に含めてください。VGIのpanとMIDIのpan制御の関係も明記してください。
* TFIだけでは表現できないフィールドを含むPresetを、無条件にTFIへ変換して情報を落とさないでください。対応可能な既存表現を選び、表現・再生できない音色設定は明示的にエラーにしてください。未対応フィールドを黙って捨てて「互換」と扱わないでください。

VGIは既存parserとNative側の対応範囲を確認したうえで採否を決めてください。部分対応とする場合は制限を利用者に示し、完全互換と区別してください。

Analyzer interoperability

VGM AnalyzerからexportしたTFI/VGIも、そのままMIDI Playgroundで利用できる設計にしてください。

最終的に、

VGM
 ↓
Tetorica VGM Analyzer
 ↓
TFI / VGI export
 ↓
MIDI Playground
 ↓
SysEx
 ↓
Native YM2612

が成立することを期待します。

Scope

今回はYM2612 voice transferに集中してください。

以下はscope外です。

* Sega PSG voice protocol
* VGM register streaming
* DAC/PCM streaming
* General MIDI preset mapping
* MIDI 2.0
* 外部hardware固有対応
* 新しいFM音色ファイルフォーマットの設計

新しい独自フォーマットを増やすより、既存のFM2612 Preset Object / TFI / VGIを再利用してください。

Tests

最低限、以下をテストしてください。

* FM2612 Preset Object → canonical voice conversion
* TFI → canonical voice conversion
* VGI → canonical voice conversion（対応する場合）
* binary → 7-bit SysEx encode → decode のround trip
* channel情報が保持される
* malformed SysExを安全にrejectする
* unknown protocol/version/commandを安全に処理する
* voice送信後のNote Onで新しいvoiceが使われる
* 同一音声処理周期に `音色A → Note On → 音色B → Note On` が届いても、それぞれA・Bで発音する
* 同じ出力先・channelの別handleで音色を共有し、単一channel指定では別channelへ、全channel指定でも別出力先へ影響しない
* channel省略時の音色設定が全16 MIDI channelへ適用され、固定channelのhandleにも反映される
* 全channelへの音色設定後、固定channelだけの上書きと、全channelへの再設定が適用順どおりに反映される
* 全channelへの音色設定でも、後続Note Onとの順序保証と発音中voiceの音色維持が成立する
* ラウンドロビンを採用する場合、上記で定義した巡回・Note Offの対応・制御状態・停止時の動作を検証する
* デフォルト出力とhandleの出力先が異なっても、handleの出力先に音色が届く
* 音色変更時に発音中のvoiceの音色が変わらない
* 実際のFM2612 PresetとAnalyzer出力を使い、operator順序・dt・ssg等の対応フィールドが正しく反映される
* 未対応の音色設定を黙って捨てず、明示的なエラーにする
* 音色ファイルの取り込み・保存・再読み込み・カセットExport / Importでバイト列が一致する
* 既存のテキストのみのカセットも読み込める
* 既存のNote On/Off、playOutput()、liveLoop()を壊していない

## 実装順序

1. Preset Objectの互換性とNative側の対応フィールドを確認し、Preset Object → compact binary → SysEx → 内蔵YM2612での発音を通す。出力先・channelの適用単位とNote Onとの順序保証をこの段階で実装する。
2. TFI binaryを同じ変換・転送経路へ接続し、VGIは対応範囲の確認後に追加する。
3. バイナリアセットの取り込み・保存・カセットExport / Importを整備し、`loadVoice()`を接続する。

各段階の完了と仕様全体の完了を区別してください。共通の変換・SysEx生成処理にTauri固有処理を混在させず、CoreMIDIとNative音声処理は環境固有の接続層に置いてください。今回の作業でブラウザー版を実装する必要はありません。

実装前に、既存のFM2612 Playground Preset Object、TFI/VGI parser/exporter、MIDI output、CoreMIDI virtual destination、Native YM2612 Audio Engineの実装を確認してください。

既存コードを最大限再利用し、必要以上のリファクタリングは避けてください。
