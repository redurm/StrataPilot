'use strict';

/* Headless smoke test for the RPC layer (no Electron, no LLM prompt). */

const { PiRpcProcess } = require('../lib/pi-process');
const { resolvePiInvocation } = require('../lib/pi-launch');
const sessions = require('../lib/sessions');

const cwd = process.argv[2] || process.cwd();
const inv = resolvePiInvocation();
console.log('cli:', inv.cliPath);
console.log('node:', inv.nodePath, inv.runAsNode ? '(ELECTRON_RUN_AS_NODE)' : '');
console.log('pi version:', inv.piVersion);
console.log('sessions root:', sessions.sessionsRoot());
console.log('cwd:', cwd);

const proc = new PiRpcProcess({ id: 'smoke', cwd, args: ['--no-session'] });
proc.on('stderr', (text) => process.stderr.write(`[stderr] ${text}`));
proc.on('log', (text) => console.log(`[log] ${text}`));
proc.on('record', (record) => console.log(`[event] ${record.type}`));
proc.on('exit', (info) => console.log('[exit]', info.code, info.signal));
proc.start();

(async () => {
  const started = Date.now();
  const state = await proc.command('get_state');
  console.log(`get_state (${Date.now() - started}ms):`, JSON.stringify(state.data || state.error).slice(0, 400));

  const models = await proc.command('get_available_models');
  console.log('models:', models.success ? (models.data.models || []).map((m) => `${m.provider}/${m.id}`).slice(0, 10) : models.error);

  const levels = await proc.command('get_available_thinking_levels');
  console.log('thinking levels:', levels.success ? levels.data.levels : levels.error);

  const messages = await proc.command('get_messages');
  console.log('messages:', messages.success ? messages.data.messages.length : messages.error);

  const commands = await proc.command('get_commands');
  console.log('commands:', commands.success ? (commands.data.commands || []).map((c) => c.name).slice(0, 15) : commands.error);

  const stats = await proc.command('get_session_stats');
  console.log('stats:', stats.success ? JSON.stringify(stats.data).slice(0, 300) : stats.error);

  proc.dispose();
  setTimeout(() => process.exit(0), 1500);
})();
