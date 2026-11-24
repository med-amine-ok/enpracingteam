from decimal import Decimal

from django.utils import timezone
from django.utils.translation import gettext as _
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.members.models import Member, OrgUnit
from apps.members.serializers import MemberSummarySerializer, OrgUnitSummarySerializer
from apps.projects.serializers import ProjectSummarySerializer
from apps.subsystems.models import Subsystem
from apps.tasks.serializers import SubsystemSummarySerializer

from .access import purchasing_access_for
from .models import (
    Currency, OrderBatch, Part, PurchaseOrder, PurchaseRequest, PurchaseRequestEvent, PurchaseStatus, ShippingAddress,
    Supplier,
)

# Seen only by Operations, club admins and unit leaders (access.py): people outside the club.
SUPPLIER_CONTACT_FIELDS = ("address", "contact_name", "contact_role", "email", "phone")


# --- Suppliers, parts, shipping addresses ---


class SupplierSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = ["id", "name", "type"]
        read_only_fields = fields


class SupplierSerializer(serializers.ModelSerializer):
    """A supplier. Its contact people and street address are null for those not allowed to see them."""

    contacted_by = MemberSummarySerializer(read_only=True, allow_null=True)
    can_edit = serializers.SerializerMethodField()

    class Meta:
        model = Supplier
        fields = [
            "id", "name", "type", "status", "technical_capabilities", "city", "country", *SUPPLIER_CONTACT_FIELDS,
            "contacted_by", "average_lead_time_days", "comments", "can_edit", "created_at", "updated_at",
        ]
        read_only_fields = fields  # output only: every field is always present
        extra_kwargs = {field: {"allow_null": True} for field in SUPPLIER_CONTACT_FIELDS}

    @extend_schema_field(serializers.BooleanField(help_text="The viewer may change this supplier (Operations)."))
    def get_can_edit(self, supplier):
        return purchasing_access_for(self.context["request"]).can_manage()

    def to_representation(self, supplier):
        data = super().to_representation(supplier)
        if not purchasing_access_for(self.context["request"]).can_see_supplier_contacts():
            for field in SUPPLIER_CONTACT_FIELDS:
                data[field] = None
        return data


class SupplierWriteSerializer(serializers.ModelSerializer):
    """Add or change a supplier (Operations). The answer is the supplier as SupplierSerializer shows it."""

    contacted_by_id = serializers.PrimaryKeyRelatedField(
        source="contacted_by", queryset=Member.objects.filter(is_active=True), allow_null=True, required=False
    )

    class Meta:
        model = Supplier
        fields = [
            "name", "type", "status", "technical_capabilities", "city", "country", *SUPPLIER_CONTACT_FIELDS,
            "contacted_by_id", "average_lead_time_days", "comments",
        ]
        extra_kwargs = {"technical_capabilities": {"max_length": 5000}, "comments": {"max_length": 5000}}

    def validate_name(self, name):
        name = " ".join(name.split())
        others = Supplier.objects.filter(name__iexact=name)
        if self.instance is not None:
            others = others.exclude(pk=self.instance.pk)
        if others.exists():
            raise serializers.ValidationError(_("A supplier with this name already exists."))
        return name


class PartSerializer(serializers.ModelSerializer):
    class Meta:
        model = Part
        fields = ["id", "name", "category", "reference", "description", "material", "process"]
        read_only_fields = fields


class NewPartSerializer(serializers.ModelSerializer):
    class Meta:
        model = Part
        fields = ["name", "category", "reference", "description", "material", "process"]
        extra_kwargs = {"description": {"max_length": 5000}}


class ShippingAddressSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShippingAddress
        fields = ["id", "country", "address"]
        read_only_fields = fields


# --- Purchase requests and their orders ---


class PurchaseOrderSerializer(serializers.ModelSerializer):
    """An order. Amounts in its currency; `total_price_dzd` = the total in dinars, for the budgets.
    `batch`: the grouped order it belongs to (null: ordered alone); `quantity_received`: the parts
    arrived so far."""

    supplier = SupplierSummarySerializer(read_only=True)
    shipping_address = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseOrder
        fields = [
            "id", "status", "supplier", "currency", "exchange_rate", "unit_price", "delivery_cost", "customs_cost",
            "total_price", "total_price_dzd", "ordered_at", "estimated_delivery_date", "actual_delivery_date",
            "shipping_address", "batch", "quantity_received",
        ]
        read_only_fields = fields

    @extend_schema_field(ShippingAddressSerializer(allow_null=True))
    def get_shipping_address(self, order):
        if order.shipping_address is None:
            return None
        if not purchasing_access_for(self.context["request"]).can_see_shipping_addresses():
            return None
        return ShippingAddressSerializer(order.shipping_address).data


