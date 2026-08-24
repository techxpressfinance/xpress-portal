import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, ExternalLink, X } from 'lucide-react';
import api from '../api/client';
import { useToast } from './Toast';
import { Badge, Button } from './ui';
import { formatDate, getErrorMessage } from '../lib/utils';
import type {
  Contact,
  ContactDuplicatesResponse,
  DuplicateConfidence,
  Organization,
  OrganizationDuplicatesResponse,
} from '../types';

interface RecordView {
  id: string;
  title: string;
  fields: { label: string; value: string | null }[];
  badges: { label: string; value: number }[];
  createdAt: string;
  detailUrl: string;
}

interface GroupView {
  confidence: DuplicateConfidence;
  matchedOn: string[];
  records: RecordView[];
}

const joinParts = (...parts: (string | null)[]) => parts.filter(p => p && p.trim()).join(', ') || null;

function contactToView(c: Contact): RecordView {
  return {
    id: c.id,
    title: `${c.first_name} ${c.last_name}`,
    fields: [
      { label: 'Email', value: c.email },
      { label: 'Phone', value: c.phone },
      { label: 'DOB', value: c.date_of_birth },
      { label: 'Address', value: joinParts(c.address, c.suburb, c.state, c.postcode) },
      { label: 'Licence', value: c.drivers_license_number },
    ],
    badges: [{ label: 'application', value: c.application_count }],
    createdAt: c.created_at,
    detailUrl: `/admin/contacts/${c.id}`,
  };
}

function organizationToView(o: Organization): RecordView {
  return {
    id: o.id,
    title: o.name,
    fields: [
      { label: 'ABN', value: o.abn },
      { label: 'Industry', value: o.industry },
      { label: 'Address', value: o.address },
    ],
    badges: [
      { label: 'contact', value: o.contact_count },
      { label: 'application', value: o.application_count },
    ],
    createdAt: o.created_at,
    detailUrl: `/admin/companies/${o.id}`,
  };
}

