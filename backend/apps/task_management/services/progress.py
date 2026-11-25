"""Official progress, from the Deliverables' sliders up to the Season (specification §6). Progress is not points.

- Work Order: Σ wᵢ·Pᵢ / Σ wᵢ over its active Deliverables (their budget shares).
- Department: Σ B·P / Σ B over its Work Orders (their point budgets).
- Project: plain average of its participating Departments. Season: plain average of its Projects.
A level with nothing under it yet has no progress (None, shown as "planning"), and is left out of the average
above it."""

from collections import defaultdict

from ..models import DeliverableStatus, NOT_OFFICIAL, ProjectDepartment, WorkOrder, WorkOrderStatus
from .formulas import plain_average, weighted_average


def official_work_orders():
    return WorkOrder.objects.exclude(proposal_status__in=NOT_OFFICIAL).exclude(status=WorkOrderStatus.CANCELLED)


def work_order_progress(work_order, deliverables=None):
    deliverables = work_order.deliverables.all() if deliverables is None else deliverables
    return weighted_average(
        (deliverable.weight, deliverable.progress) for deliverable in deliverables
        if deliverable.status != DeliverableStatus.CANCELLED and deliverable.proposal_status not in NOT_OFFICIAL
    )


def department_progress(work_orders):
    """`work_orders`: the department's Work Orders, their Deliverables prefetched."""
    return weighted_average((work_order.budget_tier, work_order_progress(work_order)) for work_order in work_orders)


def loaded(queryset):
    return queryset.prefetch_related("deliverables")


def project_progress(project):
    work_orders = defaultdict(list)
    for work_order in loaded(official_work_orders().filter(project=project)):
        work_orders[work_order.department_id].append(work_order)
    departments = ProjectDepartment.objects.filter(project=project).values_list("org_unit_id", flat=True)
    by_department = {pk: department_progress(work_orders.get(pk, [])) for pk in departments}
    return plain_average(by_department.values()), by_department


def season_progress(season):
    by_project = {project.pk: project_progress(project)[0] for project in season.projects.all()}
    return plain_average(by_project.values()), by_project
