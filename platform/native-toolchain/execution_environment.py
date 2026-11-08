"""A minimal process environment for attested pinned native replay.

An ambient NODE_OPTIONS startup module can emit a forged valid receipt and
exit before the real RUNTIME demo executes. PYTHONPATH and shell startup hooks
similarly permit source-unbound code during offline verification. This filter
is not a substitute for trusting the chosen binaries and source checkout.
"""
from __future__ import annotations

import os

_PASSTHROUGH = frozenset({
    "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LANGUAGE", "TZ",
    "USER", "LOGNAME", "XDG_RUNTIME_DIR", "XDG_CACHE_HOME",
})


def sealed_env() -> dict[str, str]:
    """Preserve basic host discovery/locale but discard all injection hooks."""
    clean = {key: value for key, value in os.environ.items()
             if key in _PASSTHROUGH or key.startswith("LC_")}
    clean["PYTHONDONTWRITEBYTECODE"] = "1"
    return clean
