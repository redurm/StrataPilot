'use strict';

/*
 * Which smoke scenarios run, and what they are handed (#47).
 *
 * The renderer gates every scenario on a flag in state.info, and those flags come from the
 * environment. Locally a developer lists the flags they want; CI sets ONE - STRATAPILOT_SMOKE_SAFE -
 * and gets every scenario that needs no model reply and no credentials, so a UI regression fails the
 * build instead of waiting for someone to run the app by hand.
 *
 * Keeping the table here (rather than inline in main.js) is what makes it testable: test/smoke-flags.test.js
 * proves the safe set really is model-independent, and that no scenario exists which nothing runs.
 */

// env name -> state.info key, for the flags that are simply on/off
const BOOLEAN_ENV = [
  ['STRATAPILOT_SMOKE', 'smoke'],
  ['STRATAPILOT_SMOKE_SAFE', 'smokeSafe'],
  ['STRATAPILOT_SMOKE_PERSIST', 'smokePersist'],
  ['STRATAPILOT_SMOKE_STEER', 'smokeSteer'],
  ['STRATAPILOT_SMOKE_QUEUE', 'smokeQueue'],
  ['STRATAPILOT_SMOKE_MONITOR', 'smokeMonitor'],
  ['STRATAPILOT_SMOKE_COMPACT', 'smokeCompact'],
  ['STRATAPILOT_SMOKE_ORDER', 'smokeOrder'],
  ['STRATAPILOT_SMOKE_AUTO_COMPACT', 'smokeAutoCompact'],
  ['STRATAPILOT_SMOKE_BASH', 'smokeBash'],
  ['STRATAPILOT_SMOKE_BARS', 'smokeBars'],
  ['STRATAPILOT_SMOKE_PASTE', 'smokePaste'],
  ['STRATAPILOT_SMOKE_COPY', 'smokeCopy'],
  ['STRATAPILOT_SMOKE_EXPORT', 'smokeExport'],
  ['STRATAPILOT_SMOKE_DIAG', 'smokeDiag'],
  ['STRATAPILOT_SMOKE_SETTINGS', 'smokeSettings'],
  ['STRATAPILOT_SMOKE_RETRY', 'smokeRetry'],
  ['STRATAPILOT_SMOKE_OUTBOX', 'smokeOutbox'],
  ['STRATAPILOT_SMOKE_CRON', 'smokeCron'],
  ['STRATAPILOT_SMOKE_TABTAG', 'smokeTabTag'],
  ['STRATAPILOT_SMOKE_THEME', 'smokeTheme'],
  ['STRATAPILOT_SMOKE_A11Y', 'smokeA11y'],
  ['STRATAPILOT_SMOKE_USAGE', 'smokeUsage'],
  ['STRATAPILOT_SMOKE_I18N', 'smokeI18n'],
  ['STRATAPILOT_SMOKE_STORAGE', 'smokeStorage'],
  ['STRATAPILOT_SMOKE_SERVERS', 'smokeServers'],
  ['STRATAPILOT_SMOKE_PATH', 'smokePath'],
  ['STRATAPILOT_SMOKE_TREE', 'smokeTree'],
  ['STRATAPILOT_SMOKE_FORK', 'smokeFork'],
  ['STRATAPILOT_SMOKE_SETUP', 'smokeSetup'],
];

// env name -> state.info key, for the flags that carry a value
const STRING_ENV = [
  ['STRATAPILOT_SMOKE_PROMPT', 'smokePrompt', ''],
  ['STRATAPILOT_SMOKE_SESSION', 'smokeSession', ''],
];

/*
 * #47: the scenarios CI may run with no model and no credentials.
 *
 * Excluded on purpose: anything that types a real prompt into the composer, waits for an assistant
 * reply, steers a running turn, or fires a cron job - those need a working model behind pi.
 */
const MODEL_INDEPENDENT = [
  'smokeAutoCompact',
  'smokePaste',
  'smokeExport',
  'smokeDiag',
  'smokeSettings',
  'smokeRetry',
  'smokeOutbox',
  'smokeTabTag',
  'smokeTheme',
  'smokeA11y',
  'smokeUsage',
  'smokeI18n',
  'smokeStorage',
  'smokeServers',
  'smokeTree',
  'smokeSetup',
];

