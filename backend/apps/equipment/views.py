"""
The workshop API (decision D-016, knowledge base: PROJECTS/ERP/workshop_design.md): equipment, certifications,
reservations, loans and maintenance. Who may do what: access.py; the rules of each change: workflow.py.
"""

from datetime import date, datetime, time, timedelta

from django.db import transaction
from django.db.models import Prefetch, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from . import workflow
from .access import equipment_access_for
from .models import (
    Equipment, EquipmentCategory, EquipmentCertification, EquipmentLoan, EquipmentMaintenance, EquipmentReservation,
    EquipmentStatus, LoanStatus,
)
from .serializers import (
    CertificationCreateSerializer, CertificationSerializer, EquipmentDetailSerializer,
    EquipmentSerializer, EquipmentWriteSerializer, LoanCreateSerializer, LoanSerializer, MaintenanceCreateSerializer,
    RefuseSerializer, ReservationCancelSerializer, ReservationCreateSerializer, ReservationSerializer, ReturnSerializer, RightsSerializer,
)

ITEM = OpenApiParameter("id", int, OpenApiParameter.PATH)
CERTIFICATION = OpenApiParameter("certification_id", int, OpenApiParameter.PATH)


def require(allowed, message):
    if not allowed:
        raise PermissionDenied(message)


def require_manager(request):
    require(equipment_access_for(request).can_manage(),
            _("Only the equipment managers (Operations, the workshop lead) can do this."))


