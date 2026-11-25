"""Operational serializers: what Members and Heads read and send.

Confidentiality (plan §3.2, guide §2.1): budgets, weights and allocated points appear only for a viewer who sees
the budget of that department (its Heads, the scoring admins); quality marks, factors, penalties and points never
appear here at all — they live in scoring_serializers.py. The status fields are read-only everywhere: only the
action endpoints change them (plan §4.5)."""

from django.utils.translation import gettext_lazy as _
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.members.models import Member, OrgUnit
from apps.members.serializers import MemberSummarySerializer, OrgUnitSummarySerializer
from apps.projects.models import Project

from .access import access_for
from .models import (
    ActivityLog, Assignment, AssignmentRole, Blocker, BlockerImpact, BlockerOrigin, BlockerSeverity, BlockerStatus,
    Deliverable, DeliverableStatus, ExecutionState, DependencyLink, DependencyProposal, EvidenceType, LinkStatus, LinkType,
    Milestone, MilestoneHistory, Priority, ProposalStatus, ReleaseCondition, ReliefInterval,
    ReviewDecision, RevisionSeverity, RUNNING_WO_STATUSES, Season, Submission, WorkOrder, WorkOrderStatus,
)
from .services import formulas, progress
from .services.work_orders import credit_plan_problems


def viewer(serializer):
    return access_for(serializer.context["request"])


class ProjectBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = ["id", "name", "code"]


class SeasonSerializer(serializers.ModelSerializer):
    class Meta:
        model = Season
        fields = ["id", "code", "year", "label", "is_active", "scoring_cutoff_at"]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not viewer(self).is_head and not viewer(self).is_scoring_admin:
            data.pop("scoring_cutoff_at")
        return data


# --- Shapes of the computed fields, for the API schema ---


class RubricOutSerializer(serializers.Serializer):
    effort = serializers.IntegerField()
    complexity = serializers.IntegerField()
    uncertainty = serializers.IntegerField()
    responsibility = serializers.IntegerField()
    score = serializers.CharField()
    suggested_tier = serializers.IntegerField()


class DeliverableRightsSerializer(serializers.Serializer):
    edit = serializers.BooleanField()
    decide = serializers.BooleanField()
    submit_proposal = serializers.BooleanField()
    assign = serializers.BooleanField()
    mark_ready = serializers.BooleanField()
    start = serializers.BooleanField()
    update_progress = serializers.BooleanField()
    manage_milestones = serializers.BooleanField()
    cancel_milestones = serializers.BooleanField()
    submit = serializers.BooleanField()
    review = serializers.BooleanField()
    cancel = serializers.BooleanField()
    reopen = serializers.BooleanField()
    add_dependency = serializers.BooleanField()
    propose_dependency = serializers.BooleanField()
    claim_relief = serializers.BooleanField()
    decide_relief = serializers.BooleanField()
    report_blocker = serializers.BooleanField()
    enter_quality = serializers.BooleanField(help_text="May give the final quality mark (club admins only).")


class LinkWorkOrderSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    code = serializers.CharField(allow_null=True)
    department = serializers.IntegerField()


class MilestoneRefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    title = serializers.CharField()
    is_completed = serializers.BooleanField()


class LinkRightsSerializer(serializers.Serializer):
    cancel = serializers.BooleanField()
    manual_release = serializers.BooleanField()


class BlockerTargetSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=["deliverable", "work_order"])
    id = serializers.IntegerField()
    code = serializers.CharField()
    title = serializers.CharField()


class BlockerValidationOutSerializer(serializers.Serializer):
    impact_confirmed = serializers.BooleanField()
    impact_note = serializers.CharField()
    validated_at = serializers.DateTimeField()
    validated_by = MemberSummarySerializer(allow_null=True)


class BlockerRightsSerializer(serializers.Serializer):
    edit = serializers.BooleanField()
    resolve = serializers.BooleanField()
    cancel = serializers.BooleanField()
    validate_impact = serializers.BooleanField()


# --- Work Orders ---


class WorkOrderRightsSerializer(serializers.Serializer):
    edit = serializers.BooleanField()
    decide = serializers.BooleanField(help_text="Approve or reject the proposal (Heads, not its author).")
    submit_proposal = serializers.BooleanField()
    plan = serializers.BooleanField(help_text="Set the budget, the weights, create Deliverables.")
    activate = serializers.BooleanField()
    cancel = serializers.BooleanField()
    propose_deliverable = serializers.BooleanField()


