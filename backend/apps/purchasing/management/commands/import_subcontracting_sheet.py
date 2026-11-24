"""Imports the team's subcontracting workbook ("Sheet de Sous-traitance", in documentation/ of the team's
repository) into the purchasing module:

    python manage.py import_subcontracting_sheet "<path of the .xlsx file>" --dry-run   counts only
    python manage.py import_subcontracting_sheet "<path of the .xlsx file>"             the import

- sheet "Fournisseurs  entreprises": the suppliers;
- sheet "shipping adress": the shipping addresses;
- sheet "Pièces & Commandes": one part and one purchase request per row, and an order (in dinars) for
  the rows ordered or delivered with a chosen supplier and a unit price.

The workbook holds the contacts of people outside the club: it must never be committed, and this
command prints counts only, never a name, a contact or a remark.

Safe to run again: what is already in the ERP stays as it is, only what is missing is added (suppliers
known by their name, addresses by their text, the requests of an earlier import by their part's name,
description, material and process). Everything happens in one transaction: after an error, nothing is
saved. --dry-run does the whole import, prints the counts, then cancels it.

How the sheet's words become the ERP's (19/10/2026; knowledge base: PROJECTS/ERP/purchasing_design.md):
- statuses Livré / A commander / En commande → delivered / to order / ordered. A row without a known
  status, or "En commande" without a supplier or a price (an order needs both), is to order: Operations
  will see it. Priorities P1 / P2 / P3 → high / medium / low.
- A quantity that is not a whole number ("Plusieurs", dimensions) → 1. The sheet's text goes to the
  request's notes, with the remarks and what has no field of its own (a web link, a price without an
  order, a date not understood…).
- The sheet does not say who asked: the requests are entered for the head of Operations (or the member
  of --requested-by), for no unit, with one history line "imported" without a name.
- An order: in DZD at rate 1, "Delivery cost + custom cost" as its delivery cost, its total computed
  again by the order itself. The past deliveries are not put in stock (they may well be used up).
- "Fournisseur choisi": a supplier known by this name (for a web link: the site), else a new one.
- "contacté par": the member with this name (full name, first name and initial, first name, then last
  name; only when one member fits), else empty. The demo's fictitious people are left out.
- The average lead time only when it is a number of days.
- A text too long for its field is cut, and the supplier's comments or the request's notes say so.

What the sheet leaves incomplete is guessed and marked "à vérifier" (or "à compléter") in the supplier's
comments, to be found and corrected in the ERP (rules first applied by hand on 20/10/2026, at the user's
request: "devine, s'il y a une faute d'orthographe je corrigerai"):
- a supplier without a name: a provisional one, "<its first capability> – sans nom (fiche, ligne N)" (left
  out when it has no capability either);
- "contacté par" when several members fit: the only one of this first name in Operations; when none fits:
  a name written differently (similar enough, and clearly closer than any other member);
- "Fournisseur choisi" with no supplier of this name: the sheet's supplier whose distinctive words are the
  same (more or fewer, when exactly one fits), else a new supplier whose type is guessed from the
  processes of the parts asked from it (machining, subcontracting, else a supplier);
- the category "Drivertrain" (a typo) is the drivetrain.
"""

import re
import unicodedata
from collections import Counter
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from difflib import SequenceMatcher
from pathlib import Path
from urllib.parse import urlsplit
from zipfile import BadZipFile

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email
from django.db import transaction
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter
from openpyxl.utils.exceptions import InvalidFileException

from apps.members.models import Member, Membership
from apps.projects.management.commands.seed_demo import EMAIL_DOMAIN as DEMO_EMAIL_DOMAIN
from apps.projects.management.commands.seed_demo import PREFIX as DEMO_PREFIX
from apps.purchasing.access import OPERATIONS_UNIT
from apps.purchasing.models import (
    CENTIME, Currency, Part, PartCategory, PurchaseAction, PurchaseOrder, PurchasePriority, PurchaseRequest,
    PurchaseRequestEvent, PurchaseStatus, ShippingAddress, Supplier, SupplierStatus, SupplierType,
)

# --- The workbook ---

PARTS_SHEET = "Pièces & Commandes"
SUPPLIERS_SHEET = "Fournisseurs  entreprises"
ADDRESSES_SHEET = "shipping adress"

# The columns of each sheet, in order: (key, how its title starts once normalized; None: any title).
# The import stops when a title differs: the sheet changed, and these lists must be checked.
PARTS_COLUMNS = [
    ("category", None),  # no title in the team's sheet
    ("name", "nom de la piece"),
    ("description", "description"),
    ("quantity", "quantite"),
    ("material", "matiere"),
    ("process", "process"),
    ("supplier", "fournisseur choisi"),
    ("unit_price", "prix unitaire"),
    ("delivery", "delivery cost"),  # delivery and customs, in one column
    ("total", "prix total"),
    ("priority", "priorite"),
    ("needed_by", "date demandee"),
    ("expected", "date de livraison estimee"),
    ("other_status", "statut"),  # two "Statut" columns: the statuses are in the second one
    ("status", "statut"),
    ("remarks", "remarques"),
]
SUPPLIERS_COLUMNS = [
    ("status", "statut"),
    ("name", "nom du fournisseur"),
    ("type", "type"),
    ("capabilities", "capacites techniques"),
    ("address", "adresse"),
    ("contact", "contact"),  # "Contact / poste"
    ("reach", "email"),  # "Email / TLF"
    ("contacted_by", "contacte par"),
    ("lead_time", "delai moyen"),
    ("comments", "commentaires"),
]
ADDRESSES_COLUMNS = [("country", "count"), ("address", "adress"), ("contacted_by", "contacted par")]