@extend_schema_view(
    list=extend_schema(
        summary="The workshop's equipment (every member sees it)",
        parameters=[
            OpenApiParameter("q", str, description="Words of its name, its place or its description."),
            OpenApiParameter("category", enum=EquipmentCategory.values),
            OpenApiParameter("status", enum=EquipmentStatus.values),
        ],
    ),
    retrieve=extend_schema(summary="An item, with its slots, certified members, maintenance and loans",
                           parameters=[ITEM]),
    create=extend_schema(summary="Add an item (equipment managers)", request=EquipmentWriteSerializer,
                         responses={201: EquipmentDetailSerializer}),
    partial_update=extend_schema(summary="Change an item or its status (equipment managers)", parameters=[ITEM],
                                 request=EquipmentWriteSerializer, responses=EquipmentDetailSerializer),
)
class EquipmentViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin,
                       mixins.UpdateModelMixin, viewsets.GenericViewSet):
    http_method_names = ["get", "post", "patch"]
    lookup_value_regex = r"\d+"
    queryset = Equipment.objects.none()

    def get_serializer_class(self):
        if self.action == "list":
            return EquipmentSerializer
        if self.action in ("create", "partial_update"):
            return EquipmentWriteSerializer
        return EquipmentDetailSerializer

    def get_queryset(self):
        items = Equipment.objects.all()
        if self.action != "list":
            return items.prefetch_related(
                Prefetch("reservations", queryset=EquipmentReservation.objects.select_related(
                    "equipment", "reserved_by", "cancelled_by")),
                Prefetch("certifications", queryset=EquipmentCertification.objects.select_related(
                    "member", "granted_by")),
                Prefetch("maintenance_logs", queryset=EquipmentMaintenance.objects.select_related("performed_by")),
                Prefetch("loans", queryset=EquipmentLoan.objects.select_related(
                    "equipment", "borrower", "decided_by", "received_by")),
            )
        params = self.request.query_params
        for word in params.get("q", "").split():
            items = items.filter(
                Q(name__icontains=word) | Q(location__icontains=word) | Q(description__icontains=word)
            )
        for name in ("category", "status"):
            if params.get(name):
                items = items.filter(**{name: params[name]})
        return items

    def detail_response(self, equipment, status=200):
        fresh = self.get_queryset().get(pk=equipment.pk)
        return Response(EquipmentDetailSerializer(fresh, context=self.get_serializer_context()).data, status=status)

    def locked(self, pk):
        return get_object_or_404(Equipment.objects.select_for_update(), pk=pk)

    def create(self, request, *args, **kwargs):
        require_manager(request)
        serializer = EquipmentWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        equipment = Equipment.objects.create(**serializer.validated_data)
        return self.detail_response(equipment, status=201)

    def partial_update(self, request, *args, **kwargs):
        require_manager(request)
        with transaction.atomic():
            equipment = self.locked(kwargs["pk"])
            serializer = EquipmentWriteSerializer(equipment, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            changes = dict(serializer.validated_data)
            status = changes.pop("status", None)
            for name, value in changes.items():
                setattr(equipment, name, value)
            equipment.save()
            if status:
                workflow.set_status(equipment, status, request.user)
        return self.detail_response(equipment)

    @extend_schema(summary="What the viewer may do in the workshop", responses=RightsSerializer)
    @action(detail=False, methods=["get"])
    def rights(self, request):
        access = equipment_access_for(request)
        return Response(RightsSerializer({"manage": access.can_manage(), "certify": access.can_certify()}).data)

    @extend_schema(summary="Reserve a slot: confirmed at once when free (certified when needed)", parameters=[ITEM],
                   request=ReservationCreateSerializer, responses={201: ReservationSerializer})
    @action(detail=True, methods=["post"])
    def reservations(self, request, pk=None):
        serializer = ReservationCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            reservation = workflow.reserve(
                self.locked(pk), request.user, data["reserved_from"], data["reserved_to"], data["purpose"],
                equipment_access_for(request),
            )
        return Response(ReservationSerializer(reservation, context=self.get_serializer_context()).data, status=201)

    @extend_schema(summary="Ask to borrow it out of the workshop: the managers decide", parameters=[ITEM],
                   request=LoanCreateSerializer, responses={201: LoanSerializer})
    @action(detail=True, methods=["post"])
    def loans(self, request, pk=None):
        serializer = LoanCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            loan = workflow.request_loan(
                self.locked(pk), request.user, data["reason"], data["due_date"], equipment_access_for(request)
            )
        return Response(LoanSerializer(loan, context=self.get_serializer_context()).data, status=201)

    @extend_schema(summary="Record a maintenance, and the status after it (equipment managers)", parameters=[ITEM],
                   request=MaintenanceCreateSerializer, responses={201: EquipmentDetailSerializer})
    @action(detail=True, methods=["post"])
    def maintenance(self, request, pk=None):
        require_manager(request)
        serializer = MaintenanceCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            equipment = self.locked(pk)
            workflow.record_maintenance(
                equipment, request.user, data.get("performed_at") or timezone.now(), data["description"],
                data.get("cost"), data.get("status") or "",
            )
        return self.detail_response(equipment, status=201)

    @extend_schema(summary="Certify a member on it (the workshop lead, the admins)", parameters=[ITEM],
                   request=CertificationCreateSerializer, responses={201: CertificationSerializer})
    @action(detail=True, methods=["post"])
    def certifications(self, request, pk=None):
        require(equipment_access_for(request).can_certify(), _("Only the workshop lead certifies the members."))
        serializer = CertificationCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            certification = workflow.certify(self.locked(pk), data["member_id"], request.user, data["note"])
        return Response(CertificationSerializer(certification, context=self.get_serializer_context()).data,
                        status=201)

    @extend_schema(summary="Revoke a certification (the workshop lead, the admins)", parameters=[ITEM, CERTIFICATION],
                   request=None, responses=EquipmentDetailSerializer)
    @action(detail=True, methods=["post"], url_path=r"certifications/(?P<certification_id>\d+)/revoke")
    def revoke(self, request, pk=None, certification_id=None):
        require(equipment_access_for(request).can_certify(), _("Only the workshop lead certifies the members."))
        with transaction.atomic():
            certification = get_object_or_404(
                EquipmentCertification.objects.select_for_update(), pk=certification_id, equipment_id=pk
            )
            workflow.revoke(certification, request.user)
        return self.detail_response(certification.equipment)


@extend_schema_view(
    list=extend_schema(
        summary="The viewer's reservations",
        parameters=[OpenApiParameter("when", enum=["upcoming", "past"], description="Coming or over (all by default).")],
    ),
)
class ReservationViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = ReservationSerializer
    lookup_value_regex = r"\d+"

    def get_queryset(self):
        reservations = EquipmentReservation.objects.select_related("equipment", "reserved_by", "cancelled_by")
        if self.action != "list":
            return reservations
        reservations = reservations.filter(reserved_by=self.request.user)
        when = self.request.query_params.get("when")
        if when == "upcoming":
            reservations = reservations.filter(reserved_to__gt=timezone.now(), status__in=workflow.ACTIVE_RESERVATIONS)
        elif when == "past":
            reservations = reservations.filter(reserved_to__lte=timezone.now()).order_by("-reserved_from")
        return reservations

    @extend_schema(
        summary="The slots of a week, all the equipment (the team's Figma: the week calendar)",
        parameters=[
            OpenApiParameter("start", str, description="A day of the week (YYYY-MM-DD); its Monday is taken. This week "
                                                      "by default."),
            OpenApiParameter("equipment", int, description="Only this equipment's slots."),
        ],
        responses=ReservationSerializer(many=True),
    )
    @action(detail=False, methods=["get"], pagination_class=None)
    def week(self, request):
        """Every member sees them, as each equipment's sheet shows its coming slots and who booked them."""
        text = request.query_params.get("start")
        try:
            day = date.fromisoformat(text) if text else timezone.localdate()
            if not 2000 <= day.year <= 2100:  # 9999-12-31 would overflow the week computed from it
                raise ValueError(text)
        except ValueError as wrong:
            raise ValidationError({"start": [_("A day is written YYYY-MM-DD.")]}) from wrong
        monday = day - timedelta(days=day.weekday())
        start = timezone.make_aware(datetime.combine(monday, time.min))
        slots = EquipmentReservation.objects.select_related("equipment", "reserved_by", "cancelled_by").filter(
            status__in=workflow.ACTIVE_RESERVATIONS, reserved_from__lt=start + timedelta(days=7), reserved_to__gt=start,
        ).order_by("reserved_from", "id")
        equipment = request.query_params.get("equipment", "")
        if equipment.isdigit():
            slots = slots.filter(equipment_id=int(equipment))
        return Response(ReservationSerializer(slots, many=True, context=self.get_serializer_context()).data)

    @extend_schema(summary="Cancel a reservation (its author, a manager: the author is then told)",
                   parameters=[OpenApiParameter("id", int, OpenApiParameter.PATH)], request=ReservationCancelSerializer,
                   responses=ReservationSerializer)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        serializer = ReservationCancelSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            reservation = get_object_or_404(
                EquipmentReservation.objects.select_for_update(of=("self",)).select_related("equipment"), pk=pk
            )
            require(equipment_access_for(request).can_cancel_reservation(reservation),
                    _("Only its author or an equipment manager cancels a reservation."))
            workflow.cancel_reservation(reservation, request.user, reason=serializer.validated_data["reason"])
        fresh = self.get_queryset().get(pk=reservation.pk)
        return Response(ReservationSerializer(fresh, context=self.get_serializer_context()).data)


LOAN = OpenApiParameter("id", int, OpenApiParameter.PATH)


@extend_schema_view(
    list=extend_schema(
        summary="The loans: the viewer's own, all of them for a manager",
        parameters=[
            OpenApiParameter("status", enum=LoanStatus.values),
            OpenApiParameter("mine", bool, description="Only the viewer's own (for a manager)."),
        ],
    ),
    retrieve=extend_schema(summary="A loan", parameters=[LOAN]),
)
class LoanViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = LoanSerializer
    lookup_value_regex = r"\d+"

    def get_queryset(self):
        loans = EquipmentLoan.objects.select_related("equipment", "borrower", "decided_by", "received_by")
        params = self.request.query_params
        if not equipment_access_for(self.request).can_manage() or params.get("mine") in ("1", "true"):
            loans = loans.filter(borrower=self.request.user)
        status = params.get("status")
        if status:
            if status not in LoanStatus.values:
                raise ValidationError({"status": _("Unknown status.")})
            loans = loans.filter(status=status)
        return loans

    def change(self, request, pk, apply, manager=True):
        """Lock the loan the viewer sees (404 otherwise) and its equipment, apply the change, return the loan."""
        with transaction.atomic():
            seen = get_object_or_404(self.get_queryset(), pk=pk)
            if manager:
                require_manager(request)
            loan = EquipmentLoan.objects.select_for_update(of=("self",)).get(pk=seen.pk)
            loan.equipment = Equipment.objects.select_for_update().get(pk=loan.equipment_id)
            apply(loan)
        fresh = self.get_queryset().get(pk=loan.pk)
        return Response(LoanSerializer(fresh, context=self.get_serializer_context()).data)

    @extend_schema(summary="Hand it out: the equipment leaves the workshop (equipment managers)", parameters=[LOAN],
                   request=None, responses=LoanSerializer)
    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return self.change(request, pk, lambda loan: workflow.approve(loan, request.user))

    @extend_schema(summary="Refuse it, saying why (equipment managers)", parameters=[LOAN], request=RefuseSerializer,
                   responses=LoanSerializer)
    @action(detail=True, methods=["post"])
    def refuse(self, request, pk=None):
        serializer = RefuseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        note = serializer.validated_data["note"]
        return self.change(request, pk, lambda loan: workflow.refuse(loan, request.user, note))

    @extend_schema(summary="Record its return and its condition (equipment managers)", parameters=[LOAN],
                   request=ReturnSerializer, responses=LoanSerializer)
    @action(detail=True, methods=["post"], url_path="return")
    def receive(self, request, pk=None):
        serializer = ReturnSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        return self.change(request, pk, lambda loan: workflow.receive(loan, request.user, data["condition"],
                                                                      data["note"]))

    @extend_schema(summary="Withdraw the request (its borrower, until it is decided)", parameters=[LOAN],
                   request=None, responses=LoanSerializer)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        def apply(loan):
            require(equipment_access_for(request).is_viewer(loan.borrower_id),
                    _("Only the member who asked withdraws the request."))
            workflow.cancel_loan(loan)

        return self.change(request, pk, apply, manager=False)
