"""The value lists of the work module (specification §§3–12, schema task_module_schema.sql).

They are CharField choices with CHECK constraints rather than PostgreSQL ENUM types, like the rest of the
code base: the same guarantees, and a new value is an ordinary migration."""

from django.db import models
from django.utils.translation import gettext_lazy as _, pgettext_lazy


class WorkOrderStatus(models.TextChoices):
    DRAFT = "draft", _("Draft")
    PLANNING = "planning", _("Planning")
    ACTIVE = "active", _("Active")
    IN_PROGRESS = "in_progress", _("In progress")
    COMPLETED = "completed", _("Completed")
    CANCELLED = "cancelled", _("Cancelled")


# Before activation the budget and the weights may change freely (specification §7.2).
UNLOCKED_WO_STATUSES = (WorkOrderStatus.DRAFT, WorkOrderStatus.PLANNING)
RUNNING_WO_STATUSES = (WorkOrderStatus.ACTIVE, WorkOrderStatus.IN_PROGRESS)


class ProposalStatus(models.TextChoices):
    DRAFT = "draft", _("Draft")
    PENDING_REVIEW = "pending_review", _("Pending review")
    APPROVED = "approved", _("Approved")
    REJECTED = "rejected", _("Rejected")


# A record proposed and not approved is not official work (specification §3.1, §4.2).
NOT_OFFICIAL = (ProposalStatus.DRAFT, ProposalStatus.PENDING_REVIEW, ProposalStatus.REJECTED)


class Priority(models.TextChoices):
    LOW = "low", _("Low")
    MEDIUM = "medium", _("Medium")
    HIGH = "high", _("High")


class DeliverableStatus(models.TextChoices):
    DRAFT = "draft", _("Draft")
    READY = "ready", _("Ready")
    IN_PROGRESS = "in_progress", _("In progress")
    SUBMITTED = "submitted", _("Submitted")
    REVISION_REQUESTED = "revision_requested", _("Revision requested")
    VALIDATED = "validated", _("Validated")
    CANCELLED = "cancelled", _("Cancelled")


class DependencyState(models.TextChoices):
    NONE = "no_blocking_dependencies", _("No blocking dependencies")
    WAITING = "waiting", _("Waiting for prerequisite")
    RELEASED = "released", _("Dependencies released")


class ExecutionState(models.TextChoices):
    NORMAL = "normal", _("Normal")
    PARTIALLY_BLOCKED = "partially_blocked", _("Partially blocked")
    FULLY_BLOCKED = "fully_blocked", _("Fully blocked")


class LinkType(models.TextChoices):
    BLOCKS = "blocks", _("Required prerequisite")
    FOLLOWS = "follows", _("Recommended sequence")
    RELATES_TO = "relates_to", _("Related work")
    DUPLICATES = "duplicates", _("Overlapping scope")


class ReleaseCondition(models.TextChoices):
    SUBMITTED = "submitted", _("Prerequisite submitted")
    VALIDATED = "validated", _("Prerequisite validated")
    MILESTONE_COMPLETED = "milestone_completed", _("Milestone completed")


class LinkStatus(models.TextChoices):
    ACTIVE = "active", _("Active")
    CANCELLED = "cancelled", _("Cancelled")


class BlockerOrigin(models.TextChoices):
    TECHNICAL = "technical", _("Technical")
    RESOURCE = "resource", _("Resource")
    EXTERNAL = "external", _("External")
    DEPENDENCY = "dependency", _("Dependency")
    DECISION = "decision", _("Decision")
    OTHER = "other", _("Other")


class BlockerSeverity(models.TextChoices):
    # The same labels as the tasks' blocker severities (apps/tasks/models.py), already translated: one enum.
    LOW = "low", pgettext_lazy("blocker severity", "Low")
    MEDIUM = "medium", pgettext_lazy("blocker severity", "Medium")
    HIGH = "high", pgettext_lazy("blocker severity", "High")
    CRITICAL = "critical", pgettext_lazy("blocker severity", "Critical")