# --- The sheet's words, normalized, and the ERP's ---

S = PurchaseStatus
REQUEST_STATUSES = {
    "livre": S.LIVRE, "livree": S.LIVRE, "a commander": S.A_COMMANDER, "en commande": S.EN_COMMANDE,
    "annule": S.ANNULE, "annulee": S.ANNULE,
}
PRIORITIES = {"p1": PurchasePriority.HIGH, "p2": PurchasePriority.MEDIUM, "p3": PurchasePriority.LOW}
SUPPLIER_STATUSES = {
    "en attente": SupplierStatus.EN_ATTENTE, "pas encore envoyee": SupplierStatus.PAS_ENCORE_ENVOYEE,
    "validee": SupplierStatus.VALIDEE, "refusee": SupplierStatus.REFUSEE,
}
SUPPLIER_TYPES = {
    "fournisseur": SupplierType.FOURNISSEUR, "sous traitant": SupplierType.SOUS_TRAITANT,
    "soustraitant": SupplierType.SOUS_TRAITANT, "mixte": SupplierType.MIXTE, "usinage": SupplierType.USINAGE,
    "logistique": SupplierType.LOGISTIQUE,
}
C = PartCategory
# The sheet's first column: the team's part categories (schema guide: part_category), written as
# abbreviations (BRK, SUS…) or words.
CATEGORY_ABBREVIATIONS = {"brk": C.BRAKES, "sus": C.SUSPENSION, "str": C.STEERING, "op": C.OPERATIONS, "lv": C.LOW_VOLTAGE}
CATEGORY_WORDS = [
    (r"\b(frein|brake)", C.BRAKES),
    (r"\b(roue|pneu|jante|wheel|tyre|tire)", C.WHEELS_TYRES),
    (r"\b(chassis|carross|body|coque)", C.CHASSIS_BODY),
    (r"\bsuspension", C.SUSPENSION),
    (r"\b(direction|steering)", C.STEERING),
    (r"\b(transmission|drivetrain|drivertrain)", C.DRIVETRAIN),  # "drivertrain": a typo of the team's sheet
    (r"\b(moteur|engine|tractive|traction|powertrain)", C.ENGINE_TRACTIVE),
    (r"\b(atelier|workshop|outil)", C.WORKSHOP),
    (r"\b(basse tension|low voltage|electri|electron)", C.LOW_VOLTAGE),
    (r"\b(operation|logisti)", C.OPERATIONS),
    (r"\b(autre|other|divers)", C.OTHER),
]

# The import's history line: action "requested", no name (who asked is not in the sheet). The
# requests imported before are recognised by it.
IMPORT_COMMENT = "Importée depuis la fiche de sous-traitance de l'équipe."
CHOSEN_SUPPLIER_COMMENT = "Ajouté par l'import de la fiche de sous-traitance (colonne « Fournisseur choisi »)."
# On a supplier or a request with a text cut to the size of its field: to find it and complete it.
SHORTENED_NOTE = "Texte raccourci à l'import (trop long pour l'ERP) : voir la fiche de sous-traitance."
# The guesses, marked in the supplier's comments.
NAME_GUESSED = "Nom provisoire donné à l'import (la fiche n'en avait pas) : à compléter."
CONTACT_HOMONYM = "« Contacté par » deviné à l'import (le seul membre de ce prénom aux Opérations) : à vérifier."
CONTACT_SPELLING = "« Contacté par » deviné à l'import (nom écrit autrement dans la fiche) : à vérifier."
TYPE_GUESSED = "Type deviné à l'import d'après les pièces demandées : à vérifier."
MERGED = (
    "Aussi nommé « {name} » dans la colonne « Fournisseur choisi » de la fiche (fusion devinée à l'import : "
    "à vérifier)."
)
# A name written differently: similar enough, and clearly closer than any other member.
SPELLING_SIMILARITY, SPELLING_MARGIN = 0.8, 0.1
# Words too common to tell two suppliers apart.
GENERIC = {
    "atelier", "usinage", "ets", "etablissement", "etablissements", "sarl", "eurl", "spa", "sas", "snc", "societe",
    "entreprise", "group", "groupe", "industrie", "industries", "algerie", "algeria", "dz", "com", "net", "shop",
    "store", "le", "la", "les", "de", "du", "des", "et", "chez", "the", "co", "company", "fournisseur", "magasin",
    "boutique", "service", "services",
}
# The type of a supplier added from "Fournisseur choisi", from the processes of the parts asked from it.
MACHINING = re.compile(r"\b(usinage|tour|tournage|fraisage|fraiseuse|cnc)")
SUBCONTRACTING = re.compile(r"\b(decoupe|laser|plasma|pliage|soud|impression|moulage|peinture|traitement)")
# What the requests' notes may receive from the sheet (counted in the output, in this order).
NOTE_KINDS = [
    "remarks", "quantities", "categories", "priorities", "dates", "web links", "prices without an order",
    "other statuses",
]
MAX_AMOUNT = Decimal(10) ** 10  # amounts have 12 digits, 2 of them after the decimal point
MAX_QUANTITY = 1_000_000
DAY_FORMATS = ("%d/%m/%Y", "%d/%m/%y", "%d-%m-%Y", "%d.%m.%Y", "%Y-%m-%d")
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
WEB_LINK = re.compile(r"(https?://|www\.)\S+", re.IGNORECASE)
# Second-level names of country domains: amazon.co.uk is a site, co.uk is not.
SECOND_LEVEL = {"ac", "co", "com", "edu", "gov", "net", "org"}


