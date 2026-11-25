// What the plan page shows of what is approved: the whole address of a goto and of a link, the form a control submits, the control id,
// typed values as written, the effect beside the step number, and the use case's words before its table. No browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { planRows } from '../scripts/lib/plan-rows.mjs';
import { planPage } from '../scripts/lib/plan-page.mjs';
import { control, page, link, scoutOf, specOf, loginScout, loginSpec } from './fixtures/plan-scouts.mjs';

const ORIGIN = 'http://127.0.0.1:4001';
const OTHER = 'http://127.0.0.1:4002';
const EXPLAINER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../make-explainer');
const { validateSpec } = await import(pathToFileURL(path.join(EXPLAINER, 'scripts/lib/spec.mjs')).href);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-plan-address-'));

function build(spec, scout) {
  const result = planRows(spec, scout);
  assert.deepEqual(result.errors, [], JSON.stringify(result.errors));
  return planPage(spec, scout, result, new Map());
}
const tables = (out) => out.sections.filter((s) => s.type === 'table');
const firstTable = (out) => tables(out)[0];
const approvals = (out) => out.sections.filter((s) => s.type === 'approval');

test('a goto row shows the whole address: path, query and hash; the origin only when it is not the start origin', () => {
  const scout = scoutOf([page()], { origins: [ORIGIN, OTHER] });
  const spec = specOf([{ id: 'a', do: 'goto', value: '/cart?add-to-cart=12#top' }, { id: 'b', do: 'goto', value: `${OTHER}/x?y=1` }, { id: 'c', do: 'goto', value: `${ORIGIN}/plain` }], { origins: [ORIGIN, OTHER] });
  const cells = firstTable(build(spec, scout)).rows.map((r) => r[4]);
  assert.ok(cells[1].includes('`/cart?add-to-cart=12#top`'), cells[1]);
  assert.ok(cells[2].includes(`\`${OTHER}/x?y=1\``), cells[2]);
  assert.ok(cells[3].includes('`/plain`') && !cells[3].includes(ORIGIN), cells[3]);
  assert.match(cells[1], /^not scouted/);
});

test('a danger approval for a goto shows the address that holds the danger word', () => {
  const out = build(specOf([{ id: 'del', do: 'goto', value: '/x?delete=1' }]), scoutOf([page()]));
  assert.ok(approvals(out)[0].item.includes('`/x?delete=1`'), approvals(out)[0].item);
  assert.ok(!/goto {2}on/.test(approvals(out)[0].item), 'no empty cell in the sentence');
});

test('a click row shows the link address, or the method and action of the form, after the name, cut at 200 characters', () => {
  const longHref = `${ORIGIN}/${'a'.repeat(300)}`;
  const scout = scoutOf([page({ controls: [link('Docs', '/docs?page=2'), control({ id: 'c2', name: 'Go', css: 'go', submits: true, formAction: `${ORIGIN}/danger/delete`, formMethod: 'post' }), link('Long', '/x', { id: 'c3', href: longHref, css: 'long' })] })]);
  const spec = specOf([{ id: 'a', do: 'hover', target: { role: 'link', name: 'Docs' } }, { id: 'b', do: 'hover', target: { role: 'button', name: 'Go' } }, { id: 'c', do: 'hover', target: { role: 'link', name: 'Long' } }]);
  const cells = firstTable(build(spec, scout)).rows.map((r) => r[3]);
  assert.match(cells[1], /link `Docs` to `\/docs\?page=2`/);
  assert.match(cells[2], /button `Go` in form `POST \/danger\/delete`/);
  assert.match(cells[3], /to `\/a{199}…\[\d+ more characters\]`/, 'cut at 200');
});

test('a masked address prints <id>, not %3Cid%3E', () => {
  const spec = { ...loginSpec(), useCases: [{ id: 'uc', title: 'T', steps: [{ id: 'open', do: 'goto', value: '/login/home' }, { id: 'card', do: 'hover', target: { css: 's2' } }] }] };
  const cell = firstTable(build(spec, loginScout())).rows[1][3];
  assert.ok(cell.includes('to `/login/card/<id>`'), cell);
  assert.ok(!JSON.stringify(build(spec, loginScout())).includes('%3Cid%3E'));
});

