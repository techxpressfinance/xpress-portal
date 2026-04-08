import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { GlassCard, PageHeader, Button, Badge } from '../../components/ui';
import { formatDate } from '../../lib/utils';
import type { ContactDetail as ContactDetailType } from '../../types';

export default function ContactDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [contact, setContact] = useState<ContactDetailType | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<ContactDetailType>(`/contacts/${id}`)
      .then(({ data }) => setContact(data))
      .catch(() => toast('Failed to load contact', 'error'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!contact) {
    return <p className="text-center py-20 text-muted-foreground">Contact not found.</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${contact.first_name} ${contact.last_name}`}
        subtitle="Contact Details"
        action={
          <Link to="/admin/contacts">
            <Button variant="secondary" size="sm">Back to Contacts</Button>
          </Link>
        }
      />

      {/* Contact Info */}
      <div className="grid gap-6 md:grid-cols-2">
        <GlassCard>
          <h3 className="text-lg font-semibold mb-4">Personal Information</h3>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Full Name</dt>
              <dd className="font-medium">
                {contact.first_name} {contact.middle_name ? `${contact.middle_name} ` : ''}{contact.last_name}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Email</dt>
              <dd>{contact.email || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Phone</dt>
              <dd>{contact.phone || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Date of Birth</dt>
              <dd>{contact.date_of_birth || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Driver's License</dt>
              <dd>{contact.drivers_license_number || '—'}</dd>
            </div>
          </dl>
        </GlassCard>

        <GlassCard>
          <h3 className="text-lg font-semibold mb-4">Address</h3>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Street</dt>
              <dd>{contact.address || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Suburb</dt>
              <dd>{contact.suburb || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">State</dt>
              <dd>{contact.state || '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Postcode</dt>
              <dd>{contact.postcode || '—'}</dd>
            </div>
          </dl>
          {contact.notes && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-sm text-muted-foreground">Notes</p>
              <p className="text-sm mt-1">{contact.notes}</p>
            </div>
          )}
        </GlassCard>
      </div>

      {/* Organizations */}
      <GlassCard>
        <h3 className="text-lg font-semibold mb-4">
          Organizations
          <span className="ml-2 text-sm font-normal text-muted-foreground">({contact.organizations.length})</span>
        </h3>
        {contact.organizations.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No organizations linked to this contact.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-3 font-medium">Name</th>
                  <th className="pb-3 font-medium">ABN</th>
                  <th className="pb-3 font-medium">Industry</th>
                  <th className="pb-3 font-medium">Role</th>
                </tr>
              </thead>
              <tbody>
                {contact.organizations.map(org => (
                  <tr key={org.id} className="border-b border-border/50">
                    <td className="py-3 font-medium">{org.name}</td>
                    <td className="py-3 text-muted-foreground">{org.abn || '—'}</td>
                    <td className="py-3 text-muted-foreground">{org.industry || '—'}</td>
                    <td className="py-3">
                      {org.role ? (
                        <Badge type="custom" value={org.role} className="bg-chart-2/10 text-chart-2" />
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* Lending History */}
      <GlassCard>
        <h3 className="text-lg font-semibold mb-4">
          Lending History
          <span className="ml-2 text-sm font-normal text-muted-foreground">({contact.applications.length})</span>
        </h3>
        {contact.applications.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No loan applications linked to this contact.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-3 font-medium">Type</th>
                  <th className="pb-3 font-medium">Amount</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium">Business</th>
                  <th className="pb-3 font-medium">Created</th>
                  <th className="pb-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {contact.applications.map(app => (
                  <tr key={app.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                    <td className="py-3 capitalize font-medium">{app.loan_type}</td>
                    <td className="py-3">${Number(app.amount).toLocaleString()}</td>
                    <td className="py-3">
                      <Badge value={app.status} />
                    </td>
                    <td className="py-3 text-muted-foreground">
                      {app.business_name || app.business_abn || '—'}
                    </td>
                    <td className="py-3 text-muted-foreground">{formatDate(app.created_at)}</td>
                    <td className="py-3">
                      <Link to={`/admin/applications/${app.id}`}>
                        <Button variant="ghost" size="sm">Review</Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
