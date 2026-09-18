import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Users from './pages/admin/Users';
import Entities from './pages/admin/Entities';
import Departments from './pages/admin/Departments';
import Roles from './pages/admin/Roles';
import Permissions from './pages/admin/Permissions';
import FolderMappingRules from './pages/admin/FolderMappingRules';
import ActivityLogs from './pages/ActivityLogs';
import DocumentCenter from './pages/documents/DocumentCenter';
import TemplateCenter from './pages/documents/TemplateCenter';
import TaskBoard from './pages/tasks/TaskBoard';
import ChatRoom from './pages/chat/ChatRoom';
import ApprovalInbox from './pages/approvals/ApprovalInbox';
import SignatureInbox from './pages/signatures/SignatureInbox';
import NotificationCenter from './pages/notifications/NotificationCenter';
import SalesPipeline from './pages/sales/SalesPipeline';
import SalesCustomers from './pages/sales/SalesCustomers';
import SampleRequests from './pages/sales/SampleRequests';
import FieldBotChat from './pages/sales/FieldBotChat';
import WarehouseDashboard from './pages/warehouse/WarehouseDashboard';
import ItDashboard from './pages/it/ItDashboard';
import Devices from './pages/it/Devices';
import SoftwareSubscriptions from './pages/it/SoftwareSubscriptions';
import Meetings from './pages/meetings/Meetings';
import MeetingDetail from './pages/meetings/MeetingDetail';
import PaymentRequests from './pages/finance/PaymentRequests';
import PaymentRequestDetail from './pages/finance/PaymentRequestDetail';
import OnboardingBoard from './pages/hrga/OnboardingBoard';
import OffboardingBoard from './pages/hrga/OffboardingBoard';
import HrgaWorkflowDetail from './pages/hrga/HrgaWorkflowDetail';
import Workspaces from './pages/advanced/Workspaces';
import GlobalSearch from './pages/advanced/GlobalSearch';
import KnowledgeBase from './pages/advanced/KnowledgeBase';
import AutomationBuilder from './pages/advanced/AutomationBuilder';
import DecisionLog from './pages/advanced/DecisionLog';
import ManagementDashboard from './pages/advanced/ManagementDashboard';
import BriefView from './pages/advanced/BriefView';

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 24 }}>Memuat…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="admin/users" element={<Users />} />
        <Route path="admin/entities" element={<Entities />} />
        <Route path="admin/departments" element={<Departments />} />
        <Route path="admin/roles" element={<Roles />} />
        <Route path="admin/permissions" element={<Permissions />} />
        <Route path="admin/folder-rules" element={<FolderMappingRules />} />
        <Route path="activity-logs" element={<ActivityLogs />} />
        <Route path="documents" element={<DocumentCenter />} />
        <Route path="templates" element={<TemplateCenter />} />
        <Route path="tasks" element={<TaskBoard />} />
        <Route path="chat" element={<ChatRoom />} />
        <Route path="approvals" element={<ApprovalInbox />} />
        <Route path="signatures" element={<SignatureInbox />} />
        <Route path="notifications" element={<NotificationCenter />} />
        <Route path="sales/pipeline" element={<SalesPipeline />} />
        <Route path="sales/customers" element={<SalesCustomers />} />
        <Route path="sales/sample-requests" element={<SampleRequests />} />
        <Route path="sales/field-bot" element={<FieldBotChat />} />
        <Route path="warehouse" element={<WarehouseDashboard />} />
        <Route path="it/dashboard" element={<ItDashboard />} />
        <Route path="it/devices" element={<Devices />} />
        <Route path="it/subscriptions" element={<SoftwareSubscriptions />} />
        <Route path="meetings" element={<Meetings />} />
        <Route path="meetings/:id" element={<MeetingDetail />} />
        <Route path="finance/payment-requests" element={<PaymentRequests />} />
        <Route path="finance/payment-requests/:id" element={<PaymentRequestDetail />} />
        <Route path="hrga/onboarding" element={<OnboardingBoard />} />
        <Route path="hrga/offboarding" element={<OffboardingBoard />} />
        <Route path="hrga/workflows/:id" element={<HrgaWorkflowDetail />} />
        <Route path="workspaces" element={<Workspaces />} />
        <Route path="search" element={<GlobalSearch />} />
        <Route path="kb" element={<KnowledgeBase />} />
        <Route path="automation" element={<AutomationBuilder />} />
        <Route path="decision-log" element={<DecisionLog />} />
        <Route path="management" element={<ManagementDashboard />} />
        <Route path="brief" element={<BriefView />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
