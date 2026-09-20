const invoke = window.__TAURI__.core.invoke;
const $ = id => document.getElementById(id);
async function run(fn) { try { await fn(); $('status').textContent = ''; } catch(e) { $('status').textContent = String(e); } }
async function refresh() {
  const ports = await invoke('ports');
  for (const direction of ['input', 'output']) {
    $(direction).replaceChildren(...ports[direction].map(p => { const option = document.createElement('option'); option.value=p.id; option.textContent=p.name; return option; }));
  }
}
$('refresh').onclick = () => run(refresh);
for (const direction of ['Input', 'Output']) $('connect'+direction).onclick = () => run(() => invoke('connect_'+direction.toLowerCase(), {id:$(direction.toLowerCase()).value}));
$('note').onclick = () => run(() => invoke('play_note'));
$('panic').onclick = () => run(async () => { $('follow').checked=false; await invoke('stop_notes'); });
$('disconnect').onclick = () => run(async () => { $('follow').checked=false; await invoke('disconnect'); });
$('follow').onchange = () => run(() => invoke('set_follow', {enabled:$('follow').checked}));
setInterval(async () => { try { const s=await invoke('snapshot'); $('clock').textContent=JSON.stringify(s,null,2); } catch(e) { $('status').textContent=String(e); } }, 100);
run(refresh);
