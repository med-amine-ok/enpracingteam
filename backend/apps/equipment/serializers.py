from django.utils import timezone
from django.utils.translation import gettext as _
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.members.models import Member
from apps.members.serializers import MemberSummarySerializer

from .access import equipment_access_for
from .models import (
    UNAVAILABLE_STATUSES, Equipment, EquipmentCertification, EquipmentLoan, EquipmentMaintenance,
    EquipmentReservation, EquipmentStatus, LoanStatus, ReturnCondition,
)
from .workflow import ACTIVE_RESERVATIONS

# The statuses a manager sets by hand ("borrowed" comes with the loans).
SETTABLE_STATUSES = [(value, label) for value, label in EquipmentStatus.choices if value != EquipmentStatus.BORROWED]


def access_of(serializer):
    return equipment_access_for(serializer.context["request"])


class EquipmentRefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Equipment
        fields = ["id", "name"]


class EquipmentSerializer(serializers.ModelSerializer):
    """An item as listed."""

    certified = serializers.SerializerMethodField(help_text="The viewer is certified on it.")

    class Meta:
        model = Equipment
        fields = ["id", "name", "category", "status", "location", "requires_certification", "loanable", "certified"]
        read_only_fields = fields

    def get_certified(self, equipment) -> bool:
        return access_of(self).is_certified(equipment)


class ReservationPermissionsSerializer(serializers.Serializer):
    cancel = serializers.BooleanField()


class ReservationSerializer(serializers.ModelSerializer):
    equipment = EquipmentRefSerializer(read_only=True)
    reserved_by = MemberSummarySerializer(read_only=True)
    cancelled_by = MemberSummarySerializer(read_only=True, allow_null=True)
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = EquipmentReservation
        fields = [
            "id", "equipment", "reserved_by", "reserved_from", "reserved_to", "purpose", "status", "cancelled_by",
            "cancelled_at", "permissions",
        ]
        read_only_fields = fields

    @extend_schema_field(ReservationPermissionsSerializer)
    def get_permissions(self, reservation):
        active = reservation.status in ACTIVE_RESERVATIONS and reservation.reserved_to > timezone.now()
        return {"cancel": active and access_of(self).can_cancel_reservation(reservation)}


class CertificationSerializer(serializers.ModelSerializer):
    member = MemberSummarySerializer(read_only=True)
    granted_by = MemberSummarySerializer(read_only=True, allow_null=True)

    class Meta:
        model = EquipmentCertification
        fields = ["id", "member", "granted_by", "granted_at", "note"]
        read_only_fields = fields


class MaintenanceSerializer(serializers.ModelSerializer):
    performed_by = MemberSummarySerializer(read_only=True)
    cost = serializers.SerializerMethodField(help_text="Shown to the equipment managers only.")

    class Meta:
        model = EquipmentMaintenance
        fields = ["id", "performed_by", "performed_at", "description", "cost"]
        read_only_fields = fields

    @extend_schema_field(serializers.DecimalField(max_digits=12, decimal_places=2, allow_null=True))
    def get_cost(self, maintenance):
        if maintenance.cost is None or not access_of(self).can_manage():
            return None
        return str(maintenance.cost)


class LoanPermissionsSerializer(serializers.Serializer):
    decide = serializers.BooleanField(help_text="May hand it out or refuse it (a manager, while asked).")
    receive = serializers.BooleanField(help_text="May record its return (a manager, while out).")
    cancel = serializers.BooleanField(help_text="May withdraw the request (its borrower, while asked).")


class LoanSerializer(serializers.ModelSerializer):
    equipment = EquipmentRefSerializer(read_only=True)
    borrower = MemberSummarySerializer(read_only=True)
    decided_by = MemberSummarySerializer(read_only=True, allow_null=True)
    received_by = MemberSummarySerializer(read_only=True, allow_null=True)
    overdue = serializers.BooleanField(source="is_overdue", read_only=True)
    # Empty until it is returned.
    return_condition = serializers.ChoiceField(choices=ReturnCondition.choices, allow_blank=True, read_only=True)
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = EquipmentLoan
        fields = [
            "id", "equipment", "borrower", "reason", "due_date", "status", "overdue", "requested_at", "decided_by",
            "decided_at", "decision_note", "returned_at", "received_by", "return_condition", "return_note",
            "permissions",
        ]
        read_only_fields = fields

    @extend_schema_field(LoanPermissionsSerializer)
    def get_permissions(self, loan):
        access = access_of(self)
        return {
            "decide": loan.status == LoanStatus.REQUESTED and access.can_manage(),
            "receive": loan.status == LoanStatus.OUT and access.can_manage(),
            "cancel": loan.status == LoanStatus.REQUESTED and access.is_viewer(loan.borrower_id),
        }