def work_order_rights(access, work_order):
    head = access.heads(work_order.department_id)
    open_ = work_order.status not in (WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED)
    pending = work_order.proposal_status == ProposalStatus.PENDING_REVIEW
    draft = work_order.proposal_status == ProposalStatus.DRAFT
    mine = work_order.proposed_by_id == access.user.pk
    return {
        "edit": open_ and (head or (mine and (draft or pending))) and work_order.proposal_status != ProposalStatus.REJECTED,
        "decide": head and pending and not mine,
        "submit_proposal": mine and draft,
        "plan": head and open_ and work_order.is_official,
        "activate": head and work_order.is_official and work_order.status in (WorkOrderStatus.DRAFT, WorkOrderStatus.PLANNING),
        "cancel": head and open_ and work_order.is_official,
        "propose_deliverable": open_ and work_order.is_official,
    }


class WorkOrderSerializer(serializers.ModelSerializer):
    department = OrgUnitSummarySerializer(read_only=True)
    project = ProjectBriefSerializer(read_only=True)
    season = serializers.PrimaryKeyRelatedField(read_only=True)
    coordinator = MemberSummarySerializer(read_only=True)
    proposed_by = MemberSummarySerializer(read_only=True)
    progress = serializers.SerializerMethodField()
    deliverable_count = serializers.SerializerMethodField()
    next_deadline = serializers.SerializerMethodField()
    execution_state = serializers.SerializerMethodField()

    class Meta:
        model = WorkOrder
        fields = [
            "id", "code", "title", "season", "department", "project", "status", "priority", "coordinator",
            "proposed_by", "proposal_status", "progress", "deliverable_count", "next_deadline", "execution_state",
            "budget_tier", "created_at",
        ]

    def active(self, work_order):
        return [item for item in work_order.deliverables.all() if item.is_active]

    @extend_schema_field(OpenApiTypes.FLOAT)
    def get_progress(self, work_order):
        value = progress.work_order_progress(work_order)
        return None if value is None else float(value)

    @extend_schema_field(OpenApiTypes.INT)
    def get_deliverable_count(self, work_order):
        return len(self.active(work_order))

    @extend_schema_field(OpenApiTypes.DATE)
    def get_next_deadline(self, work_order):
        dates = [
            item.effective_deadline or item.original_deadline for item in self.active(work_order)
            if item.status != DeliverableStatus.VALIDATED and (item.effective_deadline or item.original_deadline)
        ]
        return min(dates) if dates else None

    @extend_schema_field(serializers.ChoiceField(choices=ExecutionState.choices))
    def get_execution_state(self, work_order):
        """Partially blocked if some active Deliverables cannot progress, fully if none can (§11.2)."""
        states = [item.execution_state for item in self.active(work_order) if item.status != DeliverableStatus.VALIDATED]
        if states and all(state == "fully_blocked" for state in states):
            return "fully_blocked"
        if any(state != "normal" for state in states):
            return "partially_blocked"
        return "normal"

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not viewer(self).sees_budget(instance.department_id):
            data.pop("budget_tier")
        return data


class CreditLineSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    code = serializers.CharField()
    title = serializers.CharField()
    weight = serializers.DecimalField(max_digits=6, decimal_places=3)
    allocated_points = serializers.DecimalField(max_digits=8, decimal_places=4, allow_null=True)


class WorkOrderDetailSerializer(WorkOrderSerializer):
    members = serializers.SerializerMethodField()
    rights = serializers.SerializerMethodField()
    credit_plan = serializers.SerializerMethodField()
    plan_problems = serializers.SerializerMethodField()
    rubric = serializers.SerializerMethodField()
    proposal_decided_by = MemberSummarySerializer(read_only=True)
    created_by = MemberSummarySerializer(read_only=True)

    class Meta(WorkOrderSerializer.Meta):
        fields = WorkOrderSerializer.Meta.fields + [
            "description", "objectives", "justification", "estimated_effort_units", "members", "rights",
            "credit_plan", "plan_problems", "rubric", "proposal_submitted_at", "proposal_decided_at",
            "proposal_decided_by", "proposal_note", "proposal_original", "created_by", "updated_at",
        ]

    @extend_schema_field(MemberSummarySerializer(many=True))
    def get_members(self, work_order):
        """Derived from the Deliverables' assignees (§2.1 rule 5)."""
        seen = {}
        for deliverable in self.active(work_order):
            for assignment in deliverable.assignments.all():
                if assignment.is_active:
                    seen[assignment.member_id] = assignment.member
        return MemberSummarySerializer(sorted(seen.values(), key=lambda m: (m.last_name, m.first_name)), many=True).data

    @extend_schema_field(WorkOrderRightsSerializer)
    def get_rights(self, work_order):
        return work_order_rights(viewer(self), work_order)

    @extend_schema_field(CreditLineSerializer(many=True, allow_null=True))
    def get_credit_plan(self, work_order):
        if not viewer(self).sees_budget(work_order.department_id):
            return None
        lines = [
            {
                "id": item.pk, "code": item.code or "", "title": item.title, "weight": item.weight,
                "allocated_points": formulas.allocated_points(work_order.budget_tier, item.weight)
                if work_order.budget_tier else None,
            }
            for item in self.active(work_order)
        ]
        return CreditLineSerializer(lines, many=True).data

    @extend_schema_field(serializers.ListField(child=serializers.CharField()))
    def get_plan_problems(self, work_order):
        if not viewer(self).heads(work_order.department_id) or work_order.is_locked:
            return []
        return credit_plan_problems(work_order, self.active(work_order))

    @extend_schema_field(RubricOutSerializer(allow_null=True))
    def get_rubric(self, work_order):
        if not viewer(self).heads(work_order.department_id):
            return None
        rubric = getattr(work_order, "budget_rubric", None)
        if rubric is None:
            return None
        return {
            "effort": rubric.effort_rating, "complexity": rubric.complexity_rating,
            "uncertainty": rubric.uncertainty_rating, "responsibility": rubric.responsibility_rating,
            "score": str(rubric.budget_score), "suggested_tier": rubric.suggested_tier,
        }

    def to_representation(self, instance):
        data = super().to_representation(instance)
        access = viewer(self)
        if not (access.heads(instance.department_id) or instance.proposed_by_id == access.user.pk):
            data.pop("proposal_original")
        return data


