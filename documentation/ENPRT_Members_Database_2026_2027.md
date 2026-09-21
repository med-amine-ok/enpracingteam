# ENP Racing Team — Members Database 2026–2027

Relational-style markdown database. Tables are linked by IDs: `assignments.member_id → members`, `assignments.unit_id → units`, `assignments.role_id → roles`.

**Totals:** 70 members · 89 assignments · 15 units · 32 roles

**Sources:** `ENPRT_DATABASE_2026_2027.xlsx` (personal info) and the org chart (units, roles, levels, sub-teams, executive-bureau flags).

---

## 1. `units`

| unit_id                    | Name                                     | Type    | Parent            | Aliases                                                          | Assignments |
| -------------------------- | ---------------------------------------- | ------- | ----------------- | ---------------------------------------------------------------- | ----------- |
| `enp-racing-team`          | ENP Racing Team                          | ROOT    | —                 | —                                                                | 0           |
| `board`                    | Board of Directors                       | GOV     | `enp-racing-team` | Conseil d'Administration                                         | 6           |
| `executive-bureau`         | Executive Bureau                         | GOV     | `enp-racing-team` | Bureau Exécutif                                                  | 14          |
| `dept-projet`              | Project Department                       | DEPT    | `enp-racing-team` | Département Projet                                               | 1           |
| `dept-training-industry`   | Training & Industry Department           | DEPT    | `enp-racing-team` | Département Formation & Industrie                                | 2           |
| `dept-media`               | Media & Scientific Journalism Department | DEPT    | `enp-racing-team` | Département Médias & Journalisme Scientifique                    | 4           |
| `dept-information-systems` | Information Systems Department           | DEPT    | `enp-racing-team` | Département Systèmes d'Information                               | 6           |
| `dept-business-projects`   | Business Projects Department             | DEPT    | `enp-racing-team` | Département Business Projects; Département Business & Innovation | 11          |
| `dept-operations`          | Operations & Partnerships Department     | DEPT    | `enp-racing-team` | Département Opérations & Partenariats                            | 7           |
| `fs-team`                  | Formula Student Team                     | FS_TEAM | `dept-projet`     | —                                                                | 4           |
| `fs-suspension-steering`   | Suspension & Steering                    | FS_DEPT | `fs-team`         | —                                                                | 5           |
| `fs-chassis-ergonomics`    | Chassis & Ergonomics                     | FS_DEPT | `fs-team`         | —                                                                | 4           |
| `fs-powertrain`            | Powertrain                               | FS_DEPT | `fs-team`         | —                                                                | 7           |
| `fs-aerodynamics`          | Aerodynamics                             | FS_DEPT | `fs-team`         | —                                                                | 4           |
| `fs-electronics`           | Electronics                              | FS_DEPT | `fs-team`         | —                                                                | 14          |

## 2. `roles`

| role_id                             | Title                               | Scope | Tier   | Leadership | PM  | Aliases                  | Assigned |
| ----------------------------------- | ----------------------------------- | ----- | ------ | ---------- | --- | ------------------------ | -------- |
| `board-member`                      | Board Member                        | CLUB  | ADMIN  | ✓          |     | —                        | 6        |
| `executive-bureau-member`           | Executive Bureau Member             | CLUB  | ADMIN  | ✓          |     | —                        | 14       |
| `project-manager`                   | Project Manager                     | CLUB  | HEAD   | ✓          | ✓   | —                        | 1        |
| `business-projects-lead`            | Business Projects Lead              | CLUB  | HEAD   | ✓          |     | —                        | 0        |
| `information-systems-lead`          | Information Systems Lead            | CLUB  | HEAD   | ✓          |     | —                        | 1        |
| `training-industry-lead`            | Training & Industry Lead            | CLUB  | HEAD   | ✓          |     | —                        | 1        |
| `operations-lead`                   | Operations Lead                     | CLUB  | HEAD   | ✓          |     | —                        | 1        |
| `lead-journalist`                   | Lead Journalist                     | CLUB  | HEAD   | ✓          |     | —                        | 1        |
| `head-of-production`                | Head of Production                  | CLUB  | HEAD   | ✓          |     | —                        | 1        |
| `club-head`                         | Head                                | CLUB  | HEAD   | ✓          |     | —                        | 0        |
| `training-coordinator`              | Training Coordinator                | CLUB  | MEMBER |            |     | Coordinator              | 1        |
| `producer`                          | Producer                            | CLUB  | MEMBER |            |     | —                        | 2        |
| `developer`                         | Developer                           | CLUB  | MEMBER |            |     | ERP Developer            | 4        |
| `logistics-coordinator`             | Logistics Coordinator               | CLUB  | MEMBER |            |     | —                        | 3        |
| `business-projects-member`          | Business Projects Member            | CLUB  | MEMBER |            |     | Buisness projects Member | 11       |
| `club-member`                       | Member                              | CLUB  | MEMBER |            |     | —                        | 4        |
| `team-lead`                         | Team Lead                           | FS    | ADMIN  | ✓          |     | —                        | 1        |
| `chief-engineer`                    | Chief Engineer                      | FS    | ADMIN  | ✓          |     | —                        | 1        |
| `manufacturing-workshop-lead`       | Manufacturing & Workshop Lead       | FS    | ADMIN  | ✓          |     | —                        | 1        |
| `team-manager`                      | Team Manager                        | FS    | ADMIN  | ✓          |     | —                        | 1        |
| `fs-lead`                           | Lead                                | FS    | HEAD   | ✓          |     | —                        | 0        |
| `suspension-steering-lead-engineer` | Suspension & Steering Lead Engineer | FS    | HEAD   | ✓          |     | —                        | 1        |
| `chassis-ergonomics-lead-engineer`  | Chassis & Ergonomics Lead Engineer  | FS    | HEAD   | ✓          |     | —                        | 1        |
| `powertrain-lead-engineer`          | Powertrain Lead Engineer            | FS    | HEAD   | ✓          |     | —                        | 1        |
| `aerodynamics-lead-engineer`        | Aerodynamics Lead Engineer          | FS    | HEAD   | ✓          |     | —                        | 1        |
| `electronics-lead-engineer`         | Electronics Lead Engineer           | FS    | HEAD   | ✓          |     | —                        | 1        |
| `fs-member`                         | Member                              | FS    | MEMBER |            |     | —                        | 8        |
| `suspension-steering-engineer`      | Suspension & Steering Engineer      | FS    | MEMBER |            |     | —                        | 3        |
| `chassis-ergonomics-engineer`       | Chassis & Ergonomics Engineer       | FS    | MEMBER |            |     | —                        | 2        |
| `powertrain-engineer`               | Powertrain Engineer                 | FS    | MEMBER |            |     | —                        | 5        |
| `aerodynamics-engineer`             | Aerodynamics Engineer               | FS    | MEMBER |            |     | —                        | 2        |
| `electronics-engineer`              | Electronics Engineer                | FS    | MEMBER |            |     | —                        | 9        |