class EquipmentPermissionsSerializer(serializers.Serializer):
    manage = serializers.BooleanField(help_text="May change it, its status, record its maintenance and its loans.")
    certify = serializers.BooleanField(help_text="May certify the members on it (the workshop lead, the admins).")
    reserve = serializers.BooleanField(help_text="May reserve a slot now (usable, certified when needed).")
    borrow = serializers.BooleanField(help_text="May ask to borrow it now.")


class EquipmentDetailSerializer(EquipmentSerializer):
    reservations = serializers.SerializerMethodField(help_text="Its coming slots.")
    certifications = serializers.SerializerMethodField(help_text="The members certified on it.")
    maintenance = MaintenanceSerializer(source="maintenance_logs", many=True, read_only=True)
    loans = serializers.SerializerMethodField(help_text="Its loans: all for a manager, the viewer's own otherwise.")
    lent_to = serializers.SerializerMethodField()
    lent_until = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta(EquipmentSerializer.Meta):
        fields = [
            *EquipmentSerializer.Meta.fields, "description", "purchased_at", "last_maintenance_at", "lent_to",
            "lent_until", "reservations", "certifications", "maintenance", "loans", "permissions",
        ]
        read_only_fields = fields

    def out_loan(self, equipment):
        return next((loan for loan in equipment.loans.all() if loan.status == LoanStatus.OUT), None)

    @extend_schema_field(ReservationSerializer(many=True))
    def get_reservations(self, equipment):
        now = timezone.now()
        coming = [r for r in equipment.reservations.all() if r.status in ACTIVE_RESERVATIONS and r.reserved_to > now]
        return ReservationSerializer(coming, many=True, context=self.context).data

    @extend_schema_field(CertificationSerializer(many=True))
    def get_certifications(self, equipment):
        active = [c for c in equipment.certifications.all() if c.revoked_at is None]
        return CertificationSerializer(active, many=True, context=self.context).data

    @extend_schema_field(LoanSerializer(many=True))
    def get_loans(self, equipment):
        access = access_of(self)
        loans = [loan for loan in equipment.loans.all() if access.sees_loan(loan)]
        return LoanSerializer(loans, many=True, context=self.context).data

    @extend_schema_field(MemberSummarySerializer(allow_null=True))
    def get_lent_to(self, equipment):
        loan = self.out_loan(equipment)
        return MemberSummarySerializer(loan.borrower).data if loan else None

    @extend_schema_field(serializers.DateField(allow_null=True))
    def get_lent_until(self, equipment):
        loan = self.out_loan(equipment)
        return loan.due_date.isoformat() if loan else None

    @extend_schema_field(EquipmentPermissionsSerializer)
    def get_permissions(self, equipment):
        access = access_of(self)
        usable = equipment.status not in UNAVAILABLE_STATUSES and access.may_use(equipment)
        open_loan = any(
            loan.status in (LoanStatus.REQUESTED, LoanStatus.OUT) and access.is_viewer(loan.borrower_id)
            for loan in equipment.loans.all()
        )
        return {
            "manage": access.can_manage(),
            "certify": access.can_certify(),
            "reserve": usable,
            "borrow": usable and equipment.loanable and not open_loan,
        }


class EquipmentWriteSerializer(serializers.ModelSerializer):
    status = serializers.ChoiceField(choices=SETTABLE_STATUSES, required=False)

    class Meta:
        model = Equipment
        fields = [
            "name", "category", "location", "description", "requires_certification", "loanable", "purchased_at",
            "status",
        ]


class RightsSerializer(serializers.Serializer):
    manage = serializers.BooleanField()
    certify = serializers.BooleanField()


class ReservationCreateSerializer(serializers.Serializer):
    reserved_from = serializers.DateTimeField()
    reserved_to = serializers.DateTimeField()
    purpose = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class ReservationCancelSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class CertificationCreateSerializer(serializers.Serializer):
    member_id = serializers.PrimaryKeyRelatedField(queryset=Member.objects.all())
    note = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class MaintenanceCreateSerializer(serializers.Serializer):
    performed_at = serializers.DateTimeField(required=False)
    description = serializers.CharField(allow_blank=False)
    cost = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0, required=False, allow_null=True)
    status = serializers.ChoiceField(choices=SETTABLE_STATUSES, required=False, allow_blank=True)


class LoanCreateSerializer(serializers.Serializer):
    reason = serializers.CharField()
    due_date = serializers.DateField()


class RefuseSerializer(serializers.Serializer):
    note = serializers.CharField(allow_blank=True)

    def validate_note(self, note):
        if not note.strip():
            raise serializers.ValidationError(_("Say why it is refused."))
        return note


class ReturnSerializer(serializers.Serializer):
    condition = serializers.ChoiceField(choices=ReturnCondition.choices)
    note = serializers.CharField(required=False, allow_blank=True, default="")

