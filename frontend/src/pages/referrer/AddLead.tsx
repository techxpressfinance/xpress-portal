import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useToast } from '../../components/Toast';
import { getErrorMessage } from '../../lib/utils';
import { GlassCard, PageHeader, Button, Input } from '../../components/ui';

// ── Config data ──────────────────────────────────────────────────────────────

interface Industry {
  id: number;
  label: string;
  children: { id: number; label: string }[];
}

const INDUSTRIES: Industry[] = [
  { id: 52, label: 'Arts & Lifestyle', children: [{ id: 53, label: 'Health & Fitness Centres, Gyms' }, { id: 54, label: 'Movie, Film & Video Services' }, { id: 55, label: 'Parks & Gardens' }, { id: 56, label: 'Photographic Services' }, { id: 57, label: 'Radio & TV Services' }, { id: 58, label: 'Religious Organisations' }, { id: 59, label: 'Services to the Arts' }, { id: 60, label: 'Sports & Physical Recreation' }, { id: 61, label: 'Other' }, { id: 195, label: 'Events' }] },
  { id: 62, label: 'Construction & Trades', children: [{ id: 63, label: 'Air Con, Heating, Solar Services' }, { id: 64, label: 'Bricklaying' }, { id: 65, label: 'Building Construction' }, { id: 66, label: 'Carpentry' }, { id: 67, label: 'Concreting, Paving' }, { id: 68, label: 'Electrical, Lighting' }, { id: 69, label: 'Fire & Security Alarm Services' }, { id: 70, label: 'Gardening' }, { id: 71, label: 'Glazing' }, { id: 72, label: 'Household Equipment Repair' }, { id: 73, label: 'Landscaping' }, { id: 74, label: 'Mechanic, Technician' }, { id: 75, label: 'Motor Vehicle Related Services' }, { id: 76, label: 'Painting & Decorating' }, { id: 77, label: 'Plastering' }, { id: 78, label: 'Plumbing' }, { id: 79, label: 'Property Maintenance, Handyman' }, { id: 80, label: 'Roofing' }, { id: 81, label: 'Steel Fabrication, Welding' }, { id: 82, label: 'Tiling, Carpentry, Floors' }, { id: 83, label: 'Other' }, { id: 205, label: 'Traffic Management' }] },
  { id: 84, label: 'Financial Services & Insurance', children: [{ id: 85, label: 'Accounting, Tax, Bookkeeping Services' }, { id: 86, label: 'Asset Finance' }, { id: 87, label: 'Credit Union Operation' }, { id: 88, label: 'Health Insurance' }, { id: 89, label: 'Life Insurance, Superannuation' }, { id: 90, label: 'Other' }, { id: 197, label: 'Banking' }, { id: 201, label: 'Wealth Management' }] },
  { id: 91, label: 'Hair & Beauty', children: [{ id: 92, label: 'Cosmetics Supplies' }, { id: 93, label: 'Day Spas, Health Retreats' }, { id: 94, label: 'Hair, Beauty Salons' }, { id: 95, label: 'Other' }] },
  { id: 96, label: 'Health', children: [{ id: 97, label: 'Chiropractic, Osteopathic Services' }, { id: 98, label: 'Dental Services' }, { id: 99, label: 'General Practice Medical Services' }, { id: 100, label: 'Health Foods, Nutrition, Supplements' }, { id: 101, label: 'Optometry Services' }, { id: 102, label: 'Pathology & Imaging Services' }, { id: 103, label: 'Physiotherapy Services' }, { id: 104, label: 'Specialist Medical Services' }, { id: 105, label: 'Other' }] },
  { id: 106, label: 'Hospitality', children: [{ id: 107, label: 'Accommodation' }, { id: 108, label: 'Cafes' }, { id: 109, label: 'Catering Services' }, { id: 110, label: 'Clubs' }, { id: 111, label: 'Pubs, Bars, Taverns' }, { id: 112, label: 'Restaurants' }, { id: 113, label: 'Takeaway Food' }, { id: 114, label: 'Other' }] },
  { id: 115, label: 'Manufacturing', children: [{ id: 116, label: 'Beverage Manufacturing' }, { id: 117, label: 'Clothing, Footwear, Textile Manufacturing' }, { id: 118, label: 'Food Manufacturing' }, { id: 119, label: 'Furniture Manufacturing' }, { id: 120, label: 'Glass, Ceramic, Cement Manufacturing' }, { id: 121, label: 'Machinery & Equipment Manufacturing' }, { id: 122, label: 'Metal Product Manufacturing' }, { id: 123, label: 'Paper Product Manufacturing' }, { id: 124, label: 'Printing, Publishing, Media Manufacturing' }, { id: 125, label: 'Wood Product Manufacturing' }, { id: 126, label: 'Other' }] },
  { id: 127, label: 'Primary Industry', children: [{ id: 128, label: 'Agriculture' }, { id: 129, label: 'Commercial Fishing' }, { id: 130, label: 'Forestry & Logging' }, { id: 131, label: 'Mining' }, { id: 192, label: 'Other' }, { id: 193, label: 'Oil & Gas' }] },
  { id: 132, label: 'Professional Services', children: [{ id: 133, label: 'Architectural Services' }, { id: 134, label: 'Child Care Services' }, { id: 135, label: 'Cleaning Services' }, { id: 136, label: 'Education Services' }, { id: 137, label: 'Engineering Services' }, { id: 138, label: 'IT Services' }, { id: 139, label: 'Legal Services' }, { id: 140, label: 'Marketing Services' }, { id: 141, label: 'Pest Control Services' }, { id: 142, label: 'Property Developers' }, { id: 143, label: 'Real Estate Services' }, { id: 144, label: 'Recruitment Services' }, { id: 145, label: 'Rental, Hiring Services' }, { id: 146, label: 'Storage Services' }, { id: 147, label: 'Travel Agent, Tour Services' }, { id: 148, label: 'Veterinary Services' }, { id: 149, label: 'Other' }, { id: 196, label: 'Administrative & Support Services' }, { id: 203, label: 'Labour Hire' }, { id: 204, label: 'Security Services' }] },
  { id: 150, label: 'Retail', children: [{ id: 151, label: 'Antique & Used Goods' }, { id: 152, label: 'Clothing, Footwear' }, { id: 153, label: 'Department Stores' }, { id: 154, label: 'Flower Retailing' }, { id: 155, label: 'Furniture Retailing' }, { id: 156, label: 'Garden Supplies' }, { id: 157, label: 'Hardware & Building Supplies' }, { id: 158, label: 'Homeware Retailing' }, { id: 159, label: 'Liquor Retailing' }, { id: 160, label: 'Marine Retailing' }, { id: 161, label: 'Motor Vehicle Retailing' }, { id: 162, label: 'Newsagency, Book Retailing' }, { id: 163, label: 'Personal Services' }, { id: 164, label: 'Pharmaceutical Goods' }, { id: 165, label: 'Sport & Camping Equipment' }, { id: 166, label: 'Stationery Goods' }, { id: 167, label: 'Supermarket, Grocery & Food Retailing' }, { id: 168, label: 'Tools & Equipment Retailing' }, { id: 169, label: 'Toy & Game Retailing' }, { id: 170, label: 'Watch & Jewellery Retailing' }, { id: 171, label: 'Other' }, { id: 190, label: 'Electronics & Electrical Retailing' }, { id: 191, label: 'Online Retailing' }] },
  { id: 172, label: 'Transport', children: [{ id: 173, label: 'Freight, Courier, Pick-up Services' }, { id: 174, label: 'Taxi, Uber Services' }, { id: 175, label: 'Rail Transport' }, { id: 176, label: 'Road Transport' }, { id: 177, label: 'Water Transport' }, { id: 178, label: 'Other' }] },
  { id: 179, label: 'Wholesale Trade', children: [{ id: 180, label: 'Builders Supplies Wholesaling' }, { id: 181, label: 'Farm Produce Wholesaling' }, { id: 182, label: 'Food & Drink Wholesaling' }, { id: 183, label: 'Household Good Wholesaling' }, { id: 184, label: 'Machinery & Equipment Wholesaling' }, { id: 185, label: 'Mineral, Metal & Chemical Wholesaling' }, { id: 186, label: 'Motor Vehicle Wholesaling' }, { id: 187, label: 'Clothing, Footwear, Textile Wholesaling' }, { id: 188, label: 'Other' }] },
  { id: 189, label: 'Other', children: [] },
  { id: 194, label: 'Utilities', children: [{ id: 202, label: 'Other' }] },
  { id: 198, label: 'Government', children: [{ id: 199, label: 'Defence' }, { id: 200, label: 'Public administration & Safety' }] },
];

