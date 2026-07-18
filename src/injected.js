(() => {
  const VERSION = '0.36.1';
  const ROOT_ID = 'codex-tabs-hack-root';
  const STYLE_ID = 'codex-tabs-hack-style';
  const TOOLTIP_ID = 'codex-tabs-hack-tooltip';
  const MIRROR_ID = 'codex-tabs-hack-mirror';
  const REOPEN_ID = 'codex-tabs-hack-reopen-menu';
  const STORAGE_KEY = 'codex-tabs-hack-order-v1';
  const HIDDEN_KEY = 'codex-tabs-hack-hidden-v1';
  const PANEL_WIDTH_KEY = 'codex-tabs-hack-panel-width-v1';
  const TAB_HISTORY_KEY = 'codex-tabs-hack-history-v1';
  const DEFAULT_SETTINGS = {
    appLanguage: 'zh-Hans',
    showUsage: true,
    enableShortcuts: true,
    enableDrag: true,
    enableInlinePanel: true,
    autoHideDirectoryPreview: true,
    showVerticalPanel: true,
    activeHighlight: true,
    activeColor: '#2F80ED',
    activeBackgroundOpacity: 0.07,
    activeBorderOpacity: 0.38,
    activeShadowOpacity: 0.12,
    tabRadius: 7,
    panelOpacity: 1,
    verticalWidth: 176,
    verticalTop: 52,
    verticalBottom: 12,
    verticalRadius: 11,
    previewShowTitle: true,
    previewShowStatus: true,
    previewShowActivity: true,
    previewShowTotalTokens: true,
    previewShowInputTokens: true,
    previewShowOutputTokens: true,
    previewShowCache: true,
    previewShowContext: true,
    previewShowQuota: true,
    previewShowProgressBar: true,
  };

  const settings = () => ({
    ...DEFAULT_SETTINGS,
    ...(globalThis.__CODEX_TABS_CONFIG__ || {}),
  });
  const settingNumber = (value, fallback, min, max) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  };
  const settingColor = (value, fallback = '#2F80ED') =>
    /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
  const tr = (chinese, english) => settings().appLanguage === 'en' ? english : chinese;

  const previousTabSnapshot = [...document.querySelectorAll(`#${ROOT_ID} .ct-tab`)].map(
    (element) => ({
      id: element.dataset.id,
      title: String(element.getAttribute('aria-label') || element.querySelector('.ct-title')?.textContent || '').trim(),
      active: element.dataset.active === 'true',
    }),
  ).filter((tab) => tab.id && tab.title);

  if (globalThis.__CODEX_TABS_HACK__?.version === VERSION) {
    return { version: VERSION, count: globalThis.__CODEX_TABS_HACK__.count() };
  }
  globalThis.__CODEX_TABS_HACK__?.destroy?.();

  const state = {
    observer: null,
    frame: 0,
    sourceTabs: [],
    dragId: null,
    hoveredTab: null,
    hoveredAnchor: null,
    activeDragCleanup: null,
    inlineCleanup: null,
    panelWidth: null,
    reopenCleanup: null,
    tooltipTimer: 0,
    runningSince: new Map(),
    cachedTabs: new Map(),
    taskViewSticky: false,
    newTaskControl: null,
    routingFromVertical: false,
    previewHoldUntil: 0,
    previewTimer: 0,
  };

  const clean = (value) =>
    String(value || '')
      .replace(/[\n\t]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

  function visible(element) {
    if (!(element instanceof Element) || element.closest(`#${ROOT_ID}`)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 20 &&
      rect.height > 12 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden'
    );
  }

  function titleOf(element) {
    const codexTitle = clean(element.getAttribute('data-app-action-sidebar-thread-title'));
    const labelledBy = element.getAttribute('aria-labelledby');
    const labelledText = labelledBy
      ? clean(document.getElementById(labelledBy)?.textContent)
      : '';
    const aria = clean(element.getAttribute('aria-label'))
      .replace(/^(open|select|打开|选择)\s*/i, '')
      .replace(/\s*(close|delete|关闭|删除)$/i, '');
    const title = clean(element.getAttribute('title'));
    const text = clean(element.textContent);
    return codexTitle || labelledText || aria || title || text || tr('未命名任务', 'Untitled Task');
  }

  function stableId(element, title, index) {
    const href = element.getAttribute('href') || element.closest('a[href]')?.getAttribute('href');
    return (
      href ||
      element.getAttribute('data-testid') ||
      element.getAttribute('data-app-action-sidebar-thread-id') ||
      element.getAttribute('data-thread-id') ||
      element.getAttribute('data-task-id') ||
      `${title}:${index}`
    );
  }

  function usageIdOf(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const routeMatch = raw.match(/(?:^|\/)(?:local|thread|task)\/([^/?#]+)/i);
    const candidate = routeMatch?.[1] || raw.replace(/^local:/i, '');
    try {
      return decodeURIComponent(candidate);
    } catch {
      return candidate;
    }
  }

  function isActive(element) {
    if (element.getAttribute('data-app-action-sidebar-thread-active') === 'true') return true;
    const nodes = [element, element.closest('[aria-current], [aria-selected], [data-state]')]
      .filter(Boolean);
    return nodes.some(
      (node) =>
        node.getAttribute('aria-selected') === 'true' ||
        ['page', 'true'].includes(node.getAttribute('aria-current')) ||
        ['active', 'selected', 'checked'].includes(node.getAttribute('data-state')),
    );
  }

  function statusOf(element) {
    if (element.querySelector('.animate-spin')) return 'working';
    const statusNode = element.querySelector(
      '[aria-label*="working" i], [aria-label*="running" i], [aria-label*="complete" i], ' +
        '[aria-label*="工作"], [aria-label*="运行"], [aria-label*="完成"], ' +
        '[data-status], [data-state="running"]',
    );
    const value = clean(
      statusNode?.getAttribute('data-status') ||
        statusNode?.getAttribute('aria-label') ||
        statusNode?.getAttribute('data-state'),
    );
    if (/working|running|progress|工作|运行|处理中/i.test(value)) return 'working';
    if (/complete|done|success|完成|成功/i.test(value)) return 'done';
    return '';
  }

  function closeControl(element) {
    const container = element.closest('li, [role="tab"], [data-testid]') || element;
    return container.querySelector(
      'button[aria-label*="close" i], button[aria-label*="delete" i], ' +
        'button[aria-label*="archive" i], ' +
        'button[title*="close" i], button[title*="delete" i], ' +
        'button[aria-label*="关闭"], button[aria-label*="删除"], button[aria-label*="归档"], ' +
        'button[title*="关闭"], button[title*="删除"]',
    );
  }

  function findTabs() {
    const strategies = [
      '[data-app-action-sidebar-thread-row]',
      '[role="list"][aria-label="任务"] > [role="listitem"] [data-app-action-sidebar-thread-row]',
      '[role="list"][aria-label="Tasks"] > [role="listitem"] [data-app-action-sidebar-thread-row]',
      '[data-testid*="thread" i]',
      '[data-testid*="conversation" i]',
      '[data-testid*="task" i]',
      'a[href*="/thread/"]',
      'a[href*="/task/"]',
      '[role="tab"]',
    ];

    for (const selector of strategies) {
      const nativeThreadRows = selector === '[data-app-action-sidebar-thread-row]';
      const raw = [...document.querySelectorAll(selector)].filter(
        (element) => nativeThreadRows || visible(element),
      );
      const candidates = raw.filter((element) => {
        if (nativeThreadRows) return titleOf(element).length > 0;
        const rect = element.getBoundingClientRect();
        return rect.left < Math.min(520, innerWidth * 0.45) && titleOf(element).length > 0;
      });
      const unique = candidates.filter(
        (candidate, index) =>
          !candidates.some(
            (other, otherIndex) =>
              otherIndex < index && (other.contains(candidate) || candidate.contains(other)),
          ),
      );
      if (unique.length > 1 || (nativeThreadRows && unique.length)) {
        return unique.slice(0, 40).map((element, index) => {
          const title = titleOf(element);
          return {
            element,
            title,
            id: stableId(element, title, index),
            active: isActive(element),
            status: statusOf(element),
            close: closeControl(element),
          };
        });
      }
    }
    return [];
  }

  function findNewTaskControl() {
    return [...document.querySelectorAll(
      'button[data-testid*="new" i], a[data-testid*="new" i], ' +
        'button[aria-label*="new task" i], button[aria-label*="new thread" i], ' +
        'button[aria-label*="新建"], a[href$="/new"]',
    )].find(visible);
  }

  function loadOrder() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function saveOrder(order) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
    } catch {}
  }

  function loadHidden() {
    try {
      const persistent = localStorage.getItem(HIDDEN_KEY);
      const legacy = sessionStorage.getItem(HIDDEN_KEY);
      const stored = persistent ?? legacy;
      if (persistent === null && legacy !== null) localStorage.setItem(HIDDEN_KEY, legacy);
      const value = JSON.parse(stored || '[]');
      return new Set(Array.isArray(value) ? value : []);
    } catch {
      return new Set();
    }
  }

  function saveHidden(hidden) {
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
    } catch {}
  }

  function loadTabHistory() {
    try {
      const value = JSON.parse(localStorage.getItem(TAB_HISTORY_KEY) || 'null');
      return value && Array.isArray(value.tabs) ? value : null;
    } catch {
      return null;
    }
  }

  function hydrateTabHistory() {
    const stored = loadTabHistory();
    const history = stored || (previousTabSnapshot.length ? {
      tabs: previousTabSnapshot,
      activeId: previousTabSnapshot.find((tab) => tab.active)?.id || null,
      taskView: true,
    } : null);
    if (!history) return;
    for (const saved of history.tabs) {
      if (!saved?.id || !saved?.title) continue;
      state.cachedTabs.set(saved.id, {
        id: saved.id,
        title: saved.title,
        active: saved.id === history.activeId,
        status: '',
        element: null,
        close: null,
      });
    }
    // 历史记录只恢复标签，不恢复“当前处于任务页”状态。Codex 启动首页没有
    // 任务内容，沿用上次状态会让折叠布局误显示纵向面板。
    state.taskViewSticky = false;
    if (!stored) saveTabHistory();
  }

  function saveTabHistory() {
    try {
      const tabs = ordered([...state.cachedTabs.values()]);
      const active = tabs.find((tab) => tab.active);
      localStorage.setItem(TAB_HISTORY_KEY, JSON.stringify({
        tabs: tabs.map((tab) => ({ id: tab.id, title: tab.title })),
        activeId: active?.id || null,
        taskView: state.taskViewSticky,
        updatedAt: Date.now(),
      }));
    } catch {}
  }

  function ordered(tabs) {
    const order = loadOrder();
    return [...tabs].sort((a, b) => {
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }

  function visibleTabs() {
    const hidden = loadHidden();
    return ordered(state.sourceTabs).filter((tab) => !hidden.has(tab.id));
  }

  function cacheDiscoveredTabs(tabs) {
    const active = tabs.find((tab) => tab.active);
    if (active) {
      state.taskViewSticky = true;
      for (const cached of state.cachedTabs.values()) cached.active = false;
    } else if (tabs.some((tab) => visible(tab.element))) {
      state.taskViewSticky = false;
    }
    for (const tab of tabs) state.cachedTabs.set(tab.id, tab);
    saveTabHistory();
  }

  function sidebarCollapsed() {
    if (state.routingFromVertical) return true;
    const rows = [...document.querySelectorAll('[data-app-action-sidebar-thread-row]')];
    if (rows.length) return !rows.some(visible);
    return state.taskViewSticky && state.cachedTabs.size > 0;
  }

  function activate(tab) {
    const live = tab.element?.isConnected
      ? tab.element
      : [...document.querySelectorAll('[data-app-action-sidebar-thread-row]')].find(
          (row) => row.getAttribute('data-app-action-sidebar-thread-id') === tab.id,
        );
    if (live) {
      live.click();
      live.focus?.();
      return;
    }
    if (document.getElementById(ROOT_ID)?.dataset.orientation === 'vertical') {
      void activateFromCollapsedSidebar(tab);
    }
  }

  function sidebarToggle(action) {
    const pattern = action === 'show'
      ? /^(显示边栏|Show sidebar)$/i
      : /^(隐藏边栏|Hide sidebar)$/i;
    return [...document.querySelectorAll('button[aria-label]')]
      .filter((button) => pattern.test(clean(button.getAttribute('aria-label'))) && visible(button))
      .sort((a, b) => b.getBoundingClientRect().y - a.getBoundingClientRect().y)[0] || null;
  }

  async function waitForThreadRow(id, timeoutMs = 1600) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const row = [...document.querySelectorAll('[data-app-action-sidebar-thread-row]')].find(
        (element) => element.getAttribute('data-app-action-sidebar-thread-id') === id,
      );
      if (row) return row;
      await new Promise((resolve) => setTimeout(resolve, 16));
    }
    return null;
  }

  async function activateFromCollapsedSidebar(tab) {
    if (state.routingFromVertical) return;
    const show = sidebarToggle('show');
    if (!show) return;
    state.routingFromVertical = true;
    try {
      show.click();
      const row = await waitForThreadRow(tab.id);
      if (!row) return;
      row.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      sidebarToggle('hide')?.click();
      await new Promise((resolve) => setTimeout(resolve, 80));
    } finally {
      if (document.querySelector('[data-app-action-sidebar-thread-row]')) {
        sidebarToggle('hide')?.click();
      }
      state.routingFromVertical = false;
      render();
    }
  }

  function closeTab(tab) {
    const tabs = visibleTabs();
    const index = tabs.findIndex((item) => item.id === tab.id);
    const hidden = loadHidden();
    hidden.add(tab.id);
    saveHidden(hidden);
    if (tab.active) {
      const replacement = tabs[index + 1] || tabs[index - 1];
      if (replacement) activate(replacement);
    }
    render();
  }

  function hiddenTabs() {
    const byId = new Map(state.sourceTabs.map((tab) => [tab.id, tab]));
    return [...loadHidden()].reverse().map((id) => byId.get(id)).filter(Boolean);
  }

  function hideReopenMenu() {
    state.reopenCleanup?.();
    state.reopenCleanup = null;
    const menu = document.getElementById(REOPEN_ID);
    if (menu) {
      menu.hidden = true;
      menu.replaceChildren();
    }
  }

  function restoreTab(tab, activateAfter = true) {
    const hidden = loadHidden();
    if (!hidden.delete(tab.id)) return;
    saveHidden(hidden);
    hideReopenMenu();
    if (activateAfter) activate(tab);
    render();
  }

  function restoreLastClosed() {
    const tab = hiddenTabs()[0];
    if (tab) restoreTab(tab);
  }

  function reopenMenu() {
    let menu = document.getElementById(REOPEN_ID);
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = REOPEN_ID;
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    document.body.appendChild(menu);
    return menu;
  }

  function showReopenMenu(anchor) {
    const tabs = hiddenTabs();
    if (!tabs.length) return;
    hideReopenMenu();
    const menu = reopenMenu();
    const heading = document.createElement('div');
    heading.className = 'ct-reopen-heading';
    heading.textContent = tr('最近关闭的标签页', 'Recently Closed Tabs');
    menu.appendChild(heading);
    for (const tab of tabs) {
      const item = document.createElement('button');
      item.className = 'ct-reopen-item';
      item.setAttribute('role', 'menuitem');
      item.title = tab.title;
      item.innerHTML = '<span class="ct-reopen-title"></span>';
      item.querySelector('.ct-reopen-title').textContent = tab.title;
      item.addEventListener('click', () => restoreTab(tab));
      menu.appendChild(item);
    }
    if (tabs.length > 1) {
      const all = document.createElement('button');
      all.className = 'ct-reopen-all';
      all.textContent = tr(`全部重新打开（${tabs.length}）`, `Reopen All (${tabs.length})`);
      all.addEventListener('click', () => {
        const hidden = loadHidden();
        for (const tab of tabs) hidden.delete(tab.id);
        saveHidden(hidden);
        hideReopenMenu();
        render();
      });
      menu.appendChild(all);
    }
    const rect = anchor.getBoundingClientRect();
    const vertical = document.getElementById(ROOT_ID)?.dataset.orientation === 'vertical';
    menu.style.top = `${Math.round(vertical ? Math.max(8, Math.min(rect.top, innerHeight - 390)) : rect.bottom + 5)}px`;
    menu.style.left = `${Math.round(vertical ? rect.right + 6 : Math.max(8, Math.min(rect.left, innerWidth - 276)))}px`;
    menu.hidden = false;
    const closeOutside = (event) => {
      if (!menu.contains(event.target) && event.target !== anchor) hideReopenMenu();
    };
    const closeEscape = (event) => {
      if (event.key === 'Escape') hideReopenMenu();
    };
    addEventListener('pointerdown', closeOutside, true);
    addEventListener('keydown', closeEscape, true);
    state.reopenCleanup = () => {
      removeEventListener('pointerdown', closeOutside, true);
      removeEventListener('keydown', closeEscape, true);
    };
    menu.querySelector('.ct-reopen-item')?.focus();
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} {
        position: fixed; top: 5px; left: 320px; right: 126px; height: 36px;
        display: flex; align-items: stretch; gap: 3px; padding: 3px 0;
        box-sizing: border-box; overflow-x: auto; overflow-y: hidden;
        z-index: 2147483647; color: CanvasText;
        background: transparent; scrollbar-width: none;
        -webkit-app-region: drag;
        font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${ROOT_ID}::-webkit-scrollbar { display: none; }
      #${ROOT_ID}[hidden] { display: none; }
      #${ROOT_ID}[data-native-preview="true"] { visibility: hidden; pointer-events: none; }
      #${ROOT_ID}[data-inline-enabled="false"] .ct-split { display: none !important; }
      #${ROOT_ID}[data-orientation="vertical"] {
        top: var(--ct-vertical-top, 52px); bottom: var(--ct-vertical-bottom, 12px);
        left: 64px; right: auto; width: var(--ct-vertical-width, 176px); height: auto;
        flex-direction: column; align-items: stretch; gap: 3px; padding: 6px;
        overflow-x: hidden; overflow-y: auto; border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
        border-radius: var(--ct-vertical-radius, 11px);
        background: color-mix(in srgb, Canvas var(--ct-panel-opacity, 100%), transparent);
        box-shadow: 4px 8px 24px rgb(0 0 0 / 16%); backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px); -webkit-app-region: no-drag;
      }
      #${ROOT_ID} .ct-vertical-heading { display: none; }
      #${ROOT_ID}[data-orientation="vertical"] .ct-vertical-heading {
        display: flex; align-items: center; justify-content: space-between; flex: 0 0 28px;
        padding: 0 7px; color: color-mix(in srgb, CanvasText 62%, transparent);
        border-bottom: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
        font-size: 11px; font-weight: 600; letter-spacing: .02em;
      }
      #${ROOT_ID} .ct-vertical-count { font-variant-numeric: tabular-nums; opacity: .65; }
      #${ROOT_ID}[data-orientation="vertical"] .ct-tab {
        flex: 0 0 34px; width: 100%; min-width: 0; max-width: none; box-sizing: border-box;
      }
      #${ROOT_ID}[data-orientation="vertical"] .ct-spacer { flex: 1 0 12px; }
      #${ROOT_ID}[data-orientation="vertical"] .ct-new,
      #${ROOT_ID}[data-orientation="vertical"] .ct-reopen { align-self: center; margin: 0; }
      #${ROOT_ID}[data-empty="true"] { pointer-events: none; opacity: .6; }
      #${ROOT_ID} .ct-tab {
        flex: 0 1 190px; min-width: 96px; max-width: 210px;
        display: flex; align-items: center; gap: 7px; padding: 0 8px;
        position: relative;
        color: color-mix(in srgb, CanvasText 72%, transparent);
        background: color-mix(in srgb, CanvasText 5%, transparent);
        border: 1px solid transparent; border-radius: var(--ct-tab-radius, 7px); cursor: default;
        -webkit-app-region: no-drag;
      }
      #${ROOT_ID} .ct-tab:hover { background: color-mix(in srgb, CanvasText 9%, transparent); }
      #${ROOT_ID} .ct-tab.ct-pressing::after {
        content: ''; position: absolute; left: 8px; right: 8px; bottom: 1px; height: 2px;
        border-radius: 2px; background: #2f80ed; transform-origin: left;
        animation: ct-hold 350ms linear forwards;
      }
      #${ROOT_ID} .ct-tab.ct-pressing { position: relative; }
      #${ROOT_ID} .ct-tab.ct-dragging {
        cursor: grabbing; opacity: .24;
        border-color: #2f80ed; border-style: dashed; box-shadow: none;
      }
      .ct-drag-ghost {
        position: fixed !important; z-index: 2147483647 !important; margin: 0 !important;
        box-sizing: border-box; display: flex; align-items: center; gap: 7px; padding: 0 8px;
        color: CanvasText; background: color-mix(in srgb, Canvas 94%, transparent) !important;
        border: 1px solid #2f80ed !important; border-radius: 7px; pointer-events: none !important;
        opacity: .9; box-shadow: 0 8px 24px rgb(0 0 0 / 24%), 0 2px 8px rgb(47 128 237 / 25%);
        transform: rotate(1deg) scale(1.03); transform-origin: center;
        -webkit-app-region: no-drag !important;
        font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .ct-drag-ghost .ct-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
      .ct-drag-ghost .ct-close {
        display: grid; place-items: center; width: 20px; height: 20px; padding: 0;
        border: 0; background: transparent; color: inherit; opacity: .35; line-height: 0;
      }
      .ct-drag-ghost .ct-close svg { display: block; width: 14px; height: 14px; }
      .ct-drag-ghost .ct-status { width: 7px; height: 7px; border-radius: 50%; flex: none; }
      .ct-drag-ghost .ct-status[data-status="working"] { background: #f5a524; }
      .ct-drag-ghost .ct-status[data-status="done"] { background: #22a06b; }
      #${ROOT_ID}[data-active-highlight="true"] .ct-tab[data-active="true"] {
        color: CanvasText;
        background: color-mix(in srgb, var(--ct-active-color, #2f80ed) var(--ct-active-bg, 7%), transparent) !important;
        border-color: color-mix(in srgb, var(--ct-active-color, #2f80ed) var(--ct-active-border, 38%), transparent) !important;
        box-shadow: 0 1px 4px color-mix(in srgb, var(--ct-active-color, #2f80ed) var(--ct-active-shadow, 12%), transparent) !important;
        font-weight: 550;
      }
      #${ROOT_ID} .ct-status { width: 7px; height: 7px; border-radius: 50%; flex: none; }
      #${ROOT_ID} .ct-status[data-status="working"] { background: #f5a524; animation: ct-pulse 1.2s infinite; }
      #${ROOT_ID} .ct-status[data-status="done"] { background: #22a06b; }
      #${ROOT_ID} .ct-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
      #${ROOT_ID} .ct-close, #${ROOT_ID} .ct-split, #${ROOT_ID} .ct-new, #${ROOT_ID} .ct-reopen {
        display: grid; place-items: center; flex: none; border: 0; border-radius: 5px;
        padding: 0; width: 20px; height: 20px; line-height: 0;
        color: inherit; background: transparent; font: 15px/1 -apple-system, sans-serif;
        -webkit-app-region: no-drag;
      }
      #${ROOT_ID} .ct-close svg { display: block; width: 14px; height: 14px; }
      #${ROOT_ID} .ct-close:hover, #${ROOT_ID} .ct-split:hover, #${ROOT_ID} .ct-new:hover, #${ROOT_ID} .ct-reopen:hover { background: color-mix(in srgb, CanvasText 12%, transparent); }
      #${ROOT_ID} .ct-split { display: none; font-size: 13px; line-height: 20px; }
      #${ROOT_ID} .ct-tab:hover .ct-split { display: block; }
      #${ROOT_ID} .ct-close:disabled { opacity: 0; }
      #${ROOT_ID} .ct-tab:hover .ct-close:disabled { opacity: .25; }
      #${ROOT_ID} .ct-new { margin: 1px 0; width: 28px; height: 28px; }
      #${ROOT_ID} .ct-new svg { display: block; width: 16px; height: 16px; }
      #${ROOT_ID} .ct-reopen {
        display: grid; place-items: center; margin: 1px 0; width: 28px; height: 28px;
        flex: none; line-height: 0;
      }
      #${ROOT_ID} .ct-reopen svg { display: block; width: 14px; height: 14px; }
      #${ROOT_ID} .ct-empty { margin: auto; opacity: .7; }
      #${REOPEN_ID} {
        position: fixed; z-index: 2147483647; width: 268px; max-height: min(380px, calc(100vh - 58px));
        overflow: auto; padding: 5px; border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
        border-radius: 9px; color: CanvasText; background: Canvas;
        box-shadow: 0 7px 24px rgb(0 0 0 / 17%); color-scheme: light dark;
        font: 12px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${REOPEN_ID}[hidden] { display: none; }
      #${REOPEN_ID} .ct-reopen-heading { padding: 4px 7px 6px; font-size: 10px; letter-spacing: .01em; opacity: .52; }
      #${REOPEN_ID} button { width: 100%; border: 0; color: inherit; background: transparent; cursor: default; }
      #${REOPEN_ID} .ct-reopen-item { display: flex; align-items: center; padding: 5px 7px; border-radius: 5px; text-align: left; font: inherit; }
      #${REOPEN_ID} .ct-reopen-item:hover, #${REOPEN_ID} .ct-reopen-item:focus { outline: 0; background: color-mix(in srgb, CanvasText 9%, transparent); }
      #${REOPEN_ID} .ct-reopen-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #${REOPEN_ID} .ct-reopen-all { margin-top: 4px; padding: 6px 7px 5px; border-top: 1px solid color-mix(in srgb, CanvasText 9%, transparent); font: 11px/1.3 -apple-system, sans-serif; opacity: .68; }
      #${REOPEN_ID} .ct-reopen-all:hover { opacity: 1; }
      #${TOOLTIP_ID} {
        position: fixed; z-index: 2147483647; width: 280px; box-sizing: border-box;
        padding: 12px; border-radius: 10px; pointer-events: none;
        color: CanvasText; background: color-mix(in srgb, Canvas 96%, transparent);
        border: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
        box-shadow: 0 8px 28px rgb(0 0 0 / 20%);
        backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
        font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        -webkit-app-region: no-drag;
      }
      #${TOOLTIP_ID}[hidden] { display: none; }
      #${TOOLTIP_ID} .ct-tip-title { font-size: 13px; font-weight: 600; margin-bottom: 9px; }
      #${TOOLTIP_ID} .ct-tip-status { display: flex; align-items: center; gap: 6px; margin-bottom: 9px; font-variant-numeric: tabular-nums; }
      #${TOOLTIP_ID} .ct-tip-activity { margin: 0 0 10px; padding: 7px 8px; border-radius: 7px; background: color-mix(in srgb, #2f80ed 10%, transparent); }
      #${TOOLTIP_ID} .ct-tip-activity-value { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #${TOOLTIP_ID} .ct-status { width: 7px; height: 7px; border-radius: 50%; flex: none; }
      #${TOOLTIP_ID} .ct-status[data-status="working"] { background: #f5a524; animation: ct-pulse 1.2s infinite; }
      #${TOOLTIP_ID} .ct-status[data-status="done"] { background: #22a06b; }
      #${TOOLTIP_ID} .ct-tip-grid { display: grid; grid-template-columns: 1fr auto; gap: 5px 12px; }
      #${TOOLTIP_ID} .ct-tip-label { color: color-mix(in srgb, CanvasText 58%, transparent); }
      #${TOOLTIP_ID} .ct-tip-value { text-align: right; font-variant-numeric: tabular-nums; }
      #${TOOLTIP_ID} .ct-tip-bar { height: 5px; margin: 9px 0 5px; overflow: hidden; border-radius: 9px; background: color-mix(in srgb, CanvasText 10%, transparent); }
      #${TOOLTIP_ID} .ct-tip-fill { height: 100%; border-radius: inherit; background: #2f80ed; }
      #${TOOLTIP_ID} .ct-tip-note { margin-top: 8px; color: color-mix(in srgb, CanvasText 48%, transparent); font-size: 11px; }
      #${MIRROR_ID} {
        position: fixed; z-index: 2147483646; top: 43px; right: 0; bottom: 0; width: 50vw;
        display: flex; flex-direction: column; overflow: hidden; color: CanvasText;
        background: Canvas; border-left: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
        box-shadow: -12px 0 32px rgb(0 0 0 / 12%); -webkit-app-region: no-drag;
        font: 12px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${MIRROR_ID}.ct-mirror-resizing { user-select: none; }
      #${MIRROR_ID} .ct-mirror-resizer {
        position: absolute; z-index: 3; top: 0; bottom: 0; left: -4px; width: 9px;
        cursor: col-resize; touch-action: none; -webkit-app-region: no-drag;
      }
      #${MIRROR_ID} .ct-mirror-resizer::after {
        content: ''; position: absolute; top: 0; bottom: 0; left: 4px; width: 1px;
        background: color-mix(in srgb, CanvasText 18%, transparent);
        transition: width 120ms, left 120ms, background 120ms;
      }
      #${MIRROR_ID} .ct-mirror-resizer:hover::after,
      #${MIRROR_ID}.ct-mirror-resizing .ct-mirror-resizer::after {
        left: 3px; width: 3px; background: color-mix(in srgb, #2f80ed 72%, transparent);
      }
      #${MIRROR_ID}[hidden] { display: none; }
      #${MIRROR_ID} .ct-mirror-head { height: 34px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 12px; border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent); }
      #${MIRROR_ID} .ct-mirror-dot { width: 7px; height: 7px; border-radius: 50%; background: #f5a524; }
      #${MIRROR_ID}[data-status="ready"] .ct-mirror-dot { background: #22a06b; }
      #${MIRROR_ID}[data-status="error"] .ct-mirror-dot { background: #d14343; }
      #${MIRROR_ID} .ct-mirror-title { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #${MIRROR_ID} .ct-mirror-close { width: 24px; height: 24px; padding: 0; border: 0; border-radius: 5px; color: inherit; background: transparent; font-size: 17px; }
      #${MIRROR_ID} .ct-mirror-close:hover { background: color-mix(in srgb, CanvasText 10%, transparent); }
      #${MIRROR_ID} .ct-mirror-stage { position: relative; min-height: 0; flex: 1; display: grid; place-items: center; overflow: hidden; background: color-mix(in srgb, CanvasText 3%, Canvas); }
      #${MIRROR_ID} iframe { width: 100%; height: 100%; border: 0; background: Canvas; }
      #${MIRROR_ID} .ct-mirror-message { position: absolute; max-width: 80%; padding: 9px 12px; border-radius: 8px; background: color-mix(in srgb, Canvas 92%, transparent); box-shadow: 0 2px 12px rgb(0 0 0 / 12%); }
      @keyframes ct-pulse { 50% { opacity: .35; transform: scale(.75); } }
      @keyframes ct-hold { from { transform: scaleX(0); } to { transform: scaleX(1); } }
      @media (prefers-color-scheme: dark) { #${ROOT_ID} { color-scheme: dark; } }
      @media (max-width: 900px) {
        #${ROOT_ID} { left: 220px; right: 118px; }
        #${ROOT_ID} .ct-tab { min-width: 82px; }
      }
    `;
    document.head.appendChild(style);
  }

  function mirrorPanel() {
    let panel = document.getElementById(MIRROR_ID);
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = MIRROR_ID;
    panel.hidden = true;
    panel.innerHTML = `<div class="ct-mirror-resizer" role="separator" aria-orientation="vertical" title="${tr('拖动调整宽度，双击恢复 50%', 'Drag to resize; double-click to restore 50%')}"></div><header class="ct-mirror-head"><span class="ct-mirror-dot"></span><span class="ct-mirror-title">${tr('同窗任务', 'Inline Task')}</span><button class="ct-mirror-close" title="${tr('关闭同窗任务', 'Close inline task')}">×</button></header><div class="ct-mirror-stage"><div class="ct-mirror-message">${tr('正在启动第二套 Codex 前端…', 'Starting a second Codex frontend…')}</div></div>`;
    applyPanelWidth(panel);
    const resizer = panel.querySelector('.ct-mirror-resizer');
    resizer.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      try {
        resizer.setPointerCapture?.(event.pointerId);
      } catch {}
      panel.classList.add('ct-mirror-resizing');
      const move = (moveEvent) => {
        setPanelWidth(panel, innerWidth - moveEvent.clientX, false);
      };
      const finish = (upEvent) => {
        try {
          if (resizer.hasPointerCapture?.(upEvent.pointerId)) {
            resizer.releasePointerCapture(upEvent.pointerId);
          }
        } catch {}
        resizer.removeEventListener('pointermove', move);
        resizer.removeEventListener('pointerup', finish);
        resizer.removeEventListener('pointercancel', finish);
        panel.classList.remove('ct-mirror-resizing');
        savePanelWidth(panel.getBoundingClientRect().width);
      };
      resizer.addEventListener('pointermove', move);
      resizer.addEventListener('pointerup', finish);
      resizer.addEventListener('pointercancel', finish);
    });
    resizer.addEventListener('dblclick', () => {
      setPanelWidth(panel, innerWidth / 2, true);
    });
    panel.querySelector('.ct-mirror-close').addEventListener('click', () => {
      closeInlinePanel();
      panel.hidden = true;
    });
    document.body.appendChild(panel);
    return panel;
  }

  function panelWidthBounds() {
    const min = Math.min(360, Math.max(260, innerWidth * 0.4));
    const max = Math.max(min, innerWidth - Math.min(360, innerWidth * 0.35));
    return { min, max };
  }

  function loadPanelWidth() {
    try {
      const value = Number(localStorage.getItem(PANEL_WIDTH_KEY));
      return Number.isFinite(value) && value > 0 ? value : innerWidth / 2;
    } catch {
      return innerWidth / 2;
    }
  }

  function savePanelWidth(width) {
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(Math.round(width)));
    } catch {}
  }

  function setPanelWidth(panel, requestedWidth, persist) {
    const { min, max } = panelWidthBounds();
    const width = Math.max(min, Math.min(max, requestedWidth));
    state.panelWidth = width;
    panel.style.width = `${Math.round(width)}px`;
    if (persist) savePanelWidth(width);
  }

  function applyPanelWidth(panel) {
    setPanelWidth(panel, state.panelWidth ?? loadPanelWidth(), false);
  }

  function closeInlinePanel() {
    state.inlineCleanup?.();
    state.inlineCleanup = null;
    const panel = document.getElementById(MIRROR_ID);
    panel?.querySelector('iframe')?.remove();
  }

  function setInlineStatus(panel, status, detail = '') {
    panel.dataset.status = status;
    const message = panel.querySelector('.ct-mirror-message');
    message.hidden = status === 'ready';
    message.textContent = status === 'error'
      ? `${tr('同窗任务启动失败', 'Unable to start inline task')}: ${detail}`
      : detail;
  }

  function openInlineThread(tab) {
    ensureStyle();
    const panel = mirrorPanel();
    closeInlinePanel();
    panel.hidden = false;
    panel.querySelector('.ct-mirror-title').textContent = tab.title;
    setInlineStatus(panel, 'loading', tr('正在启动第二套 Codex 前端…', 'Starting a second Codex frontend…'));

    const threadId = usageIdOf(tab.id);
    if (!/^[a-zA-Z0-9_-]{8,}$/.test(threadId)) {
      setInlineStatus(panel, 'error', tr('无法识别这个任务的 ID', 'Unable to identify this task ID'));
      return;
    }
    const entry = document.querySelector('script[type="module"][src]')?.src;
    if (!entry?.startsWith('app://-')) {
      setInlineStatus(panel, 'error', tr('没有找到 Codex 前端入口', 'Codex frontend entry point was not found'));
      return;
    }

    const stage = panel.querySelector('.ct-mirror-stage');
    const iframe = document.createElement('iframe');
    iframe.setAttribute('title', `${tr('同窗任务', 'Inline Task')}: ${tab.title}`);
    iframe.setAttribute('allow', 'clipboard-read; clipboard-write');
    stage.prepend(iframe);

    const childWindow = iframe.contentWindow;
    const childDocument = iframe.contentDocument;
    const errors = [];
    let statusTimer = 0;
    let closed = false;
    let forwardHostMessage = null;

    try {
      childDocument.open();
      const route = `/local/${encodeURIComponent(threadId)}`;
      childWindow.history.replaceState(
        {},
        '',
        `/index.html?initialRoute=${encodeURIComponent(route)}`,
      );
      childWindow.electronBridge = globalThis.electronBridge;

      const localPostMessage = childWindow.postMessage.bind(childWindow);
      const parentPostMessage = globalThis.postMessage.bind(globalThis);
      childWindow.postMessage = (message, targetOrigin, transfer) => {
        if (message?.type === 'connect-app-host') {
          return parentPostMessage(message, location.origin, transfer);
        }
        return localPostMessage(
          message,
          targetOrigin === 'null' ? '*' : targetOrigin,
          transfer,
        );
      };

      forwardHostMessage = (event) => {
        if (closed || event.source !== null) return;
        try {
          childWindow.dispatchEvent(
            new childWindow.MessageEvent('message', {
              data: event.data,
              origin: event.origin,
              source: null,
            }),
          );
        } catch (error) {
          errors.push(String(error));
        }
      };
      addEventListener('message', forwardHostMessage);
      childWindow.addEventListener('error', (event) => {
        errors.push(String(event.message || event.error || '未知错误'));
      });
      childWindow.addEventListener('unhandledrejection', (event) => {
        errors.push(String(event.reason || 'Promise 被拒绝'));
      });

      const safeEntry = entry.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
      childDocument.write(
        '<!doctype html><html><head><meta charset="utf-8">' +
          '<style>html,body,#root{width:100%;height:100%;margin:0}</style>' +
          `<script type="module" src="${safeEntry}"></` + 'script>' +
          '</head><body><div id="root"></div></body></html>',
      );
      childDocument.close();
      childWindow.addEventListener('keydown', onKeydown, true);

      const startedAt = Date.now();
      statusTimer = setInterval(() => {
        if (closed || !iframe.isConnected) return;
        const hasRoot = Boolean(childWindow.__codexRoot);
        const loading = Boolean(childDocument.querySelector('.openai-blossom-shimmer'));
        if (hasRoot && !loading && childDocument.getElementById('root')?.children.length) {
          clearInterval(statusTimer);
          statusTimer = 0;
          setInlineStatus(panel, 'ready');
        } else if (errors.length) {
          setInlineStatus(panel, 'error', errors.at(-1));
        } else if (Date.now() - startedAt > 45_000) {
          setInlineStatus(panel, 'error', tr('初始化超时，可关闭后重试', 'Initialization timed out. Close the panel and try again.'));
        }
      }, 250);
    } catch (error) {
      errors.push(String(error));
      setInlineStatus(panel, 'error', error.message || String(error));
    }

    state.inlineCleanup = () => {
      if (closed) return;
      closed = true;
      if (statusTimer) clearInterval(statusTimer);
      if (forwardHostMessage) removeEventListener('message', forwardHostMessage);
      childWindow.removeEventListener('keydown', onKeydown, true);
      try {
        childWindow.dispatchEvent(new childWindow.Event('pagehide'));
        childWindow.__codexRoot?.unmount?.();
      } catch {}
      iframe.remove();
    };
  }

  function updateLayout(root) {
    if (root.dataset.orientation === 'vertical') {
      root.style.left = '64px';
      root.style.right = 'auto';
      return;
    }
    const taskMenu = [...document.querySelectorAll(
      'button[aria-label="任务操作"], button[aria-label="Task actions"]',
    )].find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.y < 46 && rect.width > 0;
    });
    if (taskMenu) {
      root.style.left = `${Math.ceil(taskMenu.getBoundingClientRect().right + 8)}px`;
    } else {
      root.style.left = innerWidth <= 900 ? '220px' : '320px';
    }

    const rightControls = [...document.querySelectorAll(
      'button[aria-label*="摘要"], button[aria-label*="summary" i], ' +
        'button[aria-label="切换底部面板显示"], button[aria-label="显示/隐藏侧边栏"]',
    )]
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.y < 46 && rect.x > innerWidth * 0.6 && rect.width > 0);
    let rightInset;
    if (rightControls.length) {
      const firstControlX = Math.min(...rightControls.map((rect) => rect.x));
      rightInset = Math.ceil(innerWidth - firstControlX + 8);
    } else {
      rightInset = innerWidth <= 900 ? 118 : 126;
    }
    const panelBoundary = rightPanelBoundary();
    if (panelBoundary !== null) {
      rightInset = Math.max(rightInset, Math.ceil(innerWidth - panelBoundary + 8));
    }
    root.style.right = `${rightInset}px`;
  }

  function rightPanelBoundary() {
    const separators = [...document.querySelectorAll(
      '[data-panel-resize-handle-id], [data-resize-handle], ' +
        '[role="separator"][aria-orientation="vertical"], ' +
        '[class*="resize-handle" i], [class*="resizer" i]',
    )]
      .filter((element) => !element.closest(`#${ROOT_ID}, #${MIRROR_ID}`))
      .map((element) => element.getBoundingClientRect())
      .filter((rect) =>
        rect.width <= 24 && rect.height > innerHeight * 0.35 &&
        rect.x > innerWidth * 0.45 && rect.x < innerWidth - 160,
      )
      .map((rect) => rect.x + rect.width / 2);

    const panels = [...document.querySelectorAll(
      'aside, [role="complementary"], [data-testid*="right" i], ' +
        '[data-testid*="side-panel" i], [data-panel-id*="right" i], ' +
        '[aria-label*="side panel" i], [aria-label*="侧边面板"], [aria-label*="右侧" i]',
    )]
      .filter((element) => !element.closest(`#${ROOT_ID}, #${MIRROR_ID}, #${TOOLTIP_ID}`))
      .map((element) => element.getBoundingClientRect())
      .filter((rect) =>
        rect.width >= 160 && rect.height > innerHeight * 0.35 &&
        rect.right >= innerWidth - 2 && rect.left > innerWidth * 0.4,
      )
      .map((rect) => rect.left);

    const boundaries = [...separators, ...panels];
    return boundaries.length ? Math.min(...boundaries) : null;
  }

  function isTaskView() {
    const activeThread = document.querySelector(
      '[data-app-action-sidebar-thread-row][data-app-action-sidebar-thread-active="true"]',
    );
    const visibleConversation = [...document.querySelectorAll(
      '[data-thread-find-target="conversation"]',
    )].some((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        rect.width > 100 && rect.height > 40 &&
        style.display !== 'none' && style.visibility !== 'hidden' &&
        clean(element.textContent).length > 0
      );
    });
    return Boolean(activeThread || visibleConversation || state.routingFromVertical);
  }

  function nativePreviewOverlapsVerticalTabs() {
    const panelBounds = { left: 64, right: 240, top: 44, bottom: innerHeight };
    return [...document.querySelectorAll(
      '[role="dialog"], [role="menu"], [role="listbox"], [role="tree"], [role="tooltip"], ' +
        '[data-radix-popper-content-wrapper], [data-state="open"], ' +
        '[class*="popover" i], [class*="preview" i]',
    )].some((element) => {
      if (element.closest(`#${ROOT_ID}, #${TOOLTIP_ID}, #${REOPEN_ID}, #${MIRROR_ID}`)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (
        rect.width < 100 || rect.height < 48 || style.display === 'none' ||
        style.visibility === 'hidden' || style.pointerEvents === 'none'
      ) return false;
      return (
        rect.left < panelBounds.right && rect.right > panelBounds.left &&
        rect.top < panelBounds.bottom && rect.bottom > panelBounds.top
      );
    });
  }

  function armDirectoryPreview() {
    state.previewHoldUntil = Date.now() + 900;
    clearTimeout(state.previewTimer);
    state.previewTimer = setTimeout(() => {
      state.previewTimer = 0;
      render();
    }, 920);
    render();
  }

  function isDirectoryTrigger(target) {
    const control = target.closest?.('button, [role="button"], a');
    if (!control || control.closest(`#${ROOT_ID}, #${REOPEN_ID}`)) return false;
    const description = clean(
      control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent,
    );
    return /^(项目|project)\s*[:：]|目录|directory|workspace|工作区/i.test(description);
  }

  function compactNumber(value) {
    if (!Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('zh-CN', {
      notation: value >= 1000 ? 'compact' : 'standard',
      maximumFractionDigits: value >= 1000 ? 1 : 0,
    }).format(value);
  }

  function percent(value, total) {
    if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return null;
    return Math.max(0, Math.min(100, (value / total) * 100));
  }

  function tooltip() {
    let element = document.getElementById(TOOLTIP_ID);
    if (!element) {
      element = document.createElement('aside');
      element.id = TOOLTIP_ID;
      element.hidden = true;
      element.setAttribute('role', 'tooltip');
      document.body.appendChild(element);
    }
    return element;
  }

  function addTooltipRow(grid, label, value) {
    const name = document.createElement('span');
    name.className = 'ct-tip-label';
    name.textContent = label;
    const detail = document.createElement('span');
    detail.className = 'ct-tip-value';
    detail.textContent = value;
    grid.append(name, detail);
  }

  function elapsedText(startedAt) {
    const start = typeof startedAt === 'number' ? startedAt : Date.parse(startedAt || '');
    if (!Number.isFinite(start)) return '';
    const total = Math.max(0, Math.floor((Date.now() - start) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (settings().appLanguage === 'en') {
      if (hours) return `${hours}h ${minutes}m ${seconds}s`;
      if (minutes) return `${minutes}m ${seconds}s`;
      return `${seconds}s`;
    }
    if (hours) return `${hours}小时${minutes}分${seconds}秒`;
    if (minutes) return `${minutes}分${seconds}秒`;
    return `${seconds}秒`;
  }

  function currentStep(activity) {
    const value = clean(activity);
    if (settings().appLanguage === 'en') {
      const translated = value
        .replace(/^正在执行命令\s*[·:：]?\s*/u, 'Running ')
        .replace(/^正在修改代码/u, 'Editing code')
        .replace(/^正在查看图片/u, 'Viewing an image')
        .replace(/^正在生成图片/u, 'Generating an image')
        .replace(/^正在查询网络资料/u, 'Searching the web')
        .replace(/^正在处理工具结果/u, 'Processing tool results')
        .replace(/^正在调用工具/u, 'Using a tool')
        .replace(/^正在思考/u, 'Thinking')
        .replace(/^正在撰写回复/u, 'Writing a response')
        .replace(/^正在准备任务/u, 'Preparing the task');
      return translated || 'Waiting for a status update';
    }
    return value.replace(/^正在执行命令\s*[·:：]?\s*/u, '执行 ')
      .replace(/^正在/u, '') || '等待状态更新';
  }

  function showTooltip(tab, anchor) {
    const preferences = settings();
    const hasPreviewContent = [
      'previewShowTitle', 'previewShowStatus', 'previewShowActivity',
      'previewShowTotalTokens', 'previewShowInputTokens', 'previewShowOutputTokens',
      'previewShowCache', 'previewShowContext', 'previewShowQuota', 'previewShowProgressBar',
    ].some((key) => preferences[key]);
    if (!preferences.showUsage || !hasPreviewContent) {
      hideTooltip();
      return;
    }
    const tip = tooltip();
    const usageId = usageIdOf(tab.id);
    const usage = globalThis.__CODEX_TABS_USAGE__?.[usageId];
    tip.replaceChildren();

    const title = document.createElement('div');
    title.className = 'ct-tip-title';
    title.textContent = tab.title;
    const status = document.createElement('div');
    status.className = 'ct-tip-status';
    const dot = document.createElement('span');
    dot.className = 'ct-status';
    const working = tab.status === 'working' || usage?.taskState === 'working';
    if (working) {
      const exactStart = Date.parse(usage?.taskStartedAt || '');
      if (Number.isFinite(exactStart)) state.runningSince.set(tab.id, exactStart);
      else if (!state.runningSince.has(tab.id)) state.runningSince.set(tab.id, Date.now());
    } else {
      state.runningSince.delete(tab.id);
    }
    dot.dataset.status = working ? 'working' : 'done';
    const statusText = document.createElement('span');
    const elapsed = working ? elapsedText(state.runningSince.get(tab.id)) : '';
    statusText.textContent = working && elapsed
      ? `${tr('正在运行', 'Running')}, ${elapsed}`
      : working ? tr('正在运行', 'Running') : tr('空闲', 'Idle');
    status.append(dot, statusText);
    if (preferences.previewShowTitle) tip.appendChild(title);
    if (preferences.previewShowStatus) tip.appendChild(status);

    if (preferences.previewShowActivity && (working || usage?.activity)) {
      const activity = document.createElement('div');
      activity.className = 'ct-tip-activity';
      const activityValue = document.createElement('span');
      activityValue.className = 'ct-tip-activity-value';
      const step = working ? currentStep(usage.activity) : tr('已完成，等待新消息', 'Complete, waiting for a new message');
      activityValue.textContent = working ? `${tr('当前步骤', 'Current step')}: ${step}` : step;
      activityValue.title = activityValue.textContent;
      activity.appendChild(activityValue);
      tip.appendChild(activity);
    }

    if (usage) {
      const grid = document.createElement('div');
      grid.className = 'ct-tip-grid';
      const total = usage.total || {};
      const last = usage.last || {};
      const contextUse = last.input_tokens;
      const contextPercent = percent(contextUse, usage.contextWindow);
      const cachePercent = percent(total.cached_input_tokens, total.input_tokens);
      const quotaComparable = usage.quotaDelta !== null && usage.quotaDelta !== undefined;
      const uncachedInput = Number.isFinite(total.input_tokens) && Number.isFinite(total.cached_input_tokens)
        ? Math.max(0, total.input_tokens - total.cached_input_tokens)
        : null;
      if (preferences.previewShowTotalTokens) {
        addTooltipRow(grid, tr('累计 Token', 'Total Tokens'), compactNumber(total.total_tokens));
      }
      if (preferences.previewShowInputTokens) {
        addTooltipRow(grid, tr('累计输入', 'Total Input'), compactNumber(total.input_tokens));
        addTooltipRow(grid, tr('非缓存输入', 'Uncached Input'), compactNumber(uncachedInput));
      }
      if (preferences.previewShowOutputTokens) {
        addTooltipRow(grid, tr('累计输出', 'Total Output'), compactNumber(total.output_tokens));
      }
      if (preferences.previewShowCache) {
        addTooltipRow(
          grid,
          tr('缓存输入', 'Cached Input'),
          `${compactNumber(total.cached_input_tokens)}${cachePercent === null ? '' : ` · ${cachePercent.toFixed(0)}%`}`,
        );
      }
      if (preferences.previewShowContext) {
        addTooltipRow(
          grid,
          tr('当前上下文', 'Current Context'),
          `${compactNumber(contextUse)} / ${compactNumber(usage.contextWindow)}`,
        );
        addTooltipRow(
          grid,
          tr('Token 使用率', 'Token Usage'),
          contextPercent === null ? '—' : `${contextPercent.toFixed(1)}%`,
        );
      }
      if (preferences.previewShowQuota && quotaComparable) {
        const start = 100 - usage.startingRateLimit.used_percent;
        const current = 100 - usage.rateLimit.used_percent;
        const remainingDelta = -usage.quotaDelta;
        addTooltipRow(
          grid,
          tr('本对话额度变化', 'Conversation Quota Change'),
          `${tr('约', 'Approx.')} ${remainingDelta > 0 ? '+' : ''}${remainingDelta.toFixed(0)}%`,
        );
        addTooltipRow(grid, tr('账号剩余额度', 'Account Quota Remaining'), `${start.toFixed(0)}% → ${current.toFixed(0)}%`);
      } else if (preferences.previewShowQuota && (
        Number.isFinite(usage.startingRateLimit?.used_percent) &&
        Number.isFinite(usage.rateLimit?.used_percent)
      )) {
        addTooltipRow(grid, tr('本对话额度变化', 'Conversation Quota Change'), tr('跨额度周期，无法估算', 'Unavailable across quota periods'));
      }
      if (grid.childElementCount) tip.appendChild(grid);
      if (preferences.previewShowProgressBar && contextPercent !== null) {
        const bar = document.createElement('div');
        bar.className = 'ct-tip-bar';
        const fill = document.createElement('div');
        fill.className = 'ct-tip-fill';
        fill.style.width = `${contextPercent}%`;
        bar.appendChild(fill);
        tip.appendChild(bar);
        const note = document.createElement('div');
        note.className = 'ct-tip-note';
        note.textContent = preferences.previewShowQuota && quotaComparable
          ? tr(
              `上下文占用 ${contextPercent.toFixed(1)}% · 额度变化为账号级估算，并行任务会计入`,
              `Context usage ${contextPercent.toFixed(1)}% · Quota change is an account-level estimate and includes parallel tasks`,
            )
          : tr(
              `上下文占用 ${contextPercent.toFixed(1)}% · 数据来自本地会话记录`,
              `Context usage ${contextPercent.toFixed(1)}% · Data comes from local session records`,
            );
        tip.appendChild(note);
      }
    } else if (
      preferences.previewShowTotalTokens || preferences.previewShowInputTokens ||
      preferences.previewShowOutputTokens || preferences.previewShowCache ||
      preferences.previewShowContext || preferences.previewShowQuota ||
      preferences.previewShowProgressBar
    ) {
      const note = document.createElement('div');
      note.className = 'ct-tip-note';
      note.textContent = tr(
        '暂无 token 记录；保持 Codex Tabs 注入器运行即可同步。',
        'No token data yet. Keep the Codex Tabs injector running to sync usage.',
      );
      tip.appendChild(note);
    }

    tip.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const vertical = document.getElementById(ROOT_ID)?.dataset.orientation === 'vertical';
    tip.style.left = `${vertical ? Math.min(rect.right + 8, innerWidth - tipRect.width - 8) : Math.max(8, Math.min(rect.left, innerWidth - tipRect.width - 8))}px`;
    tip.style.top = `${vertical ? Math.max(8, Math.min(rect.top, innerHeight - tipRect.height - 8)) : rect.bottom + 8}px`;
    clearTimeout(state.tooltipTimer);
    state.tooltipTimer = working
      ? setTimeout(() => {
          if (state.hoveredTab?.id === tab.id && state.hoveredAnchor?.isConnected) {
            showTooltip(state.hoveredTab, state.hoveredAnchor);
          }
        }, 1000)
      : 0;
  }

  function hideTooltip() {
    clearTimeout(state.tooltipTimer);
    state.tooltipTimer = 0;
    const tip = document.getElementById(TOOLTIP_ID);
    if (tip) tip.hidden = true;
  }

  function onUsageUpdated() {
    if (settings().showUsage && state.hoveredTab && state.hoveredAnchor?.isConnected) {
      showTooltip(state.hoveredTab, state.hoveredAnchor);
    }
  }

  function createTab(tab) {
    const button = document.createElement('div');
    button.className = 'ct-tab';
    button.dataset.active = String(tab.active);
    button.dataset.id = tab.id;
    button.draggable = false;
    button.setAttribute('aria-label', tab.title);
    button.setAttribute('role', 'button');
    button.setAttribute('tabindex', '0');

    const status = document.createElement('span');
    status.className = 'ct-status';
    status.dataset.status = tab.status;
    status.hidden = !tab.status;
    const title = document.createElement('span');
    title.className = 'ct-title';
    title.textContent = tab.title;
    const close = document.createElement('button');
    close.className = 'ct-close';
    close.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    close.title = tr('关闭标签页（任务仍保留在侧边栏）', 'Close tab (the task remains in the sidebar)');
    close.addEventListener('pointerdown', (event) => event.stopPropagation());
    close.addEventListener('mousedown', (event) => event.stopPropagation());
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      closeTab(tab);
    });
    const split = document.createElement('button');
    split.className = 'ct-split';
    split.textContent = '◫';
    split.title = tr('在右侧实时打开此任务', 'Open this task live on the right');
    split.addEventListener('pointerdown', (event) => event.stopPropagation());
    split.addEventListener('mousedown', (event) => event.stopPropagation());
    split.addEventListener('click', (event) => {
      event.stopPropagation();
      openInlineThread(tab);
    });
    button.append(status, title, split, close);
    let pressTimer = 0;
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let latestX = 0;
    let latestY = 0;
    let ghost = null;
    let grabOffsetX = 0;
    let grabOffsetY = 0;

    const clearPress = () => {
      clearTimeout(pressTimer);
      pressTimer = 0;
      button.classList.remove('ct-pressing');
    };

    const moveGhost = (clientX, clientY) => {
      if (!ghost) return;
      ghost.style.left = `${clientX - grabOffsetX}px`;
      ghost.style.top = `${clientY - grabOffsetY}px`;
    };

    const createGhost = () => {
      document.querySelectorAll('.ct-drag-ghost').forEach((element) => element.remove());
      const rect = button.getBoundingClientRect();
      grabOffsetX = startX - rect.left;
      grabOffsetY = startY - rect.top;
      ghost = button.cloneNode(true);
      ghost.classList.remove('ct-pressing', 'ct-dragging');
      ghost.classList.add('ct-drag-ghost');
      ghost.removeAttribute('role');
      ghost.removeAttribute('tabindex');
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      ghost.querySelector('.ct-close')?.setAttribute('disabled', '');
      document.body.appendChild(ghost);
      moveGhost(latestX, latestY);
    };

    const reorderAt = (clientX, clientY) => {
      const root = document.getElementById(ROOT_ID);
      if (!root) return;
      const rootRect = root.getBoundingClientRect();
      const vertical = root.dataset.orientation === 'vertical';
      if (vertical) {
        if (clientY < rootRect.top + 32) root.scrollTop -= 14;
        if (clientY > rootRect.bottom - 32) root.scrollTop += 14;
      } else {
        if (clientX < rootRect.left + 32) root.scrollLeft -= 14;
        if (clientX > rootRect.right - 32) root.scrollLeft += 14;
      }
      const siblings = [...root.querySelectorAll('.ct-tab')].filter((item) => item !== button);
      const before = siblings.find((item) => {
        const rect = item.getBoundingClientRect();
        return vertical
          ? clientY < rect.top + rect.height / 2
          : clientX < rect.left + rect.width / 2;
      });
      root.insertBefore(button, before || root.querySelector('.ct-spacer, .ct-reopen, .ct-new'));
    };

    const finishDrag = (event, shouldActivate) => {
      clearPress();
      if (dragging) {
        const root = document.getElementById(ROOT_ID);
        const ids = [...root.querySelectorAll('.ct-tab')].map((item) => item.dataset.id);
        const previous = loadOrder();
        saveOrder([...ids, ...previous.filter((id) => !ids.includes(id))]);
        button.classList.remove('ct-dragging');
        ghost?.remove();
        ghost = null;
        state.dragId = null;
        dragging = false;
        render();
      } else if (shouldActivate && !moved) {
        activate(tab);
      }
      removeEventListener('mousemove', onMouseMove, true);
      removeEventListener('mouseup', onMouseUp, true);
      removeEventListener('blur', onWindowBlur);
      state.activeDragCleanup = null;
      event?.preventDefault();
      event?.stopPropagation();
    };

    const onMouseMove = (event) => {
      latestX = event.clientX;
      latestY = event.clientY;
      const distance = Math.hypot(event.clientX - startX, event.clientY - startY);
      if (distance > 6) moved = true;
      if (!dragging) return;
      event.preventDefault();
      moveGhost(event.clientX, event.clientY);
      reorderAt(event.clientX, event.clientY);
    };

    const onMouseUp = (event) => finishDrag(event, true);
    const onWindowBlur = () => finishDrag(null, false);

    button.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || event.target.closest('.ct-close, .ct-split')) return;
      if (!settings().enableDrag) {
        event.preventDefault();
        activate(tab);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      startX = event.clientX;
      startY = event.clientY;
      latestX = event.clientX;
      latestY = event.clientY;
      moved = false;
      addEventListener('mousemove', onMouseMove, true);
      addEventListener('mouseup', onMouseUp, true);
      addEventListener('blur', onWindowBlur);
      state.activeDragCleanup = () => finishDrag(null, false);
      button.classList.add('ct-pressing');
      pressTimer = setTimeout(() => {
        pressTimer = 0;
        dragging = true;
        state.dragId = tab.id;
        button.classList.remove('ct-pressing');
        button.classList.add('ct-dragging');
        hideTooltip();
        createGhost();
        reorderAt(latestX, latestY);
      }, 350);
    });
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') activate(tab);
    });
    button.addEventListener('mouseenter', () => {
      if (!settings().showUsage) return;
      state.hoveredTab = tab;
      state.hoveredAnchor = button;
      showTooltip(tab, button);
    });
    button.addEventListener('mouseleave', () => {
      state.hoveredTab = null;
      state.hoveredAnchor = null;
      hideTooltip();
    });
    return button;
  }

  function render() {
    cancelAnimationFrame(state.frame);
    state.frame = requestAnimationFrame(() => {
      if (state.dragId) return;
      ensureStyle();
      const inlinePanel = document.getElementById(MIRROR_ID);
      if (inlinePanel) applyPanelWidth(inlinePanel);
      const discoveredTabs = findTabs();
      if (discoveredTabs.length) cacheDiscoveredTabs(discoveredTabs);
      state.sourceTabs = discoveredTabs.length
        ? discoveredTabs
        : [...state.cachedTabs.values()];
      const discoveredNewTask = findNewTaskControl();
      if (discoveredNewTask) state.newTaskControl = discoveredNewTask;
      const newTask = discoveredNewTask || state.newTaskControl;
      let root = document.getElementById(ROOT_ID);
      if (!root) {
        root = document.createElement('nav');
        root.id = ROOT_ID;
        root.setAttribute('aria-label', tr('Codex 任务标签', 'Codex Task Tabs'));
        document.body.appendChild(root);
      }
      if (!isTaskView()) {
        if (state.taskViewSticky) {
          state.taskViewSticky = false;
          saveTabHistory();
        }
        hideReopenMenu();
        root.hidden = true;
        hideTooltip();
        return;
      }
      if (!state.taskViewSticky) {
        state.taskViewSticky = true;
        saveTabHistory();
      }
      root.hidden = false;
      const preferences = settings();
      const collapsed = sidebarCollapsed();
      if (collapsed && !preferences.showVerticalPanel) {
        root.hidden = true;
        hideTooltip();
        return;
      }
      root.dataset.orientation = collapsed ? 'vertical' : 'horizontal';
      root.dataset.inlineEnabled = String(preferences.enableInlinePanel);
      root.dataset.activeHighlight = String(preferences.activeHighlight);
      root.style.setProperty('--ct-vertical-width', `${settingNumber(preferences.verticalWidth, 176, 140, 320)}px`);
      root.style.setProperty('--ct-vertical-top', `${settingNumber(preferences.verticalTop, 52, 44, 180)}px`);
      root.style.setProperty('--ct-vertical-bottom', `${settingNumber(preferences.verticalBottom, 12, 0, 120)}px`);
      root.style.setProperty('--ct-vertical-radius', `${settingNumber(preferences.verticalRadius, 11, 0, 28)}px`);
      root.style.setProperty('--ct-active-color', settingColor(preferences.activeColor));
      root.style.setProperty('--ct-active-bg', `${settingNumber(preferences.activeBackgroundOpacity, 0.07, 0, 0.4) * 100}%`);
      root.style.setProperty('--ct-active-border', `${settingNumber(preferences.activeBorderOpacity, 0.38, 0, 1) * 100}%`);
      root.style.setProperty('--ct-active-shadow', `${settingNumber(preferences.activeShadowOpacity, 0.12, 0, 0.6) * 100}%`);
      root.style.setProperty('--ct-tab-radius', `${settingNumber(preferences.tabRadius, 7, 0, 18)}px`);
      root.style.setProperty('--ct-panel-opacity', `${settingNumber(preferences.panelOpacity, 1, 0.65, 1) * 100}%`);
      root.dataset.nativePreview = String(
        preferences.autoHideDirectoryPreview && root.dataset.orientation === 'vertical' &&
        (Date.now() < state.previewHoldUntil || nativePreviewOverlapsVerticalTabs()),
      );
      updateLayout(root);
      root.replaceChildren();
      root.dataset.empty = String(state.sourceTabs.length === 0);
      if (!state.sourceTabs.length) {
        const empty = document.createElement('span');
        empty.className = 'ct-empty';
        empty.textContent = tr('Codex Tabs：暂未识别到侧边栏任务', 'Codex Tabs: No sidebar tasks detected');
        root.appendChild(empty);
        return;
      }
      const shownTabs = visibleTabs();
      if (root.dataset.orientation === 'vertical') {
        const heading = document.createElement('div');
        heading.className = 'ct-vertical-heading';
        heading.innerHTML = `<span>${tr('任务标签', 'Task Tabs')}</span><span class="ct-vertical-count"></span>`;
        heading.querySelector('.ct-vertical-count').textContent = String(shownTabs.length);
        root.appendChild(heading);
      }
      for (const tab of shownTabs) root.appendChild(createTab(tab));
      const recentlyClosed = hiddenTabs();
      if (root.dataset.orientation === 'vertical' && (recentlyClosed.length || newTask)) {
        const spacer = document.createElement('span');
        spacer.className = 'ct-spacer';
        root.appendChild(spacer);
      }
      if (recentlyClosed.length) {
        const reopen = document.createElement('button');
        reopen.className = 'ct-reopen';
        reopen.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        reopen.title = tr(
          `重新打开已关闭的标签页（${recentlyClosed.length}）`,
          `Reopen closed tabs (${recentlyClosed.length})`,
        );
        reopen.setAttribute('aria-label', reopen.title);
        reopen.addEventListener('click', (event) => {
          event.stopPropagation();
          showReopenMenu(reopen);
        });
        root.appendChild(reopen);
      }
      if (newTask) {
        const add = document.createElement('button');
        add.className = 'ct-new';
        add.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
        add.title = tr('新建任务', 'New Task');
        add.addEventListener('click', () => newTask.click());
        root.appendChild(add);
      }
    });
  }

  function onKeydown(event) {
    if (event.key === 'Escape' && state.previewHoldUntil) {
      state.previewHoldUntil = 0;
      clearTimeout(state.previewTimer);
      state.previewTimer = 0;
      setTimeout(render, 0);
    }
    if (!settings().enableShortcuts || event.metaKey || !event.ctrlKey || event.altKey) return;
    if (!event.shiftKey && /^[1-9]$/.test(event.key)) {
      const tab = visibleTabs()[Number(event.key) - 1];
      if (!tab) return;
      event.preventDefault();
      activate(tab);
    } else if (event.shiftKey && event.key.toLowerCase() === 't') {
      const tab = hiddenTabs()[0];
      if (!tab) return;
      event.preventDefault();
      restoreLastClosed();
    } else if (!event.shiftKey && event.key.toLowerCase() === 'w') {
      const active = visibleTabs().find((tab) => tab.active);
      if (!active) return;
      event.preventDefault();
      closeTab(active);
    }
  }

  function onSidebarPointerDown(event) {
    if (settings().autoHideDirectoryPreview && isDirectoryTrigger(event.target)) armDirectoryPreview();
    const row = event.target.closest?.('[data-app-action-sidebar-thread-row]');
    const id = row?.getAttribute('data-app-action-sidebar-thread-id');
    if (!id) {
      const navigation = event.target.closest?.(
        'aside a[href], nav a[href], [role="navigation"] a[href]',
      );
      if (navigation && !navigation.closest(`#${ROOT_ID}, #${REOPEN_ID}`)) {
        const rect = navigation.getBoundingClientRect();
        if (rect.left < Math.min(420, innerWidth * 0.35)) {
          state.taskViewSticky = false;
          saveTabHistory();
          render();
        }
      }
      return;
    }
    state.taskViewSticky = true;
    const hidden = loadHidden();
    if (!hidden.delete(id)) return;
    saveHidden(hidden);
    render();
  }

  hydrateTabHistory();

  const hackSelector = `#${ROOT_ID}, #${TOOLTIP_ID}, #${MIRROR_ID}, #${REOPEN_ID}`;
  state.observer = new MutationObserver((mutations) => {
    const belongsToHack = (mutation) => {
      if (mutation.target.closest?.(hackSelector)) return true;
      const changed = [...mutation.addedNodes, ...mutation.removedNodes].filter(
        (node) => node instanceof Element,
      );
      return changed.length > 0 && changed.every(
        (node) => node.matches?.(hackSelector) || node.closest?.(hackSelector),
      );
    };
    if (mutations.every(belongsToHack)) return;
    render();
  });
  state.observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      'aria-selected', 'aria-current', 'aria-label', 'data-state', 'data-status', 'class',
      'data-app-action-sidebar-thread-active', 'aria-expanded', 'style', 'hidden',
    ],
  });
  addEventListener('keydown', onKeydown, true);
  addEventListener('resize', render);
  addEventListener('pointerdown', onSidebarPointerDown, true);
  addEventListener('codex-tabs-usage-updated', onUsageUpdated);
  addEventListener('codex-tabs-config-updated', render);

  globalThis.__CODEX_TABS_HACK__ = {
    version: VERSION,
    render,
    count: () => state.sourceTabs.length,
    usageIds: () => [...new Set(
      [...state.cachedTabs.keys(), ...state.sourceTabs.map((tab) => tab.id)]
        .map(usageIdOf)
        .filter(Boolean),
    )],
    destroy() {
      state.activeDragCleanup?.();
      saveTabHistory();
      clearTimeout(state.tooltipTimer);
      clearTimeout(state.previewTimer);
      hideReopenMenu();
      state.observer?.disconnect();
      cancelAnimationFrame(state.frame);
      removeEventListener('keydown', onKeydown, true);
      removeEventListener('resize', render);
      removeEventListener('pointerdown', onSidebarPointerDown, true);
      removeEventListener('codex-tabs-usage-updated', onUsageUpdated);
      removeEventListener('codex-tabs-config-updated', render);
      closeInlinePanel();
      document.getElementById(ROOT_ID)?.remove();
      document.getElementById(STYLE_ID)?.remove();
      document.getElementById(TOOLTIP_ID)?.remove();
      document.getElementById(MIRROR_ID)?.remove();
      document.getElementById(REOPEN_ID)?.remove();
      document.querySelectorAll('.ct-drag-ghost').forEach((element) => element.remove());
      delete globalThis.__CODEX_TABS_HACK__;
    },
  };

  render();
  return { version: VERSION, count: findTabs().length };
})();
