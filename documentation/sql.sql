Project ERP_FSAE {
  database_type: 'PostgreSQL'
  Note: '''
    Full ERP schema - Information Systems Department - ENP Racing Team (FSAE Club)
    Covers all 8 official modules (see charte 2026/2027 + Systeme d'Information PDF)
    + purchasing/supplier data modeled from the real subcontracting sheet.
  '''
}

// ======================================================
// ENUMS
// ======================================================

// Global permission level. "Head of Department" scope is defined
// by the member's department_id — a head only manages their own dept.
Enum member_role {
  admin              // Bureau Executif / full system access
  head_of_department  // Chef de Departement / Chef de Projet — manages their dept
  member              // regular member
}

// The 6 official departments from the charte de fonctionnement 2026/2027
Enum department_name {
  projet                          // Departement Projet (Formula Student + competition project)
  formation_industrie              // Departement Formation & Industrie
  medias_journalisme_scientifique  // Departement Medias & Journalisme Scientifique
  systemes_information             // Departement Systemes d'Information
  business_innovation              // Departement Business & Innovation
  operations_partenariats          // Departement Operations & Partenariats
}

Enum task_status {
  todo
  in_progress
  blocked
  review
  done
}

Enum priority_level {
  p1
  p2
  p3
}

Enum document_type {
  cad
  report
  technical_doc
  drawing
  admin
  faq
}

Enum document_status {
  draft
  in_review
  approved
  rejected
}

Enum purchase_status {
  a_commander
  en_commande
  livre
  annule
}

Enum supplier_type {
  fournisseur
  sous_traitant
  mixte
  usinage
  logistique
}

Enum supplier_status {
  validee
  en_attente
  refusee
  pas_encore_envoyee
}

Enum part_category {
  brakes
  wheels_tyres
  chassis_body
  suspension
  steering
  drivetrain
  engine_tractive
  workshop
  low_voltage
  operations
  other
}

Enum equipment_status {
  available
  borrowed
  maintenance
  reserved
  out_of_service
}

Enum stock_movement_type {
  in
  out
  adjustment
}

// ======================================================
// 1. MEMBER MANAGEMENT
// ======================================================
Table department {
  id uuid [pk]
  name department_name [unique]
  created_at timestamp
}

Table subsystem {
  id uuid [pk]
  name varchar
  department_id uuid [ref: > department.id]
}

Table member_subsystem
{
  id uuid [pk]
  subsystem_id uuid [ref: > subsystem.id]
  member_id uuid [ref: > member.id]
}

Table member {
  id uuid [pk]
  first_name varchar
  last_name varchar
  email varchar [unique]
  phone varchar
  skill varchar
  role member_role // admin / head_of_department / member
  department_id uuid [ref: > department.id]
  joined_at date
  is_alumni boolean [default: false]
  created_at timestamp

  Note: '''
    A member's real-world authority is role + department_id together:
    a head_of_department only has elevated rights inside their own department.
    RLS policies key off this pair.
  '''
}

Table alumni_profile {
  id uuid [pk]
  member_id uuid [ref: - member.id] // one-to-one
  graduation_year int
  current_position varchar
  current_company varchar
  linkedin_url varchar
  willing_to_mentor boolean
}

// ======================================================
// 2. COMMUNICATION & DECISIONS
// ======================================================
Table announcement {
  id uuid [pk]
  title varchar
  body text
  posted_by uuid [ref: > member.id]
  department_id uuid [ref: > department.id]
  posted_at timestamp
}

Table notification {
  id uuid [pk]
  member_id uuid [ref: > member.id]
  message varchar
  is_read boolean [default: false]
  created_at timestamp
  related_entity_type varchar
  related_entity_id uuid
}

Table media_contact {
  id uuid [pk]
  journalist_name varchar
  channel_name varchar
  contact_info varchar
  handled_by uuid [ref: > member.id]
  posted_video_link varchar
  remarks text
  created_at timestamp

  Note: 'From Journalistes/medias sheet — press & influencer outreach tracking'
}

// ======================================================
// 3. DOCUMENT MANAGEMENT
// (files live on Google Drive — we only store the link + metadata)
// ======================================================

Table document {
  id uuid [pk]
  title varchar
  type document_type
  department_id uuid [ref: > department.id]
  subsystem_id uuid [ref: > subsystem.id]
  uploaded_by uuid [ref: > member.id]
  status document_status
  drive_url varchar // link to the Google Drive file/folder
  created_at timestamp
}



// ======================================================
// 4. PROJECT MANAGEMENT
// ======================================================
Table task {
  id uuid [pk]
  title varchar
  description text
  subsystem_id uuid [ref: >? subsystem.id]
  department_id uuid [ref: > department.id]
  assignee_id uuid [ref: > member.id]
  status task_status
  priority priority_level
  due_date date
  created_at timestamp
}

Table task_comment {
  id uuid [pk]
  task_id uuid [ref: > task.id]
  author_id uuid [ref: > member.id]
  body text
  created_at timestamp
}

