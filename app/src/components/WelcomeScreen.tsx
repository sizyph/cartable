import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import jsQR from "jsqr";
import { Trans, useTranslation } from "react-i18next";
import { api } from "../api";
import { LANGUAGES, LangCode } from "../i18n";
import clsx from "clsx";

type Step = "intro" | "manual" | "qr";

export function WelcomeScreen() {
  const [step, setStep] = useState<Step>("intro");
  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-pap-bg">
      <div className="w-full max-w-2xl rounded-2xl border border-pap-border bg-pap-surface p-10 shadow-2xl">
        <Hero />
        <div className="mt-8 space-y-4">
          {step === "intro" && (
            <>
              <CliImportBanner />
              <IntroChoices onPick={setStep} />
            </>
          )}
          {step === "manual" && <ManualLogin onBack={() => setStep("intro")} />}
          {step === "qr" && <QrLogin onBack={() => setStep("intro")} />}
        </div>
        <LanguageRow />
      </div>
    </div>
  );
}

/** Detect a pre-existing CLI `.env` and offer to import it into Keychain. */
function CliImportBanner() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const detect = useQuery({
    queryKey: ["settings", "cli-env"],
    queryFn: api.settingsCliEnv,
    staleTime: 60_000,
  });
  const importCli = useMutation({
    mutationFn: api.settingsImportCli,
    onSuccess: () => qc.invalidateQueries(),
  });

  if (!detect.data?.found || !detect.data.has_password) return null;

  return (
    <div className="rounded-xl border border-pap-good/40 bg-pap-good/10 p-4 text-sm">
      <div className="flex items-start gap-3">
        <div className="text-2xl shrink-0">✨</div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-pap-good">
            {t("welcome.cli.found_title")}
          </div>
          <p className="text-xs text-pap-muted mt-1 leading-relaxed">
            {t("welcome.cli.found_intro", {
              username: detect.data.username || "?",
            })}
          </p>
          <p className="text-xs text-pap-muted mt-1 truncate" title={detect.data.path}>
            <code>{detect.data.path}</code>
          </p>
          {importCli.error && (
            <p className="text-xs text-pap-bad mt-2">
              {(importCli.error as Error).message}
            </p>
          )}
        </div>
        <button
          onClick={() => importCli.mutate()}
          disabled={importCli.isPending}
          className="px-3 py-1.5 rounded-md bg-pap-good text-pap-bg text-xs font-medium hover:bg-pap-good/85 disabled:opacity-50 shrink-0"
        >
          {importCli.isPending ? t("welcome.cli.importing") : t("welcome.cli.import")}
        </button>
      </div>
    </div>
  );
}

function Hero() {
  const { t } = useTranslation();
  return (
    <header className="text-center space-y-2">
      <div className="text-5xl">📓</div>
      <h1 className="text-2xl font-semibold tracking-tight">{t("welcome.title")}</h1>
      <p className="text-sm text-pap-muted leading-relaxed">
        <Trans
          i18nKey="welcome.intro"
          components={[<span className="text-pap-text" />]}
        />
      </p>
    </header>
  );
}

function LanguageRow() {
  const { i18n: i18nInst } = useTranslation();
  const current = (i18nInst.language?.slice(0, 2) ?? "en") as LangCode;
  return (
    <div className="mt-6 flex items-center justify-center gap-1 bg-pap-surface-2 rounded p-1 w-fit mx-auto">
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => {
            i18nInst.changeLanguage(l.code);
            try {
              localStorage.setItem("cartable-language", l.code);
            } catch {
              /* ignore */
            }
          }}
          className={clsx(
            "px-3 py-1 text-xs rounded transition-colors",
            current === l.code
              ? "bg-pap-accent text-pap-bg font-medium"
              : "text-pap-muted hover:text-pap-text hover:bg-pap-border/50",
          )}
        >
          {l.name}
        </button>
      ))}
    </div>
  );
}

