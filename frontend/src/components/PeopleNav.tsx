import { NavLink } from 'react-router-dom';

const TABS = [
  { label: 'Clients', to: '/admin/users' },
  { label: 'Brokers', to: '/admin/brokers' },
  { label: 'Referrers', to: '/admin/referrers' },
];

export default function PeopleNav() {
  return (
    <div className="flex gap-0 border-b border-border mb-6">
      {TABS.map(tab => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end
          className={({ isActive }) =>
            `px-5 py-2.5 text-[13px] font-medium transition-colors border-b-2 -mb-px ${
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  );
}
