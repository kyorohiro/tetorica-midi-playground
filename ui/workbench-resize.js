const STORAGE_KEY = 'midi-workbench-layout-v1';
const DEFAULT_FILES_WIDTH = 220;
const DEFAULT_DOCK_HEIGHT = 260;

/** Resize the FILES column and bottom tools without changing tab selection. */
export function installWorkbenchResize({workbench, fileExplorer, fileDivider, dock, dockDivider, storage}) {
  if (!workbench) return null;
  if (storage === undefined) {
    try {storage = globalThis.localStorage;} catch {storage = null;}
  }
  let saved = {};
  try {saved = JSON.parse(storage?.getItem(STORAGE_KEY) || '{}') ?? {};} catch {}
  const state = {
    filesWidth: Number.isFinite(saved.filesWidth) ? Math.max(0, Math.min(600, saved.filesWidth)) : DEFAULT_FILES_WIDTH,
    dockHeight: Number.isFinite(saved.dockHeight) ? Math.max(0, Math.min(800, saved.dockHeight)) : DEFAULT_DOCK_HEIGHT,
  };
  const listeners = [];
  let drag = null;
  function listen(node, type, handler) {
    node?.addEventListener(type, handler);
    listeners.push(() => node?.removeEventListener(type, handler));
  }
  function bounds(axis) {
    const size = Math.max(0, axis === 'filesWidth' ? workbench.clientWidth : workbench.clientHeight);
    const divider = axis === 'filesWidth' ? fileDivider : dockDivider;
    const dividerSize = divider?.getBoundingClientRect?.()[axis === 'filesWidth' ? 'width' : 'height'] || 6;
    // Let minima shrink in short/narrow windows rather than forcing overflow.
    const reserved = Math.min(axis === 'filesWidth' ? 280 : 200, size * 0.6);
    const max = Math.max(0, size - reserved - dividerSize);
    return {min: Math.min(axis === 'filesWidth' ? 140 : 120, max), max};
  }
  function clamp(axis, value) {
    const {min, max} = bounds(axis);
    return Math.round(Math.max(min, Math.min(max, value)));
  }
  function apply() {
    for (const [axis, divider, property] of [
      ['filesWidth', fileDivider, '--files-width'],
      ['dockHeight', dockDivider, '--bottom-panel-height'],
    ]) {
      const {min, max} = bounds(axis);
      const size = clamp(axis, state[axis]);
      workbench.style.setProperty(property, `${size}px`);
      divider?.setAttribute('aria-valuemin', String(Math.round(min)));
      divider?.setAttribute('aria-valuemax', String(Math.round(max)));
      divider?.setAttribute('aria-valuenow', String(size));
      divider?.setAttribute('aria-valuetext', `${size} pixels`);
    }
  }
  function save() {
    try {storage?.setItem(STORAGE_KEY, JSON.stringify(state));} catch {}
  }
  function change(axis, value) {
    state[axis] = clamp(axis, value);
    apply();
  }
  function finish(event) {
    if (!drag || (event && drag.id !== event.pointerId)) return;
    const {divider, id} = drag;
    drag = null;
    workbench.classList.remove('is-resizing');
    if (divider.hasPointerCapture?.(id)) divider.releasePointerCapture(id);
    save();
  }
  function installDivider(divider, target, axis) {
    if (!divider || !target) return;
    const horizontal = axis === 'filesWidth';
    divider.tabIndex = 0;
    divider.setAttribute('role', 'separator');
    divider.setAttribute('aria-orientation', horizontal ? 'vertical' : 'horizontal');
    divider.setAttribute('aria-label', horizontal ? 'FILES width' : 'Bottom panel height');
    if (target.id) divider.setAttribute('aria-controls', target.id);
    divider.title = 'Drag to resize · Double-click to reset · Arrow keys to adjust';
    listen(divider, 'pointerdown', event => {
      if (event.button !== 0 || drag) return;
      event.preventDefault();
      divider.focus();
      drag = {divider, id: event.pointerId, start: horizontal ? event.clientX : event.clientY,
        size: clamp(axis, state[axis])};
      divider.setPointerCapture?.(event.pointerId);
      workbench.classList.add('is-resizing');
    });
    listen(divider, 'pointermove', event => {
      if (drag?.id !== event.pointerId || drag.divider !== divider) return;
      const delta = (horizontal ? event.clientX : event.clientY) - drag.start;
      change(axis, drag.size + (horizontal ? delta : -delta));
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(divider, type, finish);
    listen(divider, 'dblclick', () => {
      state[axis] = horizontal ? DEFAULT_FILES_WIDTH : DEFAULT_DOCK_HEIGHT;
      apply(); save();
    });
    listen(divider, 'keydown', event => {
      const previous = horizontal ? 'ArrowLeft' : 'ArrowDown';
      const next = horizontal ? 'ArrowRight' : 'ArrowUp';
      if (![previous, next, 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const {min, max} = bounds(axis);
      change(axis, event.key === 'Home' ? min : event.key === 'End' ? max :
        clamp(axis, state[axis]) + (event.key === next ? 1 : -1) * (event.shiftKey ? 40 : 10));
      save();
    });
  }
  installDivider(fileDivider, fileExplorer, 'filesWidth');
  installDivider(dockDivider, dock, 'dockHeight');
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(apply) : null;
  observer?.observe(workbench);
  const windowTarget = workbench.ownerDocument?.defaultView;
  if (!observer) listen(windowTarget, 'resize', apply);
  apply();
  return {
    refresh: apply,
    reset() {
      state.filesWidth = DEFAULT_FILES_WIDTH;
      state.dockHeight = DEFAULT_DOCK_HEIGHT;
      apply(); save();
    },
    dispose() {
      finish(); observer?.disconnect();
      for (const remove of listeners) remove();
    },
  };
}
