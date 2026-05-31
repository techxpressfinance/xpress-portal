import {
  Car, Bike, Caravan, Sailboat, CreditCard, House, RefreshCw,
  Briefcase, Building2, Wrench, Banknote, FileText, Rocket, Truck,
  type LucideIcon,
} from 'lucide-react';

interface LoanTypeIconProps {
  type: string;
  className?: string;
}

// Distinct professional line icons per loan type (replaces the old emoji glyphs).
const LOAN_TYPE_ICONS: Record<string, LucideIcon> = {
  // Coarse loan types
  personal: CreditCard,
  home: House,
  home_loan: House,
  business: Briefcase,
  business_loan: Briefcase,
  vehicle: Car,
  equipment_finance: Wrench,
  commercial_property: Building2,
  // Consumer sub-types
  car: Car,
  motorcycle: Bike,
  caravan: Caravan,
  other_vehicle: Sailboat,
  purchase: House,
  refinance: RefreshCw,
  // Commercial sub-types
  day_to_day_capital: Banknote,
  vehicles_or_transport: Truck,
  new_fit_out: Wrench,
  waiting_for_invoices: FileText,
  property: Building2,
  new_business: Rocket,
  other: FileText,
};

/** Professional line icon for a loan type, replacing the old emoji glyphs. */
export default function LoanTypeIcon({ type, className = 'h-5 w-5' }: LoanTypeIconProps) {
  const Icon = LOAN_TYPE_ICONS[type] ?? Banknote;
  return <Icon className={className} strokeWidth={1.5} aria-hidden="true" />;
}
