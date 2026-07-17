"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, HospitalInsights } from "@/lib/api";
import { useRole } from "@/lib/role";
import styles from "./insights.module.css";

const PERIODS = [
  { value: 1, label: "Today" },
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
];

const SEVERITY = {
  critical: { label: "Act now", icon: "!" },
  warning: { label: "Watch", icon: "↗" },
  opportunity: { label: "Opportunity", icon: "✦" },
  info: { label: "Stable", icon: "✓" },
};

function fmtHour(hour: number) {
  if (hour === 0) return "12a";
  if (hour < 12) return `${hour}a`;
  if (hour === 12) return "12p";
  return `${hour - 12}p`;
}

function fmtNumber(value: number, suffix = "") {
  return Number.isFinite(value) ? `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}` : "—";
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className={styles.empty}>{children}</div>;
}

export default function InsightsPage() {
  const { hospital, hospitalId, setMode } = useRole();
  const [data, setData] = useState<HospitalInsights | null>(null);
  const [days, setDays] = useState(7);
  const [delayThreshold, setDelayThreshold] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const hid = hospitalId || hospital?.id;

  useEffect(() => { setMode("hospital"); }, [setMode]);

  const load = useCallback(async () => {
    if (!hid) return;
    setLoading(true);
    try {
      const result = await api.insights(hid, days, delayThreshold);
      setData(result);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load insights");
    } finally {
      setLoading(false);
    }
  }, [hid, days, delayThreshold]);

  useEffect(() => { load(); }, [load]);

  const heatLookup = useMemo(() => {
    const map = new Map<string, number>();
    data?.heatmap.cells.forEach((cell) => map.set(`${cell.department}-${cell.hour}`, cell.count));
    return map;
  }, [data]);

  const pulseCards = data ? [
    {
      label: "Average wait",
      value: fmtNumber(data.pulse.avg_wait_min, " min"),
      note: data.pulse.wait_source === "arrival-to-start"
        ? `${data.pulse.wait_observations} arrival-to-start observations`
        : data.pulse.wait_source === "current ETA"
          ? `${data.pulse.wait_observations} current ETA waits (no arrival-to-start data yet)`
          : "No wait observations available yet",
      tone: data.pulse.avg_wait_min > 35 ? "bad" : data.pulse.avg_wait_min > 20 ? "warn" : "good",
      icon: "⌁",
    },
    {
      label: "Seen / waiting",
      value: `${data.pulse.patients_seen} / ${data.pulse.patients_waiting}`,
      note: `${data.pulse.patients_seen} OPD/scan completions · ${data.pulse.patients_waiting} waiting now`,
      tone: "neutral",
      icon: "◉",
    },
    {
      label: "No-show rate",
      value: fmtNumber(data.pulse.no_show_rate_pct, "%"),
      note: `${data.pulse.no_show_count} no-shows`,
      tone: data.pulse.no_show_rate_pct > 15 ? "bad" : data.pulse.no_show_rate_pct > 8 ? "warn" : "good",
      icon: "×",
    },
    {
      label: "Emergency / urgent",
      value: fmtNumber(data.pulse.priority_share_pct, "%"),
      note: `${data.pulse.priority_count} clinically prioritised`,
      tone: "priority",
      icon: "+",
    },
    {
      label: "Longest bottleneck",
      value: data.pulse.longest_bottleneck.name,
      note: `${data.pulse.longest_bottleneck.queue} waiting · ${fmtNumber(data.pulse.longest_bottleneck.wait_min, " min")}`,
      tone: data.pulse.longest_bottleneck.wait_min > 30 ? "bad" : "neutral",
      icon: "↗",
    },
  ] : [];

  return (
    <Shell title="Quivora Insights" subtitle={data?.hospital_name || hospital?.name || "Hospital intelligence"}>
      {!hid ? (
        <div className="card" style={{ padding: 32 }}>
          <p style={{ color: "var(--muted)", margin: 0 }}>Select a hospital from the top-right switcher.</p>
        </div>
      ) : (
        <div className={styles.page}>
          <div className={styles.hero}>
            <div>
              <div className={styles.eyebrow}><span /> What to fix today</div>
              <h1>Operational intelligence,<br /><em>not another chart dump.</em></h1>
              <p>Live patient flow, doctor load, diagnostic capacity and evidence-backed actions for hospital administrators.</p>
            </div>
            <div className={styles.controls}>
              <div className={styles.periods}>
                {PERIODS.map((period) => (
                  <button
                    key={period.value}
                    type="button"
                    className={days === period.value ? styles.activePeriod : ""}
                    onClick={() => setDays(period.value)}
                  >
                    {period.label}
                  </button>
                ))}
              </div>
              <label>
                Delay SLA
                <select value={delayThreshold} onChange={(e) => setDelayThreshold(Number(e.target.value))}>
                  {[20, 30, 45, 60].map((value) => <option key={value} value={value}>{value} min</option>)}
                </select>
              </label>
              <button type="button" className={styles.refresh} onClick={load} disabled={loading}>
                <span className={loading ? styles.spinning : ""}>↻</span> {loading ? "Analysing" : "Refresh"}
              </button>
            </div>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          {!data && loading ? (
            <div className={styles.loading}>
              <div className={styles.loader} />
              <strong>Reading hospital flow…</strong>
              <span>Analysing queues, doctors and machines</span>
            </div>
          ) : data && (
            <>
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <div><span>01</span><h2>Today’s pulse</h2></div>
                  <small>Generated {new Date(data.generated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
                </div>
                <div className={styles.pulseGrid}>
                  {pulseCards.map((card) => (
                    <article key={card.label} className={`${styles.pulseCard} ${styles[card.tone]}`}>
                      <div className={styles.pulseTop}><span>{card.label}</span><i>{card.icon}</i></div>
                      <strong className={card.label === "Longest bottleneck" ? styles.bottleneckValue : ""}>{card.value}</strong>
                      <small>{card.note}</small>
                    </article>
                  ))}
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <div><span>02</span><h2>Recommended actions</h2></div>
                  <small>Each action includes its evidence</small>
                </div>
                <div className={styles.recommendations}>
                  {data.recommendations.map((item, index) => {
                    const meta = SEVERITY[item.severity];
                    return (
                      <article key={item.id} className={`${styles.recommendation} ${styles[item.severity]}`}>
                        <div className={styles.recIndex}>{String(index + 1).padStart(2, "0")}</div>
                        <div className={styles.recBody}>
                          <div className={styles.recMeta}><span>{meta.icon} {meta.label}</span><small>{item.category}</small></div>
                          <h3>{item.title}</h3>
                          <div className={styles.evidence}><b>Evidence</b>{item.evidence}</div>
                          <div className={styles.action}><b>Next action</b>{item.action}</div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <div><span>03</span><h2>Improvement scoreboard</h2></div>
                  <small>Green / amber / red operational health</small>
                </div>
                <div className={styles.scoreGrid}>
                  {data.scoreboard.map((item) => (
                    <article key={item.key} className={styles.scoreCard}>
                      <div className={styles.scoreTop}>
                        <span className={`${styles.rag} ${styles[item.status]}`} />
                        <small>{item.status}</small>
                      </div>
                      <h3>{item.label}</h3>
                      <strong>{item.value}</strong>
                      <p>{item.explanation}</p>
                      <div><b>Improve</b>{item.action}</div>
                    </article>
                  ))}
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <div><span>04</span><h2>Doctor insights</h2></div>
                  <small>Workload, pace, queue impact and operational events</small>
                </div>
                {data.doctors.length ? (
                  <div className={styles.tableWrap}>
                    <table className={styles.doctorTable}>
                      <thead>
                        <tr>
                          <th>Doctor</th>
                          <th>Patients</th>
                          <th>Consult vs dept</th>
                          <th>Downstream wait</th>
                          <th>Break / delay</th>
                          <th>Priority mix</th>
                          <th>Utilization</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.doctors.map((doctor) => (
                          <tr key={doctor.id}>
                            <td>
                              <div className={styles.doctorName}>
                                <span>{doctor.name.replace(/^Dr\.?\s*/i, "").split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span>
                                <div><strong>{doctor.name}</strong><small>{doctor.department} · {doctor.data_source}{doctor.consult_observations ? ` · n=${doctor.consult_observations}` : ""}</small></div>
                                {doctor.is_live && <i title="Live" />}
                              </div>
                            </td>
                            <td><strong>{doctor.patients_seen}</strong><small>{doctor.patients_per_day}/day · {doctor.queue_now} waiting</small></td>
                            <td>
                              <strong>{doctor.avg_consult_min}m <em className={doctor.variance_vs_department_pct > 30 ? styles.negative : doctor.variance_vs_department_pct < -20 ? styles.positive : ""}>
                                {doctor.variance_vs_department_pct > 0 ? "+" : ""}{doctor.variance_vs_department_pct}%
                              </em></strong>
                              <small>Dept {doctor.department_avg_min}m</small>
                            </td>
                            <td><strong>{doctor.downstream_wait_min}m</strong><small>current cumulative ETA</small></td>
                            <td><strong>{doctor.break_events} / {doctor.delay_events}</strong><small>{doctor.delay_minutes} delay min</small></td>
                            <td>
                              <div className={styles.mix}>
                                <i className={styles.emergency} style={{ flex: doctor.priority_mix.emergency || 0.2 }} title={`Emergency ${doctor.priority_mix.emergency}`} />
                                <i className={styles.senior} style={{ flex: doctor.priority_mix.senior || 0.2 }} title={`Senior ${doctor.priority_mix.senior}`} />
                                <i className={styles.urgent} style={{ flex: doctor.priority_mix.urgent || 0.2 }} title={`Urgent ${doctor.priority_mix.urgent}`} />
                                <i className={styles.normal} style={{ flex: doctor.priority_mix.normal || 0.2 }} title={`Normal ${doctor.priority_mix.normal}`} />
                              </div>
                              <small>E {doctor.priority_mix.emergency} · S {doctor.priority_mix.senior} · U {doctor.priority_mix.urgent}</small>
                            </td>
                            <td>
                              <div className={styles.util}><i style={{ width: `${Math.min(100, doctor.utilization_pct)}%` }} /></div>
                              <small>{doctor.utilization_pct}% scheduled capacity</small>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <Empty>No doctors found for this hospital.</Empty>}
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <div><span>05</span><h2>Machine & scan insights</h2></div>
                  <small>Capacity, backlog, durations and idle gaps</small>
                </div>
                <div className={styles.machineGrid}>
                  {data.machines.map((machine) => (
                    <article key={machine.id} className={styles.machineCard}>
                      <div className={styles.machineHead}>
                        <div className={styles.machineIcon}>◎</div>
                        <div><h3>{machine.name}</h3><span>{machine.scan_type.replace("_", " ")} · {machine.data_source}</span></div>
                        <i className={machine.is_live ? styles.live : ""}>{machine.is_live ? "Live" : "Offline"}</i>
                      </div>
                      <div className={styles.machineMetrics}>
                        <div><small>Utilization</small><strong>{machine.utilization_pct}%</strong></div>
                        <div><small>Avg scan</small><strong>{machine.avg_scan_min}m</strong></div>
                        <div><small>Backlog</small><strong>{machine.current_backlog}</strong></div>
                        <div><small>Avg idle gap</small><strong>{machine.avg_idle_gap_min}m</strong></div>
                      </div>
                      <div className={styles.hourChart}>
                        {machine.utilization_by_hour.map((hour) => (
                          <div key={hour.hour} title={`${fmtHour(hour.hour)} · ${hour.utilization_pct}%`}>
                            <i style={{ height: `${Math.max(3, hour.utilization_pct)}%` }} />
                            <span>{hour.hour % 3 === 0 ? fmtHour(hour.hour) : ""}</span>
                          </div>
                        ))}
                      </div>
                      <div className={styles.machineSuggestion}><b>Suggested</b>{machine.suggestion}</div>
                      <div className={styles.machineFoot}>
                        <span>{machine.completed_scans} completed</span>
                        <span>Peak backlog {machine.historical_peak_backlog}</span>
                        <span>Max idle {machine.max_idle_gap_min}m</span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <div><span>06</span><h2>Patient flow heatmap</h2></div>
                  <small>Registrations by hour × department</small>
                </div>
                {data.heatmap.departments.length ? (
                  <div className={styles.heatmapWrap}>
                    <div
                      className={styles.heatmap}
                      style={{ gridTemplateColumns: `minmax(150px, 1.5fr) repeat(${data.heatmap.hours.length}, minmax(32px, 1fr))` }}
                    >
                      <div />
                      {data.heatmap.hours.map((hour) => <div className={styles.hourLabel} key={hour}>{fmtHour(hour)}</div>)}
                      {data.heatmap.departments.map((dept) => (
                        <div className={styles.heatRow} key={dept} style={{ display: "contents" }}>
                          <div className={styles.deptLabel}>{dept}</div>
                          {data.heatmap.hours.map((hour) => {
                            const count = heatLookup.get(`${dept}-${hour}`) || 0;
                            const intensity = data.heatmap.max_count ? count / data.heatmap.max_count : 0;
                            return (
                              <div
                                key={hour}
                                className={styles.heatCell}
                                title={`${dept}, ${fmtHour(hour)}: ${count} patient${count === 1 ? "" : "s"}`}
                                style={{
                                  background: count
                                    ? `rgba(13, 148, 136, ${0.12 + intensity * 0.78})`
                                    : "var(--surface-3)",
                                  color: intensity > 0.55 ? "white" : "var(--muted)",
                                }}
                              >
                                {count || "·"}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : <Empty>Patient registrations will populate the heatmap.</Empty>}
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <div><span>07</span><h2>Flow & fairness</h2></div>
                  <small>Priority transparency and patient mix</small>
                </div>
                <div className={styles.fairnessGrid}>
                  <article className={styles.fairnessSummary}>
                    <div className={styles.fairnessMetric}>
                      <strong>{data.fairness.normal_delayed_rate_pct}%</strong>
                      <span>normal patients delayed beyond {data.fairness.delayed_threshold_min} min</span>
                    </div>
                    <div className={styles.fairnessBars}>
                      <div><span>Normal delayed</span><i><b style={{ width: `${Math.min(100, data.fairness.normal_delayed_rate_pct)}%` }} /></i><strong>{data.fairness.normal_patients_delayed}</strong></div>
                      <div><span>Priority overrides</span><i><b style={{ width: `${Math.min(100, data.fairness.priority_overrides * 10)}%` }} /></i><strong>{data.fairness.priority_overrides}</strong></div>
                      <div><span>Emergency inserts</span><i><b style={{ width: `${Math.min(100, data.fairness.emergency_inserts * 10)}%` }} /></i><strong>{data.fairness.emergency_inserts}</strong></div>
                    </div>
                    <div className={styles.patientMix}>
                      <div style={{ ["--mix" as string]: `${data.fairness.returning_patient_ratio_pct}%` }} />
                      <p><span>New <b>{data.fairness.new_patients}</b></span><span>Returning <b>{data.fairness.returning_patients}</b></span></p>
                    </div>
                  </article>
                  <article className={styles.overrideCard}>
                    <div className={styles.overrideHead}><h3>Priority override log</h3><span>{data.fairness.override_log.length} records</span></div>
                    {data.fairness.override_log.length ? (
                      <div className={styles.overrideList}>
                        {data.fairness.override_log.slice(0, 8).map((event, index) => (
                          <div key={`${event.timestamp}-${index}`}>
                            <i className={styles[event.priority] || styles.normal} />
                            <div><strong>{event.patient_name} · {event.priority}</strong><span>{event.doctor_name} — {event.reason}</span></div>
                            <time>{new Date(event.timestamp).toLocaleDateString([], { month: "short", day: "numeric" })}</time>
                          </div>
                        ))}
                      </div>
                    ) : <Empty>No priority overrides in this period.</Empty>}
                  </article>
                </div>
              </section>

              <section className={styles.quality}>
                <div><span>Data confidence</span><strong>{data.data_quality.actual_wait_observations} actual waits · {data.data_quality.live_doctor_samples} live consult samples · {data.data_quality.completed_live_scans} live scans</strong></div>
                {data.data_quality.warnings.length > 0 && (
                  <ul>{data.data_quality.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </Shell>
  );
}
