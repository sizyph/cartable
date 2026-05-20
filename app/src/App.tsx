import { useState } from "react";
import { Layout } from "./components/Layout";
import { ScheduleView } from "./components/ScheduleView";
import { HomeworkView } from "./components/HomeworkView";
import { GradesDashboard } from "./components/GradesDashboard";
import { ChatPanel } from "./components/ChatPanel";
import { SettingsPanel } from "./components/SettingsPanel";

type View = "schedule" | "homework" | "grades" | "chat" | "settings";

function App() {
  const [view, setView] = useState<View>("schedule");
  return (
    <Layout active={view} onChange={setView}>
      {view === "schedule" && <ScheduleView />}
      {view === "homework" && <HomeworkView />}
      {view === "grades" && <GradesDashboard />}
      {view === "chat" && <ChatPanel />}
      {view === "settings" && <SettingsPanel />}
    </Layout>
  );
}

export default App;
