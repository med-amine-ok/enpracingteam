from django.utils import timezone
from django.utils.translation import gettext as _
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.members.models import Member
from apps.members.serializers import MemberSummarySerializer
from apps.purchasing.models import Part
from apps.purchasing.serializers import NewPartSerializer, PartSerializer
from apps.tasks.models import Task

from .models import StockItem, StockMovement
from .movements import is_low


class StockItemSerializer(serializers.ModelSerializer):
    """A stock line as listed: the part, its place, how many are left."""

    part = PartSerializer(read_only=True)
    is_low = serializers.SerializerMethodField()
    last_moved_at = serializers.DateTimeField(read_only=True, allow_null=True, help_text="Its latest movement.")

    class Meta:
        model = StockItem
        fields = ["id", "part", "location", "quantity_available", "min_threshold", "is_low", "last_moved_at", "updated_at"]
        read_only_fields = fields

    @extend_schema_field(serializers.BooleanField(help_text="At its threshold or below (to buy again)."))
    def get_is_low(self, item):
        return is_low(item.quantity_available, item.min_threshold)


class TaskSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Task
        fields = ["id", "title"]
        read_only_fields = fields


class StockLineSummarySerializer(serializers.ModelSerializer):
    """A stock line inside a movement of the journal: its part and its place."""

    part = serializers.CharField(source="part.name", read_only=True)

    class Meta:
        model = StockItem
        fields = ["id", "part", "location"]
        read_only_fields = fields


class StockMovementSerializer(serializers.ModelSerializer):
    """One movement: an entry, an exit (for a task, handed to a member) or a count."""

    moved_by = MemberSummarySerializer(read_only=True)
    handed_to = MemberSummarySerializer(read_only=True, allow_null=True)
    task = TaskSummarySerializer(source="related_task", read_only=True, allow_null=True)
    purchase_request_id = serializers.IntegerField(
        source="related_purchase_order.purchase_request_id", read_only=True, allow_null=True,
        help_text="The purchase request whose order brought the parts in.",
    )
    change = serializers.SerializerMethodField()
    stock_item = StockLineSummarySerializer(read_only=True)

    class Meta:
        model = StockMovement
        fields = [
            "id", "stock_item", "movement_type", "quantity", "change", "moved_by", "moved_at", "handed_to", "task",
            "purchase_request_id", "notes", "created_at",
        ]
        read_only_fields = fields

    @extend_schema_field(serializers.IntegerField(help_text="What it added to the stock (negative for an exit)."))
    def get_change(self, movement):
        return -movement.quantity if movement.movement_type == "out" else movement.quantity


class StockItemDetailSerializer(StockItemSerializer):
    """A stock line with its latest movements (the view sets them as `recent_movements`)."""

    movements = serializers.SerializerMethodField()

    class Meta(StockItemSerializer.Meta):
        fields = StockItemSerializer.Meta.fields + ["movements"]
        read_only_fields = fields

    @extend_schema_field(StockMovementSerializer(many=True))
    def get_movements(self, item):
        return StockMovementSerializer(item.recent_movements, many=True, context=self.context).data


class StockItemCreateSerializer(serializers.ModelSerializer):
    """A new stock line (managers): a known part or a new one, its place, its threshold, and the
    quantity already there (recorded as an entry)."""

    part_id = serializers.PrimaryKeyRelatedField(source="part", queryset=Part.objects.all(), required=False)
    new_part = NewPartSerializer(required=False, write_only=True, help_text="A part not known yet (instead of part_id).")
    initial_quantity = serializers.IntegerField(min_value=0, default=0, write_only=True)
    notes = serializers.CharField(max_length=1000, required=False, allow_blank=True, write_only=True)

    class Meta:
        model = StockItem
        fields = ["part_id", "new_part", "location", "min_threshold", "initial_quantity", "notes"]
        extra_kwargs = {"min_threshold": {"min_value": 0}}
        # One line per part and place: checked in validate(), on the place written the usual way
        # (DRF's own check would require part_id, even with a new part).
        validators = []

    def validate(self, attrs):
        if ("part" in attrs) == ("new_part" in attrs):
            raise serializers.ValidationError({"part_id": _("Choose a known part or describe a new one (one of the two).")})
        attrs["location"] = " ".join(attrs.get("location", "").split())
        part = attrs.get("part")
        if part is not None and StockItem.objects.filter(part=part, location=attrs["location"]).exists():
            raise serializers.ValidationError({"location": _("This part already has a stock line at this place.")})
        return attrs


class StockItemChangeSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockItem
        fields = ["location", "min_threshold"]
        extra_kwargs = {"min_threshold": {"min_value": 0}}
        validators = []  # one line per part and place: checked in validate_location()

    def validate_location(self, location):
        location = " ".join(location.split())
        others = StockItem.objects.filter(part=self.instance.part, location=location).exclude(pk=self.instance.pk)
        if others.exists():
            raise serializers.ValidationError(_("This part already has a stock line at this place."))
        return location


class MovementInputSerializer(serializers.Serializer):
    """Common to the exits, entries and counts: when it happened (default now) and why."""

    moved_at = serializers.DateTimeField(required=False, help_text="When the parts moved (default: now).")
    notes = serializers.CharField(max_length=1000, required=False, allow_blank=True)

    def validate_moved_at(self, moment):
        if moment > timezone.now():
            raise serializers.ValidationError(_("A movement cannot be in the future."))
        return moment


class StockTakeSerializer(MovementInputSerializer):
    """An exit, recorded by a stock manager: how many, for which task, handed to whom (both optional)."""

    quantity = serializers.IntegerField(min_value=1)
    task_id = serializers.PrimaryKeyRelatedField(source="task", queryset=Task.objects.all(), required=False, allow_null=True)
    handed_to_id = serializers.PrimaryKeyRelatedField(
        source="handed_to", queryset=Member.objects.filter(is_active=True), required=False, allow_null=True
    )


class StockAddSerializer(MovementInputSerializer):
    """A manual entry (a sponsor's gift, a part recovered…): how many and why (required)."""

    quantity = serializers.IntegerField(min_value=1)
    notes = serializers.CharField(max_length=1000, help_text="Where the parts come from.")


class StockCountSerializer(MovementInputSerializer):
    """An inventory count: how many are really there, and why it differs (required)."""

    counted = serializers.IntegerField(min_value=0, help_text="How many were counted.")
    notes = serializers.CharField(max_length=1000, help_text="Why the count differs.")


class StockSummarySerializer(serializers.Serializer):
    lines = serializers.IntegerField(help_text="Stock lines.")
    low = serializers.IntegerField(help_text="Lines at their threshold or below.")
    can_manage = serializers.BooleanField(help_text="The viewer manages the stock.")
