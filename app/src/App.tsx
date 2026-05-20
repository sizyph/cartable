import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "./api";
import { Layout } from "./components/Layout";
import { ScheduleView } from "./components/ScheduleView";
import { HomeworkView } from "./components/HomeworkView";
import { GradesDashboard } from "./components/GradesDashboard";
import { LibraryView } from "./components/LibraryView";
import { DriveView } from "./components/DriveView";
import { ChatPanel } from "./components/ChatPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { WelcomeScreen } from "./components/WelcomeScreen";

type View = "schedule" | "homework" | "grades" | "library" | "drive" | "chat" | "settings";

function App() {
  const { t } = useTranslation();
  const [view, setView] = useState<View>("schedule");

  // Gate: if the backend has no usable .env, show the welcome flow.
  const account = useQuery({
    queryKey: ["settings", "account"],
    queryFn: api.settingsAccount,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });

  if (account.isLoading) {
    return <BootSplash label={t("boot.starting")} />;
  }
  if (account.error) {
    return <BootSplash label={t("boot.waiting_backend")} muted />;
  }
  if (!account.data?.is_configured) {
    return <WelcomeScreen />;
  }

  return (
    <Layout active={view} onChange={setView}>
      {view === "schedule" && <ScheduleView />}
      {view === "homework" && <HomeworkView />}
      {view === "grades" && <GradesDashboard />}
      {view === "library" && <LibraryView />}
      {view === "drive" && <DriveView />}
      {view === "chat" && <ChatPanel />}
      {view === "settings" && <SettingsPanel />}
    </Layout>
  );
}

function BootSplash({ label, muted }: { label: string; muted?: boolean }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-pap-bg">
      <div className="text-center space-y-2">
        <div className="text-3xl">📓</div>
        <p className={muted ? "text-pap-muted text-sm" : "text-pap-text"}>{label}</p>
      </div>
    </div>
  );
}

export default App;
