"""
The club's budget year (knowledge base: PROJECTS/ERP/finance_design.md §10): from 1 September to
31 August, named after its two years, "2026-2027". settings.FINANCE_YEAR_START_MONTH moves its
first month (2 to 12: a budget year always spans two calendar years).
"""

import re
from datetime import date, timedelta

from django.conf import settings
from django.utils import timezone

LABEL = re.compile(r"(\d{4})-(\d{4})")


def start_month():
    return getattr(settings, "FINANCE_YEAR_START_MONTH", 9)


def fiscal_year_of(day):
    """The budget year `day` belongs to: "2026-2027" for 15 October 2026."""
    first = day.year if day.month >= start_month() else day.year - 1
    return f"{first}-{first + 1}"


def current_fiscal_year():
    return fiscal_year_of(timezone.localdate())


def is_fiscal_year(label):
    """True for a year name such as "2026-2027": two following years."""
    match = LABEL.fullmatch(label or "")
    return bool(match) and int(match[2]) == int(match[1]) + 1


def fiscal_year_bounds(label):
    """The first and the last day of a budget year."""
    first = int(label[:4])
    return date(first, start_month(), 1), date(first + 1, start_month(), 1) - timedelta(days=1)
