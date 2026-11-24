from django.db import transaction
from django.db.models import Case, Count, DateField, F, IntegerField, Prefetch, Q, Value, When
from django.utils import timezone
from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.generics import get_object_or_404
from rest_framework.response import Response

from . import workflow
from .access import AWAITING_APPROVAL, OPEN, parts_arrived, purchasing_access_for
from .models import (
    OrderBatch, Part, PurchaseOrder, PurchasePriority, PurchaseRequest, PurchaseRequestEvent, PurchaseStatus,
    ShippingAddress, Supplier, SupplierStatus, SupplierType,
)
from .serializers import (
    ApprovalSerializer, BatchReceptionSerializer, OrderBatchSerializer, OrderBatchWriteSerializer, PartSerializer,
    PurchaseOrderWriteSerializer, PurchaseRequestDetailSerializer, PurchaseRequestSerializer,
    PurchaseRequestWriteSerializer, PurchaseSummarySerializer, ReasonSerializer, ReceptionSerializer,
    ShippingAddressSerializer, SupplierSerializer, SupplierWriteSerializer, batch_with_lines,
)

STATUS = PurchaseStatus

OPEN_ONLY = Q(status__in=OPEN)
# Requests still moving first: the most urgent (P1) and the soonest needed first, then the oldest
# (first asked, first served). Then the delivered ones and the cancelled ones, the latest first.
LIST_ORDER = [
    Case(
        When(OPEN_ONLY, then=Value(0)), When(status=STATUS.LIVRE, then=Value(1)), default=Value(2),
        output_field=IntegerField(),
    ),
    Case(
        When(OPEN_ONLY & Q(priority=PurchasePriority.HIGH), then=Value(0)),
        When(OPEN_ONLY & Q(priority=PurchasePriority.MEDIUM), then=Value(1)),
        When(OPEN_ONLY & Q(priority=PurchasePriority.LOW), then=Value(2)),
        When(OPEN_ONLY, then=Value(3)),
        default=Value(0),
        output_field=IntegerField(),
    ),
    Case(When(OPEN_ONLY, then=F("requested_date")), default=Value(None), output_field=DateField()).asc(nulls_last=True),
    Case(When(OPEN_ONLY, then=F("id")), default=-F("id"), output_field=IntegerField()),
]
ORDERS = Prefetch("orders", queryset=PurchaseOrder.objects.select_related("supplier", "shipping_address").order_by("-id"))
# What the requests of a grouped order share: changing it on one of them changes it on all (D-023).
BATCH_SHARED = ("supplier", "currency", "exchange_rate", "ordered_at", "estimated_delivery_date", "shipping_address")
# Read with a request that is locked to be moved: what its step needs (the people to tell, its part).
LOCKED_WITH = ("part", "requested_by", "org_unit", "subsystem__project")

LIST_PARAMETERS = [
    OpenApiParameter("status", str, description=f"Only these statuses, comma-separated ({', '.join(STATUS.values)})."),
    OpenApiParameter("open", bool, description="Only the requests not delivered or cancelled yet."),
    OpenApiParameter("mine", bool, description="Only the viewer's requests."),
    OpenApiParameter("to_approve", bool, description="Only the requests awaiting the viewer's approval."),
    OpenApiParameter("unit", int, description="Only the requests for this unit."),
    OpenApiParameter("project", int, description="Only the requests for this project's subsystems."),
    OpenApiParameter("subsystem", int, description="Only the requests for this subsystem."),
    OpenApiParameter("search", str, description="Words in the part's name or reference."),
]


class WrongStep(APIException):
    """The request is no longer at the step the action needs (someone acted first: reload it)."""

    status_code = 409
    default_code = "wrong_step"


def require(allowed, message):
    if not allowed:
        raise PermissionDenied(message)


def at_step(purchase, statuses, message):
    if purchase.status not in statuses:
        raise WrongStep(message)


def integer(params, name):
    value = params.get(name)
    if value and not value.isdigit():
        raise ValidationError({name: _("A number is expected.")})
    return int(value) if value else None


def is_true(params, name):
    return params.get(name) in ("1", "true")


def no_parts_arrived(purchase):
    if parts_arrived(purchase):
        raise WrongStep(_("Parts of this order already arrived: receive the rest, or close the order with what arrived."))


def delivery_day(data, purchase):
    """The day the parts arrived (today by default): never before the order."""
    delivered_on = data.get("actual_delivery_date") or timezone.localdate()
    ordered_on = purchase.orders.get(status=STATUS.EN_COMMANDE).ordered_at
    if ordered_on is not None and delivered_on < ordered_on:
        raise ValidationError({"actual_delivery_date": _("The parts cannot arrive before the order date.")})
    return delivered_on


