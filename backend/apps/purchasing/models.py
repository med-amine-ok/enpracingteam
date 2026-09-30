from django.db import models
from django.db.models import F, Q


class PurchaseStatus(models.TextChoices):
    A_COMMANDER = "a_commander", "To order"
    EN_COMMANDE = "en_commande", "Ordered"
    LIVRE = "livre", "Delivered"
    ANNULE = "annule", "Cancelled"


class SupplierType(models.TextChoices):
    FOURNISSEUR = "fournisseur", "Supplier"
    SOUS_TRAITANT = "sous_traitant", "Subcontractor"
    MIXTE = "mixte", "Mixed"
    USINAGE = "usinage", "Machining"
    LOGISTIQUE = "logistique", "Logistics"


class SupplierStatus(models.TextChoices):
    VALIDEE = "validee", "Approved"
    EN_ATTENTE = "en_attente", "Pending"
    REFUSEE = "refusee", "Refused"
    PAS_ENCORE_ENVOYEE = "pas_encore_envoyee", "Not sent yet"


class PartCategory(models.TextChoices):
    BRAKES = "brakes", "Brakes"
    WHEELS_TYRES = "wheels_tyres", "Wheels & tyres"
    CHASSIS_BODY = "chassis_body", "Chassis & body"
    SUSPENSION = "suspension", "Suspension"
    STEERING = "steering", "Steering"
    DRIVETRAIN = "drivetrain", "Drivetrain"
    ENGINE_TRACTIVE = "engine_tractive", "Engine / tractive"
    WORKSHOP = "workshop", "Workshop"
    LOW_VOLTAGE = "low_voltage", "Low voltage"
    OPERATIONS = "operations", "Operations"
    OTHER = "other", "Other"


class PurchasePriority(models.TextChoices):
    """Duplicated from apps.tasks on purpose, to keep the apps independent."""
    LOW = "low", "Low"
    MEDIUM = "medium", "Medium"
    HIGH = "high", "High"


class Supplier(models.Model):
    name = models.CharField(max_length=255)
    type = models.CharField(max_length=20, choices=SupplierType.choices, null=True, blank=True)
    status = models.CharField(max_length=20, choices=SupplierStatus.choices, default=SupplierStatus.PAS_ENCORE_ENVOYEE)
    technical_capabilities = models.TextField(blank=True)
    address = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=150, blank=True)
    country = models.CharField(max_length=150, blank=True)
    contact_name = models.CharField(max_length=150, blank=True)
    contact_role = models.CharField(max_length=150, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    contacted_by = models.ForeignKey(
        "members.Member", null=True, blank=True,
        on_delete=models.PROTECT, related_name="suppliers_contacted",
    )
    average_lead_time_days = models.IntegerField(
        null=True, blank=True,
        validators=[__import__("django.core.validators", fromlist=["MinValueValidator"]).MinValueValidator(0)],
    )
    comments = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["name"], name="idx_supplier_name"),
            models.Index(fields=["status"], name="idx_supplier_status"),
            models.Index(fields=["type"], name="idx_supplier_type"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(average_lead_time_days__isnull=True) | Q(average_lead_time_days__gte=0),
                name="ck_supplier_lead_time",
            ),
        ]

    def __str__(self):
        return self.name


class Part(models.Model):
    category = models.CharField(max_length=20, choices=PartCategory.choices, default=PartCategory.OTHER)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    reference = models.CharField(max_length=150, blank=True)
    quantity = models.IntegerField(null=True, blank=True)
    material = models.CharField(max_length=150, blank=True)
    # e.g. Usinage, Impression 3D, Decoupe laser
    process = models.CharField(max_length=150, blank=True)
    subsystem = models.ForeignKey(
        "subsystems.Subsystem", null=True, blank=True,
        on_delete=models.PROTECT, related_name="parts",
    )
    org_unit = models.ForeignKey(
        "members.OrgUnit", null=True, blank=True,
        on_delete=models.PROTECT, related_name="parts",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["category"], name="idx_part_category"),
            models.Index(fields=["reference"], name="idx_part_reference"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(quantity__isnull=True) | Q(quantity__gte=0), name="ck_part_quantity"
            ),
        ]

    def __str__(self):
        return self.name


