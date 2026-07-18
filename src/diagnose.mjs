import { CdpPage, listTargets } from './cdp.mjs';
import { readFile } from 'node:fs/promises';
import { UsageReader } from './usage.mjs';

const port = Number(process.argv[2]);
if (!Number.isInteger(port)) {
  console.error('用法：node src/diagnose.mjs <port>');
  process.exit(1);
}

const targets = await listTargets(port);
const target = targets.find((item) => item.title === 'Codex') || targets[0];
if (!target) throw new Error('没有找到 Codex 页面');

const page = await new CdpPage(target.webSocketDebuggerUrl).connect();
const mode = process.argv[3];
if (mode === 'targets') {
  const details = [];
  page.close();
  for (const item of targets) {
    const current = await new CdpPage(item.webSocketDebuggerUrl).connect();
    const state = await current.evaluate(`(() => {
      const active = document.querySelector(
        '[data-app-action-sidebar-thread-row][data-app-action-sidebar-thread-active="true"]',
      );
      return {
        focused: document.hasFocus(),
        activeId: active?.getAttribute('data-app-action-sidebar-thread-id') || null,
        activeTitle: active?.getAttribute('data-app-action-sidebar-thread-title') || null,
        version: globalThis.__CODEX_TABS_HACK__?.version || null,
      };
    })()`);
    details.push({ id: item.id, title: item.title, url: item.url, ...state });
    current.close();
  }
  console.log(JSON.stringify(details, null, 2));
  process.exit(0);
}
if (mode === 'open-thread') {
  const id = String(process.argv[4] || '');
  const serialized = JSON.stringify(id);
  const opened = await page.evaluate(`(() => {
    const row = [...document.querySelectorAll('[data-app-action-sidebar-thread-row]')]
      .find((item) => item.getAttribute('data-app-action-sidebar-thread-id') === ${serialized});
    row?.click();
    return Boolean(row);
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 350));
  const active = await page.evaluate(`(() => {
    const row = document.querySelector(
      '[data-app-action-sidebar-thread-row][data-app-action-sidebar-thread-active="true"]',
    );
    return {
      id: row?.getAttribute('data-app-action-sidebar-thread-id') || null,
      title: row?.getAttribute('data-app-action-sidebar-thread-title') || null,
    };
  })()`);
  console.log(JSON.stringify({ opened, active }, null, 2));
  page.close();
  process.exit(0);
}
const inspectItems = mode === 'items';
const expression = mode === 'inject'
  ? await readFile(new URL('./injected.js', import.meta.url), 'utf8')
  : mode === 'panes'
  ? `(() => [...document.querySelectorAll('button, [role], [data-testid], [aria-label], [data-panel], [data-pane]')]
      .filter((element) => !element.closest('#codex-tabs-hack-root'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          text: String(element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 100),
          x: Math.round(rect.x), y: Math.round(rect.y),
          w: Math.round(rect.width), h: Math.round(rect.height),
          role: element.getAttribute('role'),
          label: element.getAttribute('aria-label'),
          testid: element.getAttribute('data-testid'),
          panel: element.getAttribute('data-panel'),
          pane: element.getAttribute('data-pane'),
          orientation: element.getAttribute('aria-orientation'),
        };
      })
      .filter((item) => item.w > 8 && item.h > 8 && (
        item.x > innerWidth * .42 || item.y > innerHeight * .55 ||
        /browser|terminal|file|review|panel|pane|浏览器|终端|文件|审查|侧栏|底栏/i.test(
          [item.text, item.label, item.testid, item.panel, item.pane].filter(Boolean).join(' '),
        )
      ))
      .slice(0, 350))()`
  : mode === 'pane-tree'
  ? `(() => {
      const target = [...document.querySelectorAll('button')].find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.x > innerWidth * .7 && /^(输出|Output)$/.test(
          String(element.textContent || '').trim(),
        );
      });
      if (!target) return null;
      const ancestors = [];
      let current = target;
      for (let depth = 0; current && depth < 9; depth += 1, current = current.parentElement) {
        const rect = current.getBoundingClientRect();
        ancestors.push({
          depth,
          tag: current.tagName.toLowerCase(),
          id: current.id,
          class: String(current.className || '').slice(0, 500),
          role: current.getAttribute('role'),
          label: current.getAttribute('aria-label'),
          x: Math.round(rect.x), y: Math.round(rect.y),
          w: Math.round(rect.width), h: Math.round(rect.height),
          children: current.children.length,
        });
      }
      return { ancestors, parentHtml: target.parentElement?.parentElement?.outerHTML.slice(0, 16000) };
    })()`
  : mode === 'usage'
  ? `[...document.querySelectorAll('[data-app-action-sidebar-thread-id]')]
      .map((element) => element.getAttribute('data-app-action-sidebar-thread-id'))
      .filter(Boolean)`
  : mode === 'tooltip'
  ? `(() => {
      const tab = document.querySelector('#codex-tabs-hack-root .ct-tab[data-active="true"]')
        || document.querySelector('#codex-tabs-hack-root .ct-tab');
      if (!tab) return null;
      tab.dispatchEvent(new MouseEvent('mouseenter'));
      const tip = document.getElementById('codex-tabs-hack-tooltip');
      const rect = tip?.getBoundingClientRect();
      return {
        hidden: tip?.hidden,
        text: tip?.innerText,
        x: Math.round(rect?.x || 0), y: Math.round(rect?.y || 0),
        width: Math.round(rect?.width || 0), height: Math.round(rect?.height || 0),
      };
    })()`
  : mode === 'gesture'
  ? `(() => ({
      order: [...document.querySelectorAll('#codex-tabs-hack-root .ct-tab')]
        .map((item) => item.dataset.id),
      savedOrder: localStorage.getItem('codex-tabs-hack-order-v1'),
      rects: [...document.querySelectorAll('#codex-tabs-hack-root .ct-tab')]
        .slice(0, 3)
        .map((item) => {
          const rect = item.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }),
    }))()`
  : mode === 'active-style'
  ? `(() => ({
      sourceActive: [...document.querySelectorAll('[data-app-action-sidebar-thread-row]')]
        .filter((item) => item.getAttribute('data-app-action-sidebar-thread-active') === 'true')
        .map((item) => ({
          id: item.getAttribute('data-app-action-sidebar-thread-id'),
          title: item.getAttribute('data-app-action-sidebar-thread-title'),
        })),
      tabs: [...document.querySelectorAll('#codex-tabs-hack-root .ct-tab')].map((item) => {
        const style = getComputedStyle(item);
        return {
          title: item.getAttribute('aria-label'), active: item.dataset.active,
          background: style.backgroundColor, border: style.borderColor,
          shadow: style.boxShadow, weight: style.fontWeight, transform: style.transform,
        };
      }),
    }))()`
  : mode === 'header'
  ? `(() => [...document.querySelectorAll('body *')]
      .filter((element) => !element.closest('#codex-tabs-hack-root'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          text: String(element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 100),
          x: Math.round(rect.x), y: Math.round(rect.y),
          w: Math.round(rect.width), h: Math.round(rect.height),
          label: element.getAttribute('aria-label'),
          title: element.getAttribute('data-thread-title'),
        };
      })
      .filter((item) => item.y >= 0 && item.y < 46 && item.h > 10 && item.w > 10 && item.w < innerWidth)
      .slice(0, 120))()`
  : mode === 'layout'
  ? `(() => {
      const root = document.getElementById('codex-tabs-hack-root');
      if (!root) return null;
      const rect = root.getBoundingClientRect();
      return {
        version: globalThis.__CODEX_TABS_HACK__?.version,
        x: Math.round(rect.x), y: Math.round(rect.y),
        width: Math.round(rect.width), height: Math.round(rect.height),
        tabs: root.querySelectorAll('.ct-tab').length,
      };
    })()`
  : inspectItems
  ? `(() => [...document.querySelectorAll('[role="list"][aria-label] > [role="listitem"]')]
      .slice(0, 3)
      .map((element) => element.outerHTML.slice(0, 12000)))()`
  : `(() => {
  const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 160);
  return [...document.querySelectorAll('a, button, [role], [data-testid], [aria-label]')]
    .filter((element) => !element.closest('#codex-tabs-hack-root'))
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName.toLowerCase(),
        text: clean(element.textContent),
        x: Math.round(rect.x), y: Math.round(rect.y),
        w: Math.round(rect.width), h: Math.round(rect.height),
        role: element.getAttribute('role'),
        label: element.getAttribute('aria-label'),
        current: element.getAttribute('aria-current'),
        selected: element.getAttribute('aria-selected'),
        state: element.getAttribute('data-state'),
        testid: element.getAttribute('data-testid'),
        href: element.getAttribute('href'),
      };
    })
    .filter((item) => item.x < Math.min(600, innerWidth * .55) && item.w > 10 && item.h > 8)
    .slice(0, 300);
})()`;
let result = await page.evaluate(expression);
if (mode === 'gesture' && result.rects.length >= 3) {
  const start = result.rects[0];
  const target = result.rects[2];
  const startPoint = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  const targetPoint = { x: target.x + target.width * 0.75, y: target.y + target.height / 2 };
  await page.evaluate(`
    document.querySelector('#codex-tabs-hack-root .ct-tab')?.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, button: 0, buttons: 1,
        clientX: ${startPoint.x}, clientY: ${startPoint.y},
      }),
    )
  `);
  await new Promise((resolve) => setTimeout(resolve, 420));
  await page.evaluate(`
    dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, cancelable: true, button: 0, buttons: 1,
      clientX: ${targetPoint.x}, clientY: ${targetPoint.y},
    }))
  `);
  await new Promise((resolve) => setTimeout(resolve, 60));
  const ghost = await page.evaluate(`(() => {
    const element = document.querySelector('.ct-drag-ghost');
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width),
      opacity: getComputedStyle(element).opacity,
      inlineLeft: element.style.left, inlineTop: element.style.top, inlineWidth: element.style.width,
      text: element.textContent,
    };
  })()`);
  await page.evaluate(`
    dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true, cancelable: true, button: 0, buttons: 0,
      clientX: ${targetPoint.x}, clientY: ${targetPoint.y},
    }))
  `);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const after = await page.evaluate(
    `[...document.querySelectorAll('#codex-tabs-hack-root .ct-tab')].map((item) => item.dataset.id)`,
  );
  const saved = JSON.stringify(result.savedOrder);
  await page.evaluate(`
    ${result.savedOrder === null
      ? `localStorage.removeItem('codex-tabs-hack-order-v1')`
      : `localStorage.setItem('codex-tabs-hack-order-v1', ${saved})`};
    globalThis.__CODEX_TABS_HACK__?.render();
  `);
  result = {
    before: result.order,
    after,
    changed: result.order.join('|') !== after.join('|'),
    initialRects: result.rects,
    ghost,
  };
} else if (mode === 'usage') {
  const usage = await new UsageReader().getMany(result);
  const serialized = JSON.stringify(usage).replaceAll('<', '\\u003c');
  await page.evaluate(`
    globalThis.__CODEX_TABS_USAGE__ = ${serialized};
    dispatchEvent(new Event('codex-tabs-usage-updated'));
  `);
  result = Object.fromEntries(Object.entries(usage).map(([id, item]) => [id, {
    totalTokens: item.total?.total_tokens,
    contextTokens: item.last?.input_tokens,
    contextWindow: item.contextWindow,
    activity: item.activity,
    quotaStart: item.startingRateLimit?.used_percent,
    quotaCurrent: item.rateLimit?.used_percent,
    quotaDelta: item.quotaDelta,
  }]));
}
console.log(JSON.stringify(result, null, 2));
page.close();
