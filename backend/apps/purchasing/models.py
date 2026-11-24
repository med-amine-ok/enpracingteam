from decimal import ROUND_HALF_UP, Decimal

from django.db import models
from django.db.models import F, Q
from django.utils.translation import gettext
from django.utils.translation import gettext_lazy as _
from django.utils.translation import pgettext_lazy

CENTIME = Decimal("0.01")


class PurchaseStatus(models.TextChoices):
    # Context: the French words come from the team's subcontracting sheets (À commander,
    # En commande, Livré, Annulé); "Cancelled" has other genders elsewhere (reservations).
    # The two approvals before ordering were decided with the user on 19/10/2026 (knowledge base:
    # PROJECTS/ERP/purchasing_design.md): the leader, then the head of Operations.
    A_VALIDER_CHEF = "a_valider_chef", pgettext_lazy("purchase status", "To approve (leader)")
    A_VALIDER_OPERATIONS = "a_valider_operations", pgettext_lazy("purchase status", "To approve (Operations)")
    A_COMMANDER = "a_commander", pgettext_lazy("purchase status", "To order")
    EN_COMMANDE = "en_commande", pgettext_lazy("purchase status", "Ordered")
    LIVRE = "livre", pgettext_lazy("purchase status", "Delivered")
    ANNULE = "annule", pgettext_lazy("purchase status", "Cancelled")


class SupplierType(models.TextChoices):
    FOURNISSEUR = "fournisseur", _("Supplier")
    SOUS_TRAITANT = "sous_traitant", _("Subcontractor")
    MIXTE = "mixte", _("Mixed")
    USINAGE = "usinage", _("Machining")
    LOGISTIQUE = "logistique", _("Logistics")


class SupplierStatus(models.TextChoices):
    # State of the request sent to the supplier (French: la demande, feminine).
    VALIDEE = "validee", pgettext_lazy("supplier status", "Approved")
    EN_ATTENTE = "en_attente", pgettext_lazy("supplier status", "Pending")
    REFUSEE = "refusee", pgettext_lazy("supplier status", "Refused")
    PAS_ENCORE_ENVOYEE = "pas_encore_envoyee", pgettext_lazy("supplier status", "Request not sent yet")


class PartCategory(models.TextChoices):
    BRAKES = "brakes", _("Brakes")
    WHEELS_TYRES = "wheels_tyres", _("Wheels & tyres")
    CHASSIS_BODY = "chassis_body", _("Chassis & body")
    SUSPENSION = "suspension", _("Suspension")
    STEERING = "steering", _("Steering")
    DRIVETRAIN = "drivetrain", _("Drivetrain")
    ENGINE_TRACTIVE = "engine_tractive", _("Engine / tractive")
    WORKSHOP = "workshop", _("Workshop")
    LOW_VOLTAGE = "low_voltage", _("Low voltage")
    OPERATIONS = "operations", _("Operations")
    OTHER = "other", _("Other")


class PurchasePriority(models.TextChoices):
    """Duplicated from apps.tasks on purpose, to keep the apps independent. The team's sheet says
    P1 / P2 / P3 (high / medium / low): the screens show both."""
    LOW = "low", _("Low")
    MEDIUM = "medium", _("Medium")
    HIGH = "high", _("High")


class PurchaseAction(models.TextChoices):
    """What happened to a purchase request: one line of its history."""

    REQUESTED = "requested", pgettext_lazy("purchase action", "Requested")
    APPROVED = "approved", pgettext_lazy("purchase action", "Approved")
    REFUSED = "refused", pgettext_lazy("purchase action", "Refused")
    ORDERED = "ordered", pgettext_lazy("purchase action", "Ordered")
    ORDER_CANCELLED = "order_cancelled", pgettext_lazy("purchase action", "Order cancelled")
    RECEIVED = "received", pgettext_lazy("purchase action", "Received")
    # A delivery of only some of the parts: the order stays in progress (decision D-023).
    PARTLY_RECEIVED = "partly_received", pgettext_lazy("purchase action", "Partly received")
    # The rest will not come: the order is closed with the parts that arrived, and only they are paid.
    CLOSED_SHORT = "closed_short", pgettext_lazy("purchase action", "Closed with what arrived")
    CANCELLED = "cancelled", pgettext_lazy("purchase action", "Cancelled")


