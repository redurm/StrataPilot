'use strict';

/*
 * The storage and usage dialogs (#12, step 2): what is on disk, and what the model
 * bills.  Moved out of app.js without changing a single function body - if a body
 * had to change to compile, the boundary would be wrong.

 * Classic script loaded before app.js: it reads els/$ (dom-refs.js) and the shared
 * state/api exactly as before, because top-level declarations in classic scripts
 * share one scope. Nothing here runs at load time except the declarations.
 */

function usageTooltip(u) {
  if (!u) return '';
  const cache = (u.cacheRead || 0) + (u.cacheWrite || 0);
  const total = u.totalTokens != null ? u.totalTokens : u.total || 0;
  const lines = [
    tr('in    prompt read, uncached: {n}', { n: nfmt(u.input || 0) }),
    tr('out   generated: {n}', { n: nfmt(u.output || 0) }),
    tr('cache context re-read: {n} (read {read} + write {write})', { n: nfmt(cache), read: nfmt(u.cacheRead || 0), write: nfmt(u.cacheWrite || 0) }),
    tr('total in + out + cache: {n}', { n: nfmt(total) }),
  ];
  if (u.reasoning != null) lines.push(tr('thinking: {n} (included in out)', { n: nfmt(u.reasoning) }));
  return lines.join('\n');
}


async function refreshStorage() {
  const res = await api.sessionsStats();
  if (!res || !res.ok) {
    console.error(`[storage] stats failed: ${(res && res.error) || 'unknown'}`);
    return null;
  }
  state.storage = res;
  renderOpenSessions();
  return res;
}

/**
 * What the sessions folder costs, and a cleanup that does not need the file manager. Two rules only
 * (age, and a per-folder cap), always previewed before anything is deleted, and a session that is
 * open in a tab is never in the list - the main process filters those out, not this dialog.
 */