class WorkOrderWriteSerializer(serializers.ModelSerializer):
    season = serializers.PrimaryKeyRelatedField(queryset=Season.objects.all())
    department = serializers.PrimaryKeyRelatedField(queryset=OrgUnit.objects.filter(is_active=True))
    project = serializers.PrimaryKeyRelatedField(queryset=Project.objects.all(), allow_null=True, required=False)
    coordinator = serializers.PrimaryKeyRelatedField(
        queryset=Member.objects.filter(is_active=True), allow_null=True, required=False
    )
    budget_tier = serializers.IntegerField(min_value=1, max_value=5, allow_null=True, required=False)
    priority = serializers.ChoiceField(choices=Priority.choices, allow_blank=True, required=False)
    reason = serializers.CharField(write_only=True, required=False, allow_blank=True)
    submit = serializers.BooleanField(write_only=True, required=False, default=True)

    class Meta:
        model = WorkOrder
        fields = [
            "season", "department", "project", "title", "description", "objectives", "justification",
            "estimated_effort_units", "priority", "coordinator", "budget_tier", "reason", "submit",
        ]


class WorkOrderUpdateSerializer(WorkOrderWriteSerializer):
    class Meta(WorkOrderWriteSerializer.Meta):
        fields = [
            "project", "title", "description", "objectives", "justification", "estimated_effort_units", "priority",
            "coordinator", "budget_tier", "reason",
        ]


class RubricSerializer(serializers.Serializer):
    effort = serializers.IntegerField(min_value=1, max_value=5)
    complexity = serializers.IntegerField(min_value=1, max_value=5)
    uncertainty = serializers.IntegerField(min_value=1, max_value=5)
    responsibility = serializers.IntegerField(min_value=1, max_value=5)


class WeightsSerializer(serializers.Serializer):
    weights = serializers.DictField(child=serializers.DecimalField(max_digits=6, decimal_places=3, min_value=0, max_value=100))
    reason = serializers.CharField(required=False, allow_blank=True)

    def validate_weights(self, value):
        try:
            return {int(key): weight for key, weight in value.items()}
        except (TypeError, ValueError):
            raise serializers.ValidationError(_("Give the weights by Deliverable id.")) from None


class WorkNoteSerializer(serializers.Serializer):
    note = serializers.CharField(required=False, allow_blank=True)


class WorkReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True)


# --- Deliverables ---


class AssignmentSerializer(serializers.ModelSerializer):
    member = MemberSummarySerializer(read_only=True)

    class Meta:
        model = Assignment
        fields = ["id", "member", "role", "is_active", "assigned_at", "unassigned_at"]


class WorkOrderBriefSerializer(serializers.ModelSerializer):
    department = OrgUnitSummarySerializer(read_only=True)
    project = ProjectBriefSerializer(read_only=True)

    class Meta:
        model = WorkOrder
        fields = ["id", "code", "title", "status", "department", "project", "season"]


