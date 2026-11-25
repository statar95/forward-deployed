import { useState } from "react";
import { industriesOf, industryLabel, type Dataset } from "@/lib/roles";
import type { Candidate } from "@/lib/auth";

const FAMILIES = [
  { value: "fde", label: "Forward deployed engineer", hint: "build in the customer's environment" },
  { value: "lead", label: "Deployment lead or strategist", hint: "run the rollout" },
  { value: "delivery", label: "Delivery or implementation lead", hint: "own the programme" },
];

const LOOKING = [
  { value: "now", label: "Now" },
  { value: "open", label: "Open to the right thing" },
  { value: "watching", label: "Just watching" },
];

/**
 * Four questions, one screen, under a minute. Every answer earns its place by powering the briefing:
 * industries and geography filter it, the job family and level order it, and how actively they are
 * looking decides how often we write. Nothing here is required except the industries.
 */
export function Onboarding({
  data,
  candidate,
  onDone,
  submitLabel = "Show me my briefing",
}: {
  data: Dataset;
  candidate: Candidate;
  onDone: (patch: Partial<Candidate>) => void;
  submitLabel?: string;
}) {
  const [industries, setIndustries] = useState<string[]>(candidate.industries ?? []);
  const [horizontal, setHorizontal] = useState(candidate.horizontal ?? true);
  const [countries, setCountries] = useState<string[]>(candidate.countries ?? []);
  const [family, setFamily] = useState(candidate.job_family ?? "");
  const [level, setLevel] = useState(candidate.level ?? "");
  const [looking, setLooking] = useState(candidate.looking ?? "");

  const core = data.roles.filter((r) => r.relevance === "core");
  const industryCounts = new Map<string, number>();
  for (const r of core)
    for (const i of industriesOf(r)) industryCounts.set(i, (industryCounts.get(i) ?? 0) + 1);
  const industryOptions = [...industryCounts.entries()].sort((a, b) => b[1] - a[1]);

  const countryCounts = new Map<string, number>();
  for (const r of core)
    if (r.country) countryCounts.set(r.country, (countryCounts.get(r.country) ?? 0) + 1);
  const countryOptions = [...countryCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

  const toggle = (list: string[], value: string, set: (next: string[]) => void) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const done = () =>
    onDone({
      industries,
      horizontal,
      countries,
      job_family: family || null,
      level: level || null,
      looking: looking || null,
      onboarded_at: new Date().toISOString(),
    });

  return (
    <div className="mx-auto max-w-[760px] px-6 py-14 sm:px-10 sm:py-20">
      <h1 className="font-display max-w-[18ch] text-[34px] leading-[1.05] tracking-[-0.02em] sm:text-[46px]">
        Four questions, then your briefing.
      </h1>
      <p className="mt-4 max-w-[52ch] text-[16px] leading-relaxed text-muted-foreground">
        They decide what lands on your page each week. You can change any of them later.
      </p>

      <Question n={1} title="Which industries have you deployed into?">
        <Chips
          options={industryOptions.map(([value, count]) => ({
            value,
            label: industryLabel(value),
            count,
          }))}
          selected={industries}
          onToggle={(v) => toggle(industries, v, setIndustries)}
        />
        <Tick
          checked={horizontal}
          onChange={setHorizontal}
          label="Also show platforms that sell to every industry"
          hint="Databricks, OpenAI and the like: half the board"
        />
      </Question>

      <Question n={2} title="Where can you work?">
        <Chips
          options={countryOptions.map(([value, count]) => ({ value, label: value, count }))}
          selected={countries}
          onToggle={(v) => toggle(countries, v, setCountries)}
        />
        <p className="mt-4 text-[13px] text-muted-foreground">
          Remote roles are always included. Pick nothing to see every country.
        </p>
      </Question>

      <Question n={3} title="Which is closest to your job?">
        <Chips
          options={FAMILIES.map((f) => ({ value: f.value, label: f.label, hint: f.hint }))}
          selected={family ? [family] : []}
          onToggle={(v) => setFamily(family === v ? "" : v)}
        />
        <div className="mt-4">
          <Chips
            options={[
              { value: "ic", label: "I do the work" },
              { value: "lead", label: "I lead a team" },
            ]}
            selected={level ? [level] : []}
            onToggle={(v) => setLevel(level === v ? "" : v)}
          />
        </div>
      </Question>

      <Question n={4} title="How actively are you looking?">
        <Chips
          options={LOOKING}
          selected={looking ? [looking] : []}
          onToggle={(v) => setLooking(looking === v ? "" : v)}
        />
      </Question>

      <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-hairline pt-8">
        <button
          type="button"
          onClick={done}
          disabled={!industries.length && !horizontal}
          className="tap inline-flex items-center border border-foreground px-6 text-[16px] transition-colors hover:bg-foreground hover:text-background disabled:opacity-40"
        >
          {submitLabel}
        </button>
        <span className="text-[13px] text-muted-foreground">
          {industries.length || horizontal
            ? "You can change these any time."
            : "Pick at least one industry, or the horizontal tick."}
        </span>
      </div>
    </div>
  );
}

function Question({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12 border-t border-hairline pt-7">
      <h2 className="text-[17px]">
        <span className="mr-3 text-[13px] text-muted-foreground">{n}</span>
        {title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Chips({
  options,
  selected,
  onToggle,
}: {
  options: { value: string; label: string; count?: number; hint?: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-3">
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(o.value)}
            title={o.hint}
            className={
              "border px-4 py-[7px] text-[14px] transition-colors " +
              (on
                ? "border-foreground bg-foreground text-background"
                : "border-hairline text-muted-foreground hover:border-foreground hover:text-foreground")
            }
          >
            {o.label}
            {o.count != null ? <span className="ml-2 opacity-60">{o.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function Tick({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="mt-4 flex cursor-pointer items-baseline gap-3 text-[14px] text-muted-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-[2px] h-[14px] w-[14px] accent-[var(--signal)]"
      />
      <span>
        {label}
        {hint ? <span className="ml-2 text-muted-foreground/70">{hint}</span> : null}
      </span>
    </label>
  );
}
