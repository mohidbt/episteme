import sys
from pathlib import Path

# Add the service root to sys.path so `from app import app` works
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
