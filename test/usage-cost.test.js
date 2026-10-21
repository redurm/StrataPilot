'use strict';

/*
 * Unit tests for the money side of the Usage dialog (D9): pricing token counts at rates the user
 * types, because Strata reports no prices (pi's usage.cost.total is 0 for every call here).
 *
 * Like queue-label.test.js and tree-depth.test.js, this pulls the pure functions out of the browser
 * script `renderer/app.js` (which cannot be required - it touches the DOM as it loads) and runs them
 * against plain objects. The constants they close over are read from the same source, so the test
 * cannot drift away from the real definitions.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = ['renderer/app.js', 'renderer/storage.js', 'renderer/settings.js', 'renderer/modals.js', 'renderer/composer.js', 'renderer/transcript.js', 'renderer/monitor.js', 'renderer/chrome.js']
  .map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8'))
  .join(String.fromCharCode(10));

/** Return the single-line `const NAME = ...;` declaration from the renderer source. */
function constSource(name) {
  const match = appSource.match(new RegExp(`^const ${name} = .*;$`, 'm'));
  assert.ok(match, `renderer/app.js or renderer/storage.js no longer has a one-line \`const ${name}\``);
  return match[0];
}

/** Return the text of a top-level `function name(...) { ... }` in the renderer source. */
function functionSource(name) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `renderer/app.js or renderer/storage.js no longer defines ${name}()`);
  const open = appSource.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < appSource.length; index += 1) {
    if (appSource[index] === '{') depth += 1;
    else if (appSource[index] === '}') {
      depth -= 1;
      if (depth === 0) return appSource.slice(start, index + 1);
    }
  }
  throw new Error(`unbalanced braces after ${name}()`);
}

const SOURCE = [
  constSource('PRICE_FIELDS'),
  constSource('PRICE_LABELS'),
  constSource('TOKENS_PER_MILLION'),
  functionSource('priceNumber'),
  functionSource('normalizePrice'),
  functionSource('priceForModel'),
  functionSource('hasPrices'),
  functionSource('pruneRateRows'),
  functionSource('costOf'),
  functionSource('fieldCost'),
  functionSource('bucketCostParts'),
  functionSource('fmtMoney'),
  functionSource('usageStackTotal'),
  functionSource('usageSegmentValues'),
].join('\n\n');

// i18nKey() only declares a string for the catalogs; in here it is the identity, as it is at runtime
// before a language is installed.
global.i18nKey = (text) => text;

const usage = new Function(`${SOURCE}\nreturn { PRICE_FIELDS, PRICE_LABELS, normalizePrice, priceForModel, hasPrices, pruneRateRows, costOf, fieldCost, bucketCostParts, fmtMoney, usageStackTotal, usageSegmentValues };`)();

const round = (value) => Math.round(value * 1e6) / 1e6;

/* ---- rates ---- */

test('pruneRateRows(): an empty model row falls back to the default instead of shadowing it', () => {
  // writing zeros for a row the user never typed would make that model free and the chart read $0
  const byModel = {
    typed: { in: 0.5, out: 0, cacheRead: 0, cacheWrite: 0 },
    untouched: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 },
    junk: null,
  };
  const kept = usage.pruneRateRows(byModel);
  assert.deepEqual(Object.keys(kept), ['typed']);
  assert.deepEqual(kept.typed, { in: 0.5, out: 0, cacheRead: 0, cacheWrite: 0 });

  const prices = { default: { in: 1, out: 2, cacheRead: 0.1, cacheWrite: 0.2 }, byModel: kept };
  assert.equal(usage.priceForModel(prices, 'untouched').in, 1, 'the default rate applies again');
  assert.equal(usage.priceForModel(prices, 'typed').in, 0.5, 'a typed row wins');
  assert.equal(usage.priceForModel(prices, 'typed').out, 2, 'and the fields it does not set come from the default');
  assert.equal(usage.hasPrices(prices), true);
});