async function openStorageModal() {
  const stats = (await refreshStorage()) || state.storage;
  if (!stats) {
    toast(tr('could not read the sessions folder'), 'error');
    return;
  }
  let plan = null;

  return new Promise((resolve) => {
    const backdrop = el('div', 'modal-backdrop storage-backdrop');
    const modal = el('div', 'modal storage-modal');
    modal.appendChild(el('h3', '', tr('Session storage')));
    modal.appendChild(
      el('div', 'set-hint', tr('{files} session files, {size} in {root}. Deleting here is permanent - sessions do not go to a recycle bin.', { files: stats.totalFiles, size: formatBytes(stats.totalBytes), root: stats.root })),
    );

    const groups = el('div', 'job-list');
    for (const group of stats.groups.slice(0, 40)) {
      const row = el('div', 'job-row storage-row');
      const head = el('div', 'job-head');
      head.appendChild(el('span', 'job-name', group.group));
      head.appendChild(el('span', 'job-schedule', tr('{size} / {n} files', { size: formatBytes(group.bytes), n: group.files })));
      row.appendChild(head);
      row.appendChild(
        el('div', 'job-meta', tr('newest {newest} · oldest {oldest}', { newest: new Date(group.newestMs).toLocaleString(i18nInfo.lang === 'en' ? undefined : i18nInfo.lang), oldest: new Date(group.oldestMs).toLocaleString(i18nInfo.lang === 'en' ? undefined : i18nInfo.lang) })),
      );
      groups.appendChild(row);
    }
    if (stats.groups.length > 40) groups.appendChild(el('div', 'set-hint', tr('{n} more folders not shown', { n: stats.groups.length - 40 })));
    modal.appendChild(groups);

    const rules = el('div', 'field-row');
    const olderSel = document.createElement('select');
    for (const option of [
      { value: '', label: tr('any age') },
      { value: '30', label: tr('older than 30 days') },
      { value: '90', label: tr('older than 90 days') },
      { value: '180', label: tr('older than 180 days') },
      { value: '365', label: tr('older than a year') },
    ]) {
      const opt = document.createElement('option');
      opt.value = option.value;
      opt.textContent = option.label;
      olderSel.appendChild(opt);
    }
    const keepSel = document.createElement('select');
    for (const option of [
      { value: '', label: tr('keep every session per folder') },
      { value: '5', label: tr('keep the 5 newest per folder') },
      { value: '10', label: tr('keep the 10 newest per folder') },
      { value: '20', label: tr('keep the 20 newest per folder') },
      { value: '50', label: tr('keep the 50 newest per folder') },
    ]) {
      const opt = document.createElement('option');
      opt.value = option.value;
      opt.textContent = option.label;
      keepSel.appendChild(opt);
    }
    olderSel.setAttribute('aria-label', tr('Age rule'));
    keepSel.setAttribute('aria-label', tr('Per folder cap'));
    rules.appendChild(olderSel);
    rules.appendChild(keepSel);
    modal.appendChild(rules);

    const previewBox = el('div', 'storage-preview', tr('Pick a rule and preview - nothing is deleted until you say so.'));
    modal.appendChild(previewBox);

    const actions = el('div', 'modal-actions');
    const previewButton = el('button', '', tr('Preview'));
    const del = el('button', 'danger', tr('Delete'));
    del.disabled = true;
    const close = el('button', 'ghost', tr('Close'));
    actions.appendChild(previewButton);
    actions.appendChild(del);
    actions.appendChild(close);
    modal.appendChild(actions);
    backdrop.appendChild(modal);
    els.modalRoot.appendChild(backdrop);

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      backdrop.remove();
      modalOpen = null;
      resolve();
    };
    modalOpen = { finish, backdrop };
    close.addEventListener('click', finish);
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) finish();
    });

    previewButton.addEventListener('click', async () => {
      const olderThanDays = olderSel.value ? Number(olderSel.value) : null;
      const keepNewestPerGroup = keepSel.value ? Number(keepSel.value) : null;
      if (olderThanDays == null && keepNewestPerGroup == null) {
        previewBox.textContent = tr('Choose at least one rule first - otherwise nothing would be deleted.');
        del.disabled = true;
        return;
      }
      const res = await api.sessionsCleanupPlan({ olderThanDays, keepNewestPerGroup });
      if (!res.ok) {
        previewBox.textContent = tr('preview failed: {error}', { error: res.error });
        del.disabled = true;
        return;
      }
      plan = res;
      if (!res.candidates.length) {
        previewBox.textContent = tr('Nothing matches: {n} files scanned, 0 to delete.', { n: res.scannedFiles });
        del.disabled = true;
        return;
      }
      const sample = res.candidates
        .slice(0, 12)
        .map((entry) => `${pathParts(entry.path).leaf || entry.group} - ${formatBytes(entry.bytes)}, ${tr(entry.reason)}`)
        .join(' · ');
      previewBox.textContent = tr('{n} files, {size} to free: {sample}', { n: res.candidates.length, size: formatBytes(res.bytes), sample: `${sample}${res.candidates.length > 12 ? tr(' (+{n} more)', { n: res.candidates.length - 12 }) : ''}` });
      del.disabled = false;
      del.textContent = tr('Delete {n} files ({size})', { n: res.candidates.length, size: formatBytes(res.bytes) });
    });

    del.addEventListener('click', async () => {
      if (!plan || !plan.candidates.length) return;
      const paths = plan.candidates.map((entry) => entry.path);
      const answer = await openModal({
        kind: 'confirm',
        title: tr('Delete {n} session files?', { n: paths.length }),
        message: tr('{size} will be removed from {root}. This is permanent. Sessions open in a tab are never included.', { size: formatBytes(plan.bytes), root: stats.root }),
        okLabel: tr('Delete for good'),
      });
      if (!answer || !answer.confirmed) return;
      const res = await api.sessionsCleanupRun({ paths });
      if (!res.ok) {
        toast(tr('cleanup failed: {error}', { error: res.error }), 'error', 9000);
        return;
      }
      toast(
        tr('deleted {n} session files ({size}){skipped}{failed}', {
          n: res.deleted,
          size: formatBytes(res.bytes),
          skipped: res.skipped.length ? tr(', {n} skipped: open in a tab', { n: res.skipped.length }) : '',
          failed: res.failed.length ? tr(', {n} failed', { n: res.failed.length }) : '',
        }),
        'info',
        9000,
      );
      plan = null;
      del.disabled = true;
      del.textContent = tr('Delete');
      previewBox.textContent = tr('Done. The totals above are refreshed.');
      await refreshStorage();
      await refreshSessions();
      scheduleUsageSummary(0); // the ledger marks those entries as gone; the chip must follow at once
    });
  });
}

/* ------------------------------------------------------------------ */
/* token usage ledger (D9): persisted in / out / cache + column chart    */
/* ------------------------------------------------------------------ */

