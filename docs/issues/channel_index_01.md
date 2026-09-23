# 公開 API の CH 番号（2026-09-24）

実装済み：数値 channel は0〜15、CH1 = 0〜CH16 = 15。省略時は0。
play、midi.output、Note On/Off、CC、Program Change、Pitch Bend、Pressure、音色指定を同じ番号にする。
定数はグローバル、pg、ループ context に提供する。UI表示はCH1〜CH16。

Nativeのplay_midi_note IPCは既存の1〜16を維持し、ui/midi-channels.jsで一度だけ変換する。
raw MIDIとSysExのtargetは既存の0〜15で、余分な変換をしない。音色一括指定のnullとchannel=0を区別する。

未編集の旧同梱サンプルのみ更新する。保存済みの自作コードは書き換えず、READMEで旧数値から1を引く移行を説明する。
今回は物理FM CHへの固定指定への変更は含めない。内蔵YM2612の自動声割り当ては既存のまま。
