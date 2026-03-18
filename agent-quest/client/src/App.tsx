/**
 * Main App component with routing and layout shell.
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Navigation } from './components/Navigation';
import { ConnectionStatus } from './components/ConnectionStatus';
import { PageShell } from './components/PageShell';
import { ObserverProvider } from './contexts/ObserverContext';
import { QuestDetailPage } from './pages/QuestDetailPage';
import { TaskDetailPage } from './pages/TaskDetailPage';
import { AgentMonitorPage } from './pages/AgentMonitorPage';
import { QuestKanbanPage } from './pages/QuestKanbanPage';
import { TaskKanbanPage } from './pages/TaskKanbanPage';
import { BacklogPage } from './pages/BacklogPage';
import { NetworkPage } from './pages/NetworkPage';
import { ToolPlaygroundPage } from './pages/ToolPlaygroundPage';
import { EventsPage } from './pages/EventsPage';
import DashboardPage from './pages/DashboardPage';
import { LogsPage } from './pages/LogsPage';

function App() {
  return (
    <BrowserRouter>
      <ObserverProvider>
        <div className="min-h-screen bg-bg pb-10">
          <Navigation />
          <PageShell>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/quests/:questId" element={<QuestDetailPage />} />
              <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
              <Route path="/board/quests" element={<QuestKanbanPage />} />
              <Route path="/board/tasks" element={<TaskKanbanPage />} />
              <Route path="/board" element={<QuestKanbanPage />} />
              <Route path="/backlog" element={<BacklogPage />} />
              <Route path="/network" element={<NetworkPage />} />
              <Route path="/tools" element={<ToolPlaygroundPage />} />
              <Route path="/events" element={<EventsPage />} />
              <Route path="/agents" element={<AgentMonitorPage />} />
              <Route path="/logs" element={<LogsPage />} />
            </Routes>
          </PageShell>
          <ConnectionStatus />
        </div>
      </ObserverProvider>
    </BrowserRouter>
  );
}

export default App;
