'use strict';

/*
 * Every cached DOM lookup the UI touches, in one file (#12, step 1).
 *
 * This is the coupling point of renderer/app.js: 165 top-level functions reach into `els`, so any
 * later boundary (storage, cron, tree, settings, composer, transcript) has to decide what it does
 * with this object. Pulling it out first makes those moves mechanical instead of a rewrite.
 *
 * It is a classic script loaded before app.js, and `$` lives here because the block below calls it
 * at load time. Top-level `const` in a classic script sits in the scope every later script shares,
 * so app.js and smoke.js keep seeing both names without an import.
 */

const $ = (id) => document.getElementById(id);

const els = {
  tabs: $('tabs'),
  transcript: $('transcript'),
  sessionList: $('sessionList'),
  sideFoot: $('sideFoot'),
  search: $('search'),
  input: $('input'),
  attachments: $('attachments'),
  modelSel: $('modelSel'),
  thinkingSel: $('thinkingSel'),
  busySel: $('busySel'),
  stats: $('stats'),
  cwdChip: $('cwdChip'),
  queueBar: $('queueBar'),
  nowBar: $('nowBar'),
  btnSend: $('btnSend'),
  btnAbort: $('btnAbort'),
  btnClearQueue: $('btnClearQueue'),
  btnCompact: $('btnCompact'),
  btnStopRetry: $('btnStopRetry'),
  btnRestart: $('btnRestart'),
  extWidgets: $('extWidgets'),
  dropOverlay: $('dropOverlay'),
  modalRoot: $('modalRoot'),
  toasts: $('toasts'),
  envInfo: $('envInfo'),
  body: $('body'),
  fileInput: $('fileInput'),
  queueList: $('queueList'),
  serialToggle: $('serialToggle'),
  btnMonitor: $('btnMonitor'),
  monitorView: $('monitorView'),
  monSrc: $('monSrc'),
  monServers: $('monServers'),
  monBadges: $('monBadges'),
  monStateLabel: $('monStateLabel'),
  monStateDetail: $('monStateDetail'),
  monStateBar: $('monStateBar'),
  monCards: $('monCards'),
  monCtxFill: $('monCtxFill'),
  monCtxPct: $('monCtxPct'),
  monCtxSub: $('monCtxSub'),
  monSlotsText: $('monSlotsText'),
  monSlotsBar: $('monSlotsBar'),
  monRamText: $('monRamText'),
  monRamBar: $('monRamBar'),
  monTempText: $('monTempText'),
  monTempBar: $('monTempBar'),
  monEngineText: $('monEngineText'),
  monReqAll: $('monReqAll'),
  monReqBody: $('monReqBody'),
  monTotals: $('monTotals'),
  monResizer: $('monResizer'),
  slashMenu: $('slashMenu'),
  btnDiag: $('btnDiag'),
  btnSettings: $('btnSettings'),
};
