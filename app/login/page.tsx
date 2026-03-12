"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Shield } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from "firebase/auth";
import { auth } from "@/lib/firebase";

const APP_NAME = "Nondies Fantasy League";

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-zinc-950/90 border border-white/10 shadow-[0_18px_45px_-30px_rgba(0,0,0,0.9)] backdrop-blur-md">
      {children}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs sm:text-sm font-semibold transition-all",
        active
          ? "bg-gradient-to-r from-red-600 to-red-500 text-white shadow-[0_6px_18px_-8px_rgba(220,38,38,0.8)]"
          : "border border-white/10 bg-black/40 text-zinc-300 hover:border-red-500/60 hover:text-white",
      ].join(" ")}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <label className="block">
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        inputMode={inputMode}
        className="w-full rounded-xl bg-white/5 px-4 py-3 text-sm text-white placeholder:text-zinc-600 ring-1 ring-white/10 outline-none transition focus:ring-2 focus:ring-red-500/50 focus:bg-white/8"
      />
    </label>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"google" | "email">("google");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailFlow, setEmailFlow] = useState<"signin" | "signup">("signin");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showNameField = mode === "email" && emailFlow === "signup";

  const canContinue = useMemo(() => {
    if (showNameField && !name.trim()) return false;
    if (mode === "email") return /\S+@\S+\.\S+/.test(email.trim()) && password.length >= 6;
    return true;
  }, [email, mode, name, password, showNameField]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) router.replace("/");
    });
    return () => unsub();
  }, [router]);

  async function handleGoogle() {
    setError(null);
    setBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      router.replace("/");
    } catch (e: any) {
      setError(e?.message ?? "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleEmail() {
    setError(null);
    setBusy(true);
    try {
      if (emailFlow === "signup") {
        const res = await createUserWithEmailAndPassword(auth, email.trim(), password);
        const dn = name.trim();
        if (dn) await updateProfile(res.user, { displayName: dn });
        await sendEmailVerification(res.user).catch(() => {});
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
      router.replace("/");
    } catch (e: any) {
      setError(e?.message ?? "Email sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        {/* Photo hero */}
        <div className="relative mb-6 h-56 w-full overflow-hidden rounded-3xl border border-white/10 bg-zinc-900/60 shadow-[0_26px_80px_-40px_rgba(0,0,0,1)] sm:mb-0 sm:h-80 sm:flex-1">
          <Image
            src="/logi.jpg"
            alt="Nondies Fantasy League action"
            fill
            priority
            className="object-cover transition-transform duration-700 ease-out hover:scale-[1.04]"
          />
          <div className="absolute inset-0 bg-gradient-to-tr from-black/85 via-black/45 to-transparent" />
          <div className="relative flex h-full items-end p-5">
            <div className="max-w-sm rounded-2xl bg-black/55 px-4 py-3 ring-1 ring-white/10">
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-400">
                Oxford &amp; Bletchingdon
              </p>
              <h1 className="mt-1 text-2xl font-extrabold leading-snug tracking-tight sm:text-3xl">
                Nondies{" "}
                <span className="bg-gradient-to-r from-red-400 via-amber-300 to-red-400 bg-clip-text text-transparent">
                  Fantasy League
                </span>
              </h1>
              <p className="mt-2 text-[11px] text-zinc-300">
                Weekly fantasy cricket built on real Nondies performances. Pick your XI every gameweek and compete on the club leaderboard.
              </p>
            </div>
          </div>
        </div>

        {/* Auth card */}
        <div className="relative w-full max-w-sm sm:flex-1 sm:max-w-md sm:pl-4">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative h-10 w-10 overflow-hidden rounded-2xl bg-white/5 ring-1 ring-white/10">
                <Image src="/logo.png" alt="Nondies CC" fill className="object-contain p-1.5" priority />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-zinc-500">Sign in</p>
                <p className="text-sm text-zinc-300">Save &amp; track your fantasy teams</p>
              </div>
            </div>
            <Link
              href="/rules"
              className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500 transition hover:text-zinc-300"
            >
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold ring-1 ring-white/10">
                ?
              </span>
              Rules
            </Link>
          </div>

          <Card>
            <div className="border-b border-white/8 px-5 py-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Sign-in method</p>
              <div className="flex gap-2">
                <TabButton
                  active={mode === "google"}
                  onClick={() => setMode("google")}
                  icon={<Shield className="h-4 w-4" />}
                  label="Google"
                />
                <TabButton
                  active={mode === "email"}
                  onClick={() => setMode("email")}
                  icon={<Mail className="h-4 w-4" />}
                  label="Email"
                />
              </div>
            </div>

            <div className="px-5 py-4">
              <div className="grid gap-3">
                {mode === "email" ? (
                  <>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEmailFlow("signin")}
                        className={[
                          "flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all",
                          emailFlow === "signin"
                            ? "bg-red-600 text-white shadow-[0_4px_14px_-4px_rgba(220,38,38,0.5)]"
                            : "bg-white/5 text-zinc-300 hover:bg-white/10",
                        ].join(" ")}
                      >
                        Sign in
                      </button>
                      <button
                        type="button"
                        onClick={() => setEmailFlow("signup")}
                        className={[
                          "flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all",
                          emailFlow === "signup"
                            ? "bg-red-600 text-white shadow-[0_4px_14px_-4px_rgba(220,38,38,0.5)]"
                            : "bg-white/5 text-zinc-300 hover:bg-white/10",
                        ].join(" ")}
                      >
                        Create account
                      </button>
                    </div>

                    {showNameField && (
                      <Field
                        label="Your name"
                        value={name}
                        onChange={setName}
                        placeholder="e.g., Bobzy"
                      />
                    )}

                    <Field
                      label="Email"
                      value={email}
                      onChange={setEmail}
                      placeholder="name@example.com"
                      type="email"
                    />
                    <Field
                      label="Password"
                      value={password}
                      onChange={setPassword}
                      placeholder="min 6 characters"
                      type="password"
                    />
                  </>
                ) : (
                  <div className="rounded-xl bg-white/4 px-4 py-3 text-sm text-zinc-400 ring-1 ring-white/8">
                    You&apos;ll be signed in with your Google account. Your name is taken from Google automatically.
                  </div>
                )}

                {error ? (
                  <div className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300 ring-1 ring-red-500/25">
                    {error}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => {
                    if (mode === "google") void handleGoogle();
                    else if (mode === "email") void handleEmail();
                  }}
                  disabled={!canContinue || busy}
                  className={[
                    "mt-1 rounded-xl px-4 py-3 text-sm font-bold transition-all",
                    canContinue && !busy
                      ? "bg-red-600 text-white shadow-[0_4px_20px_-4px_rgba(220,38,38,0.6)] hover:bg-red-500 hover:shadow-[0_4px_24px_-4px_rgba(220,38,38,0.7)]"
                      : "bg-white/5 text-zinc-600 cursor-not-allowed",
                  ].join(" ")}
                >
                  {busy
                    ? "Please wait…"
                    : mode === "google"
                    ? "Continue with Google"
                    : emailFlow === "signup"
                    ? "Create account"
                    : "Sign in"}
                </button>

                <p className="text-center text-xs text-zinc-600">Powered by Firebase Auth</p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