class Currency(models.TextChoices):
    """Currency of an order (ISO 4217). Decided on 19/10/2026: each order has its currency and the
    rate actually paid; its total is also kept in dinars, for the budgets."""

    DZD = "DZD", _("Algerian dinar (DA)")
    EUR = "EUR", _("Euro (€)")
    USD = "USD", _("US dollar ($)")
    GBP = "GBP", _("Pound sterling (£)")
    CNY = "CNY", _("Chinese yuan (¥)")


class Supplier(models.Model):
    name = models.CharField(_("name"), max_length=255)
    type = models.CharField(_("type"), max_length=20, choices=SupplierType.choices, null=True, blank=True)
    status = models.CharField(
        _("status"), max_length=20, choices=SupplierStatus.choices, default=SupplierStatus.PAS_ENCORE_ENVOYEE
    )
    technical_capabilities = models.TextField(_("technical capabilities"), blank=True)
    address = models.CharField(_("address"), max_length=255, blank=True)
    city = models.CharField(_("city"), max_length=150, blank=True)
    country = models.CharField(_("country"), max_length=150, blank=True)
    contact_name = models.CharField(_("contact name"), max_length=150, blank=True)
    contact_role = models.CharField(_("contact role"), max_length=150, blank=True)
    email = models.EmailField(_("email address"), blank=True)
    phone = models.CharField(_("phone"), max_length=50, blank=True)
    contacted_by = models.ForeignKey(
        "members.Member", null=True, blank=True,
        on_delete=models.PROTECT, related_name="suppliers_contacted", verbose_name=_("contacted by"),
    )
    average_lead_time_days = models.IntegerField(
        _("average lead time (days)"), null=True, blank=True,
        validators=[__import__("django.core.validators", fromlist=["MinValueValidator"]).MinValueValidator(0)],
    )
    comments = models.TextField(_("comments"), blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        verbose_name = _("supplier")
        verbose_name_plural = _("suppliers")
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
    category = models.CharField(_("category"), max_length=20, choices=PartCategory.choices, default=PartCategory.OTHER)
    name = models.CharField(_("name"), max_length=255)
    description = models.TextField(_("description"), blank=True)
    reference = models.CharField(_("reference"), max_length=150, blank=True)
    quantity = models.IntegerField(_("quantity"), null=True, blank=True)
    material = models.CharField(_("material"), max_length=150, blank=True)
    # e.g. Usinage, Impression 3D, Decoupe laser
    process = models.CharField(_("manufacturing process"), max_length=150, blank=True)
    subsystem = models.ForeignKey(
        "subsystems.Subsystem", null=True, blank=True,
        on_delete=models.PROTECT, related_name="parts", verbose_name=_("subsystem"),
    )
    org_unit = models.ForeignKey(
        "members.OrgUnit", null=True, blank=True,
        on_delete=models.PROTECT, related_name="parts", verbose_name=_("organisational unit"),
    )
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        verbose_name = _("part")
        verbose_name_plural = _("parts")
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
    part = models.ForeignKey(
        Part, on_delete=models.PROTECT, related_name="purchase_requests", verbose_name=_("part")
    )
    requested_by = models.ForeignKey(
        "members.Member", on_delete=models.PROTECT, related_name="purchase_requests",
        verbose_name=_("requested by"),
    )
    quantity = models.PositiveIntegerField(_("quantity"))
    priority = models.CharField(_("priority"), max_length=10, choices=PurchasePriority.choices, null=True, blank=True)
    # "Date demandée" in the team's sheet: the day the part is needed (the request's own date is created_at).
    requested_date = models.DateField(_("needed by"), null=True, blank=True)
    status = models.CharField(
        _("status"), max_length=20, choices=PurchaseStatus.choices, default=PurchaseStatus.A_VALIDER_CHEF
    )
    # For what: the unit whose leaders approve the request (the subsystem's unit when there is one).
    # Empty only on requests entered before 19/10/2026.
    org_unit = models.ForeignKey(
        "members.OrgUnit", null=True, blank=True,
        on_delete=models.PROTECT, related_name="purchase_requests", verbose_name=_("organisational unit"),
    )
    subsystem = models.ForeignKey(
        "subsystems.Subsystem", null=True, blank=True,
        on_delete=models.PROTECT, related_name="purchase_requests", verbose_name=_("subsystem"),
    )
    # "Fournisseur choisi" in the team's sheet: the requester's idea, Operations choose when ordering.
    suggested_supplier = models.ForeignKey(
        Supplier, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="suggested_in", verbose_name=_("suggested supplier"),
    )
    notes = models.TextField(_("notes"), blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        verbose_name = _("purchase request")
        verbose_name_plural = _("purchase requests")
        indexes = [
            models.Index(fields=["status"], name="idx_purchase_request_status"),
        ]
        constraints = [
            models.CheckConstraint(condition=Q(quantity__gt=0), name="ck_purchase_request_quantity"),
        ]

    def __str__(self):
        return f"{self.quantity}x {self.part.name}"


class PurchaseRequestEvent(models.Model):
    """One step in the life of a purchase request: who did what, when, and why (the reason of a
    refusal or a cancellation). Its history, shown on its page; never changed afterwards."""

    purchase_request = models.ForeignKey(
        PurchaseRequest, on_delete=models.CASCADE, related_name="events", verbose_name=_("purchase request")
    )
    action = models.CharField(_("action"), max_length=20, choices=PurchaseAction.choices)
    # The status the request reached with this step.
    status = models.CharField(_("status"), max_length=20, choices=PurchaseStatus.choices)
    actor = models.ForeignKey(
        "members.Member", null=True, blank=True, on_delete=models.SET_NULL, related_name="+", verbose_name=_("by")
    )
    comment = models.TextField(_("comment"), blank=True)
    # How many parts arrived with this step (the receptions only).
    quantity = models.PositiveIntegerField(_("quantity"), null=True, blank=True)
    created_at = models.DateTimeField(_("date"), auto_now_add=True)

    class Meta:
        verbose_name = _("purchase request step")
        verbose_name_plural = _("purchase request history")
        ordering = ["created_at", "id"]

    def __str__(self):
        return str(self.get_action_display())


class ShippingAddress(models.Model):
    country = models.CharField(_("country"), max_length=150, blank=True)
    address = models.TextField(_("address"))
    contacted_by = models.ForeignKey(
        "members.Member", null=True, blank=True,
        on_delete=models.PROTECT, related_name="shipping_addresses", verbose_name=_("contacted by"),
    )
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("shipping address")
        verbose_name_plural = _("shipping addresses")

    def __str__(self):
        return self.address[:50]


class OrderBatch(models.Model):
    """Several requests ordered together from one supplier, as one order on its side (decision D-023):
    each request keeps its own order line; the delivery and customs costs paid once are shared out
    between them (workflow.order_batch)."""

    supplier = models.ForeignKey(
        Supplier, on_delete=models.PROTECT, related_name="order_batches", verbose_name=_("supplier")
    )
    created_by = models.ForeignKey(
        "members.Member", null=True, blank=True, on_delete=models.SET_NULL, related_name="+", verbose_name=_("by")
    )
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("grouped order")
        verbose_name_plural = _("grouped orders")

    def __str__(self):
        return gettext("Grouped order #%(number)s - %(supplier)s") % {"number": self.pk, "supplier": self.supplier.name}


class PurchaseOrder(models.Model):
    purchase_request = models.ForeignKey(
        PurchaseRequest, on_delete=models.PROTECT, related_name="orders", verbose_name=_("purchase request")
    )
    supplier = models.ForeignKey(
        Supplier, on_delete=models.PROTECT, related_name="orders", verbose_name=_("supplier")
    )
    shipping_address = models.ForeignKey(
        ShippingAddress, null=True, blank=True, on_delete=models.PROTECT, related_name="orders",
        verbose_name=_("shipping address"),
    )
    # Ordered together with other requests (one order at the supplier); its delivery and customs costs
    # are then its share of the grouped order's.
    batch = models.ForeignKey(
        OrderBatch, null=True, blank=True, on_delete=models.PROTECT, related_name="orders",
        verbose_name=_("grouped order"),
    )
    # The parts arrived so far: the order stays in progress until all of them are here, or until it is
    # closed with what arrived (decision D-023).
    quantity_received = models.PositiveIntegerField(_("quantity received"), default=0)
    # Every amount of an order is in its currency.
    currency = models.CharField(_("currency"), max_length=3, choices=Currency.choices, default=Currency.DZD)
    # Dinars paid for one unit of the currency: the rate actually paid, typed by Operations (always 1
    # for dinars).
    exchange_rate = models.DecimalField(_("exchange rate (DA)"), max_digits=12, decimal_places=4, default=1)
    unit_price = models.DecimalField(_("unit price"), max_digits=12, decimal_places=2, null=True, blank=True)
    delivery_cost = models.DecimalField(_("delivery cost"), max_digits=12, decimal_places=2, default=0)
    customs_cost = models.DecimalField(_("customs cost"), max_digits=12, decimal_places=2, default=0)
    # Computed in Django (unit_price * billed quantity + delivery + customs).
    total_price = models.DecimalField(_("total price"), max_digits=12, decimal_places=2, null=True, blank=True)
    # Computed in Django: total_price in dinars, for the budgets.
    total_price_dzd = models.DecimalField(
        _("total price (DA)"), max_digits=14, decimal_places=2, null=True, blank=True
    )
    ordered_at = models.DateField(_("order date"), null=True, blank=True)
    estimated_delivery_date = models.DateField(_("estimated delivery date"), null=True, blank=True)
    actual_delivery_date = models.DateField(_("actual delivery date"), null=True, blank=True)
    status = models.CharField(
        _("status"), max_length=20, choices=PurchaseStatus.choices, default=PurchaseStatus.EN_COMMANDE
    )
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)
    updated_at = models.DateTimeField(_("updated at"), auto_now=True)

    class Meta:
        verbose_name = _("purchase order")
        verbose_name_plural = _("purchase orders")
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
            models.CheckConstraint(condition=Q(exchange_rate__gt=0), name="ck_po_exchange_rate"),
            models.CheckConstraint(condition=~Q(currency="DZD") | Q(exchange_rate=1), name="ck_po_dzd_rate"),
            # An order is placed (en commande), delivered or cancelled: never "to approve" or "to order".
            models.CheckConstraint(
                condition=Q(status__in=["en_commande", "livre", "annule"]), name="ck_po_status"
            ),
            # One order in progress or delivered per request; a cancelled one may be replaced.
            models.UniqueConstraint(
                fields=["purchase_request"], condition=~Q(status="annule"), name="uq_po_one_active_per_request"
            ),
        ]

    def __str__(self):
        # Shown in other apps' dropdowns (expenses, stock movements): translated.
        return gettext("PO #%(number)s - %(supplier)s") % {"number": self.pk, "supplier": self.supplier.name}

    def billed_quantity(self):
        """The parts paid for: those of the request, or only those that arrived once the order was closed
        with what arrived (delivered with fewer parts than asked)."""
        asked = self.purchase_request.quantity if self.purchase_request_id else 0
        if self.status == PurchaseStatus.LIVRE and 0 < self.quantity_received < asked:
            return self.quantity_received
        return asked

    def save(self, *args, **kwargs):
        if self.unit_price is not None:
            self.total_price = (self.unit_price * self.billed_quantity()) + self.delivery_cost + self.customs_cost
        self.total_price_dzd = (
            None if self.total_price is None
            else (self.total_price * Decimal(self.exchange_rate)).quantize(CENTIME, rounding=ROUND_HALF_UP)
        )
        super().save(*args, **kwargs)