class PurchasePermissionsSerializer(serializers.Serializer):
    edit = serializers.BooleanField(help_text="May change the request (only while it awaits its leader).")
    approve = serializers.BooleanField(help_text="May approve or refuse the step the request awaits.")
    cancel = serializers.BooleanField()
    order = serializers.BooleanField(help_text="May place the order.")
    manage_order = serializers.BooleanField(help_text="May change the order and receive parts.")
    cancel_order = serializers.BooleanField(help_text="May cancel the order (none of its parts arrived yet).")
    close_order = serializers.BooleanField(help_text="May close the order with the parts that arrived.")


class PurchaseRequestSerializer(serializers.ModelSerializer):
    """A purchase request as listed, with its current order (if any) and what the viewer may do."""

    part = PartSerializer(read_only=True)
    requested_by = MemberSummarySerializer(read_only=True)
    org_unit = OrgUnitSummarySerializer(read_only=True, allow_null=True)
    subsystem = SubsystemSummarySerializer(read_only=True, allow_null=True)
    project = ProjectSummarySerializer(source="subsystem.project", read_only=True, allow_null=True)
    suggested_supplier = SupplierSummarySerializer(read_only=True, allow_null=True)
    order = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseRequest
        fields = [
            "id", "part", "quantity", "priority", "requested_date", "status", "requested_by", "org_unit", "subsystem",
            "project", "suggested_supplier", "order", "created_at", "permissions",
        ]
        read_only_fields = fields

    @extend_schema_field(PurchaseOrderSerializer(allow_null=True))
    def get_order(self, purchase):
        # The orders are prefetched by the view; a cancelled one only shows in the history.
        current = next((order for order in purchase.orders.all() if order.status != PurchaseStatus.ANNULE), None)
        return None if current is None else PurchaseOrderSerializer(current, context=self.context).data

    @extend_schema_field(PurchasePermissionsSerializer)
    def get_permissions(self, purchase):
        access = purchasing_access_for(self.context["request"])
        return {
            "edit": access.can_edit(purchase),
            "approve": access.can_approve(purchase),
            "cancel": access.can_cancel(purchase),
            "order": access.can_order(purchase),
            "manage_order": access.can_manage_order(purchase),
            "cancel_order": access.can_cancel_order(purchase),
            "close_order": access.can_close_order(purchase),
        }


class PurchaseRequestEventSerializer(serializers.ModelSerializer):
    actor = MemberSummarySerializer(read_only=True, allow_null=True)

    class Meta:
        model = PurchaseRequestEvent
        fields = ["id", "action", "status", "actor", "comment", "quantity", "created_at"]
        read_only_fields = fields


class BatchRequestSerializer(serializers.ModelSerializer):
    """A request of a grouped order: its part, how many, where it stands and how many arrived."""

    part = serializers.CharField(source="part.name", read_only=True)
    quantity_received = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseRequest
        fields = ["id", "part", "quantity", "status", "quantity_received"]
        read_only_fields = fields

    def get_quantity_received(self, purchase) -> int:
        return purchase.batch_line.quantity_received


class OrderBatchSerializer(serializers.ModelSerializer):
    """Requests ordered together from one supplier (decision D-023)."""

    supplier = SupplierSummarySerializer(read_only=True)
    created_by = MemberSummarySerializer(read_only=True, allow_null=True)
    requests = serializers.SerializerMethodField()
    can_receive = serializers.SerializerMethodField()

    class Meta:
        model = OrderBatch
        fields = ["id", "supplier", "created_by", "created_at", "requests", "can_receive"]
        read_only_fields = fields

    def lines(self, batch):
        return [line for line in batch.orders.all() if line.status != PurchaseStatus.ANNULE]

    @extend_schema_field(BatchRequestSerializer(many=True))
    def get_requests(self, batch):
        requests = []
        for line in self.lines(batch):
            purchase = line.purchase_request
            purchase.batch_line = line
            requests.append(purchase)
        return BatchRequestSerializer(requests, many=True, context=self.context).data

    @extend_schema_field(serializers.BooleanField(help_text="May receive every part still to come at once."))
    def get_can_receive(self, batch):
        waiting = any(line.status == PurchaseStatus.EN_COMMANDE for line in self.lines(batch))
        return waiting and purchasing_access_for(self.context["request"]).can_manage()


def batch_with_lines():
    """The grouped orders, with their lines, requests and parts read at once."""
    return OrderBatch.objects.select_related("supplier", "created_by").prefetch_related(
        "orders__purchase_request__part"
    )


