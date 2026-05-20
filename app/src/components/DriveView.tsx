import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, DriveFile } from "../api";
import { format, parseISO } from "date-fns";
import { dateFnsLocale } from "../i18n";
import clsx from "clsx";

export function DriveView() {
  const { t } = useTranslation();
  const status = useQuery({ queryKey: ["drive", "status"], queryFn: api.driveStatus });

  if (!status.data) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold tracking-tight mb-2">{t("drive.title")}</h1>
        <p className="text-pap-muted">{t("common.loading")}</p>
      </div>
    );
  }

  const s = status.data;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("drive.title")}</h1>
          <p className="text-sm text-pap-muted">{t("drive.subtitle")}</p>
        </div>
      </header>

      {!s.has_credentials ? (
        <SetupNeeded credentialsPath={s.credentials_path} />
      ) : !s.has_token || !s.scopes_ok ? (
        <AuthorizeStep haveOldToken={s.has_token && !s.scopes_ok} />
      ) : !s.root_folder_id ? (
        <PickRootFolder />
      ) : (
        <Browser
          rootId={s.root_folder_id}
          rootName={s.root_folder_name ?? s.root_folder_id}
        />
      )}
    </div>
  );
}

function SetupNeeded({ credentialsPath }: { credentialsPath: string }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-pap-border bg-pap-surface p-6 text-sm space-y-3">
      <h2 className="font-semibold">{t("drive.setup_title")}</h2>
      <p className="text-pap-muted leading-relaxed">{t("drive.setup_intro")}</p>
      <code className="block bg-pap-surface-2 px-3 py-2 rounded text-pap-text text-xs break-all">
        {credentialsPath}
      </code>
      <p className="text-xs text-pap-muted">{t("drive.setup_outro")}</p>
    </div>
  );
}

function AuthorizeStep({ haveOldToken }: { haveOldToken: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const authorize = useMutation({
    mutationFn: api.driveAuthorize,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["drive"] }),
  });

  return (
    <div className="rounded-lg border border-pap-border bg-pap-surface p-6 text-sm space-y-3">
      <h2 className="font-semibold">
        {haveOldToken ? t("drive.reauth_title") : t("drive.connect_title")}
      </h2>
      <p className="text-pap-muted leading-relaxed">
        {haveOldToken ? t("drive.reauth_intro") : t("drive.connect_intro")}
      </p>
      <button
        onClick={() => authorize.mutate()}
        disabled={authorize.isPending}
        className="px-4 py-1.5 rounded-md bg-pap-accent text-pap-bg text-sm font-medium hover:bg-pap-accent/85 disabled:opacity-50"
      >
        {authorize.isPending ? t("drive.opening_browser") : t("drive.connect_button")}
      </button>
      {authorize.error && (
        <p className="text-pap-bad text-xs">{(authorize.error as Error).message}</p>
      )}
    </div>
  );
}

function PickRootFolder() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [folderId, setFolderId] = useState("");
  const setRoot = useMutation({
    mutationFn: () => api.driveSetRoot(folderId.trim()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["drive"] }),
  });

  return (
    <form
      className="rounded-lg border border-pap-border bg-pap-surface p-6 text-sm space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setRoot.mutate();
      }}
    >
      <h2 className="font-semibold">{t("drive.root_title")}</h2>
      <p className="text-pap-muted leading-relaxed text-xs">{t("drive.root_intro")}</p>
      <div className="flex gap-2">
        <input
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
          placeholder="1AbCdEfGhIjKlMnOpQrStUvWxYz"
          className="flex-1 bg-pap-bg border border-pap-border rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-pap-accent"
          required
        />
        <button
          type="submit"
          disabled={setRoot.isPending}
          className="px-4 py-1.5 rounded-md bg-pap-accent text-pap-bg text-sm font-medium hover:bg-pap-accent/85 disabled:opacity-50"
        >
          {setRoot.isPending ? t("common.saving") : t("drive.root_save")}
        </button>
      </div>
      {setRoot.error && (
        <p className="text-pap-bad text-xs">{(setRoot.error as Error).message}</p>
      )}
    </form>
  );
}