class BlockerStatus(models.TextChoices):
    OPEN = "open", _("Open")
    RESOLVED = "resolved", _("Resolved")
    CANCELLED = "cancelled", _("Cancelled")


class BlockerImpact(models.TextChoices):
    """How much of the work a blocker prevents (specification §11.2); gives the execution state."""

    NONE = "none", _("Work can continue")
    PARTIAL = "partial", _("Some work is prevented")
    FULL = "full", _("All work is prevented")


class InvolvementRole(models.TextChoices):
    REPORTER = "reporter", _("Reporter")
    RESOLVER = "resolver", _("Resolver")
    VALIDATOR = "validator", _("Validator")
    INFORMED = "informed", _("Informed")


class RevisionSeverity(models.TextChoices):
    MINOR = "minor", _("Minor")
    MODERATE = "moderate", _("Moderate")
    MAJOR = "major", _("Major")
    CRITICAL = "critical", _("Critical")


class ReviewDecision(models.TextChoices):
    VALIDATED = "validated", _("Validated")
    REVISION_REQUESTED = "revision_requested", _("Revision requested")


class AssignmentRole(models.TextChoices):
    MEMBER = "member", _("Member")
    LEAD = "lead", _("Lead")


class EvidenceType(models.TextChoices):
    DRIVE = "drive", _("Drive")
    GITHUB = "github", _("GitHub")
    CAD = "cad", _("CAD")
    REPORT = "report", _("Report")
    OTHER = "other", _("Other")


class ReliefStatus(models.TextChoices):
    """A deadline-relief interval is claimed by the team, then decided by the Head (specification §10)."""

    CLAIMED = "claimed", _("Claimed")
    APPROVED = "approved", _("Approved")
    REJECTED = "rejected", _("Rejected")


class EntityType(models.TextChoices):
    SEASON = "season", _("Season")
    PROJECT = "project", _("Project")
    WORK_ORDER = "work_order", _("Work Order")
    DELIVERABLE = "deliverable", _("Deliverable")
    MILESTONE = "milestone", _("Milestone")
    SUBMISSION = "submission", _("Submission")
    REVIEW = "review", _("Review")
    DEPENDENCY_LINK = "dependency_link", _("Dependency")
    BLOCKER = "blocker", _("Blocker")
    ASSIGNMENT = "assignment", _("Assignment")
    RELIEF = "relief_interval", _("Deadline relief")


class Action(models.TextChoices):
    CREATED = "created", _("Created")
    UPDATED = "updated", _("Updated")
    STATUS_CHANGED = "status_changed", _("Status changed")
    CANCELLED = "cancelled", _("Cancelled")
    PROPOSED = "proposed", _("Proposed")
    APPROVED = "approved", _("Approved")
    REJECTED = "rejected", _("Rejected")
    SUBMITTED = "submitted", _("Submitted")
    VALIDATED = "validated", _("Validated")
    REVISION_REQUESTED = "revision_requested", _("Revision requested")
    COMPLETED = "completed", _("Completed")
    UNCOMPLETED = "uncompleted", _("Marked not completed")
    REOPENED = "reopened", _("Reopened")
    ASSIGNED = "assigned", _("Assigned")
    UNASSIGNED = "unassigned", _("Unassigned")
    WEIGHT_CHANGED = "weight_changed", _("Weight changed")
    BUDGET_CHANGED = "budget_changed", _("Budget changed")
    DEADLINE_CHANGED = "deadline_changed", _("Deadline changed")
    PROGRESS_UPDATED = "progress_updated", _("Progress updated")
    RELEASED = "released", _("Dependency released")
    MANUAL_RELEASED = "manual_released", _("Manually released")
    RELIEF_CLAIMED = "relief_claimed", _("Deadline relief claimed")
    RELIEF_APPROVED = "relief_approved", _("Deadline relief approved")
    RELIEF_REJECTED = "relief_rejected", _("Deadline relief rejected")
    RESOLVED = "resolved", _("Resolved")
    IMPACT_VALIDATED = "impact_validated", _("Impact validated")
