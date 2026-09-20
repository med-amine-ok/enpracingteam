# ENP Racing — ERP Database Schema Guide

**Purpose of this document:** explain, in plain language, every table, column, and index of the ENP Racing ERP database, with a concrete example for each, and a hierarchical example wherever a table points to a "parent" of the same kind.

|              |                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| **Database** | PostgreSQL                                                                                                  |
| **Backend**  | Django (some business rules live there, see [Section 15](#15-rules-enforced-in-django-not-in-the-database)) |
| **Size**     | 37 tables, 20 enumerated types, grouped in 12 modules                                                       |

---

## 0. How to read this document

Every table section follows the same layout:

1. **Purpose**: what the table is for, in one or two sentences.
2. **Columns**: name, type, whether it is required (✔ = `NOT NULL`, — = may be empty), what it means, and an example value.
3. **Indexes & constraints**: what each one does and _why it exists_ (an index makes a frequent search fast; a constraint blocks invalid data).
4. **Example rows / hierarchy**: sample data. Where the table has a parent/child structure, a tree is shown.

**About the examples.** People, units, and subsystems are taken from the ENP Racing organization chart. Everything else (emails, prices, part references, dates, supplier names, sensor values) is **fictitious** and only illustrates how data would look. Row `id` values are illustrative too; the real ones are assigned by the database.

**Foreign-key legend.** When a column says `FK → table.id`, it points to a row in another table. The _ON DELETE_ rule says what happens if that row is deleted:

| Rule       | Meaning                                                     | Typical use                                                        |
| ---------- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| `RESTRICT` | Deletion is **blocked** while other rows still reference it | Protects history (a member who created tasks cannot simply vanish) |
| `CASCADE`  | Dependent rows are **deleted with it**                      | Pure "children" (comments of a task, data points of a session)     |
| `SET NULL` | The link is **cleared**, the row stays                      | Optional, non-critical links                                       |

---

## 1. The big picture

### 1.1 The 12 modules

| #   | Module                                 | Tables                                                                                                       |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | Members & Organization                 | `role`, `member`, `alumni_profile`, `org_unit`, `membership`                                                 |
| 2   | Projects                               | `project`, `project_member`                                                                                  |
| 3   | Formula Student Subsystems & Lifecycle | `subsystem`, `member_subsystem`, `lifecycle_step`, `subsystem_step_progress`                                 |
| 4   | Tasks                                  | `task`, `task_assignee`, `task_comment`                                                                      |
| 5   | Communication                          | `announcement`, `notification`, `media_contact`                                                              |
| 6   | Documents                              | `document`                                                                                                   |
| 7   | Purchasing & Procurement               | `supplier`, `part`, `purchase_request`, `shipping_address`, `purchase_order`, `invoice`, `invoice_line_item` |
| 8   | Stock & Logistics                      | `stock_item`, `stock_movement`                                                                               |
| 9   | Workshops & Equipment                  | `equipment`, `equipment_reservation`, `equipment_maintenance`                                                |
| 10  | Budget & Finance                       | `budget`, `expense`, `sponsorship`                                                                           |
| 11  | Dashboard & Reporting                  | `saved_report`                                                                                               |
| 12  | Technical Data / Telemetry             | `competition_edition`, `telemetry_session`, `telemetry_data_point`                                           |

### 1.2 Three ideas that keep the model clean

The most important design decision is that **three different questions are answered by three different tables**:

| Question                                  | Answered by                          | Example                         |
| ----------------------------------------- | ------------------------------------ | ------------------------------- |
| **Where** does someone belong?            | `org_unit` (via `membership`)        | Electronics                     |
| **What position** do they hold?           | `role` (via `membership`)            | Lead, Member                    |
| **What technical thing** do they work on? | `subsystem` (via `member_subsystem`) | HV Battery & Battery Management |

On top of that, **seniority** (`main` / `junior`) is stored separately as `member_level`, so "Steering System — Main Member" in the org chart becomes:
_org unit_ = Suspension & Steering · _role_ = Member · _level_ = main · _subsystem_ = Steering System.

A technical name such as "Steering System" is **never** a role.

### 1.3 The organization chart as data (`org_unit` tree)

Everything in the organization chart lives in **one self-referencing table**, `org_unit`. Each row's `parent_id` points to the unit above it.

```
org_unit  (id · name · type)

1   Conseil d'Administration                        governing_body
2   Bureau Exécutif                                 governing_body
3   Département Projet                              club_department
└── 9   Formula Student Team                        fs_team           (parent_id = 3)
    ├── 10  Suspension & Steering                   fs_department     (parent_id = 9)
    ├── 11  Chassis & Ergonomics                    fs_department     (parent_id = 9)
    ├── 12  Powertrain                              fs_department     (parent_id = 9)
    ├── 13  Aerodynamics                            fs_department     (parent_id = 9)
    └── 14  Electronics                             fs_department     (parent_id = 9)
4   Département Formation & Industrie               club_department
5   Département Médias & Journalisme Scientifique   club_department
├── 15  Journalism                                  club_pole  (example, is_temporary = false)
└── 16  Production                                  club_pole  (example, is_temporary = false)
6   Département Systèmes d'Information              club_department
7   Département Business & Innovation               club_department
8   Département Opérations & Partenariats           club_department
```

Rows 1 to 14 are created by the seed script at the end of the schema. Rows 15 and 16 are examples of poles that an admin can add later.

### 1.5 General conventions

| Convention                                    | Explanation                                                                                                                                  |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `id integer GENERATED BY DEFAULT AS IDENTITY` | Every table has an auto-numbered primary key. (`telemetry_data_point` uses `bigint` because it holds millions of rows.)                      |
| `created_at` / `updated_at`                   | `created_at` is filled automatically with the insertion time. `updated_at` is empty until the row is first modified (maintained by Django).  |
| `end_date IS NULL`                            | Means "still active / no end yet". Used by `membership`, `member_subsystem`, `project_member`.                                               |
| Dates checks (`ck_*_dates`)                   | A row's `end_date` can never be before its `start_date`.                                                                                     |
| "Loose" links                                 | A few columns (e.g. `notification.related_entity_id`) point to another record without a real foreign key, on purpose.                        |
| Money                                         | Amounts are `numeric(12,2)` (exact decimals, never floating point). **No currency column exists** (see [Section 16](#16-points-to-confirm)). |

---

## 2. Enumerated types (allowed values)

An **enum** restricts a column to a fixed list of values, so typos such as `"activ"` are impossible.

| Enum                  | Values                                                                                                                                                | Used by                                            | Meaning                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `role_scope`          | `club`, `fs_team`                                                                                                                                     | `role.scope`                                       | Broad area where a role exists: the whole club, or the Formula Student team                  |
| `member_role_type`    | `admin`, `head_of_department`, `member`                                                                                                               | `role.role_type`                                   | Permission family of a role                                                                  |
| `member_status`       | `active`, `alumni`, `on_leave`                                                                                                                        | `member.status`                                    | Current state of a person                                                                    |
| `member_level`        | `main`, `junior`                                                                                                                                      | `membership`, `member_subsystem`                   | Seniority of a regular member                                                                |
| `org_unit_type`       | `governing_body`, `club_department`, `club_pole`, `fs_team`, `fs_department`                                                                          | `org_unit.type`                                    | What kind of unit it is (see tree in 1.3)                                                    |
| `project_category`    | `IC`, `EV`, `complementary_competition`, `club_project`                                                                                               | `project.category`                                 | Kind of project                                                                              |
| `project_status`      | `planned`, `active`, `completed`, `on_hold`                                                                                                           | `project.status`                                   | Project lifecycle                                                                            |
| `task_status`         | `todo`, `in_progress`, `blocked`, `done`                                                                                                              | `task.status`                                      | Task progress                                                                                |
| `task_priority`       | `low`, `medium`, `high`                                                                                                                               | `task.priority`, `purchase_request.priority`       | Urgency                                                                                      |
| `subsystem_status`    | `planned`, `active`, `blocked`, `complete`                                                                                                            | `subsystem.status`                                 | Subsystem progress                                                                           |
| `document_type`       | `cad`, `report`, `technical_doc`, `drawing`, `admin`, `faq`                                                                                           | `document.type`                                    | Kind of document                                                                             |
| `document_status`     | `draft`, `in_review`, `approved`, `rejected`                                                                                                          | `document.status`                                  | Review workflow                                                                              |
| `purchase_status`     | `a_commander`, `en_commande`, `livre`, `annule`                                                                                                       | `purchase_request.status`, `purchase_order.status` | To order / ordered / delivered / cancelled (values come from the real subcontracting sheets) |
| `supplier_type`       | `fournisseur`, `sous_traitant`, `mixte`, `usinage`, `logistique`                                                                                      | `supplier.type`                                    | Supplier / subcontractor / both / machining / logistics                                      |
| `supplier_status`     | `validee`, `en_attente`, `refusee`, `pas_encore_envoyee`                                                                                              | `supplier.status`                                  | Validated / pending / refused / request not yet sent                                         |
| `part_category`       | `brakes`, `wheels_tyres`, `chassis_body`, `suspension`, `steering`, `drivetrain`, `engine_tractive`, `workshop`, `low_voltage`, `operations`, `other` | `part.category`                                    | Category used in the "Pièces & Commandes" sheet                                              |
| `stock_movement_type` | `in`, `out`, `adjustment`                                                                                                                             | `stock_movement.movement_type`                     | Stock entry / exit / manual correction                                                       |
| `equipment_status`    | `available`, `borrowed`, `maintenance`, `reserved`, `out_of_service`                                                                                  | `equipment.status`                                 | Current state of a machine or tool                                                           |
| `reservation_status`  | `pending`, `confirmed`, `cancelled`, `completed`                                                                                                      | `equipment_reservation.status`                     | Booking state                                                                                |
| `sponsorship_status`  | `prospect`, `contacted`, `negotiating`, `confirmed`, `declined`                                                                                       | `sponsorship.status`                               | Sponsor pipeline stage                                                                       |

---

## 3. Module 1 — Members & Organization

### 3.1 `role`

**Purpose:** the catalogue of positions a person can hold (Head, Lead, Team Lead, Member...). A role says _what_ someone is, not _where_: the "where" comes from `membership`.

| Column                   | Type               | Req. | Meaning                                                                                                                     | Example              |
| ------------------------ | ------------------ | :--: | --------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `id`                     | integer            |  ✔   | Primary key                                                                                                                 | `4`                  |
| `name`                   | varchar            |  ✔   | Role title                                                                                                                  | `Team Lead`          |
| `role_type`              | `member_role_type` |  ✔   | Permission family: `admin`, `head_of_department`, or `member`                                                               | `head_of_department` |
| `scope`                  | `role_scope`       |  ✔   | `club` (club-wide) or `fs_team` (Formula Student team)                                                                      | `fs_team`            |
| `is_leadership`          | boolean            |  ✔   | `true` for leadership roles (Head, Lead, Team Lead...). Leadership roles have **no** `member_level`. Default `false`        | `true`               |
| `can_be_project_manager` | boolean            |  ✔   | Whether holders may be named official Project Manager of a project. Final eligibility is checked in Django. Default `false` | `true`               |
| `created_at`             | timestamp          |  ✔   | Creation time                                                                                                               | `2026-09-01 10:00`   |

**Indexes & constraints**

| Name                          | On              | Why it exists                                                                                                |
| ----------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------ |
| `uq_role_name_scope` (unique) | `(name, scope)` | The same title may exist once in `club` and once in `fs_team` (e.g. "Lead"), but not twice in the same scope |

**Example rows** _(illustrative)_

| id  | name            | role_type          | scope   | is_leadership | can_be_project_manager |
| --- | --------------- | ------------------ | ------- | :-----------: | :--------------------: |
| 1   | Head            | head_of_department | club    |     true      |          true          |
| 2   | Project Manager | member             | club    |     true      |          true          |
| 3   | ERP Developer   | member             | club    |     false     |         false          |
| 4   | Team Lead       | head_of_department | fs_team |     true      |          true          |
| 5   | Lead            | head_of_department | fs_team |     true      |         false          |
| 6   | Member          | member             | fs_team |     false     |         false          |

> Functional titles from the org chart (ERP Developer, Producer, Logistics Coordinator) are stored as regular-member roles; their "main / junior" status goes in `membership.member_level`.

---

### 3.2 `member`

**Purpose:** one row per person who is or was part of ENP Racing. It holds only personal data; positions and units come from `membership`.

| Column                      | Type            | Req.  | Meaning                                  | Example                    |
| --------------------------- | --------------- | :---: | ---------------------------------------- | -------------------------- |
| `id`                        | integer         |   ✔   | Primary key                              | `21`                       |
| `first_name`                | varchar         |   ✔   | First name                               | `Yanir`                    |
| `last_name`                 | varchar         |   ✔   | Family name                              | `Louni`                    |
| `email`                     | varchar         |   ✔   | Unique email, identifies the person      | `y.louni@example.com`      |
| `phone`                     | varchar         |   —   | Phone number                             | `+213 555 00 00 00`        |
| `skill`                     | varchar         |   —   | Free-text main skill                     | `Battery systems`          |
| `status`                    | `member_status` |   ✔   | `active` (default), `alumni`, `on_leave` | `active`                   |
| `join_date`                 | date            |   —   | When the person joined the club          | `2025-10-01`               |
| `created_at` / `updated_at` | timestamp       | ✔ / — | Record creation / last modification      | `2026-09-01 10:00` / empty |

**Indexes & constraints**

| Name                                   | On       | Why it exists                                                     |
| -------------------------------------- | -------- | ----------------------------------------------------------------- |
| `member_email_key` (unique, automatic) | `email`  | Two people cannot share an email; also makes login lookup instant |
| `idx_member_status`                    | `status` | Fast filtering such as "all active members" or "all alumni"       |

**Example rows**

| id  | first_name        | last_name | email                | status | join_date  |
| --- | ----------------- | --------- | -------------------- | ------ | ---------- |
| 21  | Yanir             | Louni     | y.louni@example.com  | active | 2025-10-01 |
| 22  | Brahim            | Khial     | b.khial@example.com  | active | 2024-10-01 |
| 57  | _(former member)_ | _(…)_     | f.member@example.com | alumni | 2022-10-01 |

---

### 3.3 `alumni_profile`

**Purpose:** extra career information for members whose status is `alumni`, used for mentoring and networking. It is **one-to-one** with `member`. (The rule "only for `status = alumni`" is enforced in Django.)

| Column                      | Type      | Req.  | Meaning                                            | Example                           |
| --------------------------- | --------- | :---: | -------------------------------------------------- | --------------------------------- |
| `id`                        | integer   |   ✔   | Primary key                                        | `1`                               |
| `member_id`                 | integer   |   ✔   | FK → `member.id` · unique · `ON DELETE CASCADE`    | `57`                              |
| `graduation_year`           | integer   |   —   | Year of graduation                                 | `2024`                            |
| `current_position`          | varchar   |   —   | Job title today                                    | `Mechanical Engineer`             |
| `current_company`           | varchar   |   —   | Employer                                           | `Example Industries`              |
| `linkedin_url`              | varchar   |   —   | Profile link                                       | `https://linkedin.com/in/example` |
| `willing_to_mentor`         | boolean   |   ✔   | Open to mentoring current members. Default `false` | `true`                            |
| `created_at` / `updated_at` | timestamp | ✔ / — | Creation / last modification                       | —                                 |

**Indexes & constraints**

| Name                                               | On          | Why it exists                                               |
| -------------------------------------------------- | ----------- | ----------------------------------------------------------- |
| `alumni_profile_member_id_key` (unique, automatic) | `member_id` | Guarantees **one** profile per member (the one-to-one link) |

---

### 3.4 `org_unit` (hierarchical)

**Purpose:** every box of the org chart: Board, Executive Bureau, the 6 departments, poles/teams, the Formula Student team and its technical departments. The table points to itself through `parent_id`, so any depth is possible and new units can be added without changing the schema.

| Column                      | Type            | Req.  | Meaning                                                                          | Example         |
| --------------------------- | --------------- | :---: | -------------------------------------------------------------------------------- | --------------- |
| `id`                        | integer         |   ✔   | Primary key                                                                      | `14`            |
| `name`                      | varchar         |   ✔   | Unit name                                                                        | `Electronics`   |
| `type`                      | `org_unit_type` |   ✔   | `governing_body`, `club_department`, `club_pole`, `fs_team`, `fs_department`     | `fs_department` |
| `parent_id`                 | integer         |   —   | FK → `org_unit.id` · `ON DELETE RESTRICT`. **Empty for top-level units**         | `9`             |
| `is_temporary`              | boolean         |   ✔   | `true` for units created for a limited time (e.g. a task force). Default `false` | `false`         |
| `is_active`                 | boolean         |   ✔   | `false` to archive a unit without deleting it. Default `true`                    | `true`          |
| `created_at` / `updated_at` | timestamp       | ✔ / — | Creation / last modification                                                     | —               |

**Indexes & constraints**

| Name                                 | On                | Why it exists                                                                         |
| ------------------------------------ | ----------------- | ------------------------------------------------------------------------------------- |
| `ck_org_unit_not_own_parent` (check) | `parent_id <> id` | A unit cannot be its own parent                                                       |
| `idx_org_unit_parent_id`             | `parent_id`       | Fast "list the children of this unit" (e.g. all technical departments of the FS team) |
| `idx_org_unit_type`                  | `type`            | Fast "list all departments" or "all fs_departments"                                   |

**Hierarchy example**: same tree as [Section 1.3](#13-the-organization-chart-as-data-org_unit-tree). Reading it as rows:

| id  | name                 | type            | parent_id |
| --- | -------------------- | --------------- | --------- |
| 3   | Département Projet   | club_department | _(empty)_ |
| 9   | Formula Student Team | fs_team         | **3**     |
| 14  | Electronics          | fs_department   | **9**     |

_"Who is above Electronics?"_ → parent 9 (Formula Student Team) → parent 3 (Département Projet) → top.

**Temporary unit example:** a short-term unit for a competition sprint would be `('Aero Sprint 2027', 'club_pole', parent_id = 13, is_temporary = true)`.

---

### 3.5 `membership`

**Purpose:** the link between a **person**, a **role**, and an **org unit**. One member can have several memberships (e.g. Project Manager in one unit and Team Lead in another). It also carries the `main` / `junior` level, so a person can be junior one season and main the next without losing history.

| Column         | Type           | Req. | Meaning                                                                                                      | Example            |
| -------------- | -------------- | :--: | ------------------------------------------------------------------------------------------------------------ | ------------------ |
| `id`           | integer        |  ✔   | Primary key                                                                                                  | `1`                |
| `member_id`    | integer        |  ✔   | FK → `member.id` · `RESTRICT`                                                                                | `21` (Yanir Louni) |
| `org_unit_id`  | integer        |  ✔   | FK → `org_unit.id` · `RESTRICT`                                                                              | `14` (Electronics) |
| `subsystem_id` | integer        |  —   | FK → `subsystem.id` · `SET NULL`. Optional "home" subsystem; detailed assignments live in `member_subsystem` | `5`                |
| `role_id`      | integer        |  ✔   | FK → `role.id` · `RESTRICT`                                                                                  | `6` (Member)       |
| `member_level` | `member_level` |  —   | `main` or `junior` for regular members; **empty for leadership roles** (rule checked in Django)              | `main`             |
| `start_date`   | date           |  —   | When the membership began                                                                                    | `2025-10-01`       |
| `end_date`     | date           |  —   | When it ended. **Empty = currently active**                                                                  | _(empty)_          |
| `is_primary`   | boolean        |  ✔   | Marks the person's main membership. Default `true`                                                           | `true`             |
| `created_at`   | timestamp      |  ✔   | Creation time                                                                                                | —                  |

**Indexes & constraints**

| Name                                                 | On                                                              | Why it exists                                                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `uq_membership_member_org_role_start` (unique)       | `(member_id, org_unit_id, role_id, start_date)`                 | Prevents recording the same membership twice (see caveat in [Section 16](#16-points-to-confirm))                                  |
| `ck_membership_dates` (check)                        | `end_date >= start_date`                                        | No membership ending before it starts                                                                                             |
| `idx_membership_member_id`                           | `member_id`                                                     | "All memberships of this person"                                                                                                  |
| `idx_membership_org_unit_id`                         | `org_unit_id`                                                   | "Everyone in this unit"                                                                                                           |
| `idx_membership_subsystem_id`                        | `subsystem_id`                                                  | "Everyone whose home subsystem is X"                                                                                              |
| `idx_membership_role_id`                             | `role_id`                                                       | "Everyone holding this role"                                                                                                      |
| `idx_membership_unit_level_active`                   | `(org_unit_id, member_level)` **only where `end_date IS NULL`** | Very fast roster queries: "active main / junior members of Electronics". Ended memberships are excluded, so the index stays small |
| `uq_membership_one_active_primary` (unique, partial) | `member_id` **where `is_primary` AND `end_date IS NULL`**       | A person can have **at most one active primary** membership                                                                       |

**Example rows**

| member                      | org_unit                 | role            | member_level | is_primary | end_date |
| --------------------------- | ------------------------ | --------------- | ------------ | :--------: | -------- |
| Youcef Bengoumida           | 9 Formula Student Team   | Team Lead       | —            |    true    | —        |
| Youcef Bengoumida           | 3 Département Projet     | Project Manager | —            | **false**  | —        |
| Brahim Khial                | 14 Electronics           | Lead            | —            |    true    | —        |
| Yanir Louni                 | 14 Electronics           | Member          | main         |    true    | —        |
| Islam Amrouche              | 14 Electronics           | Member          | junior       |    true    | —        |
| Mohamed Amine Ould Khaoua   | 6 Systèmes d'Information | Head            | —            |    true    | —        |
| Malki Yasmine               | 6 Systèmes d'Information | ERP Developer   | main         |    true    | —        |
| Anis Abdeldjalil Boukhedimi | 6 Systèmes d'Information | Member          | junior       |    true    | —        |

**Why the partial unique index matters:** Youcef Bengoumida is both Team Lead of the FS team _and_ Project Manager (Département Projet). He has two active memberships, but only one can have `is_primary = true`. Trying to insert a second primary one is rejected by `uq_membership_one_active_primary`.

---

## 4. Module 2 — Projects

### 4.1 `project`

**Purpose:** a project of the club: the two Formula Student cars (IC and EV), the complementary competition, or an internal club project such as the ERP platform. Every project is **owned** by an org unit and has one **official Project Manager**.

| Column                      | Type               | Req.  | Meaning                                                                                                                                                                                | Example                        |
| --------------------------- | ------------------ | :---: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `id`                        | integer            |   ✔   | Primary key                                                                                                                                                                            | `1`                            |
| `name`                      | varchar            |   ✔   | Project name                                                                                                                                                                           | `EV 2027`                      |
| `category`                  | `project_category` |   ✔   | `IC`, `EV`, `complementary_competition`, `club_project`                                                                                                                                | `EV`                           |
| `org_unit_id`               | integer            |   ✔   | FK → `org_unit.id` · `RESTRICT`. **Owning unit.** `club_project` → the club department; `IC` / `EV` / `complementary_competition` → the Projet department or Formula Student Team unit | `9`                            |
| `description`               | text               |   —   | Free description                                                                                                                                                                       | `Electric Formula Student car` |
| `start_date` / `end_date`   | date               |   —   | Planned or actual dates                                                                                                                                                                | `2026-09-01` / `2027-07-31`    |
| `status`                    | `project_status`   |   ✔   | `planned`, `active`, `completed`, `on_hold`                                                                                                                                            | `active`                       |
| `project_manager_id`        | integer            |   —   | FK → `member.id` · `RESTRICT`. The **official** Project Manager (not automatically the "team lead"). Eligibility is checked in Django; no person is hardcoded                          | `3` (Youcef Bengoumida)        |
| `created_at` / `updated_at` | timestamp          | ✔ / — | Creation / last modification                                                                                                                                                           | —                              |

**Indexes & constraints**

| Name                             | On                       | Why it exists                     |
| -------------------------------- | ------------------------ | --------------------------------- |
| `ck_project_dates` (check)       | `end_date >= start_date` | Coherent dates                    |
| `idx_project_category`           | `category`               | "Show all EV projects"            |
| `idx_project_status`             | `status`                 | "Show all active projects"        |
| `idx_project_org_unit_id`        | `org_unit_id`            | "Projects owned by this unit"     |
| `idx_project_project_manager_id` | `project_manager_id`     | "Projects managed by this person" |

**Example rows**

| id  | name                            | category                  | org_unit                 | status  | project_manager   |
| --- | ------------------------------- | ------------------------- | ------------------------ | ------- | ----------------- |
| 1   | EV 2027                         | EV                        | 9 Formula Student Team   | active  | Youcef Bengoumida |
| 2   | IC 2027                         | IC                        | 9 Formula Student Team   | planned | Youcef Bengoumida |
| 3   | Complementary competition (TBD) | complementary_competition | 3 Département Projet     | planned | _(empty)_         |
| 4   | ERP Platform                    | club_project              | 6 Systèmes d'Information | active  | _(to be named)_   |

The org chart's "Projet de compétition complémentaire: TBD" is simply a row with category `complementary_competition` whose name and manager are filled in later.

---

### 4.2 `project_member`

**Purpose:** who takes part in a project, with an optional project-specific role. It complements `membership` (which is about the organization) by describing participation in a _specific project_.

| Column                    | Type      | Req. | Meaning                                                                           | Example              |
| ------------------------- | --------- | :--: | --------------------------------------------------------------------------------- | -------------------- |
| `id`                      | integer   |  ✔   | Primary key                                                                       | `1`                  |
| `project_id`              | integer   |  ✔   | FK → `project.id` · `CASCADE` (deleting a project removes its participation rows) | `1`                  |
| `member_id`               | integer   |  ✔   | FK → `member.id` · `RESTRICT`                                                     | `21`                 |
| `role`                    | varchar   |  —   | Free-text project role                                                            | `HV battery lead`    |
| `start_date` / `end_date` | date      |  —   | Period of participation                                                           | `2026-09-15` / empty |
| `is_active`               | boolean   |  ✔   | Currently participating. Default `true`                                           | `true`               |
| `created_at`              | timestamp |  ✔   | Creation time                                                                     | —                    |

**Indexes & constraints**

| Name                                        | On                        | Why it exists                          |
| ------------------------------------------- | ------------------------- | -------------------------------------- |
| `uq_project_member_project_member` (unique) | `(project_id, member_id)` | A person appears only once per project |
| `ck_project_member_dates` (check)           | `end_date >= start_date`  | Coherent dates                         |
| `idx_project_member_project_id`             | `project_id`              | "Team of this project"                 |
| `idx_project_member_member_id`              | `member_id`               | "Projects of this person"              |

**Example:** `(project 1 "EV 2027", member 21 "Yanir Louni", role "HV battery lead", is_active true)`.

---

## 5. Module 3 — Formula Student Subsystems & Lifecycle

> **Rule:** subsystems exist **only** under `fs_department` org units. Club departments never own subsystems (checked in Django).

### 5.1 `subsystem` (hierarchical)

**Purpose:** a _technical_ part of the car (Steering System, HV Battery & BMS...). Subsystems can be grouped: "HV System" contains "HV Battery & Battery Management", "HV Motors & Motor Data", etc., through `parent_subsystem_id`. Each subsystem belongs to **one vehicle project** (EV or IC) and **one technical department**.

| Column                      | Type               | Req.  | Meaning                                                              | Example                           |
| --------------------------- | ------------------ | :---: | -------------------------------------------------------------------- | --------------------------------- |
| `id`                        | integer            |   ✔   | Primary key                                                          | `2`                               |
| `name`                      | varchar            |   ✔   | Technical name. **Never a role name**                                | `HV Battery & Battery Management` |
| `project_id`                | integer            |   ✔   | FK → `project.id` · `RESTRICT`. The car/phase it belongs to          | `1` (EV 2027)                     |
| `org_unit_id`               | integer            |   ✔   | FK → `org_unit.id` · `RESTRICT`. Must be an `fs_department`          | `14` (Electronics)                |
| `parent_subsystem_id`       | integer            |   —   | FK → `subsystem.id` · `RESTRICT`. **Empty for top-level subsystems** | `1` (HV System)                   |
| `status`                    | `subsystem_status` |   ✔   | `planned` (default), `active`, `blocked`, `complete`                 | `active`                          |
| `created_at` / `updated_at` | timestamp          | ✔ / — | Creation / last modification                                         | —                                 |

**Indexes & constraints**

| Name                                  | On                          | Why it exists                        |
| ------------------------------------- | --------------------------- | ------------------------------------ |
| `ck_subsystem_not_own_parent` (check) | `parent_subsystem_id <> id` | A subsystem cannot be its own parent |
| `idx_subsystem_project_id`            | `project_id`                | "All subsystems of the EV car"       |
| `idx_subsystem_org_unit_id`           | `org_unit_id`               | "All subsystems of Electronics"      |
| `idx_subsystem_parent_subsystem_id`   | `parent_subsystem_id`       | "Children of HV System"              |

**Hierarchy example: Electronics, Phase 1 (EV car, project 1), org_unit 14**

```
subsystem
├── HV System                                            (parent_subsystem_id = empty)
│   ├── HV Battery & Battery Management                  (parent = HV System)
│   ├── HV Motors & Motor Data                           (parent = HV System)
│   └── HV Wiring Harness                                (parent = HV System)
└── LV System                                            (parent_subsystem_id = empty)
    ├── LV Wiring Harness & Inter-System Communication   (parent = LV System)
    ├── Control & Safety Systems                         (parent = LV System)
    └── Sensors & Data Acquisition                       (parent = LV System)
```

**Hierarchy example: Electronics, Phase 2 (IC car, project 2), org_unit 14**: scopes defined, members not yet assigned, so `status = planned` and no rows in `member_subsystem`.

```
subsystem  (project_id = 2 "IC 2027")
├── Wiring Harness                    planned   (shutdown circuit, main harness, connectors...)
├── Safety & Control Systems Design   planned   (BSPD, APPS)
├── Sensors & Actuators               planned   (actuator design, data acquisition)
└── Embedded Systems                  planned   (embedded systems, ECU, dashboard)
```

> **Consequence of one project per subsystem:** a part of the car that exists in both EV and IC versions needs one `subsystem` row per project. This keeps each car's progress, tasks and documents separate.

**Other Formula Student departments** follow the same pattern (top-level, no parent needed): Suspension & Steering → _Steering System, Suspension Design, Vehicle Dynamics_; Powertrain → _Intake / Exhaust, Drivetrain, Braking System, Cooling / Fuel System, EV Powertrain_; Chassis & Ergonomics → _Chassis Design, Ergonomics_; Aerodynamics → _Aerodynamics & CFD, Chassis & Aero_.

---

### 5.2 `member_subsystem`

**Purpose:** who works on which subsystem, and at which level (`main` / `junior`). A member **can have several active assignments** (this is common in Electronics), so there is deliberately no "one subsystem per member" limit. Conditional rules are in Django.

| Column         | Type           | Req. | Meaning                                  | Example                             |
| -------------- | -------------- | :--: | ---------------------------------------- | ----------------------------------- |
| `id`           | integer        |  ✔   | Primary key                              | `1`                                 |
| `subsystem_id` | integer        |  ✔   | FK → `subsystem.id` · `CASCADE`          | `2`                                 |
| `member_id`    | integer        |  ✔   | FK → `member.id` · `RESTRICT`            | `21`                                |
| `member_level` | `member_level` |  ✔   | `main` or `junior` **on this subsystem** | `main`                              |
| `start_date`   | date           |  —   | Start of the assignment                  | `2026-09-15`                        |
| `end_date`     | date           |  —   | End. **Empty = currently active**        | _(empty)_                           |
| `note`         | varchar        |  —   | Free comment                             | `Battery choice & inverter modules` |
| `created_at`   | timestamp      |  ✔   | Creation time                            | —                                   |

**Indexes & constraints**

| Name                                                  | On                                      | Why it exists                                                                                       |
| ----------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `uq_member_subsystem_subsystem_member_start` (unique) | `(subsystem_id, member_id, start_date)` | No duplicate assignment for the same start date (see caveat in [Section 16](#16-points-to-confirm)) |
| `ck_member_subsystem_dates` (check)                   | `end_date >= start_date`                | Coherent dates                                                                                      |
| `idx_member_subsystem_member_id`                      | `member_id`                             | "Everything this person works on"                                                                   |
| `idx_member_subsystem_subsystem_id`                   | `subsystem_id`                          | "Everyone on this subsystem"                                                                        |

**Full example: Electronics Phase 1 assignments (from the org chart)**

| Subsystem                                      | Member                | Level                                                      |
| ---------------------------------------------- | --------------------- | ---------------------------------------------------------- |
| HV Battery & Battery Management                | Yanir Louni           | main                                                       |
|                                                | Bechim Abderaouf      | main                                                       |
| HV Motors & Motor Data                         | Deghnouche Abdessamad | main                                                       |
|                                                | Yanir Louni           | main                                                       |
|                                                | Islam Amrouche        | junior                                                     |
| HV Wiring Harness                              | Amara Lyna Sarah      | main                                                       |
|                                                | Hani Chikhar          | main ⚠️ _(listed as Junior in the roster, see Section 16)_ |
| LV Wiring Harness & Inter-System Communication | Lamis Hachemi         | main                                                       |
|                                                | Chouache Rayane       | main                                                       |
| Control & Safety Systems                       | Deghnouche Abdessamad | main                                                       |
|                                                | Yanir Louni           | main                                                       |
|                                                | Bennouar Amine        | main                                                       |
|                                                | Ayoub Benadir         | junior                                                     |
|                                                | Amir Azzem            | junior                                                     |
| Sensors & Data Acquisition                     | Bouabdallah Halim     | main                                                       |
|                                                | Walid Mahmoudi        | main                                                       |
|                                                | Islam Amrouche        | junior                                                     |
|                                                | Ayoub Benadir         | junior                                                     |

Yanir Louni appears three times, Islam Amrouche and Ayoub Benadir twice each: this is exactly why `member_id` is **not** unique in this table.

---

### 5.3 `lifecycle_step`

**Purpose:** the fixed list of engineering stages every subsystem goes through. It is reference data, filled once.

| Column          | Type      | Req. | Meaning                                                                                                                | Example          |
| --------------- | --------- | :--: | ---------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `id`            | integer   |  ✔   | Primary key                                                                                                            | `2`              |
| `step_order`    | integer   |  ✔   | Position in the sequence (unique)                                                                                      | `2`              |
| `name`          | varchar   |  ✔   | Step name                                                                                                              | `Conception CAD` |
| `applies_to_ic` | boolean   |  ✔   | Step applies to the IC car. Default `true`                                                                             | `true`           |
| `applies_to_ev` | boolean   |  ✔   | Step applies to the EV car. Default `true` (the EV Concept Class may follow a different path; the application decides) | `true`           |
| `created_at`    | timestamp |  ✔   | Creation time                                                                                                          | —                |

**Indexes & constraints:** `step_order` is `UNIQUE`, so two steps cannot share the same position.

**Standard steps**

| step_order | name                   |
| :--------: | ---------------------- |
|     1      | Étude & recherche      |
|     2      | Conception CAD         |
|     3      | Simulation             |
|     4      | Validation par le chef |
|     5      | Fabrication / achat    |
|     6      | Contrôle réception     |
|     7      | Intégration atelier    |

---

### 5.4 `subsystem_step_progress`

**Purpose:** a checklist per subsystem: which lifecycle steps are done, when, and who validated them.

| Column              | Type      | Req. | Meaning                                                                                                               | Example                                  |
| ------------------- | --------- | :--: | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `id`                | integer   |  ✔   | Primary key                                                                                                           | `1`                                      |
| `subsystem_id`      | integer   |  ✔   | FK → `subsystem.id` · `CASCADE`                                                                                       | `2`                                      |
| `lifecycle_step_id` | integer   |  ✔   | FK → `lifecycle_step.id` · `RESTRICT`                                                                                 | `4`                                      |
| `is_complete`       | boolean   |  ✔   | Step finished. Default `false`                                                                                        | `true`                                   |
| `completed_at`      | timestamp |  —   | When it was finished                                                                                                  | `2026-11-20 16:30`                       |
| `validated_by`      | integer   |  —   | FK → `member.id` · `RESTRICT`. For the validation step, Django checks this person holds a leadership role in the unit | `22` (Brahim Khial, Lead of Electronics) |
| `notes`             | text      |  —   | Comments                                                                                                              | `Cell choice approved`                   |
| `created_at`        | timestamp |  ✔   | Creation time                                                                                                         | —                                        |

**Indexes & constraints**

| Name                                                 | On                                  | Why it exists                                |
| ---------------------------------------------------- | ----------------------------------- | -------------------------------------------- |
| `uq_subsystem_step_progress_subsystem_step` (unique) | `(subsystem_id, lifecycle_step_id)` | Each step appears at most once per subsystem |
| `idx_subsystem_step_progress_subsystem_id`           | `subsystem_id`                      | "Progress of this subsystem"                 |
| `idx_subsystem_step_progress_step_id`                | `lifecycle_step_id`                 | "Which subsystems are at step X"             |
| `idx_subsystem_step_progress_validated_by`           | `validated_by`                      | "What did this leader validate"              |

**Example: HV Battery & Battery Management**

| Step                     | is_complete | completed_at | validated_by |
| ------------------------ | :---------: | ------------ | ------------ |
| 1 Étude & recherche      |      ✔      | 2026-10-05   | —            |
| 2 Conception CAD         |      ✔      | 2026-11-02   | —            |
| 3 Simulation             |      ✔      | 2026-11-15   | —            |
| 4 Validation par le chef |      ✔      | 2026-11-20   | Brahim Khial |
| 5 Fabrication / achat    |      ✘      | —            | —            |

---

## 6. Module 4 — Tasks

### 6.1 `task` (hierarchical: tasks and subtasks)

**Purpose:** a unit of work. A **subtask** is simply a task whose `parent_task_id` points to another task. Subtasks have their own status, assignees, and comments. Maximum depth is enforced in Django.

| Column                      | Type            | Req.  | Meaning                                                                 | Example                     |
| --------------------------- | --------------- | :---: | ----------------------------------------------------------------------- | --------------------------- |
| `id`                        | integer         |   ✔   | Primary key                                                             | `10`                        |
| `project_id`                | integer         |   ✔   | FK → `project.id` · `RESTRICT`                                          | `1`                         |
| `parent_task_id`            | integer         |   —   | FK → `task` (with `project_id`) · `CASCADE`. **Empty = top-level task** | `10`                        |
| `subsystem_id`              | integer         |   —   | FK → `subsystem.id` · `RESTRICT`. Subsystem this task supports          | `2`                         |
| `lifecycle_step_id`         | integer         |   —   | FK → `lifecycle_step.id` · `RESTRICT`. Engineering step it belongs to   | `1`                         |
| `title`                     | varchar         |   ✔   | Short title                                                             | `Choose battery cells`      |
| `description`               | text            |   —   | Details                                                                 | `Compare 3 cell suppliers…` |
| `status`                    | `task_status`   |   ✔   | `todo` (default), `in_progress`, `blocked`, `done`                      | `in_progress`               |
| `priority`                  | `task_priority` |   —   | `low`, `medium`, `high`                                                 | `high`                      |
| `due_date`                  | date            |   —   | Deadline                                                                | `2026-10-15`                |
| `created_by`                | integer         |   —   | FK → `member.id` · `RESTRICT`                                           | `22`                        |
| `created_at` / `updated_at` | timestamp       | ✔ / — | Creation / last modification                                            | —                           |

**Indexes & constraints**

| Name                             | On                                                    | Why it exists                                                                                                                                                                       |
| -------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uq_task_id_project` (unique)    | `(id, project_id)`                                    | Technical: gives the composite parent foreign key something to point to                                                                                                             |
| `fk_task_parent` (composite FK)  | `(parent_task_id, project_id) → task(id, project_id)` | **A subtask must be in the same project as its parent.** Example: creating a subtask with `project_id = 2` under parent task 10 (project 1) fails, because `(10, 2)` does not exist |
| `ck_task_not_own_parent` (check) | `parent_task_id <> id`                                | A task cannot be its own parent                                                                                                                                                     |
| `idx_task_project_id`            | `project_id`                                          | "Tasks of this project"                                                                                                                                                             |
| `idx_task_parent_task_id`        | `parent_task_id`                                      | "Subtasks of this task"                                                                                                                                                             |
| `idx_task_status`                | `status`                                              | Kanban columns / "all blocked tasks"                                                                                                                                                |
| `idx_task_due_date`              | `due_date`                                            | "Tasks due this week", overdue alerts                                                                                                                                               |
| `idx_task_subsystem_id`          | `subsystem_id`                                        | "Tasks of this subsystem"                                                                                                                                                           |
| `idx_task_lifecycle_step_id`     | `lifecycle_step_id`                                   | "Tasks at the simulation step"                                                                                                                                                      |
| `idx_task_created_by`            | `created_by`                                          | "Tasks created by this person"                                                                                                                                                      |

**Hierarchy example** (project 1 "EV 2027", subsystem "HV Battery & Battery Management", step 1 "Étude & recherche")

```
task 10  Choose battery cells                     in_progress  high   parent = empty
├── task 11  Compare cell chemistries             done         medium parent = 10
├── task 12  Size the accumulator (kWh / voltage) in_progress  high   parent = 10
└── task 13  Request quotes for sample cells      todo         medium parent = 10
```

Deleting task 10 also deletes tasks 11 to 13 (`ON DELETE CASCADE` on the parent link).

---

### 6.2 `task_assignee`

**Purpose:** who is responsible for a task. Several people can share a task; one of them can be marked as the main owner.

| Column       | Type      | Req. | Meaning                                 | Example |
| ------------ | --------- | :--: | --------------------------------------- | ------- |
| `id`         | integer   |  ✔   | Primary key                             | `1`     |
| `task_id`    | integer   |  ✔   | FK → `task.id` · `CASCADE`              | `10`    |
| `member_id`  | integer   |  ✔   | FK → `member.id` · `RESTRICT`           | `21`    |
| `is_primary` | boolean   |  ✔   | Main owner of the task. Default `false` | `true`  |
| `created_at` | timestamp |  ✔   | Creation time                           | —       |

**Indexes & constraints**

| Name                                             | On                               | Why it exists                                      |
| ------------------------------------------------ | -------------------------------- | -------------------------------------------------- |
| `uq_task_assignee_task_member` (unique)          | `(task_id, member_id)`           | A person cannot be assigned twice to the same task |
| `idx_task_assignee_member_id`                    | `member_id`                      | "My tasks" page                                    |
| `uq_task_assignee_one_primary` (unique, partial) | `task_id` **where `is_primary`** | At most **one** primary owner per task             |

**Example:** task 10 → Yanir Louni (`is_primary = true`), Bechim Abderaouf (`false`). Marking Bechim as primary too would be rejected.

---

### 6.3 `task_comment`

**Purpose:** discussion thread on a task.

| Column       | Type      | Req. | Meaning                       | Example                                            |
| ------------ | --------- | :--: | ----------------------------- | -------------------------------------------------- |
| `id`         | integer   |  ✔   | Primary key                   | `1`                                                |
| `task_id`    | integer   |  ✔   | FK → `task.id` · `CASCADE`    | `10`                                               |
| `author_id`  | integer   |  ✔   | FK → `member.id` · `RESTRICT` | `22`                                               |
| `content`    | text      |  ✔   | Comment text                  | `Please add the thermal limits to the comparison.` |
| `created_at` | timestamp |  ✔   | Posting time                  | `2026-10-02 14:05`                                 |

**Indexes:** `idx_task_comment_task_id` (`task_id`): load the comments of a task quickly. `idx_task_comment_author_id` (`author_id`): "comments written by this person".

---

## 7. Module 5 — Communication

### 7.1 `announcement`

**Purpose:** news posted to the whole club or to a single unit.

| Column        | Type      | Req. | Meaning                                                             | Example                                      |
| ------------- | --------- | :--: | ------------------------------------------------------------------- | -------------------------------------------- |
| `id`          | integer   |  ✔   | Primary key                                                         | `1`                                          |
| `title`       | varchar   |  ✔   | Headline                                                            | `Workshop safety briefing`                   |
| `body`        | text      |  ✔   | Full text                                                           | `Mandatory for everyone using the machines…` |
| `posted_by`   | integer   |  ✔   | FK → `member.id` · `RESTRICT`                                       | `22`                                         |
| `org_unit_id` | integer   |  —   | FK → `org_unit.id` · `RESTRICT`. **Empty = club-wide announcement** | `14` (Electronics only)                      |
| `posted_at`   | timestamp |  ✔   | Publication time                                                    | `2026-09-18 09:00`                           |

**Indexes**

| Name                           | On               | Why it exists                                                    |
| ------------------------------ | ---------------- | ---------------------------------------------------------------- |
| `idx_announcement_org_unit_id` | `org_unit_id`    | "Announcements of this unit"                                     |
| `idx_announcement_posted_by`   | `posted_by`      | "Announcements by this author"                                   |
| `idx_announcement_posted_at`   | `posted_at DESC` | The news feed, **newest first**, without sorting the whole table |

---

### 7.2 `notification`

**Purpose:** personal alerts for one member ("you were assigned a task").

| Column                | Type      | Req. | Meaning                                                            | Example                                    |
| --------------------- | --------- | :--: | ------------------------------------------------------------------ | ------------------------------------------ |
| `id`                  | integer   |  ✔   | Primary key                                                        | `1`                                        |
| `member_id`           | integer   |  ✔   | FK → `member.id` · `CASCADE`. The recipient                        | `21`                                       |
| `message`             | varchar   |  ✔   | Text shown to the user                                             | `You were assigned "Choose battery cells"` |
| `is_read`             | boolean   |  ✔   | Already seen. Default `false`                                      | `false`                                    |
| `related_entity_type` | varchar   |  —   | **Loose pointer** (not a real foreign key): type of related record | `task`                                     |
| `related_entity_id`   | integer   |  —   | Loose pointer: id of the related record                            | `10`                                       |
| `created_at`          | timestamp |  ✔   | Creation time                                                      | `2026-10-01 08:12`                         |

**Indexes**

| Name                              | On                                  | Why it exists                                                                    |
| --------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------- |
| `idx_notification_member_created` | `(member_id, created_at DESC)`      | A member's notification list, newest first                                       |
| `idx_notification_member_unread`  | `member_id` **where `NOT is_read`** | The "🔔 3 unread" badge; only unread rows are indexed, so it stays tiny and fast |

The loose pointer allows one table to notify about tasks, documents, orders, etc. without a foreign key per type.

---

### 7.3 `media_contact`

**Purpose:** tracking of journalist / influencer outreach (from the "Journalistes / médias" sheet).

| Column                      | Type      | Req.  | Meaning                                                              | Example                             |
| --------------------------- | --------- | :---: | -------------------------------------------------------------------- | ----------------------------------- |
| `id`                        | integer   |   ✔   | Primary key                                                          | `1`                                 |
| `journalist_name`           | varchar   |   ✔   | Contact person                                                       | `A. Example`                        |
| `channel_name`              | varchar   |   —   | Outlet or channel                                                    | `Example Tech TV`                   |
| `contact_info`              | varchar   |   —   | Email, phone or social handle                                        | `contact@example.com`               |
| `handled_by`                | integer   |   —   | FK → `member.id` · `RESTRICT`. Club member in charge of this contact | `31`                                |
| `posted_video_link`         | varchar   |   —   | Link to the published video/article                                  | `https://example.com/video/123`     |
| `remarks`                   | text      |   —   | Notes on the exchange                                                | `Interested in an EV workshop tour` |
| `created_at` / `updated_at` | timestamp | ✔ / — | Creation / last modification                                         | —                                   |

**Indexes:** `idx_media_contact_handled_by` (`handled_by`): "contacts handled by this member".

---

## 8. Module 6 — Documents

### 8.1 `document`

**Purpose:** a catalogue of documents (CAD files, reports, technical documents...). **The files themselves stay on Google Drive**; the database only stores the link and the metadata.

| Column                      | Type              | Req.  | Meaning                                                     | Example                        |
| --------------------------- | ----------------- | :---: | ----------------------------------------------------------- | ------------------------------ |
| `id`                        | integer           |   ✔   | Primary key                                                 | `1`                            |
| `title`                     | varchar           |   ✔   | Document title                                              | `Accumulator container CAD v3` |
| `type`                      | `document_type`   |   ✔   | `cad`, `report`, `technical_doc`, `drawing`, `admin`, `faq` | `cad`                          |
| `org_unit_id`               | integer           |   —   | FK → `org_unit.id` · `RESTRICT`. Owning unit                | `14`                           |
| `subsystem_id`              | integer           |   —   | FK → `subsystem.id` · `RESTRICT`. Subsystem it concerns     | `2`                            |
| `uploaded_by`               | integer           |   ✔   | FK → `member.id` · `RESTRICT`                               | `21`                           |
| `status`                    | `document_status` |   ✔   | `draft` (default), `in_review`, `approved`, `rejected`      | `in_review`                    |
| `drive_url`                 | varchar           |   ✔   | Link to the Google Drive file or folder                     | `https://drive.google.com/…`   |
| `created_at` / `updated_at` | timestamp         | ✔ / — | Creation / last modification                                | —                              |

**Indexes**

| Name                        | On             | Why it exists                                  |
| --------------------------- | -------------- | ---------------------------------------------- |
| `idx_document_org_unit_id`  | `org_unit_id`  | "Documents of Electronics"                     |
| `idx_document_subsystem_id` | `subsystem_id` | "Documents of this subsystem"                  |
| `idx_document_uploaded_by`  | `uploaded_by`  | "My uploads"                                   |
| `idx_document_status`       | `status`       | The review queue ("all `in_review` documents") |
| `idx_document_type`         | `type`         | "All CAD files"                                |

---

## 9. Module 7 — Purchasing & Procurement

This module reproduces the real "Pièces & Commandes" and "Fournisseurs entreprises" sheets.

```
part ───▶ purchase_request ───▶ purchase_order ───▶ supplier
 (what)     (who needs it,          (who supplies it,      │
            how many)                price, delivery)      ▼
                                       │  ▲            invoice ───▶ invoice_line_item
                                       │  └─ shipping_address (optional)
                                       ▼
                     stock_movement ("in")    expense ───▶ budget
```

### 9.1 `supplier`

**Purpose:** companies the club buys from or subcontracts to, with their validation status.

| Column                          | Type              | Req.  | Meaning                                                                       | Example                                   |
| ------------------------------- | ----------------- | :---: | ----------------------------------------------------------------------------- | ----------------------------------------- |
| `id`                            | integer           |   ✔   | Primary key                                                                   | `1`                                       |
| `name`                          | varchar           |   ✔   | Company name                                                                  | `Example Machining SARL`                  |
| `type`                          | `supplier_type`   |   —   | `fournisseur`, `sous_traitant`, `mixte`, `usinage`, `logistique`              | `usinage`                                 |
| `status`                        | `supplier_status` |   ✔   | Validation state (column "Statut" of the sheet). Default `pas_encore_envoyee` | `en_attente`                              |
| `technical_capabilities`        | text              |   —   | What they can make                                                            | `CNC milling, 5 axes, aluminium`          |
| `address` / `city` / `country`  | varchar           |   —   | Location                                                                      | `Zone industrielle` / `Blida` / `Algeria` |
| `contact_name` / `contact_role` | varchar           |   —   | Contact person and their function                                             | `M. Example` / `Sales manager`            |
| `email` / `phone`               | varchar           |   —   | Contact details                                                               | `sales@example.com` / `+213 …`            |
| `contacted_by`                  | integer           |   —   | FK → `member.id` · `RESTRICT`. Club member who reached out                    | `35`                                      |
| `average_lead_time_days`        | integer           |   —   | Typical delivery time in days. Must be ≥ 0                                    | `14`                                      |
| `comments`                      | text              |   —   | Free notes                                                                    | `Fast quotes, asks 50% upfront`           |
| `created_at` / `updated_at`     | timestamp         | ✔ / — | Creation / last modification                                                  | —                                         |

**Indexes & constraints**

| Name                              | On             | Why it exists                        |
| --------------------------------- | -------------- | ------------------------------------ |
| check on `average_lead_time_days` | `>= 0`         | No negative delivery times           |
| `idx_supplier_name`               | `name`         | Search by name                       |
| `idx_supplier_status`             | `status`       | "All validated suppliers"            |
| `idx_supplier_type`               | `type`         | "All machining shops"                |
| `idx_supplier_contacted_by`       | `contacted_by` | "Suppliers contacted by this member" |

---

### 9.2 `part`

**Purpose:** a part or item the club needs (a brake disc, a bearing, a workshop tool), with its category and manufacturing process.

| Column                      | Type            | Req.  | Meaning                                                   | Example                                     |
| --------------------------- | --------------- | :---: | --------------------------------------------------------- | ------------------------------------------- |
| `id`                        | integer         |   ✔   | Primary key                                               | `1`                                         |
| `category`                  | `part_category` |   ✔   | Category of the sheet (default `other`)                   | `brakes`                                    |
| `name`                      | varchar         |   ✔   | Part name                                                 | `Brake disc (front)`                        |
| `description`               | text            |   —   | Details                                                   | `Floating disc, 220 mm`                     |
| `reference`                 | varchar         |   —   | Manufacturer / catalogue reference                        | `BD-220-F`                                  |
| `quantity`                  | integer         |   —   | Quantity needed (≥ 0)                                     | `4`                                         |
| `material`                  | varchar         |   —   | Material                                                  | `Stainless steel`                           |
| `process`                   | varchar         |   —   | Manufacturing process                                     | `Usinage`, `Impression 3D`, `Découpe laser` |
| `subsystem_id`              | integer         |   —   | FK → `subsystem.id` · `RESTRICT`. Subsystem that needs it | `20` (Braking System)                       |
| `org_unit_id`               | integer         |   —   | FK → `org_unit.id` · `RESTRICT`. Owning unit              | `12` (Powertrain)                           |
| `created_at` / `updated_at` | timestamp       | ✔ / — | Creation / last modification                              | —                                           |

**Indexes:** `idx_part_category` (`category`): filter by sheet category. `idx_part_subsystem_id` (`subsystem_id`): "parts of this subsystem". `idx_part_org_unit_id` (`org_unit_id`): "parts of this unit". `idx_part_reference` (`reference`): look up by reference.

---

### 9.3 `purchase_request`

**Purpose:** someone asks for a part to be bought.

| Column                      | Type              | Req.  | Meaning                                                   | Example                   |
| --------------------------- | ----------------- | :---: | --------------------------------------------------------- | ------------------------- |
| `id`                        | integer           |   ✔   | Primary key                                               | `1`                       |
| `part_id`                   | integer           |   ✔   | FK → `part.id` · `RESTRICT`                               | `1`                       |
| `requested_by`              | integer           |   ✔   | FK → `member.id` · `RESTRICT`                             | `30`                      |
| `quantity`                  | integer           |   ✔   | Quantity requested, must be > 0                           | `4`                       |
| `priority`                  | `task_priority`   |   —   | `low`, `medium`, `high`                                   | `high`                    |
| `requested_date`            | date              |   —   | Date of the request                                       | `2026-10-10`              |
| `status`                    | `purchase_status` |   ✔   | `a_commander` (default), `en_commande`, `livre`, `annule` | `a_commander`             |
| `notes`                     | text              |   —   | Comments                                                  | `Needed before dyno test` |
| `created_at` / `updated_at` | timestamp         | ✔ / — | Creation / last modification                              | —                         |

**Indexes:** `idx_purchase_request_part_id` (`part_id`), `idx_purchase_request_requested_by` (`requested_by`), `idx_purchase_request_status` (`status`): "everything still to order".

---

### 9.4 `shipping_address`

**Purpose:** reusable delivery addresses (workshop, a freight forwarder abroad...).

| Column         | Type      | Req. | Meaning                                         | Example                             |
| -------------- | --------- | :--: | ----------------------------------------------- | ----------------------------------- |
| `id`           | integer   |  ✔   | Primary key                                     | `1`                                 |
| `country`      | varchar   |  —   | Country                                         | `Algeria`                           |
| `address`      | text      |  ✔   | Full address                                    | `Example workshop address, Algiers` |
| `contacted_by` | integer   |  —   | FK → `member.id` · `RESTRICT`. Member in charge | `36`                                |
| `created_at`   | timestamp |  ✔   | Creation time                                   | —                                   |

**Indexes:** `idx_shipping_address_contacted_by` (`contacted_by`).

---

### 9.5 `purchase_order`

**Purpose:** the actual order of a request placed with one supplier: prices, delivery costs, dates and status.

| Column                      | Type              | Req.  | Meaning                                                              | Example      |
| --------------------------- | ----------------- | :---: | -------------------------------------------------------------------- | ------------ |
| `id`                        | integer           |   ✔   | Primary key                                                          | `1`          |
| `purchase_request_id`       | integer           |   ✔   | FK → `purchase_request.id` · `RESTRICT`                              | `1`          |
| `supplier_id`               | integer           |   ✔   | FK → `supplier.id` · `RESTRICT`                                      | `1`          |
| `shipping_address_id`       | integer           |   —   | FK → `shipping_address.id` · `RESTRICT`. Delivery address            | `1`          |
| `unit_price`                | numeric(12,2)     |   —   | Price per unit, ≥ 0                                                  | `4500.00`    |
| `delivery_cost`             | numeric(12,2)     |   ✔   | Shipping cost, default 0, ≥ 0                                        | `800.00`     |
| `customs_cost`              | numeric(12,2)     |   ✔   | Customs / duties, default 0, ≥ 0                                     | `0.00`       |
| `total_price`               | numeric(12,2)     |   —   | **Computed in Django**: `unit_price × quantity + delivery + customs` | `18800.00`   |
| `ordered_at`                | date              |   —   | Date the order was placed                                            | `2026-10-12` |
| `estimated_delivery_date`   | date              |   —   | Promised delivery                                                    | `2026-10-26` |
| `actual_delivery_date`      | date              |   —   | Real delivery                                                        | `2026-10-29` |
| `status`                    | `purchase_status` |   ✔   | `a_commander`, `en_commande` (default), `livre`, `annule`            | `livre`      |
| `created_at` / `updated_at` | timestamp         | ✔ / — | Creation / last modification                                         | —            |

**Indexes & constraints**

| Name                              | On                                           | Why it exists                           |
| --------------------------------- | -------------------------------------------- | --------------------------------------- |
| `ck_purchase_order_dates` (check) | estimated and actual delivery ≥ `ordered_at` | No delivery before the order was placed |
| `idx_purchase_order_request_id`   | `purchase_request_id`                        | "Orders of this request"                |
| `idx_purchase_order_supplier_id`  | `supplier_id`                                | "Orders placed with this supplier"      |
| `idx_purchase_order_shipping_id`  | `shipping_address_id`                        | "Orders delivered to this address"      |
| `idx_purchase_order_status`       | `status`                                     | "Orders still in transit"               |

**Worked example:** request 1 asks for 4 brake discs. Order 1 at 4 500.00 each, 800.00 delivery, no customs → `4 × 4500 + 800 + 0 = 18 800.00`. Typical life: request `a_commander` → order `en_commande` → order `livre`.

---

### 9.6 `invoice`

**Purpose:** an invoice received from a supplier.

| Column         | Type          | Req. | Meaning                         | Example         |
| -------------- | ------------- | :--: | ------------------------------- | --------------- |
| `id`           | integer       |  ✔   | Primary key                     | `1`             |
| `supplier_id`  | integer       |  ✔   | FK → `supplier.id` · `RESTRICT` | `1`             |
| `reference`    | varchar       |  ✔   | Invoice number                  | `FAC-2026-0042` |
| `total_amount` | numeric(12,2) |  ✔   | Amount, ≥ 0                     | `18800.00`      |
| `issued_at`    | date          |  —   | Issue date                      | `2026-10-27`    |
| `created_at`   | timestamp     |  ✔   | Creation time                   | —               |

**Indexes & constraints:** `uq_invoice_supplier_reference` (unique on `(supplier_id, reference)`): the same supplier cannot have two invoices with the same number (different suppliers may). `idx_invoice_issued_at` (`issued_at`): reports by period.

---

### 9.7 `invoice_line_item`

**Purpose:** the individual lines of an invoice.

| Column        | Type          | Req. | Meaning                                                | Example             |
| ------------- | ------------- | :--: | ------------------------------------------------------ | ------------------- |
| `id`          | integer       |  ✔   | Primary key                                            | `1`                 |
| `invoice_id`  | integer       |  ✔   | FK → `invoice.id` · `CASCADE`                          | `1`                 |
| `description` | text          |  ✔   | Line description                                       | `Brake disc 220 mm` |
| `quantity`    | numeric(12,3) |  ✔   | Quantity (decimals allowed, e.g. metres of cable), > 0 | `4.000`             |
| `unit_price`  | numeric(12,2) |  ✔   | Price per unit, ≥ 0                                    | `4500.00`           |
| `total_price` | numeric(12,2) |  ✔   | Line total, ≥ 0                                        | `18000.00`          |

**Indexes:** `idx_invoice_line_item_invoice_id` (`invoice_id`): load all lines of an invoice.

---

## 10. Module 8 — Stock & Logistics

### 10.1 `stock_item`

**Purpose:** how much of a part is physically in stock and where.

| Column               | Type      | Req. | Meaning                                                                                | Example    |
| -------------------- | --------- | :--: | -------------------------------------------------------------------------------------- | ---------- |
| `id`                 | integer   |  ✔   | Primary key                                                                            | `1`        |
| `part_id`            | integer   |  ✔   | FK → `part.id` · `RESTRICT`. Not unique: the same part may be stored in several places | `1`        |
| `quantity_available` | integer   |  ✔   | Units in stock, default 0, ≥ 0. Computed from movements in Django                      | `5`        |
| `location`           | varchar   |  —   | Storage place                                                                          | `Shelf B2` |
| `min_threshold`      | integer   |  ✔   | Alert level, default 0, ≥ 0                                                            | `6`        |
| `updated_at`         | timestamp |  —   | Last modification                                                                      | —          |

**Indexes**

| Name                       | On                                                        | Why it exists                                                                    |
| -------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `idx_stock_item_part_id`   | `part_id`                                                 | "Stock of this part"                                                             |
| `idx_stock_item_low_stock` | `part_id` **where `quantity_available <= min_threshold`** | Instant **low-stock alert list**; only the few items under threshold are indexed |

**Example:** 5 units in stock with threshold 6 → 5 ≤ 6 → the item appears in the low-stock alerts.

---

### 10.2 `stock_movement`

**Purpose:** the history of every entry, exit, or correction. Stock quantities are derived from it.

| Column                      | Type                  | Req. | Meaning                                                                | Example                         |
| --------------------------- | --------------------- | :--: | ---------------------------------------------------------------------- | ------------------------------- |
| `id`                        | integer               |  ✔   | Primary key                                                            | `1`                             |
| `stock_item_id`             | integer               |  ✔   | FK → `stock_item.id` · `RESTRICT`                                      | `1`                             |
| `movement_type`             | `stock_movement_type` |  ✔   | `in`, `out`, `adjustment`                                              | `in`                            |
| `quantity`                  | integer               |  ✔   | `in` / `out`: positive. `adjustment`: signed and non-zero              | `8`                             |
| `related_purchase_order_id` | integer               |  —   | FK → `purchase_order.id` · `RESTRICT`. Order that brought the goods in | `1`                             |
| `related_task_id`           | integer               |  —   | FK → `task.id` · `SET NULL`. Task that consumed the goods              | `10`                            |
| `moved_by`                  | integer               |  ✔   | FK → `member.id` · `RESTRICT`                                          | `36`                            |
| `moved_at`                  | timestamp             |  ✔   | When it happened (default now)                                         | `2026-10-29 11:00`              |
| `notes`                     | text                  |  —   | Comment                                                                | `Delivery received, box intact` |

**Indexes & constraints**

| Name                                   | On                                                     | Why it exists                                   |
| -------------------------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| `ck_stock_movement_quantity` (check)   | `adjustment` → quantity ≠ 0; `in`/`out` → quantity > 0 | Prevents meaningless movements such as "out −3" |
| `idx_stock_movement_stock_item_id`     | `stock_item_id`                                        | History of one stock item                       |
| `idx_stock_movement_moved_at`          | `moved_at`                                             | Movements over a period                         |
| `idx_stock_movement_purchase_order_id` | `related_purchase_order_id`                            | "What came in with this order"                  |
| `idx_stock_movement_task_id`           | `related_task_id`                                      | "What did this task consume"                    |
| `idx_stock_movement_moved_by`          | `moved_by`                                             | "Movements by this person"                      |

**Example history of stock item 1**

| movement_type | quantity | linked to                | running total |
| ------------- | -------: | ------------------------ | ------------: |
| `in`          |        8 | purchase order 1         |             8 |
| `out`         |        2 | task 10                  |             6 |
| `adjustment`  |       −1 | _(recount, one damaged)_ |             5 |

---

## 11. Module 9 — Workshops & Equipment

Modeled on the "Workshop" rows of the parts sheet: compressor, table saw, hydraulic press, 3D printer, etc.

### 11.1 `equipment`

**Purpose:** a machine or tool of the workshop that members can reserve and that needs maintenance.

| Column                      | Type               | Req.  | Meaning                                                                        | Example           |
| --------------------------- | ------------------ | :---: | ------------------------------------------------------------------------------ | ----------------- |
| `id`                        | integer            |   ✔   | Primary key                                                                    | `1`               |
| `name`                      | varchar            |   ✔   | Equipment name                                                                 | `Hydraulic press` |
| `category`                  | varchar            |   —   | Free category                                                                  | `Metalworking`    |
| `status`                    | `equipment_status` |   ✔   | `available` (default), `borrowed`, `maintenance`, `reserved`, `out_of_service` | `available`       |
| `location`                  | varchar            |   —   | Where it is kept                                                               | `Workshop, bay 2` |
| `purchased_at`              | date               |   —   | Purchase date                                                                  | `2025-03-14`      |
| `last_maintenance_at`       | date               |   —   | Last maintenance date                                                          | `2026-06-01`      |
| `created_at` / `updated_at` | timestamp          | ✔ / — | Creation / last modification                                                   | —                 |

**Indexes:** `idx_equipment_status` (`status`): "what is available right now". `idx_equipment_category` (`category`): browse by category.

---

### 11.2 `equipment_reservation`

**Purpose:** booking of a piece of equipment for a time slot.

| Column          | Type                 | Req. | Meaning                                                    | Example            |
| --------------- | -------------------- | :--: | ---------------------------------------------------------- | ------------------ |
| `id`            | integer              |  ✔   | Primary key                                                | `1`                |
| `equipment_id`  | integer              |  ✔   | FK → `equipment.id` · `CASCADE`                            | `1`                |
| `reserved_by`   | integer              |  ✔   | FK → `member.id` · `RESTRICT`                              | `30`               |
| `reserved_from` | timestamp            |  ✔   | Start of the slot                                          | `2027-03-10 09:00` |
| `reserved_to`   | timestamp            |  ✔   | End of the slot (must be after the start)                  | `2027-03-10 12:00` |
| `status`        | `reservation_status` |  ✔   | `pending` (default), `confirmed`, `cancelled`, `completed` | `confirmed`        |
| `created_at`    | timestamp            |  ✔   | Creation time                                              | —                  |

**Indexes & constraints**

| Name                                                         | On                                                                                        | Why it exists                                                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `ck_equipment_reservation_period` (check)                    | `reserved_to > reserved_from`                                                             | A slot must have a positive duration                                                                 |
| `ex_equipment_reservation_no_overlap` (exclusion constraint) | same `equipment_id` **and** overlapping time ranges, **only for `pending` / `confirmed`** | **No double booking.** Uses the `btree_gist` PostgreSQL extension (enabled at the top of the schema) |
| `idx_equipment_reservation_equipment_id`                     | `equipment_id`                                                                            | "Bookings of this machine"                                                                           |
| `idx_equipment_reservation_reserved_by`                      | `reserved_by`                                                                             | "My bookings"                                                                                        |

**How the no-overlap rule behaves** (hydraulic press, 10 March 2027):

| Booking | Slot          | Status    | Result                                                          |
| ------- | ------------- | --------- | --------------------------------------------------------------- |
| A       | 09:00 → 12:00 | confirmed | ✅ accepted                                                     |
| B       | 11:00 → 13:00 | pending   | ❌ rejected: overlaps A                                         |
| C       | 12:00 → 14:00 | pending   | ✅ accepted: starts exactly when A ends (end time is exclusive) |
| D       | 10:00 → 11:00 | cancelled | ✅ accepted: cancelled bookings are ignored by the rule         |

---

### 11.3 `equipment_maintenance`

**Purpose:** log of maintenance operations on equipment.

| Column         | Type          | Req. | Meaning                         | Example                  |
| -------------- | ------------- | :--: | ------------------------------- | ------------------------ |
| `id`           | integer       |  ✔   | Primary key                     | `1`                      |
| `equipment_id` | integer       |  ✔   | FK → `equipment.id` · `CASCADE` | `1`                      |
| `performed_by` | integer       |  ✔   | FK → `member.id` · `RESTRICT`   | `36`                     |
| `performed_at` | timestamp     |  ✔   | When (default now)              | `2026-06-01 15:00`       |
| `description`  | text          |  —   | What was done                   | `Hydraulic oil replaced` |
| `cost`         | numeric(12,2) |  —   | Cost, ≥ 0                       | `3500.00`                |
| `created_at`   | timestamp     |  ✔   | Creation time                   | —                        |

**Indexes:** `idx_equipment_maintenance_equipment_id` (`equipment_id`): maintenance history of a machine. `idx_equipment_maintenance_performed_by` (`performed_by`).

---

## 12. Module 10 — Budget & Finance

### 12.1 `budget`

**Purpose:** the money allocated to an org unit for a fiscal year.

| Column                      | Type          | Req.  | Meaning                                      | Example            |
| --------------------------- | ------------- | :---: | -------------------------------------------- | ------------------ |
| `id`                        | integer       |   ✔   | Primary key                                  | `1`                |
| `org_unit_id`               | integer       |   ✔   | FK → `org_unit.id` · `RESTRICT`. Owning unit | `14` (Electronics) |
| `fiscal_year`               | varchar       |   ✔   | Year label                                   | `2026-2027`        |
| `allocated_amount`          | numeric(12,2) |   ✔   | Allocated money, default 0, ≥ 0              | `500000.00`        |
| `created_at` / `updated_at` | timestamp     | ✔ / — | Creation / last modification                 | —                  |

**Indexes & constraints:** `uq_budget_org_unit_year` (unique on `(org_unit_id, fiscal_year)`): a unit has only **one budget per year**.

**Hierarchy note:** budgets attach to any level of the org tree, so a budget can exist for "Formula Student Team" (9) and for each of its technical departments (10 to 14).

---

### 12.2 `expense`

**Purpose:** money actually spent, charged to a budget, optionally traced back to the order or invoice that caused it.

| Column              | Type          | Req. | Meaning                               | Example      |
| ------------------- | ------------- | :--: | ------------------------------------- | ------------ |
| `id`                | integer       |  ✔   | Primary key                           | `1`          |
| `budget_id`         | integer       |  ✔   | FK → `budget.id` · `RESTRICT`         | `1`          |
| `purchase_order_id` | integer       |  —   | FK → `purchase_order.id` · `RESTRICT` | `1`          |
| `invoice_id`        | integer       |  —   | FK → `invoice.id` · `RESTRICT`        | `1`          |
| `amount`            | numeric(12,2) |  ✔   | Amount spent, ≥ 0                     | `18800.00`   |
| `category`          | varchar       |  —   | Free category                         | `Brakes`     |
| `recorded_by`       | integer       |  ✔   | FK → `member.id` · `RESTRICT`         | `30`         |
| `recorded_at`       | date          |  ✔   | Accounting date (default today)       | `2026-10-29` |
| `created_at`        | timestamp     |  ✔   | Creation time                         | —            |

**Indexes:** `idx_expense_budget_id` (`budget_id`): "spent so far vs allocated". `idx_expense_purchase_order_id`, `idx_expense_invoice_id`: trace an expense back to its source. `idx_expense_recorded_by`: "expenses recorded by this person". `idx_expense_recorded_at` (`recorded_at`): reports by month or year.

**Budget follow-up example:** budget 1 = 500 000.00; expense 1 = 18 800.00 → remaining = 481 200.00 (computed by reports, not stored).

---

### 12.3 `sponsorship`

**Purpose:** sponsor pipeline, from first contact to confirmed deal, with money or in-kind support.

| Column                           | Type                 | Req.  | Meaning                                                                   | Example                               |
| -------------------------------- | -------------------- | :---: | ------------------------------------------------------------------------- | ------------------------------------- |
| `id`                             | integer              |   ✔   | Primary key                                                               | `1`                                   |
| `sponsor_name`                   | varchar              |   ✔   | Company or person                                                         | `Example Motors`                      |
| `amount`                         | numeric(12,2)        |   —   | Cash amount, ≥ 0. Empty for pure in-kind support                          | `200000.00`                           |
| `in_kind_description`            | text                 |   —   | Non-cash support                                                          | `CNC machining of 10 parts`           |
| `contact_name` / `contact_email` | varchar              |   —   | Sponsor contact                                                           | `S. Example` / `partners@example.com` |
| `status`                         | `sponsorship_status` |   ✔   | `prospect` (default), `contacted`, `negotiating`, `confirmed`, `declined` | `negotiating`                         |
| `managed_by`                     | integer              |   —   | FK → `member.id` · `RESTRICT`. Member handling the sponsor                | `34`                                  |
| `created_at` / `updated_at`      | timestamp            | ✔ / — | Creation / last modification                                              | —                                     |

**Indexes:** `idx_sponsorship_status` (`status`): pipeline view. `idx_sponsorship_managed_by` (`managed_by`): "sponsors I handle".

---

## 13. Module 11 — Dashboard & Reporting

Reports are mostly **views and aggregations** over the tables above (tasks by status, budget used, low stock...). Only user-saved custom views need storage.

### 13.1 `saved_report`

| Column        | Type      | Req. | Meaning                                                              | Example                        |
| ------------- | --------- | :--: | -------------------------------------------------------------------- | ------------------------------ |
| `id`          | integer   |  ✔   | Primary key                                                          | `1`                            |
| `name`        | varchar   |  ✔   | Report name                                                          | `Electronics: tasks by status` |
| `created_by`  | integer   |  ✔   | FK → `member.id` · `CASCADE` (a member's saved reports go with them) | `22`                           |
| `config_json` | jsonb     |  ✔   | Report settings in flexible JSON. Default `{}`                       | see below                      |
| `created_at`  | timestamp |  ✔   | Creation time                                                        | —                              |

```json
{
  "report": "tasks_by_status",
  "filters": { "project_id": 1, "org_unit_id": 14 },
  "chart": "bar"
}
```

**Indexes:** `idx_saved_report_created_by` (`created_by`): "my saved reports". Using JSON here lets the dashboard evolve without changing the schema.

---

## 14. Module 12 — Technical Data / Telemetry

```
competition_edition (optional) ──▶ telemetry_session ──▶ telemetry_data_point (many per session)
                                        ▲
                              subsystem (optional)
```

### 14.1 `competition_edition`

**Purpose:** a competition edition (name + year) that test or race sessions can belong to.

| Column       | Type      | Req. | Meaning          | Example                       |
| ------------ | --------- | :--: | ---------------- | ----------------------------- |
| `id`         | integer   |  ✔   | Primary key      | `1`                           |
| `name`       | varchar   |  ✔   | Competition name | `Formula Student Competition` |
| `year`       | integer   |  ✔   | Edition year     | `2027`                        |
| `location`   | varchar   |  —   | Venue            | `TBD`                         |
| `created_at` | timestamp |  ✔   | Creation time    | —                             |

**Constraints:** `uq_competition_edition_name_year` (unique on `(name, year)`): each edition is recorded once.

---

### 14.2 `telemetry_session`

**Purpose:** one recording session (a test day, a dynamic event run...).

| Column                   | Type      | Req. | Meaning                                                                                       | Example                  |
| ------------------------ | --------- | :--: | --------------------------------------------------------------------------------------------- | ------------------------ |
| `id`                     | integer   |  ✔   | Primary key                                                                                   | `1`                      |
| `competition_edition_id` | integer   |  —   | FK → `competition_edition.id` · `RESTRICT`. **Empty for test sessions outside a competition** | _(empty)_                |
| `subsystem_id`           | integer   |  —   | FK → `subsystem.id` · `RESTRICT`. Subsystem being tested                                      | `2`                      |
| `session_date`           | date      |  ✔   | Day of the session                                                                            | `2027-02-20`             |
| `session_type`           | varchar   |  —   | Free label                                                                                    | `Battery discharge test` |
| `recorded_by`            | integer   |  ✔   | FK → `member.id` · `RESTRICT`                                                                 | `21`                     |
| `created_at`             | timestamp |  ✔   | Creation time                                                                                 | —                        |

**Indexes:** `idx_telemetry_session_edition_id`, `idx_telemetry_session_subsystem_id`, `idx_telemetry_session_recorded_by`, and `idx_telemetry_session_date` (`session_date`): find sessions by competition, subsystem, author, or date.

---

### 14.3 `telemetry_data_point`

**Purpose:** the raw sensor readings: **very high volume** (millions of rows), hence a `bigint` id and compact `double precision` values.

| Column                 | Type             | Req. | Meaning                                                                           | Example           |
| ---------------------- | ---------------- | :--: | --------------------------------------------------------------------------------- | ----------------- |
| `id`                   | bigint           |  ✔   | Primary key                                                                       | `9000001`         |
| `telemetry_session_id` | integer          |  ✔   | FK → `telemetry_session.id` · `CASCADE` (deleting a session deletes its readings) | `1`               |
| `timestamp_ms`         | bigint           |  ✔   | Milliseconds since the session start                                              | `1200`            |
| `sensor_name`          | varchar          |  ✔   | Which sensor                                                                      | `battery_voltage` |
| `value`                | double precision |  ✔   | Measured value                                                                    | `398.4`           |
| `unit`                 | varchar          |  —   | Unit                                                                              | `V`               |

**Indexes:** `idx_telemetry_data_point_session_sensor_time` on `(telemetry_session_id, sensor_name, timestamp_ms)`. It answers the typical graph query "give me sensor X of session Y in time order" straight from the index, with no sorting.

**Example rows (session 1)**

| timestamp_ms | sensor_name      | value | unit |
| -----------: | ---------------- | ----: | ---- |
|            0 | battery_voltage  | 401.2 | V    |
|            0 | pack_temperature |  24.5 | °C   |
|         1200 | battery_voltage  | 398.4 | V    |
|         1200 | pack_temperature |  24.9 | °C   |

---

## 15. Rules enforced in Django (not in the database)

The schema deliberately leaves these cross-table rules to the application, because they depend on several tables at once or may change over time:

| Rule                                                                     | Where it applies                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------ |
| A member's org unit must match the subsystem's org unit                  | `membership` / `member_subsystem` vs `subsystem` |
| Project Manager eligibility (role flag + project category + org unit)    | `project.project_manager_id`                     |
| Subsystem-assignment cardinality (who may hold several assignments)      | `member_subsystem`                               |
| Subsystems may only be owned by `fs_department` units                    | `subsystem.org_unit_id`                          |
| `alumni_profile` only for members with `status = alumni`                 | `alumni_profile`                                 |
| `member_level` required for regular members, empty for leadership roles  | `membership.member_level`                        |
| Maximum depth of subtasks                                                | `task.parent_task_id`                            |
| Validation step must be signed by a leadership role of the unit          | `subsystem_step_progress.validated_by`           |
| `total_price` of an order = `unit_price × quantity + delivery + customs` | `purchase_order.total_price`                     |
| Stock quantity is derived from stock movements                           | `stock_item.quantity_available`                  |

---

## 16. Points to confirm

Things noticed while comparing the org chart, the roadmap, and the schema. None blocks the design, but each is worth a decision before data is loaded.

1. **Department name mismatch.** The org chart calls department 1.5 _"Business Development / Business Projects"_, while the schema and its seed script use _"Département Business & Innovation"_. The official name should be chosen before seeding.
2. **Hani Chikhar's level.** He is listed as a **Junior Member** of Electronics, but the roadmap lists him as a **Main Member** of HV Wiring Harness. The schema can store both (department level in `membership`, subsystem level in `member_subsystem`), but the intention should be confirmed.
3. **Name order.** The chart mixes "Surname Firstname" (e.g. _Bengoumida Youcef_) and "Firstname Surname" (e.g. _Mohamed Amine Ould Khaoua_). A clean list with separate first and last names is needed to fill `member.first_name` / `member.last_name`.
4. **No currency.** All amounts are plain numbers. With foreign suppliers and customs costs, several currencies (DZD, EUR, USD...) may appear. Either fix one currency for the whole ERP or add a currency column.
5. **Duplicates with empty start dates.** In PostgreSQL an empty value is never considered equal to another empty value, so `uq_membership_member_org_role_start` and `uq_member_subsystem_subsystem_member_start` do **not** block duplicates when `start_date` is empty. Fix: make `start_date` mandatory, or add a rule in Django.
6. **Role types for Formula Student leadership.** `member_role_type` only offers `admin`, `head_of_department`, `member`. How Team Lead, Chief Engineer, Manufacturing & Workshop Lead, and Team Manager map onto these should be decided (the role table examples in 3.1 are illustrative).
7. **One project per subsystem.** For departments other than Electronics, the chart does not say whether a subsystem belongs to the EV car, the IC car, or both. Subsystems used by both cars need one row per project.

---

## Appendix A — Deletion behaviour of foreign keys (summary)

| Rule                                             | Foreign keys                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`CASCADE`** (children deleted with the parent) | `alumni_profile.member_id` · `project_member.project_id` · `member_subsystem.subsystem_id` · `subsystem_step_progress.subsystem_id` · `task.parent_task_id` · `task_assignee.task_id` · `task_comment.task_id` · `notification.member_id` · `invoice_line_item.invoice_id` · `equipment_reservation.equipment_id` · `equipment_maintenance.equipment_id` · `saved_report.created_by` · `telemetry_data_point.telemetry_session_id` |
| **`SET NULL`** (link cleared, row kept)          | `membership.subsystem_id` · `stock_movement.related_task_id`                                                                                                                                                                                                                                                                                                                                                                       |
| **`RESTRICT`** (deletion blocked)                | Every other foreign key, so that history (people, orders, invoices, expenses...) is never silently lost                                                                                                                                                                                                                                                                                                                            |