## 3. `members`

_Field = field of study as written in the sheet. "Also known as" = the spelling used in the org chart when it differs from the sheet._

| member_id                     | Full Name                   | Also known as             | Field       | Email                                               | Phone      | Facebook                                                                               |
| ----------------------------- | --------------------------- | ------------------------- | ----------- | --------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| `ilyes-menzer`                | Ilyes Menzer                | —                         | Automobile  | mohamed_ilyes.menzer@g.enp.edu.dz                   | 0540024003 | [Profile](https://www.facebook.com/ilyes.menzer.146)                                   |
| `ayoub-driouche`              | Ayoub Driouche              | —                         | GM          | ayoub.driouche@g.enp.edu.dz                         | 0660449121 | [Profile](https://www.facebook.com/share/15kooNqqYH/?mibextid=wwXIfr)                  |
| `besma-kada`                  | Besma Kada                  | —                         | Automobile  | besma.kada@g.enp.edu.dz                             | 0540859277 | [Profile](https://www.facebook.com/besma.kada/)                                        |
| `hammouda-baouchi`            | Hammouda Baouchi            | —                         | INDUS       | hammouda.baouchi@g.enp.edu.dz                       | 0699544870 | [Profile](https://www.facebook.com/share/15Z9UTocsc/?mibextid=wwXIfr)                  |
| `anefal-choumane`             | Anefal Choumane             | —                         | GM          | anefal.choumane@g.enp.edu.dz                        | 0662802621 | [Profile](https://www.facebook.com/anfal.aot#)                                         |
| `youcef-bengoumida`           | Youcef Bengoumida           | —                         | GM          | youcef.bengoumida@g.enp.edu.dz                      | 0555268749 | [Profile](https://www.facebook.com/share/18uyMbHwRc/)                                  |
| `moncef-meguellati`           | Moncef Meguellati           | —                         | Automobile  | moncef_abdeldjalil.meguellati@g.enp.edu.dz          | 0672035624 | [Profile](https://www.facebook.com/meguellati.monsef)                                  |
| `ouldkhaoua-mohamed-amine`    | Ouldkhaoua Mohamed Amine    | Mohamed Amine Ould Khaoua | DATA        | mohamed_amine.ould_khaoua@g.enp.edu.dz              | 0556045393 | [Profile](https://www.facebook.com/share/1HMeF56ao1/)                                  |
| `aimen-hocine-hamour`         | Aimen Hocine Hamour         | Hamour Aimen              | GM          | aimen_hocine.hamour@g.enp.edu.dz                    | —          | [Profile](https://www.facebook.com/profile.php?id=61550909316780&mibextid=ZbWKwL)      |
| `zahreddine-sebaa`            | Zahreddine Sebaa            | Sebaa Zahreddin           | G Minier    | zahreddine.sebaa@g.enp.edu.dz                       | 0542965577 | [Profile](https://www.facebook.com/profile.php?id=100095146366067)                     |
| `imane-lounis`                | Imane Lounis                | —                         | GM          | imane.lounis@g.enp.edu.dz                           | 0563277275 | —                                                                                      |
| `chakib-tetbirt`              | Chakib Tetbirt              | —                         | GM          | chakib_abdeldjalil.tetbirt@g.enp.edu.dz             | 0672998520 | [Profile](https://www.facebook.com/share/1G1bnDmdJz/)                                  |
| `abed-moncef-mourad`          | Abed Moncef Mourad          | Moncef Abed               | Automobile  | moncef_mourad.abed@g.enp.edu.dz                     | 0776904065 | [Profile](https://www.facebook.com/share/1HbGNcXQEa/)                                  |
| `ouarab-youcef`               | Ouarab Youcef               | —                         | GM          | youcef.ouarab@g.enp.edu.dz                          | 0781466685 | [Profile](https://web.facebook.com/youcef.ouarab.190732)                               |
| `boussaha-abid`               | Boussaha Abid               | —                         | GM          | abid.boussaha@g.enp.edu.dz                          | 0553628143 | [Profile](https://www.facebook.com/share/19D7Kd1WYG/)                                  |
| `ibrahim-khial`               | Ibrahim Khial               | Brahim Khial              | Automatique | ibrahim.khial@g.enp.edu.dz                          | 0540922536 | [Profile](https://www.facebook.com/brahim.mca.90475)                                   |
| `yacine-zaouadi`              | Yacine Zaouadi              | —                         | Automatique | yacine.zaouadi@g.enp.edu.dz                         | 0542194239 | [Profile](https://www.facebook.com/yassine.zaouadi.2025)                               |
| `bendali-mohamed-hani`        | Bendali Mohamed Hani        | —                         | G Minier    | mohamed_hani.bendali@g.enp.edu.dz                   | 0549643307 | [Profile](https://www.facebook.com/share/1993HtmdGT/)                                  |
| `abdelmadjid-medjkane`        | Abdelmadjid Medjkane        | —                         | G Minier    | abdelmadjid.medjkane@g.enp.edu.dz                   | 0561121584 | [Profile](https://web.facebook.com/madjid.medjkane.75)                                 |
| `malki-yasmine`               | Malki Yasmine               | —                         | DATA        | yasmine.malki@g.enp.edu.dz                          | 0555234058 | [Profile](https://www.facebook.com/share/1DLPsyyB4z/?mibextid=wwXIfr)                  |
| `krim-meriem-insaf`           | Krim Meriem Insaf           | —                         | DATA        | insaf_meriem.krim@g.enp.edu.dz                      | 0553449691 | [Profile](https://www.facebook.com/share/1JoKd34JpS/?mibextid=wwXIfr)                  |
| `yanis-sadouni`               | Yanis Sadouni               | —                         | DATA        | yanis.sadouni@g.enp.edu.dz                          | 0541703623 | [Profile](https://www.facebook.com/share/18rFyXinLa/?mibextid=wwXIfr)                  |
| `dyna-sourour-boukhedimi`     | Dyna Sourour Boukhedimi     | Dyna Soroure Boukhedimi   | DATA        | dyna_soroure.boukhedimi@g.enp.edu.dz                | 0554660784 | —                                                                                      |
| `anis-abdeldjalil-boukhedimi` | Anis Abdeldjalil Boukhedimi | —                         | DATA        | anis_abdeldjalil.boukhedimi@g.enp.edu.dz            | 0562799983 | [Profile](https://www.facebook.com/share/19bkyaKRoX/)                                  |
| `boulebghal-youcef`           | Boulebghal Youcef           | —                         | Automobile  | youcef.boulbeghal@g.enp.edu.dz                      | 0792054563 | [Profile](https://www.facebook.com/fouufouuuu)                                         |
| `dekhouche-allawa`            | Dekhouche Allawa            | —                         | Automobile  | allawa.dakhouche@g.enp.edu.dz                       | 0675737394 | [Profile](https://www.facebook.com/profile.php?id=100068929428661)                     |
| `nasri-yacine`                | Nasri Yacine                | —                         | GM          | mounir_yacine.nasri@g.enp.edu.dz                    | 0540310678 | —                                                                                      |
| `guermah-mehdi`               | Guermah Mehdi               | —                         | GM          | mahdi.guermah@g.enp.edu.dz                          | 0795897437 | [Profile](https://www.facebook.com/profile.php?id=100005227758372&mibextid=ZbWKwL)     |
| `bouafia-kawther`             | Bouafia Kawther             | —                         | GM          | kaoutar_yousra.bouafia@g.enp.edu.dz                 | 0666966131 | [Profile](https://m.me/61563890367651?hash=Abab4g9vEcQgPjYD&source=qr_link_share)      |
| `reziouak-moad`               | Reziouak Moad               | —                         | Automobile  | moad.reziouak@g.enp.edu.dz                          | 0663667827 | [Profile](https://www.facebook.com/share/1APXv1H9gg/)                                  |
| `othmani-mohamed`             | Othmani Mohamed             | —                         | Automobile  | mohamed.otmani@g.enp.edu.dz                         | 0793907342 | [Profile](https://www.facebook.com/mohamed.otm.943393)                                 |
| `djouadi-asma`                | Djouadi Asma                | —                         | QHSE        | asma.djouadi@g.enp.edu.dz                           | 0541802458 | [Profile](https://www.facebook.com/share/19QzANzDbF/)                                  |
| `zitoune-yacine`              | Zitoune Yacine              | —                         | HYDRAU      | ahmed_yacine.zitoune@g.enp.edu.dz                   | 0656402213 | [Profile](https://www.facebook.com/share/1923TsGyGF/?mibextid=qi2Omg)                  |
| `moulay-mohamed-elt`          | Moulay Mohamed Elt          | —                         | HYDRAU      | mohamed_el_touhami_abdeldjallil.moulay@g.enp.edu.dz | 0542368999 | [Profile](https://www.facebook.com/profile.php?id=100013515699409)                     |
| `gherzi-akram`                | Gherzi Akram                | —                         | Automobile  | akrem.gherzi@g.enp.edu.dz                           | 0671132380 | [Profile](https://www.facebook.com/profile.php?id=100008755560527)                     |
| `chaib-bessou-khaoula`        | Chaib Bessou Khaoula        | —                         | G civil     | khaoula.chaib_bessou@g.enp.edu.dz                   | 0658022655 | [Profile](https://www.facebook.com/share/1EnSJFxaXz/)                                  |
| `amrane-hiba-ibtissem`        | Amrane Hiba Ibtissem        | —                         | G Minier    | hiba_ibtissem.amrane@g.enp.edu.dz                   | 0657333014 | [Profile](https://www.facebook.com/ibtissem.amrane?locale=fr_FR)                       |
| `amalou-mohamed-idris`        | Amalou Mohamed Idris        | —                         | G civil     | mohamed_idris.amalou@g.enp.edu.dz                   | 0776481554 | Amalou Mohamed Idris                                                                   |
| `al-hamarsheh-chaima`         | Al Hamarsheh Chaima         | —                         | GM          | chaima.al_hamarsheh@g.enp.edu.dz                    | 0796518586 | [Profile](https://www.facebook.com/share/1DL2RxcB7m/?mibextid=wwXIfr)                  |
| `bouhechiche-anas-abderrahim` | Bouhechiche Anas Abderrahim | —                         | Automobile  | anas_abderrahim.bouhechiche@g.enp.edu.dz            | 0673545166 | [Profile](https://www.facebook.com/share/1FAXFrvYCq/)                                  |
| `ayoub-serir`                 | Ayoub Serir                 | —                         | Automobile  | ayoub.serir@g.enp.edu.dz                            | 0791297558 | [Profile](https://www.facebook.com/share/18fKKM1cHN/)                                  |
| `abdelmadjid-ouldali`         | Abdelmadjid Ouldali         | —                         | GM          | abdelmadjid.ouldali@g.enp.edu.dz                    | —          | [Profile](https://www.facebook.com/share/1ByovfJsAf/)                                  |
| `arfi-maya`                   | Arfi Maya                   | —                         | GM          | maya.arfi@g.enp.edu.dz                              | 0540648845 | —                                                                                      |
| `hadji-akram-rami`            | Hadji Akram Rami            | —                         | GM          | akram_rami.hadji@g.enp.edu.dz                       | 0655901452 | [Profile](https://www.facebook.com/profile.php?id=61565971381137&mibextid=ZbWKwL)      |
| `lamia-beddek`                | Lamia Beddek                | —                         | GM          | lamia.beddek@g.enp.edu.dz                           | 0666217120 | [Profile](https://www.facebook.com/profile.php?id=61551967168123&mibextid=ZbWKwL)      |
| `abbas-mohamed-issam`         | Abbas Mohamed Issam         | Abbes Mohamed Issam       | Automobile  | mohamed_issam.abbas@g.enp.edu.dz                    | 0797541252 | [Profile](https://www.facebook.com/share/19AesBgmm2/?mibextid=wwXIfr)                  |
| `hadjout-yacine`              | Hadjout Yacine              | —                         | Automobile  | yacine.hadjout@g.enp.edu.dz                         | 0796804353 | [Profile](https://www.facebook.com/share/1LtH4nHWyq/?mibextid=wwXIfr)                  |
| `matallah-sohaib`             | Matallah Sohaib             | Sohaib Mattalah           | GM          | sohaib.matallah@g.enp.edu.dz                        | 0696018442 | [Profile](https://www.facebook.com/sohaib.matallah)                                    |
| `dekali-yacine`               | Dekali Yacine               | —                         | GM          | yacine.dekali@g.enp.edu.dz                          | 0555319295 | [Profile](https://web.facebook.com/Sissinho)                                           |
| `khaouni-youcef-nadjib`       | Khaouni Youcef Nadjib       | Youcef Khaouni            | Automobile  | youcef_nadjib.khaouni@g.enp.edu.dz                  | 0697798746 | [Profile](https://www.facebook.com/youcef.khaouni.2025)                                |
| `mouassa-sara-cerine`         | Mouassa Sara Cerine         | Mouassa Sara              | Automobile  | sara_cerine.mouassa@g.enp.edu.dz                    | 0557198413 | [Profile](https://www.facebook.com/share/19N5v4nvWk/?mibextid=wwXIfr)                  |
| `didani-ismail`               | Didani Ismail               | —                         | GM          | ismail.didani@g.enp.edu.dz                          | 0542629311 | [Profile](https://www.facebook.com/share/1D3mCdDgex/?mibextid=wwXIfr)                  |
| `benchohrani-mohammed-rayane` | Benchohrani Mohammed Rayane | Rayane Benchouhrani       | Automobile  | mohammed_rayane.benchohrani@g.enp.edu.dz            | 0553814395 | [Profile](https://www.facebook.com/Moe.Ryan26)                                         |
| `hiba-benkhaled`              | Hiba Benkhaled              | —                         | GM          | hiba.benkhaled@g.enp.edu.dz                         | 0666402200 | [Profile](https://www.facebook.com/share/1GHLKBH42n/)                                  |
| `abderrahmene-khelifi`        | Abderrahmene Khelifi        | —                         | Materiaux   | abderrahmene.khelifi@g.enp.edu.dz                   | 0773998090 | [Profile](https://www.facebook.com/yasser.dride.3386/)                                 |
| `bekhouche-manel`             | Bekhouche Manel             | —                         | GM          | manel.bekhouche@g.enp.edu.dz                        | 0779260841 | [Profile](https://www.facebook.com/share/19YNpqDWG1/?mibextid=wwXIfr)                  |
| `ouadah-feth-allah`           | Ouadah Feth Allah           | Fethallah Ouadah          | Automobile  | feth_allah.ouadah@g.enp.edu.dz                      | 0558147825 | [Profile](https://www.facebook.com/share/18FEmV3DPa/)                                  |
| `yanir-iskandar-louni`        | Yanir Iskandar Louni        | Yanir Louni               | ELT         | yanir_iskandar.louni@g.enp.edu.dz                   | 0781563992 | [Profile](https://www.facebook.com/yanir.louni.3/)                                     |
| `walid-mahmoudi`              | Walid Mahmoudi              | —                         | ELN         | walid.mahmoudi@g.enp.edu.dz                         | 0557332628 | —                                                                                      |
| `bouabdallah-abdelhalim`      | Bouabdallah Abdelhalim      | Bouabdallah Halim         | Automatique | abdelhalim.bouabdallah@g.enp.edu.dz                 | 0795468858 | [Profile](https://www.facebook.com/share/1cRmDLEgPj/)                                  |
| `rayane-chouache`             | Rayane Chouache             | —                         | ELN         | rayane.chouache@g.enp.edu.dz                        | 0559417352 | [Profile](https://www.facebook.com/rayen.ch.861547)                                    |
| `abdessad-deghnouche`         | Abdessad Deghnouche         | Deghnouche Abdessamad     | ELN         | abdessamad.deghnouche@g.enp.edu.dz                  | 0658062789 | [Profile](https://www.facebook.com/share/1VvDE9JEzQ/)                                  |
| `bechim-abderraouf`           | Bechim Abderraouf           | Bechim Abderaouf          | ELT         | abderraouf.bechim@g.enp.edu.dz                      | 0557102058 | —                                                                                      |
| `mohamed-amine-bennouar`      | Mohamed Amine Bennouar      | Bennouar Amine            | Automatique | mohamed_amine.bennouar@g.enp.edu.dz                 | 0562837047 | [Profile](https://www.facebook.com/share/1EJpuBAhWP/)                                  |
| `lamis-hachemi`               | Lamis Hachemi               | —                         | ELN         | lamis.hachemi@g.enp.edu.dz                          | 0698333853 | [Profile](https://www.facebook.com/profile.php?id=61564221322602&mibextid=ZbWKwL)      |
| `amara-sarah-lyna`            | Amara Sarah Lyna            | —                         | Automatique | sarah_lyna.amara@g.enp.edu.dz                       | 0770409832 | [Profile](https://www.facebook.com/share/1UxfV4xt6N/)                                  |
| `bennadir-saber-ayoub`        | Bennadir Saber Ayoub        | Ayoub Benadir             | ELN         | saber_ayoub.bennadir@g.enp.edu.dz                   | 0549167113 | [Profile](https://www.facebook.com/share/19SSbZgrfD/)                                  |
| `azzam-amir`                  | Azzam Amir                  | Amir Azzem                | Automatique | amir.azzam@g.enp.edu.dz                             | 0541382534 | [Profile](https://www.facebook.com/amirakram.akram.96?mibextid=wwXIfr&mibextid=wwXIfr) |
| `amrouche-mohamed-islam`      | Amrouche Mohamed Islam      | Islam Amrouche            | ELN         | mohamed_islam.amrouche@g.enp.edu.dz                 | 0780544411 | [Profile](https://www.facebook.com/share/19GuUKcA4p/?mibextid=wwXIfr)                  |
| `chikhar-hani-sofiane`        | Chikhar Hani Sofiane        | Hani Chikhar              | ELN         | hani_sofiane.chikhar@g.enp.edu.dz                   | 0540939195 | [Profile](https://facebook.com/hani.chikhar)                                           |

## 4. `assignments`

_One row per (member, unit, role). A person can appear several times. **Level** = Main / Junior as labeled in the org chart (— when not applicable). **Title / specialty** = the label used in the org chart._

| member_id                     | Name                        | unit_id                    | role_id                             | Level  | Title / specialty                 |
| ----------------------------- | --------------------------- | -------------------------- | ----------------------------------- | ------ | --------------------------------- |
| `ilyes-menzer`                | Ilyes Menzer                | `board`                    | `board-member`                      | —      | —                                 |
| `ayoub-driouche`              | Ayoub Driouche              | `board`                    | `board-member`                      | —      | —                                 |
| `besma-kada`                  | Besma Kada                  | `board`                    | `board-member`                      | —      | —                                 |
| `hammouda-baouchi`            | Hammouda Baouchi            | `board`                    | `board-member`                      | —      | —                                 |
| `anefal-choumane`             | Anefal Choumane             | `board`                    | `board-member`                      | —      | —                                 |
| `youcef-bengoumida`           | Youcef Bengoumida           | `board`                    | `board-member`                      | —      | —                                 |
| `youcef-bengoumida`           | Youcef Bengoumida           | `executive-bureau`         | `executive-bureau-member`           | —      | —                                 |
| `anefal-choumane`             | Anefal Choumane             | `executive-bureau`         | `executive-bureau-member`           | —      | —                                 |
| `besma-kada`                  | Besma Kada                  | `executive-bureau`         | `executive-bureau-member`           | —      | —                                 |
| `moncef-meguellati`           | Moncef Meguellati           | `executive-bureau`         | `executive-bureau-member`           | —      | —                                 |
| `ouldkhaoua-mohamed-amine`    | Ouldkhaoua Mohamed Amine    | `executive-bureau`         | `executive-bureau-member`           | —      | —                                 |
| `hammouda-baouchi`            | Hammouda Baouchi            | `executive-bureau`         | `executive-bureau-member`           | —      | —                                 |
| `aimen-hocine-hamour`         | Aimen Hocine Hamour         | `executive-bureau`         | `executive-bureau-member`           | —      | —                                 |
| `zahreddine-sebaa`            | Zahreddine Sebaa            | `executive-bureau`         | `executive-bureau-member`           | —      | —                                 |
| `imane-lounis`                | Imane Lounis                | `executive-bureau`         | `executive-bureau-member`           | —      | —                                 |
| `chakib-tetbirt`              | Chakib Tetbirt              | `executive-bureau`         | `executive-bureau-member`           | —      | —                                 |
| `abed-moncef-mourad`          | Abed Moncef Mourad          | `executive-bureau`         | `executive-bureau-member`           | —      | —                                 |
| `ouarab-youcef`               | Ouarab Youcef               | `executive-bureau`         | `executive-bureau-member`           | —      | —                                 |
| `boussaha-abid`               | Boussaha Abid               | `executive-bureau`         | `executive-bureau-member`           | —      | —                                 |
| `ibrahim-khial`               | Ibrahim Khial               | `executive-bureau`         | `executive-bureau-member`           | —      | —                                 |
| `youcef-bengoumida`           | Youcef Bengoumida           | `dept-projet`              | `project-manager`                   | —      | Project Manager — Formula Student |
| `anefal-choumane`             | Anefal Choumane             | `dept-training-industry`   | `training-industry-lead`            | —      | Head                              |
| `yacine-zaouadi`              | Yacine Zaouadi              | `dept-training-industry`   | `training-coordinator`              | Main   | Coordinator                       |
| `besma-kada`                  | Besma Kada                  | `dept-media`               | `lead-journalist`                   | —      | Lead Journalist                   |
| `moncef-meguellati`           | Moncef Meguellati           | `dept-media`               | `head-of-production`                | —      | Head of Production                |
| `bendali-mohamed-hani`        | Bendali Mohamed Hani        | `dept-media`               | `producer`                          | Main   | Producer                          |
| `abdelmadjid-medjkane`        | Abdelmadjid Medjkane        | `dept-media`               | `producer`                          | Main   | Producer                          |
| `ouldkhaoua-mohamed-amine`    | Ouldkhaoua Mohamed Amine    | `dept-information-systems` | `information-systems-lead`          | —      | Head                              |
| `malki-yasmine`               | Malki Yasmine               | `dept-information-systems` | `developer`                         | Main   | ERP Developer                     |
| `krim-meriem-insaf`           | Krim Meriem Insaf           | `dept-information-systems` | `developer`                         | Main   | ERP Developer                     |
| `yanis-sadouni`               | Yanis Sadouni               | `dept-information-systems` | `developer`                         | Main   | ERP Developer                     |
| `dyna-sourour-boukhedimi`     | Dyna Sourour Boukhedimi     | `dept-information-systems` | `developer`                         | Main   | ERP Developer                     |
| `anis-abdeldjalil-boukhedimi` | Anis Abdeldjalil Boukhedimi | `dept-information-systems` | `club-member`                       | Junior | Junior Member                     |
| `boulebghal-youcef`           | Boulebghal Youcef           | `dept-business-projects`   | `business-projects-member`          | —      | —                                 |
| `dekhouche-allawa`            | Dekhouche Allawa            | `dept-business-projects`   | `business-projects-member`          | —      | —                                 |
| `nasri-yacine`                | Nasri Yacine                | `dept-business-projects`   | `business-projects-member`          | —      | —                                 |
| `guermah-mehdi`               | Guermah Mehdi               | `dept-business-projects`   | `business-projects-member`          | —      | —                                 |
| `bouafia-kawther`             | Bouafia Kawther             | `dept-business-projects`   | `business-projects-member`          | —      | —                                 |
| `reziouak-moad`               | Reziouak Moad               | `dept-business-projects`   | `business-projects-member`          | —      | —                                 |
| `othmani-mohamed`             | Othmani Mohamed             | `dept-business-projects`   | `business-projects-member`          | —      | —                                 |
| `djouadi-asma`                | Djouadi Asma                | `dept-business-projects`   | `business-projects-member`          | —      | —                                 |
| `zitoune-yacine`              | Zitoune Yacine              | `dept-business-projects`   | `business-projects-member`          | —      | —                                 |
| `moulay-mohamed-elt`          | Moulay Mohamed Elt          | `dept-business-projects`   | `business-projects-member`          | —      | —                                 |
| `gherzi-akram`                | Gherzi Akram                | `dept-business-projects`   | `business-projects-member`          | —      | —                                 |
| `hammouda-baouchi`            | Hammouda Baouchi            | `dept-operations`          | `operations-lead`                   | —      | Head                              |
| `chaib-bessou-khaoula`        | Chaib Bessou Khaoula        | `dept-operations`          | `logistics-coordinator`             | Main   | Logistics Coordinator             |
| `amrane-hiba-ibtissem`        | Amrane Hiba Ibtissem        | `dept-operations`          | `logistics-coordinator`             | Main   | Logistics Coordinator             |
| `amalou-mohamed-idris`        | Amalou Mohamed Idris        | `dept-operations`          | `logistics-coordinator`             | Main   | Logistics Coordinator             |
| `al-hamarsheh-chaima`         | Al Hamarsheh Chaima         | `dept-operations`          | `club-member`                       | Junior | Junior Member                     |
| `bouhechiche-anas-abderrahim` | Bouhechiche Anas Abderrahim | `dept-operations`          | `club-member`                       | Junior | Junior Member                     |
| `ayoub-serir`                 | Ayoub Serir                 | `dept-operations`          | `club-member`                       | Junior | Junior Member                     |
| `youcef-bengoumida`           | Youcef Bengoumida           | `fs-team`                  | `team-lead`                         | —      | Team Lead                         |
| `aimen-hocine-hamour`         | Aimen Hocine Hamour         | `fs-team`                  | `chief-engineer`                    | —      | Chief Engineer                    |
| `zahreddine-sebaa`            | Zahreddine Sebaa            | `fs-team`                  | `manufacturing-workshop-lead`       | —      | Manufacturing & Workshop Lead     |
| `imane-lounis`                | Imane Lounis                | `fs-team`                  | `team-manager`                      | —      | Team Manager                      |
| `chakib-tetbirt`              | Chakib Tetbirt              | `fs-suspension-steering`   | `suspension-steering-lead-engineer` | —      | Lead                              |
| `abdelmadjid-ouldali`         | Abdelmadjid Ouldali         | `fs-suspension-steering`   | `suspension-steering-engineer`      | Main   | Steering System                   |
| `arfi-maya`                   | Arfi Maya                   | `fs-suspension-steering`   | `suspension-steering-engineer`      | Main   | Suspension Design                 |
| `hadji-akram-rami`            | Hadji Akram Rami            | `fs-suspension-steering`   | `suspension-steering-engineer`      | Main   | Vehicle Dynamics                  |
| `lamia-beddek`                | Lamia Beddek                | `fs-suspension-steering`   | `fs-member`                         | Junior | Junior Member                     |
| `abed-moncef-mourad`          | Abed Moncef Mourad          | `fs-chassis-ergonomics`    | `chassis-ergonomics-lead-engineer`  | —      | Lead                              |
| `abbas-mohamed-issam`         | Abbas Mohamed Issam         | `fs-chassis-ergonomics`    | `chassis-ergonomics-engineer`       | Main   | Chassis Design                    |
| `hadjout-yacine`              | Hadjout Yacine              | `fs-chassis-ergonomics`    | `chassis-ergonomics-engineer`       | Main   | Ergonomics                        |
| `matallah-sohaib`             | Matallah Sohaib             | `fs-chassis-ergonomics`    | `fs-member`                         | Junior | Junior Member                     |
| `ouarab-youcef`               | Ouarab Youcef               | `fs-powertrain`            | `powertrain-lead-engineer`          | —      | Lead                              |
| `dekali-yacine`               | Dekali Yacine               | `fs-powertrain`            | `powertrain-engineer`               | Main   | Intake / Exhaust                  |
| `khaouni-youcef-nadjib`       | Khaouni Youcef Nadjib       | `fs-powertrain`            | `powertrain-engineer`               | Main   | Drivetrain                        |
| `mouassa-sara-cerine`         | Mouassa Sara Cerine         | `fs-powertrain`            | `powertrain-engineer`               | Main   | Braking System                    |
| `didani-ismail`               | Didani Ismail               | `fs-powertrain`            | `powertrain-engineer`               | Main   | Cooling / Fuel System             |
| `benchohrani-mohammed-rayane` | Benchohrani Mohammed Rayane | `fs-powertrain`            | `powertrain-engineer`               | Main   | EV Powertrain                     |
| `hiba-benkhaled`              | Hiba Benkhaled              | `fs-powertrain`            | `fs-member`                         | Junior | Junior Member                     |
| `boussaha-abid`               | Boussaha Abid               | `fs-aerodynamics`          | `aerodynamics-lead-engineer`        | —      | Lead                              |
| `abderrahmene-khelifi`        | Abderrahmene Khelifi        | `fs-aerodynamics`          | `aerodynamics-engineer`             | Main   | Aerodynamics & CFD                |
| `bekhouche-manel`             | Bekhouche Manel             | `fs-aerodynamics`          | `aerodynamics-engineer`             | Main   | Chassis & Aero                    |
| `ouadah-feth-allah`           | Ouadah Feth Allah           | `fs-aerodynamics`          | `fs-member`                         | Junior | Junior Member                     |
| `ibrahim-khial`               | Ibrahim Khial               | `fs-electronics`           | `electronics-lead-engineer`         | —      | Lead                              |
| `yanir-iskandar-louni`        | Yanir Iskandar Louni        | `fs-electronics`           | `electronics-engineer`              | Main   | —                                 |
| `walid-mahmoudi`              | Walid Mahmoudi              | `fs-electronics`           | `electronics-engineer`              | Main   | —                                 |
| `bouabdallah-abdelhalim`      | Bouabdallah Abdelhalim      | `fs-electronics`           | `electronics-engineer`              | Main   | —                                 |
| `rayane-chouache`             | Rayane Chouache             | `fs-electronics`           | `electronics-engineer`              | Main   | —                                 |
| `abdessad-deghnouche`         | Abdessad Deghnouche         | `fs-electronics`           | `electronics-engineer`              | Main   | —                                 |
| `bechim-abderraouf`           | Bechim Abderraouf           | `fs-electronics`           | `electronics-engineer`              | Main   | —                                 |
| `mohamed-amine-bennouar`      | Mohamed Amine Bennouar      | `fs-electronics`           | `electronics-engineer`              | Main   | —                                 |
| `lamis-hachemi`               | Lamis Hachemi               | `fs-electronics`           | `electronics-engineer`              | Main   | —                                 |
| `amara-sarah-lyna`            | Amara Sarah Lyna            | `fs-electronics`           | `electronics-engineer`              | Main   | —                                 |
| `bennadir-saber-ayoub`        | Bennadir Saber Ayoub        | `fs-electronics`           | `fs-member`                         | Junior | Junior Member                     |
| `azzam-amir`                  | Azzam Amir                  | `fs-electronics`           | `fs-member`                         | Junior | Junior Member                     |
| `amrouche-mohamed-islam`      | Amrouche Mohamed Islam      | `fs-electronics`           | `fs-member`                         | Junior | Junior Member                     |
| `chikhar-hani-sofiane`        | Chikhar Hani Sofiane        | `fs-electronics`           | `fs-member`                         | Junior | Junior Member                     |

## 5. `projects`

| Project                              | Parent unit   | Details                                 |
| ------------------------------------ | ------------- | --------------------------------------- |
| Formula Student                      | `dept-projet` | Projet principal (team unit: `fs-team`) |
| Projet de compétition complémentaire | `dept-projet` | TBD                                     |

## 6. `electronics_phases`

_Sub-team membership inside `fs-electronics`. Members link to `members.member_id`._

| Phase            | System    | Sub-team                                       | member_id                | Name                   | Level  |
| ---------------- | --------- | ---------------------------------------------- | ------------------------ | ---------------------- | ------ |
| Phase 1 — EV Car | HV System | HV Battery & Battery Management                | `yanir-iskandar-louni`   | Yanir Iskandar Louni   | Main   |
| Phase 1 — EV Car | HV System | HV Battery & Battery Management                | `bechim-abderraouf`      | Bechim Abderraouf      | Main   |
| Phase 1 — EV Car | HV System | HV Motors & Motor Data                         | `abdessad-deghnouche`    | Abdessad Deghnouche    | Main   |
| Phase 1 — EV Car | HV System | HV Motors & Motor Data                         | `yanir-iskandar-louni`   | Yanir Iskandar Louni   | Main   |
| Phase 1 — EV Car | HV System | HV Motors & Motor Data                         | `amrouche-mohamed-islam` | Amrouche Mohamed Islam | Junior |
| Phase 1 — EV Car | HV System | HV Wiring Harness                              | `amara-sarah-lyna`       | Amara Sarah Lyna       | Main   |
| Phase 1 — EV Car | HV System | HV Wiring Harness                              | `chikhar-hani-sofiane`   | Chikhar Hani Sofiane   | Junior |
| Phase 1 — EV Car | LV System | LV Wiring Harness & Inter-System Communication | `lamis-hachemi`          | Lamis Hachemi          | Main   |
| Phase 1 — EV Car | LV System | LV Wiring Harness & Inter-System Communication | `rayane-chouache`        | Rayane Chouache        | Main   |
| Phase 1 — EV Car | LV System | Control & Safety Systems                       | `abdessad-deghnouche`    | Abdessad Deghnouche    | Main   |
| Phase 1 — EV Car | LV System | Control & Safety Systems                       | `yanir-iskandar-louni`   | Yanir Iskandar Louni   | Main   |
| Phase 1 — EV Car | LV System | Control & Safety Systems                       | `mohamed-amine-bennouar` | Mohamed Amine Bennouar | Main   |
| Phase 1 — EV Car | LV System | Control & Safety Systems                       | `bennadir-saber-ayoub`   | Bennadir Saber Ayoub   | Junior |
| Phase 1 — EV Car | LV System | Control & Safety Systems                       | `azzam-amir`             | Azzam Amir             | Junior |
| Phase 1 — EV Car | LV System | Sensors & Data Acquisition                     | `bouabdallah-abdelhalim` | Bouabdallah Abdelhalim | Main   |
| Phase 1 — EV Car | LV System | Sensors & Data Acquisition                     | `walid-mahmoudi`         | Walid Mahmoudi         | Main   |
| Phase 1 — EV Car | LV System | Sensors & Data Acquisition                     | `amrouche-mohamed-islam` | Amrouche Mohamed Islam | Junior |
| Phase 1 — EV Car | LV System | Sensors & Data Acquisition                     | `bennadir-saber-ayoub`   | Bennadir Saber Ayoub   | Junior |
| Phase 2 — IC Car | —         | Wiring Harness                                 | —                        | TBD                    | —      |
| Phase 2 — IC Car | —         | Safety & Control Systems Design                | —                        | TBD                    | —      |
| Phase 2 — IC Car | —         | Sensors & Actuators                            | —                        | TBD                    | —      |
| Phase 2 — IC Car | —         | Embedded Systems                               | —                        | TBD                    | —      |

---

## Notes & data quality

- **Governance:** `board` = the 6 members listed under _Conseil d'Administration_ in the sheet. `executive-bureau` = the 14 people tagged "+ membre du bureau exécutif" in the org chart; they keep their other roles in addition.
- **Business Projects:** the org chart says no members are assigned, but the 11 people in the sheet's `BUSINESS PROJECTS` tab are assigned here as `business-projects-member` (the role exists in the taxonomy). `business-projects-lead` is unassigned.
- **Juniors:** the roles list has no junior tier, so juniors use the generic `club-member` / `fs-member` role with Level = Junior.
- **Electronics main members** have no specialty in the chart, so they are `electronics-engineer` with an empty title.
- **Cleaning applied:** emails lower-cased; phone numbers normalised to 10 digits (lost leading 0 restored, spaces removed); a lone "." in a Facebook cell treated as empty.
- **Missing phone (2):** Aimen Hocine Hamour, Abdelmadjid Ouldali
- **Missing Facebook (6):** Imane Lounis, Dyna Sourour Boukhedimi, Nasri Yacine, Arfi Maya, Walid Mahmoudi, Bechim Abderraouf
- **Facebook cell is not a link:** Amalou Mohamed Idris ("Amalou Mohamed Idris")
