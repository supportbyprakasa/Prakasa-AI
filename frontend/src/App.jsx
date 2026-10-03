import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { lazy, Suspense } from 'react';
import lazyPage from './components/lazyPage';
import Layout from './components/Layout';
import { LoadingState } from './components/EmptyState';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import AccessNotReady from './pages/AccessNotReady';
import ChangePasswordRequired from './pages/ChangePasswordRequired';
import NotFound from './pages/NotFound';
import { hasUsableAccess } from './pages/login/loginModel';
import { hasRouteAccess } from './components/navigation';

// Login, the shell and Beranda stay in the main bundle; every other page is a
// chunk of its own, loaded on first visit (Suspense in Layout and below).
const Users = lazyPage(() => import('./pages/admin/Users'));
const WorkspaceSync = lazyPage(() => import('./pages/admin/WorkspaceSync'));
const Entities = lazyPage(() => import('./pages/admin/Entities'));
const Departments = lazyPage(() => import('./pages/admin/Departments'));
const Roles = lazyPage(() => import('./pages/admin/Roles'));
const Permissions = lazyPage(() => import('./pages/admin/Permissions'));
const FolderMappingRules = lazyPage(() => import('./pages/admin/FolderMappingRules'));
const ActivityLogs = lazyPage(() => import('./pages/ActivityLogs'));
const DivisionStorage = lazyPage(() => import('./pages/documents/DivisionStorage'));
const MyDrive = lazyPage(() => import('./pages/mydrive/MyDrive'));
const Mail = lazyPage(() => import('./pages/google/Mail'));
const GoogleChat = lazyPage(() => import('./pages/google/Chat'));
const GoogleFiles = lazyPage(() => import('./pages/google/GoogleFiles'));
const GoogleEditor = lazyPage(() => import('./pages/google/GoogleEditor'));
const Groups = lazyPage(() => import('./pages/google/Groups'));
const Analytics = lazyPage(() => import('./pages/google/Analytics'));
const Projects = lazyPage(() => import('./pages/projects/Projects'));
const ProjectPage = lazyPage(() => import('./pages/projects/ProjectPage'));
const TaskBoard = lazyPage(() => import('./pages/tasks/TaskBoard'));
const TaskDetail = lazyPage(() => import('./pages/tasks/TaskDetail'));
const SignatureInbox = lazyPage(() => import('./pages/signatures/SignatureInbox'));
const SignatureAsset = lazyPage(() => import('./pages/signatures/SignatureAsset'));
const Letterhead = lazyPage(() => import('./pages/signatures/Letterhead'));
const NotificationCenter = lazyPage(() => import('./pages/notifications/NotificationCenter'));
const SalesPipeline = lazyPage(() => import('./pages/sales/SalesPipeline'));
const SalesCustomers = lazyPage(() => import('./pages/sales/SalesCustomers'));
const SalesCustomerDetail = lazyPage(() => import('./pages/sales/SalesCustomerDetail'));
const SalesLeads = lazyPage(() => import('./pages/sales/SalesLeads'));
const SalesOrders = lazyPage(() => import('./pages/sales/SalesOrders'));
const SalesOrderDetail = lazyPage(() => import('./pages/sales/SalesOrderDetail'));
const SalesAccurateBatch = lazyPage(() => import('./pages/sales/SalesAccurateBatch'));
const DataAccurate = lazyPage(() => import('./pages/accurate/DataAccurate'));
const ProcurementDashboard = lazyPage(() => import('./pages/procurement/ProcurementDashboard'));
const SalesOrderForm = lazyPage(() => import('./pages/sales/SalesOrderForm'));
const SalesPrint = lazyPage(() => import('./pages/sales/SalesPrint'));
const WarehouseDashboard = lazyPage(() => import('./pages/warehouse/WarehouseDashboard'));
const WarehouseMovementForm = lazyPage(() => import('./pages/warehouse/WarehouseMovementForm'));
const WarehouseMovementDetail = lazyPage(() => import('./pages/warehouse/WarehouseMovementDetail'));
const ItDashboard = lazyPage(() => import('./pages/it/ItDashboard'));
const ItTickets = lazyPage(() => import('./pages/it/ItTickets'));
const ItTicketForm = lazyPage(() => import('./pages/it/ItTicketForm'));
const ItTicketDetail = lazyPage(() => import('./pages/it/ItTicketDetail'));
const Devices = lazyPage(() => import('./pages/it/Devices'));
const Directory = lazyPage(() => import('./pages/people/Directory'));
const GaServices = lazyPage(() => import('./pages/ga/GaServices'));
const GaOperations = lazyPage(() => import('./pages/ga/GaOperations'));
const DocTemplates = lazyPage(() => import('./pages/documents/DocTemplates'));
const RetailCommerce = lazyPage(() => import('./pages/retail/RetailCommerce'));
const FinanceReceivables = lazyPage(() => import('./pages/finance/FinanceReceivables'));
const FinancePayables = lazyPage(() => import('./pages/finance/FinancePayables'));
const MarketingInsights = lazyPage(() => import('./pages/marketing/MarketingInsights'));
const MarketingCampaigns = lazyPage(() => import('./pages/marketing/MarketingCampaigns'));
const DivisionDashboard = lazyPage(() => import('./pages/management/DivisionDashboard'));
const NotificationPolicy = lazyPage(() => import('./pages/admin/NotificationPolicy'));
const GaRequestDetail = lazyPage(() => import('./pages/ga/GaRequestDetail'));
const GaBookingDetail = lazyPage(() => import('./pages/ga/GaBookingDetail'));
const DeviceDetail = lazyPage(() => import('./pages/it/DeviceDetail'));
const SoftwareSubscriptions = lazyPage(() => import('./pages/it/SoftwareSubscriptions'));
const SubscriptionDetail = lazyPage(() => import('./pages/it/SubscriptionDetail'));
const Infrastructure = lazyPage(() => import('./pages/it/Infrastructure'));
const Calendar = lazyPage(() => import('./pages/calendar/Calendar'));
const PaymentRequests = lazyPage(() => import('./pages/finance/PaymentRequests'));
const PaymentRequestDetail = lazyPage(() => import('./pages/finance/PaymentRequestDetail'));
const OnboardingBoard = lazyPage(() => import('./pages/hrga/OnboardingBoard'));
const OffboardingBoard = lazyPage(() => import('./pages/hrga/OffboardingBoard'));
const HrgaWorkflowDetail = lazyPage(() => import('./pages/hrga/HrgaWorkflowDetail'));
const ChecklistTemplates = lazyPage(() => import('./pages/hrga/ChecklistTemplates'));
const GlobalSearch = lazyPage(() => import('./pages/advanced/GlobalSearch'));
const ManagementDashboard = lazyPage(() => import('./pages/advanced/ManagementDashboard'));
const ManagementFlow = lazyPage(() => import('./pages/advanced/ManagementFlow'));
const Escalations = lazyPage(() => import('./pages/advanced/Escalations'));
const Roadmap = lazyPage(() => import('./pages/advanced/Roadmap'));
const Targets = lazyPage(() => import('./pages/advanced/Targets'));
const DocumentTypes = lazyPage(() => import('./pages/admin/DocumentTypes'));
const SignatureRules = lazyPage(() => import('./pages/admin/SignatureRules'));
const IntegrationLogs = lazyPage(() => import('./pages/admin/IntegrationLogs'));
const ApprovalMatrix = lazyPage(() => import('./pages/admin/ApprovalMatrix'));
const SignaturePrecheckLogs = lazyPage(() => import('./pages/admin/SignaturePrecheckLogs'));
const SignatureDetail = lazyPage(() => import('./pages/signatures/SignatureDetail'));
const VerifyDocument = lazyPage(() => import('./pages/public/VerifyDocument'));
const AICommandCenter = lazyPage(() => import('./pages/ai/AICommandCenter'));
const AIUsage = lazyPage(() => import('./pages/admin/AIUsage'));
const AIProviderSettings = lazyPage(() => import('./pages/admin/AIProviderSettings'));
const AccurateIntegration = lazyPage(() => import('./pages/admin/AccurateIntegration'));
const Handbook = lazyPage(() => import('./pages/handbook/Handbook'));
const Account = lazyPage(() => import('./pages/account/Account'));

