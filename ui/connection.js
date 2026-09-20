export function connectionStatus(snapshot) {
  if (!snapshot) return {state:'unknown', text:'MIDI: Status unavailable'};
  if (!snapshot.output_connected) return {state:'disconnected', text:'MIDI: Not connected — click to set up'};
  return {state:'connected', text:`MIDI: Connected — ${snapshot.output_name || 'Output'}`};
}