/*
 * pi writes the usage of every assistant message into the session JSONL, and lib/usage-ledger.js
 * rolls that up into day buckets in %APPDATA%\StrataPilot\token_usage.json. This section is only the
 * viewer: a stacked column chart per day / week / month / year, built as inline SVG (no canvas, no
 * dependency, and the CSP stays at default-src 'self').
 *
 * The stack order is deliberate: cacheRead is usually two orders of magnitude bigger than the rest
 * (this machine: 29.5M cache reads against 842k real prompt reads), so it goes at the bottom and the
 * interesting in / out sit on top of it where they stay readable.
 */


function usageStackTotal(bucket) {
  return (bucket.cacheRead || 0) + (bucket.cacheWrite || 0) + (bucket.in || 0) + (bucket.out || 0);
}

/*
 * What it costs. Strata reports no prices (pi's `usage.cost.total` is 0 for every call here), so the
 * money side has to be computed from rates the user enters: USD per 1,000,000 tokens, per model, with
 * a default row for models that have no row yet. The ledger deliberately stores only token counts -
 * prices change over time, and re-pricing old days must not need a re-scan.
 */
const PRICE_FIELDS = ['in', 'out', 'cacheRead', 'cacheWrite'];
const TOKENS_PER_MILLION = 1000000;


function usageValueText(value, mode) {
  return mode === 'cost' ? fmtMoney(value) : fmtTokens(value);
}

/** What one column stacks into, in tokens or in dollars. */
function usageSegmentValues(bucket, mode, usagePrices) {
  if (mode === 'cost') {
    const parts = bucketCostParts(bucket, usagePrices);
    return { cacheRead: parts.cacheRead, cacheWrite: parts.cacheWrite, in: parts.in, out: parts.out, total: parts.total };
  }
  return { cacheRead: bucket.cacheRead || 0, cacheWrite: bucket.cacheWrite || 0, in: bucket.in || 0, out: bucket.out || 0, total: usageStackTotal(bucket) };
}

function usageCostOfSummary(usage, usagePrices) {
  const models = (usage && usage.allModels) || [];
  if (models.length) return models.reduce((sum, model) => sum + costOf(model, priceForModel(usagePrices, model.model)), 0);
  return usage && usage.all ? costOf(usage.all, priceForModel(usagePrices, '')) : 0;
}

function usageFootLabel() {
  const usage = state.usage;
  if (!usage || !usage.all || !usage.all.total) return tr('Usage');
  const prices = state.settings && state.settings.usagePrices;
  const cost = hasPrices(prices) ? usageCostOfSummary(usage, prices) : 0;
  const money = cost ? ` \u00b7 ${fmtMoney(cost)}` : usage.all.cost ? ` \u00b7 ${fmtMoney(usage.all.cost)}` : '';
  return tr('Usage: {tok} tok', { tok: fmtTokens(usage.all.total) }) + money;
}

function updateUsageFoot() {
  const button = els.sideFoot.querySelector('.foot-usage');
  if (button) button.textContent = usageFootLabel();
}

async function refreshUsageSummary() {
  const res = await api.usageSummary();
  if (!res || !res.ok) return null;
  state.usage = res;
  updateUsageFoot();
  return res;
}

/*
 * The footer chip and an open Usage dialog must not need an app restart to show what the last run
 * cost. Every run that settles - and every compaction, which is a model call of its own - re-reads
 * the ledger a moment later, once pi has flushed the session file. The scan is incremental, so
 * unchanged session files are never opened again and this stays cheap.
 */
let usageSummaryTimer = null;
let usageDialogDraw = null; // set while the Usage dialog is open, so a settle can redraw it too

function scheduleUsageSummary(delayMs = 1500) {
  clearTimeout(usageSummaryTimer);
  usageSummaryTimer = setTimeout(() => {
    const before = state.usage && state.usage.all ? state.usage.all.total : 0;
    refreshUsageSummary()
      .then((res) => {
        if (!res || !res.ok) return;
        const moved = res.all && res.all.total !== before;
        if (moved) console.log(`[usage-live] ledger total ${before} \u2192 ${res.all.total} (the chip follows without a restart)`);
        // redraw an open dialog only when the numbers actually moved, so hovering a column is not
        // yanked away every time some other tab settles
        if (moved && usageDialogDraw) usageDialogDraw();
      })
      .catch((err) => console.error('[usage] summary refresh failed', err));
  }, delayMs);
}

function usageRangeFrom(rangeValue) {
  const days = Number(rangeValue);
  if (!Number.isFinite(days) || days <= 0) return null;
  return Date.now() - days * 86400000;
}

