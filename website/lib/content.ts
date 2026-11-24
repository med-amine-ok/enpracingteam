// Single source of truth for the website copy (English).
// Team-provided content (Nov 2026) + organisational model (documentation/final_OrganizationalModel.md).
// Edit freely | every section reads from here.

export const SITE = {
  name: "ENP Racing Team",
  school: "National Polytechnic School of Algiers",
  email: "enp_racingteam@g.enp.edu.dz",
  address:
    "National Polytechnic School, 10 Avenue Hassen Badi, El Harrach, Algiers",
  instagram: "https://www.instagram.com/enp.rt/",
  linkedin: "https://www.linkedin.com/company/enp-racing-team/",
  dossier: "/enp-racing-team-sponsorship-deck.pdf",
};

export const NAV = [
  { id: "about", label: "About" },
  { id: "car", label: "The car" },
  { id: "season", label: "Season" },
  { id: "paddock", label: "Gallery" },
  { id: "structure", label: "Structure" },
  { id: "partners", label: "Partners" },
  { id: "contact", label: "Contact" },
];

/** Hero / scroll-scene chapters. `at` = scroll progress (0..1) where the copy is centred. */
export const CHAPTERS = [
  {
    at: 0.0,
    cls: "chapter-0",
    kicker: "Formula Student UK · Silverstone",
    title: ["From Algeria", "to Silverstone"],
    body: "The first Formula Student single-seater from Algeria. Designed, built and raced by the students of the National Polytechnic School of Algiers.",
  },
  {
    at: 0.82,
    cls: "chapter-3",
    kicker: "Track",
    title: ["Full", "attack"],
    body: "July 2026, Silverstone. 92 hp, 314 kg, 0–100 km/h in 5 seconds. The first Algerian team ever on the grid.",
  },
];

/** People to contact directly (shown in the contact section). */
export const CONTACT_PEOPLE = [
  {
    role: "President",
    name: "Ilyes Menzer",
    email: "mohamed_ilyes.menzer@g.enp.edu.dz",
    phone: "0540024003",
  },
  {
    role: "External Relations",
    name: "Hammouda Baouchi",
    email: "hammouda.baouchi@g.enp.edu.dz",
    phone: "0699544870",
  },
  {
    role: "Formula Student Head",
    name: "Youcef Bengoumida",
    email: "youcef.bengoumida@g.enp.edu.dz",
    phone: "0555268749",
  },
  {
    role: "MATE ROV Head",
    name: "Yacine Zitoune",
    email: "ahmed_yacine.zitoune@g.enp.edu.dz",
    phone: "0656402213",
  },
];

// ---------------------------------------------------------------- FORMULA STUDENT
export const FORMULA_STUDENT = {
  lead: "Organised by the Institution of Mechanical Engineers and held every year at the Silverstone Circuit, Formula Student is an international engineering competition. University students take on the challenge of creating their own race cars, from the first design to the final race.",
  body: "It is not just about building a fast car. It is about engineering, teamwork and problem-solving, and about putting everything you have learned into practice.",
  punch: "This is where we come in.",
  facts: [
    { k: "Organiser", v: "IMechE" },
    { k: "Venue", v: "Silverstone Circuit, UK" },
    { k: "Static events", v: "Business · Cost · Design" },
    {
      k: "Dynamic events",
      v: "Acceleration · Skid Pad · Autocross · Endurance",
    },
  ],
};

// ---------------------------------------------------------------- WHO WE ARE
export const ABOUT = {
  statement:
    "We are the ENP Racing Team: 70 engineering students from the National Polytechnic School of Algiers, and the first team from Algeria to present its own Formula Student single-seater.",
  p1: "The team brings together students from different engineering fields who share one goal: working together on technical projects, taking part in competitions and developing new ideas.",
  p2: "We started as a Formula Student team. Today we also race in electric and underwater robotics competitions.",
};

