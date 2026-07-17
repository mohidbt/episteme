import sys
from pathlib import Path

# Add the service root to sys.path so `from app import app` works
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# NOTE: the version-less→v2 rewrite adapter was removed with GSD-215. Runtime
# auth now has a real legacy v1 branch, so test helpers that sign the legacy
# message (ts+method+path+body, no version header) exercise that branch directly.