def deliverable_rights(access, deliverable):
    work_order = deliverable.work_order
    head = access.heads(work_order.department_id)
    assigned = access.is_assigned(deliverable)
    status = deliverable.status
    open_ = status not in (DeliverableStatus.VALIDATED, DeliverableStatus.CANCELLED)
    official = deliverable.is_official
    pending = deliverable.proposal_status == ProposalStatus.PENDING_REVIEW
    mine = deliverable.proposed_by_id == access.user.pk
    running = work_order.status in RUNNING_WO_STATUSES
    contributor = any(a.member_id == access.user.pk and a.is_contributor for a in deliverable.assignments.all())
    return {
        "edit": open_ and (head or (mine and deliverable.proposal_status in (ProposalStatus.DRAFT, ProposalStatus.PENDING_REVIEW))),
        "decide": head and pending and not mine,
        "submit_proposal": mine and deliverable.proposal_status == ProposalStatus.DRAFT,
        "assign": head and open_ and official,
        "mark_ready": head and official and status == DeliverableStatus.DRAFT,
        "start": (head or assigned) and running and status in (DeliverableStatus.READY, DeliverableStatus.REVISION_REQUESTED),
        "update_progress": (head or assigned) and status in (
            DeliverableStatus.READY, DeliverableStatus.IN_PROGRESS, DeliverableStatus.SUBMITTED,
            DeliverableStatus.REVISION_REQUESTED,
        ),
        "manage_milestones": (head or assigned) and open_ and official,
        "cancel_milestones": head,
        "submit": assigned and status in (DeliverableStatus.IN_PROGRESS, DeliverableStatus.REVISION_REQUESTED),
        "review": head and not contributor and status == DeliverableStatus.SUBMITTED,
        "cancel": head and official and status in (
            DeliverableStatus.DRAFT, DeliverableStatus.READY, DeliverableStatus.IN_PROGRESS,
            DeliverableStatus.REVISION_REQUESTED,
        ),
        "reopen": head and status == DeliverableStatus.VALIDATED,
        "add_dependency": head and official and status != DeliverableStatus.CANCELLED,
        "propose_dependency": official and status != DeliverableStatus.CANCELLED,
        "claim_relief": (head or assigned) and official,
        "decide_relief": head,
        "report_blocker": official and status != DeliverableStatus.CANCELLED,
        "enter_quality": access.is_scoring_admin,
    }


class DeliverableSerializer(serializers.ModelSerializer):
    work_order = WorkOrderBriefSerializer(read_only=True)
    assignees = serializers.SerializerMethodField()
    proposed_by = MemberSummarySerializer(read_only=True)
    allocated_points = serializers.SerializerMethodField()

    class Meta:
        model = Deliverable
        fields = [
            "id", "code", "title", "work_order", "status", "dep_state", "execution_state", "progress",
            "progress_updated_at", "start_date", "original_deadline", "effective_deadline", "relief_days",
            "assignees", "proposal_status", "proposed_by", "weight", "allocated_points", "created_at",
        ]

    @extend_schema_field(MemberSummarySerializer(many=True))
    def get_assignees(self, deliverable):
        return MemberSummarySerializer(
            [a.member for a in deliverable.assignments.all() if a.is_active], many=True
        ).data

    @extend_schema_field(serializers.DecimalField(max_digits=8, decimal_places=4, allow_null=True))
    def get_allocated_points(self, deliverable):
        tier = deliverable.work_order.budget_tier
        return str(formulas.allocated_points(tier, deliverable.weight)) if tier else None

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not viewer(self).sees_budget(instance.work_order.department_id):
            data.pop("weight")
            data.pop("allocated_points")
        return data


class MilestoneSerializer(serializers.ModelSerializer):
    created_by = MemberSummarySerializer(read_only=True)
    completed_by = MemberSummarySerializer(read_only=True)
    referenced = serializers.SerializerMethodField(help_text="A dependency uses it: it cannot be cancelled.")

    class Meta:
        model = Milestone
        fields = [
            "id", "deliverable", "title", "description", "is_completed", "completed_at", "completed_by",
            "is_cancelled", "cancelled_at", "created_by", "created_at", "updated_at", "referenced",
        ]
        read_only_fields = ["deliverable", "is_completed", "completed_at", "is_cancelled", "cancelled_at"]

    @extend_schema_field(OpenApiTypes.BOOL)
    def get_referenced(self, milestone):
        return len(milestone.dependency_links.all()) > 0


class MilestoneHistorySerializer(serializers.ModelSerializer):
    changed_by = MemberSummarySerializer(read_only=True)

    class Meta:
        model = MilestoneHistory
        fields = ["id", "field_changed", "old_value", "new_value", "changed_by", "changed_at", "note"]


class EvidenceSerializer(serializers.Serializer):
    url = serializers.URLField(max_length=500)
    label = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    link_type = serializers.ChoiceField(choices=EvidenceType.choices, default=EvidenceType.DRIVE)


