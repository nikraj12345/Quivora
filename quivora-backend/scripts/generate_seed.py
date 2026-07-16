import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services.seed import generate_seed_files

if __name__ == "__main__":
    paths = generate_seed_files(force=True)
    for k, v in paths.items():
        print(f"{k}: {v}")
