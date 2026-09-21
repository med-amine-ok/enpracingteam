from datetime import date

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.members.models import (
    Member, MemberLevel, Membership, OrgUnit, OrgUnitType, Role,
)

MAIN = MemberLevel.MAIN
JUNIOR = MemberLevel.JUNIOR


def p(key, first, last, email, phone=None, fb=None):
    """
    key   : stable identity from the database (member_id). NEVER change it.
    first : display first name. Change freely.
    last  : display last name. Change freely.
    email : real email address from the database.
    phone : phone number (or None).
    fb    : facebook profile URL (or None).
    """
    return {"key": key, "first": first, "last": last, "email": email,
            "phone": phone or "", "facebook_url": fb or ""}


def group(unit, role, level, *people):
    """unit / role are codes from seed_org_units / seed_roles. level: MAIN, JUNIOR or None."""
    return [(person, unit, role, level) for person in people]


# ---- People (key, first, last, email, phone, fb) — from ENPRT_Members_Database_2026_2027.md ----
# Using member_id as the stable key.

_ilyes_menzer         = p("ilyes-menzer", "Ilyes", "Menzer", "mohamed_ilyes.menzer@g.enp.edu.dz", "0540024003", "https://www.facebook.com/ilyes.menzer.146")
_ayoub_driouche       = p("ayoub-driouche", "Ayoub", "Driouche", "ayoub.driouche@g.enp.edu.dz", "0660449121", "https://www.facebook.com/share/15kooNqqYH/?mibextid=wwXIfr")
_besma_kada            = p("besma-kada", "Besma", "Kada", "besma.kada@g.enp.edu.dz", "0540859277", "https://www.facebook.com/besma.kada/")
_hammouda_baouchi      = p("hammouda-baouchi", "Hammouda", "Baouchi", "hammouda.baouchi@g.enp.edu.dz", "0699544870", "https://www.facebook.com/share/15Z9UTocsc/?mibextid=wwXIfr")
_anefal_choumane        = p("anefal-choumane", "Anefal", "Choumane", "anefal.choumane@g.enp.edu.dz", "0662802621", "https://www.facebook.com/anfal.aot#")
_youcef_bengoumida      = p("youcef-bengoumida", "Youcef", "Bengoumida", "youcef.bengoumida@g.enp.edu.dz", "0555268749", "https://www.facebook.com/share/18uyMbHwRc/")
_moncef_meguellati      = p("moncef-meguellati", "Moncef", "Meguellati", "moncef_abdeldjalil.meguellati@g.enp.edu.dz", "0672035624", "https://www.facebook.com/meguellati.monsef")
_ouldkhaoua_amine       = p("ouldkhaoua-mohamed-amine", "Mohamed Amine", "Ould Khaoua", "mohamed_amine.ould_khaoua@g.enp.edu.dz", "0556045393", "https://www.facebook.com/share/1HMeF56ao1/")
_aimen_hamour           = p("aimen-hocine-hamour", "Aimen Hocine", "Hamour", "aimen_hocine.hamour@g.enp.edu.dz", None, "https://www.facebook.com/profile.php?id=61550909316780&mibextid=ZbWKwL")
_zahreddine_sebaa       = p("zahreddine-sebaa", "Zahreddine", "Sebaa", "zahreddine.sebaa@g.enp.edu.dz", "0542965577", "https://www.facebook.com/profile.php?id=100095146366067")
_imane_lounis           = p("imane-lounis", "Imane", "Lounis", "imane.lounis@g.enp.edu.dz", "0563277275")
_chakib_tetbirt         = p("chakib-tetbirt", "Chakib", "Tetbirt", "chakib_abdeldjalil.tetbirt@g.enp.edu.dz", "0672998520", "https://www.facebook.com/share/1G1bnDmdJz/")
_moncef_abed            = p("abed-moncef-mourad", "Moncef Mourad", "Abed", "moncef_mourad.abed@g.enp.edu.dz", "0776904065", "https://www.facebook.com/share/1HbGNcXQEa/")
_ouarab_youcef          = p("ouarab-youcef", "Youcef", "Ouarab", "youcef.ouarab@g.enp.edu.dz", "0781466685", "https://web.facebook.com/youcef.ouarab.190732")
_boussaha_abid          = p("boussaha-abid", "Abid", "Boussaha", "abid.boussaha@g.enp.edu.dz", "0553628143", "https://www.facebook.com/share/19D7Kd1WYG/")
_ibrahim_khial          = p("ibrahim-khial", "Ibrahim", "Khial", "ibrahim.khial@g.enp.edu.dz", "0540922536", "https://www.facebook.com/brahim.mca.90475")
_yacine_zaouadi         = p("yacine-zaouadi", "Yacine", "Zaouadi", "yacine.zaouadi@g.enp.edu.dz", "0542194239", "https://www.facebook.com/yassine.zaouadi.2025")
_bendali_hani           = p("bendali-mohamed-hani", "Mohamed Hani", "Bendali", "mohamed_hani.bendali@g.enp.edu.dz", "0549643307", "https://www.facebook.com/share/1993HtmdGT/")
_abdelmadjid_medjkane   = p("abdelmadjid-medjkane", "Abdelmadjid", "Medjkane", "abdelmadjid.medjkane@g.enp.edu.dz", "0561121584", "https://web.facebook.com/madjid.medjkane.75")
_malki_yasmine          = p("malki-yasmine", "Yasmine", "Malki", "yasmine.malki@g.enp.edu.dz", "0555234058", "https://www.facebook.com/share/1DLPsyyB4z/?mibextid=wwXIfr")
_krim_insaf             = p("krim-meriem-insaf", "Meriem Insaf", "Krim", "insaf_meriem.krim@g.enp.edu.dz", "0553449691", "https://www.facebook.com/share/1JoKd34JpS/?mibextid=wwXIfr")
_yanis_sadouni          = p("yanis-sadouni", "Yanis", "Sadouni", "yanis.sadouni@g.enp.edu.dz", "0541703623", "https://www.facebook.com/share/18rFyXinLa/?mibextid=wwXIfr")
_dyna_boukhedimi        = p("dyna-sourour-boukhedimi", "Dyna Sourour", "Boukhedimi", "dyna_soroure.boukhedimi@g.enp.edu.dz", "0554660784")
_anis_boukhedimi        = p("anis-abdeldjalil-boukhedimi", "Anis Abdeldjalil", "Boukhedimi", "anis_abdeldjalil.boukhedimi@g.enp.edu.dz", "0562799983", "https://www.facebook.com/share/19bkyaKRoX/")
_boulebghal_youcef      = p("boulebghal-youcef", "Youcef", "Boulebghal", "youcef.boulbeghal@g.enp.edu.dz", "0792054563", "https://www.facebook.com/fouufouuuu")
_dekhouche_allawa       = p("dekhouche-allawa", "Allawa", "Dekhouche", "allawa.dakhouche@g.enp.edu.dz", "0675737394", "https://www.facebook.com/profile.php?id=100068929428661")
_nasri_yacine           = p("nasri-yacine", "Yacine", "Nasri", "mounir_yacine.nasri@g.enp.edu.dz", "0540310678")
_guermah_mehdi          = p("guermah-mehdi", "Mehdi", "Guermah", "mahdi.guermah@g.enp.edu.dz", "0795897437", "https://www.facebook.com/profile.php?id=100005227758372&mibextid=ZbWKwL")
_bouafia_kawther        = p("bouafia-kawther", "Kawther", "Bouafia", "kaoutar_yousra.bouafia@g.enp.edu.dz", "0666966131", "https://m.me/61563890367651?hash=Abab4g9vEcQgPjYD&source=qr_link_share")
_reziouak_moad          = p("reziouak-moad", "Moad", "Reziouak", "moad.reziouak@g.enp.edu.dz", "0663667827", "https://www.facebook.com/share/1APXv1H9gg/")
_othmani_mohamed        = p("othmani-mohamed", "Mohamed", "Othmani", "mohamed.otmani@g.enp.edu.dz", "0793907342", "https://www.facebook.com/mohamed.otm.943393")
_djouadi_asma           = p("djouadi-asma", "Asma", "Djouadi", "asma.djouadi@g.enp.edu.dz", "0541802458", "https://www.facebook.com/share/19QzANzDbF/")
_zitoune_yacine         = p("zitoune-yacine", "Yacine", "Zitoune", "ahmed_yacine.zitoune@g.enp.edu.dz", "0656402213", "https://www.facebook.com/share/1923TsGyGF/?mibextid=qi2Omg")
_moulay_mohamed         = p("moulay-mohamed-elt", "Mohamed Elt", "Moulay", "mohamed_el_touhami_abdeldjallil.moulay@g.enp.edu.dz", "0542368999", "https://www.facebook.com/profile.php?id=100013515699409")
_gherzi_akram           = p("gherzi-akram", "Akram", "Gherzi", "akrem.gherzi@g.enp.edu.dz", "0671132380", "https://www.facebook.com/profile.php?id=100008755560527")
_chaib_bessou_khaoula   = p("chaib-bessou-khaoula", "Khaoula", "Chaib Bessou", "khaoula.chaib_bessou@g.enp.edu.dz", "0658022655", "https://www.facebook.com/share/1EnSJFxaXz/")
_amrane_hiba            = p("amrane-hiba-ibtissem", "Hiba Ibtissem", "Amrane", "hiba_ibtissem.amrane@g.enp.edu.dz", "0657333014", "https://www.facebook.com/ibtissem.amrane?locale=fr_FR")
_amalou_idris           = p("amalou-mohamed-idris", "Mohamed Idris", "Amalou", "mohamed_idris.amalou@g.enp.edu.dz", "0776481554")
_al_hamarsheh_chaima    = p("al-hamarsheh-chaima", "Chaima", "Al Hamarsheh", "chaima.al_hamarsheh@g.enp.edu.dz", "0796518586", "https://www.facebook.com/share/1DL2RxcB7m/?mibextid=wwXIfr")
_bouhechiche_anas       = p("bouhechiche-anas-abderrahim", "Anas Abderrahim", "Bouhechiche", "anas_abderrahim.bouhechiche@g.enp.edu.dz", "0673545166", "https://www.facebook.com/share/1FAXFrvYCq/")
_ayoub_serir            = p("ayoub-serir", "Ayoub", "Serir", "ayoub.serir@g.enp.edu.dz", "0791297558", "https://www.facebook.com/share/18fKKM1cHN/")
_abdelmadjid_ouldali    = p("abdelmadjid-ouldali", "Abdelmadjid", "Ouldali", "abdelmadjid.ouldali@g.enp.edu.dz", None, "https://www.facebook.com/share/1ByovfJsAf/")
_arfi_maya              = p("arfi-maya", "Maya", "Arfi", "maya.arfi@g.enp.edu.dz", "0540648845")
_hadji_akram            = p("hadji-akram-rami", "Akram Rami", "Hadji", "akram_rami.hadji@g.enp.edu.dz", "0655901452", "https://www.facebook.com/profile.php?id=61565971381137&mibextid=ZbWKwL")
_lamia_beddek           = p("lamia-beddek", "Lamia", "Beddek", "lamia.beddek@g.enp.edu.dz", "0666217120", "https://www.facebook.com/profile.php?id=61551967168123&mibextid=ZbWKwL")
_abbas_issam            = p("abbas-mohamed-issam", "Mohamed Issam", "Abbas", "mohamed_issam.abbas@g.enp.edu.dz", "0797541252", "https://www.facebook.com/share/19AesBgmm2/?mibextid=wwXIfr")
_hadjout_yacine         = p("hadjout-yacine", "Yacine", "Hadjout", "yacine.hadjout@g.enp.edu.dz", "0796804353", "https://www.facebook.com/share/1LtH4nHWyq/?mibextid=wwXIfr")
_matallah_sohaib        = p("matallah-sohaib", "Sohaib", "Matallah", "sohaib.matallah@g.enp.edu.dz", "0696018442", "https://www.facebook.com/sohaib.matallah")
_dekali_yacine          = p("dekali-yacine", "Yacine", "Dekali", "yacine.dekali@g.enp.edu.dz", "0555319295", "https://web.facebook.com/Sissinho")
_khaouni_youcef         = p("khaouni-youcef-nadjib", "Youcef Nadjib", "Khaouni", "youcef_nadjib.khaouni@g.enp.edu.dz", "0697798746", "https://www.facebook.com/youcef.khaouni.2025")
_mouassa_sara           = p("mouassa-sara-cerine", "Sara Cerine", "Mouassa", "sara_cerine.mouassa@g.enp.edu.dz", "0557198413", "https://www.facebook.com/share/19N5v4nvWk/?mibextid=wwXIfr")
_didani_ismail          = p("didani-ismail", "Ismail", "Didani", "ismail.didani@g.enp.edu.dz", "0542629311", "https://www.facebook.com/share/1D3mCdDgex/?mibextid=wwXIfr")
_benchohrani_rayane     = p("benchohrani-mohammed-rayane", "Mohammed Rayane", "Benchohrani", "mohammed_rayane.benchohrani@g.enp.edu.dz", "0553814395", "https://www.facebook.com/Moe.Ryan26")
_hiba_benkhaled         = p("hiba-benkhaled", "Hiba", "Benkhaled", "hiba.benkhaled@g.enp.edu.dz", "0666402200", "https://www.facebook.com/share/1GHLKBH42n/")
_abderrahmene_khelifi   = p("abderrahmene-khelifi", "Abderrahmene", "Khelifi", "abderrahmene.khelifi@g.enp.edu.dz", "0773998090", "https://www.facebook.com/yasser.dride.3386/")
_bekhouche_manel        = p("bekhouche-manel", "Manel", "Bekhouche", "manel.bekhouche@g.enp.edu.dz", "0779260841", "https://www.facebook.com/share/19YNpqDWG1/?mibextid=wwXIfr")
_ouadah_fethallah       = p("ouadah-feth-allah", "Feth Allah", "Ouadah", "feth_allah.ouadah@g.enp.edu.dz", "0558147825", "https://www.facebook.com/share/18FEmV3DPa/")
_yanir_louni            = p("yanir-iskandar-louni", "Yanir Iskandar", "Louni", "yanir_iskandar.louni@g.enp.edu.dz", "0781563992", "https://www.facebook.com/yanir.louni.3/")
_walid_mahmoudi         = p("walid-mahmoudi", "Walid", "Mahmoudi", "walid.mahmoudi@g.enp.edu.dz", "0557332628")
_bouabdallah_halim      = p("bouabdallah-abdelhalim", "Abdelhalim", "Bouabdallah", "abdelhalim.bouabdallah@g.enp.edu.dz", "0795468858", "https://www.facebook.com/share/1cRmDLEgPj/")
_rayane_chouache        = p("rayane-chouache", "Rayane", "Chouache", "rayane.chouache@g.enp.edu.dz", "0559417352", "https://www.facebook.com/rayen.ch.861547")
_deghnouche_abdessad    = p("abdessad-deghnouche", "Abdessamad", "Deghnouche", "abdessamad.deghnouche@g.enp.edu.dz", "0658062789", "https://www.facebook.com/share/1VvDE9JEzQ/")
_bechim_abderraouf      = p("bechim-abderraouf", "Abderraouf", "Bechim", "abderraouf.bechim@g.enp.edu.dz", "0557102058")
_bennouar_amine         = p("mohamed-amine-bennouar", "Mohamed Amine", "Bennouar", "mohamed_amine.bennouar@g.enp.edu.dz", "0562837047", "https://www.facebook.com/share/1EJpuBAhWP/")
_lamis_hachemi          = p("lamis-hachemi", "Lamis", "Hachemi", "lamis.hachemi@g.enp.edu.dz", "0698333853", "https://www.facebook.com/profile.php?id=61564221322602&mibextid=ZbWKwL")
_amara_sarah_lyna       = p("amara-sarah-lyna", "Sarah Lyna", "Amara", "sarah_lyna.amara@g.enp.edu.dz", "0770409832", "https://www.facebook.com/share/1UxfV4xt6N/")
_benadir_ayoub          = p("bennadir-saber-ayoub", "Saber Ayoub", "Bennadir", "saber_ayoub.bennadir@g.enp.edu.dz", "0549167113", "https://www.facebook.com/share/19SSbZgrfD/")
_azzam_amir             = p("azzam-amir", "Amir", "Azzam", "amir.azzam@g.enp.edu.dz", "0541382534", "https://www.facebook.com/amirakram.akram.96?mibextid=wwXIfr&mibextid=wwXIfr")
_amrouche_islam         = p("amrouche-mohamed-islam", "Mohamed Islam", "Amrouche", "mohamed_islam.amrouche@g.enp.edu.dz", "0780544411", "https://www.facebook.com/share/19GuUKcA4p/?mibextid=wwXIfr")
_chikhar_hani           = p("chikhar-hani-sofiane", "Hani Sofiane", "Chikhar", "hani_sofiane.chikhar@g.enp.edu.dz", "0540939195", "https://facebook.com/hani.chikhar")


