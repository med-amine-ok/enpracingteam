-- ============================================================
-- ENP Racing - Full ERP Schema
-- Task & Project Management + Members + Communication + Documents
-- + Purchasing + Stock + Equipment + Finance + Reporting + Telemetry
-- Target: PostgreSQL
--
-- General structure:
--   Conseil d'Administration + Bureau Executif + 6 departments
--   (Projet, Formation & Industrie, Medias & Journalisme Scientifique,
--    Systemes d'Information, Business & Innovation,
--    Operations & Partenariats).
--   The Projet department runs Formula Student (main project) and one
--   complementary competition project. Poles / sub-departments / teams
--   can be created temporarily or permanently -> single self-referencing
--   org_unit table. Every "department_id" of the old ERP schema is now
--   an org_unit_id.
--
-- MODULES
--   1. Members & Organization   (role, member, alumni_profile, org_unit, membership)
--   2. Projects                 (project, project_member)
--   3. Formula Student Subsystems & Lifecycle
--   4. Tasks                    (task, task_assignee, task_comment)
--   5. Communication            (announcement, notification, media_contact)
--   6. Documents
--   7. Purchasing & Procurement
--   8. Stock & Logistics
--   9. Workshops & Equipment
--  10. Budget & Finance
--  11. Dashboard & Reporting
--  12. Technical Data / Telemetry
--
-- Cross-table business rules (Member.OrgUnit == Subsystem.OrgUnit,
-- PM eligibility, subsystem-assignment cardinality, fs_department-only
-- subsystem ownership, alumni_profile only for status = 'alumni',
-- member_level required for regular members / NULL for leadership roles,
-- max subtask depth, purchase_order.total_price and stock quantity
-- computation, etc.) are NOT enforced here. They are enforced in Django.
-- ============================================================

-- Needed for the equipment reservation overlap constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;


-- ============================================================
-- ENUMS
-- ============================================================

-- ---- Members & organization ----
CREATE TYPE role_scope AS ENUM (
  'club',
  'fs_team'
);

CREATE TYPE member_role_type AS ENUM (
  'admin',
  'head_of_department',
  'member'
);

CREATE TYPE member_status AS ENUM (
  'active',
  'alumni',
  'on_leave'
);

-- Seniority of a regular member inside a club department or an
-- fs_department. Not used for leadership roles (Head, Lead, Team Lead...).
CREATE TYPE member_level AS ENUM (
  'main',
  'junior'
);

CREATE TYPE org_unit_type AS ENUM (
  'ENP Racing Team',  --the root
  'governing_body',   -- Conseil d'Administration, Bureau Executif
  'club_department',  -- the 6 main departments
  'club_pole',        -- pole / sub-department / team inside a club department
  'fs_team',          -- Formula Student technical team (under Departement Projet)
  'fs_department'     -- technical FS department (Electronics, Powertrain, ...)
);

-- ---- Projects & tasks ----
CREATE TYPE project_category AS ENUM (
  'ic',
  'ev',
  'complementary_competition',
  'club_project'
);

CREATE TYPE project_status AS ENUM (
  'planned',
  'active',
  'completed',
  'on_hold'
);

CREATE TYPE task_status AS ENUM (
  'todo',
  'in_progress',
  'blocked',
  'done'
);

CREATE TYPE task_priority AS ENUM (
  'low',
  'medium',
  'high'
);

-- ---- Subsystems ----
CREATE TYPE subsystem_status AS ENUM (
  'planned',
  'active',
  'blocked',
  'complete'
);

-- ---- Documents ----
CREATE TYPE document_type AS ENUM (
  'cad',
  'report',
  'technical_doc',
  'drawing',
  'admin',
  'faq'
);

CREATE TYPE document_status AS ENUM (
  'draft',
  'in_review',
  'approved',
  'rejected'
);

-- ---- Purchasing (values come from the real subcontracting sheets) ----
CREATE TYPE purchase_status AS ENUM (
  'a_commander',
  'en_commande',
  'livre',
  'annule'
);

CREATE TYPE supplier_type AS ENUM (
  'fournisseur',
  'sous_traitant',
  'mixte',
  'usinage',
  'logistique'
);

CREATE TYPE supplier_status AS ENUM (
  'validee',
  'en_attente',
  'refusee',
  'pas_encore_envoyee'
);

CREATE TYPE part_category AS ENUM (
  'brakes',
  'wheels_tyres',
  'chassis_body',
  'suspension',
  'steering',
  'drivetrain',
  'engine_tractive',
  'workshop',
  'low_voltage',
  'operations',
  'other'
);

-- ---- Stock ----
CREATE TYPE stock_movement_type AS ENUM (
  'in',
  'out',
  'adjustment'
);

-- ---- Equipment ----
CREATE TYPE equipment_status AS ENUM (
  'available',
  'borrowed',
  'maintenance',
  'reserved',
  'out_of_service'
);

CREATE TYPE reservation_status AS ENUM (
  'pending',
  'confirmed',
  'cancelled',
  'completed'
);

-- ---- Finance ----
CREATE TYPE sponsorship_status AS ENUM (
  'prospect',
  'contacted',
  'negotiating',
  'confirmed',
  'declined'
);


-- ============================================================
-- 1. MEMBERS & ORGANIZATION
-- ============================================================

-- ---- Roles ----
CREATE TABLE role (
  id                     integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name                   varchar          NOT NULL,
  role_type              member_role_type NOT NULL,
  -- Broad scope only; organizational context comes from membership.org_unit_id.
  scope                  role_scope       NOT NULL,
  is_leadership          boolean          NOT NULL DEFAULT false,
  -- Eligible to act as an organizational Project Manager, subject to
  -- the project's category and OrgUnit rules (validated in Django).
  can_be_project_manager boolean          NOT NULL DEFAULT false,
  created_at             timestamp        NOT NULL DEFAULT now(),

  CONSTRAINT uq_role_name_scope UNIQUE (name, scope)
);