# --- Reading a cell ---


def normalize(value):
    """Lower case, without accents or punctuation, single spaces: how the sheet's words are compared.
    The letters of every script are kept (a name written in Arabic is not an empty name)."""
    if value is None:
        return ""
    text = unicodedata.normalize("NFKD", str(value))
    text = "".join(char for char in text if not unicodedata.combining(char))
    return " ".join(re.sub(r"[\W_]+", " ", text.casefold()).split())


def number_text(number):
    """A number as the team writes it: 2, 2,5."""
    if isinstance(number, float) and number.is_integer():
        number = int(number)
    return str(number).replace(".", ",")


def cell_text(value):
    """A cell as it reads in the sheet (a text keeps its lines)."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        value = value.date()
    if isinstance(value, date):
        return value.strftime("%d/%m/%Y")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return number_text(value)
    return str(value).strip()


def one_line(value):
    return " ".join(cell_text(value).split())


def cut(text, model, field):
    """`text` cut to the size of the model's field."""
    limit = model._meta.get_field(field).max_length
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def to_amount(value):
    """An amount: a number, or a text such as "1 200 da". None if there is none or it is not understood
    (an Excel error such as #VALUE!, a negative number…)."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = Decimal(str(value))
    else:
        text = re.sub(r"(?i)(dzd|dinars?|da)\.?$", "", str(value).strip())
        text = re.sub(r"\s", "", text)  # spaces group the thousands
        if re.fullmatch(r"\d{1,3}([.,]\d{3})+", text):
            text = re.sub(r"[.,]", "", text)  # 1.500, 1,500: thousands
        elif "," in text and "." in text:
            text = text.replace(".", "").replace(",", ".")  # 1.200,50
        else:
            text = text.replace(",", ".")
        if not re.fullmatch(r"\d+(\.\d+)?", text):
            return None
        number = Decimal(text)
    if not number.is_finite() or number < 0 or number >= MAX_AMOUNT:
        return None
    return number.quantize(CENTIME, rounding=ROUND_HALF_UP)


def amount_text(amount):
    """An amount in a note: 1200, 12,50."""
    return str(int(amount)) if amount == amount.to_integral_value() else f"{amount:.2f}".replace(".", ",")


def to_quantity(value):
    """(how many, note): a whole number of parts, else 1 and the sheet's text in the note."""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if isinstance(value, str) and re.fullmatch(r"[0-9]+", value.strip()):
        value = int(value.strip())
    if isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= MAX_QUANTITY:
        return value, ""
    text = cell_text(value)
    if not text:
        return 1, "Quantité absente de la fiche."
    return 1, f"Quantité dans la fiche : {text}"


def to_day(value):
    """A date of the sheet (a date cell, or a text such as 15/11/2026); None if there is none."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = one_line(value)
    for pattern in DAY_FORMATS:
        try:
            return datetime.strptime(text, pattern).date()
        except ValueError:
            continue
    return None


def to_lead_time(value):
    """The average lead time when it is a number of days (10, "15 jours", "8 j"), else None."""
    if value is None or isinstance(value, (bool, date)):
        return None  # a date: Excel took "2-3" (weeks?) for one
    if isinstance(value, (int, float)):
        return int(value) if value >= 0 and float(value).is_integer() else None
    found = re.fullmatch(r"(\d+) ?(j|jr|jrs|jours?|days?)?", normalize(value))
    return int(found.group(1)) if found else None


def split_contact(value):
    """"Contact / poste" in one cell → (name, position)."""
    name, _, role = one_line(value).partition("/")
    return name.strip(), role.strip()


def split_reach(value):
    """"Email / TLF" in one cell → (the e-mail address, the rest: phone numbers…). A number typed in
    Excel lost its leading 0: put back for an Algerian mobile (9 digits) or landline (8 digits)."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        digits = str(int(value))
        if (len(digits) == 9 and digits[0] in "567") or (len(digits) == 8 and digits[0] in "234"):
            digits = "0" + digits
        return "", digits
    text = one_line(value)
    email = ""
    for found in EMAIL.finditer(text):
        try:
            validate_email(found.group(0))
        except ValidationError:
            continue
        if len(found.group(0)) <= Supplier._meta.get_field("email").max_length:
            email = found.group(0)
            text = text[: found.start()] + " " + text[found.end():]
            break
    return email, " ".join(text.split()).strip(" /-,;:|")


