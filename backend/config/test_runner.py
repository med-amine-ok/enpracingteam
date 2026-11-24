import logging

from django.test.runner import DiscoverRunner


class QuietTestRunner(DiscoverRunner):
    """Django's test runner, without the routine logs.

    Many tests trigger INFO logs (OTP sent, Executive Bureau sync) and expected WARNING
    logs (rate limits, 4xx responses) on purpose; printed, they hide the test results.
    Errors are still shown. Only affects 'manage.py test', not the running server.
    """

    def setup_test_environment(self, **kwargs):
        super().setup_test_environment(**kwargs)
        logging.disable(logging.WARNING)

    def teardown_test_environment(self, **kwargs):
        logging.disable(logging.NOTSET)
        super().teardown_test_environment(**kwargs)
