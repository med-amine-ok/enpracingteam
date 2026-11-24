"""
The reports as files (decision D-014): a PDF (reportlab) to read and pass on, an Excel workbook
(openpyxl) to rework the figures. In French or English, the language of the report.
"""

from io import BytesIO

from django.utils import formats, timezone, translation
from django.utils.translation import gettext as _, pgettext
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from xml.sax.saxutils import escape

NAVY = colors.HexColor("#11202c")
STATUS_COLOURS = {"green": "#2f7a3d", "orange": "#c77700", "red": "#be1e2d", "neutral": "#5f6c78"}


# --- Words ---


def status_label(status):
    return {
        "green": _("On track"), "orange": _("Attention required"), "red": pgettext("team status", "Critical"),
        "neutral": "—",
    }[status]


def member_status_label(status):
    return {"active": _("Active"), "at_risk": _("At risk"), "inactive": _("Inactive")}[status]


INDICATORS = ["active_members", "inactive_members", "attendance_rate", "completion_rate", "overdue_tasks",
              "blocked_tasks", "critical_tasks", "members_without_objectives", "unresolved_blockers"]


def indicator_label(key):
    return {
        "active_members": _("Active members"),
        "inactive_members": _("Inactive or at-risk members"),
        "attendance_rate": _("Attendance rate (30 days)"),
        "completion_rate": _("Task completion rate (30 days)"),
        "overdue_tasks": _("Overdue tasks"),
        "blocked_tasks": _("Blocked tasks"),
        "critical_tasks": _("Critical tasks"),
        "members_without_objectives": _("Members without active objectives"),
        "unresolved_blockers": _("Unresolved blockers"),
    }[key]


def number(value, decimals=1):
    return formats.number_format(value, decimal_pos=decimals, use_l10n=True) if value is not None else "—"


def percent(value):
    return f"{number(value)} %" if value is not None else "—"


def indicator_value(key, indicator):
    if key.endswith("_rate"):
        return percent(indicator["value"])
    if indicator["total"] is not None:
        return f"{indicator['value']} / {indicator['total']}"
    return str(indicator["value"])


def day(value):
    return formats.date_format(value, "SHORT_DATE_FORMAT") if value else "—"


def name(member):
    return f"{member['first_name']} {member['last_name']}"


def severity_label(severity):
    return {
        "low": pgettext("blocker severity", "Low"), "medium": pgettext("blocker severity", "Medium"),
        "high": pgettext("blocker severity", "High"), "critical": pgettext("blocker severity", "Critical"),
    }.get(severity, severity)


def warning_text(row):
    values = {
        "member": name(row["member"]) if row["member"] else "",
        "task": row["task"]["title"] if row["task"] else "",
        "department": row["department"]["name"] if row["department"] else "",
        "count": row["count"], "days": row["days"],
    }
    kind = row["kind"]
    if kind == "member_inactive":
        if row["days"] is None:
            return _("%(member)s: no activity recorded in the ERP.") % values
        return _("%(member)s: no activity for %(days)s days.") % values
    if kind == "member_at_risk":
        return _("%(member)s is at risk: little recent activity or overdue tasks.") % values
    if kind == "member_overdue":
        return _("%(member)s has %(count)s overdue tasks.") % values
    if kind == "knowledge_concentration":
        return _("%(member)s is the main person on %(count)s critical tasks.") % values
    if kind == "workload":
        return _("%(member)s carries %(count)s open points, well above the team.") % values
    if kind == "critical_blocked":
        return _("Critical task blocked: %(task)s.") % values
    if kind == "department_overdue_critical":
        return _("%(department)s has %(count)s overdue critical tasks.") % values
    return _("Due in %(days)s days and not finished: %(task)s.") % values


# --- The sections of each report: (title, header, rows) ---


def sections(report):
    if report["kind"] == "weekly":
        return [
            (_("Achievements"), [_("Task"), _("Project"), _("Department"), _("Points"), _("Quality")],
             [[row["title"], row["project"], row["department"], row["points"] or "—", row["quality_mark"] or "—"]
              for row in report["achievements"]]),
            (_("Delayed tasks"), [_("Task"), _("People"), _("Due date"), _("Days late")],
             [[row["title"], ", ".join(row["people"]), day(row["due_date"]), row.get("days_late", "—")]
              for row in report["delayed"]]),
            (_("Critical blockers"), [_("Task"), _("Blocker"), _("Severity"), _("Declared")],
             [[row["task"]["title"], row["description"], severity_label(row["severity"]),
               day(timezone.localdate(row["reported_at"]))] for row in report["critical_blockers"]]),
            (_("Members requiring attention"), [_("Member"), _("Status"), _("Overdue tasks"), _("Open tasks")],
             [[name(row["member"]), member_status_label(row["status"]), row["overdue"], row["open_tasks"]]
              for row in report["attention"]]),
            *department_section(report["departments"]),
            (_("Workload problems"), [_("Warning")], [[warning_text(row)] for row in report["workload"]]),
            (_("Main risks"), [_("Warning")], [[warning_text(row)] for row in report["risks"]]),
            (_("Priorities for the following week"), [_("Task"), _("Due date"), _("Points"), _("People")],
             [[row["title"], day(row["due_date"]), row["points"] or "—", ", ".join(row["people"])]
              for row in report["priorities"]]),
        ]
    return [
        (_("Member contribution"),
         [_("Member"), _("Departments"), _("Tasks validated"), _("Points delivered"), _("Presence"), _("Open tasks"),
          _("Status")],
         [[name(row["member"]), ", ".join(row["units"]), row["validated"], number(row["delivered_points"]),
           percent(row["presence"]), row["open_tasks"], member_status_label(row["status"])]
          for row in report["members"]]),
        (_("Department performance"),
         [_("Department"), _("Tasks validated"), _("Points delivered"), _("Overdue tasks"), _("Attendance")],
         [[row["unit"]["name"], row["validated"], number(row["delivered_points"]), row["overdue"],
           percent(row["attendance_rate"])] for row in report["departments"]]),
        (_("Attendance and task completion trends"), [_("Week of"), _("Attendance"), _("Tasks validated"),
                                                      _("Tasks created")],
         [[day(row["start"]), percent(row["attendance_rate"]), row["validated"], row["created"]]
          for row in report["trends"]]),
        (_("Major blockers"), [_("Task"), _("Blocker"), _("Severity"), _("Declared"), _("Resolved")],
         [[row["task"]["title"], row["description"], severity_label(row["severity"]),
           day(timezone.localdate(row["reported_at"])),
           day(timezone.localdate(row["resolved_at"])) if row["resolved_at"] else "—"]
          for row in report["major_blockers"]]),
        (_("Development progress"), [_("Project"), _("Tasks"), _("Tasks validated"), _("Progress")],
         [[row["project"]["name"], row["tasks"], row["validated"], percent(row["progress"])]
          for row in report["projects"]]),
        (_("Organizational risks"), [_("Warning")], [[warning_text(row)] for row in report["risks"]]),
    ]


