/**
 * Main App component with routing
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Navigation } from './components/Navigation';
import { QuestListPage } from './pages/QuestListPage';
import { QuestDetailPage } from './pages/QuestDetailPage';
import { TaskDetailPage } from './pages/TaskDetailPage';
import { AgentMonitorPage } from './pages/AgentMonitorPage';

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <Routes>
          <Route path="/" element={<QuestListPage />} />
          <Route path="/quests" element={<QuestListPage />} />
          <Route path="/quests/:questId" element={<QuestDetailPage />} />
          <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="/agents" element={<AgentMonitorPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
