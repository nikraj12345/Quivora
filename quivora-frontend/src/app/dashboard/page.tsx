"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import styles from "./dashboard.module.css";

const features = [
  {
    number: "01",
    eyebrow: "Walk in, flow through",
    title: "One scan. Zero reception chaos.",
    body: "Every hospital gets its own QR. New patients register in moments; returning patients are found securely by phone.",
    visual: "qr",
    className: styles.featureLarge,
  },
  {
    number: "02",
    eyebrow: "Clinical priority",
    title: "Urgency beats arrival time.",
    body: "Emergency, Senior and Urgent patients move safely through a reason-logged triage queue.",
    visual: "triage",
    className: styles.featureTall,
  },
  {
    number: "03",
    eyebrow: "Adaptive intelligence",
    title: "ETAs that learn every day.",
    body: "Each completed consultation teaches Quivora how that doctor works—by age band, recent pace and live conditions.",
    visual: "learning",
    className: styles.featureWide,
  },
  {
    number: "04",
    eyebrow: "Calm operations",
    title: "Every room, one live rhythm.",
    body: "Go live, pause for a break, broadcast delays and call the next patient from a simple room tablet.",
    visual: "ops",
    className: styles.featureSmall,
  },
  {
    number: "05",
    eyebrow: "Patient confidence",
    title: "No more guessing when to move.",
    body: "Patients receive timely queue updates when they are almost next, called in, or affected by a delay.",
    visual: "updates",
    className: styles.featureSmall,
  },
];

const journey = [
  ["Scan", "Hospital QR"],
  ["Register", "Phone-first profile"],
  ["Triage", "Safe priority tier"],
  ["Wait", "Live personal ETA"],
  ["Consult", "Room workflow"],
  ["Learn", "Better next estimate"],
];

function HeartPulse() {
  return (
    <svg viewBox="0 0 500 100" className={styles.ecg} aria-hidden="true">
      <path
        className={styles.ecgGhost}
        d="M0 52 H118 L136 52 L150 25 L169 77 L187 8 L208 91 L230 52 H500"
      />
      <path
        className={styles.ecgLive}
        pathLength="1"
        d="M0 52 H118 L136 52 L150 25 L169 77 L187 8 L208 91 L230 52 H500"
      />
    </svg>
  );
}