def department_section(rows):
    return [(
        _("Department status"),
        [_("Department"), _("Members"), _("Tasks validated"), _("Ongoing"), _("Overdue tasks"), _("Critical tasks"),
         _("Blockers"), _("Attendance"), _("Status")],
        [[row["unit"]["name"], row["members"], row["validated"], row["in_progress"], row["overdue"], row["critical"],
          row["blockers"], percent(row["attendance_rate"]), status_label(row["status"])] for row in rows],
    )]


def period(report):
    return _("From %(start)s to %(end)s") % {"start": day(report["start"]), "end": day(report["end"])}


def summary_rows(report):
    if report["kind"] != "weekly":
        return []
    return [[indicator_label(key), indicator_value(key, report["indicators"][key]),
             status_label(report["indicators"][key]["status"])] for key in INDICATORS]


def file_name(report):
    with translation.override(report["language"]):
        stem = _("weekly-report") if report["kind"] == "weekly" else _("monthly-report")
    return f"{stem}-{report['end'].isoformat() if report['kind'] == 'weekly' else report['month']}"


# --- PDF ---


def to_pdf(report):
    buffer = BytesIO()
    with translation.override(report["language"]):
        styles = getSampleStyleSheet()
        cell = ParagraphStyle("cell", parent=styles["BodyText"], fontSize=8, leading=10)
        head = ParagraphStyle("head", parent=cell, textColor=colors.white, fontName="Helvetica-Bold")
        document = SimpleDocTemplate(
            buffer, pagesize=landscape(A4), leftMargin=14 * mm, rightMargin=14 * mm, topMargin=14 * mm,
            bottomMargin=14 * mm, title=report["title"], author="ENP Racing Team ERP",
        )
        story = [
            Paragraph(escape(report["title"]), styles["Title"]),
            Paragraph(escape(period(report)), styles["Normal"]),
        ]
        if report["kind"] == "weekly":
            colour = STATUS_COLOURS[report["overall"]]
            story.append(Paragraph(
                f'{escape(_("Overall team status:"))} <font color="{colour}"><b>'
                f'{escape(status_label(report["overall"]))}</b></font>', styles["Heading3"]))
            story.append(table([_("Indicator"), _("Value"), _("Status")], summary_rows(report), cell, head))
        for title, header, rows in sections(report):
            story.append(Spacer(1, 4 * mm))
            story.append(Paragraph(escape(title), styles["Heading2"]))
            if rows:
                story.append(table(header, rows, cell, head))
            else:
                story.append(Paragraph(escape(_("Nothing to report.")), styles["Italic"]))
        document.build(story)
    return buffer.getvalue()


def table(header, rows, cell, head):
    data = [[Paragraph(escape(str(value)), head) for value in header]]
    data += [[Paragraph(escape(str(value)), cell) for value in row] for row in rows]
    result = Table(data, repeatRows=1, hAlign="LEFT")
    result.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f4f5f7")]),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e3e6ea")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return result


# --- Excel ---


def to_xlsx(report):
    book = Workbook()
    bold = Font(bold=True, color="FFFFFF")
    fill = PatternFill("solid", fgColor="11202C")
    with translation.override(report["language"]):
        sheet = book.active
        sheet.title = sheet_name(_("Summary"))
        sheet.append([report["title"]])
        sheet["A1"].font = Font(bold=True, size=14)
        sheet.append([period(report)])
        if report["kind"] == "weekly":
            sheet.append([_("Overall team status"), status_label(report["overall"])])
            sheet.append([])
            sheet.append([_("Indicator"), _("Value"), _("Status")])
            for cell in sheet[sheet.max_row]:
                cell.font, cell.fill = bold, fill
            for row in summary_rows(report):
                sheet.append(row)
        widths(sheet)
        for title, header, rows in sections(report):
            page = book.create_sheet(sheet_name(title))
            page.append(header)
            for cell in page[1]:
                cell.font, cell.fill = bold, fill
            for row in rows:
                page.append(row)
            widths(page)
    buffer = BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def sheet_name(title):
    """An Excel sheet name: 31 characters at most, none of []:*?/\\."""
    for character in "[]:*?/\\":
        title = title.replace(character, " ")
    return title[:31]


def widths(sheet):
    for column in sheet.columns:
        longest = max((len(str(cell.value)) for cell in column if cell.value is not None), default=8)
        sheet.column_dimensions[column[0].column_letter].width = min(max(longest + 2, 10), 60)