def web_site(link):
    """The site of a web link, without "www." nor sub-domain: aliexpress.com, amazon.co.uk."""
    if not link.lower().startswith("http"):
        link = "http://" + link
    try:
        host = urlsplit(link).hostname or ""
    except ValueError:
        return ""
    labels = [label for label in host.split(".") if label]
    keep = 3 if len(labels) >= 3 and len(labels[-1]) == 2 and labels[-2] in SECOND_LEVEL else 2
    return ".".join(labels[-keep:])


def chosen_supplier(value):
    """"Fournisseur choisi" → (the supplier's name, True when it is the site of a web link)."""
    text = one_line(value)
    link = WEB_LINK.search(text)
    site = web_site(link.group(0)) if link else ""
    return (site, True) if site else (text, False)


def part_category(value):
    """(category, note): the team's category of a part, else Other and the sheet's word in the note."""
    label = normalize(value)
    if not label:
        return C.OTHER, ""
    if label in CATEGORY_ABBREVIATIONS:
        return CATEGORY_ABBREVIATIONS[label], ""
    for pattern, category in CATEGORY_WORDS:
        if re.search(pattern, label):
            return category, ""
    return C.OTHER, f"Catégorie dans la fiche : {one_line(value)}"


def part_key(name, description, material, process):
    """What tells the parts of the sheet apart (and the requests of an earlier import)."""
    return tuple(normalize(text) for text in (name, description, material, process))


def with_comment(text, comment):
    """`text` with `comment` on a line of its own, once."""
    if not text:
        return comment
    return text if comment in text.splitlines() else f"{text}\n{comment}"


def significant(name):
    """The words that tell a supplier apart (a web site by its name: aliexpress for aliexpress.com)."""
    if "." in name and " " not in name.strip():
        name = name.split(".")[0]
    return set(normalize(name).split()) - GENERIC


def guessed_type(processes):
    """The type of a supplier from the processes of the parts asked from it."""
    words = " ".join(normalize(process) for process in processes if process)
    if MACHINING.search(words):
        return SupplierType.USINAGE
    if SUBCONTRACTING.search(words):
        return SupplierType.SOUS_TRAITANT
    return SupplierType.FOURNISSEUR  # a web shop, or parts bought as they are


def provisional_name(row):
    """For a supplier row without a name: its first technical capability, "sans nom" and its Excel row;
    None when it has no capability either."""
    capabilities = one_line(row["capabilities"])
    if not capabilities:
        return None
    label = re.split(r"[,;/]", capabilities)[0].strip()[:60]
    return cut(f"{label} – sans nom (fiche, ligne {row['_row']})", Supplier, "name")


def price_note(unit_price, delivery):
    prices = []
    if unit_price is not None:
        prices.append(f"{amount_text(unit_price)} DA l'unité")
    if delivery:
        prices.append(f"{amount_text(delivery)} DA de livraison et de douane")
    return f"Prix dans la fiche : {', '.join(prices)}." if prices else ""


# --- Reading the workbook ---


def read_sheet(sheets, title, columns):
    """The sheet's rows as {column key: value}, empty rows left out, after checking its column titles."""
    sheet = sheets.get(normalize(title))
    if sheet is None:
        raise CommandError(f'Sheet "{title}" not found in the workbook.')
    rows = sheet.iter_rows(values_only=True)
    titles = list(next(rows, ()))
    for index, (_key, expected) in enumerate(columns):
        found = one_line(titles[index]) if index < len(titles) else ""
        if expected is not None and not normalize(found).startswith(expected):
            raise CommandError(
                f'Sheet "{sheet.title}", column {get_column_letter(index + 1)}: expected a title starting '
                f'with "{expected}", found "{found}".'
            )
    keys = [key for key, _expected in columns]
    records = []
    for number, values in enumerate(rows, start=2):  # row 1: the titles
        values = (list(values) + [None] * len(keys))[: len(keys)]
        if any(one_line(value) for value in values):
            records.append({**dict(zip(keys, values, strict=True)), "_row": number})
    return records


def read_workbook(path):
    """{sheet title: its rows} for the three sheets the import needs."""
    if not path.is_file():
        raise CommandError(f"File not found: {path}")
    try:
        workbook = load_workbook(path, read_only=True, data_only=True)
    except (InvalidFileException, BadZipFile, KeyError, OSError) as error:
        raise CommandError(f"Not an Excel workbook (.xlsx): {path}") from error
    try:
        sheets = {normalize(sheet.title): sheet for sheet in workbook.worksheets}
        return {
            title: read_sheet(sheets, title, columns)
            for title, columns in (
                (SUPPLIERS_SHEET, SUPPLIERS_COLUMNS), (ADDRESSES_SHEET, ADDRESSES_COLUMNS), (PARTS_SHEET, PARTS_COLUMNS)
            )
        }
    finally:
        workbook.close()


