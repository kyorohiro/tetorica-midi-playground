/** MIDI note number 0–127 or a note name, for example C4. */
type MidiNote = number | string;
/** Durations are in beats. */
interface MidiPlayOptions { duration?: number; velocity?: number; }
interface MidiNoteOptions extends MidiPlayOptions { /** MIDI channel 1–16. */ channel?: number; }
interface MidiOutput {
  /** Play on this handle's channel. Resolves after the duration; await is optional. */
  play(note: MidiNote, options?: MidiPlayOptions): Promise<void>;
}
/** Opaque identifier assigned in MIDI connections. */
interface MidiOutputSlot { readonly __midiOutputSlot: unique symbol; }
type MidiDestination = 'tetorica-ym2612' | 'tetorica-sega-psg' | (string & {}) | MidiOutputSlot;
declare const MIDI_OUTPUT_01: MidiOutputSlot;
declare const MIDI_OUTPUT_02: MidiOutputSlot;
declare const MIDI_OUTPUT_03: MidiOutputSlot;
declare const MIDI_OUTPUT_04: MidiOutputSlot;
declare const midi: {
  /** Create an output handle; the connection opens on first play. Default channel: 1. */
  output(destination: MidiDestination, options?: {channel?: number}): MidiOutput;
};
/** Enable the shared native sound rack; repeated calls preserve settings. */
declare function enableSoundChip(chip: 'ym2612' | 'sega-psg'): Promise<void>;
/** Play using the MIDI output selected in the UI. */
declare function play(note: MidiNote, options?: MidiNoteOptions): Promise<void>;
/** Use context.playOutput for loop ownership in imported or explicit callbacks. */
declare function playOutput(output: MidiOutput, note: MidiNote, options?: MidiPlayOptions): Promise<void>;
/** MIDI channels are 1–16; default is 1. */
interface MidiChannelOptions { channel?: number; }
interface MidiOnOptions extends MidiChannelOptions { /** Integer 1–127; default 90. */ velocity?: number; }
interface MidiOffOptions extends MidiChannelOptions { /** Release velocity 0–127; default 0. */ velocity?: number; }
/** Selected MIDI output. Held until noteOff, loop release or Stop; resolves when sent. */
declare function noteOn(note: MidiNote, options?: MidiOnOptions): Promise<void>;
/** Release a tracked note on the selected MIDI output. */
declare function noteOff(note: MidiNote, options?: MidiOffOptions): Promise<void>;
/** Send a control change; controller and value are integers 0–127. */
declare function cc(controller: number, value: number, options?: MidiChannelOptions): Promise<void>;
/** Raw program number 0–127 (not 1–128). */
declare function programChange(program: number, options?: MidiChannelOptions): Promise<void>;
/** -1 = 0, 0 = 8192, +1 = 16383. Range in semitones depends on the receiver. */
declare function pitchBend(value: number, options?: MidiChannelOptions): Promise<void>;
/** Channel aftertouch, integer 0–127. */
declare function channelPressure(value: number, options?: MidiChannelOptions): Promise<void>;
/** Per-note aftertouch, integer 0–127. */
declare function polyPressure(note: MidiNote, value: number, options?: MidiChannelOptions): Promise<void>;
/** One complete MIDI message, including system messages/SysEx; no automatic note cleanup. */
declare function send(bytes: number[] | Uint8Array): Promise<void>;
/** Wait in beats. */
declare function beat(count?: number): Promise<void>;
/** Wait for the next beat. */
declare function nextBeat(): Promise<void>;
declare function setBpm(bpm: number): void;
declare function choose<T>(values: T[]): T;
declare function cycle<T>(values: T[]): T;
declare function cycle<T>(key: string, values: T[]): T;
declare function scale(root: MidiNote, name: 'majorPentatonic' | 'minorPentatonic' | 'major' | 'minor', octaves?: number): string[];
declare function chord(root: MidiNote, name: 'major' | 'minor' | 'major7' | 'minor7' | 'dominant7'): string[];
declare function rand(): number;
declare function rrange(min: number, max: number): number;
declare function randInt(min: number, max: number): number;
declare function lerp(a: number, b: number, t: number): number;
declare function noteLerp(from: MidiNote, to: MidiNote, t: number): number;
declare function log(...values: unknown[]): void;
declare function stopLoop(name: string): void;
declare function stopAllLoops(): void;
interface PlaygroundKeyEvent {
  type: 'keydown' | 'keyup'; key: string; code: string; repeat: boolean;
  shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean;
}
declare function onKeyboardPressKey(name: string, callback: (event: PlaygroundKeyEvent) => void | Promise<void>): void;
declare function onKeyboardReleaseKey(name: string, callback: (event: PlaygroundKeyEvent) => void | Promise<void>): void;
/** Helpers passed to liveLoop. The parameter can be named context or destructured. */
interface TetoricaContext {
  /** Shared user state, preserved by Apply and reset by Run. */
  context: PlaygroundContext;
  /** API namespace with this loop's timing and cancellation. */
  pg: PlaygroundAPI;
  noteOn: typeof noteOn; noteOff: typeof noteOff; cc: typeof cc; programChange: typeof programChange;
  pitchBend: typeof pitchBend; channelPressure: typeof channelPressure; polyPressure: typeof polyPressure; send: typeof send;
  play: typeof play; playOutput: typeof playOutput; beat: typeof beat; nextBeat: typeof nextBeat;
  cycle: typeof cycle; setBpm: typeof setBpm; choose: typeof choose; scale: typeof scale; chord: typeof chord;
  rand: typeof rand; rrange: typeof rrange; randInt: typeof randInt; lerp: typeof lerp; noteLerp: typeof noteLerp;
  log: typeof log; stopLoop: typeof stopLoop; stopAllLoops: typeof stopAllLoops;
  midi: typeof midi; enableSoundChip: typeof enableSoundChip;
  MIDI_OUTPUT_01: MidiOutputSlot; MIDI_OUTPUT_02: MidiOutputSlot; MIDI_OUTPUT_03: MidiOutputSlot; MIDI_OUTPUT_04: MidiOutputSlot;
  onKeyboardPressKey: typeof onKeyboardPressKey; onKeyboardReleaseKey: typeof onKeyboardReleaseKey;
}
/** Named repeating callback. Use context helpers to retain cancellation across awaits. */
declare function liveLoop(name: string, callback: (context: TetoricaContext) => void | Promise<void>): void;
declare const console: {log: typeof log; warn: typeof log; error: typeof log};
/** User-defined shared state. Apply preserves this object; Run creates a new one. */
type PlaygroundContext = Record<string, unknown>;
declare const context: PlaygroundContext;
/** Browse the MIDI Playground API through pg. */
interface PlaygroundAPI extends Omit<TetoricaContext, 'pg'> {
  liveLoop: typeof liveLoop;
}
declare const pg: PlaygroundAPI;