class ReviewReadSerializer(serializers.Serializer):
    """The review as the team sees it: decision, note, severity, issues and attribution of the round. No mark."""

    id = serializers.IntegerField()
    decision = serializers.CharField()
    reviewer = MemberSummarySerializer()
    reviewed_at = serializers.DateTimeField()
    review_note = serializers.CharField()
    severity = serializers.SerializerMethodField()
    issues_summary = serializers.SerializerMethodField()
    is_attributable = serializers.SerializerMethodField()
    attribution_reason = serializers.SerializerMethodField()

    def revision(self, review):
        return getattr(review, "revision", None) if review.decision == ReviewDecision.REVISION_REQUESTED else None

    @extend_schema_field(serializers.ChoiceField(choices=RevisionSeverity.choices, allow_null=True))
    def get_severity(self, review):
        revision = self.revision(review)
        return revision.severity if revision else None

    @extend_schema_field(OpenApiTypes.STR)
    def get_issues_summary(self, review):
        revision = self.revision(review)
        return revision.issues_summary if revision else ""

    @extend_schema_field(serializers.BooleanField(allow_null=True))
    def get_is_attributable(self, review):
        revision = self.revision(review)
        return revision.is_attributable if revision else None

    @extend_schema_field(OpenApiTypes.STR)
    def get_attribution_reason(self, review):
        revision = self.revision(review)
        return revision.attribution_reason if revision else ""


class SubmissionSerializer(serializers.ModelSerializer):
    submitted_by = MemberSummarySerializer(read_only=True)
    evidence = EvidenceSerializer(many=True, read_only=True)
    review = serializers.SerializerMethodField()
    is_first_complete = serializers.SerializerMethodField()

    class Meta:
        model = Submission
        fields = [
            "id", "submission_number", "is_complete", "is_first_complete", "submitted_by", "submitted_at",
            "submission_note", "evidence", "review",
        ]

    @extend_schema_field(ReviewReadSerializer(allow_null=True))
    def get_review(self, submission):
        review = getattr(submission, "review", None)
        return ReviewReadSerializer(review).data if review else None

    @extend_schema_field(OpenApiTypes.BOOL)
    def get_is_first_complete(self, submission):
        first = self.context.get("first_complete_submission_id")
        return first == submission.pk


class WorkSubmitSerializer(serializers.Serializer):
    submission_note = serializers.CharField(required=False, allow_blank=True, default="")
    evidence = EvidenceSerializer(many=True, required=False, default=list)
    declares_complete = serializers.BooleanField(
        default=True, help_text="The work meets the acceptance criteria (false: partial work, sent for feedback)."
    )


class ReviewWriteSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=ReviewDecision.choices)
    review_note = serializers.CharField(required=False, allow_blank=True, default="")
    severity = serializers.ChoiceField(choices=RevisionSeverity.choices, required=False)
    issues_summary = serializers.CharField(required=False, allow_blank=True, default="")
    is_attributable = serializers.BooleanField(required=False, default=True)
    attribution_reason = serializers.CharField(required=False, allow_blank=True, default="")
    raw_quality = serializers.DecimalField(
        max_digits=3, decimal_places=1, min_value=0, max_value=5, required=False, allow_null=True,
        help_text="The Head's final quality mark (0–5) of a validated Deliverable; may be entered later.",
    )


class LinkEndSerializer(serializers.ModelSerializer):
    work_order = serializers.SerializerMethodField()

    class Meta:
        model = Deliverable
        fields = ["id", "code", "title", "status", "work_order"]

    @extend_schema_field(LinkWorkOrderSerializer)
    def get_work_order(self, deliverable):
        return {"id": deliverable.work_order_id, "code": deliverable.work_order.code,
                "department": deliverable.work_order.department_id}


