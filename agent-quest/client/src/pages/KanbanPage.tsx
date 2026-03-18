/**
 * KanbanPage — Page wrapper for the KanbanBoard component.
 */

import { KanbanBoard } from '../components/KanbanBoard';

export function KanbanPage() {
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