class PurchaseRequest(models.Model):
    part = models.ForeignKey(Part, on_delete=models.PROTECT, related_name="purchase_requests")
    requested_by = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="purchase_requests"
    )
    quantity = models.PositiveIntegerField()
    priority = models.CharField(max_length=10, choices=PurchasePriority.choices, null=True, blank=True)
    requested_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=PurchaseStatus.choices, default=PurchaseStatus.A_COMMANDER)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["status"], name="idx_purchase_request_status"),
        ]
        constraints = [
            models.CheckConstraint(condition=Q(quantity__gt=0), name="ck_purchase_request_quantity"),
        ]

    def __str__(self):
        return f"{self.quantity}x {self.part.name}"


class ShippingAddress(models.Model):
    country = models.CharField(max_length=150, blank=True)
    address = models.TextField()
    contacted_by = models.ForeignKey(
        "members.Member", null=True, blank=True,
        on_delete=models.PROTECT, related_name="shipping_addresses",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.address[:50]


class PurchaseOrder(models.Model):
    purchase_request = models.ForeignKey(
        PurchaseRequest, on_delete=models.PROTECT, related_name="orders"
    )
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="orders")
    shipping_address = models.ForeignKey(
        ShippingAddress, null=True, blank=True, on_delete=models.PROTECT, related_name="orders"
    )
    unit_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    delivery_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    customs_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    # Computed in Django (unit_price * quantity + delivery + customs).
    total_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    ordered_at = models.DateField(null=True, blank=True)
    estimated_delivery_date = models.DateField(null=True, blank=True)
    actual_delivery_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=PurchaseStatus.choices, default=PurchaseStatus.EN_COMMANDE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["status"], name="idx_purchase_order_status"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(unit_price__isnull=True) | Q(unit_price__gte=0), name="ck_po_unit_price"
            ),
            models.CheckConstraint(condition=Q(delivery_cost__gte=0), name="ck_po_delivery_cost"),
            models.CheckConstraint(condition=Q(customs_cost__gte=0), name="ck_po_customs_cost"),
            models.CheckConstraint(
                condition=Q(total_price__isnull=True) | Q(total_price__gte=0), name="ck_po_total_price"
            ),
            models.CheckConstraint(
                condition=(
                    Q(estimated_delivery_date__isnull=True) | Q(ordered_at__isnull=True)
                    | Q(estimated_delivery_date__gte=F("ordered_at"))
                ),
                name="ck_po_estimated_date",
            ),
            models.CheckConstraint(
                condition=(
                    Q(actual_delivery_date__isnull=True) | Q(ordered_at__isnull=True)
                    | Q(actual_delivery_date__gte=F("ordered_at"))
                ),
                name="ck_po_actual_date",
            ),
        ]

    def __str__(self):
        return f"PO #{self.pk} - {self.supplier.name}"

    def save(self, *args, **kwargs):
        if self.unit_price is not None:
            qty = self.purchase_request.quantity if self.purchase_request_id else 0
            self.total_price = (self.unit_price * qty) + self.delivery_cost + self.customs_cost
        super().save(*args, **kwargs)


class Invoice(models.Model):
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="invoices")
    reference = models.CharField(max_length=150)
    total_amount = models.DecimalField(max_digits=12, decimal_places=2)
    issued_at = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["issued_at"], name="idx_invoice_issued_at")]
        constraints = [
            models.UniqueConstraint(fields=["supplier", "reference"], name="uq_invoice_supplier_reference"),
            models.CheckConstraint(condition=Q(total_amount__gte=0), name="ck_invoice_total_amount"),
        ]

    def __str__(self):
        return f"{self.supplier.name} / {self.reference}"


class InvoiceLineItem(models.Model):
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="line_items")
    description = models.TextField()
    quantity = models.DecimalField(max_digits=12, decimal_places=3)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    total_price = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(quantity__gt=0), name="ck_invoice_line_quantity"),
            models.CheckConstraint(condition=Q(unit_price__gte=0), name="ck_invoice_line_unit_price"),
            models.CheckConstraint(condition=Q(total_price__gte=0), name="ck_invoice_line_total_price"),
        ]

    def __str__(self):
        return self.description[:50]