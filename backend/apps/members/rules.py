"""
The charter's rules on memberships (decision D-019, knowledge base: PROJECTS/ERP/engagement_design.md §6):

- art. 13: a student of the preparatory classes belongs only to the Media & Scientific Journalism Department (and
  the units below it), unless the Executive Bureau grants an exception, noted on the membership with its reason;
- art. 14: nobody belongs at the same time to the Project Department (the FS team and its departments included)
  and to the Business & Innovation Department (code dept-business-projects).

Checked when a membership is saved through a form (Membership.clean, the admin); listed for the Bureau otherwise.
"""

from django.utils.translation import gettext as _

MEDIA_UNIT = "dept-media"
PROJECT_UNIT = "dept-projet"
BUSINESS_UNIT = "dept-business-projects"


def unit_codes_up(unit):
    """The codes of a unit and of every unit above it."""
    codes = set()
    while unit is not None:
        if unit.code:
            codes.add(unit.code)
        unit = unit.parent
    return codes


def charter_problems(membership):
    """What the charter forbids in this membership (an empty list when it is fine, or when it is over)."""
    from .models import PREPARATORY_LEVELS, Membership

    if membership.end_date is not None or membership.member_id is None or membership.org_unit_id is None:
        return []
    problems = []
    codes = unit_codes_up(membership.org_unit)
    member = membership.member
    if member.study_level in PREPARATORY_LEVELS and MEDIA_UNIT not in codes and not membership.charter_exception.strip():
        problems.append(_(
            "Art. 13: a student of the preparatory classes belongs only to the Media & Scientific Journalism "
            "Department, unless the Executive Bureau grants an exception (write its reason)."
        ))
    others = Membership.objects.filter(member_id=membership.member_id, end_date__isnull=True).select_related(
        "org_unit"
    )
    if membership.pk is not None:
        others = others.exclude(pk=membership.pk)
    other_codes = set()
    for other in others:
        other_codes |= unit_codes_up(other.org_unit)
    if (PROJECT_UNIT in codes and BUSINESS_UNIT in other_codes) or (BUSINESS_UNIT in codes and PROJECT_UNIT in other_codes):
        problems.append(_(
            "Art. 14: a member cannot belong to the Project Department and to the Business & Innovation Department "
            "at the same time: they leave one before joining the other."
        ))
    return problems


def charter_issues():
    """The memberships in progress that break these rules (set up before them, or not through a form)."""
    from .models import Membership

    rows = []
    memberships = Membership.objects.filter(end_date__isnull=True, member__is_active=True).select_related(
        "member", "org_unit", "role"
    )
    for membership in memberships.order_by("member__first_name", "member__last_name", "pk"):
        problems = charter_problems(membership)
        if problems:
            rows.append({"membership": membership, "problems": problems})
    return rows
