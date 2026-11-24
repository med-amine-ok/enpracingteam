from django.db import transaction
from django.db.models import Case, F, IntegerField, Max, Q, Value, When
from django.utils.translation import gettext as _
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.communication import notify
from apps.purchasing.models import Part, PartCategory

from . import movements
from .access import stock_access_for
from .models import StockItem, StockMovement, StockMovementType as Type
from .serializers import (
    StockAddSerializer, StockCountSerializer, StockItemChangeSerializer, StockItemCreateSerializer, StockItemDetailSerializer,
    StockItemSerializer, StockMovementSerializer, StockSummarySerializer, StockTakeSerializer,
)

RECENT_MOVEMENTS = 50
LOW_FIRST = Case(When(quantity_available__lte=F("min_threshold"), then=Value(0)), default=Value(1),
                 output_field=IntegerField())
MOVEMENT_RELATIONS = ("moved_by", "handed_to", "related_task", "related_purchase_order", "stock_item__part")


def require_manager(request):
    if not stock_access_for(request).can_manage():
        raise PermissionDenied(_("Only the stock managers (Operations, the workshop lead) can do this."))


def integer(params, name):
    value = params.get(name)
    if value and not value.isdigit():
        raise ValidationError({name: _("A number is expected.")})
    return int(value) if value else None