// ======================================================
// 5. PURCHASING & PROCUREMENT
// (modeled directly from the "Pieces & Commandes" and
//  "Fournisseurs entreprises" sheets)
// ======================================================
Table supplier {
  id uuid [pk]
  name varchar
  type supplier_type
  status supplier_status
  technical_capabilities text
  address varchar
  city varchar
  country varchar
  contact_name varchar
  contact_role varchar
  email varchar
  phone varchar
  contacted_by uuid [ref: > member.id]
  average_lead_time_days int
  comments text

  Note: 'Statut column in sheet = validee/en_attente/refusee/pas_encore_envoyee'
}

Table part {
  id uuid [pk]
  category part_category
  name varchar
  description text
  reference varchar
  quantity int
  material varchar
  process varchar // e.g. Usinage, Impression 3D, Decoupe laser
  subsystem_id uuid [ref: > subsystem.id]
  department_id uuid [ref: > department.id]
}

Table purchase_request {
  id uuid [pk]
  part_id uuid [ref: > part.id]
  requested_by uuid [ref: > member.id]
  quantity int
  priority priority_level
  requested_date date
  status purchase_status
  notes text
}

Table purchase_order {
  id uuid [pk]
  purchase_request_id uuid [ref: > purchase_request.id]
  supplier_id uuid [ref: > supplier.id]
  unit_price decimal
  delivery_cost decimal
  customs_cost decimal
  total_price decimal
  ordered_at date
  estimated_delivery_date date
  actual_delivery_date date
  status purchase_status
}

Table shipping_address {
  id uuid [pk]
  country varchar
  address text
  contacted_by uuid [ref: > member.id]
}

Table invoice {
  id uuid [pk]
  supplier_id uuid [ref: > supplier.id]
  reference varchar
  total_amount decimal
  issued_at date
}

Table invoice_line_item {
  id uuid [pk]
  invoice_id uuid [ref: > invoice.id]
  description text
  quantity decimal
  unit_price decimal
  total_price decimal
}

// ======================================================
// 6. STOCK & LOGISTICS
// ======================================================
Table stock_item {
  id uuid [pk]
  part_id uuid [ref: > part.id]
  quantity_available int
  location varchar
  min_threshold int
  updated_at timestamp
}

Table stock_movement {
  id uuid [pk]
  stock_item_id uuid [ref: > stock_item.id]
  movement_type stock_movement_type
  quantity int
  related_purchase_order_id uuid [ref: > purchase_order.id]
  related_task_id uuid [ref: > task.id]
  moved_by uuid [ref: > member.id]
  moved_at timestamp
  notes text
}

// ======================================================
// 7. WORKSHOPS & EQUIPMENT
// (modeled from "Workshop" category rows in Pieces sheet:
//  compressor, table saw, hydraulic press, 3D printer, etc.)
// ======================================================
Table equipment {
  id uuid [pk]
  name varchar
  category varchar
  status equipment_status
  location varchar
  purchased_at date
  last_maintenance_at date
}

Table equipment_reservation {
  id uuid [pk]
  equipment_id uuid [ref: > equipment.id]
  reserved_by uuid [ref: > member.id]
  reserved_from timestamp
  reserved_to timestamp
  status varchar
}

Table equipment_maintenance {
  id uuid [pk]
  equipment_id uuid [ref: > equipment.id]
  performed_by uuid [ref: > member.id]
  performed_at timestamp
  description text
  cost decimal
}

// ======================================================
// 8. BUDGET & FINANCE
// ======================================================
Table budget {
  id uuid [pk]
  department_id uuid [ref: > department.id]
  fiscal_year varchar
  allocated_amount decimal
}

Table expense {
  id uuid [pk]
  budget_id uuid [ref: > budget.id]
  purchase_order_id uuid [ref: > purchase_order.id]
  invoice_id uuid [ref: > invoice.id]
  amount decimal
  category varchar
  recorded_by uuid [ref: > member.id]
  recorded_at date
}

Table sponsorship {
  id uuid [pk]
  sponsor_name varchar
  amount decimal
  in_kind_description text
  contact_name varchar
  contact_email varchar
  status varchar
  managed_by uuid [ref: > member.id]
}

// ======================================================
// 9. DASHBOARD & REPORTING
// (reporting is mostly views/aggregations over the tables
//  above; this table just lets users save custom views)
// ======================================================
Table saved_report {
  id uuid [pk]
  name varchar
  created_by uuid [ref: > member.id]
  config_json text
  created_at timestamp
}

// ======================================================
// 10. TECHNICAL DATA / TELEMETRY
// ======================================================
Table competition_edition {
  id uuid [pk]
  name varchar
  year int
  location varchar
}

Table telemetry_session {
  id uuid [pk]
  competition_edition_id uuid [ref: > competition_edition.id]
  subsystem_id uuid [ref: > subsystem.id]
  session_date date
  session_type varchar
  recorded_by uuid [ref: > member.id]
}

Table telemetry_data_point {
  id uuid [pk]
  telemetry_session_id uuid [ref: > telemetry_session.id]
  timestamp_ms bigint
  sensor_name varchar
  value decimal
  unit varchar
}