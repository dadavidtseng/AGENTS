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

      await apiClient.submitApproval(questId, {
        decision,
        approvedBy: 'dashboard-user',
        approvedVia: 'dashboard',
        feedback: feedback.trim() || undefined,
      });

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
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
          <h3 className="text-xl font-semibold text-gray-900 mb-4">Confirm Rejection</h3>
          
          <p className="text-gray-700 mb-6">
            Are you sure you want to reject this quest? This action will cancel the quest and cannot be undone.
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
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-xl font-semibold text-gray-900 mb-6">Submit Approval Decision</h3>

      {/* Error Alert */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {/* Decision Radio Buttons */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Decision <span className="text-red-500">*</span>
        </label>

        <div className="space-y-3">
          {/* Approve Option */}
          <label className="flex items-center p-4 border-2 rounded-lg cursor-pointer transition-colors hover:bg-gray-50">
            <input
              type="radio"
              name="decision"
              value="approved"
              checked={decision === 'approved'}
              onChange={(e) => handleDecisionChange(e.target.value as ApprovalDecision)}
              className="w-4 h-4 text-green-600 focus:ring-green-500"
            />
            <div className="ml-3">
              <div className="text-sm font-medium text-gray-900">Approve</div>
              <div className="text-sm text-gray-500">
                Quest meets requirements and can proceed to task splitting
              </div>
            </div>
          </label>

          {/* Request Revision Option */}
          <label className="flex items-center p-4 border-2 rounded-lg cursor-pointer transition-colors hover:bg-gray-50">
            <input
              type="radio"
              name="decision"
              value="revision_requested"
              checked={decision === 'revision_requested'}
              onChange={(e) => handleDecisionChange(e.target.value as ApprovalDecision)}
              className="w-4 h-4 text-yellow-600 focus:ring-yellow-500"
            />
            <div className="ml-3">
              <div className="text-sm font-medium text-gray-900">Request Revision</div>
              <div className="text-sm text-gray-500">
                Quest needs changes before it can be approved
              </div>
            </div>
          </label>

          {/* Reject Option */}
          <label className="flex items-center p-4 border-2 rounded-lg cursor-pointer transition-colors hover:bg-gray-50">
            <input
              type="radio"
              name="decision"
              value="rejected"
              checked={decision === 'rejected'}
              onChange={(e) => handleDecisionChange(e.target.value as ApprovalDecision)}
              className="w-4 h-4 text-red-600 focus:ring-red-500"
            />
            <div className="ml-3">
              <div className="text-sm font-medium text-gray-900">Reject</div>
              <div className="text-sm text-gray-500">
                Quest is not viable and should be cancelled
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Feedback Textarea */}
      {(decision === 'revision_requested' || decision === 'rejected') && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {decision === 'revision_requested' ? 'Revision Feedback' : 'Rejection Reason'}{' '}
            <span className="text-red-500">*</span>
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
      )}

      {/* Approval Feedback (Optional) */}
      {decision === 'approved' && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Comments (Optional)
          </label>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Add any comments or notes about this approval..."
            rows={3}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          disabled={loading}
          className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={loading}
          className={`px-6 py-2 rounded-lg transition-colors font-medium disabled:opacity-50 flex items-center gap-2 ${
            decision === 'approved'
              ? 'bg-green-600 text-white hover:bg-green-700'
              : decision === 'revision_requested'
              ? 'bg-yellow-600 text-white hover:bg-yellow-700'
              : 'bg-red-600 text-white hover:bg-red-700'
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