@extend_schema_view(
    list=extend_schema(
        summary="Stock lines (every member sees them), the low ones first",
        parameters=[
            OpenApiParameter("search", str, description="Words in the part's name or reference, or the place."),
            OpenApiParameter("low", bool, description="Only the lines at their threshold or below."),
            OpenApiParameter("category", enum=PartCategory.values, description="Only the parts of this category."),
            OpenApiParameter("part", int, description="Only the lines of this part."),
        ],
    ),
    retrieve=extend_schema(summary="A stock line with its latest movements"),
    create=extend_schema(
        summary="A new stock line, with the quantity already there (stock managers)",
        request=StockItemCreateSerializer, responses={201: StockItemDetailSerializer},
    ),
    partial_update=extend_schema(
        summary="Change the place or the threshold of a line (stock managers)",
        request=StockItemChangeSerializer, responses=StockItemDetailSerializer,
    ),
)
class StockItemViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_serializer_class(self):
        return StockItemDetailSerializer if self.action == "retrieve" else StockItemSerializer

    def base_queryset(self):
        return StockItem.objects.select_related("part").annotate(last_moved_at=Max("movements__moved_at"))

    def get_queryset(self):
        items = self.base_queryset()
        if self.action != "list":
            return items
        params = self.request.query_params
        if words := params.get("search", "").strip():
            items = items.filter(
                Q(part__name__icontains=words) | Q(part__reference__icontains=words) | Q(location__icontains=words)
            )
        if params.get("low") in ("1", "true"):
            items = items.filter(quantity_available__lte=F("min_threshold"))
        if params.get("category"):
            items = items.filter(part__category=params["category"])
        if (part := integer(params, "part")) is not None:
            items = items.filter(part_id=part)
        return items.order_by(LOW_FIRST, "part__name", "location", "id")

    def detail_response(self, item, status=200):
        fresh = self.base_queryset().get(pk=item.pk)
        fresh.recent_movements = list(
            fresh.movements.select_related(*MOVEMENT_RELATIONS).order_by("-moved_at", "-id")[:RECENT_MOVEMENTS]
        )
        return Response(StockItemDetailSerializer(fresh, context=self.get_serializer_context()).data, status=status)

    def retrieve(self, request, *args, **kwargs):
        return self.detail_response(self.get_object())

    def create(self, request, *args, **kwargs):
        require_manager(request)
        serializer = StockItemCreateSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            part = data.get("part") or Part.objects.create(**data["new_part"])
            item = StockItem.objects.create(part=part, location=data["location"], min_threshold=data.get("min_threshold", 0))
            if data["initial_quantity"]:
                movements.record(
                    item, Type.IN, data["initial_quantity"], by=request.user,
                    notes=data.get("notes") or _("Stock already there when the line was created."),
                )
        return self.detail_response(item, status=201)

    def partial_update(self, request, *args, **kwargs):
        require_manager(request)
        item = self.get_object()
        with transaction.atomic():
            # The serializer works on the locked row: saved from the copy read before the lock, it would write
            # back a stale quantity over a movement recorded in between (save() writes every column).
            before = StockItem.objects.select_for_update().get(pk=item.pk)
            was_low = movements.is_low(before.quantity_available, before.min_threshold)
            serializer = StockItemChangeSerializer(
                before, data=request.data, partial=True, context=self.get_serializer_context()
            )
            serializer.is_valid(raise_exception=True)
            item = serializer.save()
            # A higher threshold may put the line under it: the managers are told, as after an exit.
            if not was_low and movements.is_low(item.quantity_available, item.min_threshold):
                notify.stock_low(item, request.user)
        return self.detail_response(item)

    def moved(self, request, pk, serializer_class, make):
        """Validates the body, then records the movement `make(item, data)` returns, as a manager."""
        require_manager(request)
        serializer = serializer_class(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        item = self.get_object()
        with transaction.atomic():
            try:
                make(item, serializer.validated_data)
            except movements.NotEnoughStock as short:
                message = _("Only %(available)s left in stock.") % {"available": short.available}
                raise ValidationError({"quantity": [message]}) from None
        return self.detail_response(item)

    @extend_schema(summary="Take parts out (stock managers): for a task, handed to a member", request=StockTakeSerializer,
                   responses=StockItemDetailSerializer)
    @action(detail=True, methods=["post"])
    def take(self, request, pk=None):
        return self.moved(request, pk, StockTakeSerializer, lambda item, data: movements.record(
            item, Type.OUT, data["quantity"], by=request.user, moved_at=data.get("moved_at"),
            notes=data.get("notes", ""), task=data.get("task"), handed_to=data.get("handed_to"),
        ))

    @extend_schema(summary="Put parts in by hand, saying where they come from (stock managers)",
                   request=StockAddSerializer, responses=StockItemDetailSerializer)
    @action(detail=True, methods=["post"])
    def add(self, request, pk=None):
        return self.moved(request, pk, StockAddSerializer, lambda item, data: movements.record(
            item, Type.IN, data["quantity"], by=request.user, moved_at=data.get("moved_at"), notes=data["notes"],
        ))

    @extend_schema(summary="Record a count: the difference becomes an adjustment (stock managers)",
                   request=StockCountSerializer, responses=StockItemDetailSerializer)
    @action(detail=True, methods=["post"])
    def count(self, request, pk=None):
        def adjust(item, data):
            available = StockItem.objects.select_for_update().get(pk=item.pk).quantity_available
            difference = data["counted"] - available
            if difference == 0:
                raise ValidationError({"counted": [_("The count matches the stock: nothing to adjust.")]})
            movements.record(item, Type.ADJUSTMENT, difference, by=request.user, moved_at=data.get("moved_at"),
                             notes=data["notes"])

        return self.moved(request, pk, StockCountSerializer, adjust)

    @extend_schema(summary="How many lines, how many low, and whether the viewer manages the stock",
                   responses=StockSummarySerializer)
    @action(detail=False, methods=["get"])
    def summary(self, request):
        items = StockItem.objects.all()
        return Response({
            "lines": items.count(),
            "low": items.filter(quantity_available__lte=F("min_threshold")).count(),
            "can_manage": stock_access_for(request).can_manage(),
        })


@extend_schema_view(
    list=extend_schema(
        summary="The stock journal: every movement, the latest first",
        parameters=[
            OpenApiParameter("item", int, description="Only the movements of this stock line."),
            OpenApiParameter("task", int, description="Only the parts taken for this task."),
            OpenApiParameter("type", enum=Type.values, description="Only this kind of movement."),
            OpenApiParameter("mine", bool, description="Only the movements the viewer recorded or received."),
        ],
    ),
)
class StockMovementViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = StockMovementSerializer

    def get_queryset(self):
        journal = StockMovement.objects.select_related(*MOVEMENT_RELATIONS)
        params = self.request.query_params
        if (item := integer(params, "item")) is not None:
            journal = journal.filter(stock_item_id=item)
        if (task := integer(params, "task")) is not None:
            journal = journal.filter(related_task_id=task)
        if params.get("type"):
            journal = journal.filter(movement_type=params["type"])
        if params.get("mine") in ("1", "true"):
            journal = journal.filter(Q(moved_by=self.request.user) | Q(handed_to=self.request.user))
        return journal.order_by("-moved_at", "-id")