function usageTotalsLine(totals, extra, costParts) {
  if (!totals) return tr('no usage recorded');
  const parts = [
    tr('in {n}', { n: fmtTokens(totals.in || 0) }),
    tr('out {n}', { n: fmtTokens(totals.out || 0) }),
    tr('cache read {n}', { n: fmtTokens(totals.cacheRead || 0) }),
    tr('cache write {n}', { n: fmtTokens(totals.cacheWrite || 0) }),
    tr('total {n}', { n: fmtTokens(totals.total || 0) }),
    tr('{n} model calls', { n: totals.msgs || 0 }),
  ];
  // compact and branch-switch summaries are model calls too - saying so is what makes it obvious
  // that their tokens were not written off
  const extraCalls = [];
  if (totals.compactions) extraCalls.push(tr('{n} compact', { n: totals.compactions }));
  if (totals.branches) extraCalls.push(tr('{n} branch summary', { n: totals.branches }));
  if (extraCalls.length) parts.push(tr('({list})', { list: extraCalls.join(', ') }));
  if (costParts && costParts.total) {
    parts.push(tr('{total} = {in} in + {out} out + {cacheRead} cache read + {cacheWrite} cache write', {
      total: fmtMoney(costParts.total),
      in: fmtMoney(costParts.in),
      out: fmtMoney(costParts.out),
      cacheRead: fmtMoney(costParts.cacheRead),
      cacheWrite: fmtMoney(costParts.cacheWrite),
    }));
  } else if (totals.cost) {
    parts.push(tr('reported {cost}', { cost: `$${Number(totals.cost).toFixed(4)}` }));
  }
  if (extra) parts.push(extra);
  return parts.join(' \u00b7 ');
}

function usageBucketLine(bucket, mode, usagePrices) {
  const models = (bucket.models || []).slice(0, 3).map((model) => `${model.model} ${fmtTokens(model.total)}`).join(', ');
  const money = mode === 'cost' || hasPrices(usagePrices) ? bucketCostParts(bucket, usagePrices) : null;
  return [
    bucket.full || bucket.key,
    usageTotalsLine(bucket, '', money),
    tr(bucket.sessions === 1 ? '{n} session' : '{n} sessions', { n: bucket.sessions || 0 }),
    models ? tr('models: {list}', { list: models }) : '',
  ].filter(Boolean).join(' \u00b7 ');
}

/**
 * Axis maximum: a round number at least as big as the tallest column, chosen so the four gridlines
 * land on readable values (22.69M -> 24M, so the lines are 6M / 12M / 18M / 24M). The headroom also
 * keeps a column's own number from colliding with the top gridline.
 */
function usageAxisMax(maxValue) {
  if (!(maxValue > 0)) return 1;
  const quarter = maxValue / 4;
  const base = 10 ** Math.floor(Math.log10(quarter));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (quarter <= step * base) return step * base * 4;
  }
  return 40 * base;
}

/**
 * One stacked column per bucket, as SVG sized in pixels (the wrapper scrolls sideways when the range
 * is wide, which keeps the axis labels readable instead of shrinking them into illegibility).
 */
