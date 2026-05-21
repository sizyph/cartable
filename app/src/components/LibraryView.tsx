import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, LibraryItem, LibraryItemInput } from "../api";
import { TextbookWizard } from "./TextbookWizard";
import clsx from "clsx";

type Filter = "all" | "textbook" | "companion" | "reference";

export function LibraryView({ onJumpToChat }: { onJumpToChat?: (prompt: string) => void }) {
  const { t } = useTranslation();
  const items = useQuery({ queryKey: ["library", "items"], queryFn: api.libraryItems });
  const files = useQuery({ queryKey: ["library", "files"], queryFn: api.libraryFiles });
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<LibraryItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const combined = useMemo<LibraryItem[]>(() => {
    const manual = items.data ?? [];
    const local = files.data?.items ?? [];
    // Hide auto-discovered files that already have a manual entry pointing at the same file.
    const pinned = new Set(manual.map((m) => m.file_path).filter(Boolean));
    const filtered = filter === "all"
      ? [...manual, ...local.filter((l) => !pinned.has(l.file_path))]
      : [...manual, ...local.filter((l) => !pinned.has(l.file_path))].filter((i) => i.kind === filter);
    return filtered.sort((a, b) => (b.added_at || "").localeCompare(a.added_at || ""));
  }, [items.data, files.data, filter]);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("library.title")}</h1>
          <p className="text-sm text-pap-muted">
            {t("library.subtitle")} ·{" "}
            <code className="text-xs">{files.data?.dir ?? ""}</code>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 bg-pap-surface rounded-md p-1">
            {(["all", "textbook", "companion", "reference"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={clsx(
                  "px-3 py-1 text-sm rounded transition-colors",
                  filter === k
                    ? "bg-pap-surface-2 text-pap-text"
                    : "text-pap-muted hover:text-pap-text hover:bg-pap-surface-2/60",
                )}
              >
                {t(`library.filter.${k}`)}
              </button>
            ))}
          </div>
          <button
            onClick={() => setWizardOpen(true)}
            className="px-3 py-1.5 rounded-md bg-pap-surface border border-pap-border text-pap-text text-sm hover:bg-pap-surface-2"
          >
            📚 {t("library.suggest")}
          </button>
          <button
            onClick={() => {
              setCreating(true);
              setEditing(null);
            }}
            className="px-3 py-1.5 rounded-md bg-pap-accent text-pap-bg text-sm font-medium hover:bg-pap-accent/85"
          >
            {t("library.add")}
          </button>
        </div>
      </header>

      {wizardOpen && (
        <div className="mb-6">
          <TextbookWizard
            onClose={() => setWizardOpen(false)}
            onJumpToChat={(p) => {
              setWizardOpen(false);
              onJumpToChat?.(p);
            }}
          />
        </div>
      )}

      {(creating || editing) && (
        <div className="mb-6">
          <ItemForm
            initial={editing}
            onCancel={() => {
              setCreating(false);
              setEditing(null);
            }}
            onSaved={() => {
              setCreating(false);
              setEditing(null);
            }}
          />
        </div>
      )}

      {items.isLoading || files.isLoading ? (
        <p className="text-pap-muted">{t("common.loading")}</p>
      ) : combined.length === 0 ? (
        <EmptyHint />
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {combined.map((it) => (
            <Card key={it.id} item={it} onEdit={() => setEditing(it)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyHint() {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-dashed border-pap-border p-8 text-center text-sm text-pap-muted">
      <p className="mb-2">{t("library.empty")}</p>
      <p className="text-xs leading-relaxed">{t("library.empty_hint")}</p>
    </div>
  );
}

function Card({ item, onEdit }: { item: LibraryItem; onEdit: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isManual = item.source === "manual";
  const numericId = isManual ? Number(item.id.replace("manual:", "")) : null;
  const del = useMutation({
    mutationFn: () => api.libraryItemDelete(numericId!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library"] }),
  });

  const openHref = item.url
    ? item.url
    : item.file_path
    ? api.libraryFileUrl(item.file_path)
    : null;

  return (
    <li className="rounded-lg border border-pap-border bg-pap-surface p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate" title={item.title}>{item.title}</div>
          {item.author && <div className="text-xs text-pap-muted truncate">{item.author}</div>}
        </div>
        <span
          className={clsx(
            "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0",
            item.kind === "textbook" && "bg-pap-accent/20 text-pap-accent",
            item.kind === "companion" && "bg-pap-good/20 text-pap-good",
            item.kind === "reference" && "bg-pap-surface-2 text-pap-muted",
          )}
        >
          {t(`library.kind.${item.kind}`)}
        </span>
      </div>
      {item.subject && (
        <div className="text-xs text-pap-muted">{item.subject}</div>
      )}
      {item.notes && (
        <p className="text-xs text-pap-muted whitespace-pre-wrap line-clamp-4">{item.notes}</p>
      )}
      <div className="text-[10px] text-pap-muted/60 truncate" title={item.file_path ?? item.url ?? ""}>
        {item.source === "file" ? `data/library/${item.file_path}` : item.url ?? item.file_path}
      </div>
      <div className="mt-auto flex items-center gap-2">
        {openHref && (
          <a
            href={openHref}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1 text-xs rounded bg-pap-accent text-pap-bg font-medium hover:bg-pap-accent/85"
          >
            {t("library.open")}
          </a>
        )}
        {isManual && (
          <>
            <button
              onClick={onEdit}
              className="px-3 py-1 text-xs rounded bg-pap-surface-2 text-pap-text hover:bg-pap-border"
            >
              {t("library.edit")}
            </button>
            <button
              onClick={() => {
                if (confirm(t("library.delete_confirm", { title: item.title }))) {
                  del.mutate();
                }
              }}
              disabled={del.isPending}
              className="px-3 py-1 text-xs rounded bg-pap-bad/20 text-pap-bad border border-pap-bad/40 hover:bg-pap-bad/30 disabled:opacity-50"
            >
              {t("library.delete")}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function ItemForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial: LibraryItem | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const numericId = initial ? Number(initial.id.replace("manual:", "")) : null;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [author, setAuthor] = useState(initial?.author ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [kind, setKind] = useState<LibraryItem["kind"]>(initial?.kind ?? "reference");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [filePath, setFilePath] = useState(initial?.file_path ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const save = useMutation({
    mutationFn: (body: LibraryItemInput) =>
      numericId ? api.libraryItemUpdate(numericId, body) : api.libraryItemCreate(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["library"] });
      onSaved();
    },
  });

  return (
    <form
      className="rounded-lg border border-pap-border bg-pap-surface p-5 space-y-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          title,
          author: author || undefined,
          subject: subject || undefined,
          kind,
          url: url || undefined,
          file_path: filePath || undefined,
          notes: notes || undefined,
        });
      }}
    >
      <h2 className="font-semibold text-sm">
        {initial ? t("library.form.edit_title") : t("library.form.create_title")}
      </h2>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("library.form.title")}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required className={inputCls} />
        </Field>
        <Field label={t("library.form.author")}>
          <input value={author ?? ""} onChange={(e) => setAuthor(e.target.value)} className={inputCls} />
        </Field>
        <Field label={t("library.form.subject")}>
          <input value={subject ?? ""} onChange={(e) => setSubject(e.target.value)} placeholder="MATHEMATIQUES" className={inputCls} />
        </Field>
        <Field label={t("library.form.kind")}>
          <select value={kind} onChange={(e) => setKind(e.target.value as LibraryItem["kind"])} className={inputCls}>
            <option value="textbook">{t("library.kind.textbook")}</option>
            <option value="companion">{t("library.kind.companion")}</option>
            <option value="reference">{t("library.kind.reference")}</option>
          </select>
        </Field>
        <Field label={t("library.form.url")}>
          <input value={url ?? ""} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={inputCls} />
        </Field>
        <Field label={t("library.form.file_path")}>
          <input
            value={filePath ?? ""}
            onChange={(e) => setFilePath(e.target.value)}
            placeholder="maths/manuel-1ere.pdf"
            className={inputCls}
          />
        </Field>
      </div>
      <Field label={t("library.form.notes")}>
        <textarea
          value={notes ?? ""}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className={inputCls}
        />
      </Field>
      {save.error && <p className="text-pap-bad text-xs">{(save.error as Error).message}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className={btnGhost} disabled={save.isPending}>
          {t("common.cancel")}
        </button>
        <button type="submit" className={btnAccent} disabled={save.isPending}>
          {save.isPending ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </form>
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