/*
 * The log tag each scenario prints when it reports (#47). A scenario that printed nothing did not
 * finish, and a run where nothing failed but half the scenarios never spoke up is not a pass - so the
 * CI log checker needs to know what to look for. test/smoke-flags.test.js fails if a scenario prints a
 * different tag than the one listed here.
 */
const SCENARIO_TAGS = {
  smokeQueue: 'smoke-queue',
  smokeCompact: 'smoke-compact',
  smokeOrder: 'smoke-order',
  smokeAutoCompact: 'smoke-autocompact',
  smokeBash: 'smoke-bash',
  smokeBars: 'smoke-bars',
  smokePaste: 'smoke-paste',
  smokeCopy: 'smoke-copy',
  smokeExport: 'smoke-export',
  smokeSetup: 'smoke-setup',
  smokeFork: 'smoke-fork',
  smokeTree: 'smoke-tree',
  smokePath: 'smoke-path',
  smokeServers: 'smoke-servers',
  smokeStorage: 'smoke-storage',
  smokeUsage: 'smoke-usage',
  smokeI18n: 'smoke-i18n',
  smokeA11y: 'smoke-a11y',
  smokeTheme: 'smoke-theme',
  smokeTabTag: 'smoke-tabtag',
  smokeCron: 'smoke-cron',
  smokeOutbox: 'smoke-outbox',
  smokeRetry: 'smoke-retry',
  smokeSettings: 'smoke-settings',
  smokeDiag: 'smoke-diag',
};

function isOn(value) {
  return value !== undefined && value !== '' && value !== '0';
}

/**
 * Build the smoke half of state.info from the environment.
 *
 * STRATAPILOT_SMOKE_SAFE also turns on persistence: without a session file on disk the export scenario
 * can only skip itself, and skipping is not coverage.
 */
function smokeInfoFromEnv(env, { exportOutDefault = '' } = {}) {
  const info = {};
  for (const [name, key] of BOOLEAN_ENV) info[key] = isOn(env[name]);
  for (const [name, key, fallback] of STRING_ENV) info[key] = env[name] === undefined ? fallback : env[name];
  info.smokeExportOut = env.STRATAPILOT_SMOKE_EXPORT_OUT || exportOutDefault;

  if (info.smokeSafe) {
    // persistence: without a session file on disk the export scenario can only skip itself, and
    // skipping is not coverage. monitor: the panel is a view, not a modal, and its cards and server
    // pills are exactly the kind of layout that used to regress silently (#25, #30).
    info.smokePersist = true;
    info.smokeMonitor = true;
    for (const key of MODEL_INDEPENDENT) info[key] = true;
  }
  return info;
}

/** The log tags CI must see for a run of the safe set to count as a pass. */
function safeScenarioTags() {
  return MODEL_INDEPENDENT.map((key) => SCENARIO_TAGS[key]).filter(Boolean);
}

/**
 * Env flags that are not scenarios: they change how a run behaves instead of adding a scenario of
 * their own (smokeMonitor opens the panel, smokeSteer sends a second message during the prompt run).
 */
const NON_SCENARIO_FLAGS = ['smoke', 'smokeSafe', 'smokePersist', 'smokeSteer', 'smokeMonitor'];

/** Every flag that gates a scenario in renderer/smoke.js, safe or not. */
function allScenarioFlags() {
  return Object.keys(SCENARIO_TAGS);
}

/** Env flags that name nothing: a typo here would be a flag that silently does nothing. */
function unknownFlagKeys() {
  const known = new Set([...allScenarioFlags(), ...NON_SCENARIO_FLAGS, ...STRING_ENV.map(([, key]) => key)]);
  return BOOLEAN_ENV.map(([, key]) => key).filter((key) => !known.has(key));
}

module.exports = {
  BOOLEAN_ENV,
  STRING_ENV,
  MODEL_INDEPENDENT,
  SCENARIO_TAGS,
  NON_SCENARIO_FLAGS,
  smokeInfoFromEnv,
  allScenarioFlags,
  safeScenarioTags,
  unknownFlagKeys,
  isOn,
};
