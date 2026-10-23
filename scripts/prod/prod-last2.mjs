import { readFileSync } from 'fs';
const tok = readFileSync('D:/let-them-talk/agent-bridge/prod-watch.token', 'utf-8').trim();
const URL = 'http://89.106.84.135/mcp';
async function post(body) {
  const res = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body), signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res;
}
async function call(name, args) {
  const body = { jsonrpc: '2.0', method: 'tools/call', id: 'g' + Date.now(), params: { name, arguments: args } };
  const res = await post(body);
  const text = await res.text();
  const m = text.match(/\{"result":.*/s);
  return m ? JSON.parse(m[0]) : null;
}
const out = await call('get_history', { limit: 6 });
const content = (out?.result?.content || []);
for (const it of content) {
  const t = it.text || '';
  try {
    const j = JSON.parse(t);
    for (const msg of (j.messages || []).slice(-3)) {
      if (msg.from === 'FDEV' && msg.to === 'hill') { console.log('=====', msg.id, '====='); console.log(msg.content); }
    }
  } catch {}
}
