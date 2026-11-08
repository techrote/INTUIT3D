import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSolidHoleNumber} from './solidHoleQuickEdit.ts';

test('contextual 3D bore accepts signed millimetre centres and positive diameter',()=>{
  assert.equal(parseSolidHoleNumber('36.25','x'),36.25);
  assert.equal(parseSolidHoleNumber('-4.5','y'),-4.5);
  assert.equal(parseSolidHoleNumber('13','diameter'),13);
  assert.equal(parseSolidHoleNumber('0','x'),0);
});

test('contextual edit refuses empty, nonfinite, out-of-range and nonpositive inputs',()=>{
  for(const source of ['',' ','NaN','Infinity','10000.1','-10001','1e309']){
    assert.throws(()=>parseSolidHoleNumber(source,'x'));
    assert.throws(()=>parseSolidHoleNumber(source,'diameter'));
  }
  for(const source of ['0','-1','-0.01'])
    assert.throws(()=>parseSolidHoleNumber(source,'diameter'),/Bore diameter/);
  assert.equal(parseSolidHoleNumber('-10000','y'),-10000);
  assert.equal(parseSolidHoleNumber('10000','diameter'),10000);
});