# --- The people named in the sheet ---


class MemberFinder:
    """The member a name written in the sheet stands for: by full name (in either order), by first name
    and initial of the last name, by first name, then by last name; only when exactly one member fits.
    The fictitious people of the demo (seed_demo) are never taken for real ones."""

    def __init__(self):
        people = Member.objects.exclude(code__startswith=DEMO_PREFIX, email__iendswith="@" + DEMO_EMAIL_DOMAIN)
        self.people = [
            (pk, normalize(first_name), normalize(last_name))
            for pk, first_name, last_name in people.values_list("pk", "first_name", "last_name")
        ]
        self.in_operations = set(
            Membership.objects.filter(end_date__isnull=True, org_unit__code=OPERATIONS_UNIT).values_list(
                "member_id", flat=True
            )
        )

    def find(self, written):
        """(member id or None, "linked" / "several" / "unknown")."""
        key = normalize(written)
        if not key:
            return None, "unknown"
        words = key.split()
        rules = [lambda first, last: key in (f"{first} {last}", f"{last} {first}")]
        if len(words) >= 2:
            given, initial = " ".join(words[:-1]), words[-1]
            rules.append(lambda first, last: first == given and last.startswith(initial))
        rules += [lambda first, last: first == key, lambda first, last: last == key]
        for fits in rules:
            found = {pk for pk, first, last in self.people if fits(first, last)}
            if len(found) == 1:
                return found.pop(), "linked"
            if found:
                return None, "several"
        return None, "unknown"

    def guess(self, written, outcome):
        """For a name `find` could not link: (member id, "homonym" / "spelling"), else (None, outcome).
        Several members fit: the only one of this first name in Operations. None fits: a name written
        differently."""
        key = normalize(written)
        if outcome == "several":
            homonyms = [pk for pk, first, _last in self.people if first == key and pk in self.in_operations]
            return (homonyms[0], "homonym") if len(homonyms) == 1 else (None, outcome)
        ratios = sorted(
            (
                max(SequenceMatcher(None, key, first).ratio(), SequenceMatcher(None, key, f"{first} {last}").ratio()),
                pk,
            )
            for pk, first, last in self.people
        )[::-1]
        closest = ratios[0] if ratios else (0, None)
        if closest[0] >= SPELLING_SIMILARITY and (len(ratios) == 1 or closest[0] - ratios[1][0] >= SPELLING_MARGIN):
            return closest[1], "spelling"
        return None, outcome


def find_requester(email):
    """(the member the imported requests are entered for, how it was chosen)."""
    if email:
        member = Member.objects.filter(email__iexact=email.strip()).first()
        if member is None:
            raise CommandError("No member has this e-mail address (--requested-by).")
        return member, "--requested-by"
    heads = list(
        Member.objects.filter(
            is_active=True, memberships__end_date__isnull=True, memberships__org_unit__code=OPERATIONS_UNIT,
            memberships__role__is_leadership=True,
        ).distinct()
    )
    if len(heads) != 1:
        raise CommandError(
            f"The sheet does not say who asked for the parts, and {len(heads)} heads of Operations were found: "
            "name the member to enter the requests for with --requested-by <e-mail>."
        )
    return heads[0], "head of Operations"


# --- The import ---