-- ---- Members ----
CREATE TABLE member (
  id          integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  first_name  varchar       NOT NULL,
  last_name   varchar       NOT NULL,
  email       varchar       NOT NULL UNIQUE,
  phone       varchar,
  skill       varchar,
  -- Roles and org units come from membership (a member can hold several).
  status      member_status NOT NULL DEFAULT 'active',
  join_date   date,
  created_at  timestamp     NOT NULL DEFAULT now(),
  updated_at  timestamp
);

CREATE INDEX idx_member_status ON member (status);


-- ---- Alumni ----
CREATE TABLE alumni_profile (
  id                integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  -- one-to-one with member
  member_id         integer   NOT NULL UNIQUE,
  graduation_year   integer,
  current_position  varchar,
  current_company   varchar,
  linkedin_url      varchar,
  willing_to_mentor boolean   NOT NULL DEFAULT false,
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp
);


-- ---- Organizational units ----
-- Board, Executive Bureau, the 6 departments, poles/teams and the
-- Formula Student technical departments all live here (self-referencing).
CREATE TABLE org_unit (
  id            integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name          varchar       NOT NULL,
  type          org_unit_type NOT NULL,
  parent_id     integer,
  -- New poles / teams may be created temporarily or permanently.
  is_temporary  boolean       NOT NULL DEFAULT false,
  is_active     boolean       NOT NULL DEFAULT true,
  created_at    timestamp     NOT NULL DEFAULT now(),
  updated_at    timestamp,

  -- An org unit cannot be its own parent.
  CONSTRAINT ck_org_unit_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id)
);


CREATE INDEX idx_org_unit_parent_id ON org_unit (parent_id);
CREATE INDEX idx_org_unit_type      ON org_unit (type);