function buildUsageChart(container, report, onSelect, showCache = true, mode = 'tokens', usagePrices = null) {
  container.textContent = '';
  const buckets = (report && report.buckets) || [];
  if (!buckets.length) {
    container.appendChild(el('div', 'empty-hint', tr('No usage recorded in this range yet. The ledger fills in as sessions run.')));
    return 0;
  }
  const NS = 'http://www.w3.org/2000/svg';
  const colW = buckets.length > 40 ? 16 : buckets.length > 20 ? 24 : 34;
  const gap = buckets.length > 40 ? 6 : 10;
  const padLeft = 56;
  const padRight = 10;
  const padTop = 16;
  const padBottom = 30;
  const height = 250;
  const innerH = height - padTop - padBottom;
  const width = padLeft + padRight + buckets.length * (colW + gap);
  const maxRaw = Math.max(1, ...buckets.map((bucket) => {
    const values = usageSegmentValues(bucket, mode, usagePrices);
    return showCache ? values.total : values.in + values.out;
  }));
  const max = usageAxisMax(maxRaw);

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'usage-chart');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', tr('token usage per {unit}: {n} columns', { unit: tr(report.unit), n: buckets.length }));

  const mk = (tag, attrs, text) => {
    const node = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attrs || {})) node.setAttribute(name, value);
    if (text != null) node.textContent = text;
    return node;
  };

  // grid + y axis: the scale is the tallest column, not the total, so a cache-heavy day does not
  // flatten every other one
  for (let step = 0; step <= 4; step += 1) {
    const ratio = step / 4;
    const y = padTop + innerH - ratio * innerH;
    svg.appendChild(mk('line', { x1: padLeft - 6, y1: y, x2: width - padRight, y2: y, class: 'uc-grid' }));
    svg.appendChild(mk('text', { x: padLeft - 10, y: y + 4, class: 'uc-ylab', 'text-anchor': 'end' }, usageValueText(max * ratio, mode)));
  }

  const labelEvery = Math.max(1, Math.ceil(buckets.length / 16));
  buckets.forEach((bucket, index) => {
    const x = padLeft + index * (colW + gap);
    const values = usageSegmentValues(bucket, mode, usagePrices);
    const group = mk('g', { class: 'uc-col', tabindex: 0, role: 'button', 'aria-label': usageBucketLine(bucket, mode, usagePrices) });
    let acc = 0;
    for (const segment of USAGE_STACK) {
      if (!showCache && segment.key !== 'in' && segment.key !== 'out') continue;
      const value = values[segment.key] || 0;
      if (!value) continue;
      const top = padTop + innerH - ((acc + value) / max) * innerH;
      const h = (value / max) * innerH;
      group.appendChild(mk('rect', { x, y: top, width: colW, height: Math.max(1, h), class: `uc-seg ${segment.cls}` }));
      acc += value;
    }
    const total = showCache ? values.total : values.in + values.out;
    // a number above the column only fits when there are few of them
    if (buckets.length <= 16 && total) {
      group.appendChild(mk('text', { x: x + colW / 2, y: padTop + innerH - (total / max) * innerH - 5, class: 'uc-val', 'text-anchor': 'middle' }, usageValueText(total, mode)));
    }
    if (index % labelEvery === 0) {
      group.appendChild(mk('text', { x: x + colW / 2, y: height - 10, class: 'uc-xlab', 'text-anchor': 'middle' }, bucket.label));
    }
    // hit area: a thin column with a tiny value still has to be clickable
    group.appendChild(mk('rect', { x, y: padTop, width: colW, height: innerH, class: 'uc-hit' }));
    group.appendChild(mk('title', {}, usageBucketLine(bucket, mode, usagePrices)));
    const select = () => onSelect(bucket, group);
    group.addEventListener('mouseenter', select);
    group.addEventListener('click', select);
    group.addEventListener('focus', select);
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select();
      }
    });
    svg.appendChild(group);
  });

  container.appendChild(svg);
  return buckets.length;
}