test('the rate table is the four things that can be priced', () => {
  assert.deepEqual(usage.PRICE_FIELDS, ['in', 'out', 'cacheRead', 'cacheWrite']);
  assert.deepEqual(Object.keys(usage.PRICE_LABELS), usage.PRICE_FIELDS);
});

test('normalizePrice(): anything that is not a positive number becomes 0', () => {
  assert.deepEqual(usage.normalizePrice(null), { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 });
  assert.deepEqual(usage.normalizePrice({ in: '2.5', out: -1, cacheRead: 'abc' }), { in: 2.5, out: 0, cacheRead: 0, cacheWrite: 0 });
});

test('hasPrices(): false until at least one rate is set, on the default row or any model row', () => {
  assert.equal(usage.hasPrices(null), false);
  assert.equal(usage.hasPrices({}), false);
  assert.equal(usage.hasPrices({ default: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 } }), false);
  assert.equal(usage.hasPrices({ default: { in: 0.5 } }), true);
  assert.equal(usage.hasPrices({ default: {}, byModel: { m: { cacheRead: 0.1 } } }), true);
});

test('priceForModel(): exact, provider-qualified both ways, then the default row', () => {
  const prices = {
    default: { in: 1, out: 2, cacheRead: 3, cacheWrite: 4 },
    byModel: {
      'strata/cheap': { in: 0.1, out: 0.2, cacheRead: 0.01, cacheWrite: 0.05 },
      bare: { in: 9, out: 9, cacheRead: 9, cacheWrite: 9 },
    },
  };
  assert.deepEqual(usage.priceForModel(prices, 'strata/cheap').in, 0.1);
  // the ledger records the bare model id, settings may carry the provider-qualified row
  assert.equal(usage.priceForModel(prices, 'cheap').in, 0.1);
  // and the reverse: a bare row in settings, a qualified id from the ledger
  assert.equal(usage.priceForModel(prices, 'strata/bare').in, 9);
  // unknown model -> the default row
  assert.equal(usage.priceForModel(prices, 'something-else').in, 1);
  // a model row is a PATCH over the default: filling in one field must not make the other three free
  const partial = {
    default: { in: 1, out: 2, cacheRead: 3, cacheWrite: 4 },
    byModel: { only_in: { in: 4, out: 0, cacheRead: 0, cacheWrite: 0 } },
  };
  assert.deepEqual(usage.priceForModel(partial, 'only_in'), { in: 4, out: 2, cacheRead: 3, cacheWrite: 4 });
  // no prices at all -> all zero, so the money side is $0 rather than NaN
  assert.deepEqual(usage.priceForModel(null, 'x'), { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 });
});

/* ---- cost ---- */

test('costOf(): rates are USD per 1,000,000 tokens, and the four fields add up', () => {
  const price = { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 };
  assert.equal(round(usage.costOf({ in: 1000000, out: 0, cacheRead: 0, cacheWrite: 0 }, price)), 3);
  assert.equal(round(usage.costOf({ in: 0, out: 1000000, cacheRead: 0, cacheWrite: 0 }, price)), 15);
  assert.equal(round(usage.costOf({ in: 0, out: 0, cacheRead: 1000000, cacheWrite: 0 }, price)), 0.3);
  assert.equal(round(usage.costOf({ in: 0, out: 0, cacheRead: 0, cacheWrite: 1000000 }, price)), 3.75);
  assert.equal(round(usage.costOf({ in: 500000, out: 200000, cacheRead: 2000000, cacheWrite: 0 }, price)), 1.5 + 3 + 0.6);
  assert.equal(usage.costOf({ in: 10, out: 5 }, null), 0, 'no rates, no money - and never NaN');
});

