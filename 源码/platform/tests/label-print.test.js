'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const { printLabelDocument } = require('../desktop/label-print');
const layout = require('../domain/label-layout');
const plan = () =>
  layout.plan(
    {
      ...layout.preset('fixture'),
      paperSize: 'custom',
      paperWidth: 130,
      paperHeight: 90,
      width: 30,
      height: 20,
      signatures: false,
      showName: false,
    },
    [{ code: 'S-001' }],
  );
function fake() {
  const calls = [];
  class Window {
    constructor(options) {
      calls.push({ type: 'window', options });
      this.webContents = {
        setWindowOpenHandler: () => {},
        printToPDF: async (options) => {
          calls.push({ type: 'pdf', options });
          return Buffer.from('pdf');
        },
        print: (options, callback) => {
          calls.push({ type: 'print', options });
          callback(true);
        },
      };
    }
    async loadURL(url) {
      calls.push({ type: 'load', url });
    }
    isDestroyed() {
      return false;
    }
    destroy() {
      calls.push({ type: 'destroy' });
    }
  }
  return { Window, calls };
}
test('custom paper uses inches for PDF and microns for printer, preserving the exact requested physical size', async () => {
  const a = fake(),
    p = plan();
  await printLabelDocument(a.Window, p, { print: false, authorize: () => {} });
  const pdf = a.calls.find((c) => c.type === 'pdf');
  assert.equal(pdf.options.pageSize.width, 130 / 25.4);
  assert.equal(pdf.options.pageSize.height, 90 / 25.4);
  assert.equal(pdf.options.preferCSSPageSize, true);
  assert.equal(a.calls.at(-1).type, 'destroy');
  const b = fake();
  await printLabelDocument(b.Window, p, { print: true, authorize: () => {} });
  const printer = b.calls.find((c) => c.type === 'print');
  assert.deepEqual(printer.options.pageSize, { width: 130000, height: 90000 });
  assert.equal(printer.options.silent, false);
  assert.equal(printer.options.landscape, false);
});
test('session authorization failure closes the print window before any PDF or physical print request', async () => {
  const a = fake();
  await assert.rejects(
    printLabelDocument(a.Window, plan(), {
      print: false,
      authorize: () => {
        throw Error('controlled');
      },
    }),
    { code: 'LABEL_DOCUMENT_FAILED' },
  );
  assert.ok(!a.calls.some((c) => ['pdf', 'print'].includes(c.type)));
  assert.equal(a.calls.at(-1).type, 'destroy');
});