class PurchaseRequestDetailSerializer(PurchaseRequestSerializer):
    events = PurchaseRequestEventSerializer(many=True, read_only=True)
    grouped_order = serializers.SerializerMethodField()

    class Meta(PurchaseRequestSerializer.Meta):
        fields = PurchaseRequestSerializer.Meta.fields + ["notes", "updated_at", "events", "grouped_order"]
        read_only_fields = fields

    @extend_schema_field(OrderBatchSerializer(allow_null=True))
    def get_grouped_order(self, purchase):
        current = next((order for order in purchase.orders.all() if order.status != PurchaseStatus.ANNULE), None)
        if current is None or current.batch_id is None:
            return None
        return OrderBatchSerializer(batch_with_lines().get(pk=current.batch_id), context=self.context).data


class PurchaseRequestWriteSerializer(serializers.ModelSerializer):
    """Ask for a part — one already known (`part_id`) or a new one (`new_part`) — or change the
    request while it awaits its leader. The answer is the request as the detail shows it."""

    part_id = serializers.PrimaryKeyRelatedField(source="part", queryset=Part.objects.all(), required=False)
    new_part = NewPartSerializer(required=False, write_only=True, help_text="A part not known yet (instead of part_id).")
    org_unit_id = serializers.PrimaryKeyRelatedField(
        source="org_unit", queryset=OrgUnit.objects.filter(is_active=True), allow_null=True, required=False,
        help_text="The unit the part is for; with a subsystem, its unit is taken.",
    )
    subsystem_id = serializers.PrimaryKeyRelatedField(
        source="subsystem", queryset=Subsystem.objects.select_related("project", "org_unit"), allow_null=True,
        required=False,
    )
    suggested_supplier_id = serializers.PrimaryKeyRelatedField(
        source="suggested_supplier", queryset=Supplier.objects.all(), allow_null=True, required=False
    )

    class Meta:
        model = PurchaseRequest
        fields = [
            "part_id", "new_part", "quantity", "priority", "requested_date", "notes", "org_unit_id", "subsystem_id",
            "suggested_supplier_id",
        ]
        extra_kwargs = {"quantity": {"min_value": 1}, "notes": {"max_length": 5000}}

    def validate(self, attrs):
        purchase = self.instance
        both = "part" in attrs and "new_part" in attrs
        neither = purchase is None and "part" not in attrs and "new_part" not in attrs
        if both or neither:
            raise serializers.ValidationError({"part_id": _("Choose a known part or describe a new one (one of the two).")})
        subsystem = attrs["subsystem"] if "subsystem" in attrs else getattr(purchase, "subsystem", None)
        if subsystem is not None:
            attrs["org_unit"] = subsystem.org_unit
        elif (attrs["org_unit"] if "org_unit" in attrs else getattr(purchase, "org_unit", None)) is None:
            raise serializers.ValidationError({"org_unit_id": _("Choose the unit the part is for, or its subsystem.")})
        return attrs

    def _with_new_part(self, validated_data):
        new_part = validated_data.pop("new_part", None)
        if new_part is not None:
            subsystem = validated_data.get("subsystem", getattr(self.instance, "subsystem", None))
            unit = validated_data.get("org_unit", getattr(self.instance, "org_unit", None))
            validated_data["part"] = Part.objects.create(**new_part, subsystem=subsystem, org_unit=unit)
        return validated_data

    def create(self, validated_data):
        return PurchaseRequest.objects.create(
            **self._with_new_part(validated_data),
            requested_by=self.context["request"].user,
            status=PurchaseStatus.A_VALIDER_CHEF,
        )

    def update(self, instance, validated_data):
        return super().update(instance, self._with_new_part(validated_data))


