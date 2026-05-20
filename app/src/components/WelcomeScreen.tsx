import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import jsQR from "jsqr";
import { api } from "../api";
import clsx from "clsx";

type Step = "intro" | "manual" | "qr";

export function WelcomeScreen() {
  const [step, setStep] = useState<Step>("intro");
  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-pap-bg">
      <div className="w-full max-w-2xl rounded-2xl border border-pap-border bg-pap-surface p-10 shadow-2xl">
        <Hero />
        <div className="mt-8">
          {step === "intro" && <IntroChoices onPick={setStep} />}
          {step === "manual" && <ManualLogin onBack={() => setStep("intro")} />}
          {step === "qr" && <QrLogin onBack={() => setStep("intro")} />}
        </div>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <header className="text-center space-y-2">
      <div className="text-5xl">📓</div>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome to Cartable</h1>
      <p className="text-sm text-pap-muted leading-relaxed">
        Cartable mirrors your child's Pronote account into a local SQLite database, so this
        Mac app can show grades, homework, the weekly schedule, published bulletins, and a
        Claude-powered chat — all <span className="text-pap-text">without sending anything off your machine</span>.
        First, let's connect to Pronote.
      </p>
    </header>
  );
}

function IntroChoices({ onPick }: { onPick: (s: Step) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <ChoiceCard
        onClick={() => onPick("qr")}
        emoji="📱"
        title="Scan QR from Pronote mobile"
        subtitle="Open Pronote on your phone → Mon compte → Connecter un nouvel appareil. Pick a 4-digit code, then drop the QR screenshot here."
        accent
      />
      <ChoiceCard
        onClick={() => onPick("manual")}
        emoji="⌨️"
        title="Enter URL + credentials"
        subtitle="You'll need the Pronote URL (eleve.html or parent.html) plus the username and password you use on the web."
      />
    </div>
  );
}

function ChoiceCard({
  onClick,
  emoji,
  title,
  subtitle,
  accent,
}: {
  onClick: () => void;
  emoji: string;
  title: string;
  subtitle: string;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "rounded-xl border p-5 text-left transition-colors h-full",
        accent
          ? "border-pap-accent/40 bg-pap-accent/10 hover:bg-pap-accent/15"
          : "border-pap-border bg-pap-surface-2 hover:bg-pap-border/50",
      )}
    >
      <div className="text-3xl mb-2">{emoji}</div>
      <div className="font-semibold text-sm">{title}</div>
      <div className="text-xs text-pap-muted mt-1 leading-relaxed">{subtitle}</div>
    </button>
  );
}

// ---------- manual ----------------------------------------------------------

function ManualLogin({ onBack }: { onBack: () => void }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState("password");
  const [ent, setEnt] = useState("");
  const [user, setUser] = useState("");
  const [pwd, setPwd] = useState("");
  const [child, setChild] = useState("");

  const save = useMutation({
    mutationFn: api.settingsAccountUpdate,
    onSuccess: () => qc.invalidateQueries(),
  });

  return (
    <form
      className="space-y-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          pronote_url: url,
          auth_mode: mode,
          username: user,
          password: pwd,
          ent_provider: ent,
          child_name: child,
        });
      }}
    >
      <BackBar onBack={onBack} title="Manual login" />
      <Field label="Pronote URL">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          placeholder="https://0123456a.index-education.net/pronote/parent.html"
          className={inputCls}
        />
      </Field>
      <Field label="Auth mode">
        <select value={mode} onChange={(e) => setMode(e.target.value)} className={inputCls}>
          <option value="password">password (direct)</option>
          <option value="ent">ent (school portal)</option>
        </select>
      </Field>
      {mode === "ent" && (
        <Field label="ENT provider">
          <input
            value={ent}
            onChange={(e) => setEnt(e.target.value)}
            placeholder="ac_rennes, ent_hdf, ile_de_france, …"
            required
            className={inputCls}
          />
        </Field>
      )}
      <Field label="Username">
        <input value={user} onChange={(e) => setUser(e.target.value)} required className={inputCls} />
      </Field>
      <Field label="Password">
        <input
          type="password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          required
          className={inputCls}
        />
      </Field>
      <Field label="Child (parents only, optional)">
        <input
          value={child}
          onChange={(e) => setChild(e.target.value)}
          placeholder="exact name as Pronote shows it"
          className={inputCls}
        />
      </Field>
      {save.error && <p className="text-pap-bad text-xs">{(save.error as Error).message}</p>}
      <div className="pt-2 flex gap-2 justify-end">
        <button type="button" onClick={onBack} className={btnGhost} disabled={save.isPending}>
          Back
        </button>
        <button type="submit" className={btnAccent} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Connect"}
        </button>
      </div>
      <p className="text-xs text-pap-muted">
        Stored locally at <code>{"~/Documents/Claude/cartable/.env"}</code>. Never transmitted anywhere except Pronote itself.
      </p>
    </form>
  );
}

// ---------- QR --------------------------------------------------------------