class SheetImport:
    """Adds what the sheets hold and the ERP does not; counts everything in `count`. The suppliers come
    first: the parts' chosen suppliers are looked for among them."""

    def __init__(self, requester):
        self.requester = requester
        self.count = Counter()
        self.members = MemberFinder()
        self.suppliers = {}  # normalized name → supplier
        for supplier in Supplier.objects.order_by("id"):
            self.suppliers.setdefault(normalize(supplier.name), supplier)

    def fit(self, text, model, field):
        fitted = cut(text, model, field)
        if fitted != text:
            self.count["shortened"] += 1
        return fitted

    def fitted(self, model, notes, **texts):
        """`texts` cut to the size of the model's fields; when one was, SHORTENED_NOTE is added to `notes`
        (the record's comments or notes), to find it and complete it from the sheet."""
        fitted = {field: cut(text, model, field) for field, text in texts.items()}
        shortened = sum(fitted[field] != text for field, text in texts.items())
        if shortened:
            self.count["shortened"] += shortened
            notes.append(SHORTENED_NOTE)
        return fitted

    def contacted_by(self, value, sheet, comments=None):
        """The member "contacté par" names. For a supplier (its `comments` given), a name not linked is
        guessed, and the guess marked in them."""
        if not one_line(value):
            return None
        member, outcome = self.members.find(value)
        if comments is not None and outcome != "linked":
            member, outcome = self.members.guess(value, outcome)
            if member is not None:
                comments.append(CONTACT_HOMONYM if outcome == "homonym" else CONTACT_SPELLING)
        self.count[f"{sheet} contacted {outcome}"] += 1
        return member

    def suppliers_sheet(self, rows):
        seen = set()
        for row in rows:
            key = normalize(cut(one_line(row["name"]), Supplier, "name"))
            name_note = ""
            if not key:
                self.count["suppliers nameless"] += 1
                provisional = provisional_name(row)
                if provisional is None:
                    self.count["suppliers nameless left out"] += 1
                    continue
                row, key, name_note = {**row, "name": provisional}, normalize(provisional), NAME_GUESSED
            if key in seen:
                self.count["suppliers repeated"] += 1
            elif key in self.suppliers:
                self.count["suppliers known"] += 1
            else:
                self.suppliers[key] = self.add_supplier(row, name_note)
                if name_note:
                    self.count["suppliers nameless named"] += 1
            seen.add(key)

    def add_supplier(self, row, note=""):
        comments = [cell_text(row["comments"])]
        status = SUPPLIER_STATUSES.get(normalize(row["status"]))
        if status is None and one_line(row["status"]):
            self.count["supplier statuses unknown"] += 1
            comments.append(f"Statut dans la fiche : {one_line(row['status'])}")
        kind = SUPPLIER_TYPES.get(normalize(row["type"]))
        if kind is None and one_line(row["type"]):
            self.count["supplier types unknown"] += 1
            comments.append(f"Type dans la fiche : {one_line(row['type'])}")
        lead_time = to_lead_time(row["lead_time"])
        if lead_time is not None:
            self.count["lead times kept"] += 1
        elif one_line(row["lead_time"]):
            self.count["lead times dropped"] += 1
            if isinstance(row["lead_time"], str):
                comments.append(f"Délai moyen indiqué dans la fiche : {one_line(row['lead_time'])}")
        contact_name, contact_role = split_contact(row["contact"])
        email, phone = split_reach(row["reach"])
        texts = self.fitted(
            Supplier, comments, name=one_line(row["name"]), address=one_line(row["address"]),
            contact_name=contact_name, contact_role=contact_role, phone=phone,
        )
        if note:
            comments.append(note)
        contacted_by = self.contacted_by(row["contacted_by"], "suppliers", comments)
        self.count["suppliers added"] += 1
        return Supplier.objects.create(
            **texts,
            type=kind,
            status=status or SupplierStatus.PAS_ENCORE_ENVOYEE,
            technical_capabilities=cell_text(row["capabilities"]),
            email=email,
            contacted_by_id=contacted_by,
            average_lead_time_days=lead_time,
            comments="\n".join(text for text in comments if text),
        )

    def addresses_sheet(self, rows):
        known = {
            (normalize(country), normalize(address))
            for country, address in ShippingAddress.objects.values_list("country", "address")
        }
        for row in rows:
            address = cell_text(row["address"])
            country = self.fit(one_line(row["country"]), ShippingAddress, "country")
            key = (normalize(country), normalize(address))
            if not address:
                self.count["addresses without address"] += 1
            elif key in known:
                self.count["addresses known"] += 1
            else:
                known.add(key)
                ShippingAddress.objects.create(
                    country=country, address=address, contacted_by_id=self.contacted_by(row["contacted_by"], "addresses")
                )
                self.count["addresses added"] += 1

    def supplier_for(self, value):
        """(the supplier "Fournisseur choisi" names, True when it comes from a web link): one known by this
        name (for a web link: the site, with or without its ending, e.g. "aliexpress"), else a new one."""
        name, from_link = chosen_supplier(value)
        keys = [normalize(cut(name, Supplier, "name"))]
        if from_link:
            keys.append(normalize(name.split(".")[0]))
        for key in keys:
            if key in self.suppliers:
                return self.suppliers[key], from_link
        close = self.close_supplier(name)
        if close is not None:
            close.comments = with_comment(close.comments, MERGED.format(name=name))
            close.save(update_fields=["comments", "updated_at"])
            self.suppliers[keys[0]] = close  # the same name on other rows: found at once
            self.count["chosen suppliers merged"] += 1
            return close, from_link
        comments = [CHOSEN_SUPPLIER_COMMENT]
        supplier = Supplier.objects.create(**self.fitted(Supplier, comments, name=name), comments="\n".join(comments))
        self.suppliers[keys[0]] = supplier
        self.count["chosen suppliers added"] += 1
        if from_link:
            self.count["chosen suppliers from links"] += 1
        return supplier, from_link

    def close_supplier(self, name):
        """The one supplier of the sheet (not added from "Fournisseur choisi", not the demo's) whose
        distinctive words are those of `name`, more or fewer; None when none or several fit."""
        words = significant(name)
        if not words:
            return None
        candidates = {
            supplier.pk: supplier for supplier in self.suppliers.values()
            if not (supplier.comments or "").startswith(CHOSEN_SUPPLIER_COMMENT) and not supplier.name.startswith("[DEMO]")
        }
        fits = [
            supplier for supplier in candidates.values()
            if (other := significant(supplier.name)) and (words <= other or other <= words)
        ]
        return fits[0] if len(fits) == 1 else None

    def guess_chosen_types(self):
        """The type of the suppliers added from "Fournisseur choisi" that have none (this import's and an
        earlier one's), from the processes of the parts asked from them."""
        for supplier in Supplier.objects.filter(comments__startswith=CHOSEN_SUPPLIER_COMMENT, type__isnull=True):
            processes = PurchaseRequest.objects.filter(suggested_supplier=supplier).values_list("part__process", flat=True)
            supplier.type = guessed_type(processes)
            supplier.comments = with_comment(supplier.comments, TYPE_GUESSED)
            supplier.save(update_fields=["type", "comments", "updated_at"])
            self.count[f"chosen type {supplier.type}"] += 1

    def parts_sheet(self, rows):
        earlier = Counter(
            part_key(purchase.part.name, purchase.part.description, purchase.part.material, purchase.part.process)
            for purchase in PurchaseRequest.objects.filter(
                events__action=PurchaseAction.REQUESTED, events__actor__isnull=True, events__comment=IMPORT_COMMENT
            ).distinct().select_related("part")
        )
        seen = Counter()
        for row in rows:
            name = one_line(row["name"])
            if not name:
                self.count["parts nameless"] += 1
                continue
            key = part_key(
                cut(name, Part, "name"), cell_text(row["description"]), cut(one_line(row["material"]), Part, "material"),
                cut(one_line(row["process"]), Part, "process"),
            )
            seen[key] += 1
            if seen[key] <= earlier[key]:  # the part may be bought several times: one request each
                self.count["parts before"] += 1
            else:
                self.add_purchase(row)

    def note(self, notes, kind, text):
        if text:
            notes.append(text)
            self.count[f"notes {kind}"] += 1

    def add_purchase(self, row):
        """The row's part, its purchase request with its history line and, when it was ordered or
        delivered with a supplier and a price, its order."""
        notes = []
        self.note(notes, "remarks", cell_text(row["remarks"]))
        quantity, quantity_note = to_quantity(row["quantity"])
        self.note(notes, "quantities", quantity_note)
        category, category_note = part_category(row["category"])
        self.note(notes, "categories", category_note)
        priority = PRIORITIES.get(normalize(row["priority"]))
        if priority is None and one_line(row["priority"]):
            self.note(notes, "priorities", f"Priorité dans la fiche : {one_line(row['priority'])}")
        needed_by = to_day(row["needed_by"])
        if needed_by is None and one_line(row["needed_by"]):
            self.note(notes, "dates", f"Date demandée dans la fiche : {one_line(row['needed_by'])}")
        supplier = None
        if one_line(row["supplier"]):
            supplier, from_link = self.supplier_for(row["supplier"])
            if from_link:
                self.note(notes, "web links", f"Fournisseur choisi dans la fiche : {one_line(row['supplier'])}")
        unit_price, delivery = to_amount(row["unit_price"]), to_amount(row["delivery"])
        status = REQUEST_STATUSES.get(normalize(row["status"]))
        ordered = status in (S.LIVRE, S.EN_COMMANDE) and supplier is not None and unit_price is not None
        expected = to_day(row["expected"])
        if not ordered:
            self.note(notes, "prices without an order", price_note(unit_price, delivery))
        if one_line(row["expected"]) and (not ordered or expected is None):
            self.note(notes, "dates", f"Livraison estimée dans la fiche : {one_line(row['expected'])}")
        other_status = one_line(row["other_status"])
        if other_status:
            self.note(notes, "other statuses", f"Autre statut dans la fiche : {other_status}")
        if status is None:
            written = one_line(row["status"])
            notes.append(f"Statut dans la fiche : {written}" if written else "Statut absent de la fiche.")
            self.count["to order unknown status"] += 1
            status = S.A_COMMANDER
        elif status == S.EN_COMMANDE and not ordered:
            notes.append(
                "Indiquée « En commande » dans la fiche, sans fournisseur ou sans prix : la commande est à saisir "
                "dans l'ERP."
            )
            self.count["to order without an order"] += 1
            status = S.A_COMMANDER

        texts = self.fitted(
            Part, notes, name=one_line(row["name"]), material=one_line(row["material"]),
            process=one_line(row["process"]),
        )
        part = Part.objects.create(category=category, description=cell_text(row["description"]), **texts)
        purchase = PurchaseRequest.objects.create(
            part=part, requested_by=self.requester, quantity=quantity, priority=priority, requested_date=needed_by,
            status=status, suggested_supplier=supplier, notes="\n".join(notes),
        )
        PurchaseRequestEvent.objects.create(
            purchase_request=purchase, action=PurchaseAction.REQUESTED, status=status, comment=IMPORT_COMMENT
        )
        self.count["parts added"] += 1
        self.count[f"status {status}"] += 1
        self.count[f"priority {priority or 'none'}"] += 1
        if ordered:
            order = PurchaseOrder.objects.create(
                purchase_request=purchase, supplier=supplier, currency=Currency.DZD, exchange_rate=1,
                unit_price=unit_price, delivery_cost=delivery or 0, estimated_delivery_date=expected, status=status,
                # A delivered row of the sheet brought all its parts (partial deliveries: decision D-023).
                quantity_received=purchase.quantity if status == S.LIVRE else 0,
            )
            self.count["orders added"] += 1
            total = to_amount(row["total"])
            if total is not None and total != order.total_price:
                self.count["orders total differs"] += 1


