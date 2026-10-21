'use strict';

/*
 * #12: the dialog machinery lives in renderer/modals.js.
 *
 * This boundary exists partly to undo a mistake the storage move made: FOCUSABLE, dialogOpener and
 * dialogStack sat between the usage functions, so the scripted move carried the state of the modal
 * system into a file about disk usage. Nothing broke (the names are global), which is exactly why it
 * is worth fixing: a split that is invisible in behaviour is invisible in review too, and the next
 * person finds it while debugging a focus bug.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const READER = path.join(__dirname, '..', 'renderer');
const read = (name) => fs.readFileSync(path.join(READER, name), 'utf8');

const FUNCS = ['openSimpleModal', 'decorateDialog', 'observeDialogs', 'openModal'];
const STATE = ['FOCUSABLE', 'dialogOpener', 'dialogStack'];

test('the modal functions and the state they own live in modals.js', () => {
  const modals = read('modals.js');
  for (const name of FUNCS) {
    const decl = new RegExp(`^(?:async )?function ${name}\\(`, 'm');
    assert.ok(decl.test(modals), `${name} should live in renderer/modals.js`);
    assert.ok(!decl.test(read('app.js')), `${name} is declared in both files`);
  }
  for (const name of STATE) {
    const decl = new RegExp(`^(?:const|let) ${name}\\b`, 'm');
    assert.ok(decl.test(modals), `${name} should live in renderer/modals.js`);
    for (const other of ['app.js', 'storage.js']) {
      assert.ok(!decl.test(read(other)), `${name} is declared in ${other} as well`);
    }
  }
});

test('the page loads modals.js before the scripts that use it', () => {
  const order = [...read('index.html').matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const at = order.indexOf('modals.js');
  assert.ok(at > -1, 'the packaged page must load modals.js');
  for (const later of ['tree.js', 'settings.js', 'storage.js', 'app.js']) {
    assert.ok(at < order.indexOf(later), `modals.js must load before ${later}`);
  }
});