const CONSUMER_PURPOSES = [
  { id: 42, label: 'Purchase' },
  { id: 41, label: 'Refinance' },
  { id: 20, label: 'Car' },
  { id: 21, label: 'Motorcycle' },
  { id: 22, label: 'Caravan' },
  { id: 23, label: 'Other Vehicle' },
  { id: 24, label: 'Personal Loan' },
];

const COMMERCIAL_PURPOSES = [
  { id: 1, label: 'Day-to-day Capital' },
  { id: 3, label: 'Vehicles or Transport' },
  { id: 14, label: 'Machinery or Equipment' },
  { id: 13, label: 'New Fit-out' },
  { id: 19, label: 'Staff Recruitment Costs' },
  { id: 11, label: 'Expansion' },
  { id: 4, label: 'Renovation' },
  { id: 15, label: 'Pay Domestic or International Suppliers' },
  { id: 18, label: 'Waiting for Invoices to be Paid' },
  { id: 16, label: 'Property' },
  { id: 17, label: 'Development & Construction' },
  { id: 9, label: 'Start a New Business' },
  { id: 10, label: 'Purchase Existing Business' },
  { id: 8, label: 'Other' },
];

const SELECT_CLS = 'w-full rounded-xl bg-secondary px-3.5 py-2 text-[14px] text-foreground h-10 border border-transparent transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none';
const LABEL_CLS = 'block text-[13px] font-medium text-muted-foreground mb-2';
const TEXTAREA_CLS = 'w-full rounded-xl bg-secondary px-4 py-2.5 text-[14px] text-foreground transition-all focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-background placeholder:text-muted-foreground border border-transparent resize-none';

