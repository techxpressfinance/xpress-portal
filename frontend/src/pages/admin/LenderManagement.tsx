import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { getErrorMessage, formatDate } from '../../lib/utils';
import { GlassCard, StatCard, PageHeader, Button, Badge } from '../../components/ui';
import type { Lender } from '../../types';

export default function LenderManagement() {
  const { toast } = useToast();
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', contact_name: '', contact_email: '', contact_phone: '', notes: '' });

  const fetchLenders = () => {
    api.get('/lenders')
      .then(({ data }) => setLenders(data))
      .catch(() => toast('Failed to load lenders', 'error' as const))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchLenders(); }, []);

  const resetForm = () => {
    setForm({ name: '', contact_name: '', contact_email: '', contact_phone: '', notes: '' });
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (lender: Lender) => {
    setForm({
      name: lender.name,
      contact_name: lender.contact_name || '',
      contact_email: lender.contact_email || '',
      contact_phone: lender.contact_phone || '',
      notes: lender.notes || '',
    });
    setEditingId(lender.id);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        contact_name: form.contact_name.trim() || null,
        contact_email: form.contact_email.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        notes: form.notes.trim() || null,
      };
      if (editingId) {
        const { data } = await api.patch(`/lenders/${editingId}`, payload);
        setLenders(prev => prev.map(l => l.id === editingId ? data : l));
        toast('Lender updated', 'success');
      } else {
        const { data } = await api.post('/lenders', payload);
        setLenders(prev => [...prev, data]);
        toast('Lender created', 'success');
      }
      resetForm();
    } catch (err) {
      toast(getErrorMessage(err, 'Operation failed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (lender: Lender) => {
    try {
      if (lender.is_active) {
        await api.delete(`/lenders/${lender.id}`);
        setLenders(prev => prev.map(l => l.id === lender.id ? { ...l, is_active: false } : l));
        toast('Lender deactivated', 'success');
      } else {
        const { data } = await api.patch(`/lenders/${lender.id}`, { is_active: true });
        setLenders(prev => prev.map(l => l.id === lender.id ? data : l));
        toast('Lender reactivated', 'success');
      }
    } catch (err) {
      toast(getErrorMessage(err, 'Operation failed'), 'error');
    }
  };

  const activeLenders = lenders.filter(l => l.is_active);
  const inactiveLenders = lenders.filter(l => !l.is_active);

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <PageHeader title="Lender Management" subtitle="Manage lenders for loan submissions" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map(i => <StatCard key={i} label="" value="" loading gradient="from-primary to-primary" icon={<span />} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Lender Management"
        subtitle="Manage lenders for loan submissions"
        action={
          <Button onClick={() => { resetForm(); setShowForm(true); }}>
            + Add Lender
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total Lenders" value={lenders.length} gradient="from-primary to-primary" icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75Z" /></svg>} />
        <StatCard label="Active" value={activeLenders.length} gradient="from-success to-success" icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>} />
        <StatCard label="Inactive" value={inactiveLenders.length} gradient="from-muted-foreground to-muted-foreground" icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" /></svg>} />
      </div>

      {showForm && (
        <GlassCard>
          <h3 className="text-[15px] font-semibold text-foreground mb-4">
            {editingId ? 'Edit Lender' : 'Add New Lender'}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  required
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1">Contact Name</label>
                <input
                  type="text"
                  value={form.contact_name}
                  onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1">Contact Email</label>
                <input
                  type="email"
                  value={form.contact_email}
                  onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1">Contact Phone</label>
                <input
                  type="text"
                  value={form.contact_phone}
                  onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" loading={saving}>{editingId ? 'Save Changes' : 'Create Lender'}</Button>
              <Button variant="ghost" onClick={resetForm}>Cancel</Button>
            </div>
          </form>
        </GlassCard>
      )}

      <GlassCard padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border/60">
                <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Name</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Contact</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Email</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Phone</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Created</th>
                <th className="px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {lenders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-muted-foreground text-[14px]">
                    No lenders yet. Add your first lender to get started.
                  </td>
                </tr>
              ) : (
                lenders.map(lender => (
                  <tr key={lender.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-5 py-3 text-[14px] font-medium text-foreground">{lender.name}</td>
                    <td className="px-5 py-3 text-[14px] text-muted-foreground">{lender.contact_name || '-'}</td>
                    <td className="px-5 py-3 text-[14px] text-muted-foreground">{lender.contact_email || '-'}</td>
                    <td className="px-5 py-3 text-[14px] text-muted-foreground">{lender.contact_phone || '-'}</td>
                    <td className="px-5 py-3">
                      <Badge type="custom" value={lender.is_active ? 'Active' : 'Inactive'} className={lender.is_active ? 'bg-success/10 text-success' : 'bg-secondary text-muted-foreground'} />
                    </td>
                    <td className="px-5 py-3 text-[13px] text-muted-foreground">{formatDate(lender.created_at)}</td>
                    <td className="px-5 py-3">
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => startEdit(lender)}>Edit</Button>
                        <Button
                          size="sm"
                          variant={lender.is_active ? 'danger' : 'success'}
                          onClick={() => toggleActive(lender)}
                        >
                          {lender.is_active ? 'Deactivate' : 'Activate'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  );
}
