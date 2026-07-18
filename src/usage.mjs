import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const UUID_PATTERN = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const TAIL_BYTES = 1024 * 1024;
const HEAD_BYTES = 512 * 1024;

async function collectJsonl(directory, output) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectJsonl(path, output);
    if (entry.isFile() && entry.name.endsWith('.jsonl')) output.push(path);
  }));
}

async function readTail(path) {
  const info = await stat(path);
  const length = Math.min(info.size, TAIL_BYTES);
  const offset = Math.max(0, info.size - length);
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, offset);
    let text = buffer.toString('utf8');
    if (offset > 0) text = text.slice(text.indexOf('\n') + 1);
    return { text, mtimeMs: info.mtimeMs, size: info.size };
  } finally {
    await handle.close();
  }
}

async function readHead(path, fileSize) {
  const length = Math.min(fileSize, HEAD_BYTES);
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return buffer.toString('utf8');
  } finally {
    await handle.close();
  }
}

function firstTokenEvent(text) {
  for (const line of text.split('\n')) {
    if (!line.includes('"type":"token_count"')) continue;
    try { return JSON.parse(line); } catch {}
  }
  return null;
}

function parseLatestUsage(text, fileSize, headText) {
  const lines = text.split('\n');
  let tokenEvent;
  let taskState;
  let taskStartedAt;
  let activity = '等待输入';
  let activityUpdatedAt;
  const pendingTools = new Map();

  const describeTool = (payload) => {
    const input = String(payload.input || '');
    if (input.includes('tools.apply_patch')) return '正在修改代码';
    if (input.includes('tools.view_image')) return '正在查看图片';
    if (input.includes('image_gen')) return '正在生成图片';
    if (input.includes('web__run')) return '正在查询网络资料';
    if (input.includes('tools.exec_command')) {
      const match = input.match(/"cmd":"((?:\\.|[^"\\])*)"/);
      if (match) {
        let command = match[1];
        try { command = JSON.parse(`"${command}"`); } catch {}
        command = command.replace(/\s+/g, ' ').trim();
        return `正在执行命令 · ${command.slice(0, 58)}${command.length > 58 ? '…' : ''}`;
      }
      return '正在执行命令';
    }
    const labels = {
      exec: '正在调用工具',
      imagegen: '正在生成图片',
      web: '正在查询网络资料',
    };
    return labels[payload.name] || `正在使用 ${payload.name || '工具'}`;
  };

  for (const line of lines) {
    if (!line.includes('"type"')) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const type = event.payload?.type;
    if (type === 'token_count') tokenEvent = event;
    if (type === 'task_started') {
      taskState = 'working';
      taskStartedAt = event.timestamp;
      activity = '正在准备任务';
      activityUpdatedAt = event.timestamp;
    } else if (type === 'task_complete') {
      taskState = 'idle';
      activity = '已完成，等待新消息';
      activityUpdatedAt = event.timestamp;
      pendingTools.clear();
    } else if (type === 'custom_tool_call') {
      const description = describeTool(event.payload);
      if (event.payload.call_id) pendingTools.set(event.payload.call_id, description);
      activity = description;
      activityUpdatedAt = event.timestamp;
    } else if (type === 'custom_tool_call_output') {
      if (event.payload.call_id) pendingTools.delete(event.payload.call_id);
      activity = '正在处理工具结果';
      activityUpdatedAt = event.timestamp;
    } else if (type === 'reasoning' || type === 'agent_reasoning') {
      activity = '正在思考';
      activityUpdatedAt = event.timestamp;
    } else if (type === 'agent_message') {
      activity = '正在撰写回复';
      activityUpdatedAt = event.timestamp;
    }
  }
  if (taskState !== 'idle' && pendingTools.size) activity = [...pendingTools.values()].at(-1);
  const info = tokenEvent?.payload?.info;
  if (!info) return null;
  const initialTokenEvent = firstTokenEvent(headText);
  const initialRate = initialTokenEvent?.payload?.rate_limits?.primary || null;
  const latestRate = tokenEvent.payload?.rate_limits?.primary || null;
  const comparableQuota =
    Number.isFinite(initialRate?.used_percent) &&
    Number.isFinite(latestRate?.used_percent) &&
    initialRate?.resets_at === latestRate?.resets_at;
  return {
    updatedAt: tokenEvent.timestamp,
    total: info.total_token_usage || null,
    last: info.last_token_usage || null,
    contextWindow: info.model_context_window || null,
    rateLimit: latestRate,
    startingRateLimit: initialRate,
    quotaDelta: comparableQuota
      ? latestRate.used_percent - initialRate.used_percent
      : null,
    planType: tokenEvent.payload?.rate_limits?.plan_type || null,
    taskState: taskState || null,
    taskStartedAt: taskStartedAt || null,
    activity,
    activityUpdatedAt,
    fileSize,
  };
}

export class UsageReader {
  #paths = new Map();
  #cache = new Map();
  #indexed = false;

  async getMany(rawIds) {
    const ids = [...new Set(rawIds.map((id) => String(id).replace(/^local:/, '')))].filter(Boolean);
    if (!this.#indexed || ids.some((id) => !this.#paths.has(id))) await this.#reindex();
    const entries = await Promise.all(ids.map(async (id) => [id, await this.#getOne(id)]));
    return Object.fromEntries(entries.filter(([, usage]) => usage));
  }

  async #reindex() {
    const files = [];
    const codexDir = join(homedir(), '.codex');
    await Promise.all([
      collectJsonl(join(codexDir, 'sessions'), files),
      collectJsonl(join(codexDir, 'archived_sessions'), files),
    ]);
    for (const path of files) {
      const id = basename(path).match(UUID_PATTERN)?.[1];
      if (id) this.#paths.set(id, path);
    }
    this.#indexed = true;
  }

  async #getOne(id) {
    const path = this.#paths.get(id);
    if (!path) return null;
    try {
      const info = await stat(path);
      const cached = this.#cache.get(id);
      if (cached?.mtimeMs === info.mtimeMs && cached?.size === info.size) return cached.usage;
      const { text, mtimeMs, size } = await readTail(path);
      const headText = await readHead(path, size);
      const usage = parseLatestUsage(text, size, headText);
      this.#cache.set(id, { mtimeMs, size, usage });
      return usage;
    } catch {
      return null;
    }
  }
}
