/**
 * BacklogTable — TanStack React Table for task-level backlog view.
 *
 * Columns: Task Name, Quest (parent), Status, Assignee, Role, Created, Updated.
 * Features: sortable columns, pagination, column resizing, row selection.
 * Styled with design system tokens for dark theme consistency.
 */

import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type RowSelectionState,
  type ColumnResizeMode,
} from '@tanstack/react-table';
import { Badge } from './ui/Badge';
import type { TaskStatus, BacklogTask } from '../types';

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const TASK_STATUS_CONFIG: Record<TaskStatus, { dot: string; label: string }> = {
  pending:          { dot: 'bg-text-tertiary', label: 'Pending' },
  in_progress:      { dot: 'bg-blue',         label: 'Active' },
  pending_approval: { dot: 'bg-yellow',       label: 'Review' },
  completed:        { dot: 'bg-green',         label: 'Done' },
  failed:           { dot: 'bg-red',           label: 'Failed' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return '—'; }
}

function agentInitial(name: string): string {
  const short = name.replace(/^agent-/i, '');
  return (short.charAt(0) || name.charAt(0)).toUpperCase();
}

function hashHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const col = createColumnHelper<BacklogTask>();

function buildColumns() {
  return [
    // Row selection checkbox
    col.display({
      id: 'select',
      size: 40,
      enableResizing: false,
      header: ({ table }) => (
        <input
          type="checkbox"
          className="accent-blue cursor-pointer"
          checked={table.getIsAllPageRowsSelected()}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          className="accent-blue cursor-pointer"
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
        />
      ),
    }),

    col.accessor('name', {
      header: 'Task',
      size: 260,
      cell: (info) => (
        <span className="text-text-primary font-medium truncate block">
          {info.getValue()}
        </span>
      ),
    }),

    col.accessor('questName', {
      header: 'Quest',
      size: 180,
      cell: (info) => (
        <span
          className="text-text-secondary text-[0.8rem] truncate block hover:text-blue cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            const questId = info.row.original.questId;
            if (questId) window.location.href = `/quests/${questId}`;
          }}
          title={info.getValue()}
        >
          {info.getValue()}
        </span>
      ),
    }),

    col.accessor('status', {
      header: 'Status',
      size: 100,
      cell: (info) => {
        const cfg = TASK_STATUS_CONFIG[info.getValue()] ?? { dot: 'bg-text-tertiary', label: info.getValue() };
        return <Badge dot={cfg.dot}>{cfg.label}</Badge>;
      },
    }),

    col.accessor('assignedAgent', {
      header: 'Assignee',
      size: 110,
      cell: (info) => {
        const agent = info.getValue();
        if (!agent) return <span className="text-text-tertiary">—</span>;
        return (
          <div className="flex items-center gap-1.5">
            <span
              title={agent}
              className="w-5 h-5 rounded-full flex items-center justify-center text-[0.5rem] font-bold text-white shrink-0"
              style={{ backgroundColor: `hsl(${hashHue(agent)}, 55%, 45%)` }}
            >
              {agentInitial(agent)}
            </span>
            <span className="text-text-secondary text-[0.8rem] truncate">
              {agent.replace(/^agent-/i, '')}
            </span>
          </div>
        );
      },
    }),

    col.accessor('role', {
      header: 'Role',
      size: 100,
      cell: (info) => {
        const role = info.getValue();
        if (!role) return <span className="text-text-tertiary">—</span>;
        return (
          <span className="px-1.5 py-0.5 rounded bg-bg-elevated text-[0.7rem] text-text-secondary capitalize">
            {role}
          </span>
        );
      },
    }),

    col.accessor((row) => row.createdAt || row.startedAt, {
      id: 'created',
      header: 'Created',
      size: 140,
      cell: (info) => (
        <span className="text-[0.75rem] text-text-tertiary">{formatDate(info.getValue())}</span>
      ),
    }),

    col.accessor((row) => row.updatedAt || row.completedAt, {
      id: 'updated',
      header: 'Updated',
      size: 140,
      cell: (info) => (
        <span className="text-[0.75rem] text-text-tertiary">{formatDate(info.getValue())}</span>
      ),
    }),
  ];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface BacklogTableProps {
  data: BacklogTask[];
  className?: string;
}

export function BacklogTable({ data, className = '' }: BacklogTableProps) {
  const navigate = useNavigate();
  const columns = useMemo(() => buildColumns(), []);

  const [sorting, setSorting] = useState<SortingState>([
    { id: 'updated', desc: true },
  ]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnResizeMode] = useState<ColumnResizeMode>('onChange');

  const table = useReactTable({
    data,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    columnResizeMode,
    enableRowSelection: true,
    initialState: { pagination: { pageSize: 25 } },
  });

  const selectedCount = Object.keys(rowSelection).length;

  return (
    <div className={className}>
      {/* Selection bar */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-3 mb-3 px-3 py-2 rounded-lg bg-blue/10 border border-blue/20 text-sm text-text-secondary">
          <span className="font-mono text-blue">{selectedCount}</span> selected
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-border bg-bg-card">
        <table className="w-full border-collapse" style={{ width: table.getCenterTotalSize() }}>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border">
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    className="relative px-3 py-2.5 text-left text-[0.7rem] font-medium uppercase tracking-wider text-text-tertiary select-none"
                    style={{ width: header.getSize() }}
                  >
                    {header.isPlaceholder ? null : (
                      <div
                        className={`flex items-center gap-1 ${
                          header.column.getCanSort() ? 'cursor-pointer hover:text-text-secondary' : ''
                        }`}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === 'asc' && <span>↑</span>}
                        {header.column.getIsSorted() === 'desc' && <span>↓</span>}
                      </div>
                    )}

                    {/* Resize handle */}
                    {header.column.getCanResize() && (
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue/40 active:bg-blue/60"
                      />
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-12 text-center text-text-tertiary text-sm"
                >
                  No tasks found
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border/50 hover:bg-bg-elevated/40 transition-colors cursor-pointer"
                  onClick={() => navigate(`/quests/${row.original.questId}`)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="px-3 py-2.5"
                      style={{ width: cell.column.getSize() }}
                      onClick={cell.column.id === 'select' ? (e) => e.stopPropagation() : undefined}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-3 px-1 text-sm text-text-tertiary">
        <span>
          Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
          {' · '}{data.length} total
        </span>
        <div className="flex items-center gap-2">
          <button
            className="px-2.5 py-1 rounded-md border border-border hover:bg-bg-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Prev
          </button>
          <button
            className="px-2.5 py-1 rounded-md border border-border hover:bg-bg-elevated disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
