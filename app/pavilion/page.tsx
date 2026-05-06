"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Send, Shield, Trash2, UserRound } from "lucide-react";
import { getIdTokenResult, onAuthStateChanged, type User } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

const APP_NAME = "Nondies Fantasy League";
const MAX_MESSAGE_LEN = 300;
const MESSAGE_COOLDOWN_MS = 3000;

type ChatMessage = {
  id: string;
  userId: string;
  displayName: string;
  message: string;
  createdAt?: Timestamp | null;
  mentionedUserIds: string[];
  deleted?: boolean;
  deletedAt?: Timestamp | null;
  deletedBy?: string;
  isAdmin?: boolean;
};

type RegisteredUser = {
  uid: string;
  displayName: string;
  displayNameLower: string;
};

function accountHolderName(user: User): string {
  const dn = user.displayName?.trim();
  if (dn) return dn;
  const em = user.email?.trim();
  if (em) return em;
  return "Manager";
}

function formatWhen(ts?: Timestamp | null): string {
  if (!ts) return "sending…";
  try {
    return ts.toDate().toLocaleString(undefined, {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "just now";
  }
}

function parseMentionQuery(input: string): string | null {
  const m = input.match(/(?:^|\s)@([A-Za-z0-9._-]*)$/);
  if (!m) return null;
  return m[1] ?? "";
}

function replaceTrailingMentionDraft(input: string, displayName: string): string {
  return input.replace(/(?:^|\s)@[A-Za-z0-9._-]*$/, (prefix) => {
    const leadSpace = prefix.startsWith(" ") ? " " : "";
    return `${leadSpace}@${displayName} `;
  });
}

function extractMentionedUserIds(message: string, users: RegisteredUser[]): string[] {
  const map = new Map(users.map((u) => [u.displayName.toLowerCase(), u.uid]));
  const seen = new Set<string>();
  const rx = /(^|\s)@([A-Za-z0-9._-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(message)) !== null) {
    const candidate = (m[2] ?? "").toLowerCase();
    const uid = map.get(candidate);
    if (uid) seen.add(uid);
  }
  return [...seen];
}

function MentionText({
  text,
  usersByLowerName,
}: {
  text: string;
  usersByLowerName: Map<string, RegisteredUser>;
}) {
  const parts = text.split(/(\s+)/);
  return (
    <>
      {parts.map((part, idx) => {
        if (/^@[A-Za-z0-9._-]+$/.test(part)) {
          const hit = usersByLowerName.get(part.slice(1).toLowerCase());
          if (hit) {
            return (
              <span key={`${part}-${idx}`} className="font-semibold text-red-300">
                {part}
              </span>
            );
          }
        }
        return <React.Fragment key={`${part}-${idx}`}>{part}</React.Fragment>;
      })}
    </>
  );
}

export default function PavilionPage() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [users, setUsers] = useState<RegisteredUser[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [lastSentAtMs, setLastSentAtMs] = useState(0);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);
  const lastSeenWriteMsRef = useRef(0);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthUser(u ?? null);
      setAuthReady(true);
      if (!u) router.replace("/login");
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!authUser) return;
    void (async () => {
      const claim = await getIdTokenResult(authUser).catch(() => null);
      const hasClaimAdmin = claim?.claims?.admin === true;
      const leagueAdminSnap = await getDoc(doc(db, "leagueAdmins", authUser.uid)).catch(() => null);
      setIsAdmin(Boolean(hasClaimAdmin || leagueAdminSnap?.exists()));
    })();
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;
    const displayName = accountHolderName(authUser);
    void setDoc(
      doc(db, "users", authUser.uid),
      {
        displayName,
        displayNameLower: displayName.toLowerCase(),
        email: authUser.email ?? null,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;
    const q = query(collection(db, "users"), orderBy("displayNameLower", "asc"), limit(500));
    return onSnapshot(q, (snap) => {
      const next: RegisteredUser[] = snap.docs.map((d) => {
        const raw = d.data() as Record<string, unknown>;
        const displayName =
          typeof raw.displayName === "string" && raw.displayName.trim()
            ? raw.displayName.trim()
            : `User ${d.id.slice(0, 6)}`;
        return { uid: d.id, displayName, displayNameLower: displayName.toLowerCase() };
      });
      setUsers(next);
    });
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;
    const q = query(collection(db, "chatMessages"), orderBy("createdAt", "desc"), limit(100));
    return onSnapshot(q, (snap) => {
      const next = snap.docs
        .map((d) => {
          const raw = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            userId: typeof raw.userId === "string" ? raw.userId : "",
            displayName: typeof raw.displayName === "string" ? raw.displayName : "Manager",
            message: typeof raw.message === "string" ? raw.message : "",
            createdAt: raw.createdAt instanceof Timestamp ? raw.createdAt : null,
            mentionedUserIds: Array.isArray(raw.mentionedUserIds)
              ? raw.mentionedUserIds.filter((x): x is string => typeof x === "string")
              : [],
            deleted: raw.deleted === true,
            deletedAt: raw.deletedAt instanceof Timestamp ? raw.deletedAt : null,
            deletedBy: typeof raw.deletedBy === "string" ? raw.deletedBy : undefined,
            isAdmin: raw.isAdmin === true,
          } satisfies ChatMessage;
        })
        .reverse();
      setChatMessages(next);
    });
  }, [authUser]);

  useEffect(() => {
    if (!authUser || chatMessages.length === 0) return;
    const newest = chatMessages[chatMessages.length - 1];
    if (!newest?.createdAt) return;
    const newestMs = newest.createdAt.toMillis();
    if (newestMs <= lastSeenWriteMsRef.current) return;
    lastSeenWriteMsRef.current = newestMs;
    void setDoc(
      doc(db, "userChatState", authUser.uid),
      {
        lastSeenAt: newest.createdAt,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }, [authUser, chatMessages]);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !isNearBottom) return;
    el.scrollTop = el.scrollHeight;
  }, [chatMessages, isNearBottom]);

  const mentionQuery = useMemo(() => parseMentionQuery(input), [input]);
  const usersByLowerName = useMemo(
    () => new Map(users.map((u) => [u.displayNameLower, u])),
    [users],
  );
  const mentionOptions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return users
      .filter((u) => (q ? u.displayNameLower.includes(q) : true))
      .slice(0, 8);
  }, [mentionQuery, users]);

  const cooldownRemainingMs = Math.max(0, MESSAGE_COOLDOWN_MS - (Date.now() - lastSentAtMs));
  const trimmed = input.trim();
  const canSend = Boolean(authUser) && !sending && trimmed.length > 0 && trimmed.length <= MAX_MESSAGE_LEN && cooldownRemainingMs === 0;

  async function sendMessage() {
    if (!authUser || !canSend) return;
    setSending(true);
    setSendError(null);
    try {
      const body = trimmed;
      const mentionedUserIds = extractMentionedUserIds(body, users);
      await addDoc(collection(db, "chatMessages"), {
        userId: authUser.uid,
        displayName: accountHolderName(authUser),
        message: body,
        createdAt: serverTimestamp(),
        mentionedUserIds,
        deleted: false,
        isAdmin,
      });
      setInput("");
      setLastSentAtMs(Date.now());
    } catch {
      setSendError("Could not send message. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function softDeleteMessage(messageId: string) {
    if (!authUser || !isAdmin) return;
    await updateDoc(doc(db, "chatMessages", messageId), {
      deleted: true,
      deletedAt: serverTimestamp(),
      deletedBy: authUser.uid,
    });
  }

  if (!authReady || !authUser) {
    return (
      <div className="min-h-screen bg-[#080808] text-white flex items-center justify-center">
        <div className="rounded-2xl bg-white/5 p-6 ring-1 ring-white/10 text-center">
          <div className="text-base font-semibold">Loading Pavilion…</div>
          <div className="mt-1 text-sm text-zinc-400">Checking account access.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080808] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-0 -translate-x-1/2 h-[600px] w-[900px] rounded-full bg-red-800/8 blur-[140px]" />
      </div>
      <div className="relative mx-auto w-full max-w-4xl px-4 pb-8 pt-6 sm:px-6">
        <header className="rounded-2xl border border-white/8 bg-zinc-900/60 px-4 py-4 backdrop-blur-md sm:px-6 sm:py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-3">
                <div className="relative h-10 w-10 shrink-0 drop-shadow-lg">
                  <Image src="/logo.png" alt="Nondies CC" fill className="object-contain" priority />
                </div>
                <div>
                  <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">Pavilion</h1>
                  <p className="mt-0.5 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">{APP_NAME}</p>
                </div>
              </div>
            </div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm font-medium text-zinc-300 ring-1 ring-white/10 hover:bg-white/10 hover:text-white transition"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
          </div>
        </header>

        <section className="mt-5 rounded-2xl border border-white/10 bg-zinc-900/50 backdrop-blur-sm">
          <div
            ref={listRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              const delta = el.scrollHeight - (el.scrollTop + el.clientHeight);
              setIsNearBottom(delta < 80);
            }}
            className="h-[60vh] min-h-[360px] overflow-y-auto px-4 py-4 sm:px-5"
          >
            {chatMessages.length === 0 ? (
              <div className="rounded-xl bg-white/5 px-4 py-3 text-sm text-zinc-400 ring-1 ring-white/10">
                No messages yet. Say hi to start the clubhouse chat.
              </div>
            ) : (
              <div className="space-y-3">
                {chatMessages.map((m) => (
                  <article key={m.id} className="rounded-xl bg-black/30 px-3.5 py-3 ring-1 ring-white/10">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-zinc-100">{m.displayName}</span>
                      {m.isAdmin ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-semibold text-red-300 ring-1 ring-red-500/30">
                          <Shield className="h-3 w-3" />
                          Admin
                        </span>
                      ) : null}
                      <span className="text-zinc-500">{formatWhen(m.createdAt)}</span>
                      {isAdmin && !m.deleted ? (
                        <button
                          type="button"
                          onClick={() => void softDeleteMessage(m.id)}
                          className="ml-auto inline-flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-[11px] text-zinc-400 ring-1 ring-white/10 hover:bg-red-500/10 hover:text-red-300 hover:ring-red-500/30"
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-zinc-200">
                      {m.deleted ? (
                        <span className="italic text-zinc-500">Message deleted by admin</span>
                      ) : (
                        <MentionText text={m.message} usersByLowerName={usersByLowerName} />
                      )}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="sticky bottom-0 border-t border-white/10 bg-zinc-950/80 px-4 py-3 backdrop-blur-md sm:px-5">
            <div className="relative">
              <textarea
                value={input}
                onChange={(e) => {
                  if (e.target.value.length <= MAX_MESSAGE_LEN) setInput(e.target.value);
                }}
                placeholder="Message the pavilion…"
                rows={3}
                className="w-full resize-none rounded-xl bg-white/5 px-3 py-2.5 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-red-500/60"
              />
              {mentionOptions.length > 0 ? (
                <div className="absolute bottom-full mb-2 w-full overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-white/15">
                  {mentionOptions.map((u) => (
                    <button
                      key={u.uid}
                      type="button"
                      onClick={() => setInput((prev) => replaceTrailingMentionDraft(prev, u.displayName))}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/5"
                    >
                      <UserRound className="h-4 w-4 text-zinc-500" />
                      {u.displayName}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="text-xs text-zinc-400">
                Use @name to mention registered players. Keep it friendly.
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">{trimmed.length}/{MAX_MESSAGE_LEN}</span>
                <button
                  type="button"
                  onClick={() => void sendMessage()}
                  disabled={!canSend}
                  className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-3 py-2 text-sm font-semibold text-white ring-1 ring-red-500/40 hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  {sending ? "Sending…" : cooldownRemainingMs > 0 ? `Wait ${Math.ceil(cooldownRemainingMs / 1000)}s` : "Send"}
                </button>
              </div>
            </div>
            {sendError ? <div className="mt-2 text-xs text-amber-300">{sendError}</div> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