class DependencyLinkSerializer(serializers.ModelSerializer):
    prerequisite = LinkEndSerializer(read_only=True)
    dependent = LinkEndSerializer(read_only=True)
    release_milestone = serializers.SerializerMethodField()
    created_by = MemberSummarySerializer(read_only=True)
    approved_by = MemberSummarySerializer(read_only=True)
    manual_release_by = MemberSummarySerializer(read_only=True)
    state = serializers.SerializerMethodField()
    rights = serializers.SerializerMethodField()

    class Meta:
        model = DependencyLink
        fields = [
            "id", "prerequisite", "dependent", "link_type", "release_condition", "release_milestone", "link_status",
            "state", "released_at", "manually_released", "manual_release_by", "manual_release_at",
            "manual_release_reason", "reason", "created_by", "approved_by", "approved_at", "cancelled_at",
            "cancel_reason", "created_at", "rights",
        ]

    @extend_schema_field(MilestoneRefSerializer(allow_null=True))
    def get_release_milestone(self, link):
        milestone = link.release_milestone
        return {"id": milestone.pk, "title": milestone.title, "is_completed": milestone.is_completed} if milestone else None

    @extend_schema_field(serializers.ChoiceField(choices=["waiting", "released", "informational", "cancelled"]))
    def get_state(self, link):
        if link.link_status != LinkStatus.ACTIVE:
            return "cancelled"
        if link.link_type != LinkType.BLOCKS:
            return "informational"
        return "released" if link.released_at else "waiting"

    @extend_schema_field(LinkRightsSerializer)
    def get_rights(self, link):
        access = viewer(self)
        head = access.heads_any(link.prerequisite.work_order.department_id, link.dependent.work_order.department_id)
        active = link.link_status == LinkStatus.ACTIVE
        return {
            "cancel": head and active,
            "manual_release": head and active and link.link_type == LinkType.BLOCKS and not link.released_at,
        }


class DependencyCreateSerializer(serializers.Serializer):
    prerequisite = serializers.PrimaryKeyRelatedField(queryset=Deliverable.objects.select_related("work_order"))
    dependent = serializers.PrimaryKeyRelatedField(queryset=Deliverable.objects.select_related("work_order"))
    link_type = serializers.ChoiceField(choices=LinkType.choices, default=LinkType.BLOCKS)
    release_condition = serializers.ChoiceField(choices=ReleaseCondition.choices, default=ReleaseCondition.VALIDATED)
    release_milestone = serializers.PrimaryKeyRelatedField(
        queryset=Milestone.objects.all(), required=False, allow_null=True
    )
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class DependencyProposalSerializer(serializers.ModelSerializer):
    proposed_prerequisite = LinkEndSerializer(read_only=True)
    proposed_dependent = LinkEndSerializer(read_only=True)
    proposed_by = MemberSummarySerializer(read_only=True)
    decided_by = MemberSummarySerializer(read_only=True)
    can_decide = serializers.SerializerMethodField()

    class Meta:
        model = DependencyProposal
        fields = [
            "id", "proposed_prerequisite", "proposed_dependent", "proposed_link_type", "proposed_release_condition",
            "proposed_milestone", "justification", "status", "proposed_by", "decided_by", "decided_at",
            "decision_note", "dependency_link", "created_at", "can_decide",
        ]

    @extend_schema_field(OpenApiTypes.BOOL)
    def get_can_decide(self, proposal):
        access = viewer(self)
        return (
            proposal.status == ProposalStatus.PENDING_REVIEW and proposal.proposed_by_id != access.user.pk
            and access.heads_any(
                proposal.proposed_prerequisite.work_order.department_id,
                proposal.proposed_dependent.work_order.department_id,
            )
        )


class ReliefIntervalSerializer(serializers.ModelSerializer):
    claimed_by = MemberSummarySerializer(read_only=True)
    decided_by = MemberSummarySerializer(read_only=True)

    class Meta:
        model = ReliefInterval
        fields = [
            "id", "deliverable", "dependency_link", "blocker", "needed_at", "waiting_started_at", "released_at",
            "impact_description", "team_ready", "directly_prevented", "status", "claimed_by", "claimed_at",
            "approved_start", "approved_end", "approved_days", "decided_by", "decided_at", "decision_note",
        ]
        read_only_fields = [
            "deliverable", "status", "claimed_by", "claimed_at", "approved_start", "approved_end", "approved_days",
            "decided_by", "decided_at", "decision_note",
        ]
        extra_kwargs = {
            "dependency_link": {"queryset": DependencyLink.objects.all(), "required": False, "allow_null": True},
            "blocker": {"queryset": Blocker.objects.all(), "required": False, "allow_null": True},
        }