function ProductVisual() {
  return (
    <div className={styles.productScene}>
      <div className={styles.sceneGlow} />
      <div className={styles.productWindow}>
        <div className={styles.windowTop}>
          <div className={styles.windowDots}><i /><i /><i /></div>
          <span>Quivora · Live OPD</span>
          <div className={styles.livePill}><i /> Live</div>
        </div>
        <div className={styles.windowBody}>
          <div className={styles.miniSidebar}>
            <div className={styles.miniLogo}>Q</div>
            {[0, 1, 2, 3, 4].map((x) => <i key={x} className={x === 1 ? styles.activeMini : ""} />)}
          </div>
          <div className={styles.queuePanel}>
            <div className={styles.panelHeading}>
              <div>
                <small>Cardiology · Room 04</small>
                <strong>Dr. Priya Nair</strong>
              </div>
              <span>8 waiting</span>
            </div>
            {[
              ["18", "Meera Iyer", "Emergency", "Now", styles.red],
              ["24", "Raj Malhotra", "Senior 60+", "9 min", styles.violet],
              ["19", "Ananya Rao", "Urgent", "18 min", styles.orange],
              ["20", "Kabir Singh", "Standard", "27 min", styles.teal],
            ].map(([token, name, tier, eta, color], index) => (
              <div className={`${styles.queueRow} ${index === 0 ? styles.queueRowActive : ""}`} key={token}>
                <div className={styles.token}>{token}</div>
                <div className={styles.patient}>
                  <strong>{name}</strong>
                  <span><i className={color} />{tier}</span>
                </div>
                <b>{eta}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className={`${styles.floatCard} ${styles.floatEta}`}>
        <span className={styles.floatIcon}>⌁</span>
        <div><small>Your updated ETA</small><strong>10:42 AM</strong></div>
      </div>
      <div className={`${styles.floatCard} ${styles.floatLearn}`}>
        <span className={styles.learnOrb}>↗</span>
        <div><small>Learning live</small><strong>8 min avg today</strong></div>
      </div>
      <div className={styles.floatPulse}>
        <HeartPulse />
      </div>
    </div>
  );
}

function FeatureVisual({ type }: { type: string }) {
  if (type === "qr") {
    return (
      <div className={styles.qrVisual}>
        <div className={styles.phone}>
          <div className={styles.phoneNotch} />
          <div className={styles.phoneLogo}>Q</div>
          <small>Welcome to Quivora</small>
          <strong>Self check-in</strong>
          <div className={styles.phoneField}>+91 · Mobile number</div>
          <div className={styles.phoneButton}>Continue</div>
        </div>
        <div className={styles.qrCode} aria-label="Decorative QR code">
          {Array.from({ length: 49 }).map((_, i) => <i key={i} className={(i * 7 + i * i) % 5 < 2 ? styles.qrOn : ""} />)}
        </div>
        <div className={styles.scanBeam} />
      </div>
    );
  }
  if (type === "triage") {
    return (
      <div className={styles.triageVisual}>
        {[
          ["Emergency", "Critical care", "01", styles.red],
          ["Senior 60+", "Age priority", "02", styles.violet],
          ["Urgent", "Clinical need", "03", styles.orange],
          ["Standard", "Token order", "04", styles.teal],
        ].map(([label, sub, rank, color]) => (
          <div className={styles.triageRow} key={label}>
            <i className={color} />
            <div><strong>{label}</strong><small>{sub}</small></div>
            <span>{rank}</span>
          </div>
        ))}
      </div>
    );
  }
  if (type === "learning") {
    return (
      <div className={styles.learningVisual}>
        <div className={styles.learningHead}><span>Predicted consultation time</span><strong>8.4 min</strong></div>
        <div className={styles.chart}>
          {[38, 52, 45, 67, 59, 74, 69, 82, 76, 88, 84, 94].map((h, i) => (
            <i key={i} style={{ height: `${h}%`, animationDelay: `${i * 70}ms` }} />
          ))}
          <svg viewBox="0 0 400 120" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0,99 C42,88 52,68 91,74 C128,80 138,43 178,54 C219,66 235,24 270,40 C315,59 331,17 400,13" />
          </svg>
        </div>
        <div className={styles.weights}>
          <span><i /> Last hour <b>45%</b></span>
          <span><i /> Today <b>25%</b></span>
          <span><i /> This week <b>20%</b></span>
        </div>
      </div>
    );
  }
  if (type === "ops") {
    return (
      <div className={styles.opsVisual}>
        <div className={styles.doctorStatus}>
          <span className={styles.doctorAvatar}>PN</span>
          <div><strong>Dr. Priya Nair</strong><small><i /> Live · Room 04</small></div>
        </div>
        <div className={styles.opsButtons}>
          <span>Start break</span><span>+15 min late</span>
        </div>
        <div className={styles.nowServing}><small>Now serving</small><strong>18</strong><span>Call next →</span></div>
      </div>
    );
  }
  return (
    <div className={styles.updatesVisual}>
      <div className={styles.updatePhone}>
        <div className={styles.updateTop}><span>Q</span><strong>Quivora</strong><small>now</small></div>
        <div className={styles.updateMessage}>
          <i>✓</i>
          <div><strong>You’re almost next</strong><span>One patient ahead · ETA 10:42 AM</span></div>
        </div>
        <div className={styles.updateMessage}>
          <i>⌁</i>
          <div><strong>Queue updated</strong><span>Your live estimate improved by 6 min</span></div>
        </div>
      </div>
      <div className={styles.signalRings}><i /><i /><i /></div>
    </div>
  );
}

export default function DashboardPage() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reveal = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add(styles.visible)),
      { threshold: 0.14 },
    );
    root.querySelectorAll("[data-reveal]").forEach((el) => reveal.observe(el));

    const onMove = (event: MouseEvent) => {
      const x = event.clientX / window.innerWidth - 0.5;
      const y = event.clientY / window.innerHeight - 0.5;
      root.style.setProperty("--mx", `${x}`);
      root.style.setProperty("--my", `${y}`);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      reveal.disconnect();
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <div className={styles.page} ref={rootRef}>
      <div className={styles.ambient} aria-hidden="true">
        <i className={styles.orbOne} /><i className={styles.orbTwo} /><i className={styles.orbThree} />
        <i className={styles.gridLight} />
      </div>

      <nav className={styles.nav}>
        <Link href="/dashboard" className={styles.brand}>
          <span>Q</span>
          <div><strong>Quivora</strong><small>Care in motion</small></div>
        </Link>
        <div className={styles.navLinks}>
          <a href="#platform">Platform</a>
          <a href="#how">How it works</a>
          <a href="#impact">Impact</a>
        </div>
        <div className={styles.navActions}>
          <Link href="/checkin" className={styles.textLink}>Patient check-in</Link>
          <Link href="/ops" className={styles.navCta}>Open platform <span>↗</span></Link>
        </div>
      </nav>

      <main>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <div className={styles.kicker}><i /> Hospital queues, finally intelligent</div>
            <h1>
              Less waiting.
              <span>More healing.</span>
            </h1>
            <p>
              Quivora turns crowded hospital queues into a calm, live flow—from one-scan registration
              to priority-aware ETAs that learn with every consultation.
            </p>
            <div className={styles.heroActions}>
              <Link href="/ops" className={styles.primaryCta}>Explore the live platform <span>→</span></Link>
              <a href="#platform" className={styles.secondaryCta}><i>▶</i> See how it works</a>
            </div>
            <div className={styles.trustLine}>
              <div className={styles.avatarStack}><i>AS</i><i>RN</i><i>PM</i><i>+</i></div>
              <div><strong>Built around real hospital flow</strong><span>Patients · Doctors · Reception · Operations</span></div>
            </div>
          </div>
          <ProductVisual />
          <a href="#platform" className={styles.scrollCue}><span>Scroll to explore</span><i /></a>
        </section>

        <div className={styles.marquee}>
          <div>
            {Array.from({ length: 2 }).flatMap((_, group) => [
              "QR SELF CHECK-IN", "LIVE PATIENT ETA", "PRIORITY TRIAGE", "ADAPTIVE LEARNING",
              "ROOM OPERATIONS", "MULTI-HOSPITAL", "BREAK & DELAY UPDATES",
            ].map((text, i) => <span key={`${group}-${i}`}>{text}<i>✦</i></span>))}
          </div>
        </div>

        <section className={styles.problem} id="impact">
          <div className={`${styles.sectionIntro} ${styles.reveal}`} data-reveal>
            <span className={styles.sectionNumber}>01 · THE SHIFT</span>
            <h2>A queue should be a <em>care system</em>, not a line.</h2>
            <p>First-come-first-served ignores clinical urgency. Static estimates ignore reality. Quivora connects both.</p>
          </div>
          <div className={styles.metrics}>
            {[
              ["01", "Live source of truth", "One queue shared by reception, rooms and patients."],
              ["04", "Priority tiers", "Emergency to standard, with every override logged."],
              ["10s", "To find a patient", "Phone-first lookup for faster returning visits."],
              ["∞", "Continuous learning", "Every completed visit improves future estimates."],
            ].map(([value, title, body], i) => (
              <article className={`${styles.metric} ${styles.reveal}`} style={{ transitionDelay: `${i * 90}ms` }} data-reveal key={title}>
                <strong>{value}</strong><h3>{title}</h3><p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.platform} id="platform">
          <div className={`${styles.sectionIntro} ${styles.reveal}`} data-reveal>
            <span className={styles.sectionNumber}>02 · ONE CONNECTED PLATFORM</span>
            <h2>Designed for the <em>whole journey.</em></h2>
            <p>Beautiful for patients. Fast for reception. Useful for doctors. Visible to hospital leaders.</p>
          </div>
          <div className={styles.bento}>
            {features.map((feature, index) => (
              <article
                key={feature.number}
                className={`${styles.feature} ${feature.className} ${styles.reveal}`}
                style={{ transitionDelay: `${index * 70}ms` }}
                data-reveal
              >
                <div className={styles.featureTop}><span>{feature.number}</span><small>{feature.eyebrow}</small></div>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
                <FeatureVisual type={feature.visual} />
              </article>
            ))}
          </div>
        </section>

        <section className={styles.flow} id="how">
          <div className={`${styles.flowCopy} ${styles.reveal}`} data-reveal>
            <span className={styles.sectionNumber}>03 · THE PATIENT FLOW</span>
            <h2>From entrance to doctor, <em>without uncertainty.</em></h2>
            <p>Every handoff updates the same queue. Patients know when to move. Teams know what happens next.</p>
            <Link href="/checkin" className={styles.inlineLink}>Try self check-in <span>↗</span></Link>
          </div>
          <div className={styles.journey}>
            <div className={styles.journeyLine}><i /></div>
            {journey.map(([title, body], i) => (
              <div className={`${styles.journeyStep} ${styles.reveal}`} style={{ transitionDelay: `${i * 80}ms` }} data-reveal key={title}>
                <span>{String(i + 1).padStart(2, "0")}</span>
                <div><strong>{title}</strong><small>{body}</small></div>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.intelligence}>
          <div className={styles.intelOrbital} aria-hidden="true">
            <div className={styles.intelCore}><span>Q</span><i /></div>
            <div className={`${styles.orbit} ${styles.orbitOne}`}><i>ETA</i><i>QR</i></div>
            <div className={`${styles.orbit} ${styles.orbitTwo}`}><i>OPD</i><i>LIVE</i><i>60+</i></div>
          </div>
          <div className={`${styles.intelCopy} ${styles.reveal}`} data-reveal>
            <span className={styles.sectionNumber}>04 · INTELLIGENCE THAT STAYS HUMAN</span>
            <h2>It learns the pace.<br /><em>Your team stays in control.</em></h2>
            <p>
              Quivora blends the last hour, today, this week and each doctor’s baseline—then accounts for
              breaks, delays and clinical priority in real time.
            </p>
            <div className={styles.intelPoints}>
              <span><i>✓</i> Explainable estimates</span>
              <span><i>✓</i> Safe outlier limits</span>
              <span><i>✓</i> Human-controlled triage</span>
            </div>
          </div>
        </section>

        <section className={styles.finalCta}>
          <div className={styles.ctaLight} />
          <HeartPulse />
          <div className={`${styles.reveal}`} data-reveal>
            <span className={styles.sectionNumber}>THE WAIT CAN FEEL DIFFERENT</span>
            <h2>Make every minute of care <em>visible.</em></h2>
            <p>Open the working platform, scan a hospital QR, or step into the live operations view.</p>
            <div className={styles.heroActions}>
              <Link href="/ops" className={styles.primaryCta}>Enter Quivora <span>→</span></Link>
              <Link href="/checkin?hospital=61" className={styles.secondaryCta}>Try patient check-in</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <Link href="/dashboard" className={styles.brand}>
          <span>Q</span><div><strong>Quivora</strong><small>Care in motion</small></div>
        </Link>
        <p>Hospital queue intelligence that learns with every patient.</p>
        <div><Link href="/ops">Platform</Link><Link href="/checkin">Check-in</Link><span>© 2026 Quivora</span></div>
      </footer>
    </div>
  );
}
