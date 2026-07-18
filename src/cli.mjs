#!/usr/bin/env node

import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CdpPage, listTargets, waitForTargets } from './cdp.mjs';
import { UsageReader } from './usage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DEFAULT_PORT = 9229;
const command = process.argv[2] || 'help';

function usage() {
  console.log(`Codex Tabs

用法：
  npm start                 用调试端口启动 Codex 并注入标签栏
  npm run attach -- 9229    连接已开启调试端口的 Codex
  npm run demo              打开离线演示页（http://127.0.0.1:41739）
  node src/cli.mjs locate   显示自动发现的 Codex 可执行文件

提示：若 Codex 已在运行，请先自行正常退出，再执行 npm start。
注入器不会修改 Codex.app，也不会强制结束 Codex。`);
}

async function executableFromApp(appPath) {
  const plist = join(appPath, 'Contents', 'Info.plist');
  try {
    const bundleId = execFileSync(
      '/usr/bin/plutil',
      ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plist],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (bundleId !== 'com.openai.codex') return null;
    const executable = execFileSync(
      '/usr/bin/plutil',
      ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', plist],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    const binary = join(appPath, 'Contents', 'MacOS', executable);
    await access(binary, constants.X_OK);
    return binary;
  } catch {
    return null;
  }
}

async function resolveOverride(value) {
  try {
    const info = await stat(value);
    if (info.isDirectory()) return executableFromApp(value);
    await access(value, constants.X_OK);
    return value;
  } catch {
    return null;
  }
}

async function findCodexBinary() {
  if (process.env.CODEX_APP_PATH) {
    const override = await resolveOverride(process.env.CODEX_APP_PATH);
    if (override) return override;
    throw new Error(`CODEX_APP_PATH 指向无效位置：${process.env.CODEX_APP_PATH}`);
  }

  const applicationDirs = ['/Applications', join(homedir(), 'Applications')];
  const preferredNames = ['Codex.app', 'ChatGPT.app'];
  for (const directory of applicationDirs) {
    for (const name of preferredNames) {
      const binary = await executableFromApp(join(directory, name));
      if (binary) return binary;
    }
  }

  for (const directory of applicationDirs) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.endsWith('.app')) continue;
      const binary = await executableFromApp(join(directory, entry.name));
      if (binary) return binary;
    }
  }

  throw new Error(
    '未找到 bundle id 为 com.openai.codex 的应用；可用 CODEX_APP_PATH 手动指定 .app 或可执行文件',
  );
}

async function chooseLocalPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function launchCodex(port) {
  const codexBinary = await findCodexBinary();
  console.log(`已找到 Codex：${codexBinary}`);

  const child = spawn(
    codexBinary,
    [
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
    ],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
  const stateDirectory = process.env.CODEX_TABS_STATE_DIR || ROOT;
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(join(stateDirectory, '.codex-tabs-port'), `${port}\n`);
}

async function readManagerConfig() {
  const path = process.env.CODEX_TABS_CONFIG;
  if (!path) return {};
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

async function runInjector(port, shouldWait = true) {
  const sourcePath = join(HERE, 'injected.js');
  if (shouldWait) await waitForTargets(port);

  console.log(`已连接 Codex：127.0.0.1:${port}`);
  console.log('注入器正在运行；按 Control-C 会移除标签栏，但不会退出 Codex。');

  const pages = new Map();
  const usageReader = new UsageReader();
  let stopped = false;

  const inject = async (page) => {
    try {
      const config = JSON.stringify(await readManagerConfig()).replaceAll('<', '\\u003c');
      await page.evaluate(`
        globalThis.__CODEX_TABS_CONFIG__ = ${config};
        dispatchEvent(new Event('codex-tabs-config-updated'));
      `);
      const source = await readFile(sourcePath, 'utf8');
      const result = await page.evaluate(source);
      if (result?.count !== undefined) {
        process.stdout.write(`\r已注入顶部标签栏，识别到 ${result.count} 个任务   `);
      }
    } catch (error) {
      if (page.open) process.stderr.write(`\n重新注入失败：${error.message}\n`);
    }
  };

  const updateUsage = async (page) => {
    try {
      const ids = await page.evaluate(`
        (() => {
          const nativeIds = [...document.querySelectorAll('[data-app-action-sidebar-thread-id]')]
            .map((element) => element.getAttribute('data-app-action-sidebar-thread-id'));
          const cachedIds = globalThis.__CODEX_TABS_HACK__?.usageIds?.() || [];
          return [...new Set([...nativeIds, ...cachedIds].filter(Boolean))];
        })()
      `);
      const usage = await usageReader.getMany(Array.isArray(ids) ? ids : []);
      const serialized = JSON.stringify(usage).replaceAll('<', '\\u003c');
      await page.evaluate(`
        globalThis.__CODEX_TABS_USAGE__ = ${serialized};
        dispatchEvent(new Event('codex-tabs-usage-updated'));
      `);
    } catch (error) {
      if (page.open) process.stderr.write(`\n用量同步失败：${error.message}\n`);
    }
  };

  const refresh = async () => {
    let targets;
    try {
      targets = await listTargets(port);
    } catch {
      return;
    }
    const liveIds = new Set(targets.map((target) => target.id));
    for (const [id, page] of pages) {
      if (!liveIds.has(id) || !page.open) {
        page.close();
        pages.delete(id);
      }
    }
    for (const target of targets) {
      if (pages.has(target.id)) continue;
      try {
        let page;
        page = await new CdpPage(target.webSocketDebuggerUrl, () => {
          setTimeout(() => inject(page), 300);
        }).connect();
        pages.set(target.id, page);
        await inject(page);
      } catch (error) {
        process.stderr.write(`\n页面连接失败：${error.message}\n`);
      }
    }
    for (const page of pages.values()) {
      await inject(page);
      await updateUsage(page);
    }
  };

  await refresh();
  const timer = setInterval(refresh, 2_000);
  process.once('SIGINT', async () => {
    clearInterval(timer);
    await Promise.allSettled(
      [...pages.values()]
        .filter((page) => page.open)
        .map((page) =>
          page.evaluate('globalThis.__CODEX_TABS_HACK__?.destroy?.()'),
        ),
    );
    for (const page of pages.values()) page.close();
    stopped = true;
    process.stdout.write('\n注入器已停止。\n');
  });
  while (!stopped) await new Promise((resolve) => setTimeout(resolve, 1_000));
}

async function serveDemo() {
  const port = 41739;
  const server = createServer(async (request, response) => {
    const file = request.url === '/injected.js' ? 'src/injected.js' : 'demo.html';
    try {
      const body = await readFile(join(ROOT, file));
      response.writeHead(200, {
        'content-type': file.endsWith('.js')
          ? 'text/javascript; charset=utf-8'
          : 'text/html; charset=utf-8',
      });
      response.end(body);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  console.log(`演示页：http://127.0.0.1:${port}`);
  console.log('按 Control-C 停止。');
}

try {
  if (command === 'start') {
    const port = await chooseLocalPort();
    await launchCodex(port);
    await runInjector(port);
  } else if (command === 'attach') {
    const port = Number(process.argv[3] || DEFAULT_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('端口号无效');
    }
    await runInjector(port);
  } else if (command === 'demo') {
    await serveDemo();
  } else if (command === 'locate') {
    console.log(await findCodexBinary());
  } else {
    usage();
  }
} catch (error) {
  console.error(`Codex Tabs：${error.message}`);
  process.exitCode = 1;
}
