import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services.seed import CONSULTS_PER_DOCTOR, PATIENT_POOL_SIZE, generate_seed_files

if __name__ == "__main__":
    meta = generate_seed_files(force=True)
    print(f"Generated {PATIENT_POOL_SIZE} patients → {meta['patients']}")
    print(f"Generated {meta['doctor_count']} doctors → {meta['doctors']}")
    print(f"Generated training data ({CONSULTS_PER_DOCTOR}/doctor) → {meta['training']}")
