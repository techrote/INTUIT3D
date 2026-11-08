#!/usr/bin/env python3
"""Write a canonical, relocatable tar.gz from a fully verified Linux bundle.

Archive member names and gzip/tar headers depend only on the file tree and
whether files are executable, not on staging location, filesystem timestamps,
or the packager's user identity. The manifest itself retains honest host and
source provenance, so different compiled builds may still yield different bytes.
"""
from __future__ import annotations

import gzip
import os
from pathlib import Path
import stat
import tarfile

ROOT_NAME = "offline-occt801"


class ArchiveError(RuntimeError):
    """Refuse to publish an ambiguous or unsafe offline artifact."""


def write_archive(source: Path, archive: Path) -> None:
    source = source.absolute()
    archive = archive.absolute()
    if not source.is_dir() or source.is_symlink():
        raise ArchiveError("archive source must be an actual directory")
    if archive.is_relative_to(source):
        raise ArchiveError("archive destination must be outside bundle tree")
    if archive.exists():
        raise ArchiveError("archive destination already exists")
    entries = [source, *sorted(source.rglob("*"),
                               key=lambda p: p.relative_to(source).as_posix())]
    try:
        with archive.open("xb") as output:
            # Suppress the gzip filename and current-time fields.
            with gzip.GzipFile(filename="", mode="wb", fileobj=output,
                               mtime=0, compresslevel=9) as gz:
                with tarfile.open(mode="w", fileobj=gz,
                                  format=tarfile.USTAR_FORMAT) as tar:
                    for entry in entries:
                        relative = entry.relative_to(source).as_posix()
                        name = ROOT_NAME if entry == source else f"{ROOT_NAME}/{relative}"
                        st = entry.lstat()
                        info = tarfile.TarInfo(name)
                        info.uid = info.gid = info.mtime = 0
                        info.uname = info.gname = ""
                        info.pax_headers = {}
                        if stat.S_ISDIR(st.st_mode):
                            info.type = tarfile.DIRTYPE
                            info.mode = 0o755
                            tar.addfile(info)
                        elif stat.S_ISLNK(st.st_mode):
                            target = os.readlink(entry)
                            if (not target or os.path.isabs(target)
                                    or not entry.resolve(strict=True).is_relative_to(source)):
                                raise ArchiveError(f"unsafe bundle link: {relative}")
                            info.type = tarfile.SYMTYPE
                            info.mode = 0o777
                            info.linkname = target
                            tar.addfile(info)
                        elif stat.S_ISREG(st.st_mode):
                            info.type = tarfile.REGTYPE
                            info.mode = 0o755 if st.st_mode & 0o111 else 0o644
                            info.size = st.st_size
                            with entry.open("rb") as payload:
                                tar.addfile(info, payload)
                        else:
                            raise ArchiveError(f"unsafe non-file bundle member: {relative}")
    except BaseException:
        archive.unlink(missing_ok=True)
        raise
