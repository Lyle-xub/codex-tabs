const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForTargets(port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const targets = await response.json();
      const pages = targets.filter(
        (target) => target.type === 'page' && target.webSocketDebuggerUrl,
      );
      if (pages.length) return pages;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }

  throw new Error(
    `无法连接 127.0.0.1:${port} 的 Codex 调试端口` +
      (lastError ? `（${lastError.message}）` : ''),
  );
}

export async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(1_500),
  });
  if (!response.ok) throw new Error(`DevTools endpoint returned HTTP ${response.status}`);
  return (await response.json()).filter(
    (target) => target.type === 'page' && target.webSocketDebuggerUrl,
  );
}

export class CdpPage {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();
  #onReload;

  constructor(url, onReload) {
    this.url = url;
    this.#onReload = onReload;
  }

  async connect() {
    this.#socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.#socket.addEventListener('open', resolve, { once: true });
      this.#socket.addEventListener('error', reject, { once: true });
    });
    this.#socket.addEventListener('message', (event) => this.#handleMessage(event));
    this.#socket.addEventListener('close', () => this.#rejectPending());
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    return this;
  }

  get open() {
    return this.#socket?.readyState === WebSocket.OPEN;
  }

  send(method, params = {}) {
    if (!this.open) return Promise.reject(new Error('CDP connection is closed'));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || '注入脚本执行失败');
    }
    return result.result?.value;
  }

  on(method, listener) {
    if (!this.#listeners.has(method)) this.#listeners.set(method, new Set());
    this.#listeners.get(method).add(listener);
    return () => this.#listeners.get(method)?.delete(listener);
  }

  close() {
    this.#socket?.close();
  }

  #handleMessage(event) {
    const message = JSON.parse(event.data);
    if (message.id) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    if (
      message.method === 'Page.loadEventFired' ||
      message.method === 'Runtime.executionContextsCleared'
    ) {
      this.#onReload?.();
    }
    for (const listener of this.#listeners.get(message.method) || []) {
      try {
        listener(message.params || {});
      } catch {}
    }
  }

  #rejectPending() {
    for (const { reject } of this.#pending.values()) {
      reject(new Error('CDP connection closed'));
    }
    this.#pending.clear();
  }
}