export const ABOUT_PHOTOS = [
  {
    src: "/about/peace.jpg",
    alt: "Two ENP Racing Team members smiling and making a peace sign in the Silverstone paddock",
    caption: "Paddock life · Silverstone",
    pos: "40% 45%",
  },
  {
    src: "/about/grid-smiles.jpg",
    alt: "ENP Racing Team members smiling on the Silverstone grid",
    caption: "On the grid",
    pos: "50% 12%",
  },
  {
    src: "/about/reception.jpg",
    alt: "Team members smiling at the reception in Algiers",
    caption: "Welcome home, August 2026",
    pos: "50% 35%",
  },
  {
    src: "/about/workshop-smiles.jpg",
    alt: "Two smiling team members in the ENP workshop",
    caption: "The workshop crew",
    pos: "50% 40%",
  },
];

export const STATS = [
  { value: 70, suffix: "", label: "Team members" },
  { value: 3, suffix: "", label: "International competitions" },
  { value: 1, suffix: "st", label: "Algerian team at Formula Student UK" },
];

export const VALUES = [
  {
    title: "Rigour",
    text: "Every part is calculated, simulated and validated before it is made.",
  },
  {
    title: "Ambition",
    text: "Few resources, many ideas: competing with the best universities in the world.",
  },
  {
    title: "Together",
    text: "Mechanical, electrical, software and business: one car on the grid.",
  },
];

// ---------------------------------------------------------------- THE CAR
export const CAR = {
  number: 19,
  event: "FS UK 2026",
  specs: [
    { key: "0–100 km/h", value: 5, unit: "s", gauge: 0.62 },
    { key: "Top speed", value: 200, unit: "km/h", gauge: 0.8 },
    { key: "Weight", value: 314, unit: "kg", gauge: 0.55 },
    { key: "Power", value: 92, unit: "hp", gauge: 0.7 },
    { key: "Torque", value: 78, unit: "Nm", gauge: 0.6 },
  ],
  drivetrain: {
    key: "Transmission",
    value: "RWD · 6-speed sequential gearbox",
  },
};

/** The car section, year by year. 2026 = car #19 (what we built and did with it); 2027 = goals and projects. */
export const CAR_YEARS = {
  y2026: {
    year: "2026",
    title: "Car #19",
    sub: "Internal combustion · FS UK 2026",
    scrutineering: {
      value: 80,
      suffix: "%",
      label: "Technical scrutineering reached, with a validated chassis",
    },
    did: [
      "Designed and manufactured in Algeria: our first single-seater",
      "First Algerian team ever at Formula Student UK, Silverstone, 15–19 July 2026",
      "Static events: Design 79 · Cost Report 60 · Business Presentation 30.3 · Lap Time Simulation 6.5",
      "Allan Staniforth Best Newcomer Award, our first trophy",
    ],
  },
  y2027: {
    year: "2027",
    title: "Goals & projects",
    sub: "Season 2026|27",
    goals: [
      "A new internal combustion car that surpasses car #19",
      "Better performance, reliability and overall design, built on the lessons from our first car",
      "Complete the design of our first electric Formula Student car (build in 2028)",
      "Enter a new competition: MATE ROV, underwater robotics",
    ],
  },
};

// ---------------------------------------------------------------- LAST SEASON
export const LAST_SEASON = {
  event: "Formula Student UK 2026",
  place: "Silverstone Circuit, United Kingdom",
  award: "Allan Staniforth Best Newcomer Award",
  /** Official FS UK 2026 results (Formula Student Class). */
  rankings: [
    { key: "Project Management", rank: 5, of: 40 },
    { key: "Lap Time Simulation", rank: 24, of: 34 },
    { key: "Engineering Design", rank: 30, of: 64 },
    { key: "Cost & Manufacturing", rank: 36, of: 64 },
    { key: "Business Plan Presentation", rank: 46, of: 64 },
  ],
  overall: { key: "Overall (Formula Student Class)", rank: 44, of: 64 },
  stages: { chassis: "Validated", scrutineering: 80 },
  recognition: [
    "Distinction from the Ministry of Higher Education",
    "The President of the Republic praised our performance at Silverstone",
    "Recognition and sponsorship from the Ministry of Startups",
    "Recognition and sponsorship from the Algerian Ambassador in London",
    "Wide media coverage",
  ],
};

