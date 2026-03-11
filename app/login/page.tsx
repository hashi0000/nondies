"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Crown, Mail, Shield } from "lucide-react";
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
    <div className="rounded-2xl bg-zinc-950/60 ring-1 ring-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
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
        "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition",
        "ring-1 ring-white/10",
        active ? "bg-red-600 text-white" : "bg-white/5 text-zinc-200 hover:bg-white/10",
      ].join(" ")}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
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
      <div className="mb-1.5 text-xs font-medium text-zinc-300">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        inputMode={inputMode}
        className="w-full rounded-xl bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-zinc-500 ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-red-500/60"
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

  const canContinue = useMemo(() => {
    if (!name.trim()) return false;
    if (mode === "email") return /\S+@\S+\.\S+/.test(email.trim()) && password.length >= 6;
    return true;
  }, [email, mode, name, password]);

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
      const res = await signInWithPopup(auth, provider);
      const dn = name.trim();
      if (dn && res.user.displayName !== dn) {
        await updateProfile(res.user, { displayName: dn });
      }
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
      const dn = name.trim();
      if (emailFlow === "signup") {
        const res = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (dn) await updateProfile(res.user, { displayName: dn });
        // Optional: prompt verification
        await sendEmailVerification(res.user).catch(() => {});
      } else {
        const res = await signInWithEmailAndPassword(auth, email.trim(), password);
        if (dn && res.user.displayName !== dn) {
          await updateProfile(res.user, { displayName: dn });
        }
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
      <div className="mx-auto w-full max-w-lg px-4 pb-10 pt-10 sm:px-6">
        <div className="text-center">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-3xl bg-red-600/15 ring-1 ring-red-500/30">
            <Crown className="h-7 w-7 text-red-300" />
          </div>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight">{APP_NAME}</h1>
          <p className="mt-2 text-sm text-zinc-400">Sign in to save your team and appear on the leaderboard.</p>
        </div>

        <div className="mt-6 grid gap-4">
          <Card>
            <div className="border-b border-white/10 p-4 sm:p-5">
              <div className="text-base font-semibold">Choose a sign-in method</div>
              <div className="mt-3 flex gap-2">
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

            <div className="p-4 sm:p-5">
              <div className="grid gap-3">
                <Field
                  label="Display name"
                  value={name}
                  onChange={setName}
                  placeholder="e.g., Hashim"
                />

                {mode === "email" ? (
                  <>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEmailFlow("signin")}
                        className={[
                          "flex-1 rounded-xl px-3 py-2 text-sm font-semibold ring-1 transition",
                          emailFlow === "signin"
                            ? "bg-red-600 text-white ring-red-500/40"
                            : "bg-white/5 text-zinc-200 ring-white/10 hover:bg-white/10",
                        ].join(" ")}
                      >
                        Sign in
                      </button>
                      <button
                        type="button"
                        onClick={() => setEmailFlow("signup")}
                        className={[
                          "flex-1 rounded-xl px-3 py-2 text-sm font-semibold ring-1 transition",
                          emailFlow === "signup"
                            ? "bg-red-600 text-white ring-red-500/40"
                            : "bg-white/5 text-zinc-200 ring-white/10 hover:bg-white/10",
                        ].join(" ")}
                      >
                        Create account
                      </button>
                    </div>
                    <Field label="Email" value={email} onChange={setEmail} placeholder="name@example.com" type="email" />
                    <Field
                      label="Password (min 6 chars)"
                      value={password}
                      onChange={setPassword}
                      placeholder="••••••••"
                      type="password"
                    />
                  </>
                ) : null}

                {mode === "google" ? (
                  <div className="rounded-xl bg-white/5 p-3 text-sm text-zinc-300 ring-1 ring-white/10">
                    Uses Firebase Google sign-in. If you haven’t enabled Google provider yet, do it in Firebase Console → Authentication → Sign-in method.
                  </div>
                ) : null}

                {error ? (
                  <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-200 ring-1 ring-red-500/30">{error}</div>
                ) : null}

                <button
                  type="button"
                  onClick={() => {
                    if (mode === "google") void handleGoogle();
                    else if (mode === "email") void handleEmail();
                  }}
                  disabled={!canContinue || busy}
                  className={[
                    "mt-1 rounded-2xl px-4 py-3 text-sm font-bold transition ring-1",
                    canContinue && !busy
                      ? "bg-red-600 text-white ring-red-500/40 hover:bg-red-500"
                      : "bg-white/5 text-zinc-400 ring-white/10",
                  ].join(" ")}
                >
                  Continue
                </button>

                <div className="text-center text-xs text-zinc-500">Powered by Firebase Auth.</div>
              </div>
            </div>
          </Card>

          <div className="text-center text-xs text-zinc-500">
            Tip: Phone auth needs a real domain in Firebase Auth settings (localhost is fine for dev).
          </div>
        </div>
      </div>
    </div>
  );
}