@extend_schema_view(
    list=extend_schema(summary="Purchase requests (every member sees all of them), open and most urgent first",
                       parameters=LIST_PARAMETERS),
    retrieve=extend_schema(summary="A purchase request with its order, its history and the viewer's rights"),
    create=extend_schema(
        summary="Ask for a part (people involved in the unit or the subsystem)",
        request=PurchaseRequestWriteSerializer,
        responses={201: PurchaseRequestDetailSerializer},
    ),
    partial_update=extend_schema(
        summary="Change a request while it awaits its leader (its author, its leaders)",
        request=PurchaseRequestWriteSerializer,
        responses=PurchaseRequestDetailSerializer,
    ),
)
class PurchaseRequestViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_serializer_class(self):
        if self.action in ("create", "partial_update"):
            return PurchaseRequestWriteSerializer
        if self.action == "retrieve":
            return PurchaseRequestDetailSerializer
        return PurchaseRequestSerializer

    def base_queryset(self):
        return PurchaseRequest.objects.select_related(
            "part", "requested_by", "org_unit", "subsystem__project", "suggested_supplier"
        ).prefetch_related(ORDERS)

    def detail_queryset(self):
        return self.base_queryset().prefetch_related(
            Prefetch("events", queryset=PurchaseRequestEvent.objects.select_related("actor").order_by("created_at", "id"))
        )

    def get_queryset(self):
        if self.action == "retrieve":
            return self.detail_queryset()
        purchases = self.base_queryset()
        params = self.request.query_params
        if params.get("status"):
            purchases = purchases.filter(status__in=params["status"].split(","))
        if is_true(params, "open"):
            purchases = purchases.filter(status__in=OPEN)
        if is_true(params, "mine"):
            purchases = purchases.filter(requested_by=self.request.user)
        if is_true(params, "to_approve"):
            purchases = purchasing_access_for(self.request).approvable(purchases)
        if (unit := integer(params, "unit")) is not None:
            purchases = purchases.filter(org_unit_id=unit)
        if (project := integer(params, "project")) is not None:
            purchases = purchases.filter(subsystem__project_id=project)
        if (subsystem := integer(params, "subsystem")) is not None:
            purchases = purchases.filter(subsystem_id=subsystem)
        if words := params.get("search", "").strip():
            purchases = purchases.filter(Q(part__name__icontains=words) | Q(part__reference__icontains=words))
        return purchases.order_by(*LIST_ORDER)

    def locked(self, pk):
        """The request, locked until the end of the transaction: two people acting at once are served
        one after the other, and the second one gets a clear "wrong step" answer."""
        return get_object_or_404(PurchaseRequest.objects.select_for_update(of=("self",)).select_related(*LOCKED_WITH), pk=pk)

    def detail_response(self, purchase):
        """The request as PurchaseRequestDetailSerializer shows it, read again after a change."""
        fresh = self.detail_queryset().get(pk=purchase.pk)
        return PurchaseRequestDetailSerializer(fresh, context=self.get_serializer_context()).data

    def valid(self, serializer_class, request):
        serializer = serializer_class(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data

    # --- Asking, changing ---

    def create(self, request, *args, **kwargs):
        serializer = PurchaseRequestWriteSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        access = purchasing_access_for(request)
        data = serializer.validated_data
        require(access.can_request_for(data["org_unit"], data.get("subsystem")), _("You cannot ask for parts for this unit."))
        with transaction.atomic():
            purchase = serializer.save()
            workflow.submit(purchase, access)
        return Response(self.detail_response(purchase), status=201)

    def partial_update(self, request, *args, **kwargs):
        access = purchasing_access_for(request)
        with transaction.atomic():
            purchase = self.locked(kwargs["pk"])
            at_step(purchase, [STATUS.A_VALIDER_CHEF], _("This request can no longer be changed: cancel it and ask again."))
            require(access.can_edit(purchase), _("You cannot change this request."))
            serializer = PurchaseRequestWriteSerializer(
                purchase, data=request.data, partial=True, context=self.get_serializer_context()
            )
            serializer.is_valid(raise_exception=True)
            data = serializer.validated_data
            if "org_unit" in data or "subsystem" in data:
                unit, subsystem = data.get("org_unit", purchase.org_unit), data.get("subsystem", purchase.subsystem)
                require(access.can_request_for(unit, subsystem), _("You cannot ask for parts for this unit."))
            serializer.save()
        return Response(self.detail_response(purchase))

    # --- Approving, refusing, cancelling ---

    @extend_schema(
        summary="Approve the step the request awaits (its leader, then the head of Operations)",
        request=ApprovalSerializer, responses=PurchaseRequestDetailSerializer,
    )
    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        comment = self.valid(ApprovalSerializer, request).get("comment", "")
        access = purchasing_access_for(request)
        with transaction.atomic():
            purchase = self.locked(pk)
            at_step(purchase, AWAITING_APPROVAL, _("This request is not awaiting approval any more."))
            require(access.can_approve(purchase), _("You cannot approve this request."))
            workflow.approve(purchase, access, comment)
        return Response(self.detail_response(purchase))

    @extend_schema(summary="Refuse the step the request awaits, with the reason", request=ReasonSerializer,
                   responses=PurchaseRequestDetailSerializer)
    @action(detail=True, methods=["post"])
    def refuse(self, request, pk=None):
        reason = self.valid(ReasonSerializer, request)["reason"]
        access = purchasing_access_for(request)
        with transaction.atomic():
            purchase = self.locked(pk)
            at_step(purchase, AWAITING_APPROVAL, _("This request is not awaiting approval any more."))
            require(access.can_approve(purchase), _("You cannot refuse this request."))
            workflow.refuse(purchase, access, reason)
        return Response(self.detail_response(purchase))

    @extend_schema(
        summary="Cancel the request, with the reason (its author until it is ordered, Operations until delivered)",
        request=ReasonSerializer, responses=PurchaseRequestDetailSerializer,
    )
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        reason = self.valid(ReasonSerializer, request)["reason"]
        access = purchasing_access_for(request)
        with transaction.atomic():
            purchase = self.locked(pk)
            at_step(purchase, OPEN, _("This request can no longer be cancelled."))
            no_parts_arrived(purchase)
            require(access.can_cancel(purchase), _("You cannot cancel this request."))
            workflow.cancel(purchase, access, reason)
        return Response(self.detail_response(purchase))

    # --- Ordering, receiving (Operations) ---

    @extend_schema(
        summary="Place the order of a request to order (Operations)",
        request=PurchaseOrderWriteSerializer, responses={201: PurchaseRequestDetailSerializer},
    )
    @action(detail=True, methods=["post"])
    def order(self, request, pk=None):
        access = purchasing_access_for(request)
        with transaction.atomic():
            purchase = self.locked(pk)
            at_step(purchase, [STATUS.A_COMMANDER], _("This request is not to be ordered."))
            require(access.can_order(purchase), _("Only Operations can order."))
            serializer = PurchaseOrderWriteSerializer(data=request.data, context=self.get_serializer_context())
            serializer.is_valid(raise_exception=True)
            workflow.order(purchase, access, serializer)
        return Response(self.detail_response(purchase), status=201)

    @extend_schema(
        summary="Change the order in progress: prices, dates, supplier (Operations). In a grouped order, the "
                "supplier, currency, rate, dates and shipping address change for all its requests.",
        request=PurchaseOrderWriteSerializer, responses=PurchaseRequestDetailSerializer,
    )
    @order.mapping.patch
    def change_order(self, request, pk=None):
        access = purchasing_access_for(request)
        with transaction.atomic():
            purchase = self.locked(pk)
            at_step(purchase, [STATUS.EN_COMMANDE], _("This request has no order in progress."))
            require(access.can_manage_order(purchase), _("Only Operations can manage the orders."))
            current = purchase.orders.select_for_update().get(status=STATUS.EN_COMMANDE)
            serializer = PurchaseOrderWriteSerializer(
                current, data=request.data, partial=True, context=self.get_serializer_context()
            )
            serializer.is_valid(raise_exception=True)
            serializer.save()
            shared = {key: value for key, value in serializer.validated_data.items() if key in BATCH_SHARED}
            if current.batch_id is not None and shared:
                others = PurchaseOrder.objects.select_for_update().select_related("purchase_request").filter(
                    batch_id=current.batch_id, status=STATUS.EN_COMMANDE
                )
                for other in others.exclude(pk=current.pk):
                    for key, value in shared.items():
                        setattr(other, key, value)
                    other.save()
                if "supplier" in shared:  # the grouped order itself names its supplier too
                    current.batch.supplier = shared["supplier"]
                    current.batch.save(update_fields=["supplier"])
        return Response(self.detail_response(purchase))

    @extend_schema(
        summary="Cancel the order in progress, with the reason: the request is to be ordered again (Operations)",
        request=ReasonSerializer, responses=PurchaseRequestDetailSerializer,
    )
    @action(detail=True, methods=["post"], url_path="cancel-order")
    def cancel_order(self, request, pk=None):
        reason = self.valid(ReasonSerializer, request)["reason"]
        access = purchasing_access_for(request)
        with transaction.atomic():
            purchase = self.locked(pk)
            at_step(purchase, [STATUS.EN_COMMANDE], _("This request has no order in progress."))
            require(access.can_manage_order(purchase), _("Only Operations can manage the orders."))
            no_parts_arrived(purchase)
            workflow.cancel_order(purchase, access, reason)
        return Response(self.detail_response(purchase))

    @extend_schema(
        summary="The rest of the parts will not come: deliver the order with those that arrived, which alone "
                "are paid, with the reason (Operations)",
        request=ReasonSerializer, responses=PurchaseRequestDetailSerializer,
    )
    @action(detail=True, methods=["post"], url_path="close-order")
    def close_order(self, request, pk=None):
        reason = self.valid(ReasonSerializer, request)["reason"]
        access = purchasing_access_for(request)
        with transaction.atomic():
            purchase = self.locked(pk)
            at_step(purchase, [STATUS.EN_COMMANDE], _("This request has no order in progress."))
            require(access.can_manage_order(purchase), _("Only Operations can manage the orders."))
            if not parts_arrived(purchase):
                raise WrongStep(_("None of its parts arrived: cancel the order instead."))
            workflow.close_short(purchase, access, reason)
        return Response(self.detail_response(purchase))

    @extend_schema(
        summary="Parts arrived (all those still to come by default): they enter the stock; the order is "
                "delivered once all of them are here (Operations)",
        request=ReceptionSerializer, responses=PurchaseRequestDetailSerializer,
    )
    @action(detail=True, methods=["post"])
    def receive(self, request, pk=None):
        data = self.valid(ReceptionSerializer, request)
        access = purchasing_access_for(request)
        with transaction.atomic():
            purchase = self.locked(pk)
            at_step(purchase, [STATUS.EN_COMMANDE], _("This request has no order in progress."))
            require(access.can_manage_order(purchase), _("Only Operations can manage the orders."))
            delivered_on = delivery_day(data, purchase)
            placed = purchase.orders.get(status=STATUS.EN_COMMANDE)
            if data.get("quantity", 0) > workflow.still_to_come(purchase, placed):
                raise ValidationError({"quantity": _("More parts than awaited: still to come, %(count)s.")
                                       % {"count": workflow.still_to_come(purchase, placed)}})
            workflow.receive(purchase, access, delivered_on, data.get("location", ""), data.get("quantity"))
        return Response(self.detail_response(purchase))

    # --- Counters ---

    @extend_schema(
        summary="How many requests at each step, awaiting the viewer, and the viewer's own still open",
        responses=PurchaseSummarySerializer,
    )
    @action(detail=False, methods=["get"])
    def summary(self, request):
        access = purchasing_access_for(request)
        counts = dict(PurchaseRequest.objects.order_by().values_list("status").annotate(count=Count("id")))
        return Response({
            "by_status": {status: counts.get(status, 0) for status in STATUS.values},
            "to_approve": access.approvable(PurchaseRequest.objects.all()).count(),
            "mine": PurchaseRequest.objects.filter(requested_by=request.user, status__in=OPEN).count(),
            "can_manage": access.can_manage(),
        })


@extend_schema_view(retrieve=extend_schema(summary="A grouped order: its supplier and its requests"))
class OrderBatchViewSet(mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Requests ordered together from one supplier, as one order on its side (decision D-023)."""

    serializer_class = OrderBatchSerializer

    def get_queryset(self):
        return batch_with_lines()

    def answer(self, batch, status=200):
        fresh = batch_with_lines().get(pk=batch.pk)
        return Response(OrderBatchSerializer(fresh, context=self.get_serializer_context()).data, status=status)

    @extend_schema(
        summary="Order several requests to order together from one supplier: the delivery and customs costs "
                "paid once are shared out between them in proportion to their price (Operations)",
        request=OrderBatchWriteSerializer, responses={201: OrderBatchSerializer},
    )
    def create(self, request, *args, **kwargs):
        access = purchasing_access_for(request)
        require(access.can_manage(), _("Only Operations can order."))
        serializer = OrderBatchWriteSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        shared = dict(serializer.validated_data)
        lines = shared.pop("lines")
        with transaction.atomic():
            ids = [line["purchase_request"].pk for line in lines]
            locked = PurchaseRequest.objects.select_for_update(of=("self",)).select_related(*LOCKED_WITH)
            purchases = {purchase.pk: purchase for purchase in locked.filter(pk__in=ids)}
            ordered = [(purchases[line["purchase_request"].pk], line["unit_price"]) for line in lines]
            for purchase, _price in ordered:
                at_step(purchase, [STATUS.A_COMMANDER], _("“%(part)s” is not to be ordered any more.") % {
                    "part": purchase.part.name
                })
            batch = workflow.order_batch(ordered, access, shared)
        return self.answer(batch, status=201)

    @extend_schema(
        summary="Every part still to come of the grouped order arrived: they enter the stock (Operations)",
        request=BatchReceptionSerializer, responses=OrderBatchSerializer,
    )
    @action(detail=True, methods=["post"])
    def receive(self, request, pk=None):
        data = BatchReceptionSerializer(data=request.data, context=self.get_serializer_context())
        data.is_valid(raise_exception=True)
        access = purchasing_access_for(request)
        require(access.can_manage(), _("Only Operations can manage the orders."))
        with transaction.atomic():
            batch = get_object_or_404(OrderBatch.objects.select_for_update(), pk=pk)
            waiting = PurchaseOrder.objects.filter(batch=batch, status=STATUS.EN_COMMANDE).values("purchase_request_id")
            purchases = list(
                PurchaseRequest.objects.select_for_update(of=("self",)).select_related(*LOCKED_WITH)
                .filter(pk__in=waiting).order_by("id")
            )
            if not purchases:
                raise WrongStep(_("Every part of this grouped order already arrived."))
            for purchase in purchases:
                workflow.receive(
                    purchase, access, delivery_day(data.validated_data, purchase),
                    data.validated_data.get("location", ""),
                )
        return self.answer(batch)


@extend_schema_view(
    list=extend_schema(
        summary="Suppliers, by name (contacts only for Operations, club admins and unit leaders)",
        parameters=[
            OpenApiParameter("search", str, description="Words in the name, capabilities or city."),
            OpenApiParameter("type", enum=SupplierType.values, description="Only this type."),
            OpenApiParameter("status", enum=SupplierStatus.values, description="Only this status."),
        ],
    ),
    retrieve=extend_schema(summary="A supplier"),
    create=extend_schema(summary="Add a supplier (Operations)", request=SupplierWriteSerializer,
                         responses={201: SupplierSerializer}),
    partial_update=extend_schema(summary="Change a supplier (Operations)", request=SupplierWriteSerializer,
                                 responses=SupplierSerializer),
)
class SupplierViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    http_method_names = ["get", "post", "patch", "head", "options"]
    serializer_class = SupplierSerializer
    pagination_class = None  # about a hundred: loaded at once, searched on the screen

    def get_queryset(self):
        suppliers = Supplier.objects.select_related("contacted_by").order_by("name", "id")
        params = self.request.query_params
        if words := params.get("search", "").strip():
            suppliers = suppliers.filter(
                Q(name__icontains=words) | Q(technical_capabilities__icontains=words) | Q(city__icontains=words)
            )
        if params.get("type"):
            suppliers = suppliers.filter(type=params["type"])
        if params.get("status"):
            suppliers = suppliers.filter(status=params["status"])
        return suppliers

    def write(self, request, supplier=None):
        require(purchasing_access_for(request).can_manage(), _("Only Operations can add or change suppliers."))
        serializer = SupplierWriteSerializer(
            supplier, data=request.data, partial=supplier is not None, context=self.get_serializer_context()
        )
        serializer.is_valid(raise_exception=True)
        saved = serializer.save()
        return Response(SupplierSerializer(saved, context=self.get_serializer_context()).data,
                        status=201 if supplier is None else 200)

    def create(self, request, *args, **kwargs):
        return self.write(request)

    def partial_update(self, request, *args, **kwargs):
        return self.write(request, self.get_object())


@extend_schema_view(
    list=extend_schema(
        summary="Parts already known, by name (to ask for one again)",
        parameters=[OpenApiParameter("search", str, description="Words in the name or reference.")],
    ),
    retrieve=extend_schema(summary="A part already known"),
)
class PartViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = PartSerializer

    def get_queryset(self):
        parts = Part.objects.order_by("name", "id")
        if words := self.request.query_params.get("search", "").strip():
            parts = parts.filter(Q(name__icontains=words) | Q(reference__icontains=words))
        return parts


@extend_schema_view(list=extend_schema(summary="Shipping addresses (Operations and club admins)"))
class ShippingAddressViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = ShippingAddressSerializer
    pagination_class = None
    queryset = ShippingAddress.objects.order_by("country", "id")

    def list(self, request, *args, **kwargs):
        require(
            purchasing_access_for(request).can_see_shipping_addresses(),
            _("Only Operations can see the shipping addresses."),
        )
        return super().list(request, *args, **kwargs)