export const TIMELINE = [
  { date: "The beginning", title: "Formula Student team", text: "ENP students set out to design and build a Formula Student car from scratch." },
  { date: "Design", title: "Concept & design", text: "Chassis, suspension kinematics, CFD: every subsystem is calculated before it is made." },
  { date: "Build", title: "Manufacturing", text: "Machining, welding and assembly by the team: the first single-seater presented by an Algerian team." },
  { date: "Testing", title: "On track", text: "Car #19 runs for the first time: testing sessions before leaving for Silverstone." },
  { date: "15 — 19 July 2026", title: "Silverstone", text: "The first Algerian team ever at Formula Student UK. Chassis validated, 80% of technical scrutineering completed." },
  { date: "July 2026", title: "Best Newcomer", text: "The Allan Staniforth Best Newcomer Award, our first trophy." },
  { date: "August 2026", title: "National recognition", text: "Honoured by the Ministry of Higher Education and praised by the President of the Republic." },
  { date: "Season 2026 — 27", title: "Three projects", text: "A new IC car, an EV concept and an underwater robot for MATE ROV." },
];

// ---------------------------------------------------------------- THIS SEASON
export const THIS_SEASON = [
  {
    n: "01",
    code: "IC",
    title: "IC Dynamic",
    status: "In development",
    text: "Our goal is a new internal combustion car that surpasses our first edition. Drawing on the lessons from our previous car, we are improving its performance, reliability and overall design. We want a more competitive and more refined vehicle.",
    tags: ["Performance", "Reliability", "Dynamic events"],
  },
  {
    n: "02",
    code: "EV",
    title: "EV Concept Class",
    status: "Design 2027 · Build 2028",
    text: "Our new project: designing a complete electric Formula Student car. The work covers simulations, calculations, technical reports, cost analysis and project management. We aim to complete the design in 2027 and build the physical car in 2028.",
    tags: ["High voltage", "Simulation", "Cost analysis"],
  },
  {
    n: "03",
    code: "ROV",
    title: "MATE ROV",
    status: "New competition",
    text: "MATE ROV is a competition where students design and build underwater robots, also called ROVs. The robots complete missions inspired by real maritime work.",
    tags: ["Robotics", "Underwater", "Missions"],
  },
];

// ---------------------------------------------------------------- STRUCTURE
export type Unit = {
  id: string;
  name: string;
  short: string;
  lead?: { role: string; name: string }[];
  roles: string[];
  members: number;
  blurb: string;
};

export const GOVERNANCE = {
  board: {
    name: "Board of Directors",
    text: "Strategic direction and governance of the association.",
  },
  bureau: {
    name: "Executive Bureau",
    text: "Department heads and technical leads: runs the team day to day.",
  },
};