-- ---- Membership (Member + Role + OrgUnit [+ optional Subsystem]) ----
CREATE TABLE membership (
  id           integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  member_id    integer   NOT NULL,
  org_unit_id  integer   NOT NULL,
  -- Optional "home" subsystem. Detailed / multiple subsystem assignments
  -- live in member_subsystem.
  subsystem_id integer,
  role_id      integer   NOT NULL,
  -- 'main' or 'junior' for regular members of a club department / pole /
  -- fs_department. NULL for leadership roles (Head, Lead, Team Lead, ...).
  -- Kept on membership (not on member) so a person can be junior one
  -- season and main the next. Rule enforced in Django.
  member_level member_level,
  start_date   date,
  -- NULL means the membership is currently active.
  end_date     date,
  is_primary   boolean   NOT NULL DEFAULT true,
  created_at   timestamp NOT NULL DEFAULT now(),

  CONSTRAINT uq_membership_member_org_role_start
    UNIQUE (member_id, org_unit_id, role_id, start_date),
  CONSTRAINT ck_membership_dates
    CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE INDEX idx_membership_member_id    ON membership (member_id);
CREATE INDEX idx_membership_org_unit_id  ON membership (org_unit_id);
CREATE INDEX idx_membership_subsystem_id ON membership (subsystem_id);
CREATE INDEX idx_membership_role_id      ON membership (role_id);
-- Fast "active main / junior members of this unit" roster queries.
CREATE INDEX idx_membership_unit_level_active
  ON membership (org_unit_id, member_level)
  WHERE end_date IS NULL;

-- At most one active primary membership per member.
CREATE UNIQUE INDEX uq_membership_one_active_primary
  ON membership (member_id)
  WHERE is_primary AND end_date IS NULL;


-- ============================================================
-- 2. PROJECTS
-- ============================================================

CREATE TABLE project (
  id                  integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  -- Examples: IC 2027, EV 2027, ERP Platform
  name                varchar          NOT NULL,
  category            project_category NOT NULL,
  -- OWNING OrgUnit. club_project -> the club department;
  -- ic / ev / complementary_competition -> the Projet department /
  -- Formula Student Team OrgUnit.
  org_unit_id         integer          NOT NULL,
  description         text,
  start_date          date,
  end_date            date,
  status              project_status   NOT NULL,
  -- OFFICIAL PROJECT MANAGER (not simply "team lead"). Eligibility is
  -- validated in Django; no person or ID is hardcoded.
  project_manager_id  integer,
  created_at          timestamp        NOT NULL DEFAULT now(),
  updated_at          timestamp,

  CONSTRAINT ck_project_dates
    CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE INDEX idx_project_category           ON project (category);
CREATE INDEX idx_project_status             ON project (status);
CREATE INDEX idx_project_org_unit_id        ON project (org_unit_id);
CREATE INDEX idx_project_project_manager_id ON project (project_manager_id);


CREATE TABLE project_member (
  id          integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  project_id  integer   NOT NULL,
  member_id   integer   NOT NULL,
  -- Optional project-specific role
  role        varchar,
  start_date  date,
  end_date    date,
  is_active   boolean   NOT NULL DEFAULT true,
  created_at  timestamp NOT NULL DEFAULT now(),

  CONSTRAINT uq_project_member_project_member UNIQUE (project_id, member_id),
  CONSTRAINT ck_project_member_dates
    CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE INDEX idx_project_member_project_id ON project_member (project_id);
CREATE INDEX idx_project_member_member_id  ON project_member (member_id);


-- ============================================================
-- 3. FORMULA STUDENT SUBSYSTEMS & ENGINEERING LIFECYCLE
-- Subsystems exist ONLY under fs_department OrgUnits.
-- Club departments NEVER own Subsystems (enforced in Django).
-- ============================================================

CREATE TABLE subsystem (
  id                   integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  -- Technical subsystem name (e.g. Steering System, Battery & BMS).
  -- MUST NOT be a role name.
  name                 varchar          NOT NULL,
  -- Formula Student project / vehicle phase this subsystem instance belongs to.
  project_id           integer          NOT NULL,
  -- Technical Formula Student OrgUnit (type = fs_department) that owns it.
  org_unit_id          integer          NOT NULL,
  -- Optional self-reference for hierarchical grouping (e.g. HV System -> HV Battery & BMS).
  parent_subsystem_id  integer,
  status               subsystem_status NOT NULL DEFAULT 'planned',
  created_at           timestamp        NOT NULL DEFAULT now(),
  updated_at           timestamp,

  CONSTRAINT ck_subsystem_not_own_parent
    CHECK (parent_subsystem_id IS NULL OR parent_subsystem_id <> id)
);

CREATE INDEX idx_subsystem_project_id          ON subsystem (project_id);
CREATE INDEX idx_subsystem_org_unit_id         ON subsystem (org_unit_id);
CREATE INDEX idx_subsystem_parent_subsystem_id ON subsystem (parent_subsystem_id);


-- Subsystem assignment (table name kept for compatibility).
-- DO NOT add UNIQUE(member_id): Electronics members may hold
-- multiple active assignments. Conditional rules live in Django.
CREATE TABLE member_subsystem (
  id            integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  subsystem_id  integer               NOT NULL,
  member_id     integer               NOT NULL,
  -- main / junior on this specific subsystem (same enum as membership).
  member_level  member_level NOT NULL,
  start_date    date,
  -- NULL means the assignment is currently active.
  end_date      date,
  note          varchar,
  created_at    timestamp    NOT NULL DEFAULT now(),

  CONSTRAINT uq_member_subsystem_subsystem_member_start
    UNIQUE (subsystem_id, member_id, start_date),
  CONSTRAINT ck_member_subsystem_dates
    CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE INDEX idx_member_subsystem_member_id    ON member_subsystem (member_id);
CREATE INDEX idx_member_subsystem_subsystem_id ON member_subsystem (subsystem_id);


CREATE TABLE lifecycle_step (
  id            integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  step_order    integer   NOT NULL UNIQUE,
  -- Standard Formula Student engineering lifecycle:
  --   1. Etude & recherche      5. Fabrication / achat
  --   2. Conception CAD         6. Controle reception
  --   3. Simulation             7. Integration atelier
  --   4. Validation par le chef
  name          varchar   NOT NULL,
  applies_to_ic boolean   NOT NULL DEFAULT true,
  -- EV Concept Class may follow a different path after conception/validation;
  -- application logic decides which steps apply to a given EV subsystem.
  applies_to_ev boolean   NOT NULL DEFAULT true,
  created_at    timestamp NOT NULL DEFAULT now()
);


CREATE TABLE subsystem_step_progress (
  id                 integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  subsystem_id       integer   NOT NULL,
  lifecycle_step_id  integer   NOT NULL,
  is_complete        boolean   NOT NULL DEFAULT false,
  completed_at       timestamp,
  -- Member who validates the step. For the validation step, Django verifies
  -- that this member holds an authorized leadership role in the OrgUnit.
  validated_by       integer,
  notes              text,
  created_at         timestamp NOT NULL DEFAULT now(),

  CONSTRAINT uq_subsystem_step_progress_subsystem_step
    UNIQUE (subsystem_id, lifecycle_step_id)
);

CREATE INDEX idx_subsystem_step_progress_subsystem_id ON subsystem_step_progress (subsystem_id);
CREATE INDEX idx_subsystem_step_progress_step_id      ON subsystem_step_progress (lifecycle_step_id);
CREATE INDEX idx_subsystem_step_progress_validated_by ON subsystem_step_progress (validated_by);


-- ============================================================
-- 4. TASKS (with subtasks)
-- A subtask is a task whose parent_task_id points to another task.
-- The composite FK (parent_task_id, project_id) guarantees a subtask
-- always belongs to the same project as its parent. Subtasks have their
-- own status, assignees and comments. Max depth is enforced in Django.
-- ============================================================

CREATE TABLE task (
  id                 integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  project_id         integer     NOT NULL,
  -- Optional: parent task. NULL = top-level task.
  parent_task_id     integer,
  -- Optional: task supports a specific Formula Student subsystem.
  subsystem_id       integer,
  -- Optional: task is tied to a specific engineering lifecycle step.
  lifecycle_step_id  integer,
  title              varchar     NOT NULL,
  description        text,
  status             task_status NOT NULL DEFAULT 'todo',
  priority           task_priority,
  due_date           date,
  created_by         integer,
  created_at         timestamp   NOT NULL DEFAULT now(),
  updated_at         timestamp,

  -- Target for the composite parent FK.
  CONSTRAINT uq_task_id_project UNIQUE (id, project_id),
  CONSTRAINT ck_task_not_own_parent
    CHECK (parent_task_id IS NULL OR parent_task_id <> id)
);

CREATE INDEX idx_task_project_id        ON task (project_id);
CREATE INDEX idx_task_parent_task_id    ON task (parent_task_id);
CREATE INDEX idx_task_status            ON task (status);
CREATE INDEX idx_task_due_date          ON task (due_date);
CREATE INDEX idx_task_subsystem_id      ON task (subsystem_id);
CREATE INDEX idx_task_lifecycle_step_id ON task (lifecycle_step_id);
CREATE INDEX idx_task_created_by        ON task (created_by);


CREATE TABLE task_assignee (
  id          integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  task_id     integer   NOT NULL,
  member_id   integer   NOT NULL,
  -- Marks the main task owner when multiple members are assigned.
  is_primary  boolean   NOT NULL DEFAULT false,
  created_at  timestamp NOT NULL DEFAULT now(),

  CONSTRAINT uq_task_assignee_task_member UNIQUE (task_id, member_id)
);

CREATE INDEX idx_task_assignee_member_id ON task_assignee (member_id);
-- At most one primary assignee per task.
CREATE UNIQUE INDEX uq_task_assignee_one_primary
  ON task_assignee (task_id)
  WHERE is_primary;


CREATE TABLE task_comment (
  id          integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  task_id     integer   NOT NULL,
  author_id   integer   NOT NULL,
  content     text      NOT NULL,
  created_at  timestamp NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_comment_task_id   ON task_comment (task_id);
CREATE INDEX idx_task_comment_author_id ON task_comment (author_id);


-- ============================================================
-- 5. COMMUNICATION
-- ============================================================

CREATE TABLE announcement (
  id           integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  title        varchar   NOT NULL,
  body         text      NOT NULL,
  posted_by    integer   NOT NULL,
  -- NULL = club-wide announcement.
  org_unit_id  integer,
  posted_at    timestamp NOT NULL DEFAULT now()
);

CREATE INDEX idx_announcement_org_unit_id ON announcement (org_unit_id);
CREATE INDEX idx_announcement_posted_by   ON announcement (posted_by);
CREATE INDEX idx_announcement_posted_at   ON announcement (posted_at DESC);


CREATE TABLE notification (
  id                   integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  member_id            integer   NOT NULL,
  message              varchar   NOT NULL,
  is_read              boolean   NOT NULL DEFAULT false,
  -- Loose pointer to the related record (e.g. 'task', 42). Not a real FK.
  related_entity_type  varchar,
  related_entity_id    integer,
  created_at           timestamp NOT NULL DEFAULT now()
);

CREATE INDEX idx_notification_member_created ON notification (member_id, created_at DESC);
CREATE INDEX idx_notification_member_unread  ON notification (member_id) WHERE NOT is_read;


-- Press & influencer outreach tracking (from the Journalistes/medias sheet).
CREATE TABLE media_contact (
  id                 integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  journalist_name    varchar   NOT NULL,
  channel_name       varchar,
  contact_info       varchar,
  handled_by         integer,
  posted_video_link  varchar,
  remarks            text,
  created_at         timestamp NOT NULL DEFAULT now(),
  updated_at         timestamp
);

CREATE INDEX idx_media_contact_handled_by ON media_contact (handled_by);


-- ============================================================
-- 6. DOCUMENTS
-- Files live on Google Drive: we only store the link + metadata.
-- ============================================================

CREATE TABLE document (
  id           integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  title        varchar         NOT NULL,
  type         document_type   NOT NULL,
  -- Owning org unit (replaces the old department_id).
  org_unit_id  integer,
  -- Optional: document about a specific Formula Student subsystem.
  subsystem_id integer,
  uploaded_by  integer         NOT NULL,
  status       document_status NOT NULL DEFAULT 'draft',
  -- Link to the Google Drive file/folder.
  drive_url    varchar         NOT NULL,
  created_at   timestamp       NOT NULL DEFAULT now(),
  updated_at   timestamp
);

CREATE INDEX idx_document_org_unit_id  ON document (org_unit_id);
CREATE INDEX idx_document_subsystem_id ON document (subsystem_id);
CREATE INDEX idx_document_uploaded_by  ON document (uploaded_by);
CREATE INDEX idx_document_status       ON document (status);
CREATE INDEX idx_document_type         ON document (type);


-- ============================================================
-- 7. PURCHASING & PROCUREMENT
-- Modeled from the "Pieces & Commandes" and "Fournisseurs
-- entreprises" sheets.
-- ============================================================

CREATE TABLE supplier (
  id                     integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name                   varchar         NOT NULL,
  type                   supplier_type,
  -- Statut column in the sheet: validee / en_attente / refusee / pas_encore_envoyee
  status                 supplier_status NOT NULL DEFAULT 'pas_encore_envoyee',
  technical_capabilities text,
  address                varchar,
  city                   varchar,
  country                varchar,
  contact_name           varchar,
  contact_role           varchar,
  email                  varchar,
  phone                  varchar,
  contacted_by           integer,
  average_lead_time_days integer CHECK (average_lead_time_days IS NULL OR average_lead_time_days >= 0),
  comments               text,
  created_at             timestamp       NOT NULL DEFAULT now(),
  updated_at             timestamp
);

CREATE INDEX idx_supplier_name         ON supplier (name);
CREATE INDEX idx_supplier_status       ON supplier (status);
CREATE INDEX idx_supplier_type         ON supplier (type);
CREATE INDEX idx_supplier_contacted_by ON supplier (contacted_by);


CREATE TABLE part (
  id           integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  category     part_category NOT NULL DEFAULT 'other',
  name         varchar       NOT NULL,
  description  text,
  reference    varchar,
  quantity     integer       CHECK (quantity IS NULL OR quantity >= 0),
  material     varchar,
  -- e.g. Usinage, Impression 3D, Decoupe laser
  process      varchar,
  -- Optional: part belongs to a specific Formula Student subsystem.
  subsystem_id integer,
  -- Owning org unit (replaces the old department_id).
  org_unit_id  integer,
  created_at   timestamp     NOT NULL DEFAULT now(),
  updated_at   timestamp
);

CREATE INDEX idx_part_category     ON part (category);
CREATE INDEX idx_part_subsystem_id ON part (subsystem_id);
CREATE INDEX idx_part_org_unit_id  ON part (org_unit_id);
CREATE INDEX idx_part_reference    ON part (reference);


CREATE TABLE purchase_request (
  id             integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  part_id        integer         NOT NULL,
  requested_by   integer         NOT NULL,
  quantity       integer         NOT NULL CHECK (quantity > 0),
  priority       task_priority,
  requested_date date,
  status         purchase_status NOT NULL DEFAULT 'a_commander',
  notes          text,
  created_at     timestamp       NOT NULL DEFAULT now(),
  updated_at     timestamp
);

CREATE INDEX idx_purchase_request_part_id      ON purchase_request (part_id);
CREATE INDEX idx_purchase_request_requested_by ON purchase_request (requested_by);
CREATE INDEX idx_purchase_request_status       ON purchase_request (status);


CREATE TABLE shipping_address (
  id            integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  country       varchar,
  address       text      NOT NULL,
  contacted_by  integer,
  created_at    timestamp NOT NULL DEFAULT now()
);

CREATE INDEX idx_shipping_address_contacted_by ON shipping_address (contacted_by);


CREATE TABLE purchase_order (
  id                       integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  purchase_request_id      integer         NOT NULL,
  supplier_id              integer         NOT NULL,
  -- Optional: where the order is delivered.
  shipping_address_id      integer,
  unit_price               numeric(12,2)   CHECK (unit_price IS NULL OR unit_price >= 0),
  delivery_cost            numeric(12,2)   NOT NULL DEFAULT 0 CHECK (delivery_cost >= 0),
  customs_cost             numeric(12,2)   NOT NULL DEFAULT 0 CHECK (customs_cost >= 0),
  -- Computed in Django (unit_price * quantity + delivery + customs).
  total_price              numeric(12,2)   CHECK (total_price IS NULL OR total_price >= 0),
  ordered_at               date,
  estimated_delivery_date  date,
  actual_delivery_date     date,
  status                   purchase_status NOT NULL DEFAULT 'en_commande',
  created_at               timestamp       NOT NULL DEFAULT now(),
  updated_at               timestamp,

  CONSTRAINT ck_purchase_order_dates
    CHECK (
      (estimated_delivery_date IS NULL OR ordered_at IS NULL OR estimated_delivery_date >= ordered_at)
      AND (actual_delivery_date IS NULL OR ordered_at IS NULL OR actual_delivery_date >= ordered_at)
    )
);

CREATE INDEX idx_purchase_order_request_id  ON purchase_order (purchase_request_id);
CREATE INDEX idx_purchase_order_supplier_id ON purchase_order (supplier_id);
CREATE INDEX idx_purchase_order_shipping_id ON purchase_order (shipping_address_id);
CREATE INDEX idx_purchase_order_status      ON purchase_order (status);


CREATE TABLE invoice (
  id            integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  supplier_id   integer       NOT NULL,
  reference     varchar       NOT NULL,
  total_amount  numeric(12,2) NOT NULL CHECK (total_amount >= 0),
  issued_at     date,
  created_at    timestamp     NOT NULL DEFAULT now(),

  CONSTRAINT uq_invoice_supplier_reference UNIQUE (supplier_id, reference)
);

CREATE INDEX idx_invoice_issued_at ON invoice (issued_at);


CREATE TABLE invoice_line_item (
  id           integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  invoice_id   integer       NOT NULL,
  description  text          NOT NULL,
  quantity     numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit_price   numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  total_price  numeric(12,2) NOT NULL CHECK (total_price >= 0)
);

CREATE INDEX idx_invoice_line_item_invoice_id ON invoice_line_item (invoice_id);


-- ============================================================
-- 8. STOCK & LOGISTICS
-- ============================================================

CREATE TABLE stock_item (
  id                  integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  part_id             integer   NOT NULL,
  quantity_available  integer   NOT NULL DEFAULT 0 CHECK (quantity_available >= 0),
  location            varchar,
  min_threshold       integer   NOT NULL DEFAULT 0 CHECK (min_threshold >= 0),
  updated_at          timestamp
);

CREATE INDEX idx_stock_item_part_id ON stock_item (part_id);
-- Fast "low stock" alerts.
CREATE INDEX idx_stock_item_low_stock
  ON stock_item (part_id)
  WHERE quantity_available <= min_threshold;


CREATE TABLE stock_movement (
  id                          integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  stock_item_id               integer             NOT NULL,
  movement_type               stock_movement_type NOT NULL,
  -- 'in' / 'out': positive quantity. 'adjustment': signed, non-zero.
  quantity                    integer             NOT NULL,
  related_purchase_order_id   integer,
  related_task_id             integer,
  moved_by                    integer             NOT NULL,
  moved_at                    timestamp           NOT NULL DEFAULT now(),
  notes                       text,

  CONSTRAINT ck_stock_movement_quantity
    CHECK (
      (movement_type = 'adjustment' AND quantity <> 0)
      OR (movement_type <> 'adjustment' AND quantity > 0)
    )
);

CREATE INDEX idx_stock_movement_stock_item_id ON stock_movement (stock_item_id);
CREATE INDEX idx_stock_movement_moved_at      ON stock_movement (moved_at);
CREATE INDEX idx_stock_movement_purchase_order_id ON stock_movement (related_purchase_order_id);
CREATE INDEX idx_stock_movement_task_id       ON stock_movement (related_task_id);
CREATE INDEX idx_stock_movement_moved_by      ON stock_movement (moved_by);


-- ============================================================
-- 9. WORKSHOPS & EQUIPMENT
-- Modeled from the "Workshop" category rows in the Pieces sheet:
-- compressor, table saw, hydraulic press, 3D printer, etc.
-- ============================================================

CREATE TABLE equipment (
  id                   integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name                 varchar          NOT NULL,
  category             varchar,
  status               equipment_status NOT NULL DEFAULT 'available',
  location             varchar,
  purchased_at         date,
  last_maintenance_at  date,
  created_at           timestamp        NOT NULL DEFAULT now(),
  updated_at           timestamp
);

CREATE INDEX idx_equipment_status   ON equipment (status);
CREATE INDEX idx_equipment_category ON equipment (category);


CREATE TABLE equipment_reservation (
  id             integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  equipment_id   integer            NOT NULL,
  reserved_by    integer            NOT NULL,
  reserved_from  timestamp          NOT NULL,
  reserved_to    timestamp          NOT NULL,
  status         reservation_status NOT NULL DEFAULT 'pending',
  created_at     timestamp          NOT NULL DEFAULT now(),

  CONSTRAINT ck_equipment_reservation_period CHECK (reserved_to > reserved_from),
  -- The same equipment cannot have two overlapping active reservations.
  CONSTRAINT ex_equipment_reservation_no_overlap
    EXCLUDE USING gist (
      equipment_id WITH =,
      tsrange(reserved_from, reserved_to) WITH &&
    )
    WHERE (status IN ('pending', 'confirmed'))
);

CREATE INDEX idx_equipment_reservation_equipment_id ON equipment_reservation (equipment_id);
CREATE INDEX idx_equipment_reservation_reserved_by  ON equipment_reservation (reserved_by);


CREATE TABLE equipment_maintenance (
  id            integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  equipment_id  integer       NOT NULL,
  performed_by  integer       NOT NULL,
  performed_at  timestamp     NOT NULL DEFAULT now(),
  description   text,
  cost          numeric(12,2) CHECK (cost IS NULL OR cost >= 0),
  created_at    timestamp     NOT NULL DEFAULT now()
);

CREATE INDEX idx_equipment_maintenance_equipment_id ON equipment_maintenance (equipment_id);
CREATE INDEX idx_equipment_maintenance_performed_by ON equipment_maintenance (performed_by);


-- ============================================================
-- 10. BUDGET & FINANCE
-- ============================================================

CREATE TABLE budget (
  id                integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  -- Owning org unit (replaces the old department_id).
  org_unit_id       integer       NOT NULL,
  fiscal_year       varchar       NOT NULL,
  allocated_amount  numeric(12,2) NOT NULL DEFAULT 0 CHECK (allocated_amount >= 0),
  created_at        timestamp     NOT NULL DEFAULT now(),
  updated_at        timestamp,

  CONSTRAINT uq_budget_org_unit_year UNIQUE (org_unit_id, fiscal_year)
);


CREATE TABLE expense (
  id                 integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  budget_id          integer       NOT NULL,
  purchase_order_id  integer,
  invoice_id         integer,
  amount             numeric(12,2) NOT NULL CHECK (amount >= 0),
  category           varchar,
  recorded_by        integer       NOT NULL,
  recorded_at        date          NOT NULL DEFAULT current_date,
  created_at         timestamp     NOT NULL DEFAULT now()
);

CREATE INDEX idx_expense_budget_id         ON expense (budget_id);
CREATE INDEX idx_expense_purchase_order_id ON expense (purchase_order_id);
CREATE INDEX idx_expense_invoice_id        ON expense (invoice_id);
CREATE INDEX idx_expense_recorded_by       ON expense (recorded_by);
CREATE INDEX idx_expense_recorded_at       ON expense (recorded_at);


CREATE TABLE sponsorship (
  id                   integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  sponsor_name         varchar            NOT NULL,
  amount               numeric(12,2)      CHECK (amount IS NULL OR amount >= 0),
  in_kind_description  text,
  contact_name         varchar,
  contact_email        varchar,
  status               sponsorship_status NOT NULL DEFAULT 'prospect',
  managed_by           integer,
  created_at           timestamp          NOT NULL DEFAULT now(),
  updated_at           timestamp
);

CREATE INDEX idx_sponsorship_status     ON sponsorship (status);
CREATE INDEX idx_sponsorship_managed_by ON sponsorship (managed_by);


-- ============================================================
-- 11. DASHBOARD & REPORTING
-- Reporting is mostly views/aggregations over the tables above;
-- this table only lets users save custom views.
-- ============================================================

CREATE TABLE saved_report (
  id           integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name         varchar   NOT NULL,
  created_by   integer   NOT NULL,
  config_json  jsonb     NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamp NOT NULL DEFAULT now()
);

CREATE INDEX idx_saved_report_created_by ON saved_report (created_by);


-- ============================================================
-- 12. TECHNICAL DATA / TELEMETRY
-- ============================================================

CREATE TABLE competition_edition (
  id          integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  name        varchar   NOT NULL,
  year        integer   NOT NULL,
  location    varchar,
  created_at  timestamp NOT NULL DEFAULT now(),

  CONSTRAINT uq_competition_edition_name_year UNIQUE (name, year)
);


CREATE TABLE telemetry_session (
  id                     integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  -- NULL for test sessions outside a competition.
  competition_edition_id integer,
  subsystem_id           integer,
  session_date           date      NOT NULL,
  session_type           varchar,
  recorded_by            integer   NOT NULL,
  created_at             timestamp NOT NULL DEFAULT now()
);

CREATE INDEX idx_telemetry_session_edition_id   ON telemetry_session (competition_edition_id);
CREATE INDEX idx_telemetry_session_subsystem_id ON telemetry_session (subsystem_id);
CREATE INDEX idx_telemetry_session_recorded_by  ON telemetry_session (recorded_by);
CREATE INDEX idx_telemetry_session_date         ON telemetry_session (session_date);


-- High-volume table: bigint id, compact double precision values.
CREATE TABLE telemetry_data_point (
  id                   bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  telemetry_session_id integer          NOT NULL,
  timestamp_ms         bigint           NOT NULL,
  sensor_name          varchar          NOT NULL,
  value                double precision NOT NULL,
  unit                 varchar
);

CREATE INDEX idx_telemetry_data_point_session_sensor_time
  ON telemetry_data_point (telemetry_session_id, sensor_name, timestamp_ms);


-- ============================================================
-- FOREIGN KEYS
-- ============================================================

-- ---- 1. Members & organization ----
ALTER TABLE org_unit
  ADD CONSTRAINT fk_org_unit_parent
  FOREIGN KEY (parent_id) REFERENCES org_unit (id) ON DELETE RESTRICT;

ALTER TABLE alumni_profile
  ADD CONSTRAINT fk_alumni_profile_member
  FOREIGN KEY (member_id) REFERENCES member (id) ON DELETE CASCADE;

ALTER TABLE membership
  ADD CONSTRAINT fk_membership_member
  FOREIGN KEY (member_id) REFERENCES member (id) ON DELETE RESTRICT;
ALTER TABLE membership
  ADD CONSTRAINT fk_membership_org_unit
  FOREIGN KEY (org_unit_id) REFERENCES org_unit (id) ON DELETE RESTRICT;
ALTER TABLE membership
  ADD CONSTRAINT fk_membership_subsystem
  FOREIGN KEY (subsystem_id) REFERENCES subsystem (id) ON DELETE SET NULL;
ALTER TABLE membership
  ADD CONSTRAINT fk_membership_role
  FOREIGN KEY (role_id) REFERENCES role (id) ON DELETE RESTRICT;

-- ---- 2. Projects ----
ALTER TABLE project
  ADD CONSTRAINT fk_project_org_unit
  FOREIGN KEY (org_unit_id) REFERENCES org_unit (id) ON DELETE RESTRICT;
ALTER TABLE project
  ADD CONSTRAINT fk_project_project_manager
  FOREIGN KEY (project_manager_id) REFERENCES member (id) ON DELETE RESTRICT;

ALTER TABLE project_member
  ADD CONSTRAINT fk_project_member_project
  FOREIGN KEY (project_id) REFERENCES project (id) ON DELETE CASCADE;
ALTER TABLE project_member
  ADD CONSTRAINT fk_project_member_member
  FOREIGN KEY (member_id) REFERENCES member (id) ON DELETE RESTRICT;

-- ---- 3. Subsystems & lifecycle ----
ALTER TABLE subsystem
  ADD CONSTRAINT fk_subsystem_project
  FOREIGN KEY (project_id) REFERENCES project (id) ON DELETE RESTRICT;
ALTER TABLE subsystem
  ADD CONSTRAINT fk_subsystem_org_unit
  FOREIGN KEY (org_unit_id) REFERENCES org_unit (id) ON DELETE RESTRICT;
ALTER TABLE subsystem
  ADD CONSTRAINT fk_subsystem_parent
  FOREIGN KEY (parent_subsystem_id) REFERENCES subsystem (id) ON DELETE RESTRICT;

ALTER TABLE member_subsystem
  ADD CONSTRAINT fk_member_subsystem_subsystem
  FOREIGN KEY (subsystem_id) REFERENCES subsystem (id) ON DELETE CASCADE;
ALTER TABLE member_subsystem
  ADD CONSTRAINT fk_member_subsystem_member
  FOREIGN KEY (member_id) REFERENCES member (id) ON DELETE RESTRICT;

ALTER TABLE subsystem_step_progress
  ADD CONSTRAINT fk_subsystem_step_progress_subsystem
  FOREIGN KEY (subsystem_id) REFERENCES subsystem (id) ON DELETE CASCADE;
ALTER TABLE subsystem_step_progress
  ADD CONSTRAINT fk_subsystem_step_progress_lifecycle_step
  FOREIGN KEY (lifecycle_step_id) REFERENCES lifecycle_step (id) ON DELETE RESTRICT;
ALTER TABLE subsystem_step_progress
  ADD CONSTRAINT fk_subsystem_step_progress_validated_by
  FOREIGN KEY (validated_by) REFERENCES member (id) ON DELETE RESTRICT;

-- ---- 4. Tasks ----
ALTER TABLE task
  ADD CONSTRAINT fk_task_project
  FOREIGN KEY (project_id) REFERENCES project (id) ON DELETE RESTRICT;
-- Subtasks: parent must exist and belong to the same project.
ALTER TABLE task
  ADD CONSTRAINT fk_task_parent
  FOREIGN KEY (parent_task_id, project_id) REFERENCES task (id, project_id) ON DELETE CASCADE;
ALTER TABLE task
  ADD CONSTRAINT fk_task_subsystem
  FOREIGN KEY (subsystem_id) REFERENCES subsystem (id) ON DELETE RESTRICT;
ALTER TABLE task
  ADD CONSTRAINT fk_task_lifecycle_step
  FOREIGN KEY (lifecycle_step_id) REFERENCES lifecycle_step (id) ON DELETE RESTRICT;
ALTER TABLE task
  ADD CONSTRAINT fk_task_created_by
  FOREIGN KEY (created_by) REFERENCES member (id) ON DELETE RESTRICT;

ALTER TABLE task_assignee
  ADD CONSTRAINT fk_task_assignee_task
  FOREIGN KEY (task_id) REFERENCES task (id) ON DELETE CASCADE;
ALTER TABLE task_assignee
  ADD CONSTRAINT fk_task_assignee_member
  FOREIGN KEY (member_id) REFERENCES member (id) ON DELETE RESTRICT;

ALTER TABLE task_comment
  ADD CONSTRAINT fk_task_comment_task
  FOREIGN KEY (task_id) REFERENCES task (id) ON DELETE CASCADE;
ALTER TABLE task_comment
  ADD CONSTRAINT fk_task_comment_author
  FOREIGN KEY (author_id) REFERENCES member (id) ON DELETE RESTRICT;

-- ---- 5. Communication ----
ALTER TABLE announcement
  ADD CONSTRAINT fk_announcement_posted_by
  FOREIGN KEY (posted_by) REFERENCES member (id) ON DELETE RESTRICT;
ALTER TABLE announcement
  ADD CONSTRAINT fk_announcement_org_unit
  FOREIGN KEY (org_unit_id) REFERENCES org_unit (id) ON DELETE RESTRICT;

ALTER TABLE notification
  ADD CONSTRAINT fk_notification_member
  FOREIGN KEY (member_id) REFERENCES member (id) ON DELETE CASCADE;

ALTER TABLE media_contact
  ADD CONSTRAINT fk_media_contact_handled_by
  FOREIGN KEY (handled_by) REFERENCES member (id) ON DELETE RESTRICT;

-- ---- 6. Documents ----
ALTER TABLE document
  ADD CONSTRAINT fk_document_org_unit
  FOREIGN KEY (org_unit_id) REFERENCES org_unit (id) ON DELETE RESTRICT;
ALTER TABLE document
  ADD CONSTRAINT fk_document_subsystem
  FOREIGN KEY (subsystem_id) REFERENCES subsystem (id) ON DELETE RESTRICT;
ALTER TABLE document
  ADD CONSTRAINT fk_document_uploaded_by
  FOREIGN KEY (uploaded_by) REFERENCES member (id) ON DELETE RESTRICT;

-- ---- 7. Purchasing ----
ALTER TABLE supplier
  ADD CONSTRAINT fk_supplier_contacted_by
  FOREIGN KEY (contacted_by) REFERENCES member (id) ON DELETE RESTRICT;

ALTER TABLE part
  ADD CONSTRAINT fk_part_subsystem
  FOREIGN KEY (subsystem_id) REFERENCES subsystem (id) ON DELETE RESTRICT;
ALTER TABLE part
  ADD CONSTRAINT fk_part_org_unit
  FOREIGN KEY (org_unit_id) REFERENCES org_unit (id) ON DELETE RESTRICT;

ALTER TABLE purchase_request
  ADD CONSTRAINT fk_purchase_request_part
  FOREIGN KEY (part_id) REFERENCES part (id) ON DELETE RESTRICT;
ALTER TABLE purchase_request
  ADD CONSTRAINT fk_purchase_request_requested_by
  FOREIGN KEY (requested_by) REFERENCES member (id) ON DELETE RESTRICT;

ALTER TABLE shipping_address
  ADD CONSTRAINT fk_shipping_address_contacted_by
  FOREIGN KEY (contacted_by) REFERENCES member (id) ON DELETE RESTRICT;

ALTER TABLE purchase_order
  ADD CONSTRAINT fk_purchase_order_request
  FOREIGN KEY (purchase_request_id) REFERENCES purchase_request (id) ON DELETE RESTRICT;
ALTER TABLE purchase_order
  ADD CONSTRAINT fk_purchase_order_supplier
  FOREIGN KEY (supplier_id) REFERENCES supplier (id) ON DELETE RESTRICT;
ALTER TABLE purchase_order
  ADD CONSTRAINT fk_purchase_order_shipping_address
  FOREIGN KEY (shipping_address_id) REFERENCES shipping_address (id) ON DELETE RESTRICT;

ALTER TABLE invoice
  ADD CONSTRAINT fk_invoice_supplier
  FOREIGN KEY (supplier_id) REFERENCES supplier (id) ON DELETE RESTRICT;

ALTER TABLE invoice_line_item
  ADD CONSTRAINT fk_invoice_line_item_invoice
  FOREIGN KEY (invoice_id) REFERENCES invoice (id) ON DELETE CASCADE;

-- ---- 8. Stock ----
ALTER TABLE stock_item
  ADD CONSTRAINT fk_stock_item_part
  FOREIGN KEY (part_id) REFERENCES part (id) ON DELETE RESTRICT;

ALTER TABLE stock_movement
  ADD CONSTRAINT fk_stock_movement_stock_item
  FOREIGN KEY (stock_item_id) REFERENCES stock_item (id) ON DELETE RESTRICT;
ALTER TABLE stock_movement
  ADD CONSTRAINT fk_stock_movement_purchase_order
  FOREIGN KEY (related_purchase_order_id) REFERENCES purchase_order (id) ON DELETE RESTRICT;
ALTER TABLE stock_movement
  ADD CONSTRAINT fk_stock_movement_task
  FOREIGN KEY (related_task_id) REFERENCES task (id) ON DELETE SET NULL;
ALTER TABLE stock_movement
  ADD CONSTRAINT fk_stock_movement_moved_by
  FOREIGN KEY (moved_by) REFERENCES member (id) ON DELETE RESTRICT;

-- ---- 9. Equipment ----
ALTER TABLE equipment_reservation
  ADD CONSTRAINT fk_equipment_reservation_equipment
  FOREIGN KEY (equipment_id) REFERENCES equipment (id) ON DELETE CASCADE;
ALTER TABLE equipment_reservation
  ADD CONSTRAINT fk_equipment_reservation_reserved_by
  FOREIGN KEY (reserved_by) REFERENCES member (id) ON DELETE RESTRICT;

ALTER TABLE equipment_maintenance
  ADD CONSTRAINT fk_equipment_maintenance_equipment
  FOREIGN KEY (equipment_id) REFERENCES equipment (id) ON DELETE CASCADE;
ALTER TABLE equipment_maintenance
  ADD CONSTRAINT fk_equipment_maintenance_performed_by
  FOREIGN KEY (performed_by) REFERENCES member (id) ON DELETE RESTRICT;

-- ---- 10. Budget & finance ----
ALTER TABLE budget
  ADD CONSTRAINT fk_budget_org_unit
  FOREIGN KEY (org_unit_id) REFERENCES org_unit (id) ON DELETE RESTRICT;

ALTER TABLE expense
  ADD CONSTRAINT fk_expense_budget
  FOREIGN KEY (budget_id) REFERENCES budget (id) ON DELETE RESTRICT;
ALTER TABLE expense
  ADD CONSTRAINT fk_expense_purchase_order
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_order (id) ON DELETE RESTRICT;
ALTER TABLE expense
  ADD CONSTRAINT fk_expense_invoice
  FOREIGN KEY (invoice_id) REFERENCES invoice (id) ON DELETE RESTRICT;
ALTER TABLE expense
  ADD CONSTRAINT fk_expense_recorded_by
  FOREIGN KEY (recorded_by) REFERENCES member (id) ON DELETE RESTRICT;

ALTER TABLE sponsorship
  ADD CONSTRAINT fk_sponsorship_managed_by
  FOREIGN KEY (managed_by) REFERENCES member (id) ON DELETE RESTRICT;

-- ---- 11. Reporting ----
ALTER TABLE saved_report
  ADD CONSTRAINT fk_saved_report_created_by
  FOREIGN KEY (created_by) REFERENCES member (id) ON DELETE CASCADE;

-- ---- 12. Telemetry ----
ALTER TABLE telemetry_session
  ADD CONSTRAINT fk_telemetry_session_edition
  FOREIGN KEY (competition_edition_id) REFERENCES competition_edition (id) ON DELETE RESTRICT;
ALTER TABLE telemetry_session
  ADD CONSTRAINT fk_telemetry_session_subsystem
  FOREIGN KEY (subsystem_id) REFERENCES subsystem (id) ON DELETE RESTRICT;
ALTER TABLE telemetry_session
  ADD CONSTRAINT fk_telemetry_session_recorded_by
  FOREIGN KEY (recorded_by) REFERENCES member (id) ON DELETE RESTRICT;

ALTER TABLE telemetry_data_point
  ADD CONSTRAINT fk_telemetry_data_point_session
  FOREIGN KEY (telemetry_session_id) REFERENCES telemetry_session (id) ON DELETE CASCADE;


-- ============================================================
-- OPTIONAL SEED: organizational structure
-- (Board, Executive Bureau, 6 departments, Formula Student team and
--  its technical departments). Safe to move to a Django fixture.
-- ============================================================

INSERT INTO org_unit (name, type) VALUES
  ('Conseil d''Administration',                     'governing_body'),
  ('Bureau Exécutif',                               'governing_body'),
  ('Département Projet',                            'club_department'),
  ('Département Formation & Industrie',             'club_department'),
  ('Département Médias & Journalisme Scientifique', 'club_department'),
  ('Département Systèmes d''Information',           'club_department'),
  ('Département Business & Innovation',             'club_department'),
  ('Département Opérations & Partenariats',         'club_department');

INSERT INTO org_unit (name, type, parent_id)
SELECT 'Formula Student Team', 'fs_team'::org_unit_type, id
FROM org_unit
WHERE name = 'Département Projet';

INSERT INTO org_unit (name, type, parent_id)
SELECT v.name, 'fs_department'::org_unit_type, p.id
FROM (VALUES
  ('Suspension & Steering'),
  ('Chassis & Ergonomics'),
  ('Powertrain'),
  ('Aerodynamics'),
  ('Electronics')
) AS v(name)
CROSS JOIN org_unit p
WHERE p.name = 'Formula Student Team';
