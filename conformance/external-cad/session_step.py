#!/usr/bin/env python3
"""Independently import a current-session STEP and an earlier wrong-geometry STEP.

This consumes atomic RUNTIME captureCurrentStepEvidence receipt metadata and archive
bytes. It validates their mutual custody and executes the pinned non-OCCT
AnvilCAD V2 importer. Browser click provenance, C++ compile provenance and
production authority must still be attested externally by Integration.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys
import subprocess

from witness_3d import (ANVIL_PIN, Rejected, bound_bytes, require, run_probe,
                        sha, witness_count, witness_version)

HEX64 = re.compile(r"[0-9a-f]{64}\Z")


def json_object(path: Path, cap: int) -> dict:
    raw = bound_bytes(path, cap)
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "duplicate JSON key in custody evidence")
            result[key] = value
        return result
    value = json.loads(raw.decode('utf-8'), object_pairs_hook=unique,
                       parse_constant=lambda _: (_ for _ in ()).throw(
                           Rejected("nonfinite JSON custody evidence")))
    require(type(value) is dict, "custody evidence must be a JSON object")
    return value


def source_bound_archive(path: Path) -> dict:
    archive = json_object(path, 32 * 1024 * 1024)
    require(archive.get('format') == 'intuit3d.model-archive' and
            type(archive.get('version')) is int and archive['version'] == 1,
            "not a versioned canonical model archive")
    history = archive.get('history')
    require(type(history) is dict, 'missing authoritative undo history')
    doc = history.get('document')
    require(type(doc) is dict and
            isinstance(archive.get('projectId'), str) and archive['projectId'] and
            type(archive.get('revision')) is int and 0 <= archive['revision'] < 2**53 and
            doc.get('projectId') == archive['projectId'] and
            type(doc.get('revision')) is int and
            doc['revision'] == archive['revision'],
            "archive top-level project/revision differs from its journal")
    return {'projectId': archive['projectId'], 'revision': archive['revision'],
            'archiveSha256': sha(bound_bytes(path, 32 * 1024 * 1024))}


def verify_capture(path: Path, archive: Path, step: Path) -> dict:
    captured = json_object(path, 100_000)
    require(captured.get('format') == 'intuit3d.source-bound-step-receipt' and
            type(captured.get('version')) is int and captured['version'] == 1,
            "not a supported RUNTIME source-bound STEP receipt")
    require(captured.get('exactAuthority') is False and
            captured.get('independentInteroperability') is False,
            "receipt altered its experimental authority flags")
    source, producer, stepmeta = (captured.get(k) for k in ('source', 'producer', 'step'))
    require(all(type(v) is dict for v in (source, producer, stepmeta)),
            "missing source/producer/STEP receipt")
    require(type(source.get('revision')) is int and
            source == source_bound_archive(archive),
            "STEP receipt is not bound to exact current model archive bytes")
    require(producer.get('backend') == 'OCCT-cxx-8.0.1' and
            producer.get('occtVersion') == '8.0.1' and
            isinstance(producer.get('requestId'), str) and
            0 < len(producer['requestId']) <= 128 and
            isinstance(producer.get('cutFeatureId'), str) and
            0 < len(producer['cutFeatureId']) <= 128,
            "not a named pinned C++ producer request")
    require('bytes' not in stepmeta and
            stepmeta.get('filename') == 'plate.step' and
            stepmeta.get('verification') == 'occt8_part21_plate_subset' and
            isinstance(stepmeta.get('sha256'), str) and
            HEX64.fullmatch(stepmeta['sha256']) and
            sha(bound_bytes(step, 50_000_000)) == stepmeta['sha256'],
            "downloaded STEP differs from its source-bound receipt")
    return {'source': source, 'producer': producer,
            'stepSha256': stepmeta['sha256'],
            'receiptSha256': sha(bound_bytes(path, 100_000))}


def execute(args: argparse.Namespace) -> int:
    require(not args.output_dir.exists(), "evidence directory must be fresh")
    require(1 <= args.timeout <= 120, "unbounded importer timeout")
    require(args.anvil_source_sha == ANVIL_PIN,
            "independent importer upstream source pin mismatch")
    require(HEX64.fullmatch(args.probe_sha256 or '') is not None and
            sha(bound_bytes(args.probe, 100_000_000)) == args.probe_sha256,
            "independent compiled importer SHA-256 mismatch")
    require(HEX64.fullmatch(args.witness_sha256 or '') is not None,
            "missing independent witness SHA-256")
    witness = bound_bytes(args.witness, 100_000)
    require(sha(witness) == args.witness_sha256 and witness_version(witness) == 2,
            "not the exact independently authored V2 mass witness")
    count = witness_count(witness)
    current = verify_capture(args.current_receipt, args.current_archive, args.current_step)
    negative = verify_capture(args.negative_receipt, args.negative_archive, args.negative_step)
    require(negative['source']['projectId'] == current['source']['projectId'] and
            negative['producer']['cutFeatureId'] == current['producer']['cutFeatureId'] and
            negative['source']['revision'] < current['source']['revision'] and
            negative['source']['archiveSha256'] != current['source']['archiveSha256'] and
            negative['producer']['requestId'] != current['producer']['requestId'] and
            negative['stepSha256'] != current['stepSha256'],
            "negative must be an earlier same-project same-feature distinct physical C++ export")
    args.output_dir.mkdir(parents=True)
    frozen_witness = args.output_dir / 'witness.v2.txt'
    frozen_witness.write_bytes(witness)
    result = {
        'format': 'intuit3d.session-step-external-gate', 'version': 1,
        'status': 'REJECTED', 'independentCadPhysicalPass': False,
        'browserClickAttested': False, 'canonicalArchiveValidatedByRuntime': False,
        'nativeSourceToBinaryCompilationAttested': False,
        'anvilSourceSha': args.anvil_source_sha, 'anvilProbeSha256': args.probe_sha256,
        'independentWitnessSha256': args.witness_sha256,
        'current': current, 'wrongGeometry': negative, 'physicalCases': []}
    try:
        for name, src, archive, receipt, identity, positive in (
            ('current', args.current_step, args.current_archive,
             args.current_receipt, current, True),
            ('wrong-geometry', args.negative_step, args.negative_archive,
             args.negative_receipt, negative, False),
        ):
            target = args.output_dir / (name + '.step')
            target.write_bytes(bound_bytes(src, 50_000_000))
            (args.output_dir / (name + '.archive.json')).write_bytes(
                bound_bytes(archive, 32 * 1024 * 1024))
            (args.output_dir / (name + '.receipt.json')).write_bytes(
                bound_bytes(receipt, 100_000))
            require(sha(target.read_bytes()) == identity['stepSha256'] and
                    sha((args.output_dir / (name + '.archive.json')).read_bytes()) ==
                    identity['source']['archiveSha256'] and
                    sha((args.output_dir / (name + '.receipt.json')).read_bytes()) ==
                    identity['receiptSha256'],
                    "captured source/STEP evidence changed before physical import")
            log = args.output_dir / (name + '.anvil.log')
            observed = run_probe(args.probe, target, frozen_witness, args.timeout,
                                 log, count, positive, version=2)
            require(sha(target.read_bytes()) == identity['stepSha256'] and
                    sha(bound_bytes(src, 50_000_000)) == identity['stepSha256'] and
                    sha(bound_bytes(archive, 32 * 1024 * 1024)) ==
                    identity['source']['archiveSha256'] and
                    sha(bound_bytes(receipt, 100_000)) == identity['receiptSha256'] and
                    sha(bound_bytes(args.witness, 100_000)) == args.witness_sha256 and
                    sha(bound_bytes(args.probe, 100_000_000)) == args.probe_sha256,
                    "original source, executable, STEP or witness changed during import")
            result['physicalCases'].append({'role': name,
                                            'stepSha256': identity['stepSha256'],
                                            'logSha256': sha(log.read_bytes()), **observed})
        result['status'] = 'INDEPENDENT_CAD_PASS_SESSION_CUSTODY_UNATTESTED'
        result['independentCadPhysicalPass'] = True
        return 0
    except (Rejected, OSError, ValueError, subprocess.SubprocessError) as exc:
        result['error'] = str(exc)
        return 3
    finally:
        (args.output_dir / 'qualification.json').write_text(
            json.dumps(result, indent=2, sort_keys=True) + '\n')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('current-archive', 'current-receipt', 'current-step',
                 'negative-archive', 'negative-receipt', 'negative-step',
                 'witness', 'probe', 'output-dir'):
        parser.add_argument('--' + name, required=True, type=Path)
    for name in ('witness-sha256', 'probe-sha256', 'anvil-source-sha'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--timeout', type=int, default=60)
    try:
        return execute(parser.parse_args())
    except (Rejected, ValueError, OSError, TypeError, KeyError, UnicodeError, subprocess.SubprocessError,
            json.JSONDecodeError) as exc:
        print('SESSION_STEP_EXTERNAL_CAD_REJECTED: ' + str(exc), file=sys.stderr)
        return 3


if __name__ == '__main__':
    sys.exit(main())