export const CLUB_DEPARTMENTS: Unit[] = [
  {
    id: "projet",
    name: "Project Department",
    short: "Projects",
    members: 1,
    lead: [{ role: "Project Manager", name: "Youcef Bengoumida" }],
    roles: [
      "Formula Student (main project)",
      "Additional competition projects",
    ],
    blurb:
      "Runs the competition projects, starting with the Formula Student car.",
  },
  {
    id: "formation",
    name: "Training & Industry",
    short: "Training",
    members: 2,
    lead: [{ role: "Head", name: "Anefal Choumane" }],
    roles: ["Member training", "Industry relations"],
    blurb: "Builds members' skills and connects the team with industry.",
  },
  {
    id: "media",
    name: "Media & Science Journalism",
    short: "Media",
    members: 4,
    lead: [
      { role: "Lead Journalist", name: "Besma Kada" },
      { role: "Head of Production", name: "Moncef Meguellati" },
    ],
    roles: ["Science writing", "Photo & video production"],
    blurb:
      "Tells the story: content, video production and science communication.",
  },
  {
    id: "si",
    name: "Information Systems",
    short: "IS",
    members: 6,
    lead: [{ role: "Head", name: "Mohamed Amine Ould Khaoua" }],
    roles: ["Team ERP", "Website & internal tools"],
    blurb: "Builds the team ERP, internal tools and digital platform.",
  },
  {
    id: "business",
    name: "Business Projects",
    short: "Business",
    members: 11,
    roles: ["Business plan", "Innovation projects"],
    blurb: "Business plan, business model and new projects for the team.",
  },
  {
    id: "operations",
    name: "Operations & Partnerships",
    short: "Operations",
    members: 7,
    lead: [{ role: "Head", name: "Hammouda Baouchi" }],
    roles: ["Logistics", "Partner & sponsor relations"],
    blurb: "Logistics, travel to competitions and relations with our partners.",
  },
];

export const FS_LEADERSHIP = [
  { role: "Team Lead", name: "Youcef Bengoumida" },
  { role: "Chief Engineer", name: "Aimen Hamour" },
  { role: "Manufacturing & Workshop", name: "Zahreddin Sebaa" },
  { role: "Team Manager", name: "Imane Lounis" },
];

export const FS_DEPARTMENTS: Unit[] = [
  {
    id: "suspension",
    name: "Suspension & Steering",
    short: "Suspension",
    members: 5,
    lead: [{ role: "Lead", name: "Chakib Tetbirt" }],
    roles: ["Steering system", "Suspension design", "Vehicle dynamics"],
    blurb: "Kinematics, damping and steering: keeping the car on the track.",
  },
  {
    id: "chassis",
    name: "Chassis & Ergonomics",
    short: "Chassis",
    members: 4,
    lead: [{ role: "Lead", name: "Moncef Abed" }],
    roles: ["Chassis design", "Driver ergonomics"],
    blurb: "Tubular frame, stiffness, safety and the driver's cockpit.",
  },
  {
    id: "powertrain",
    name: "Powertrain",
    short: "Powertrain",
    members: 7,
    lead: [{ role: "Lead", name: "Youcef Ouarab" }],
    roles: [
      "Intake / Exhaust",
      "Drivetrain",
      "Braking",
      "Cooling / Fuel",
      "EV powertrain",
    ],
    blurb:
      "From engine to wheels: drivetrain, brakes, cooling and the move to electric.",
  },
  {
    id: "aero",
    name: "Aerodynamics",
    short: "Aero",
    members: 4,
    lead: [{ role: "Lead", name: "Abid Boussaha" }],
    roles: ["Aerodynamics & CFD", "Chassis–aero integration"],
    blurb: "Wings, undertray and CFD simulations to generate downforce.",
  },
  {
    id: "electronics",
    name: "Electronics",
    short: "Electronics",
    members: 14,
    lead: [{ role: "Lead", name: "Brahim Khial" }],
    roles: [
      "HV battery & BMS",
      "HV motors",
      "HV / LV harness",
      "Control & safety",
      "Sensors & data acquisition",
    ],
    blurb:
      "Phase 1: the high-voltage system of the future EV. Phase 2: IC embedded electronics.",
  },
];

// ---------------------------------------------------------------- PARTNERS
/**
 * "They trusted us" | from the team's "Thanks to our sponsors" posts (Instagram @enp.rt, Aug 2026).
 * Gold partners have their own logo card; silver and bronze partners are shown on the official boards.
 * To add/replace a logo: drop it in /public/partners/ and edit this list.
 */