// Design gallery: development builds only (docs/program-desain-admin-console.md).
const DesignGallery = import.meta.env.DEV ? lazy(() => import('./pages/dev/DesignGallery')) : null;

function RequireAuth({ children, path }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingState />;
  if (!user) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    const query = returnTo && returnTo !== '/' ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
    return <Navigate to={`/login${query}`} replace />;
  }
  if (user.passwordChangeRequired) return <ChangePasswordRequired />;
  if (!hasUsableAccess(user)) return <AccessNotReady />;
  if (path && !hasRouteAccess(path, user.permissions)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  // Full-page routes outside the Layout (verify, AI, print) suspend here;
  // pages inside the Layout suspend in its own <Suspense> around <Outlet />.
  return (
    <Suspense fallback={<LoadingState />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/verify/:code" element={<VerifyDocument />} />
        <Route path="/ai-command" element={<RequireAuth path="/ai-command"><AICommandCenter /></RequireAuth>} />
        {/* Printable Sales documents: full page, no app chrome. */}
        <Route path="/print/sales/:doc/:id" element={<RequireAuth path="/sales/orders"><SalesPrint /></RequireAuth>} />
        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          {DesignGallery && <Route path="/__design" element={<DesignGallery />} />}
          <Route index element={<Dashboard />} />
          <Route path="admin/users" element={<Users />} />
          <Route path="admin/workspace-sync" element={<WorkspaceSync />} />
          <Route path="admin/entities" element={<Entities />} />
          <Route path="admin/departments" element={<Departments />} />
          <Route path="admin/roles" element={<Roles />} />
          <Route path="admin/permissions" element={<Permissions />} />
          <Route path="admin/folder-rules" element={<FolderMappingRules />} />
          <Route path="activity-logs" element={<ActivityLogs />} />
          <Route path="division-storage" element={<DivisionStorage />} />
          <Route path="my-drive" element={<MyDrive />} />
          <Route path="mail" element={<Mail />} />
          <Route path="chat" element={<GoogleChat />} />
          <Route path="docs" element={<GoogleFiles kind="document" />} />
          <Route path="docs/:fileId" element={<GoogleEditor kind="document" />} />
          <Route path="sheets" element={<GoogleFiles kind="spreadsheet" />} />
          <Route path="sheets/:fileId" element={<GoogleEditor kind="spreadsheet" />} />
          <Route path="slides" element={<GoogleFiles kind="presentation" />} />
          <Route path="slides/:fileId" element={<GoogleEditor kind="presentation" />} />
          <Route path="groups" element={<Groups />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:spaceId" element={<ProjectPage />} />
          <Route path="tasks" element={<TaskBoard />} />
          <Route path="tasks/:id" element={<TaskDetail />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="signatures" element={<SignatureInbox />} />
          <Route path="signatures/asset" element={<SignatureAsset />} />
          <Route path="signatures/letterhead" element={<Letterhead />} />
          <Route path="signatures/:id" element={<SignatureDetail />} />
          <Route path="notifications" element={<NotificationCenter />} />
          <Route path="sales/pipeline" element={<SalesPipeline />} />
          <Route path="sales/customers" element={<SalesCustomers />} />
          <Route path="sales/customers/:id" element={<SalesCustomerDetail />} />
          <Route path="sales/leads" element={<SalesLeads />} />
          <Route path="sales/orders" element={<SalesOrders />} />
          <Route path="sales/orders/new" element={<SalesOrderForm />} />
          <Route path="sales/orders/:id/edit" element={<SalesOrderForm />} />
          <Route path="sales/orders/:id" element={<SalesOrderDetail />} />
          <Route path="sales/orders/accurate/:id" element={<SalesAccurateBatch />} />
          <Route path="data-accurate" element={<DataAccurate />} />
          <Route path="data-accurate/:id" element={<SalesAccurateBatch />} />
          <Route path="warehouse" element={<WarehouseDashboard />} />
          <Route path="warehouse/movements/:type/new" element={<WarehouseMovementForm />} />
          <Route path="warehouse/movements/:type/:id" element={<WarehouseMovementDetail />} />
          <Route path="warehouse/movements/:type/:id/edit" element={<WarehouseMovementForm />} />
          <Route path="it/dashboard" element={<ItDashboard />} />
          <Route path="it/tickets" element={<ItTickets />} />
          <Route path="it/tickets/new" element={<ItTicketForm />} />
          <Route path="it/tickets/:id" element={<ItTicketDetail />} />
          <Route path="people/directory" element={<Directory />} />
          <Route path="people/directory/:key" element={<Directory />} />
          <Route path="ga" element={<GaServices />} />
          <Route path="ga/operations" element={<GaOperations />} />
          <Route path="doc-templates" element={<DocTemplates />} />
          <Route path="division-dashboard" element={<DivisionDashboard />} />
          <Route path="admin/notification-policy" element={<NotificationPolicy />} />
          <Route path="ga/requests/:id" element={<GaRequestDetail />} />
          <Route path="ga/bookings/:id" element={<GaBookingDetail />} />
          <Route path="it/devices" element={<Devices />} />
          <Route path="it/devices/:id" element={<DeviceDetail />} />
          <Route path="it/subscriptions" element={<SoftwareSubscriptions />} />
          <Route path="it/subscriptions/:id" element={<SubscriptionDetail />} />
          <Route path="it/infrastructure" element={<Infrastructure />} />
          <Route path="finance/payment-requests" element={<PaymentRequests />} />
          <Route path="finance/payment-requests/:id" element={<PaymentRequestDetail />} />
          <Route path="finance/receivables" element={<FinanceReceivables />} />
          <Route path="finance/payables" element={<FinancePayables />} />
          <Route path="coming-soon/finance" element={<Navigate to="/finance/receivables" replace />} />
          <Route path="procurement" element={<ProcurementDashboard />} />
          <Route path="coming-soon/procurement" element={<Navigate to="/procurement" replace />} />
          <Route path="retail-commerce" element={<RetailCommerce />} />
          <Route path="coming-soon/retail-commerce" element={<Navigate to="/retail-commerce" replace />} />
          <Route path="marketing/insights" element={<MarketingInsights />} />
          <Route path="marketing/campaigns" element={<MarketingCampaigns />} />
          <Route path="coming-soon/marketing" element={<Navigate to="/marketing/insights" replace />} />
          <Route path="hrga/onboarding" element={<OnboardingBoard />} />
          <Route path="hrga/offboarding" element={<OffboardingBoard />} />
          <Route path="hrga/workflows/:id" element={<HrgaWorkflowDetail />} />
          <Route path="hrga/checklist-templates" element={<ChecklistTemplates />} />
          <Route path="search" element={<GlobalSearch />} />
          <Route path="management" element={<ManagementDashboard />} />
          <Route path="management/flow" element={<ManagementFlow />} />
          <Route path="escalations" element={<Escalations />} />
          <Route path="roadmap" element={<Roadmap />} />
          <Route path="targets" element={<Targets />} />
          <Route path="admin/document-types" element={<DocumentTypes />} />
          <Route path="admin/signature-rules" element={<SignatureRules />} />
          <Route path="admin/integration-logs" element={<IntegrationLogs />} />
          <Route path="admin/approval-matrix" element={<ApprovalMatrix />} />
          <Route path="admin/signature-precheck" element={<SignaturePrecheckLogs />} />
          <Route path="admin/ai-usage" element={<AIUsage />} />
          <Route path="admin/ai-provider-settings" element={<AIProviderSettings />} />
          <Route path="admin/accurate" element={<AccurateIntegration />} />
          <Route path="panduan" element={<Handbook />} />
          {/* Akun saya: opened from the account menu, every signed-in user. */}
          <Route path="akun" element={<Account />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
