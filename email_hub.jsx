import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Link2, Pencil, Trash2, Plus, X, Send, ArrowLeft, Upload,
  FileText, RotateCcw, Check, Loader2, MessageSquare, Mail
} from "lucide-react";

const COLORS = {
  paper: "#F7F5F1",
  panel: "#EFEBE3",
  panelDeep: "#E9E4DB",
  ink: "#211D1B",
  grey: "#6E6560",
  hairline: "#DDD6CC",
  crimson: "#C10230",
  maroon: "#8A0224",
  tint: "rgba(193,2,48,.05)",
};

const TYPES = {
  warroom: {
    label: "War Room Summaries",
    short: "War Room",
    system: `You write daily "War Room" meeting summary emails for a professional services context.
Format: a clear, structured recap of the day's war room session — cover the key issues discussed, decisions reached, action items with clear owners, and next steps/blockers. Use short paragraphs and, where natural, brief bullet points for action items.
Tone: clear, concise, corporate-professional. Vary sentence structure — do not sound templated or robotic. Open with a brief one-line framing, close with a short next-steps or availability line.`,
  },
  tagup: {
    label: "Tag-Up Follow-Ups",
    short: "Tag-Up",
    system: `You write short follow-up emails sent after a "tag-up" / check-in meeting.
Format: a brief recap of what was discussed, agreed next steps or action items, and any open questions. Keep it noticeably shorter than a full meeting summary — a tag-up follow-up is a quick, light-touch note, not a report.
Tone: warm but professional and concise. Vary sentence structure — do not sound templated or robotic.`,
  },
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function callClaude(system, messages, maxTokens = 1000) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });
  if (!res.ok) throw new Error("Claude API request failed");
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return text;
}

