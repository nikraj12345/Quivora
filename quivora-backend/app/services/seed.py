import json
import os

SEED_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "seed")
TRAINING_JSON_PATH = os.path.join(SEED_DIR, "training_consults.json")


def load_training_json() -> dict:
    """Load training consults JSON file from app/seed/training_consults.json."""
    if not os.path.exists(TRAINING_JSON_PATH):
        return {"doctors": [], "consults_per_doctor": 100}
    with open(TRAINING_JSON_PATH, "r", encoding="utf-8") as f:
        return json.load(f)
