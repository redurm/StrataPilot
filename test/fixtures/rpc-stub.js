'use strict';

/*
 * Stub RPC peer used by test/pi-process.test.js in place of the real pi.
 * Speaks the same JSONL protocol on stdin/stdout so PiRpcProcess framing and
 * command() pairing can be exercised without pi, Strata or the network.
 *
 * Behaviour triggered by the command type:
 *   echo   -> respond with {success:true, data:{echo:<payload>}}; when the
 *             command carries split:true, the response is deliberately written
 *             in two chunks (20ms apart) to exercise framing. Only one record
 *             may be split at a time: interleaving two half-written records
 *             would corrupt the stream, and that is a stub artefact, not a
 *             framing bug.
 *   slow   -> respond 500ms later (for timeout tests that cancel first)
 *   silent -> never respond (forces the command() timeout path)
 *   boom   -> exit the process immediately (tests pending rejection on exit)
 *   get_state -> respond with {success:true, data:{sessionId, sessionFile}} where
 *             sessionFile comes from STRATAPILOT_STUB_SESSION_FILE (empty means
 *             "pi has not created the file yet"), which is how #46's
 *             resolveSessionPath() is exercised.
 *
 * On startup it also emits one unparsable line and one non-response record so
 * the test can assert the `log` and `record` event paths.
 */

process.stdout.write('this line is not json\n');
process.stdout.write(JSON.stringify({ type: 'extension_message', text: 'hello from stub' }) + '\n');

// the record separator, kept out of string literals so this file has no escape sequences to trip on
const LF = String.fromCharCode(10);

const rl = require('node:readline').createInterface({ input: process.stdin });

function respond(cmd, extra) {
  const line = JSON.stringify({
    type: 'response',
    id: cmd.id,
    command: cmd.type,
    success: true,
    data: { echo: cmd.payload === undefined ? null : cmd.payload },
    ...extra,
  });
  return line;
}

rl.on('line', (line) => {
  if (!line.trim()) return;
  let cmd;
  try {
    cmd = JSON.parse(line);
  } catch {
    return;
  }
  switch (cmd.type) {
    case 'echo': {
      const full = respond(cmd);
      if (cmd.split) {
        // split the record across two chunks: framing must rejoin it
        process.stdout.write(full.slice(0, 10));
        setTimeout(() => process.stdout.write(full.slice(10) + '\n'), 20);
      } else {
        process.stdout.write(full + '\n');
      }
      break;
    }
    case 'slow':
      setTimeout(() => process.stdout.write(respond(cmd) + '\n'), 500);
      break;
    case 'silent':
      break; // never answer -> caller times out
    case 'boom':
      process.exit(3);
      break;
    case 'get_state':
      process.stdout.write(respond(cmd, {
        data: {
          sessionId: 'stub-session',
          sessionFile: process.env.STRATAPILOT_STUB_SESSION_FILE || '',
        },
      }) + LF);
      break;
    default:
      process.stdout.write(respond(cmd) + '\n');
      break;
  }
});