function Browser({ rootId, rootName }: { rootId: string; rootName: string }) {
  const { t } = useTranslation();
  const locale = dateFnsLocale();
  const [stack, setStack] = useState<{ id: string; name: string }[]>([{ id: rootId, name: rootName }]);
  const [search, setSearch] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const current = stack[stack.length - 1];

  const folder = useQuery({
    queryKey: ["drive", "list", current.id],
    queryFn: () => api.driveList(current.id),
    enabled: !searchActive,
  });
  const searched = useQuery({
    queryKey: ["drive", "search", search],
    queryFn: () => api.driveSearch(search),
    enabled: searchActive && search.length > 1,
  });

  const upload = useMutation({
    mutationFn: api.driveUploadBackup,
  });

  const items = searchActive ? searched.data?.items ?? [] : folder.data?.items ?? [];

  function enter(item: DriveFile) {
    if (item.is_folder) {
      setStack((s) => [...s, { id: item.id, name: item.name }]);
      setSearchActive(false);
      setSearch("");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Crumbs stack={stack} onJump={(i) => setStack((s) => s.slice(0, i + 1))} />
        <div className="ml-auto flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSearchActive(e.target.value.length > 1);
            }}
            placeholder={t("drive.search_placeholder")}
            className="bg-pap-bg border border-pap-border rounded px-3 py-1 text-sm focus:outline-none focus:border-pap-accent"
          />
          <button
            onClick={() => upload.mutate()}
            disabled={upload.isPending}
            className="px-3 py-1.5 rounded-md bg-pap-accent text-pap-bg text-sm font-medium hover:bg-pap-accent/85 disabled:opacity-50"
            title={t("drive.upload_backup_hint")}
          >
            {upload.isPending ? t("drive.uploading") : t("drive.upload_backup")}
          </button>
        </div>
      </div>

      {upload.data && (
        <div className="rounded-md border border-pap-good/40 bg-pap-good/10 p-3 text-xs flex items-center gap-2">
          <span className="text-pap-good font-medium">
            {t("drive.upload_done", { name: upload.data.name })}
          </span>
          {upload.data.web_view_link && (
            <a
              href={upload.data.web_view_link}
              target="_blank"
              rel="noreferrer"
              className="text-pap-accent underline"
            >
              {t("drive.open_in_drive")} ↗
            </a>
          )}
        </div>
      )}
      {upload.error && (
        <p className="text-pap-bad text-xs">{(upload.error as Error).message}</p>
      )}

      {(folder.isLoading && !searchActive) || (searched.isLoading && searchActive) ? (
        <p className="text-pap-muted text-sm">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-pap-muted text-sm italic">{searchActive ? t("drive.no_results") : t("drive.empty_folder")}</p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {items.map((it) => (
            <Row key={it.id} item={it} onOpen={() => enter(it)} locale={locale} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Crumbs({
  stack,
  onJump,
}: {
  stack: { id: string; name: string }[];
  onJump: (i: number) => void;
}) {
  return (
    <nav className="text-sm text-pap-muted flex items-center gap-1 flex-wrap">
      {stack.map((c, i) => (
        <span key={c.id} className="flex items-center gap-1">
          {i > 0 && <span className="opacity-50">/</span>}
          <button
            type="button"
            onClick={() => onJump(i)}
            className={clsx(
              "hover:text-pap-text",
              i === stack.length - 1 && "text-pap-text font-medium",
            )}
          >
            {c.name}
          </button>
        </span>
      ))}
    </nav>
  );
}

function Row({
  item,
  onOpen,
  locale,
}: {
  item: DriveFile;
  onOpen: () => void;
  locale: any;
}) {
  const { t } = useTranslation();
  return (
    <li className="rounded-md border border-pap-border bg-pap-surface p-3 flex items-center gap-3">
      <span className="text-2xl shrink-0">{item.is_folder ? "📁" : iconFor(item.mimeType)}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate" title={item.name}>{item.name}</div>
        <div className="text-xs text-pap-muted truncate">
          {item.modifiedTime && (
            <>{format(parseISO(item.modifiedTime), "d MMM yyyy HH:mm", { locale })}</>
          )}
          {item.size && <> · {formatSize(item.size)}</>}
        </div>
      </div>
      {item.is_folder ? (
        <button
          onClick={onOpen}
          className="px-3 py-1 text-xs rounded bg-pap-surface-2 text-pap-text hover:bg-pap-border"
        >
          {t("drive.open_folder")}
        </button>
      ) : (
        item.webViewLink && (
          <a
            href={item.webViewLink}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1 text-xs rounded bg-pap-accent text-pap-bg font-medium hover:bg-pap-accent/85"
          >
            {t("drive.open")}
          </a>
        )
      )}
    </li>
  );
}

function iconFor(mime: string): string {
  if (mime.includes("pdf")) return "📕";
  if (mime.includes("image")) return "🖼️";
  if (mime.includes("video")) return "🎬";
  if (mime.includes("audio")) return "🎵";
  if (mime.includes("spreadsheet")) return "📊";
  if (mime.includes("presentation")) return "📽️";
  if (mime.includes("document")) return "📝";
  return "📄";
}

function formatSize(bytes: string | number): string {
  const n = typeof bytes === "string" ? Number(bytes) : bytes;
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
