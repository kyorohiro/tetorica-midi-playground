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
* target MIDI channel
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
* 既存のNote On/Off、playOutput()、liveLoop()を壊していない

実装前に、既存のFM2612 Playground Preset Object、TFI/VGI parser/exporter、MIDI output、CoreMIDI virtual destination、Native YM2612 Audio Engineの実装を確認してください。

既存コードを最大限再利用し、必要以上のリファクタリングは避けてください。