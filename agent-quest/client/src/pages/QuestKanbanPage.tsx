/**
 * QuestKanbanPage — Quest-level kanban board.
 *
 * Columns: Backlog → In Progress → Pending Approval → Completed
 * Renamed from KanbanPage to distinguish from TaskKanbanPage.
 */

import { KanbanBoard } from '../components/KanbanBoard';

import { useEffect } from 'react';

export function QuestKanbanPage() {
  // Remove constraints for full-width kanban board
  useEffect(() => {
    const pageShell = document.querySelector('.reveal');
    if (pageShell) {
      pageShell.classList.remove('max-w-[1100px]', 'px-8', 'max-md:px-6');
      pageShell.classList.add('max-w-full', 'px-4');
    }
    return () => {
      const pageShell = document.querySelector('.reveal');
      if (pageShell) {
        pageShell.classList.remove('max-w-full', 'px-4');
        pageShell.classList.add('max-w-[1100px]', 'px-8', 'max-md:px-6');
      }
    };
  }, []);

  return (
    <>
      <div className="mb-8">
        <p className="font-mono text-[0.65rem] tracking-[0.15em] uppercase text-blue mb-3">
          Workflow
        </p>
        <h1 className="text-[2.5rem] font-semibold tracking-tight text-text-primary mb-2">
          Quest Board
        </h1>
        <p className="text-[0.9rem] font-light leading-relaxed text-text-secondary">
          Drag quests between columns to update their status
        </p>
      </div>

      <KanbanBoard />
    </>
  );
}