// ── Component ─────────────────────────────────────────────────────────────────

export default function AddLead() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<'consumer' | 'commercial'>('consumer');
  const [submitting, setSubmitting] = useState(false);
  const [createdAppId, setCreatedAppId] = useState<string | null>(null);

  // Shared fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');

  // Consumer-specific
  const [purposeId, setPurposeId] = useState<number | ''>('');

  // Commercial-specific
  const [commercialPurposeId, setCommercialPurposeId] = useState<number | ''>('');
  const [businessName, setBusinessName] = useState('');
  const [abn, setAbn] = useState('');
  const [parentIndustryId, setParentIndustryId] = useState<number | ''>('');
  const [subIndustryId, setSubIndustryId] = useState<number | ''>('');
  const [postcode, setPostcode] = useState('');
  const [monthlySales, setMonthlySales] = useState('');

  // Document upload
  const [uploading, setUploading] = useState(false);
  const [uploadedDocs, setUploadedDocs] = useState<{ filename: string }[]>([]);

  // Auto-populate from existing referrals
  useEffect(() => {
    api.get('/external-referrers/my-referrals')
      .then(({ data }) => {
        const pending = data.find((r: { status: string; referred_client_name?: string; referred_email: string }) =>
          r.status === 'pending' || r.status === 'signed_up'
        );
        if (pending) {
          if (pending.referred_client_name) {
            const parts = (pending.referred_client_name as string).split(' ');
            setFirstName(parts[0] || '');
            setLastName(parts.slice(1).join(' ') || '');
          }
          setEmail(pending.referred_email || '');
        }
      })
      .catch(() => {});
  }, []);

  const selectedParent = INDUSTRIES.find((i) => i.id === parentIndustryId);
  const subChildren = selectedParent?.children ?? [];

  const resolvedIndustryId = (): number | undefined => {
    if (subIndustryId) return subIndustryId as number;
    if (parentIndustryId) return parentIndustryId as number;
    return undefined;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !mobile.trim() || !amount) {
      toast('Please fill in all required fields', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const extraData: Record<string, string> = { applicant_email: email.trim() };

      const payload: Record<string, unknown> = {
        loan_type: tab === 'consumer' ? 'personal' : 'business_loan',
        amount: parseFloat(amount),
        notes: notes || null,
        applicant_first_name: firstName.trim(),
        applicant_last_name: lastName.trim(),
        applicant_mobile: mobile.trim(),
        lend_extra_data: JSON.stringify(extraData),
      };

      if (tab === 'consumer') {
        if (purposeId) payload.loan_purpose_id = purposeId;
      } else {
        if (commercialPurposeId) payload.loan_purpose_id = commercialPurposeId;
        if (businessName.trim()) payload.business_name = businessName.trim();
        if (abn.trim()) payload.business_abn = abn.trim();
        const industryId = resolvedIndustryId();
        if (industryId) payload.business_industry_id = industryId;
        if (postcode.trim()) payload.applicant_postcode = postcode.trim();
        if (monthlySales) payload.business_monthly_sales = parseFloat(monthlySales);
      }

      const { data } = await api.post('/applications', payload);
      setCreatedAppId(data.id);
      toast('Lead submitted successfully', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to submit lead'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !createdAppId) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('doc_type', 'other');
      fd.append('label', file.name);
      await api.post(`/documents/upload/${createdAppId}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setUploadedDocs((prev) => [...prev, { filename: file.name }]);
      toast('Document uploaded', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, 'Failed to upload document'), 'error');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const handleTabChange = (newTab: 'consumer' | 'commercial') => {
    setTab(newTab);
    setPurposeId('');
    setCommercialPurposeId('');
    setBusinessName('');
    setAbn('');
    setParentIndustryId('');
    setSubIndustryId('');
    setPostcode('');
    setMonthlySales('');
  };

  // ── Success state ─────────────────────────────────────────────────────────

  if (createdAppId) {
    return (
      <div className="mx-auto max-w-xl">
        <GlassCard>
          <div className="text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
              <svg className="h-7 w-7 text-success" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
            <div>
              <h2 className="text-[18px] font-semibold text-foreground">Lead Submitted</h2>
              <p className="text-[14px] text-muted-foreground mt-1">The lead has been created and is ready for review.</p>
            </div>

            {/* Document upload */}
            <div className="rounded-xl bg-secondary/50 p-4 text-left space-y-3">
              <p className="text-[13px] font-medium text-foreground">Upload Supporting Documents (optional)</p>
              {uploadedDocs.length > 0 && (
                <ul className="space-y-1">
                  {uploadedDocs.map((d, i) => (
                    <li key={i} className="flex items-center gap-2 text-[13px] text-foreground">
                      <svg className="h-4 w-4 text-success shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                      {d.filename}
                    </li>
                  ))}
                </ul>
              )}
              <input ref={fileInput} type="file" className="hidden" onChange={handleUpload} />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
              >
                {uploading ? 'Uploading...' : '+ Add Document'}
              </Button>
            </div>

            <div className="flex gap-3 justify-center pt-2">
              <Button onClick={() => navigate(`/referrer/applications/${createdAppId}`)}>
                View Application
              </Button>
              <Button variant="secondary" onClick={() => navigate('/referrer/applications')}>
                All Applications
              </Button>
            </div>
          </div>
        </GlassCard>
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Add Lead" subtitle="Submit a new loan lead on behalf of a client" />

      {/* Tab toggle */}
      <div className="flex gap-1 p-1 rounded-xl bg-secondary mb-6 w-fit">
        {(['consumer', 'commercial'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => handleTabChange(t)}
            className={`px-5 py-2 rounded-lg text-[13px] font-medium transition-all ${
              tab === t
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'consumer' ? 'Consumer Loan' : 'Commercial Loan'}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Personal details */}
        <GlassCard className="space-y-4">
          <h3 className="text-[14px] font-semibold text-foreground">Client Details</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLS}>First Name *</label>
              <Input
                placeholder="John"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Last Name *</label>
              <Input
                placeholder="Smith"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLS}>Email *</label>
              <Input
                type="email"
                placeholder="john@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Mobile *</label>
              <Input
                type="tel"
                placeholder="04XX XXX XXX"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                required
              />
            </div>
          </div>
        </GlassCard>

        {/* Consumer-specific */}
        {tab === 'consumer' && (
          <GlassCard className="space-y-4">
            <h3 className="text-[14px] font-semibold text-foreground">Loan Details</h3>
            <div>
              <label className={LABEL_CLS}>Purpose</label>
              <select
                value={purposeId}
                onChange={(e) => setPurposeId(e.target.value ? Number(e.target.value) : '')}
                className={SELECT_CLS}
              >
                <option value="">Select purpose...</option>
                {CONSUMER_PURPOSES.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Loan Amount *</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[14px] font-medium text-muted-foreground">$</span>
                <Input
                  type="number"
                  step="1"
                  min="1"
                  placeholder="50,000"
                  className="!pl-8"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </div>
            </div>
            <div>
              <label className={LABEL_CLS}>Notes</label>
              <textarea
                rows={3}
                className={TEXTAREA_CLS}
                placeholder="Any additional information..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </GlassCard>
        )}

        {/* Commercial-specific */}
        {tab === 'commercial' && (
          <>
            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-foreground">Business Details</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={LABEL_CLS}>Business / Entity Name</label>
                  <Input
                    placeholder="Acme Pty Ltd"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>ACN / ABN</label>
                  <Input
                    placeholder="12 345 678 901"
                    value={abn}
                    onChange={(e) => setAbn(e.target.value)}
                  />
                </div>
              </div>

              {/* Industry — hierarchical */}
              <div>
                <label className={LABEL_CLS}>Industry</label>
                <select
                  value={parentIndustryId}
                  onChange={(e) => {
                    setParentIndustryId(e.target.value ? Number(e.target.value) : '');
                    setSubIndustryId('');
                  }}
                  className={SELECT_CLS}
                >
                  <option value="">Select industry...</option>
                  {INDUSTRIES.map((ind) => (
                    <option key={ind.id} value={ind.id}>{ind.label}</option>
                  ))}
                </select>
              </div>

              {/* Sub-industry — populated based on parent */}
              {parentIndustryId !== '' && subChildren.length > 0 && (
                <div>
                  <label className={LABEL_CLS}>Sub-industry</label>
                  <select
                    value={subIndustryId}
                    onChange={(e) => setSubIndustryId(e.target.value ? Number(e.target.value) : '')}
                    className={SELECT_CLS}
                  >
                    <option value="">Select sub-industry...</option>
                    {subChildren.map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={LABEL_CLS}>Postcode</label>
                  <Input
                    placeholder="2000"
                    maxLength={4}
                    value={postcode}
                    onChange={(e) => setPostcode(e.target.value)}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>Monthly Sales ($)</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[14px] font-medium text-muted-foreground">$</span>
                    <Input
                      type="number"
                      step="1"
                      min="0"
                      placeholder="30,000"
                      className="!pl-8"
                      value={monthlySales}
                      onChange={(e) => setMonthlySales(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </GlassCard>

            <GlassCard className="space-y-4">
              <h3 className="text-[14px] font-semibold text-foreground">Loan Details</h3>
              <div>
                <label className={LABEL_CLS}>Purpose</label>
                <select
                  value={commercialPurposeId}
                  onChange={(e) => setCommercialPurposeId(e.target.value ? Number(e.target.value) : '')}
                  className={SELECT_CLS}
                >
                  <option value="">Select purpose...</option>
                  {COMMERCIAL_PURPOSES.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Loan Amount *</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[14px] font-medium text-muted-foreground">$</span>
                  <Input
                    type="number"
                    step="1"
                    min="1"
                    placeholder="100,000"
                    className="!pl-8"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div>
                <label className={LABEL_CLS}>Notes</label>
                <textarea
                  rows={3}
                  className={TEXTAREA_CLS}
                  placeholder="Any additional information..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </GlassCard>
          </>
        )}

        <div className="flex gap-3">
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit Lead'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate('/referrer/applications')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
