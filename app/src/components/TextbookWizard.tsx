import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import clsx from "clsx";

/**
 * A directory of common French publishers / online-reader platforms.
 * Each entry is *informational*: the user picks a publisher to start, then
 * customises title / URL. The "Ask Claude to find them" path actually does
 * the legwork — see below.
 */
const PUBLISHERS: { id: string; name: string; subjects: string[]; reader_hint: string }[] = [
  { id: "bordas",   name: "Bordas",                  subjects: ["MATHÉMATIQUES", "PHYSIQUE-CHIMIE", "FRANCAIS", "HISTOIRE-GEOGRAPHIE"], reader_hint: "Lib Manuels Bordas — usually calameo.com" },
  { id: "nathan",   name: "Nathan",                  subjects: ["MATHÉMATIQUES", "PHYSIQUE-CHIMIE", "ANGLAIS LV1", "ESPAGNOL LV2"],     reader_hint: "mesmanuels.fr (Nathan / Bordas)" },
  { id: "hachette", name: "Hachette",                subjects: ["MATHÉMATIQUES", "HISTOIRE-GEOGRAPHIE", "ANGLAIS LV1"],                  reader_hint: "Lib Manuels — biblio.manuel-numerique.com" },
  { id: "magnard",  name: "Magnard",                 subjects: ["MATHÉMATIQUES", "FRANCAIS", "HISTOIRE-GEOGRAPHIE"],                    reader_hint: "magnard.fr → Lib Manuels" },
  { id: "belin",    name: "Belin Éducation",         subjects: ["PHYSIQUE-CHIMIE", "SC. ECONO.& SOCIALES", "SCIENCES DE LA VIE ET DE LA TERRE"], reader_hint: "belin-education.com" },
  { id: "hatier",   name: "Hatier",                  subjects: ["FRANCAIS", "SC. ECONO.& SOCIALES", "ENSEIGN.SCIENTIFIQUE"],             reader_hint: "Hatier Lib Manuels" },
  { id: "delagrave",name: "Delagrave",               subjects: ["TECHNOLOGIE"],                                                          reader_hint: "delagrave.fr" },
  { id: "didier",   name: "Didier",                  subjects: ["ANGLAIS LV1", "ESPAGNOL LV2", "JAPONAIS LV2"],                          reader_hint: "didier-fle.com / éditions Didier" },
];

const COMMON_COLLECTIONS: Record<string, { name: string; publisher: string }[]> = {
  "MATHÉMATIQUES": [
    { name: "Déclic 1ère (Hachette)",     publisher: "hachette" },
    { name: "Indice 1ère (Bordas)",       publisher: "bordas" },
    { name: "Hyperbole 1ère (Nathan)",    publisher: "nathan" },
    { name: "Magnard Maths 1ère",         publisher: "magnard" },
    { name: "Maths Spé 1ère (Sésamath)",  publisher: "bordas" },
  ],
  "PHYSIQUE-CHIMIE": [
    { name: "Microméga (Hatier)",         publisher: "hatier" },
    { name: "Belin Physique-Chimie",      publisher: "belin" },
    { name: "Bordas Physique-Chimie",     publisher: "bordas" },
  ],
  "HISTOIRE-GEOGRAPHIE": [
    { name: "Histoire-Géo (Hachette)",    publisher: "hachette" },
    { name: "Histoire-Géo (Magnard)",     publisher: "magnard" },
  ],
  "FRANCAIS": [
    { name: "Français 1ère (Magnard)",    publisher: "magnard" },
    { name: "Français 1ère (Hatier)",     publisher: "hatier" },
  ],
  "SC. ECONO.& SOCIALES": [
    { name: "SES (Hatier)",               publisher: "hatier" },
    { name: "SES (Belin)",                publisher: "belin" },
  ],
};

