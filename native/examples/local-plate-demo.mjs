#!/usr/bin/env node
// Runnable local-first experimental plate/cut/retrospective-thickness demonstration.
// This is NOT production exact CAD/independent STEP interoperability.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {parsePlateRequest} from '../../packages/kernel-contract/src/plate-v1.mjs';
import {runExperimentalPlate} from '../../packages/kernel-contract/src/local-plate-provider.mjs';

const [outputArg, thicknessArg = '12'] = process.argv.slice(2);
if (!outputArg) {
  console.error('Usage: node native/examples/local-plate-demo.mjs <new-step-path> [edited-thickness-mm]');
  process.exitCode = 2;
} else {
  const editedThickness = Number(thicknessArg);
  const fixture = fileURLToPath(new URL('./plate-two-holes.request.json', import.meta.url));
  try {
    const original = parsePlateRequest(JSON.parse(await readFile(fixture, 'utf8')));
    const output = resolve(outputArg);
    const initial = await runExperimentalPlate(original, {
      readCurrentRevision: () => original.revision,
      stepOutput: output,
    });
    if (initial.kind !== 'experimental_report' || !initial.artifact)
      throw new Error('native export unresolved: ' + JSON.stringify(initial));
    const changed = parsePlateRequest({
      ...original, revision: original.revision + 1, exportStep:false,
      plate:{...original.plate, thickness:editedThickness},
    });
    const revision2 = await runExperimentalPlate(changed, {
      readCurrentRevision: () => changed.revision,
    });
    if (revision2.kind !== 'experimental_report')
      throw new Error('edited native rebuild unresolved: ' + JSON.stringify(revision2));
    console.log(JSON.stringify({
      evidence:'experimental_OCP_7.9.3.1_same_engine_STEP_readback',
      exactAuthority:false, independentInteroperability:false,
      initial:{thicknessMm:original.plate.thickness,
        volumeMm3:initial.observed.source.volumeMm3,
        solidCount:initial.observed.source.solidCount,
        holes:initial.observed.source.cylindricalHoles.length,
        step:initial.artifact},
      edited:{thicknessMm:changed.plate.thickness,
        volumeMm3:revision2.observed.source.volumeMm3,
        solidCount:revision2.observed.source.solidCount,
        holes:revision2.observed.source.cylindricalHoles.length},
    },null,2));
  } catch (error) {
    console.error('Experimental local CAD flow failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