function QrLogin({ onBack }: { onBack: () => void }) {
  const qc = useQueryClient();
  const [qr, setQr] = useState<Record<string, any> | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [jsonText, setJsonText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const login = useMutation({
    mutationFn: ({ qrData, pin }: { qrData: Record<string, any>; pin: string }) =>
      api.settingsLoginQr(qrData, pin),
    onSuccess: () => qc.invalidateQueries(),
  });

  async function handleFile(file: File) {
    setQrError(null);
    try {
      const img = await loadImage(file);
      const { data, width, height } = imageData(img);
      const result = jsQR(data, width, height);
      if (!result) throw new Error("No QR code found in this image.");
      const parsed = JSON.parse(result.data);
      if (!parsed || typeof parsed !== "object" || !parsed.login || !parsed.jeton || !parsed.url) {
        throw new Error("QR decoded, but it doesn't look like a Pronote login code (missing login/jeton/url).");
      }
      setQr(parsed);
      setJsonText(JSON.stringify(parsed, null, 2));
    } catch (e: any) {
      setQrError(e.message ?? String(e));
    }
  }

  function applyPastedJson() {
    setQrError(null);
    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed.login || !parsed.jeton || !parsed.url) {
        throw new Error("Missing login/jeton/url.");
      }
      setQr(parsed);
    } catch (e: any) {
      setQrError(`Invalid JSON: ${e.message ?? e}`);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <BackBar onBack={onBack} title="QR-code login" />
      <ol className="text-xs text-pap-muted space-y-1 list-decimal pl-5">
        <li>On Pronote mobile: <strong>Compte → Connecter un nouvel appareil</strong>.</li>
        <li>Choose a 4-digit code (you'll enter it here).</li>
        <li>Either take a screenshot of the QR and drop it below, or paste the JSON contained in the QR if you have it.</li>
      </ol>

      <div className="grid grid-cols-2 gap-3 mt-2">
        <div className="rounded-md border border-pap-border bg-pap-surface-2 p-3">
          <div className="text-xs font-semibold mb-2">From a QR screenshot</div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={btnGhost + " w-full"}
          >
            Pick a PNG / JPG…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
        </div>
        <div className="rounded-md border border-pap-border bg-pap-surface-2 p-3">
          <div className="text-xs font-semibold mb-2">Or paste the QR JSON</div>
          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            placeholder='{"login": "…", "jeton": "…", "url": "…"}'
            rows={4}
            className={inputCls + " font-mono text-xs"}
          />
          <button
            type="button"
            onClick={applyPastedJson}
            className={btnGhost + " w-full mt-2"}
          >
            Use this JSON
          </button>
        </div>
      </div>

      {qrError && <p className="text-pap-bad text-xs">{qrError}</p>}

      {qr && (
        <div className="rounded-md border border-pap-good/40 bg-pap-good/10 p-3 text-xs">
          <div className="font-semibold text-pap-good">QR decoded.</div>
          <div className="text-pap-muted mt-1 break-all">URL: {qr.url}</div>
          <div className="text-pap-muted">Login: {qr.login}</div>
        </div>
      )}

      <Field label="4-digit PIN you set on the phone">
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          inputMode="numeric"
          pattern="\d{4}"
          placeholder="0000"
          className={inputCls + " w-24 tracking-[0.5em] text-center"}
        />
      </Field>

      {login.error && <p className="text-pap-bad text-xs">{(login.error as Error).message}</p>}

      <div className="pt-1 flex gap-2 justify-end">
        <button type="button" onClick={onBack} className={btnGhost} disabled={login.isPending}>
          Back
        </button>
        <button
          type="button"
          onClick={() => qr && login.mutate({ qrData: qr, pin })}
          disabled={!qr || pin.length !== 4 || login.isPending}
          className={btnAccent}
        >
          {login.isPending ? "Talking to Pronote…" : "Connect"}
        </button>
      </div>
    </div>
  );
}

// ---------- shared ---------------------------------------------------------

function BackBar({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-pap-border pb-2">
      <h2 className="font-semibold">{title}</h2>
      <button type="button" onClick={onBack} className="text-xs text-pap-muted hover:text-pap-text">
        ← back
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-pap-muted mb-1">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full bg-pap-bg border border-pap-border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-pap-accent";
const btnAccent =
  "px-4 py-1.5 rounded-md bg-pap-accent text-pap-bg text-sm font-medium hover:bg-pap-accent/85 disabled:opacity-40";
const btnGhost =
  "px-4 py-1.5 rounded-md bg-pap-surface-2 text-pap-text text-sm hover:bg-pap-border disabled:opacity-40";

// ---------- image utilities -------------------------------------------------

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not load image."));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

function imageData(img: HTMLImageElement): ImageData {
  const canvas = document.createElement("canvas");
  // Cap at 2048 to keep jsQR fast on huge phone screenshots.
  const scale = Math.min(1, 2048 / Math.max(img.width, img.height));
  canvas.width = Math.floor(img.width * scale);
  canvas.height = Math.floor(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