export type Partner = { name: string; logo: string };
export const PARTNERS: {
  packs: {
    id: "gold" | "silver" | "bronze";
    name: string;
    accent: string;
    perks: string;
    partners: Partner[];
  }[];
  institutional: string[];
} = {
  packs: [
    {
      id: "gold",
      name: "Gold pack",
      accent: "#d9b35a",
      perks:
        "Logo on the bodywork · website & social media · event invitations",
      partners: [
        { name: "VMS", logo: "/partners/logos/vms.png" },
        { name: "Cosider", logo: "/partners/logos/cosider.png" },
        { name: "Djezzy Student Campuce", logo: "/partners/logos/djezzy.png" },
        { name: "Air Algérie", logo: "/partners/logos/air-algerie.png" },
        { name: "Trans Baouchi", logo: "/partners/logos/trans-baouchi.png" },
        {
          name: "Mondial Industrie",
          logo: "/partners/logos/mondial-industrie.png",
        },
        { name: "OXY", logo: "/partners/logos/oxy.png" },
        { name: "SANP", logo: "/partners/logos/sanp.png" },
        { name: "Diar Dzair", logo: "/partners/logos/diar-dzair.png" },
      ],
    },
    {
      id: "silver",
      name: "Silver pack",
      accent: "#c3c8d2",
      perks: "Logo on the wing or chassis · listed on the website",
      partners: [
        { name: "PAC", logo: "/partners/logos/pac.png" },
        {
          name: "Merbah Industry",
          logo: "/partners/logos/merbah-industry.png",
        },
        { name: "Promosalons", logo: "/partners/logos/promosalons.png" },
        { name: "SLB", logo: "/partners/logos/slb.png" },
        { name: "Purepox", logo: "/partners/logos/purepox.png" },
        { name: "MathWorks", logo: "/partners/logos/mathworks.png" },
        { name: "Ansys", logo: "/partners/logos/ansys.png" },
        { name: "Technonum", logo: "/partners/logos/technonum.png" },
        { name: "SKF", logo: "/partners/logos/skf.png" },
        { name: "El-Maarifa", logo: "/partners/logos/el-maarifa.png" },
        { name: "ENP Incubator", logo: "/partners/logos/enp-incubator.png" },
        { name: "AGB", logo: "/partners/logos/agb.png" },
        { name: "MAN", logo: "/partners/logos/man.png" },
        { name: "FASM", logo: "/partners/logos/fasm.png" },
        { name: "IPG", logo: "/partners/logos/ipg.png" },
        { name: "BK Fire", logo: "/partners/logos/bk-fire.png" },
        {
          name: "Qammac Industry",
          logo: "/partners/logos/qammac-industry.png",
        },
        { name: "ALMITech", logo: "/partners/logos/almitech.png" },
        { name: "Bettam", logo: "/partners/logos/bettam.png" },
        { name: "Rhodius", logo: "/partners/logos/rhodius.png" },
        { name: "SimScale", logo: "/partners/logos/simscale.png" },
        { name: "CRTI", logo: "/partners/logos/crti.png" },
        {
          name: "Dassault Systèmes",
          logo: "/partners/logos/dassault-systemes.png",
        },
        { name: "ENP", logo: "/partners/logos/enp.png" },
        { name: "Rapid Harness", logo: "/partners/logos/rapid-harness.png" },
      ],
    },
    {
      id: "bronze",
      name: "Bronze pack",
      accent: "#c48455",
      perks: "Listed on the website and partner boards",
      partners: [
        { name: "Fluidex", logo: "/partners/logos/fluidex.png" },
        { name: "AB Precision", logo: "/partners/logos/ab-precision.png" },
        { name: "HK Industrie", logo: "/partners/logos/hk-industrie.png" },
        {
          name: "Euro Protection",
          logo: "/partners/logos/euro-protection.png",
        },
        { name: "Ide-Net", logo: "/partners/logos/ide-net.png" },
        {
          name: "Découpe Laser Hammdi",
          logo: "/partners/logos/decoupe-laser-hammdi.png",
        },
        { name: "NG Brakes", logo: "/partners/logos/ng-brakes.png" },
        { name: "Technomotiv", logo: "/partners/logos/technomotiv.png" },
        { name: "Motor 9", logo: "/partners/logos/motor-9.png" },
        { name: "PIM Algérie", logo: "/partners/logos/pim-algerie.png" },
      ],
    },
  ],
  institutional: [
    "Ministry of Higher Education",
    "Ministry of Startups",
    "Embassy of Algeria in London",
  ],
};