function IntroChoices({ onPick }: { onPick: (s: Step) => void }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-3">
      <ChoiceCard
        onClick={() => onPick("qr")}
        emoji="📱"
        title={t("welcome.choice_qr")}
        subtitle={t("welcome.choice_qr_sub")}
        accent
      />
      <ChoiceCard
        onClick={() => onPick("manual")}
        emoji="⌨️"
        title={t("welcome.choice_manual")}
        subtitle={t("welcome.choice_manual_sub")}
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
  const { t } = useTranslation();
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
      <BackBar onBack={onBack} title={t("welcome.manual.title")} />
      <Field label={t("welcome.manual.url")}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          placeholder="https://0123456a.index-education.net/pronote/parent.html"
          className={inputCls}
        />
      </Field>
      <Field label={t("welcome.manual.auth_mode")}>
        <select value={mode} onChange={(e) => setMode(e.target.value)} className={inputCls}>
          <option value="password">{t("settings.account.form.auth_password")}</option>
          <option value="ent">{t("settings.account.form.auth_ent")}</option>
        </select>
      </Field>
      {mode === "ent" && (
        <Field label={t("welcome.manual.ent_provider")}>
          <input
            value={ent}
            onChange={(e) => setEnt(e.target.value)}
            placeholder={t("settings.account.form.ent_placeholder")}
            required
            className={inputCls}
          />
        </Field>
      )}
      <Field label={t("welcome.manual.username")}>
        <input value={user} onChange={(e) => setUser(e.target.value)} required className={inputCls} />
      </Field>
      <Field label={t("welcome.manual.password")}>
        <input
          type="password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          required
          className={inputCls}
        />
      </Field>
      <Field label={t("welcome.manual.child")}>
        <input
          value={child}
          onChange={(e) => setChild(e.target.value)}
          placeholder={t("settings.account.form.child_placeholder")}
          className={inputCls}
        />
      </Field>
      {save.error && <p className="text-pap-bad text-xs">{(save.error as Error).message}</p>}
      <div className="pt-2 flex gap-2 justify-end">
        <button type="button" onClick={onBack} className={btnGhost} disabled={save.isPending}>
          {t("common.back")}
        </button>
        <button type="submit" className={btnAccent} disabled={save.isPending}>
          {save.isPending ? t("common.saving") : t("common.connect")}
        </button>
      </div>
      <p className="text-xs text-pap-muted">
        <Trans i18nKey="welcome.manual.stored_locally" components={[<code />]} />
      </p>
    </form>
  );
}

// ---------- QR --------------------------------------------------------------

function QrLogin({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
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
      if (!result) throw new Error(t("welcome.qr.error_no_qr"));
      const parsed = JSON.parse(result.data);
      if (!parsed || typeof parsed !== "object" || !parsed.login || !parsed.jeton || !parsed.url) {
        throw new Error(t("welcome.qr.error_bad_payload"));
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
        throw new Error(t("welcome.qr.error_bad_payload"));
      }
      setQr(parsed);
    } catch (e: any) {
      setQrError(t("welcome.qr.error_bad_json", { error: e.message ?? e }));
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <BackBar onBack={onBack} title={t("welcome.qr.title")} />
      <ol className="text-xs text-pap-muted space-y-1 list-decimal pl-5">
        <li><Trans i18nKey="welcome.qr.step_1" components={[<strong />]} /></li>
        <li>{t("welcome.qr.step_2")}</li>
        <li>{t("welcome.qr.step_3")}</li>
      </ol>

      <div className="grid grid-cols-2 gap-3 mt-2">
        <div className="rounded-md border border-pap-border bg-pap-surface-2 p-3">
          <div className="text-xs font-semibold mb-2">{t("welcome.qr.from_screenshot")}</div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={btnGhost + " w-full"}
          >
            {t("welcome.qr.pick_image")}
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
          <div className="text-xs font-semibold mb-2">{t("welcome.qr.paste_json")}</div>
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
            {t("welcome.qr.use_json")}
          </button>
        </div>
      </div>

      {qrError && <p className="text-pap-bad text-xs">{qrError}</p>}

      {qr && (
        <div className="rounded-md border border-pap-good/40 bg-pap-good/10 p-3 text-xs">
          <div className="font-semibold text-pap-good">{t("welcome.qr.decoded")}</div>
          <div className="text-pap-muted mt-1 break-all">{t("welcome.qr.decoded_url", { url: qr.url })}</div>
          <div className="text-pap-muted">{t("welcome.qr.decoded_login", { login: qr.login })}</div>
        </div>
      )}

      <Field label={t("welcome.qr.pin_label")}>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          inputMode="numeric"
          pattern="\d{4}"
          placeholder={t("welcome.qr.pin_placeholder")}
          className={inputCls + " w-24 tracking-[0.5em] text-center"}
        />
      </Field>

      {login.error && <p className="text-pap-bad text-xs">{(login.error as Error).message}</p>}

      <div className="pt-1 flex gap-2 justify-end">
        <button type="button" onClick={onBack} className={btnGhost} disabled={login.isPending}>
          {t("common.back")}
        </button>
        <button
          type="button"
          onClick={() => qr && login.mutate({ qrData: qr, pin })}
          disabled={!qr || pin.length !== 4 || login.isPending}
          className={btnAccent}
        >
          {login.isPending ? t("welcome.qr.connecting") : t("common.connect")}
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
