/**
 * Play notes in sequence using the caller's loop timing and cancellation.
 * This module does not open ports or start loops by itself.
 * @param {TetoricaContext} context Helpers received by the liveLoop callback.
 * @param {MidiOutput} output Destination created by midi.output().
 * @param {MidiNote[]} notes MIDI numbers or note names.
 * @param {MidiPlayOptions} [options] Duration in beats and velocity.
 * @returns {Promise<void>}
 */
export async function playPhrase(context, output, notes, options = {}) {
  for (const note of notes) {
    await context.playOutput(output, note, options);
  }
}
