import { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { useToast } from './Toast';
import { Button, Card } from './ui';
import { BASCalculator, PayCalculator, RatiosCalculator } from '../pages/admin/BasCalculator';
import type { BASCalcState, PayCalcState, RatiosCalcState } from '../pages/admin/BasCalculator';
import { formatDate } from '../lib/utils';
import { XMarkIcon } from '@heroicons/react/24/outline';

type CalcType = 'bas' | 'pay' | 'ratios';
type AnyCalcState = BASCalcState | PayCalcState | RatiosCalcState;

interface SavedCalc {
  id: string;
  calc_type: CalcType;
  title: string | null;
  data: AnyCalcState;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

const TYPE_LABELS: Record<CalcType, string> = {
  bas: 'BAS Calculator',
  pay: 'Pay Calculator',
  ratios: 'Financial Ratios',
};

export default function ApplicationCalculators({ applicationId }: { applicationId: string }) {
  const { toast } = useToast();
  const [savedCalcs, setSavedCalcs] = useState<SavedCalc[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCalcType, setActiveCalcType] = useState<CalcType | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingInitialData, setEditingInitialData] = useState<AnyCalcState | null>(null);
  const [saving, setSaving] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const currentStateRef = useRef<AnyCalcState | null>(null);

  useEffect(() => {
    api.get(`/applications/${applicationId}/calculators`)
      .then(({ data }) => setSavedCalcs(data))
      .catch(() => toast('Failed to load calculators', 'error'))
      .finally(() => setLoading(false));
  }, [applicationId]);

  const handleStateChange = (state: AnyCalcState) => {
    currentStateRef.current = state;
  };

  const openNew = (type: CalcType) => {
    setActiveCalcType(type);
    setEditingId(null);
    setEditingInitialData(null);
    setEditTitle('');
    currentStateRef.current = null;
  };

  const openEdit = (calc: SavedCalc) => {
    setActiveCalcType(calc.calc_type);
    setEditingId(calc.id);
    setEditingInitialData(calc.data);
    setEditTitle(calc.title || '');
    currentStateRef.current = calc.data;
  };

  const handleSave = async () => {
    if (!activeCalcType || !currentStateRef.current) {
      toast('Nothing to save yet — make a change first', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        const { data } = await api.patch(`/applications/${applicationId}/calculators/${editingId}`, {
          title: editTitle.trim() || null,
          data: currentStateRef.current,
        });
        setSavedCalcs(prev => prev.map(c => c.id === editingId ? data : c));
      } else {
        const { data } = await api.post(`/applications/${applicationId}/calculators`, {
          calc_type: activeCalcType,
          title: editTitle.trim() || null,
          data: currentStateRef.current,
        });
        setSavedCalcs(prev => [data, ...prev]);
      }
      toast('Calculator saved', 'success');
      setActiveCalcType(null);
      setEditingId(null);
    } catch {
      toast('Failed to save calculator', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (calcId: string) => {
    try {
      await api.delete(`/applications/${applicationId}/calculators/${calcId}`);
      setSavedCalcs(prev => prev.filter(c => c.id !== calcId));
      if (editingId === calcId) {
        setActiveCalcType(null);
        setEditingId(null);
      }
      toast('Calculator deleted', 'success');
    } catch {
      toast('Failed to delete calculator', 'error');
    }
  };

  const cancel = () => {
    setActiveCalcType(null);
    setEditingId(null);
    setEditingInitialData(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-foreground">Calculators</h2>
        {!activeCalcType && (
          <div className="flex gap-2 flex-wrap">
            {(['bas', 'pay', 'ratios'] as CalcType[]).map(type => (
              <Button key={type} size="sm" variant="secondary" onClick={() => openNew(type)}>
                + {TYPE_LABELS[type]}
              </Button>
            ))}
          </div>
        )}
      </div>

      {activeCalcType && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder={`${TYPE_LABELS[activeCalcType]} — label (optional)`}
              className="flex-1 min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <Button size="sm" onClick={handleSave} loading={saving}>Save</Button>
            <Button size="sm" variant="secondary" onClick={cancel}>Cancel</Button>
          </div>

          {activeCalcType === 'bas' && (
            <BASCalculator
              initialState={editingInitialData as BASCalcState}
              onStateChange={handleStateChange as (s: BASCalcState) => void}
            />
          )}
          {activeCalcType === 'pay' && (
            <PayCalculator
              initialState={editingInitialData as PayCalcState}
              onStateChange={handleStateChange as (s: PayCalcState) => void}
            />
          )}
          {activeCalcType === 'ratios' && (
            <RatiosCalculator
              initialState={editingInitialData as RatiosCalcState}
              onStateChange={handleStateChange as (s: RatiosCalcState) => void}
            />
          )}
        </div>
      )}

      {loading ? (
        <Card padding="none">
          <div className="p-4 space-y-3">
            {[1, 2].map(i => <div key={i} className="h-10 rounded-lg shimmer" />)}
          </div>
        </Card>
      ) : savedCalcs.length === 0 && !activeCalcType ? (
        <Card className="py-8 text-center">
          <p className="text-[14px] text-muted-foreground">No saved calculators yet.</p>
          <p className="text-[13px] text-muted-foreground mt-1">
            Add a BAS, Pay, or Ratios calculator to analyse this application.
          </p>
        </Card>
      ) : savedCalcs.length > 0 ? (
        <Card padding="none">
          <div className="divide-y divide-border">
            {savedCalcs.map(calc => (
              <div key={calc.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] font-semibold text-foreground">
                    {calc.title || TYPE_LABELS[calc.calc_type]}
                  </span>
                  <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                    {TYPE_LABELS[calc.calc_type]}
                  </span>
                  {calc.created_by_name && (
                    <span className="ml-2 text-[11px] text-muted-foreground">by {calc.created_by_name}</span>
                  )}
                  <span className="ml-2 text-[11px] text-muted-foreground">{formatDate(calc.updated_at)}</span>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => openEdit(calc)}
                >
                  {editingId === calc.id ? 'Editing' : 'Load'}
                </Button>
                <button
                  onClick={() => handleDelete(calc.id)}
                  className="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-1"
                  title="Delete"
                >
                  <XMarkIcon className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
