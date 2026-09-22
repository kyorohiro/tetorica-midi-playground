export function connectionStatus(snapshot) {
  if (!snapshot) return {state:'unknown', text:'MIDI: Status unavailable'};
  if (!snapshot.output_connected) return {state:'disconnected', text:'MIDI: Not connected — click to set up'};
  return {state:'connected', text:`MIDI: Connected — ${snapshot.output_name || 'Output'}`};
}

// Stable choices exist even before the rack creates its native MIDI ports.
export function midiOutputChoices(ports) {
  const internal=[
    {id:'internal:ym2612',name:'Tetorica YM2612 (internal · auto-enable)'},
    {id:'internal:sega-psg',name:'Tetorica Sega PSG (internal · auto-enable)'},
  ];
  return [...internal,...ports.filter(p=>!['Tetorica YM2612','Tetorica Sega PSG'].includes(p.name))];
}