# ------------------------------------------------------------------
# A person's PRIMARY membership is their first listed row that is NOT in a governing
# body (Board / Executive Bureau). Leadership roles have no level (None).
# Executive Bureau membership is NOT automatic: list people in the bureau group below.
# ------------------------------------------------------------------
MEMBERSHIPS = [
    # ================ Board of Directors ================
    *group("board", "board-member", None,
           _ilyes_menzer, _ayoub_driouche, _besma_kada,
           _hammouda_baouchi, _anefal_choumane, _youcef_bengoumida),
    
    # ================ Executive Bureau ================
    *group("executive-bureau", "executive-bureau-member", None,
           # board members who sit on the bureau
           _youcef_bengoumida, _anefal_choumane, _besma_kada, _hammouda_baouchi, _ilyes_menzer, _ayoub_driouche,
           # club department heads
           _moncef_meguellati, _ouldkhaoua_amine,
           # Formula Student team leadership
           _aimen_hamour, _zahreddine_sebaa, _imane_lounis,
           # Formula Student department leads
           _chakib_tetbirt, _moncef_abed, _ouarab_youcef,
           _boussaha_abid, _ibrahim_khial),

    # ================ Club Departments ================

    # --- Project Department ---
    *group("dept-projet", "project-manager", None, _youcef_bengoumida),

    # --- Training & Industry ---
    *group("dept-training-industry", "training-industry-lead", None, _anefal_choumane),
    *group("dept-training-industry", "training-coordinator", MAIN, _yacine_zaouadi),

    # --- Media & Scientific Journalism ---
    *group("dept-media", "lead-journalist", None, _besma_kada),
    *group("dept-media", "head-of-production", None, _moncef_meguellati),
    *group("dept-media", "producer", MAIN, _bendali_hani, _abdelmadjid_medjkane),

    # --- Information Systems ---
    *group("dept-information-systems", "information-systems-lead", None, _ouldkhaoua_amine),
    *group("dept-information-systems", "developer", MAIN,
           _malki_yasmine, _krim_insaf, _yanis_sadouni, _dyna_boukhedimi),
    *group("dept-information-systems", "club-member", JUNIOR, _anis_boukhedimi),

    # --- Business Projects ---
    *group("dept-business-projects", "business-projects-member", None,
           _boulebghal_youcef, _dekhouche_allawa, _nasri_yacine, _guermah_mehdi,
           _bouafia_kawther, _reziouak_moad, _othmani_mohamed, _djouadi_asma,
           _zitoune_yacine, _moulay_mohamed, _gherzi_akram),

    # --- Operations & Partnerships ---
    *group("dept-operations", "operations-lead", None, _hammouda_baouchi),
    *group("dept-operations", "logistics-coordinator", MAIN,
           _chaib_bessou_khaoula, _amrane_hiba, _amalou_idris),
    *group("dept-operations", "club-member", JUNIOR,
           _al_hamarsheh_chaima, _bouhechiche_anas, _ayoub_serir),

    # ================ Formula Student Team ================

    # --- Team-level leadership ---
    *group("fs-team", "team-lead", None, _youcef_bengoumida),
    *group("fs-team", "chief-engineer", None, _aimen_hamour),
    *group("fs-team", "manufacturing-workshop-lead", None, _zahreddine_sebaa),
    *group("fs-team", "team-manager", None, _imane_lounis),

    # --- Suspension & Steering ---
    *group("fs-suspension-steering", "suspension-steering-lead-engineer", None, _chakib_tetbirt),
    *group("fs-suspension-steering", "suspension-steering-engineer", MAIN,
           _abdelmadjid_ouldali, _arfi_maya, _hadji_akram),
    *group("fs-suspension-steering", "fs-member", JUNIOR, _lamia_beddek),

    # --- Chassis & Ergonomics ---
    *group("fs-chassis-ergonomics", "chassis-ergonomics-lead-engineer", None, _moncef_abed),
    *group("fs-chassis-ergonomics", "chassis-ergonomics-engineer", MAIN,
           _abbas_issam, _hadjout_yacine),
    *group("fs-chassis-ergonomics", "fs-member", JUNIOR, _matallah_sohaib),

    # --- Powertrain ---
    *group("fs-powertrain", "powertrain-lead-engineer", None, _ouarab_youcef),
    *group("fs-powertrain", "powertrain-engineer", MAIN,
           _dekali_yacine, _khaouni_youcef, _mouassa_sara,
           _didani_ismail, _benchohrani_rayane),
    *group("fs-powertrain", "fs-member", JUNIOR, _hiba_benkhaled),

    # --- Aerodynamics ---
    *group("fs-aerodynamics", "aerodynamics-lead-engineer", None, _boussaha_abid),
    *group("fs-aerodynamics", "aerodynamics-engineer", MAIN,
           _abderrahmene_khelifi, _bekhouche_manel),
    *group("fs-aerodynamics", "fs-member", JUNIOR, _ouadah_fethallah),

    # --- Electronics ---
    *group("fs-electronics", "electronics-lead-engineer", None, _ibrahim_khial),
    *group("fs-electronics", "electronics-engineer", MAIN,
           _yanir_louni, _walid_mahmoudi, _bouabdallah_halim,
           _rayane_chouache, _deghnouche_abdessad,
           _bechim_abderraouf, _bennouar_amine, _lamis_hachemi,
           _amara_sarah_lyna),
    *group("fs-electronics", "fs-member", JUNIOR,
           _benadir_ayoub, _azzam_amir, _amrouche_islam, _chikhar_hani),
]