async function openUsageModal() {
  let unit = 'day';
  let range = '90';
  let mode = 'tokens';
  let report = null;
  const currentPrices = () => (state.settings && state.settings.usagePrices) || null;

  const backdrop = el('div', 'modal-backdrop usage-backdrop');
  const modal = el('div', 'modal usage-modal');
  modal.appendChild(el('h3', '', tr('Token usage')));

  const hint = el('div', 'set-hint', tr('reading the usage ledger\u2026'));
  modal.appendChild(hint);

  const controls = el('div', 'field-row usage-controls');
  const unitSel = document.createElement('select');
  unitSel.setAttribute('aria-label', tr('Column size'));
  for (const option of USAGE_UNITS) {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = tr(option.label);
    unitSel.appendChild(opt);
  }
  const rangeSel = document.createElement('select');
  rangeSel.setAttribute('aria-label', tr('Time range'));
  for (const option of USAGE_RANGES) {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = tr(option.label);
    rangeSel.appendChild(opt);
  }
  const metricSel = document.createElement('select');
  metricSel.setAttribute('aria-label', tr('What the columns measure'));
  for (const option of [
    { value: 'tokens', label: tr('tokens') },
    { value: 'cost', label: tr('cost (USD)') },
  ]) {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = option.label;
    metricSel.appendChild(opt);
  }
  controls.appendChild(unitSel);
  controls.appendChild(rangeSel);
  controls.appendChild(metricSel);
  modal.appendChild(controls);

  const legend = el('div', 'usage-legend');
  for (const segment of [...USAGE_STACK].reverse()) {
    const chip = el('span', 'usage-legend-item');
    chip.appendChild(el('span', `usage-swatch ${segment.cls}`));
    chip.appendChild(el('span', '', tr(segment.label)));
    legend.appendChild(chip);
  }
  modal.appendChild(legend);

  /*
   * Cache reads are usually two orders of magnitude bigger than in/out (this machine: 32.4M against
   * 850k), which makes the interesting part of the stack a one-pixel cap. The toggle takes cache out
   * of the scale so in/out can actually be compared between days.
   */
  const cacheRow = el('label', 'usage-cache-toggle');
  const cacheBox = document.createElement('input');
  cacheBox.type = 'checkbox';
  cacheBox.checked = true;
  cacheBox.setAttribute('aria-label', tr('Include cache read and cache write in the stack'));
  cacheRow.appendChild(cacheBox);
  cacheRow.appendChild(el('span', '', tr('stack cache read / write (off: the columns show only in and out)')));
  modal.appendChild(cacheRow);

  const chartWrap = el('div', 'usage-chart-wrap');
  modal.appendChild(chartWrap);

  const detail = el('div', 'usage-detail', tr('Hover or click a column for the breakdown.'));
  modal.appendChild(detail);

  const totalsLine = el('div', 'usage-totals', '');
  modal.appendChild(totalsLine);

  const models = el('div', 'usage-models');
  modal.appendChild(models);

  /*
   * Strata reports no prices (pi's usage.cost is 0 for every call), so the money side is computed
   * from rates typed here: USD per 1,000,000 tokens, one row per model plus a default row. They live
   * in the settings file, and the ledger deliberately stores only token counts - re-pricing an old
   * day must not need a re-scan, and a rate change must not rewrite history.
   */
  const rates = el('div', 'usage-rates');
  rates.appendChild(el('div', 'set-hint', tr('rates (USD per 1,000,000 tokens) - Strata reports no prices, so these numbers are what the money side uses. Saved as soon as you leave a box. A model row only overrides the fields you fill in, the rest come from the default rate (its placeholder shows them); to make one model free, set the default row to 0 and give the others their own rows.')));
  const ratesGrid = el('div', 'usage-rates-grid');
  rates.appendChild(ratesGrid);
  modal.appendChild(rates);

  const actions = el('div', 'modal-actions');
  const recountButton = el('button', '', tr('Recount from files'));
  recountButton.title = tr('rebuild the ledger from the session files that exist right now - the only action that can lower the totals (sessions a cleanup deleted leave with their files)');
  const openButton = el('button', 'ghost', tr('Open ledger folder'));
  openButton.title = tr('reveal token_usage.json in the file manager');
  const closeButton = el('button', 'ghost', tr('Close'));
  actions.appendChild(recountButton);
  actions.appendChild(openButton);
  actions.appendChild(closeButton);
  modal.appendChild(actions);
  backdrop.appendChild(modal);
  els.modalRoot.appendChild(backdrop);

  let done = false;
  const opened = new Promise((resolve) => {
    const finish = () => {
      if (done) return;
      done = true;
      usageDialogDraw = null;
      backdrop.remove();
      modalOpen = null;
      resolve(report);
    };
    modalOpen = { finish, backdrop };
    closeButton.addEventListener('click', finish);
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) finish();
    });
  });

  const selectBucket = (bucket, group) => {
    for (const node of chartWrap.querySelectorAll('.uc-col.selected')) node.classList.remove('selected');
    if (group) group.classList.add('selected');
    detail.textContent = usageBucketLine(bucket, mode, currentPrices());
  };

  function renderRates() {
    ratesGrid.textContent = '';
    const prices = currentPrices() || {};
    const head = el('div', 'usage-rate-row usage-rate-head');
    head.appendChild(el('span', 'usage-rate-model', tr('model')));
    for (const field of PRICE_FIELDS) head.appendChild(el('span', 'usage-rate-cell', tr(PRICE_LABELS[field])));
    ratesGrid.appendChild(head);

    const rows = [{ key: 'default', label: tr('default rate') }];
    for (const model of (report && report.models) || []) {
      if (!rows.some((row) => row.key === model.model)) rows.push({ key: model.model, label: model.model });
    }
    const fallback = normalizePrice(prices.default);
    for (const row of rows) {
      const line = el('div', 'usage-rate-row');
      const name = el('span', 'usage-rate-model', row.label);
      name.title = row.key === 'default' ? tr('used for any model that has no row of its own') : tr('rate for {model}', { model: row.key });
      line.appendChild(name);
      const source = row.key === 'default' ? prices.default : (prices.byModel || {})[row.key];
      for (const field of PRICE_FIELDS) {
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.step = '0.01';
        input.value = source && source[field] != null && Number(source[field]) !== 0 ? String(source[field]) : '';
        // an empty model row means "the default rate applies", so show what that is
        input.placeholder = row.key === 'default' ? '0' : String(fallback[field] || 0);
        input.dataset.field = field;
        input.dataset.model = row.key;
        input.setAttribute('aria-label', tr('{label} {field} in USD per million tokens', { label: row.label, field: tr(PRICE_LABELS[field]) }));
        input.addEventListener('change', () => saveRates());
        line.appendChild(input);
      }
      ratesGrid.appendChild(line);
    }
  }

  async function saveRates() {
    const previous = (state.settings && state.settings.usagePrices) || {};
    const next = {
      unit: 'usd_per_million',
      default: { ...normalizePrice(previous.default) },
      byModel: {},
    };
    for (const [model, row] of Object.entries(previous.byModel || {})) next.byModel[model] = { ...normalizePrice(row) };
    for (const input of ratesGrid.querySelectorAll('input[type="number"]')) {
      const field = input.dataset.field;
      const modelKey = input.dataset.model;
      if (!PRICE_FIELDS.includes(field)) continue;
      const value = input.value === '' ? 0 : Number(input.value);
      const target = modelKey === 'default' ? next.default : next.byModel[modelKey] || (next.byModel[modelKey] = normalizePrice(null));
      target[field] = Number.isFinite(value) && value >= 0 ? value : 0;
    }
    // an all-empty model row must mean "the default rate applies", not "this model is free"
    next.byModel = pruneRateRows(next.byModel);
    const merged = await api.settingsSet({ usagePrices: next });
    state.settings = merged || { ...state.settings, usagePrices: next };
    updateUsageFoot();
    await draw();
    toast(hasPrices(next) ? tr('rates saved - {money} for this range', { money: fmtMoney(bucketCostParts({ models: (report && report.models) || [] }, next).total) }) : tr('rates cleared - the money side reads $0'), 'info', 6000);
  }

  function renderModels() {
    models.textContent = '';
    const list = (report && report.models) || [];
    if (!list.length) return;
    const prices = currentPrices();
    const priced = hasPrices(prices);
    models.appendChild(el('div', 'set-hint', priced ? tr('models in this range (priced at the rates below)') : tr('models in this range')));
    for (const model of list.slice(0, 8)) {
      const row = el('div', 'usage-model-row');
      row.appendChild(el('span', 'usage-model-name', model.model));
      const money = priced ? costOf(model, priceForModel(prices, model.model)) : 0;
      row.appendChild(
        el(
          'span',
          'usage-model-totals',
          tr('in {in} \u00b7 out {out} \u00b7 cache {cache} \u00b7 total {total}', {
            in: fmtTokens(model.in),
            out: fmtTokens(model.out),
            cache: fmtTokens((model.cacheRead || 0) + (model.cacheWrite || 0)),
            total: fmtTokens(model.total),
          }) + (money ? ` \u00b7 ${fmtMoney(money)}` : ''),
        ),
      );
      row.appendChild(el('span', 'usage-model-msgs', tr('{n} ans', { n: model.msgs })));
      models.appendChild(row);
    }
    if (list.length > 8) models.appendChild(el('div', 'set-hint', tr('{n} more models not shown', { n: list.length - 8 })));
  }

  async function draw() {
    const res = await api.usageSeries({ unit, fromMs: usageRangeFrom(range), limit: 0 });
    if (!res || !res.ok) {
      hint.textContent = tr('usage ledger failed: {error}', { error: (res && res.error) || tr('unknown error') });
      chartWrap.textContent = '';
      chartWrap.appendChild(el('div', 'note error', tr('could not read the usage ledger')));
      return;
    }
    report = res;
    const prices = currentPrices();
    const priced = hasPrices(prices);
    const costParts = bucketCostParts({ models: res.models || [] }, prices);
    // the footer chip is the ALL-TIME total, so a narrowed range in this dialog must not overwrite it -
    // only the `everything` range feeds the chip
    state.usage = {
      ...(state.usage || {}),
      ...(range === 'all' ? { all: res.totals, allModels: res.models } : {}),
      entries: res.entries,
      gone: res.gone,
      truncated: res.truncated,
      dedupeMissed: res.dedupeMissed,
      ledgerFile: res.ledgerFile,
    };
    updateUsageFoot();
    const notes = [];
    if (res.entries) notes.push(tr('{n} session in the ledger', { n: res.entries }));
    if (res.gone) notes.push(tr('{n} of them no longer exist on disk \u2014 their history is kept', { n: res.gone }));
    if (res.truncated) notes.push(tr('{n} session(s) were bigger than the 12 MB scan cap, so those are counted only up to that point', { n: res.truncated }));
    if (res.dedupeMissed) notes.push(tr('{n} fork(s) could not be deduplicated because their parent session file is gone, so their copied tokens may be counted twice', { n: res.dedupeMissed }));
    if (!priced) notes.push(tr('no rates entered below, so the money side is $0'));
    hint.textContent = `${usageTotalsLine(res.totals, '', costParts)} \u00b7 ${notes.join(' \u00b7 ') || tr('nothing recorded yet')} \u00b7 ${tr('ledger: {path}', { path: res.ledgerFile || tr('not set') })}`;
    totalsLine.textContent = [tr(USAGE_UNITS.find((entry) => entry.value === unit).label), tr('{n} columns', { n: res.buckets.length }), tr(USAGE_RANGES.find((entry) => entry.value === range).label), mode === 'cost' ? tr('columns in USD') : tr('columns in tokens')].join(' \u00b7 ');
    if (mode === 'cost' && !priced) {
      chartWrap.textContent = '';
      chartWrap.appendChild(el('div', 'empty-hint', tr('Enter the rates below (USD per 1,000,000 tokens) and the columns will show what each period cost.')));
    } else {
      buildUsageChart(chartWrap, res, selectBucket, cacheBox.checked, mode, prices);
    }
    renderModels();
    renderRates();
  }
  usageDialogDraw = draw;

  cacheBox.addEventListener('change', () => {
    if (report) buildUsageChart(chartWrap, report, selectBucket, cacheBox.checked, mode, currentPrices());
  });
  metricSel.addEventListener('change', () => {
    mode = metricSel.value === 'cost' ? 'cost' : 'tokens';
    draw();
  });
  unitSel.addEventListener('change', () => {
    unit = unitSel.value;
    draw();
  });
  rangeSel.addEventListener('change', () => {
    range = rangeSel.value;
    draw();
  });
  recountButton.addEventListener('click', async () => {
    // the one action that can lower the numbers: it rebuilds from the files on disk, so sessions a
    // cleanup already deleted leave the chart with it. Asking first is deliberate.
    const answer = await openModal({
      kind: 'confirm',
      title: tr('Recount the usage ledger from the files on disk?'),
      message: tr('Everything currently banked stays unless it comes from a session file that no longer exists. Sessions a cleanup already deleted leave the chart with their files - that is the point of this button, and it cannot be undone.'),
      okLabel: tr('Recount'),
    });
    if (!answer || !answer.confirmed) return;
    recountButton.disabled = true;
    const res = await api.usageRecount();
    recountButton.disabled = false;
    if (!res || !res.ok) {
      toast(tr('recount failed: {error}', { error: (res && res.error) || tr('unknown') }), 'error', 8000);
      return;
    }
    toast(tr('recounted: {parsed} session files read, {dropped} entries of deleted sessions dropped{deduped}', {
      parsed: res.parsed,
      dropped: res.droppedGone || 0,
      deduped: res.deduped ? tr(', {n} copied records recognised as forks', { n: res.deduped }) : '',
    }), 'info', 9000);
    await draw();
  });
  openButton.addEventListener('click', async () => {
    const file = report && report.ledgerFile;
    if (!file) {
      toast(tr('the ledger file is not set'), 'warning');
      return;
    }
    await api.openPath(file, true);
  });

  rangeSel.value = range;
  unitSel.value = unit;
  metricSel.value = mode;
  await draw();
  return opened;
}

/* accessibility (D3)                                                  */
/* ------------------------------------------------------------------ */

/*
 * The app grew without any accessibility work, so instead of touching every dialog and every icon
 * button by hand, two observers do it centrally:
 *
 *  - dialogs: whatever gets appended to #modalRoot becomes a real dialog (role, aria-modal, a label
 *    taken from its heading, focus moved in, Tab kept inside, Esc mapped to its Cancel/Close button,
 *    focus given back to the element that opened it);
 *  - controls: a button whose visible text is empty or a single glyph (the "x" of a tab, the "top"
 *    arrow, ...) gets an accessible name from its title, which every one of them already has.
 *
 * Both are cheap: the observers only look at the nodes that were actually added.
 */

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let dialogOpener = null;
let dialogStack = [];
