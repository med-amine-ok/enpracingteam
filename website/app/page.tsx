import Image from "next/image";
import ScrollScene from "@/components/ScrollScene";
import Motion from "@/components/Motion";
import Loader from "@/components/Loader";
import Chrome from "@/components/Chrome";
import Structure from "@/components/Structure";
import Gallery from "@/components/Gallery";
import YearTabs from "@/components/YearTabs";
import { Btn, Icon, Marks, SectionHead } from "@/components/ui";
import {
  ABOUT,
  ABOUT_PHOTOS,
  CAR,
  CAR_YEARS,
  CONTACT_PEOPLE,
  FORMULA_STUDENT,
  LAST_SEASON,
  PARTNERS,
  SITE,
  STATS,
  THIS_SEASON,
  TIERS,
  TIMELINE,
  VALUES,
  WHY_PARTNER,
} from "@/lib/content";

const Y26 = CAR_YEARS.y2026;
const Y27 = CAR_YEARS.y2027;

/** Kerb strip with a timing-feed ticker running across it. */
function Ticker({ items, light }: { items: string[]; light?: boolean }) {
  const row = [...items, ...items, ...items];
  return (
    <div className={`ticker ${light ? "is-light" : ""}`} aria-hidden>
      <div className="ticker-kerb" />
      <div className="ticker-feed">
        <div className="ticker-track">
          {row.map((t, i) => (
            <span key={i}>
              <b>{String((i % items.length) + 1).padStart(2, "0")}</b>
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className="ticker-kerb" />
    </div>
  );
}

/** Instrument-cluster gauge: arc with ticks, animated needle, counted value. */
function Gauge({
  k,
  value,
  unit,
  gauge,
}: {
  k: string;
  value: number;
  unit: string;
  gauge: number;
}) {
  const angle = -90 + gauge * 180;
  return (
    <div className="gauge">
      <div className="gauge-dial">
        <svg viewBox="0 0 200 110" aria-hidden>
          <path className="gauge-track" d="M14 100 A86 86 0 0 1 186 100" />
          <path
            className="gauge-fill"
            d="M14 100 A86 86 0 0 1 186 100"
            pathLength={1}
            style={{ strokeDasharray: `${gauge} 1`, strokeDashoffset: gauge }}
            data-gauge={gauge}
          />
          {Array.from({ length: 21 }, (_, i) => {
            const a = Math.PI - (i / 20) * Math.PI;
            const r1 = i % 5 === 0 ? 66 : 72;
            return (
              <line
                key={i}
                x1={100 + Math.cos(a) * r1}
                y1={100 - Math.sin(a) * r1}
                x2={100 + Math.cos(a) * 78}
                y2={100 - Math.sin(a) * 78}
                className={i % 5 === 0 ? "major" : ""}
              />
            );
          })}
        </svg>
        <span
          className="gauge-needle"
          data-needle={angle}
          style={{ ["--a" as string]: `${angle}deg` }}
        />
        <span className="gauge-hub" />
      </div>
      <div className="gauge-read">
        <b data-count={value}>{value}</b>
        <span>{unit}</span>
      </div>
      <div className="gauge-key">{k}</div>
    </div>
  );
}

export default function Home() {
  return (
    <>
      <Loader />
      <Motion />
      <Chrome />

      <main>
        <ScrollScene />

        <Ticker
          items={[
            "Formula Student UK 2026",
            "Silverstone Circuit",
            "Best Newcomer Award",
            "Car #19",
            "Made in Algeria",
            "ENP Algiers",
          ]}
        />

        {/* ---------------------------------------------------------------- WHAT IS FORMULA STUDENT */}
        <section id="formula-student" className="section fs">
          <div className="wrap">
            <SectionHead
              code="S01"
              name="Formula Student"
              meta="IMechE · Silverstone"
              title={["What is", "Formula Student?"]}
            />
            <div className="fs-grid">
              <p className="fs-lead" data-reveal>
                {FORMULA_STUDENT.lead}
              </p>
              <div className="fs-side">
                <p data-reveal data-delay="0.1">
                  {FORMULA_STUDENT.body}
                </p>
                <dl className="fs-facts" data-stagger>
                  {FORMULA_STUDENT.facts.map((f) => (
                    <div key={f.k}>
                      <dt>{f.k}</dt>
                      <dd>{f.v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
            <p className="fs-punch" data-split>
              <span className="line">
                <span>{FORMULA_STUDENT.punch}</span>
              </span>
            </p>
          </div>
        </section>

        {/* ---------------------------------------------------------------- WHO WE ARE */}
        <section id="about" className="section about">
          <div className="wrap">
            <SectionHead
              code="S02"
              name="Who we are"
              meta="ENP·RT · Algiers"
              title={["One club,", "seventy engineers"]}
            />

            <div className="about-intro">
              <div className="collage" aria-label="The team">
                {ABOUT_PHOTOS.map((ph, i) => (
                  <figure
                    key={ph.src}
                    className={`collage-item c${i + 1}`}
                    data-reveal={i % 2 ? "right" : "up"}
                    data-delay={String(i * 0.08)}
                  >
                    <div
                      className="collage-inner"
                      data-parallax={String(0.08 + (i % 3) * 0.06)}
                    >
                      <Image
                        src={ph.src}
                        alt={ph.alt}
                        fill
                        quality={92}
                        sizes="(max-width: 900px) 90vw, 34vw"
                        style={{ objectFit: "cover", objectPosition: ph.pos }}
                      />
                    </div>
                    <figcaption>{ph.caption}</figcaption>
                  </figure>
                ))}
                <span className="collage-tag" aria-hidden>
                  <b>70</b> engineers,
                  <br />
                  one family
                </span>
              </div>
              <p className="statement" data-highlight>
                {ABOUT.statement}
              </p>
            </div>

            <div className="about-grid">
              <figure className="about-photo" data-clip>
                <div className="about-photo-inner" data-parallax="0.18">
                  <Image
                    src="/gallery/workshop.jpg"
                    alt="ENP Racing Team students assembling the car in the ENP workshop"
                    fill
                    sizes="(max-width: 900px) 100vw, 60vw"
                    style={{ objectFit: "cover" }}
                  />
                </div>
                <figcaption>
                  <span className="cap-num">ENP</span>
                  <span>
                    The workshop
                    <small>National Polytechnic School · Algiers</small>
                  </span>
                </figcaption>
              </figure>
              <div className="about-text">
                <p data-reveal>{ABOUT.p1}</p>
                <p data-reveal data-delay="0.1">
                  {ABOUT.p2}
                </p>
                <ol className="values" data-stagger>
                  {VALUES.map((v, i) => (
                    <li className="value" key={v.title}>
                      <span className="value-n">V{i + 1}</span>
                      <h3>{v.title}</h3>
                      <p>{v.text}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            <div className="readout-head">
              <span className="sec-code">DATA</span>
              <span>ENP Racing Team in numbers</span>
            </div>
            <div className="readout" data-stagger>
              {STATS.map((s, i) => (
                <div className="readout-cell" key={s.label}>
                  <span className="readout-id">T-0{i + 1}</span>
                  <div className="readout-num">
                    <span data-count={s.value}>{s.value}</span>
                    <em>{s.suffix}</em>
                  </div>
                  <div className="readout-label">{s.label}</div>
                  <span className="readout-ticks" aria-hidden />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- TIMELINE (pinned horizontal) */}
        <section className="timeline" data-hscroll aria-label="Our journey">
          <div className="timeline-head wrap">
            <div className="sec-bar is-light">
              <span className="sec-code">S03</span>
              <span className="sec-name">Our journey</span>
              <span className="timeline-progress">
                <i />
              </span>
              <span className="sec-meta">Lap 01</span>
            </div>
          </div>
          <div className="timeline-track" data-hscroll-track>
            <div className="timeline-intro">
              <h2>
                From the
                <br />
                first sketch
                <br />
                <em>to a trophy.</em>
              </h2>
            </div>
            {TIMELINE.map((t, i) => (
              <article
                className={`tl-card ${i === 4 ? "is-key" : ""}`}
                key={t.title}
              >
                <Marks />
                <div className="tl-top">
                  <span className="tl-n">{String(i + 1).padStart(2, "0")}</span>
                  <span className="tl-date">{t.date}</span>
                </div>
                <h3>{t.title}</h3>
                <p>{t.text}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------------- THE CAR, year by year */}
        <section id="car" className="section car">
          <div className="wrap">
            <SectionHead
              code="S04"
              name="Our racing cars"
              meta="2026 → 2027"
              title={["Year by year.", "Built to race."]}
              desc="Our first single-seater was designed and manufactured in Algeria and taken to Silverstone in July 2026. Here is what we did with it, and where we are going next."
            />
            <YearTabs
              years={[
                { year: Y26.year, label: Y26.title },
                { year: Y27.year, label: Y27.title },
              ]}
              panels={[
                <div key="26" className="year">
                  <div className="year-head">
                    <span className="sec-code">{Y26.year}</span>
                    <h3>{Y26.title}</h3>
                    <span className="year-sub">{Y26.sub}</span>
                  </div>
                  <div className="car-grid">
                    <div className="cluster" data-stagger>
                      {CAR.specs.map((s) => (
                        <Gauge
                          key={s.key}
                          k={s.key}
                          value={s.value}
                          unit={s.unit}
                          gauge={s.gauge}
                        />
                      ))}
                      <div className="gearbox">
                        <div className="gearbox-gate" aria-hidden>
                          <span>+</span>
                          {[4, 3, 2, 1].map((g) => (
                            <i key={g}>{g}</i>
                          ))}
                          <i className="n">N</i>
                          <span>−</span>
                        </div>
                        <div>
                          <div className="gauge-key">{CAR.drivetrain.key}</div>
                          <b className="gearbox-val">RWD</b>
                          <p>4-speed sequential gearbox</p>
                        </div>
                      </div>
                    </div>
                    <figure className="car-photo" data-reveal="scale">
                      <Image
                        src="/gallery/pitlane-car.jpg"
                        alt="ENP Racing Team car #19 in the Silverstone pit lane"
                        fill
                        sizes="(max-width: 900px) 100vw, 45vw"
                        style={{
                          objectFit: "cover",
                          objectPosition: "30% 60%",
                        }}
                      />
                      <figcaption>
                        <span className="cap-num">19</span>
                        <span>
                          ENP Racing Team
                          <small>{CAR.event}</small>
                        </span>
                      </figcaption>
                    </figure>
                  </div>
                  <div className="year-did">
                    <div className="scrut">
                      <span className="sec-code">SCRUT</span>
                      <div className="scrut-num">
                        <span data-count={Y26.scrutineering.value}>
                          {Y26.scrutineering.value}
                        </span>
                        <em>{Y26.scrutineering.suffix}</em>
                      </div>
                      <div className="scrut-bar" aria-hidden>
                        <i style={{ width: `${Y26.scrutineering.value}%` }} />
                      </div>
                      <p>{Y26.scrutineering.label}</p>
                    </div>
                    <div>
                      <h4 className="list-title">
                        <span className="sec-code">DID</span> What we did with
                        it
                      </h4>
                      <ol className="checklist">
                        {Y26.did.map((d) => (
                          <li key={d}>
                            <span className="check" aria-hidden />
                            {d}
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                </div>,
                <div key="27" className="year">
                  <div className="year-head">
                    <span className="sec-code">{Y27.year}</span>
                    <h3>{Y27.title}</h3>
                    <span className="year-sub">{Y27.sub}</span>
                  </div>
                  <ol className="goals">
                    {Y27.goals.map((g, i) => (
                      <li key={g}>
                        <span className="goal-n">G{i + 1}</span>
                        <p>{g}</p>
                      </li>
                    ))}
                  </ol>
                  <div className="proj-grid">
                    {THIS_SEASON.map((p) => (
                      <article
                        className={`proj proj-${p.code.toLowerCase()}`}
                        key={p.code}
                      >
                        {p.code === "ROV" && (
                          <span className="water" aria-hidden>
                            <i className="water-caustics" />
                            <i className="water-wave" />
                            <i className="water-bubbles" />
                          </span>
                        )}
                        <div className="proj-top">
                          <span className="proj-n">{p.n}</span>
                          <span className="proj-status">{p.status}</span>
                        </div>
                        <span className="proj-code">{p.code}</span>
                        <h3>{p.title}</h3>
                        <p>{p.text}</p>
                        <ul className="proj-tags">
                          {p.tags.map((t) => (
                            <li key={t}>{t}</li>
                          ))}
                        </ul>
                      </article>
                    ))}
                  </div>
                </div>,
              ]}
            />
          </div>
        </section>

        {/* ---------------------------------------------------------------- LAST SEASON */}
        <section id="season" className="section silverstone">
          <div className="wrap">
            <SectionHead
              code="S05"
              name="Last season"
              meta="15|19.07.2026"
              title={["Last season:", "what did we achieve?"]}
              desc="Formula Student UK 2026 at Silverstone: our first competition, and our first trophy."
            />

            <div className="ss-grid">
              <figure className="ss-photo" data-reveal="scale">
                <Image
                  src="/gallery/grid-team.jpg"
                  alt="The ENP Racing Team walking the Silverstone grid with car #19"
                  fill
                  sizes="(max-width: 900px) 100vw, 55vw"
                  style={{ objectFit: "cover" }}
                />
                <figcaption>
                  <span className="cap-num">FS UK</span>
                  <span>
                    Silverstone paddock
                    <small>July 2026</small>
                  </span>
                </figcaption>
              </figure>

              <div className="ss-side">
                <div className="plaque" data-reveal="right">
                  <span className="plaque-screw" />
                  <span className="plaque-screw" />
                  <span className="plaque-screw" />
                  <span className="plaque-screw" />
                  <small>Formula Student UK · 2026</small>
                  <b>{LAST_SEASON.award}</b>
                  <span className="plaque-rule" />
                  <span className="plaque-foot">
                    <span>Best first-time team</span>
                    <span>ENP Racing Team · #19</span>
                  </span>
                </div>

                <div className="board" data-reveal="right" data-delay="0.1">
                  <div className="board-head">
                    <span>Static events</span>
                    <span>Points</span>
                  </div>
                  <ul className="board-rows">
                    {LAST_SEASON.scores.map((s, i) => (
                      <li key={s.key}>
                        <span className="board-pos-n">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="board-key">{s.key}</span>
                        <span className="board-val">
                          <span data-count={s.value} data-decimals={s.decimals}>
                            {s.value}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="board-foot">
                    <span className="led" /> Chassis validated · 80% technical
                    scrutineering
                  </div>
                </div>
              </div>
            </div>

            <div className="season-lists">
              <div>
                <h3 className="list-title">
                  <span className="sec-code">ACH</span> Achievements
                </h3>
                <ol className="checklist" data-stagger>
                  {LAST_SEASON.achievements.map((a) => (
                    <li key={a}>
                      <span className="check" aria-hidden />
                      {a}
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <h3 className="list-title">
                  <span className="sec-code">REC</span> Recognition
                </h3>
                <ol className="checklist" data-stagger>
                  {LAST_SEASON.recognition.map((a) => (
                    <li key={a}>
                      <span className="check" aria-hidden />
                      {a}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- GALLERY */}
        <section id="paddock" className="section gallery">
          <div className="wrap">
            <SectionHead
              code="CAM"
              name="From the paddock"
              meta="@enp.rt"
              title={["From the workshop", "to the grid"]}
              desc="Moments from the build in Algiers and the week at Silverstone, shot by the team's media department."
            />
            <Gallery />
            <a
              className="ig-link"
              href={SITE.instagram}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>More on Instagram</span>
              <b>@enp.rt</b>
              <Icon name="up-right" />
            </a>
          </div>
        </section>

        <Ticker
          light
          items={[
            "Business Presentation",
            "Cost Report",
            "Engineering Design",
            "Acceleration",
            "Skid Pad",
            "Autocross",
            "Endurance",
          ]}
        />

        {/* ---------------------------------------------------------------- STRUCTURE */}
        <section id="structure" className="section structure">
          <div className="wrap">
            <SectionHead
              code="S07"
              name="Structure"
              meta="Season 2026|27"
              title={["Organised like", "a constructor"]}
              desc="Just like a real racing team: a board, an executive bureau, six cross-functional departments and a Formula Student team with five technical departments. Select a department to open it."
            />
            <Structure />
          </div>
        </section>

        {/* ---------------------------------------------------------------- PARTNERS */}
        <section id="partners" className="section partners">
          <div className="wrap">
            <SectionHead
              code="S08"
              name="They trusted us"
              meta="Partners"
              title={["They", "trusted us"]}
              desc="Behind every lap there is a network of partners who believed in a young Algerian team before it had proven anything."
            />

            <div className="packs">
              {PARTNERS.packs.map((pk) => (
                <div
                  key={pk.id}
                  className={`pack pack-${pk.id}`}
                  style={{ ["--accent" as string]: pk.accent }}
                >
                  <div className="pack-head">
                    <span className="pack-medal" aria-hidden />
                    <h3>{pk.name}</h3>
                    <span className="pack-count">
                      {String(pk.partners.length).padStart(2, "0")} partners
                    </span>
                    <p>{pk.perks}</p>
                  </div>
                  <ul className="pack-logos" data-stagger>
                    {pk.partners.map((p) => (
                      <li key={p.name} title={p.name}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.logo}
                          alt={p.name}
                          loading="lazy"
                          decoding="async"
                        />
                      </li>
                    ))}
                    {pk.id === "gold" && (
                      <li className="pack-open">
                        <a href="#deck">
                          <b>Your logo here</b>
                          <small>
                            Become a partner <Icon name="arrow" size={14} />
                          </small>
                        </a>
                      </li>
                    )}
                  </ul>
                </div>
              ))}
            </div>
            <p className="institutional">
              With the support of {PARTNERS.institutional.join(" · ")}
            </p>

            <div className="partner-with-us">
              <SectionHead
                code="S09"
                name="Partner with us"
                meta="Season 2027"
                title={["Race with us", "into 2027"]}
                desc="Every contribution directly funds parts, tools, software or travel to competitions."
              />
            </div>

            <ol className="why" data-stagger>
              {WHY_PARTNER.map((w) => (
                <li className="why-row" key={w.n}>
                  <span className="why-n">{w.n}</span>
                  <h3>{w.title}</h3>
                  <p>{w.text}</p>
                  <span className="why-go">
                    <Icon name="arrow" />
                  </span>
                </li>
              ))}
            </ol>

            <div className="grid-wrap">
              <div className="grid-head">
                <span className="sec-code">Grid</span>
                <span>Partnership levels: pick your spot on the grid</span>
              </div>
              <div className="grid" data-stagger>
                {TIERS.map((t, i) => (
                  <article
                    className="slot"
                    key={t.name}
                    style={{ ["--accent" as string]: t.accent }}
                  >
                    <span className="slot-p">P{i + 1}</span>
                    <div className="slot-body">
                      <h3>{t.name}</h3>
                      <ul>
                        {t.perks.map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <div className="deck" id="deck" data-reveal>
              <span className="deck-icon" aria-hidden>
                <span>PDF</span>
              </span>
              <div className="deck-copy">
                <h3>Sponsorship deck 2026|27</h3>
                <p>
                  The team, the car, Silverstone, this season&apos;s projects
                  and partnership levels · 7 pages
                </p>
              </div>
              <div className="deck-ctas">
                <Btn href={SITE.dossier} download icon="down">
                  Download
                </Btn>
                <a
                  className="deck-mail"
                  href={`mailto:${SITE.email}?subject=Partnership%20with%20ENP%20Racing%20Team`}
                >
                  or talk to the team <Icon name="arrow" size={14} />
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- CONTACT */}
        <section id="contact" className="section contact">
          <div className="wrap">
            <div className="contact-big" data-split>
              <span className="line">
                <span>Ready for</span>
              </span>
              <span className="line">
                <span>
                  <em>the next lap?</em>
                </span>
              </span>
            </div>
            <div className="contact-grid" data-stagger>
              <a className="contact-row" href={`mailto:${SITE.email}`}>
                <small>Email</small>
                <b>{SITE.email}</b>
                <Icon name="arrow" />
              </a>
              <a
                className="contact-row"
                href={SITE.instagram}
                target="_blank"
                rel="noopener noreferrer"
              >
                <small>Instagram</small>
                <b>@enp.rt</b>
                <Icon name="up-right" />
              </a>
              <a
                className="contact-row"
                href={SITE.linkedin}
                target="_blank"
                rel="noopener noreferrer"
              >
                <small>LinkedIn</small>
                <b>ENP Racing Team</b>
                <Icon name="up-right" />
              </a>
              <div className="contact-row">
                <small>Workshop</small>
                <b>{SITE.address}</b>
              </div>
            </div>
            <div className="people" data-stagger>
              {CONTACT_PEOPLE.map((c) => (
                <div className="person" key={c.email}>
                  <span className="person-role">{c.role}</span>
                  <b className="person-name">{c.name}</b>
                  <a className="person-link" href={`mailto:${c.email}`}>
                    <Icon name="arrow" size={14} />
                    {c.email}
                  </a>
                  <a className="person-link" href={`tel:+213${c.phone.slice(1)}`}>
                    <Icon name="arrow" size={14} />
                    {`+213 ${c.phone.slice(1, 4)} ${c.phone.slice(4, 6)} ${c.phone.slice(6, 8)} ${c.phone.slice(8)}`}
                  </a>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <div className="checker" aria-hidden />
      <footer className="footer">
        <div className="wrap footer-inner">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo-light-ink.png"
            alt="ENP Racing Team"
            className="footer-logo"
          />
          <div className="footer-cols">
            <span>© 2026 ENP Racing Team · {SITE.school}</span>
            <span>Built by students, for the track.</span>
            <a href="#top">Back to the grid</a>
          </div>
        </div>
      </footer>
    </>
  );
}
