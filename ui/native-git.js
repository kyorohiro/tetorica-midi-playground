// The shared Git engine sees HTTPS bytes only. Native dialogs and the OS
// credential store keep personal access tokens outside JavaScript and FILES.
const MAX_BODY = 64 * 1024 * 1024;
const allowedHeaders = new Set(['content-type', 'accept', 'git-protocol']);

function encode(bytes) {
  let value = '';
  for (let i = 0; i < bytes.length; i += 32768) value += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(value);
}
const decode = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));

/** Native boundary; invoke is injected so tests never access real credentials. */
export function createNativeGit({invoke, document: doc = globalThis.document} = {}) {
  if (typeof invoke !== 'function') throw Error('Native Git requires an invoke function');
  const call = async (command, args) => {
    try { return await invoke(command, args); }
    catch (error) { throw error instanceof Error ? error : Error(typeof error === 'string' ? error : error?.message ?? String(error)); }
  };
  async function dialogCall(command, args) {
    const focused = doc?.activeElement;
    focused?.blur?.();
    // WebView2 must leave its typing loop before a native dialog is opened.
    await new Promise(resolve => setTimeout(resolve, 0));
    try { return await call(command, args); }
    finally {
      if (focused?.isConnected && doc.activeElement === doc.body) focused.focus?.({preventScroll: true});
    }
  }
  async function beginRemote(request) {
    const session = await dialogCall('git_https_begin', {request});
    let closing;
    const close = () => closing ??= call('git_https_end', {session});
    return {close, http: {async request({url, method = 'GET', headers = {}, body, signal}) {
      signal?.throwIfAborted();
      const onAbort = () => { void close().catch(() => {}); };
      signal?.addEventListener('abort', onAbort, {once: true});
      try {
        const chunks = []; let length = 0;
        if (body) for await (const value of body) {
          signal?.throwIfAborted();
          const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
          length += chunk.byteLength;
          if (length > MAX_BODY) throw Error('Git request exceeds 64 MiB');
          chunks.push(chunk);
        }
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const permitted = Object.fromEntries(Object.entries(headers).filter(([name]) => allowedHeaders.has(name.toLowerCase())));
        signal?.throwIfAborted();
        const result = await call('git_https_request', {request: {session, url, method, headers: permitted, body: encode(bytes)}});
        signal?.throwIfAborted();
        return {...result, method, body: [decode(result.body)]};
      } finally { signal?.removeEventListener('abort', onAbort); }
    }}};
  }
  const tokens = {
    list: () => call('git_tokens', {request: {action: 'list'}}),
    // Only metadata is sent to IPC. The PAT itself is entered in a native dialog.
    add: ({name, host}) => dialogCall('git_tokens', {request: {action: 'add', name, host}}),
    select: id => dialogCall('git_tokens', {request: {action: 'select', id}}),
    remove: id => dialogCall('git_tokens', {request: {action: 'delete', id}}),
  };
  return {beginRemote, tokens};
}
