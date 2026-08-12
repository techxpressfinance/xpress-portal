import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import ImpersonationBanner from './components/ImpersonationBanner';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import { ToastProvider } from './components/Toast';
import { AuthProvider } from './contexts/AuthContext';
import { TenantProvider } from './contexts/TenantContext';
import { useAuth } from './hooks/useAuth';

const ActivityLogs = lazy(() => import('./pages/admin/ActivityLogs'));
const DeletedApplications = lazy(() => import('./pages/admin/DeletedApplications'));
const AllApplications = lazy(() => import('./pages/admin/AllApplications'));
const KanbanBoard = lazy(() => import('./pages/admin/KanbanBoard'));
const CreateApplication = lazy(() => import('./pages/admin/CreateApplication'));
const CreateCommercialEntity = lazy(() => import('./pages/admin/CreateCommercialEntity'));
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'));
const ReviewApplication = lazy(() => import('./pages/admin/ReviewApplication'));
const UserManagement = lazy(() => import('./pages/admin/UserManagement'));
const BrokerManagement = lazy(() => import('./pages/admin/BrokerManagement'));
const AdminManagement = lazy(() => import('./pages/admin/AdminManagement'));
const BrokerGroups = lazy(() => import('./pages/admin/BrokerGroups'));
const ReferrerManagement = lazy(() => import('./pages/admin/ReferrerManagement'));
const LenderManagement = lazy(() => import('./pages/admin/LenderManagement'));
const LenderDetail = lazy(() => import('./pages/admin/LenderDetail'));
const Analytics = lazy(() => import('./pages/admin/Analytics'));
const ArrearsBook = lazy(() => import('./pages/admin/ArrearsBook'));
const Tasks = lazy(() => import('./pages/admin/Tasks'));
const TaskDetail = lazy(() => import('./pages/admin/TaskDetail'));
const Contacts = lazy(() => import('./pages/admin/Contacts'));
const ContactDetail = lazy(() => import('./pages/admin/ContactDetail'));
const Companies = lazy(() => import('./pages/admin/Companies'));
const CompanyDetail = lazy(() => import('./pages/admin/CompanyDetail'));
const QuoteSheets = lazy(() => import('./pages/admin/QuoteSheets'));
const BasCalculator = lazy(() => import('./pages/admin/BasCalculator'));
const AdminServiceRequests = lazy(() => import('./pages/admin/ServiceRequests'));
const ServiceRequestDetail = lazy(() => import('./pages/admin/ServiceRequestDetail'));
const ClientServiceRequests = lazy(() => import('./pages/client/ServiceRequests'));
const ReferrerApplications = lazy(() => import('./pages/referrer/Applications'));
const ReferrerClients = lazy(() => import('./pages/referrer/Clients'));
const ReferrerApplicationDetail = lazy(() => import('./pages/referrer/ApplicationDetail'));
const ReferrerMessages = lazy(() => import('./pages/referrer/Messages'));
const ReferrerAddLead = lazy(() => import('./pages/referrer/AddLead'));
const ReferrerServiceRequests = lazy(() => import('./pages/referrer/ServiceRequests'));
const ReferrerBusinessDetails = lazy(() => import('./pages/referrer/BusinessDetails'));
const ApplicationDetail = lazy(() => import('./pages/client/ApplicationDetail'));
const Applications = lazy(() => import('./pages/client/Applications'));
const ClientDashboard = lazy(() => import('./pages/client/Dashboard'));
const NewApplication = lazy(() => import('./pages/client/NewApplication'));
const Profile = lazy(() => import('./pages/client/Profile'));
const AdminMessages = lazy(() => import('./pages/admin/Messages'));
const ClientMessages = lazy(() => import('./pages/client/Messages'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));
const ResendVerification = lazy(() => import('./pages/ResendVerification'));
const PlatformLogin = lazy(() => import('./pages/PlatformLogin'));
const SetupAccount = lazy(() => import('./pages/SetupAccount'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const PublicApply = lazy(() => import('./pages/PublicApply'));
const PlatformDashboard = lazy(() => import('./pages/platform/Dashboard'));
const TenantManagement = lazy(() => import('./pages/platform/TenantManagement'));
const CreateTenant = lazy(() => import('./pages/platform/CreateTenant'));
const TenantDetail = lazy(() => import('./pages/platform/TenantDetail'));

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'super_admin') return <Navigate to="/platform" replace />;
  if (user.role === 'referrer') return <Navigate to="/referrer/applications" replace />;
  return <Navigate to={user.role === 'client' ? '/dashboard' : '/admin'} replace />;
}

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <TenantProvider>
      <AuthProvider>
        <ToastProvider>
          <ImpersonationBanner />
          <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>}>
          <Routes>
            <Route path="/platform-login" element={<PlatformLogin />} />
            <Route path="/apply/:token" element={<PublicApply />} />
            <Route path="/setup-account" element={<SetupAccount />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/resend-verification" element={<ResendVerification />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route element={<Layout />}>
              <Route path="/" element={<HomeRedirect />} />

              {/* Client Routes */}
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute roles={['client']}>
                    <ClientDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/applications"
                element={
                  <ProtectedRoute roles={['client']}>
                    <Applications />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/applications/new"
                element={
                  <ProtectedRoute roles={['client']}>
                    <NewApplication />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/applications/:id"
                element={
                  <ProtectedRoute roles={['client']}>
                    <ApplicationDetail />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/messages"
                element={
                  <ProtectedRoute roles={['client']}>
                    <ClientMessages />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/service-requests"
                element={
                  <ProtectedRoute roles={['client']}>
                    <ClientServiceRequests />
                  </ProtectedRoute>
                }
              />

              {/* Shared Routes */}
              <Route
                path="/profile"
                element={
                  <ProtectedRoute>
                    <Profile />
                  </ProtectedRoute>
                }
              />

              {/* Admin/Broker Routes */}
              <Route
                path="/admin"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <AdminDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/applications"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <AllApplications />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/board"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <KanbanBoard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/applications/new"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <CreateApplication />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/applications/new-entity"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <CreateCommercialEntity />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/applications/:id"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <ReviewApplication />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/messages"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <AdminMessages />
                  </ProtectedRoute>
                }
              />
              <Route path="/admin/invite-clients" element={<Navigate to="/admin/users" replace />} />
              <Route path="/admin/create-broker" element={<Navigate to="/admin/brokers" replace />} />
              <Route path="/admin/create-referrer" element={<Navigate to="/admin/referrers" replace />} />
              <Route
                path="/admin/users"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <UserManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/brokers"
                element={
                  <ProtectedRoute roles={['admin']}>
                    <BrokerManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/referrers"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <ReferrerManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/admins"
                element={
                  <ProtectedRoute roles={['admin']}>
                    <AdminManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/broker-groups"
                element={
                  <ProtectedRoute roles={['admin']}>
                    <BrokerGroups />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/analytics"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <Analytics />
                  </ProtectedRoute>
                }
              />
              <Route path="/admin/lender-analytics" element={<Navigate to="/admin/analytics?tab=lender" replace />} />
              <Route path="/admin/broker-analytics" element={<Navigate to="/admin/analytics?tab=broker" replace />} />
              <Route path="/admin/settled-deals" element={<Navigate to="/admin/analytics?tab=settled" replace />} />
              <Route
                path="/admin/arrears"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <ArrearsBook />
                  </ProtectedRoute>
                }
              />
              {/* The arrears book shipped as an Analytics tab first — keep that link working. */}
              <Route path="/admin/analytics/arrears" element={<Navigate to="/admin/arrears" replace />} />
              <Route
                path="/admin/lenders"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <LenderManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/lenders/:id"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <LenderDetail />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/tasks"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <Tasks />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/tasks/:id"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <TaskDetail />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/quotes"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <QuoteSheets />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/calculators"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <BasCalculator />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/contacts"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <Contacts />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/contacts/:id"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <ContactDetail />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/companies"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <Companies />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/companies/:id"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <CompanyDetail />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/service-requests"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <AdminServiceRequests />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/service-requests/:id"
                element={
                  <ProtectedRoute roles={['admin', 'broker']}>
                    <ServiceRequestDetail />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/activity"
                element={
                  <ProtectedRoute roles={['admin']}>
                    <ActivityLogs />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/deleted-applications"
                element={
                  <ProtectedRoute roles={['admin']}>
                    <DeletedApplications />
                  </ProtectedRoute>
                }
              />

              {/* Super Admin / Platform Routes */}
              <Route
                path="/platform"
                element={
                  <ProtectedRoute roles={['super_admin']}>
                    <PlatformDashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/platform/tenants"
                element={
                  <ProtectedRoute roles={['super_admin']}>
                    <TenantManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/platform/tenants/new"
                element={
                  <ProtectedRoute roles={['super_admin']}>
                    <CreateTenant />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/platform/tenants/:id"
                element={
                  <ProtectedRoute roles={['super_admin']}>
                    <TenantDetail />
                  </ProtectedRoute>
                }
              />

              {/* Referrer Routes */}
              <Route
                path="/referrer"
                element={<Navigate to="/referrer/applications" replace />}
              />
              <Route
                path="/referrer/applications"
                element={
                  <ProtectedRoute roles={['referrer']}>
                    <ReferrerApplications />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/referrer/applications/:id"
                element={
                  <ProtectedRoute roles={['referrer']}>
                    <ReferrerApplicationDetail />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/referrer/clients"
                element={
                  <ProtectedRoute roles={['referrer']}>
                    <ReferrerClients />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/referrer/messages"
                element={
                  <ProtectedRoute roles={['referrer']}>
                    <ReferrerMessages />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/referrer/add-lead"
                element={
                  <ProtectedRoute roles={['referrer']}>
                    <ReferrerAddLead />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/referrer/service-requests"
                element={
                  <ProtectedRoute roles={['referrer']}>
                    <ReferrerServiceRequests />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/referrer/business-details"
                element={
                  <ProtectedRoute roles={['referrer']}>
                    <ReferrerBusinessDetails />
                  </ProtectedRoute>
                }
              />
            </Route>
          </Routes>
          </Suspense>
        </ToastProvider>
      </AuthProvider>
      </TenantProvider>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
