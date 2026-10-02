/**
 * Shown wherever an application can go back from Approval to an earlier
 * status: the move deletes the approving lender, every approval condition and
 * the brokers' approval-conditions tasks (see change_application_status).
 */
export default function ApprovalClearWarning({ lenderName, conditionCount }: {
  lenderName?: string | null;
  conditionCount: number;
}) {
  const conditions = `${conditionCount} approval condition${conditionCount === 1 ? '' : 's'}`;
  return (
    <span
      role="alert"
      className="mt-3 block rounded-md border border-[var(--led-danger)]/30 bg-[var(--led-danger-tint)] px-3 py-2.5 text-[13px] text-[var(--led-danger)]"
    >
      Moving back from Approval permanently deletes the approval
      {lenderName ? <> from <strong>{lenderName}</strong></> : null}
      {conditionCount > 0 ? <> and its {conditions}</> : null}, including their tick-offs and the brokers'
      approval-conditions tasks. Re-entering Approval starts from scratch.
    </span>
  );
}