class PurchaseOrderWriteSerializer(serializers.ModelSerializer):
    """Place the order of a request "to order", or change it while it is ordered. Every amount is in
    the order's currency; `exchange_rate` = dinars paid for one unit of it (always 1 for dinars)."""

    supplier_id = serializers.PrimaryKeyRelatedField(source="supplier", queryset=Supplier.objects.all())
    shipping_address_id = serializers.PrimaryKeyRelatedField(
        source="shipping_address", queryset=ShippingAddress.objects.all(), allow_null=True, required=False
    )

    class Meta:
        model = PurchaseOrder
        fields = [
            "supplier_id", "unit_price", "currency", "exchange_rate", "delivery_cost", "customs_cost", "ordered_at",
            "estimated_delivery_date", "shipping_address_id",
        ]
        extra_kwargs = {
            "unit_price": {"required": True, "allow_null": False, "min_value": Decimal("0")},
            "delivery_cost": {"min_value": Decimal("0")},
            "customs_cost": {"min_value": Decimal("0")},
            "exchange_rate": {"min_value": Decimal("0.0001")},
            "ordered_at": {"help_text": "Default: today."},
        }

    def validate(self, attrs):
        order = self.instance
        currency = attrs.get("currency", order.currency if order else Currency.DZD)
        if currency == Currency.DZD:
            attrs["exchange_rate"] = Decimal(1)
        elif "exchange_rate" not in attrs and (order is None or order.currency != currency):
            raise serializers.ValidationError(
                {"exchange_rate": _("Give the rate actually paid: how many dinars for one %(currency)s.")
                 % {"currency": currency}}
            )
        if order is None and attrs.get("ordered_at") is None:
            attrs["ordered_at"] = timezone.localdate()
        ordered = attrs.get("ordered_at", order.ordered_at if order else None)
        expected = attrs.get("estimated_delivery_date", order.estimated_delivery_date if order else None)
        if ordered is not None and expected is not None and expected < ordered:
            raise serializers.ValidationError(
                {"estimated_delivery_date": _("The delivery cannot be expected before the order date.")}
            )
        # Parts already received (a partial delivery): the order date cannot move after it (ck_po_actual_date,
        # a 500 otherwise). In a grouped order the date is copied to every line, so the earliest one counts.
        if order is not None and "ordered_at" in attrs and ordered is not None:
            received = [order.actual_delivery_date]
            if order.batch_id is not None:
                received += list(
                    type(order).objects.filter(batch_id=order.batch_id, status=order.status)
                    .exclude(actual_delivery_date=None).values_list("actual_delivery_date", flat=True)
                )
            received = [day for day in received if day is not None]
            if received and ordered > min(received):
                raise serializers.ValidationError(
                    {"ordered_at": _("Parts of this order arrived on %(day)s: it was ordered before.")
                     % {"day": min(received).isoformat()}}
                )
        return attrs


class OrderBatchLineSerializer(serializers.Serializer):
    request_id = serializers.PrimaryKeyRelatedField(source="purchase_request", queryset=PurchaseRequest.objects.all())
    unit_price = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))


class OrderBatchWriteSerializer(PurchaseOrderWriteSerializer):
    """Order several requests "to order" together from one supplier: what they share (supplier, currency
    and rate, dates, shipping address, and the delivery and customs costs paid once, shared out
    between them in proportion to their price), and each one's unit price."""

    lines = OrderBatchLineSerializer(many=True, min_length=2, max_length=50)

    class Meta(PurchaseOrderWriteSerializer.Meta):
        fields = [field for field in PurchaseOrderWriteSerializer.Meta.fields if field != "unit_price"] + ["lines"]
        extra_kwargs = {
            key: value for key, value in PurchaseOrderWriteSerializer.Meta.extra_kwargs.items() if key != "unit_price"
        }

    def validate_lines(self, lines):
        ids = [line["purchase_request"].pk for line in lines]
        if len(set(ids)) != len(ids):
            raise serializers.ValidationError(_("A request appears twice in the grouped order."))
        return lines


class ApprovalSerializer(serializers.Serializer):
    comment = serializers.CharField(max_length=1000, required=False, allow_blank=True)


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=1000, help_text="Why: kept in the history, shown to the requester.")


class BatchReceptionSerializer(serializers.Serializer):
    """Every part still to come of a grouped order arrived."""

    actual_delivery_date = serializers.DateField(required=False, help_text="Default: today.")
    location = serializers.CharField(
        max_length=255, required=False, allow_blank=True,
        help_text="Where the parts are stored: the stock line of this place (created if needed), "
                  "else the part's first line.",
    )

    def validate_actual_delivery_date(self, day):
        if day > timezone.localdate():
            raise serializers.ValidationError(_("A delivery cannot be in the future."))
        return day


class ReceptionSerializer(BatchReceptionSerializer):
    quantity = serializers.IntegerField(
        min_value=1, required=False, help_text="How many parts arrived. Default: all those still to come."
    )


class StatusCountsSerializer(serializers.Serializer):
    a_valider_chef = serializers.IntegerField()
    a_valider_operations = serializers.IntegerField()
    a_commander = serializers.IntegerField()
    en_commande = serializers.IntegerField()
    livre = serializers.IntegerField()
    annule = serializers.IntegerField()


class PurchaseSummarySerializer(serializers.Serializer):
    by_status = StatusCountsSerializer()
    to_approve = serializers.IntegerField(help_text="Requests awaiting the viewer's approval.")
    mine = serializers.IntegerField(help_text="The viewer's requests not delivered or cancelled yet.")
    can_manage = serializers.BooleanField(help_text="The viewer orders and receives (Operations or club admin).")
