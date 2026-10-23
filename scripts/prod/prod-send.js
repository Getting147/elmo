#!/usr/bin/env node
// prod-send.js — 生产桥慢网关持久发送器（hill，2026-09-08）
// 用法: node prod-send.js <to> <message>
// 用 300s 超时模仿 prod-watch 成功模式；最多重试 3 次
const fs = require('fs');
const URL = 'http://89.106.84.135/mcp';
const TOKEN = fs.readFileSync('D:/let-them-talk/agent-bridge/prod-watch.token', 'utf8').trim();
const to = process.argv[2];
const content = process.argv[3];
const fromOverride = process.argv[4] || '';
let reqId = 0, sessionId = '';
async function post(body, timeoutMs = 300000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const sid = res.headers.get('mcp-session-id');
    if (sid) sessionId = sid;
    const text = await res.text();
    const out = [];
    for (const line of text.split(/\r?\n/)) if (line.startsWith('data: ')) out.push(line.slice(6));
    return out.join('\n') || text;
  } finally { clearTimeout(timer); }
}
async function main() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      reqId++;
      const args = { to, content };
      if (fromOverride) args.from = fromOverride;
      const body = JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', id: reqId, params: { name: 'send_message', arguments: args } });
      const text = await post(body);
      const j = JSON.parse(text);
      const out = (j.result?.content || []).map(c => c.text).join('') || text.slice(0, 200);
      console.log(`SENT attempt=${attempt}: ${out.slice(0, 200)}`);
      process.exit(0);
    } catch (e) {
      console.error(`attempt ${attempt} failed: ${e.message}`);
      sessionId = '';
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  process.exit(1);
}
main();
