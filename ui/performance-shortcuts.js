/** Consume performance shortcuts before the editor handles the same key. */
export function installPerformanceShortcuts({target, hasOpenDialog = () => false, onRun, onStop}) {
  const handleKeyDown = event => {
    if (event.isComposing || event.keyCode === 229) return;

    const run = (event.metaKey || event.ctrlKey) && event.key === 'Enter';
    const stop = event.shiftKey && event.key === 'Escape';
    if ((!run && !stop) || (run && hasOpenDialog())) return;

    // preventDefault alone does not stop Monaco's own shortcut handling.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    if (stop) onStop();
    else onRun();
  };

  const options = {capture: true};
  target.addEventListener('keydown', handleKeyDown, options);
  return {
    dispose() {
      target.removeEventListener('keydown', handleKeyDown, options);
    },
  };
}
