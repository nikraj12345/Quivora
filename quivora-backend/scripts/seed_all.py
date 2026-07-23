#!/usr/bin/env python3
"""
Generate JSON seed files and load demo data into Postgres.

Examples:
  python scripts/seed_all.py
  python scripts/seed_all.py --force-json
  python scripts/seed_all.py --no-reset
  python scripts/seed_all.py --queues
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.db import SessionLocal
from app.services.bootstrap_auth import ensure_bootstrap_users, ensure_doctor_room_pins, print_demo_credentials
from app.services.seed import (
    CONSULTS_PER_DOCTOR,
    HISTORY_DAYS_FUTURE,
    HISTORY_DAYS_PAST,
    PATIENT_POOL_SIZE,
    generate_seed_files,
    seed_database,
    seed_random_history,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed Quivora demo database")
    parser.add_argument(
        "--force-json",
        action="store_true",
        help="Regenerate app/seed/*.json (1000 patients, 40 doctors, training data)",
    )
    parser.add_argument(
        "--no-reset",
        action="store_true",
        help="Upsert hospitals/doctors/patients without wiping queues",
    )
    parser.add_argument(
        "--queues",
        action="store_true",
        help="After seeding, add random walk-in patients to doctor/scan queues",
    )
    parser.add_argument(
        "--history",
        action="store_true",
        default=True,
        help="Seed random consultations on random dates (default: on)",
    )
    parser.add_argument(
        "--no-history",
        dest="history",
        action="store_false",
        help="Skip random historical OPD/scan appointments",
    )
    parser.add_argument(
        "--days-past",
        type=int,
        default=HISTORY_DAYS_PAST,
        help=f"Days of past consult history (default {HISTORY_DAYS_PAST})",
    )
    parser.add_argument(
        "--days-future",
        type=int,
        default=HISTORY_DAYS_FUTURE,
        help=f"Days of future bookings (default {HISTORY_DAYS_FUTURE})",
    )
    args = parser.parse_args()

    print("→ Generating seed JSON files…")
    meta = generate_seed_files(force=args.force_json)
    training = json.loads(meta["training"].read_text())
    training_consults = sum(len(d["consultations"]) for d in training.get("doctors", []))
    print(f"  patients.json        : {meta['patient_count']} records")
    print(f"  doctors.json         : {meta['doctor_count']} records")
    print(f"  training_consults.json: {training_consults} consults "
          f"({CONSULTS_PER_DOCTOR} per doctor)")

    print("→ Loading data into Postgres…")
    db = SessionLocal()
    try:
        result = seed_database(db, reset=not args.no_reset)
        ensure_doctor_room_pins(db)
        ensure_bootstrap_users(db)
        print(f"  hospitals            : {result['hospital']}")
        print(f"  doctors              : {result['doctors']}")
        print(f"  patients in DB       : {result['patients']}")
        print(f"  patient pool         : {result.get('patient_pool', PATIENT_POOL_SIZE)}")
        print()
        print_demo_credentials(db)
    finally:
        db.close()

    if args.history:
        print(f"→ Seeding random consult history ({args.days_past}d past, {args.days_future}d future)…")
        db = SessionLocal()
        try:
            history = seed_random_history(
                db,
                days_past=args.days_past,
                days_future=args.days_future,
                reset=not args.no_reset,
            )
        finally:
            db.close()
        print(f"  OPD appointments     : {history.get('appointments', 0)}")
        print(f"  completed / no-show  : {history.get('completed', 0)} / {history.get('no_shows', 0)}")
        print(f"  queue events         : {history.get('events', 0)}")
        print(f"  predictions          : {history.get('predictions', 0)}")
        print(f"  duration samples     : {history.get('duration_samples', 0)}")
        print(f"  scan appointments    : {history.get('scans', 0)}")
        print(f"  doctor ops events    : {history.get('doctor_ops_events', 0)}")

    if args.queues:
        print("→ Seeding live doctor/scan queues…")
        import importlib.util

        queues_path = ROOT / "scripts" / "seed_queues.py"
        spec = importlib.util.spec_from_file_location("seed_queues", queues_path)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"Could not load {queues_path}")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        mod.run()

    print("✓ Seed complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