test('the target cell starts with the page and the control id, so two rows that read the same can be told apart', () => {
  const scout = scoutOf([page({ controls: [control({ id: 'c12', name: 'Save', css: 'save' }), control({ id: 'c13', name: 'Save', css: 'save2' })] })]);
  const out = build(specOf([{ id: 'a', do: 'hover', target: { css: 'save' } }, { id: 'b', do: 'hover', target: { css: 'save2' } }]), scout);
  const cells = firstTable(out).rows.map((r) => r[3]);
  assert.match(cells[1], /^p1 c12 button /);
  assert.match(cells[2], /^p1 c13 button /);
});

test('css on the plan is cut from the left, so its end shows; a control with no name shows it', () => {
  const css = `html > ${'div:nth-of-type(1) > '.repeat(20)}button:nth-of-type(7)`;
  const out = build(specOf([{ id: 'a', do: 'hover', target: { css } }]), scoutOf([page({ controls: [control({ name: '', css })] })]));
  const cell = firstTable(out).rows[1][3];
  assert.match(cell, /`\[\d+ more characters\]….*button:nth-of-type\(7\)`/);
});

test('a typed value is shown as written, signed in too, with its spaces and no masking', () => {
  const typed = 'maria.ostrowski@example.test  and  more';
  const spec = loginSpec();
  spec.useCases[0].steps[5] = { ...spec.useCases[0].steps[5], value: typed };
  const cell = firstTable(build(spec, loginScout())).rows.at(-1)[5];
  assert.equal(cell, `\`${typed}\``);
});

test('the effect column sits right after n, in the use case tables and the changes table', () => {
  const out = build(specOf([{ id: 'w', do: 'press', value: 'Tab' }]), scoutOf([page()]));
  assert.deepEqual(firstTable(out).columns.slice(0, 3), ['n', 'effect', 'do']);
  const changes = tables(out).find((t) => t.columns.includes('use case'));
  assert.deepEqual(changes.columns.slice(0, 3), ['n', 'effect', 'use case']);
  assert.equal(firstTable(out).rows[1][1], 'change');
});

test('a table of 4 or more rows says to scroll it; one of 3 does not', () => {
  const steps = (n) => Array.from({ length: n }, (_, i) => ({ id: `w${i}`, do: 'wait', value: 1 }));
  assert.match(firstTable(build(specOf(steps(3)), scoutOf([page()]))).caption, /Scroll the table to see all 4 rows\./);
  assert.ok(!/Scroll/.test(firstTable(build(specOf(steps(2)), scoutOf([page()]))).caption ?? ''));
});

test('the scroll note also stands above the table, where a clipped table cannot hide it', () => {
  const steps = (n) => Array.from({ length: n }, (_, i) => ({ id: `w${i}`, do: 'wait', value: 1 }));
  const words = (n) => { const out = build(specOf(steps(n)), scoutOf([page()])); return out.sections[out.sections.findIndex((s) => s.type === 'table') - 1].text; };
  assert.match(words(3), /The table below scrolls; it has 4 rows\./);
  assert.ok(!/scrolls/.test(words(2)));
});

test('the use case title and goal stand in a text section before its table, as code, and the plan validates', async () => {
  const out = build(specOf([{ id: 'w', do: 'wait', value: 1 }]), scoutOf([page()]));
  const at = out.sections.findIndex((s) => s.type === 'table');
  const before = out.sections[at - 1];
  assert.equal(before.type, 'text');
  assert.ok(before.text.includes('`A use case`') && before.text.includes('`Something to do`'), before.text);
  assert.ok(!/A use case/.test(firstTable(out).caption ?? ''));
  const found = await validateSpec(out, { dir });
  assert.deepEqual(found.errors.map((e) => `${e.path}: ${e.message}`), []);
  assert.ok(!found.warnings.some((w) => /title is \d+ words|is a label/.test(w.message)), JSON.stringify(found.warnings));
});