class ReliefDecisionSerializer(serializers.Serializer):
    approve = serializers.BooleanField()
    approved_start = serializers.DateField(required=False)
    approved_end = serializers.DateField(required=False)
    note = serializers.CharField(required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if attrs["approve"] and not (attrs.get("approved_start") and attrs.get("approved_end")):
            raise serializers.ValidationError({"approved_end": _("Give the verified start and end of the period.")})
        return attrs


class WorkBlockerSerializer(serializers.ModelSerializer):
    reported_by = MemberSummarySerializer(read_only=True)
    resolved_by = MemberSummarySerializer(read_only=True)
    resolver = MemberSummarySerializer(read_only=True)
    responsible_unit = OrgUnitSummarySerializer(read_only=True)
    target = serializers.SerializerMethodField()
    validation = serializers.SerializerMethodField()
    rights = serializers.SerializerMethodField()

    class Meta:
        model = Blocker
        fields = [
            "id", "deliverable", "work_order", "target", "milestone", "dependency_link", "previous", "origin",
            "severity", "impact", "description", "required_action", "responsible_unit", "resolver", "status",
            "resolution_note", "reported_by", "reported_at", "resolved_by", "resolved_at", "updated_at",
            "validation", "rights",
        ]

    @extend_schema_field(BlockerTargetSerializer(allow_null=True))
    def get_target(self, blocker):
        item = blocker.deliverable or blocker.work_order
        kind = "deliverable" if blocker.deliverable_id else "work_order"
        return {"kind": kind, "id": item.pk, "code": item.code or "", "title": item.title} if item else None

    @extend_schema_field(BlockerValidationOutSerializer(allow_null=True))
    def get_validation(self, blocker):
        validation = getattr(blocker, "validation", None)
        if validation is None:
            return None
        return {"impact_confirmed": validation.impact_confirmed, "impact_note": validation.impact_note,
                "validated_at": validation.validated_at,
                "validated_by": MemberSummarySerializer(validation.validated_by).data if validation.validated_by else None}

    @extend_schema_field(BlockerRightsSerializer)
    def get_rights(self, blocker):
        access = viewer(self)
        work_order = blocker.deliverable.work_order if blocker.deliverable_id else blocker.work_order
        head = access.heads(work_order.department_id)
        open_ = blocker.status == BlockerStatus.OPEN
        return {
            "edit": open_ and (head or blocker.reported_by_id == access.user.pk),
            "resolve": open_ and (head or blocker.resolver_id == access.user.pk),
            "cancel": open_ and (head or blocker.reported_by_id == access.user.pk),
            "validate_impact": head and getattr(blocker, "validation", None) is None,
        }


class WorkBlockerWriteSerializer(serializers.Serializer):
    deliverable = serializers.PrimaryKeyRelatedField(
        queryset=Deliverable.objects.select_related("work_order"), required=False, allow_null=True
    )
    work_order = serializers.PrimaryKeyRelatedField(queryset=WorkOrder.objects.all(), required=False, allow_null=True)
    milestone = serializers.PrimaryKeyRelatedField(queryset=Milestone.objects.all(), required=False, allow_null=True)
    dependency_link = serializers.PrimaryKeyRelatedField(
        queryset=DependencyLink.objects.all(), required=False, allow_null=True
    )
    previous = serializers.PrimaryKeyRelatedField(queryset=Blocker.objects.all(), required=False, allow_null=True)
    origin = serializers.ChoiceField(choices=BlockerOrigin.choices, default=BlockerOrigin.OTHER)
    severity = serializers.ChoiceField(choices=BlockerSeverity.choices)
    impact = serializers.ChoiceField(choices=BlockerImpact.choices, default=BlockerImpact.PARTIAL)
    description = serializers.CharField()
    required_action = serializers.CharField(required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if not attrs.get("deliverable") and not attrs.get("work_order"):
            raise serializers.ValidationError({"deliverable": _("Say which Deliverable or Work Order is blocked.")})
        return attrs


class WorkBlockerUpdateSerializer(serializers.Serializer):
    origin = serializers.ChoiceField(choices=BlockerOrigin.choices, required=False)
    severity = serializers.ChoiceField(choices=BlockerSeverity.choices, required=False)
    impact = serializers.ChoiceField(choices=BlockerImpact.choices, required=False)
    description = serializers.CharField(required=False)
    required_action = serializers.CharField(required=False, allow_blank=True)
    responsible_unit = serializers.PrimaryKeyRelatedField(queryset=OrgUnit.objects.all(), required=False, allow_null=True)
    resolver = serializers.PrimaryKeyRelatedField(
        queryset=Member.objects.filter(is_active=True), required=False, allow_null=True
    )


class ImpactSerializer(serializers.Serializer):
    impact_confirmed = serializers.BooleanField()
    impact_note = serializers.CharField(required=False, allow_blank=True, default="")


class DeliverableLinksSerializer(serializers.Serializer):
    prerequisites = DependencyLinkSerializer(many=True)
    dependents = DependencyLinkSerializer(many=True)


class DeliverableDetailSerializer(DeliverableSerializer):
    assignments = AssignmentSerializer(many=True, read_only=True)
    milestones = serializers.SerializerMethodField()
    submissions = serializers.SerializerMethodField()
    dependencies = serializers.SerializerMethodField()
    blockers = serializers.SerializerMethodField()
    relief = serializers.SerializerMethodField()
    first_complete_submission_at = serializers.SerializerMethodField()
    rights = serializers.SerializerMethodField()
    proposal_decided_by = MemberSummarySerializer(read_only=True)

    class Meta(DeliverableSerializer.Meta):
        fields = DeliverableSerializer.Meta.fields + [
            "description", "acceptance_criteria", "assignments", "milestones", "submissions", "dependencies",
            "blockers", "relief", "first_complete_submission_at", "rights", "proposal_submitted_at",
            "proposal_decided_at", "proposal_decided_by", "proposal_note", "updated_at",
        ]

    @extend_schema_field(MilestoneSerializer(many=True))
    def get_milestones(self, deliverable):
        return MilestoneSerializer(deliverable.milestones.all(), many=True, context=self.context).data

    @extend_schema_field(OpenApiTypes.DATETIME)
    def get_first_complete_submission_at(self, deliverable):
        first = getattr(deliverable, "first_complete", None)
        return first.first_submitted_at if first else None

    @extend_schema_field(SubmissionSerializer(many=True))
    def get_submissions(self, deliverable):
        first = getattr(deliverable, "first_complete", None)
        context = {**self.context, "first_complete_submission_id": first.submission_id if first else None}
        return SubmissionSerializer(deliverable.submissions.all(), many=True, context=context).data

    @extend_schema_field(DeliverableLinksSerializer)
    def get_dependencies(self, deliverable):
        incoming = [link for link in deliverable.prerequisite_links.all()]
        outgoing = [link for link in deliverable.dependents_links.all()]
        return {
            "prerequisites": DependencyLinkSerializer(incoming, many=True, context=self.context).data,
            "dependents": DependencyLinkSerializer(outgoing, many=True, context=self.context).data,
        }

    @extend_schema_field(WorkBlockerSerializer(many=True))
    def get_blockers(self, deliverable):
        return WorkBlockerSerializer(deliverable.blockers.all(), many=True, context=self.context).data

    @extend_schema_field(ReliefIntervalSerializer(many=True))
    def get_relief(self, deliverable):
        return ReliefIntervalSerializer(deliverable.relief_intervals.all(), many=True).data

    @extend_schema_field(DeliverableRightsSerializer)
    def get_rights(self, deliverable):
        return deliverable_rights(viewer(self), deliverable)


class DeliverableWriteSerializer(serializers.ModelSerializer):
    member_ids = serializers.PrimaryKeyRelatedField(
        queryset=Member.objects.filter(is_active=True), many=True, required=False, write_only=True
    )
    weight = serializers.DecimalField(max_digits=6, decimal_places=3, min_value=0, max_value=100, required=False)
    justification = serializers.CharField(required=False, allow_blank=True, write_only=True)
    submit = serializers.BooleanField(required=False, default=True, write_only=True)
    reason = serializers.CharField(required=False, allow_blank=True, write_only=True)
    note = serializers.CharField(required=False, allow_blank=True, write_only=True)

    class Meta:
        model = Deliverable
        fields = [
            "title", "description", "acceptance_criteria", "start_date", "original_deadline", "weight", "member_ids",
            "justification", "submit", "reason", "note",
        ]

    def validate(self, attrs):
        start, end = attrs.get("start_date"), attrs.get("original_deadline")
        if start and end and end < start:
            raise serializers.ValidationError({"original_deadline": _("The deadline cannot be before the start date.")})
        return attrs


class WorkProgressSerializer(serializers.Serializer):
    progress = serializers.IntegerField(min_value=0, max_value=100)
    note = serializers.CharField(required=False, allow_blank=True, default="")


class AssignSerializer(serializers.Serializer):
    member = serializers.PrimaryKeyRelatedField(queryset=Member.objects.filter(is_active=True))
    role = serializers.ChoiceField(choices=AssignmentRole.choices, default=AssignmentRole.MEMBER)
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class RoleSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=AssignmentRole.choices)


class MilestoneWriteSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, default="")


class MilestoneCompleteSerializer(serializers.Serializer):
    is_completed = serializers.BooleanField()
    note = serializers.CharField(required=False, allow_blank=True, default="")


class ActivitySerializer(serializers.ModelSerializer):
    actor = MemberSummarySerializer(read_only=True)

    class Meta:
        model = ActivityLog
        fields = ["id", "entity_type", "entity_id", "deliverable", "work_order", "action", "actor", "old_value",
                  "new_value", "reason", "occurred_at"]

    def to_representation(self, instance):
        """Weight changes stay with those who see the budget (guide §2.1)."""
        data = super().to_representation(instance)
        if instance.action in ("weight_changed", "budget_changed") and instance.work_order_id:
            if not viewer(self).sees_budget(instance.work_order.department_id):
                data["old_value"], data["new_value"] = {}, {}
        return data