class Command(BaseCommand):
    help = (
        "Import the team's subcontracting workbook (.xlsx): suppliers, shipping addresses, parts, purchase "
        "requests and their orders. Prints counts only. Safe to run again. --dry-run: the counts, nothing saved."
    )

    def add_arguments(self, parser):
        parser.add_argument("path", help="The workbook (.xlsx). Never commit it: it holds people's contacts.")
        parser.add_argument("--dry-run", action="store_true", help="Do the import, print the counts, save nothing.")
        parser.add_argument(
            "--requested-by", metavar="E-MAIL",
            help="The member the imported requests are entered for (default: the head of Operations).",
        )

    def handle(self, *args, **options):
        path = Path(options["path"])
        sheets = read_workbook(path)
        requester, chosen_by = find_requester(options["requested_by"])
        with transaction.atomic():
            work = SheetImport(requester)
            work.suppliers_sheet(sheets[SUPPLIERS_SHEET])
            work.addresses_sheet(sheets[ADDRESSES_SHEET])
            work.parts_sheet(sheets[PARTS_SHEET])
            work.guess_chosen_types()
            if options["dry_run"]:
                transaction.set_rollback(True)
        self.report(work.count, path, f"member #{requester.pk} ({chosen_by})")
        if options["dry_run"]:
            self.stdout.write(self.style.WARNING("Dry run: nothing was saved."))
        else:
            self.stdout.write(self.style.SUCCESS("Import saved."))

    def report(self, count, path, requester):
        """Counts only: never a name, a contact or a remark."""

        def contacted(sheet):
            guessed = count[f"{sheet} contacted homonym"] + count[f"{sheet} contacted spelling"]
            return (
                f"  contacted by - linked to a member: {count[f'{sheet} contacted linked']}, guessed (marked to "
                f"check): {guessed}, several possible members (left empty): {count[f'{sheet} contacted several']}, "
                f"no member found (left empty): {count[f'{sheet} contacted unknown']}"
            )

        lines = [
            f"Workbook: {path.name}",
            f"Suppliers - added: {count['suppliers added']}, already in the ERP: {count['suppliers known']}, "
            f"repeated in the sheet: {count['suppliers repeated']}, without a name: {count['suppliers nameless']}",
            f"  without a name - added under a provisional name: {count['suppliers nameless named']}, left out "
            f"(nothing to name them by): {count['suppliers nameless left out']}",
            contacted("suppliers"),
            f"  contacted by, guessed - the only homonym in Operations: {count['suppliers contacted homonym']}, "
            f"written differently: {count['suppliers contacted spelling']}",
            f"  average lead time - kept: {count['lead times kept']}, not a number of days (left empty): "
            f"{count['lead times dropped']}",
            f"  not recognised (kept in the comments) - statuses: {count['supplier statuses unknown']}, types: "
            f"{count['supplier types unknown']}",
            f"Shipping addresses - added: {count['addresses added']}, already in the ERP: {count['addresses known']}, "
            f"without an address: {count['addresses without address']}",
            contacted("addresses"),
            f"Purchase requests - added: {count['parts added']}, imported before: {count['parts before']}, "
            f"rows without a part name: {count['parts nameless']}",
            f"  status - delivered: {count['status livre']}, ordered: {count['status en_commande']}, to order: "
            f"{count['status a_commander']}, cancelled: {count['status annule']}",
            f"  to order because - no known status in the sheet: {count['to order unknown status']}, ordered in the "
            f"sheet without a supplier or a price: {count['to order without an order']}",
            f"  priority - P1: {count['priority high']}, P2: {count['priority medium']}, P3: {count['priority low']}, "
            f"none: {count['priority none']}",
            "  notes from the sheet - " + ", ".join(f"{kind}: {count[f'notes {kind}']}" for kind in NOTE_KINDS),
            f'  suppliers added from "Fournisseur choisi": {count["chosen suppliers added"]} (from a web link: '
            f'{count["chosen suppliers from links"]})',
            f'  "Fournisseur choisi" taken for the sheet\'s supplier of a close name (marked to check): '
            f'{count["chosen suppliers merged"]}',
            f"  type guessed for the others (marked to check) - supplier: {count['chosen type fournisseur']}, "
            f"subcontractor: {count['chosen type sous_traitant']}, machining: {count['chosen type usinage']}",
            f"Purchase orders - added: {count['orders added']} (in DA, rate 1), total different from the sheet: "
            f"{count['orders total differs']}",
            f"Values shortened to fit the ERP's fields: {count['shortened']}",
            f"Requested by: {requester}",
        ]
        for line in lines:
            self.stdout.write(line)
