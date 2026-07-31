import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { AuditSelectionProvider } from "./lib/AuditSelectionContext";
import { CurrentPageCheckPage } from "./pages/CurrentPageCheckPage";
import { DashboardPage } from "./pages/DashboardPage";
import { IssuesPage } from "./pages/IssuesPage";
import { NewAuditPage } from "./pages/NewAuditPage";
import { PagesPage } from "./pages/PagesPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ReportPage } from "./pages/ReportPage";
import { SettingsPage } from "./pages/SettingsPage";

export default function App() {
  return (
    <HashRouter>
      <AuditSelectionProvider>
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="min-h-screen flex-1 overflow-y-auto p-6 lg:p-8">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/audits/new" element={<NewAuditPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/projects/:projectId" element={<ProjectsPage />} />
              <Route path="/issues" element={<IssuesPage />} />
              <Route path="/pages" element={<PagesPage />} />
              <Route path="/report" element={<ReportPage />} />
              <Route path="/current-page" element={<CurrentPageCheckPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </AuditSelectionProvider>
    </HashRouter>
  );
}