test('bucketCostParts(): each model is priced at its own rate', () => {
  const prices = {
    default: { in: 1, out: 2, cacheRead: 0.5, cacheWrite: 0.5 },
    byModel: {
      cheap: { in: 0.1, out: 0.2, cacheRead: 0.01, cacheWrite: 0.02 },
      pricey: { in: 10, out: 30, cacheRead: 1, cacheWrite: 10 },
    },
  };
  const bucket = {
    in: 2000000,
    out: 1000000,
    cacheRead: 4000000,
    models: [
      { model: 'cheap', in: 1000000, out: 500000, cacheRead: 3000000, cacheWrite: 0 },
      { model: 'pricey', in: 1000000, out: 500000, cacheRead: 1000000, cacheWrite: 0 },
    ],
  };
  const parts = usage.bucketCostParts(bucket, prices);
  assert.equal(round(parts.in), 0.1 + 10);
  assert.equal(round(parts.out), 0.1 + 15);
  assert.equal(round(parts.cacheRead), 0.03 + 1);
  assert.equal(round(parts.total), round(parts.in + parts.out + parts.cacheRead + parts.cacheWrite));
});

test('bucketCostParts(): a bucket without a model split falls back to the default rate', () => {
  const prices = { default: { in: 2, out: 4, cacheRead: 1, cacheWrite: 1 }, byModel: {} };
  const parts = usage.bucketCostParts({ in: 1000000, out: 500000, cacheRead: 2000000, cacheWrite: 0 }, prices);
  assert.equal(round(parts.in), 2);
  assert.equal(round(parts.out), 2);
  assert.equal(round(parts.cacheRead), 2);
  assert.equal(round(parts.total), 6);
});

test('bucketCostParts(): the four priced fields add up to the priced total', () => {
  // a regression: an earlier version added each model's whole cost to every field, which multiplied
  // the column by four and made the stack taller than the axis
  const prices = { default: { in: 1, out: 2, cacheRead: 0.1, cacheWrite: 0.5 }, byModel: {} };
  const bucket = {
    in: 1000000,
    out: 500000,
    cacheRead: 3000000,
    cacheWrite: 250000,
    models: [{ model: 'm', in: 1000000, out: 500000, cacheRead: 3000000, cacheWrite: 250000 }],
  };
  const parts = usage.bucketCostParts(bucket, prices);
  assert.equal(round(parts.in + parts.out + parts.cacheRead + parts.cacheWrite), round(parts.total));
  assert.equal(round(parts.total), round(usage.costOf(bucket, prices.default)), 'priced total must match the same tokens priced once');
});

test('bucketCostParts(): no rates at all is $0, not NaN', () => {
  const parts = usage.bucketCostParts({ in: 123, out: 45, models: [{ model: 'm', in: 123, out: 45 }] }, null);
  assert.equal(parts.total, 0);
  assert.ok(Number.isFinite(parts.total));
});

/* ---- formatting and the chart's value mode ---- */

test('fmtMoney(): readable at every size, and never a fake cent', () => {
  assert.equal(usage.fmtMoney(0), '$0');
  assert.equal(usage.fmtMoney(0.004), '<$0.01');
  assert.equal(usage.fmtMoney(12.345), '$12.35');
  assert.equal(usage.fmtMoney(1234.5), '$1,234.5');
  assert.equal(usage.fmtMoney(1234567.89), '$1,234,568');
  assert.equal(usage.fmtMoney(undefined), '$0');
});

test('usageSegmentValues(): the same column, in tokens or in dollars', () => {
  const bucket = {
    in: 1000000,
    out: 500000,
    cacheRead: 3000000,
    cacheWrite: 0,
    models: [{ model: 'm', in: 1000000, out: 500000, cacheRead: 3000000, cacheWrite: 0 }],
  };
  const tokens = usage.usageSegmentValues(bucket, 'tokens', null);
  assert.deepEqual({ in: tokens.in, out: tokens.out, cacheRead: tokens.cacheRead, total: tokens.total }, { in: 1000000, out: 500000, cacheRead: 3000000, total: 4500000 });
  assert.equal(tokens.total, usage.usageStackTotal(bucket));

  const prices = { default: { in: 1, out: 2, cacheRead: 0.1, cacheWrite: 0 }, byModel: {} };
  const money = usage.usageSegmentValues(bucket, 'cost', prices);
  assert.equal(round(money.in), 1);
  assert.equal(round(money.out), 1);
  assert.equal(round(money.cacheRead), 0.3);
  assert.equal(round(money.total), 2.3);
});