const CONFIDENCE_BADGE: Record<DuplicateConfidence, { label: string; className: string }> = {
  high: { label: 'High confidence', className: 'bg-green-500/10 text-green-600 dark:text-green-400' },
  review: { label: 'Needs review', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
};

function DuplicateGroupCard({
  group,
  merging,
  onMerge,
}: {
  group: GroupView;
  merging: boolean;
  onMerge: (primaryId: string, duplicateIds: string[]) => void;
}) {
  // Oldest record (first — backend sorts by created_at) is kept by default
  const [keepId, setKeepId] = useState(group.records[0].id);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const duplicateIds = group.records
    .map(r => r.id)
    .filter(id => id !== keepId && !excluded.has(id));
  const badge = CONFIDENCE_BADGE[group.confidence];

  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge type="custom" value={badge.label} className={badge.className} />
        {group.matchedOn.length > 0 && (
          <span className="text-[12px] text-muted-foreground">
            Matched on: {group.matchedOn.join(', ')}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {group.records.map(record => {
          const isKeep = record.id === keepId;
          const isExcluded = excluded.has(record.id);
          return (
            <div
              key={record.id}
              className={`rounded-lg border p-3 transition-colors ${
                isKeep ? 'border-primary/50 bg-primary/5' : isExcluded ? 'border-border/50 opacity-50' : 'border-border'
              }`}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={isKeep}
                    onChange={() => {
                      setKeepId(record.id);
                      setExcluded(prev => {
                        if (!prev.has(record.id)) return prev;
                        const next = new Set(prev);
                        next.delete(record.id);
                        return next;
                      });
                    }}
                  />
                  <span className="font-medium text-foreground">{record.title}</span>
                </label>
                {isKeep && <Badge type="custom" value="Keep" className="bg-primary/10 text-primary" />}
                {record.badges.map(b => (
                  <span key={b.label} className="text-[12px] text-muted-foreground">
                    {b.value} {b.label}{b.value === 1 ? '' : 's'}
                  </span>
                ))}
                <span className="text-[12px] text-muted-foreground">created {formatDate(record.createdAt)}</span>
                <a
                  href={record.detailUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={`Open ${record.title}`}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                {!isKeep && (
                  <label className="ml-auto flex items-center gap-1.5 text-[12px] text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!isExcluded}
                      onChange={() =>
                        setExcluded(prev => {
                          const next = new Set(prev);
                          if (next.has(record.id)) next.delete(record.id);
                          else next.add(record.id);
                          return next;
                        })
                      }
                    />
                    Merge
                  </label>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-muted-foreground">
                {record.fields.filter(f => f.value).map(f => (
                  <span key={f.label}>
                    <span className="font-medium">{f.label}:</span> {f.value}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <Button
          size="sm"
          variant="primary"
          disabled={merging || duplicateIds.length === 0}
          onClick={() => onMerge(keepId, duplicateIds)}
        >
          {merging ? 'Merging…' : `Merge ${duplicateIds.length} into "${group.records.find(r => r.id === keepId)?.title}"`}
        </Button>
      </div>
    </div>
  );
}

export default function DuplicateReviewModal({
  kind,
  onClose,
  onChanged,
}: {
  kind: 'contacts' | 'organizations';
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<GroupView[]>([]);
  const [autoMergeGroups, setAutoMergeGroups] = useState(0);
  const [mergingGroup, setMergingGroup] = useState<number | null>(null);
  const [mergingAll, setMergingAll] = useState(false);
  const entityLabel = kind === 'contacts' ? 'contacts' : 'companies';

  const fetchGroups = useCallback(() => {
    setLoading(true);
    const request = kind === 'contacts'
      ? api.get<ContactDuplicatesResponse>('/contacts/duplicates').then(({ data }) => ({
          autoMerge: data.auto_merge_groups,
          views: data.groups.map(g => ({
            confidence: g.confidence,
            matchedOn: g.matched_on,
            records: g.contacts.map(contactToView),
          })),
        }))
      : api.get<OrganizationDuplicatesResponse>('/organizations/duplicates').then(({ data }) => ({
          autoMerge: data.auto_merge_groups,
          views: data.groups.map(g => ({
            confidence: g.confidence,
            matchedOn: g.matched_on,
            records: g.organizations.map(organizationToView),
          })),
        }));
    request
      .then(({ autoMerge, views }) => {
        setGroups(views);
        setAutoMergeGroups(autoMerge);
      })
      .catch(() => toast(`Failed to scan for duplicate ${entityLabel}`, 'error'))
      .finally(() => setLoading(false));
  }, [kind, entityLabel, toast]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleMerge = async (groupIndex: number, primaryId: string, duplicateIds: string[]) => {
    setMergingGroup(groupIndex);
    try {
      await api.post(`/${kind}/merge`, { primary_id: primaryId, duplicate_ids: duplicateIds });
      toast(`Merged ${duplicateIds.length} duplicate${duplicateIds.length === 1 ? '' : 's'}`, 'success');
      onChanged();
      fetchGroups();
    } catch (err) {
      toast(getErrorMessage(err, 'Merge failed'), 'error');
    } finally {
      setMergingGroup(null);
    }
  };

  const handleMergeAllHigh = async () => {
    setMergingAll(true);
    try {
      const { data } = await api.post(`/${kind}/deduplicate`);
      toast(`Merged ${data.groups_merged} groups, removed ${data.duplicates_removed} duplicates`, 'success');
      onChanged();
      fetchGroups();
    } catch (err) {
      toast(getErrorMessage(err, 'Merge failed'), 'error');
    } finally {
      setMergingAll(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm"
        style={{ animation: 'fadeIn 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
        onClick={onClose}
      />
      <div
        className="relative flex w-full max-w-3xl max-h-[85vh] flex-col rounded-2xl bg-background border border-border shadow-xl overflow-hidden"
        style={{ animation: 'fadeInUp 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) both' }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Copy className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-[17px] font-semibold leading-tight text-foreground">
                Duplicate {entityLabel === 'contacts' ? 'Contacts' : 'Entities'}
              </h3>
              <p className="text-[13px] text-muted-foreground">
                {loading
                  ? 'Scanning…'
                  : groups.length === 0
                    ? 'No duplicates found'
                    : `${groups.length} group${groups.length === 1 ? '' : 's'} found — pick which record to keep, then merge`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1.5 -mt-1 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {loading ? (
            <p className="text-center py-10 text-muted-foreground">Scanning for duplicates…</p>
          ) : groups.length === 0 ? (
            <p className="text-center py-10 text-muted-foreground">
              No duplicate {entityLabel} detected. You're all clean.
            </p>
          ) : (
            groups.map((group, i) => (
              <DuplicateGroupCard
                key={group.records.map(r => r.id).join('-')}
                group={group}
                merging={mergingGroup === i}
                onMerge={(primaryId, duplicateIds) => handleMerge(i, primaryId, duplicateIds)}
              />
            ))
          )}
        </div>

        {!loading && groups.length > 0 && (
          <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
            <p className="text-[12px] text-muted-foreground">
              Merging moves applications and links to the kept record, fills its empty fields, and deletes the duplicates. This cannot be undone.
            </p>
            {autoMergeGroups > 0 && (
              <Button size="sm" variant="secondary" disabled={mergingAll} onClick={handleMergeAllHigh}>
                {mergingAll ? 'Merging…' : `Merge all high confidence (${autoMergeGroups})`}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