class Command(BaseCommand):
    help = "Sync members and their memberships with the MEMBERSHIPS list (safe to re-run)."

    @transaction.atomic
    def handle(self, *args, **options):
        units = {u.code: u for u in OrgUnit.objects.filter(code__isnull=False)}
        roles = {r.code: r for r in Role.objects.filter(code__isnull=False)}

        people, wanted = self._collect(units, roles)

        for key, person in people.items():
            member = self._sync_member(person)
            self._sync_memberships(member, wanted[key], units, roles)

        stale = Member.objects.filter(code__isnull=False).exclude(code__in=list(people))
        if stale.exists():
            names = ", ".join(str(m) for m in stale)
            self.stdout.write(self.style.WARNING(
                f"  no longer in the list (left untouched, deactivate them in /admin/): {names}"
            ))

        active = Membership.objects.filter(end_date__isnull=True).count()
        self.stdout.write(self.style.SUCCESS(
            f"Done. {len(people)} members in the list, {active} active memberships."
        ))

    def _collect(self, units, roles):
        missing = set()
        people, wanted, emails = {}, {}, {}
        for person, unit, role, _level in MEMBERSHIPS:
            if unit not in units:
                missing.add(f"org unit '{unit}'")
            if role not in roles:
                missing.add(f"role '{role}'")
            key = person["key"]
            if key in people and people[key] != person:
                raise CommandError(f"'{key}' is defined twice with different details.")
            if emails.setdefault(person["email"], key) != key:
                raise CommandError(f"Email {person['email']} is used by two different people.")
            people[key] = person
            rows = wanted.setdefault(key, [])
            if any(r[0] == unit and r[1] == role for r in rows):
                raise CommandError(f"{key}: duplicate row {unit} / {role}.")
            rows.append((unit, role, _level))
        if missing:
            raise CommandError(
                "Not found (run seed_org_units and seed_roles first): " + ", ".join(sorted(missing))
            )
        return people, wanted

    def _sync_member(self, person):
        member = Member.objects.filter(code=person["key"]).first()
        if member is None:  # first run: adopt an existing member with this email
            member = Member.objects.filter(
                code__isnull=True, email__iexact=person["email"]
            ).first()

        if member is None:
            member = Member.objects.create_user(
                email=person["email"], password=None,  # unusable password
                first_name=person["first"], last_name=person["last"], code=person["key"],
                phone=person["phone"], facebook_url=person["facebook_url"],
            )
            self.stdout.write(f"  created member: {member}")
            return member

        desired = {"code": person["key"], "email": person["email"],
                   "first_name": person["first"], "last_name": person["last"],
                   "phone": person["phone"], "facebook_url": person["facebook_url"]}
        changed = [f for f, v in desired.items() if getattr(member, f) != v]
        if changed:
            for f in changed:
                setattr(member, f, desired[f])
            member.save()
            self.stdout.write(f"  updated member: {member} ({', '.join(changed)})")
        return member

    def _sync_memberships(self, member, rows, units, roles):
        wanted = [(units[u], roles[r], level) for u, r, level in rows]

        # Governing-body rows (Board, Executive Bureau) go last, so they are never
        # primary. The sort is stable, so every other row keeps its order in MEMBERSHIPS.
        wanted.sort(key=lambda w: w[0].type == OrgUnitType.GOVERNING_BODY)

        active = {
            (m.org_unit_id, m.role_id): m
            for m in member.memberships.filter(end_date__isnull=True)
        }
        wanted_keys = {(u.id, r.id) for u, r, _ in wanted}

        # Memberships that are no longer in the list end today (history is kept).
        for key, m in active.items():
            if key not in wanted_keys:
                m.end_date = date.today()
                m.is_primary = False
                m.save()
                self.stdout.write(f"  ended: {m}")

        # Non-primary rows first, so a primary that moves is freed before the new one is set.
        for index in [*range(1, len(wanted)), 0]:
            unit, role, level = wanted[index]
            self._upsert(member, unit, role, level, index == 0, active)

    def _upsert(self, member, unit, role, level, primary, active):
        m = active.get((unit.id, role.id))
        if m is None:
            Membership.objects.create(
                member=member, org_unit=unit, role=role,
                member_level=level, is_primary=primary,
            )
            self.stdout.write(f"  created: {member} - {role.name} @ {unit.name}")
            return
        changed = []
        if m.member_level != level:
            m.member_level = level
            changed.append("member_level")
        if m.is_primary != primary:
            m.is_primary = primary
            changed.append("is_primary")
        if changed:
            m.save()
            self.stdout.write(f"  updated: {m} ({', '.join(changed)})")