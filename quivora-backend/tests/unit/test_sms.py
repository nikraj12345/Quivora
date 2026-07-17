from app.services.sms import effective_provider, normalize_mobile, sms_status


def test_normalize_mobile_indian():
    assert normalize_mobile("+91 98765 43210") == "9876543210"
    assert normalize_mobile("09876543210") == "9876543210"
    assert normalize_mobile("9876543210") == "9876543210"
    assert normalize_mobile("12345") is None
    assert normalize_mobile(None) is None


def test_sms_status_defaults_to_log():
    status = sms_status()
    assert status["sms_enabled"] is True
    assert status["sms_provider"] == effective_provider()
    assert status["sms_provider"] in ("log", "fast2sms", None)
