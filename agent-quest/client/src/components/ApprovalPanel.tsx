/**
 * ApprovalPanel — Reusable approval/revision/rejection panel.
 * Used in both QuestDetailPage (quest-level) and TaskDetailPage (task-level).
 *
 * Renders inline approve/revise/reject buttons with an expandable
 * comment textarea. Includes confirmation dialog for destructive actions.
 */

import { useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ApprovalDecision = 'approved' | 'revision_requested' | 'rejected';

interface ApprovalPanelProps {
  /** Entity type label shown in UI text */
  entityType: 'quest' | 'task';
  /** Callback to execute the decision. Receives decision + optional feedback. */
  onSubmit: (decision: ApprovalDecision, feedback?: string) => Promise<void>;
  /** Optional: hide the panel (e.g., when status is not pending_approval) */
  hidden?: boolean;
}

// ---------------------------------------------------------------------------
// Decision metadata
// ---------------------------------------------------------------------------

const DECISION_CONFIG: Record<
  ApprovalDecision,
  {
    label: string;
    description: string;
    buttonClass: string;
    radioClass: string;
    feedbackRequired: boolean;
    feedbackLabel: string;
    feedbackPlaceholder: string;
  }
> = {
  approved: {
    label: 'Approve',
    description: 'Meets requirements and can proceed',
    buttonClass: 'bg-green-600 text-white hover:bg-green-700',
    radioClass: 'text-green-600 focus:ring-green-500',
    feedbackRequired: false,
    feedbackLabel: 'Comments (Optional)',
    feedbackPlaceholder: 'Add any comments or notes about this approval...',
  },
  revision_requested: {
    label: 'Request Revision',
    description: 'Needs changes before it can be approved',
    buttonClass: 'bg-yellow-600 text-white hover:bg-yellow-700',
    radioClass: 'text-yellow-600 focus:ring-yellow-500',
    feedbackRequired: true,
    feedbackLabel: 'Revision Feedback',
    feedbackPlaceholder: 'Provide detailed feedback on what needs to be changed...',
  },
  rejected: {
    label: 'Reject',
    description: 'Not viable and should be cancelled',
    buttonClass: 'bg-red-600 text-white hover:bg-red-700',
    radioClass: 'text-red-600 focus:ring-red-500',
    feedbackRequired: true,
    feedbackLabel: 'Rejection Reason',
    feedbackPlaceholder: 'Explain why this is being rejected...',
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ApprovalPanel({ entityType, onSubmit, hidden }: ApprovalPanelProps) {
  const [decision, setDecision] = useState<ApprovalDecision>('approved');
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);

  if (hidden) return null;

  const config = DECISION_CONFIG[decision];

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const validate = (): boolean => {
    setValidationError(null);
    if (config.feedbackRequired && !feedback.trim()) {
      setValidationError(`${config.feedbackLabel} is required`);
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    // Confirmation gate for rejection
    if (decision === 'rejected' && !showRejectConfirm) {
      setShowRejectConfirm(true);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await onSubmit(decision, feedback.trim() || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit decision');
      setShowRejectConfirm(false);
    } finally {
      setLoading(false);
    }
  };

  const handleDecisionChange = (d: ApprovalDecision) => {
    setDecision(d);
    setValidationError(null);
    setShowRejectConfirm(false);
  };

  // -----------------------------------------------------------------------
  // Rejection confirmation overlay
  // -----------------------------------------------------------------------

  if (showRejectConfirm) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
          <h3 className="text-xl font-semibold text-gray-900 mb-4">
            Confirm Rejection
          </h3>
          <p className="text-gray-700 mb-6">
            Are you sure you want to reject this {entityType}? This action cannot be undone.
          </p>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <p className="text-sm text-yellow-800">
              <span className="font-medium">Your reason:</span> {feedback}
            </p>
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setShowRejectConfirm(false)}
              disabled={loading}
              className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 flex items-center gap-2"
            >
              {loading && (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              )}
              Confirm Rejection
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Main panel
  // -----------------------------------------------------------------------

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-xl font-semibold text-gray-900 mb-6">
        Submit Approval Decision
      </h3>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {/* Decision radio buttons */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Decision <span className="text-red-500">*</span>
        </label>
        <div className="space-y-3">
          {(Object.keys(DECISION_CONFIG) as ApprovalDecision[]).map((key) => {
            const cfg = DECISION_CONFIG[key];
            return (
              <label
                key={key}
                className="flex items-center p-4 border-2 rounded-lg cursor-pointer transition-colors hover:bg-gray-50"
              >
                <input
                  type="radio"
                  name="approval-decision"
                  value={key}
                  checked={decision === key}
                  onChange={() => handleDecisionChange(key)}
                  className={`w-4 h-4 ${cfg.radioClass}`}
                />
                <div className="ml-3">
                  <div className="text-sm font-medium text-gray-900">
                    {cfg.label}
                  </div>
                  <div className="text-sm text-gray-500">
                    {cfg.description}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* Feedback textarea */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {config.feedbackLabel}
          {config.feedbackRequired && (
            <span className="text-red-500"> *</span>
          )}
        </label>
        <textarea
          value={feedback}
          onChange={(e) => {
            setFeedback(e.target.value);
            setValidationError(null);
          }}
          placeholder={config.feedbackPlaceholder}
          rows={config.feedbackRequired ? 6 : 3}
          className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 resize-none ${
            validationError
              ? 'border-red-300 focus:ring-red-500'
              : 'border-gray-300 focus:ring-blue-500'
          }`}
        />
        {validationError && (
          <p className="mt-2 text-sm text-red-600">{validationError}</p>
        )}
      </div>

      {/* Submit button */}
      <div className="flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={loading}
          className={`px-6 py-2 rounded-lg transition-colors font-medium disabled:opacity-50 flex items-center gap-2 ${config.buttonClass}`}
        >
          {loading && (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
          )}
          {config.label} {entityType.charAt(0).toUpperCase() + entityType.slice(1)}
        </button>
      </div>
    </div>
  );
}