// ---------------------------------------------------------------- GALLERY (Instagram @enp.rt)
export const GALLERY: {
  src: string;
  caption: string;
  span?: "w" | "t" | "big";
}[] = [
  {
    src: "/gallery/pitlane-car.jpg",
    caption: "Car #19 in the Silverstone pit lane",
    span: "big",
  },
  {
    src: "/gallery/grid-team.jpg",
    caption: "The team on the Silverstone grid",
    span: "t",
  },
  { src: "/gallery/driver.jpg", caption: "In the cockpit, FS UK 2026" },
  { src: "/gallery/flag.jpg", caption: "Algeria at Silverstone" },
  {
    src: "/gallery/paddock-work.jpg",
    caption: "Design judging in the paddock",
    span: "w",
  },
  { src: "/gallery/welcome.jpg", caption: "Arrival at Silverstone" },
  {
    src: "/gallery/workshop.jpg",
    caption: "Assembling the car in the ENP workshop",
    span: "w",
  },
  { src: "/gallery/bodywork.jpg", caption: "Nose cone, ready for paint" },
  { src: "/gallery/wiring.jpg", caption: "Wiring the harness" },
  { src: "/gallery/mentoring.jpg", caption: "Late nights in the workshop" },
  {
    src: "/gallery/night-test.jpg",
    caption: "Night testing before Silverstone",
    span: "w",
  },
  {
    src: "/gallery/unveiling.jpg",
    caption: "Unveiling car #19, August 2026",
    span: "w",
  },
  { src: "/gallery/ceremony.jpg", caption: "Honoured in Algiers, August 2026" },
  { src: "/gallery/silverstone-gate.jpg", caption: "Silverstone, July 2026" },
];

export const WHY_PARTNER = [
  {
    n: "01",
    title: "On the car",
    text: "Your logo on the livery of car #19, on the Silverstone track and in every photo of the competition.",
  },
  {
    n: "02",
    title: "Access to talent",
    text: "Meet Algeria's best engineering students, trained on a real project from A to Z.",
  },
  {
    n: "03",
    title: "A national story",
    text: "Associate your brand with Algeria's first Formula Student single-seater, praised by the President of the Republic.",
  },
  {
    n: "04",
    title: "Content & reach",
    text: "Features on our social channels, events, car presentations and press coverage.",
  },
];

export const TIERS = [
  {
    name: "Title",
    accent: "#e1251b",
    perks: [
      "Name associated with the team & car",
      "XXL logo on livery and team wear",
      "Private event with the car",
      "Priority access to recruitment",
    ],
  },
  {
    name: "Platinum",
    accent: "#ece8df",
    perks: [
      "Major logo on the bodywork",
      "Logo on team wear",
      "Car showcased at your premises",
    ],
  },
  {
    name: "Gold",
    accent: "#d9b35a",
    perks: [
      "Logo on the bodywork",
      "Featured on website & social media",
      "Invitations to events",
    ],
  },
  {
    name: "Silver",
    accent: "#b9bcc0",
    perks: ["Logo on wing or chassis", "Listed on the website"],
  },
  {
    name: "Technical",
    accent: "#1fb25a",
    perks: [
      "Materials, machining, software",
      "Equivalent visibility in return",
    ],
  },
];