function parseJsonLoose(text) {
  let t = text.trim();
  t = t.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

async function safeStorageGet(key, shared) {
  try {
    const r = await window.storage.get(key, shared);
    return r ? JSON.parse(r.value) : null;
  } catch {
    return null;
  }
}
async function safeStorageSet(key, value, shared) {
  try {
    await window.storage.set(key, JSON.stringify(value), shared);
  } catch (e) {
    console.error("storage set failed", key, e);
  }
}

export default function EmailHub() {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState("home"); // home | detail | trash
  const [emails, setEmails] = useState([]);
  const [keyLink, setKeyLink] = useState({ label: "", url: "" });
  const [editingLink, setEditingLink] = useState(false);
  const [linkDraft, setLinkDraft] = useState({ label: "", url: "" });
  const [training, setTraining] = useState({ warroom: [], tagup: [] });
  const [selectedId, setSelectedId] = useState(null);
  const [modalType, setModalType] = useState(null); // 'warroom' | 'tagup' | null
  const [toast, setToast] = useState(null);

  const emailsRef = useRef(emails);
  emailsRef.current = emails;

  // ---- load ----
  useEffect(() => {
    (async () => {
      const [em, kl, tw, tt] = await Promise.all([
        safeStorageGet("emails", true),
        safeStorageGet("keylink", true),
        safeStorageGet("training:warroom", true),
        safeStorageGet("training:tagup", true),
      ]);
      if (em) setEmails(em);
      if (kl) setKeyLink(kl);
      setTraining({ warroom: tw || [], tagup: tt || [] });
      setReady(true);
    })();
  }, []);

  const persistEmails = useCallback(async (next) => {
    setEmails(next);
    await safeStorageSet("emails", next, true);
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  // ---- key link ----
  const saveLink = async () => {
    setKeyLink(linkDraft);
    await safeStorageSet("keylink", linkDraft, true);
    setEditingLink(false);
  };

  // ---- training examples ----
  const addTrainingFiles = async (type, files) => {
    const reads = await Promise.all(
      Array.from(files).map(
        (f) =>
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({ id: uid(), filename: f.name, content: String(reader.result).slice(0, 4000) });
            reader.onerror = () => resolve(null);
            reader.readAsText(f);
          })
      )
    );
    const valid = reads.filter(Boolean);
    const next = { ...training, [type]: [...training[type], ...valid] };
    setTraining(next);
    await safeStorageSet(`training:${type}`, next[type], true);
    showToast(`Added ${valid.length} example${valid.length === 1 ? "" : "s"}`);
  };

  const removeTrainingFile = async (type, id) => {
    const next = { ...training, [type]: training[type].filter((t) => t.id !== id) };
    setTraining(next);
    await safeStorageSet(`training:${type}`, next[type], true);
  };

  // ---- email lifecycle ----
  const moveToTrash = async (id) => {
    const next = emailsRef.current.map((e) =>
      e.id === id ? { ...e, status: "trash", trashedAt: Date.now() } : e
    );
    await persistEmails(next);
    if (view === "detail" && selectedId === id) setView("home");
    showToast("Moved to trash");
  };

  const restoreFromTrash = async (id) => {
    const next = emailsRef.current.map((e) =>
      e.id === id ? { ...e, status: "active", trashedAt: null } : e
    );
    await persistEmails(next);
    showToast("Restored");
  };

  const emptyTrash = async () => {
    const next = emailsRef.current.filter((e) => e.status !== "trash");
    await persistEmails(next);
    showToast("Trash emptied");
  };

  const updateEmail = async (id, patch) => {
    const next = emailsRef.current.map((e) => (e.id === id ? { ...e, ...patch } : e));
    await persistEmails(next);
  };

  const selected = emails.find((e) => e.id === selectedId) || null;
  const active = emails.filter((e) => e.status !== "trash");
  const trashed = emails.filter((e) => e.status === "trash");

  return (
    <div style={{ background: COLORS.paper, minHeight: "100vh", color: COLORS.ink, fontFamily: "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif" }}>
      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-thumb { background: ${COLORS.hairline}; border-radius: 4px; }
        .btn-primary { background: ${COLORS.crimson}; color: #fff; transition: background .15s ease; }
        .btn-primary:hover:not(:disabled) { background: ${COLORS.maroon}; }
        .btn-primary:disabled { background: ${COLORS.hairline}; color: ${COLORS.grey}; cursor: not-allowed; }
        .card-hover:hover { background: ${COLORS.panelDeep}; }
        .fade-in { animation: fadeIn .18s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px);} to { opacity:1; transform: translateY(0);} }
        textarea, input { font-family: inherit; }
      `}</style>

      {!ready ? (
        <div className="flex items-center justify-center" style={{ height: "100vh" }}>
          <Loader2 className="animate-spin" size={22} color={COLORS.crimson} />
        </div>
      ) : view === "detail" && selected ? (
        <DetailView
          email={selected}
          onBack={() => setView("home")}
          onUpdate={(patch) => updateEmail(selected.id, patch)}
          onTrash={() => moveToTrash(selected.id)}
        />
      ) : view === "trash" ? (
        <TrashView
          items={trashed}
          onBack={() => setView("home")}
          onRestore={restoreFromTrash}
          onEmpty={emptyTrash}
        />
      ) : (
        <HomeView
          keyLink={keyLink}
          editingLink={editingLink}
          linkDraft={linkDraft}
          setLinkDraft={setLinkDraft}
          setEditingLink={setEditingLink}
          saveLink={saveLink}
          trashCount={trashed.length}
          onOpenTrash={() => setView("trash")}
          active={active}
          onOpenEmail={(id) => {
            setSelectedId(id);
            setView("detail");
          }}
          onTrash={moveToTrash}
          training={training}
          addTrainingFiles={addTrainingFiles}
          removeTrainingFile={removeTrainingFile}
          modalType={modalType}
          setModalType={setModalType}
          onCreated={(email) => {
            persistEmails([email, ...emailsRef.current]);
            setSelectedId(email.id);
            setView("detail");
          }}
        />
      )}

      {toast && (
        <div
          className="fade-in"
          style={{
            position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
            background: COLORS.ink, color: COLORS.paper, padding: "10px 18px",
            borderRadius: 8, fontSize: 13, boxShadow: "0 4px 16px rgba(0,0,0,.2)", zIndex: 100,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

// ============ HOME ============
function HomeView({
  keyLink, editingLink, linkDraft, setLinkDraft, setEditingLink, saveLink,
  trashCount, onOpenTrash, active, onOpenEmail, onTrash,
  training, addTrainingFiles, removeTrainingFile,
  modalType, setModalType, onCreated,
}) {
  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 24px 64px" }}>
      {/* Top bar */}
      <div className="flex items-center justify-between" style={{ marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: "0.12em", color: COLORS.crimson, fontWeight: 700, textTransform: "uppercase" }}>
            Email Hub
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, marginTop: 2 }}>War Room & Tag-Up Emails</div>
        </div>
        <button
          onClick={onOpenTrash}
          style={{
            position: "relative", display: "flex", alignItems: "center", gap: 6,
            border: `1px solid ${COLORS.hairline}`, background: COLORS.panel,
            padding: "8px 14px", borderRadius: 8, fontSize: 13, color: COLORS.ink, cursor: "pointer",
          }}
        >
          <Trash2 size={15} />
          Trash
          {trashCount > 0 && (
            <span style={{
              background: COLORS.crimson, color: "#fff", fontSize: 10, fontWeight: 700,
              borderRadius: 999, minWidth: 16, height: 16, display: "flex", alignItems: "center",
              justifyContent: "center", padding: "0 4px", marginLeft: 2,
            }}>{trashCount}</span>
          )}
        </button>
      </div>

      {/* Key link */}
      <div style={{
        background: COLORS.panel, border: `1px solid ${COLORS.hairline}`, borderRadius: 10,
        padding: "12px 16px", marginBottom: 28, display: "flex", alignItems: "center", gap: 10,
      }}>
        <Link2 size={16} color={COLORS.crimson} style={{ flexShrink: 0 }} />
        {editingLink ? (
          <div className="flex items-center gap-2" style={{ flex: 1, flexWrap: "wrap" }}>
            <input
              value={linkDraft.label}
              onChange={(e) => setLinkDraft({ ...linkDraft, label: e.target.value })}
              placeholder="Label (e.g. Master Tracker)"
              style={{ flex: "1 1 160px", padding: "6px 10px", borderRadius: 6, border: `1px solid ${COLORS.hairline}`, fontSize: 13, background: "#fff" }}
            />
            <input
              value={linkDraft.url}
              onChange={(e) => setLinkDraft({ ...linkDraft, url: e.target.value })}
              placeholder="https://..."
              style={{ flex: "2 1 240px", padding: "6px 10px", borderRadius: 6, border: `1px solid ${COLORS.hairline}`, fontSize: 13, background: "#fff" }}
            />
            <button onClick={saveLink} className="btn-primary" style={{ padding: "6px 12px", borderRadius: 6, fontSize: 13, border: "none", cursor: "pointer" }}>
              <Check size={14} />
            </button>
            <button onClick={() => setEditingLink(false)} style={{ padding: "6px 10px", borderRadius: 6, fontSize: 13, border: `1px solid ${COLORS.hairline}`, background: "transparent", cursor: "pointer" }}>
              <X size={14} />
            </button>
          </div>
        ) : keyLink.url ? (
          <div className="flex items-center justify-between" style={{ flex: 1 }}>
            <a href={keyLink.url} target="_blank" rel="noopener noreferrer" style={{ color: COLORS.ink, fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
              {keyLink.label || keyLink.url}
              <span style={{ color: COLORS.grey, fontWeight: 400, marginLeft: 8, fontSize: 12 }}>{keyLink.url}</span>
            </a>
            <button
              onClick={() => { setLinkDraft(keyLink); setEditingLink(true); }}
              style={{ background: "transparent", border: "none", cursor: "pointer", color: COLORS.grey, display: "flex" }}
            >
              <Pencil size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setLinkDraft({ label: "", url: "" }); setEditingLink(true); }}
            style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 13, color: COLORS.grey, textAlign: "left" }}
          >
            + Add a key link (tracker, doc, dashboard...)
          </button>
        )}
      </div>

      {/* Two columns */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
        {Object.entries(TYPES).map(([type, cfg]) => (
          <Column
            key={type}
            type={type}
            cfg={cfg}
            emails={active.filter((e) => e.type === type)}
            onOpenEmail={onOpenEmail}
            onTrash={onTrash}
            examples={training[type]}
            addTrainingFiles={(files) => addTrainingFiles(type, files)}
            removeTrainingFile={(id) => removeTrainingFile(type, id)}
            onNew={() => setModalType(type)}
          />
        ))}
      </div>

      {modalType && (
        <NewEmailModal
          type={modalType}
          cfg={TYPES[modalType]}
          examples={training[modalType]}
          onClose={() => setModalType(null)}
          onCreated={(email) => {
            setModalType(null);
            onCreated(email);
          }}
        />
      )}
    </div>
  );
}

function Column({ type, cfg, emails, onOpenEmail, onTrash, examples, addTrainingFiles, removeTrainingFile, onNew }) {
  const [dragOver, setDragOver] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const fileRef = useRef(null);

  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.hairline}`, borderRadius: 12, padding: 18 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{cfg.label}</div>
          <div style={{ fontSize: 12, color: COLORS.grey }}>{emails.length} saved</div>
        </div>
        <button
          onClick={onNew}
          className="btn-primary"
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: 8, fontSize: 13, border: "none", cursor: "pointer", fontWeight: 600 }}
        >
          <Plus size={14} /> New
        </button>
      </div>

      {/* training examples toggle */}
      <button
        onClick={() => setShowExamples((s) => !s)}
        style={{ fontSize: 12, color: COLORS.crimson, background: "transparent", border: "none", cursor: "pointer", padding: 0, marginBottom: showExamples ? 10 : 14, fontWeight: 600 }}
      >
        {showExamples ? "Hide" : "Add"} example emails ({examples.length}) to guide style
      </button>

      {showExamples && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) addTrainingFiles(e.dataTransfer.files);
          }}
          style={{
            border: `1.5px dashed ${dragOver ? COLORS.crimson : COLORS.hairline}`,
            borderRadius: 8, padding: 12, marginBottom: 14, background: dragOver ? COLORS.tint : "rgba(255,255,255,.4)",
          }}
        >
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".txt,.md,.eml"
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.length && addTrainingFiles(e.target.files)}
          />
          <div
            onClick={() => fileRef.current?.click()}
            style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, color: COLORS.grey, marginBottom: examples.length ? 8 : 0 }}
          >
            <Upload size={14} /> Drop .txt / .md files, or click to browse
          </div>
          {examples.map((ex) => (
            <div key={ex.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, padding: "5px 0", borderTop: `1px solid ${COLORS.hairline}` }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6, color: COLORS.ink }}>
                <FileText size={12} /> {ex.filename}
              </span>
              <button onClick={() => removeTrainingFile(ex.id)} style={{ background: "transparent", border: "none", cursor: "pointer", color: COLORS.grey }}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* catalog */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {emails.length === 0 && (
          <div style={{ fontSize: 13, color: COLORS.grey, padding: "18px 4px", textAlign: "center" }}>
            No emails yet. Click "New" to generate one.
          </div>
        )}
        {emails.map((email) => (
          <div
            key={email.id}
            onClick={() => onOpenEmail(email.id)}
            className="card-hover"
            style={{
              background: "#fff", border: `1px solid ${COLORS.hairline}`, borderRadius: 8,
              padding: "10px 12px", cursor: "pointer", position: "relative",
            }}
          >
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 2, paddingRight: 20 }}>{email.subject}</div>
            <div style={{ fontSize: 11.5, color: COLORS.crimson, marginBottom: 4 }}>To: {email.to || "—"}</div>
            <div style={{ fontSize: 12, color: COLORS.grey, lineHeight: 1.4 }}>{email.summary}</div>
            <div style={{ fontSize: 10.5, color: COLORS.grey, marginTop: 6 }}>
              {new Date(email.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onTrash(email.id); }}
              style={{ position: "absolute", top: 10, right: 10, background: "transparent", border: "none", cursor: "pointer", color: COLORS.grey }}
              title="Move to trash"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============ NEW EMAIL MODAL ============
function NewEmailModal({ type, cfg, examples, onClose, onCreated }) {
  const [subject, setSubject] = useState("");
  const [purpose, setPurpose] = useState("");
  const [notes, setNotes] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const canGenerate = subject.trim() && purpose.trim() && notes.trim() && !generating;

  const generate = async () => {
    setGenerating(true);
    setError("");
    try {
      const examplesBlock = examples.length
        ? `\n\nHere are example emails in the desired style — emulate their tone, structure, and level of formality, but do not copy their content:\n\n${examples
            .map((ex, i) => `--- Example ${i + 1} (${ex.filename}) ---\n${ex.content}`)
            .join("\n\n")}`
        : "";

      const system = `${cfg.system}${examplesBlock}

Respond with ONLY a raw JSON object (no markdown fences, no commentary) in this exact shape:
{"to": "recipient or team name inferred from context", "body": "the full email body, no subject line inside it", "summary": "one short sentence (max 18 words) summarizing this email for a catalog listing"}`;

      const userMsg = `Subject: ${subject}\nPurpose of this email: ${purpose}\nNotes / raw content to draw from:\n${notes}`;

      const raw = await callClaude(system, [{ role: "user", content: userMsg }]);
      const parsed = parseJsonLoose(raw);

      const email = {
        id: uid(),
        type,
        subject: subject.trim(),
        purpose: purpose.trim(),
        notes: notes.trim(),
        to: parsed.to || "",
        body: parsed.body || "",
        summary: parsed.summary || "",
        status: "active",
        createdAt: Date.now(),
        chat: [],
      };
      onCreated(email);
    } catch (e) {
      setError("Generation failed — check your connection and try again.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(33,29,27,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}>
      <div className="fade-in" style={{ background: COLORS.paper, borderRadius: 14, width: 560, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", padding: 24, border: `1px solid ${COLORS.hairline}` }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>New {cfg.short} Email</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: COLORS.grey }}>
            <X size={18} />
          </button>
        </div>

        <Field label="Subject">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. War Room Summary — July 24"
            style={inputStyle}
          />
        </Field>
        <Field label="Purpose of this email">
          <input
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="e.g. Recap decisions and action items for leadership"
            style={inputStyle}
          />
        </Field>
        <Field label="Notes (paste raw meeting notes here)">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={7}
            placeholder="Paste your raw notes, bullet points, or transcript excerpts..."
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </Field>

        {error && <div style={{ color: COLORS.crimson, fontSize: 12, marginBottom: 10 }}>{error}</div>}

        <button
          onClick={generate}
          disabled={!canGenerate}
          className="btn-primary"
          style={{ width: "100%", padding: "11px 0", borderRadius: 8, fontSize: 14, fontWeight: 700, border: "none", cursor: canGenerate ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
        >
          {generating ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
          {generating ? "Generating..." : "Generate Email"}
        </button>
        <div style={{ fontSize: 11, color: COLORS.grey, marginTop: 8, textAlign: "center" }}>
          All three fields are required to generate.
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.grey, marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%", padding: "9px 11px", borderRadius: 8, border: `1px solid ${COLORS.hairline}`,
  fontSize: 13.5, background: "#fff", color: COLORS.ink, outline: "none",
};

// ============ DETAIL VIEW ============
function DetailView({ email, onBack, onUpdate, onTrash }) {
  const [subject, setSubject] = useState(email.subject);
  const [to, setTo] = useState(email.to);
  const [body, setBody] = useState(email.body);
  const [dirty, setDirty] = useState(false);
  const [chat, setChat] = useState(email.chat || []);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    setSubject(email.subject);
    setTo(email.to);
    setBody(email.body);
    setChat(email.chat || []);
    setDirty(false);
  }, [email.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, sending]);

  const save = async () => {
    await onUpdate({ subject, to, body });
    setDirty(false);
  };

  const sendChat = async () => {
    if (!chatInput.trim() || sending) return;
    const userMsg = chatInput.trim();
    const nextChat = [...chat, { role: "user", content: userMsg }];
    setChat(nextChat);
    setChatInput("");
    setSending(true);
    try {
      const system = `You are helping refine a corporate email that has already been drafted. Current email body:\n\n"""\n${body}\n"""\n\nThe user may ask questions or request edits. Respond with ONLY a raw JSON object (no markdown fences):\n{"reply": "a short conversational reply to the user (1-3 sentences)", "body": "the full email body — revised if the user asked for a change, or identical to the current body if they only asked a question"}`;
      const raw = await callClaude(
        system,
        nextChat.map((m) => ({ role: m.role, content: m.content }))
      );
      const parsed = parseJsonLoose(raw);
      const newBody = parsed.body || body;
      const updatedChat = [...nextChat, { role: "assistant", content: parsed.reply || "Done." }];
      setChat(updatedChat);
      setBody(newBody);
      await onUpdate({ chat: updatedChat, body: newBody });
    } catch (e) {
      setChat([...nextChat, { role: "assistant", content: "Sorry, something went wrong generating that response." }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 24px 40px", display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 22, alignItems: "start" }}>
      <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", cursor: "pointer", color: COLORS.grey, fontSize: 13, fontWeight: 600 }}>
          <ArrowLeft size={16} /> Back to Hub
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          {dirty && (
            <button onClick={save} className="btn-primary" style={{ padding: "7px 14px", borderRadius: 8, fontSize: 13, border: "none", cursor: "pointer", fontWeight: 600 }}>
              Save Changes
            </button>
          )}
          <button onClick={onTrash} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, fontSize: 13, border: `1px solid ${COLORS.hairline}`, background: COLORS.panel, cursor: "pointer", color: COLORS.ink }}>
            <Trash2 size={13} /> Trash
          </button>
        </div>
      </div>

      {/* email body */}
      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.hairline}`, borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.grey, marginBottom: 4, textTransform: "uppercase", letterSpacing: ".06em" }}>Subject</div>
        <input
          value={subject}
          onChange={(e) => { setSubject(e.target.value); setDirty(true); }}
          style={{ ...inputStyle, fontWeight: 700, fontSize: 16, marginBottom: 14 }}
        />
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.grey, marginBottom: 4, textTransform: "uppercase", letterSpacing: ".06em" }}>To</div>
        <input
          value={to}
          onChange={(e) => { setTo(e.target.value); setDirty(true); }}
          style={{ ...inputStyle, marginBottom: 14 }}
        />
        <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.grey, marginBottom: 4, textTransform: "uppercase", letterSpacing: ".06em" }}>Body</div>
        <textarea
          value={body}
          onChange={(e) => { setBody(e.target.value); setDirty(true); }}
          rows={16}
          style={{ ...inputStyle, lineHeight: 1.6, resize: "vertical" }}
        />
      </div>

      {/* chat refine */}
      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.hairline}`, borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", height: 480 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
          <MessageSquare size={14} color={COLORS.crimson} /> Refine with Claude
        </div>
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
          {chat.length === 0 && (
            <div style={{ fontSize: 12, color: COLORS.grey, padding: "8px 2px" }}>
              Ask for edits — e.g. "make it shorter" or "add a line about next week's timeline."
            </div>
          )}
          {chat.map((m, i) => (
            <div
              key={i}
              style={{
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                background: m.role === "user" ? COLORS.crimson : "#fff",
                color: m.role === "user" ? "#fff" : COLORS.ink,
                border: m.role === "user" ? "none" : `1px solid ${COLORS.hairline}`,
                borderRadius: 10, padding: "8px 11px", fontSize: 12.5, maxWidth: "88%", lineHeight: 1.4,
              }}
            >
              {m.content}
            </div>
          ))}
          {sending && <div style={{ fontSize: 12, color: COLORS.grey }}><Loader2 size={12} className="animate-spin" style={{ display: "inline", marginRight: 4 }} />thinking...</div>}
          <div ref={bottomRef} />
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendChat()}
            placeholder="Ask for a change..."
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            onClick={sendChat}
            disabled={!chatInput.trim() || sending}
            className="btn-primary"
            style={{ padding: "0 14px", borderRadius: 8, border: "none", cursor: "pointer", display: "flex", alignItems: "center" }}
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ TRASH VIEW ============
function TrashView({ items, onBack, onRestore, onEmpty }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 24px 48px" }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 20 }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", cursor: "pointer", color: COLORS.grey, fontSize: 13, fontWeight: 600 }}>
          <ArrowLeft size={16} /> Back to Hub
        </button>
        {items.length > 0 && !confirming && (
          <button onClick={() => setConfirming(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, fontSize: 13, border: `1px solid ${COLORS.crimson}`, background: "transparent", color: COLORS.crimson, cursor: "pointer", fontWeight: 600 }}>
            <Trash2 size={13} /> Empty Trash
          </button>
        )}
        {confirming && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
            <span style={{ color: COLORS.grey }}>Permanently delete {items.length} email{items.length === 1 ? "" : "s"}?</span>
            <button onClick={() => { onEmpty(); setConfirming(false); }} className="btn-primary" style={{ padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12 }}>Confirm</button>
            <button onClick={() => setConfirming(false)} style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${COLORS.hairline}`, background: "transparent", cursor: "pointer", fontSize: 12 }}>Cancel</button>
          </div>
        )}
      </div>

      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Trash</div>

      {items.length === 0 ? (
        <div style={{ fontSize: 13, color: COLORS.grey, textAlign: "center", padding: "40px 0" }}>Trash is empty.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((email) => (
            <div key={email.id} style={{ background: COLORS.panel, border: `1px solid ${COLORS.hairline}`, borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{email.subject}</div>
                <div style={{ fontSize: 11.5, color: COLORS.grey }}>{TYPES[email.type]?.short} · trashed {new Date(email.trashedAt).toLocaleDateString()}</div>
              </div>
              <button onClick={() => onRestore(email.id)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 6, fontSize: 12, border: `1px solid ${COLORS.hairline}`, background: "#fff", cursor: "pointer" }}>
                <RotateCcw size={12} /> Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
