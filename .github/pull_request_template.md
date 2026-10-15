### What this changes

<!-- one paragraph: the problem, then the approach -->

### Which backlog item

- [ ] `docs/TODO.md` item: `A#` / `B#` / `C#` / `D#` (status updated to `done`)
- [ ] no backlog item (say why)

### How it was verified

<!-- what you actually ran; delete the lines that do not apply -->

- `npm test` (unit tests, no pi or Strata needed)
- `PI_ON_STRATA_SMOKE=1 PI_ON_STRATA_SMOKE_MS=… PI_ON_STRATA_SMOKE_<SWITCH>=1 npm start` and the
  printed `[smoke-…]` line
- manual: which session, which Strata model, what you sent

### Notes for the reviewer

- does this touch the serial queue (the only entry point for prompts)? yes / no
- does this touch how a session file is written or deleted? yes / no
- new RPC commands used:
