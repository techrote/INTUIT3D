#!/usr/bin/env node
/**
 * Reconstruct Windows npm workspace junctions after extracting an evaluation
 * ZIP. They cannot be shipped as ordinary directories: Node's built-in TS
 * stripper refuses project .ts sources physically located in node_modules.
 *
 * This makes only local filesystem junctions to bundled project workspaces,
 * and performs no npm install, download or network request.
 */
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  realpathSync, rmSync, symlinkSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const namespace = join(root, 'node_modules', '@intuit3d');
const canonical = path => realpathSync(path).toLowerCase();
function fail(message) { throw new Error(message); }

try {
  if (process.platform !== 'win32') fail('This launcher prepares Windows-specific junctions only');
  if (!existsSync(namespace)) fail('Missing bundled npm workspace packages: extract the complete ZIP');
  const workspaces = [];
  for (const parent of ['apps', 'packages']) {
    const container = join(root, parent);
    if (!existsSync(container)) continue;
    for (const item of readdirSync(container, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      if (!item.isDirectory()) continue;
      const target = join(container, item.name);
      const manifestPath = join(target, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (!/^@intuit3d\/[a-z0-9-]+$/.test(pkg.name || '')) fail('Unexpected workspace package name in ' + manifestPath);
      const alias = join(namespace, pkg.name.slice('@intuit3d/'.length));
      if (!existsSync(alias)) fail('Missing bundled workspace alias: ' + pkg.name);
      if (lstatSync(alias).isSymbolicLink()) {
        if (canonical(alias) !== canonical(target)) fail('Existing workspace link does not match source: ' + pkg.name);
      } else {
        if (!lstatSync(alias).isDirectory()) fail('Workspace alias must be a directory: ' + pkg.name);
        const copiedManifest = join(alias, 'package.json');
        if (!existsSync(copiedManifest) || JSON.parse(readFileSync(copiedManifest, 'utf8')).name !== pkg.name)
          fail('Bundled workspace alias has incorrect identity: ' + pkg.name);
        rmSync(alias, { recursive: true, force: true });
        symlinkSync(target, alias, 'junction');
        if (canonical(alias) !== canonical(target)) fail('Failed to construct correct workspace junction: ' + pkg.name);
      }
      workspaces.push(pkg.name);
    }
  }
  if (workspaces.length < 5) fail('Too few linked workspaces; archive may be incomplete');
  console.log('INTUIT3D_WORKSPACE_LINKS_READY ' + workspaces.length +
    ' exact local sources; no network access');
} catch (error) {
  console.error('INTUIT3D_WORKSPACE_LINK_ERROR: ' + (error?.stack || error));
  process.exitCode = 1;
}
