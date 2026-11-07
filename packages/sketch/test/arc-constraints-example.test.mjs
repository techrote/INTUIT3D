import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('public package importing nonlinear plate example executes real solve, replay and explicit failure',()=>{
  const path=fileURLToPath(new URL('../examples/nonlinear-rounded-plate.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[path],{encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stderr);
  const rows=result.stdout.trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(rows.map(x=>x.step),
    ['initial','edited-width-corner-hole','reopened','oversized-radius-admission']);
  assert.deepEqual(rows[1],{...rows[2],step:'edited-width-corner-hole'});
  assert.equal(rows[0].widthMm,120);
  assert.ok(Math.abs(rows[1].widthMm-150)<1e-6);
  assert.ok(Math.abs(rows[1].corner1RadiusMm-14)<1e-6);
  assert.equal(rows[1].holeARadiusMm,7);
  assert.equal(rows[1].nativeProfileAdmissible,false);
  assert.equal(rows[3].admission,'refused');
  assert.match(rows[3].reason,/reversed or discontinuous/);
});