export function TextbookWizard({
  onClose,
  onJumpToChat,
}: {
  onClose: () => void;
  onJumpToChat: (prompt: string) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const student = useQuery({ queryKey: ["health"], queryFn: api.health });
  const klass = student.data?.student?.class_name ?? "";
  const establishment = student.data?.student?.establishment ?? "";

  // Subjects the student actually has, pulled from the synced averages.
  const averages = useQuery({ queryKey: ["averages"], queryFn: () => api.averages() });
  const subjects = useMemo(() => {
    const list = (averages.data ?? [])
      .map((a) => a.subject_name)
      .filter((s): s is string => !!s);
    return [...new Set(list)];
  }, [averages.data]);

  const add = useMutation({
    mutationFn: api.libraryItemCreate,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library"] }),
  });

  function quickAdd(collection: { name: string; publisher: string }, subject: string) {
    const publisher = PUBLISHERS.find((p) => p.id === collection.publisher);
    add.mutate({
      title: collection.name,
      author: publisher?.name ?? "",
      subject,
      kind: "textbook",
      notes: publisher?.reader_hint ?? "",
    });
  }

  function aiSearch() {
    const lines = [
      `Find the textbooks (manuels scolaires) used this year for the student.`,
      klass ? `- Student class: ${klass}` : "",
      establishment ? `- School: ${establishment}` : "",
      subjects.length ? `- Subjects to cover: ${subjects.join(", ")}` : "",
      "",
      "Please:",
      "1. Use WebFetch / WebSearch to find the school's published booklist or recommended textbooks. Look on the school's website first; try queries like '<school name> manuels scolaires <class> <year>'.",
      "2. For each subject, identify the publisher + title + (if possible) an online reader URL (Lib Manuels, mesmanuels.fr, calameo, etc.).",
      "3. Output them in this exact JSON format so I can paste it back if needed, but also explain in plain words:",
      "",
      '```json',
      '[{"subject": "MATHÉMATIQUES", "title": "Declic 1ère", "publisher": "Hachette", "reader_url": "https://...", "notes": "..."}]',
      '```',
      "",
      "If you can't reach the school's website, suggest the most likely textbook per subject for a French 'Lycée français' at this level, with the publishers' canonical reader URLs.",
    ].filter(Boolean).join("\n");
    onJumpToChat(lines);
  }

  return (
    <div className="rounded-lg border border-pap-border bg-pap-surface p-5 space-y-5 text-sm">
      <header className="flex items-baseline justify-between">
        <div>
          <h2 className="font-semibold">{t("library.wizard.title")}</h2>
          <p className="text-xs text-pap-muted mt-1">
            {t("library.wizard.subtitle", {
              klass: klass || "—",
              establishment: establishment || "—",
            })}
          </p>
        </div>
        <button onClick={onClose} className="text-xs text-pap-muted hover:text-pap-text">
          ✕
        </button>
      </header>

      <section className="rounded-md border border-pap-accent/30 bg-pap-accent/5 p-4 space-y-2">
        <h3 className="text-sm font-semibold text-pap-accent">{t("library.wizard.ai_title")}</h3>
        <p className="text-xs text-pap-muted leading-relaxed">{t("library.wizard.ai_intro")}</p>
        <button
          onClick={aiSearch}
          className="px-3 py-1.5 rounded-md bg-pap-accent text-pap-bg text-xs font-medium hover:bg-pap-accent/85"
        >
          {t("library.wizard.ai_button")}
        </button>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t("library.wizard.quick_title")}</h3>
        <p className="text-xs text-pap-muted">{t("library.wizard.quick_intro")}</p>
        {Object.entries(COMMON_COLLECTIONS).map(([subject, collections]) => {
          const visible = subjects.length === 0 || subjects.some((s) =>
            s.toUpperCase().includes(subject.replace(/[É]/g, "E").toUpperCase()) ||
            subject.toUpperCase().includes(s.toUpperCase()),
          );
          if (!visible) return null;
          return (
            <div key={subject} className="rounded-md border border-pap-border bg-pap-surface-2 p-3">
              <div className="text-xs uppercase tracking-wide text-pap-muted mb-2">{subject}</div>
              <ul className="flex flex-wrap gap-2">
                {collections.map((c) => (
                  <li key={c.name}>
                    <button
                      onClick={() => quickAdd(c, subject)}
                      disabled={add.isPending}
                      className={clsx(
                        "px-2.5 py-1 text-xs rounded-md border",
                        "bg-pap-surface border-pap-border hover:bg-pap-border text-pap-text",
                        "disabled:opacity-50",
                      )}
                    >
                      + {c.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t("library.wizard.publishers_title")}</h3>
        <p className="text-xs text-pap-muted">{t("library.wizard.publishers_intro")}</p>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {PUBLISHERS.map((p) => (
            <li
              key={p.id}
              className="rounded-md border border-pap-border bg-pap-surface-2 px-3 py-2"
            >
              <div className="font-semibold text-xs">{p.name}</div>
              <div className="text-[11px] text-pap-muted">{p.reader_hint}</div>
              <div className="text-[10px] text-pap-muted/70 mt-1">{p.subjects.slice(0, 3).join(" · ")}{p.subjects.length > 3 ? "…" : ""}</div>
            </li>
          ))}
        </ul>
      </section>

      {add.error && <p className="text-pap-bad text-xs">{(add.error as Error).message}</p>}
    </div>
  );
}
