/**
 * Sign in, and the candidate record it creates.
 *
 * The board is our own backend: Supabase holds the auth session and one `candidates` row per person.
 * The keys arrive as build-time environment variables. When they are missing the client is null, and
 * every caller treats that as "no gate": the site works exactly as it did before, applying goes
 * straight through, and nothing on screen claims to have saved anything. See supabase/schema.sql.
 */
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

const url = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
// Two names for the same public key: the project was provisioned through Lovable, which writes
// VITE_SUPABASE_PUBLISHABLE_KEY (the newer sb_publishable_ format). VITE_SUPABASE_ANON_KEY still works.
const anonKey = (import.meta.env["VITE_SUPABASE_ANON_KEY"] ??
  import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"]) as string | undefined;

/**
 * The sb_publishable_ keys are opaque strings, not JWTs, so they belong in the apikey header and not
 * in an Authorization bearer. Without this a signed-in request is rejected.
 */
function publishableFetch(key: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v));
    if (headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
    headers.set("apikey", key);
    return fetch(input, { ...init, headers });
  };
}

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        ...(anonKey.startsWith("sb_publishable_")
          ? { global: { fetch: publishableFetch(anonKey) } }
          : {}),
      })
    : null;

/** True when a Supabase client exists, so sign-in code can run at all. */
export const authConnected = supabase !== null;

/**
 * True when applying asks for sign-in first. Deliberately separate from `authConnected`: the keys
 * reached the build on 20 Sep 2026 (Lovable commits a .env), and a gate that turns itself on the
 * moment keys appear would have sent people to a Google sign-in that is not enabled on the project.
 * Set VITE_APPLY_GATE=on once the sign-in flow is built and tested.
 */
export const authEnabled = supabase !== null && import.meta.env["VITE_APPLY_GATE"] === "on";

/**
 * The person. The four onboarding answers are `industries`, `countries`, `job_family` plus `level`, and
 * `looking`; `horizontal` says whether platforms that sell to every industry count as their space.
 */
export type Candidate = {
  id: string;
  email: string | null;
  full_name: string | null;
  headline: string | null;
  industries: string[];
  countries: string[];
  job_family: string | null;
  level: string | null;
  looking: string | null;
  horizontal: boolean;
  linkedin_url: string | null;
  consent_employers: boolean;
  digest: boolean;
  onboarded_at: string | null;
};

export type SavedRole = { role_id: string; company: string; title: string; created_at: string };

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(authConnected);

  useEffect(() => {
    if (!supabase) return;
    let live = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!live) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });
    return () => {
      live = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, loading, user: session?.user ?? null };
}

/**
 * Sign in with a six digit code sent by email. No password, and no Google: the Google provider needs a
 * client created in a console, and one field plus one code is less to ask of a candidate anyway.
 */
export async function sendSignInCode(email: string) {
  if (!supabase) return { error: new Error("Sign in is not configured") };
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: true },
  });
  return { error };
}

/** Exchange the emailed code for a session. */
export async function verifySignInCode(email: string, token: string) {
  if (!supabase) return { error: new Error("Sign in is not configured") };
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: "email",
  });
  return { error };
}

export async function signOut() {
  await supabase?.auth.signOut();
}

/** One row per person, created on first sign in and updated whenever they change an answer. */
export async function upsertCandidate(patch: Partial<Candidate> & { id: string }) {
  if (!supabase) return { error: new Error("Not configured") };
  const { error } = await supabase.from("candidates").upsert(patch, { onConflict: "id" });
  return { error };
}

/** The signed-in person's row, created empty on first sign in so onboarding has something to update. */
export function useCandidate() {
  const { user, loading: sessionLoading } = useSession();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || sessionLoading) return;
    if (!user) {
      setCandidate(null);
      setLoading(false);
      return;
    }
    let live = true;
    void (async () => {
      const { data } = await supabase!
        .from("candidates")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      if (!live) return;
      if (data) {
        setCandidate(data as Candidate);
      } else {
        const row = { id: user.id, email: user.email ?? null };
        await supabase!.from("candidates").upsert(row, { onConflict: "id" });
        const { data: made } = await supabase!
          .from("candidates")
          .select("*")
          .eq("id", user.id)
          .maybeSingle();
        if (live) setCandidate((made as Candidate) ?? null);
      }
      if (live) setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [user, sessionLoading]);

  const save = async (patch: Partial<Candidate>) => {
    if (!user) return;
    setCandidate((c) => (c ? { ...c, ...patch } : c));
    await upsertCandidate({ ...patch, id: user.id });
  };

  return { candidate, loading: loading || sessionLoading, save, user };
}

/** Saved roles, kept in Supabase so they follow the person between devices. */
export function useSavedRoles() {
  const { user, loading: sessionLoading } = useSession();
  const [saved, setSaved] = useState<SavedRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || sessionLoading) return;
    if (!user) {
      setSaved([]);
      setLoading(false);
      return;
    }
    let live = true;
    void supabase
      .from("saved_roles")
      .select("role_id, company, title, created_at")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (!live) return;
        setSaved((data as SavedRole[]) ?? []);
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [user, sessionLoading]);

  const isSaved = (roleId: string) => saved.some((s) => s.role_id === roleId);

  const toggle = async (role: { id: string; company: string; title: string }) => {
    if (!supabase || !user) return;
    if (isSaved(role.id)) {
      setSaved((list) => list.filter((s) => s.role_id !== role.id));
      await supabase.from("saved_roles").delete().eq("role_id", role.id).eq("candidate", user.id);
      return;
    }
    const row = {
      role_id: role.id,
      company: role.company,
      title: role.title,
      created_at: new Date().toISOString(),
    };
    setSaved((list) => [row, ...list]);
    await supabase
      .from("saved_roles")
      .insert({ role_id: role.id, company: role.company, title: role.title });
  };

  return { saved, isSaved, toggle, loading: loading || sessionLoading, signedIn: Boolean(user) };
}

/** Record that someone opened a role. Failure here must never block the application. */
export async function recordApply(roleId: string, company: string, title: string) {
  if (!supabase) return;
  try {
    await supabase.from("applications").insert({ role_id: roleId, company, title });
  } catch {
    // The visitor is already on their way to the employer's page.
  }
}
