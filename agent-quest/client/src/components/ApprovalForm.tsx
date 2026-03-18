/**
 * Approval Form Component - Submit approval decisions with feedback
 * Validates input and provides confirmation dialogs for destructive actions
 */

import { useState } from 'react';
import { apiClient } from '../api/client';

/**
 * Approval decision type
 */
type ApprovalDecision = 'approved' | 'revision_requested' | 'rejected';

/**
 * Component props
 */
interface ApprovalFormProps {
  /** Quest ID to approve */
  questId: string;
  /** Callback when approval is successfully submitted */
  onSubmit: () => void;
  /** Callback when user cancels */
  onCancel: () => void;
}

/**
 * Submit decision via the appropriate action route
 */
async function submitDecision(
  questId: string,
  decision: ApprovalDecision,
  feedback?: string,
): Promise<void> {
  switch (decision) {
    case 'approved':
      await apiClient.approveQuest(questId, feedback);
      break;
    case 'revision_requested':
      await apiClient.reviseQuest(questId, feedback!);
      break;
    case 'rejected':
      await apiClient.rejectQuest(questId, feedback!);
      break;
  }
}

/**
 * Approval Form Component
 */
export function ApprovalForm({ questId, onSubmit, onCancel }: ApprovalFormProps) {
  const [decision, setDecision] = useState<ApprovalDecision>('approved');
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  /**
   * Validate form input
   */
  const validateForm = (): boolean => {
    setValidationError(null);

    // Feedback required for revision and rejection
    if ((decision === 'revision_requested' || decision === 'rejected') && !feedback.trim()) {
      setValidationError(
        decision === 'revision_requested'
          ? 'Feedback is required when requesting revision'
          : 'Reason is required when rejecting a quest'
      );
      return false;
    }

    return true;
  };

  /**
   * Handle form submission
   */
  const handleSubmit = async () => {
    // Validate form
    if (!validateForm()) {
      return;
    }

    // Show confirmation dialog for rejection
    if (decision === 'rejected' && !showRejectConfirm) {
      setShowRejectConfirm(true);
      return;
    }

    // Submit approval decision
    try {
      setLoading(true);
      setError(null);

      await submitDecision(questId, decision, feedback.trim() || undefined);

      // Success - call onSubmit callback
      onSubmit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit approval decision');
      setShowRejectConfirm(false);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle decision change
   */
  const handleDecisionChange = (newDecision: ApprovalDecision) => {
    setDecision(newDecision);
    setValidationError(null);
    setShowRejectConfirm(false);
  };

  /**
   * Rejection confirmation dialog
   */
  if (showRejectConfirm) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-bg-card rounded-lg shadow-xl p-6 max-w-md w-full mx-4 border border-border">
          <h3 className="text-xl font-semibold text-text-primary mb-4">Confirm Rejection</h3>

          <p className="text-text-secondary mb-6">
            Are you sure you want to reject this quest? This action will cancel the quest and cannot be undone.
          </p>

          <div className="bg-yellow/10 border border-yellow/30 rounded-lg p-4 mb-6">
            <p className="text-sm text-yellow">
              <span className="font-medium">Your reason:</span> {feedback}
            </p>
          </div>

          <div className="flex justify-end gap-3">
            <button
              onClick={() => setShowRejectConfirm(false)}
              disabled={loading}
              className="px-6 py-2 bg-bg-elevated text-text-secondary rounded-lg hover:bg-border transition-colors font-medium disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="px-6 py-2 bg-red text-white rounded-lg hover:bg-red/80 transition-colors font-medium disabled:opacity-50 flex items-center gap-2"
            >
              {loading && (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              )}
              Confirm Rejection
            </button>
          </div>
        </div>
      </div>
    );
  }

  /**
   * Main form
   */
  return (
    <div className="bg-bg-card rounded-xl border border-border p-8">
      <h3 className="text-xl font-semibold tracking-tight text-text-primary mb-6">Submit Approval Decision</h3>

      {/* Error Alert */}
      {error && (
        <div className="bg-red/10 border border-red/30 rounded-lg p-4 mb-6">
          <p className="text-red">{error}</p>
        </div>
      )}

      {/* Decision Radio Buttons */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-text-secondary mb-3">
          Decision <span className="text-red">*</span>
        </label>

        <div className="space-y-3">
          {/* Approve Option */}
          <label className="flex items-center p-4 border-2 border-border rounded-lg cursor-pointer transition-colors hover:bg-bg-elevated">
            <input
              type="radio"
              name="decision"
              value="approved"
              checked={decision === 'approved'}
              onChange={(e) => handleDecisionChange(e.target.value as ApprovalDecision)}
              className="w-4 h-4 text-green focus:ring-green"
            />
            <div className="ml-3">
              <div className="text-sm font-medium text-text-primary">Approve</div>
              <div className="text-sm text-text-tertiary">
                Quest meets requirements and can proceed to task splitting
              </div>
            </div>
          </label>

          {/* Request Revision Option */}
          <label className="flex items-center p-4 border-2 border-border rounded-lg cursor-pointer transition-colors hover:bg-bg-elevated">
            <input
              type="radio"
              name="decision"
              value="revision_requested"
              checked={decision === 'revision_requested'}
              onChange={(e) => handleDecisionChange(e.target.value as ApprovalDecision)}
              className="w-4 h-4 text-yellow focus:ring-yellow"
            />
            <div className="ml-3">
              <div className="text-sm font-medium text-text-primary">Request Revision</div>
              <div className="text-sm text-text-tertiary">
                Quest needs changes before it can be approved
              </div>
            </div>
          </label>

          {/* Reject Option */}
          <label className="flex items-center p-4 border-2 border-border rounded-lg cursor-pointer transition-colors hover:bg-bg-elevated">
            <input
              type="radio"
              name="decision"
              value="rejected"
              checked={decision === 'rejected'}
              onChange={(e) => handleDecisionChange(e.target.value as ApprovalDecision)}
              className="w-4 h-4 text-red focus:ring-red"
            />
            <div className="ml-3">
              <div className="text-sm font-medium text-text-primary">Reject</div>
              <div className="text-sm text-text-tertiary">
                Quest is not viable and should be cancelled
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Feedback Textarea */}
      {(decision === 'revision_requested' || decision === 'rejected') && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-text-secondary mb-2">
            {decision === 'revision_requested' ? 'Revision Feedback' : 'Rejection Reason'}{' '}
            <span className="text-red">*</span>
          </label>
          <textarea
            value={feedback}
            onChange={(e) => {
              setFeedback(e.target.value);
              setValidationError(null);
            }}
            placeholder={
              decision === 'revision_requested'
                ? 'Provide detailed feedback on what needs to be changed...'
                : 'Explain why this quest is being rejected...'
            }
            rows={6}
            className={`w-full px-4 py-3 bg-bg-input border rounded-lg focus:outline-none focus:ring-2 resize-none text-text-primary placeholder-text-tertiary ${
              validationError
                ? 'border-red focus:ring-red'
                : 'border-border focus:ring-blue'
            }`}
          />
          {validationError && (
            <p className="mt-2 text-sm text-red">{validationError}</p>
          )}
        </div>
      )}

      {/* Approval Feedback (Optional) */}
      {decision === 'approved' && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-text-secondary mb-2">
            Comments (Optional)
          </label>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Add any comments or notes about this approval..."
            rows={3}
            className="w-full px-4 py-3 bg-bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue resize-none text-text-primary placeholder-text-tertiary"
          />
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          disabled={loading}
          className="px-6 py-2 bg-bg-elevated text-text-secondary rounded-lg hover:bg-border transition-colors font-medium disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={loading}
          className={`px-6 py-2 rounded-lg transition-colors font-medium disabled:opacity-50 flex items-center gap-2 ${
            decision === 'approved'
              ? 'bg-green text-white hover:bg-green/80'
              : decision === 'revision_requested'
              ? 'bg-yellow text-black hover:bg-yellow/80'
              : 'bg-red text-white hover:bg-red/80'
          }`}
        >
          {loading && (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
          )}
          {decision === 'approved'
            ? 'Approve Quest'
            : decision === 'revision_requested'
            ? 'Request Revision'
            : 'Reject Quest'}
        </button>
      </div>
    </div>
  );
}
