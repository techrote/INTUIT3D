import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {importAsciiDxf,renderDxfSketchSvg} from '../index.mjs';
const input=process.argv[2]??fileURLToPath(new URL('../fixtures/rounded-120x80.dxf',import.meta.url));
const output=process.argv[3]??fileURLToPath(new URL('./rounded-plate-preview.svg',import.meta.url));
const parsed=importAsciiDxf(await readFile(input,'utf8'));
await writeFile(output,renderDxfSketchSvg(parsed),'utf8');
console.log(JSON.stringify({output,source:input,units:'mm',
  entities:parsed.entities.length,arcs:parsed.entities.filter(e=>e.kind==='arc').length,
  evidence:'analytic_2d_svg_preview_only_not_BREP_or_STEP'},null,2));
