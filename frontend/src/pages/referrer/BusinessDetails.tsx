import { useSearchParams } from 'react-router-dom';
import BusinessDetailsForm from '../../components/referrer/BusinessDetailsForm';
import { PageHeader } from '../../components/ui';

/**
 * Referrer-facing billing details. Linked from the sidebar, and where new
 * referrers land straight after setting their password (`?welcome=1`).
 */
export default function BusinessDetails() {
  const [searchParams] = useSearchParams();
  const welcome = searchParams.get('welcome') === '1';

  return (
    <div>
      <PageHeader
        title="Business Details"
        subtitle="Used to raise your monthly tax invoice for payment"
      />

      <BusinessDetailsForm
        basePath="/external-referrers/me"
        contactNote="Email and phone come from your account — ask your broker if either needs changing."
        intro={welcome ? (
          <div className="rounded-xl border border-border bg-secondary/60 px-4 py-3.5">
            <p className="text-[14px] font-semibold text-foreground">Welcome aboard — one last step</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Tell us how to pay you. We use these details to generate your tax invoice at the end of each
              month, so please make sure the ABN and bank account are correct. You can update them any time
              from this page.
            </p>
          </div>
        ) : undefined}
      />
    </div>
  );
}