class Invoice(models.Model):
    supplier = models.ForeignKey(
        Supplier, on_delete=models.PROTECT, related_name="invoices", verbose_name=_("supplier")
    )
    reference = models.CharField(_("reference"), max_length=150)
    total_amount = models.DecimalField(_("total amount"), max_digits=12, decimal_places=2)
    issued_at = models.DateField(_("issue date"), null=True, blank=True)
    created_at = models.DateTimeField(_("created at"), auto_now_add=True)

    class Meta:
        verbose_name = _("invoice")
        verbose_name_plural = _("invoices")
        indexes = [models.Index(fields=["issued_at"], name="idx_invoice_issued_at")]
        constraints = [
            models.UniqueConstraint(fields=["supplier", "reference"], name="uq_invoice_supplier_reference"),
            models.CheckConstraint(condition=Q(total_amount__gte=0), name="ck_invoice_total_amount"),
        ]

    def __str__(self):
        return f"{self.supplier.name} / {self.reference}"


class InvoiceLineItem(models.Model):
    invoice = models.ForeignKey(
        Invoice, on_delete=models.CASCADE, related_name="line_items", verbose_name=_("invoice")
    )
    description = models.TextField(_("description"))
    quantity = models.DecimalField(_("quantity"), max_digits=12, decimal_places=3)
    unit_price = models.DecimalField(_("unit price"), max_digits=12, decimal_places=2)
    total_price = models.DecimalField(_("total price"), max_digits=12, decimal_places=2)

    class Meta:
        verbose_name = _("invoice line")
        verbose_name_plural = _("invoice lines")
        constraints = [
            models.CheckConstraint(condition=Q(quantity__gt=0), name="ck_invoice_line_quantity"),
            models.CheckConstraint(condition=Q(unit_price__gte=0), name="ck_invoice_line_unit_price"),
            models.CheckConstraint(condition=Q(total_price__gte=0), name="ck_invoice_line_total_price"),
        ]

    def __str__(self):
        return self.description[:50]
