import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIMENSION_EXPRESSION_VERSION, evaluateDimensionExpression as mm } from './dimensionExpression.ts';

test('preview-only v1 contract is explicitly distinguished from persistent bindings', () => {
  assert.equal(DIMENSION_EXPRESSION_VERSION, 'intuit3d.web-preview.dimension-expression/v1');
});
for (const [source, expected] of [
  ['120', 120], ['1in', 25.4], ['2.5 cm', 25], ['25.4mm', 25.4],
  ['1in + 5 mm', 30.4], ['1in + 5', 30.4], ['(2+3)*10', 50],
  ['2*(35mm+5mm)', 80], ['30mm / 3', 10], ['-2.5cm + 40mm', 15],
  ['1e2 / 4', 25], ['.5in', 12.7], ['1.25e-2 cm', 0.125],
  ['6mm / 3mm', 2], ['12 / (2 + 1)', 4], ['+5', 5],
] as const) {
  test('evaluates ' + source + ' to ' + expected + ' mm', () => {
    assert.ok(Math.abs(mm(source) - expected) < 1e-12, source);
  });
}
for (const source of [
  '', '   ', '1+', '1//2', '(2+3', '2+3)', '2(3)', '1foo', 'NaN', 'Infinity',
  'Math.random()', 'process.exit()', '1;alert(1)', '1mm * 1cm', '1/2mm',
  '1mm + 2mm*3mm', '1cm/0', '1e309', '1e-325', '1e-300*1e-300',
  '1e-300/1e100', '(((((((((((((1)))))))))))))', '1 '.repeat(130),
  Array(65).fill('1').join('+'), '1,5', '1m', '10µm', '2mm**3',
]) {
  test('fails closed for unsupported or unsafe ' + JSON.stringify(source.slice(0, 35)), () => {
    assert.throws(() => mm(source), Error);
  });
}
test('negative, zero, and beyond-plate-budget values remain editable scalar intent', () => {
  assert.equal(mm('-2mm'), -2);
  assert.equal(mm('0'), 0);
  assert.equal(mm('20000mm'), 20000);
});
