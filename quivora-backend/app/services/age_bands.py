AGE_BANDS = [
    ("child_0_5", 0, 5),
    ("child_6_12", 6, 12),
    ("teen_13_17", 13, 17),
    ("adult_18_40", 18, 40),
    ("adult_41_60", 41, 60),
    ("senior_60_plus", 60, 200),
]

# Cold-start defaults (seconds)
DEFAULT_DURATION_BY_BAND = {
    "child_0_5": 6 * 60,
    "child_6_12": 7 * 60,
    "teen_13_17": 8 * 60,
    "adult_18_40": 10 * 60,
    "adult_41_60": 11 * 60,
    "senior_60_plus": 12 * 60,
}


def age_to_band(age: int) -> str:
    for name, lo, hi in AGE_BANDS:
        if lo <= age <= hi:
            return name
    return "adult_18_40"
