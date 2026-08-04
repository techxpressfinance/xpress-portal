import { ConfirmDialog } from './ui';

/**
 * A trust can legitimately operate without its own ABN, so the broker is asked
 * to confirm rather than blocked. Confirming sets `no_abn_confirmed` on the
 * entity — the API rejects an ABN-less trust without it.
 */
export default function TrustNoAbnDialog({ open, name, loading, onConfirm, onCancel }: {
  open: boolean;
  name?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      title="This trust has no ABN — are you sure?"
      message={
        <>
          <p>
            You're about to create {name?.trim() ? <strong>{name.trim()}</strong> : 'this trust'} without an ABN.
          </p>
          <p className="mt-2">
            Please confirm you have checked the trust's structure with the client's accountant. Lenders
            will usually ask for the trust deed and the trustee's ABN, and the confirmation is recorded
            against this entity.
          </p>
        </>
      }
      confirmText="Yes — checked with the accountant"
      cancelText="Go back"
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
