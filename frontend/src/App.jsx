import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import DivisionHub from './pages/DivisionHub';
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
import TaskDetail from './pages/tasks/TaskDetail';
import ChatRoom from './pages/chat/ChatRoom';
import ApprovalInbox from './pages/approvals/ApprovalInbox';
import SignatureInbox from './pages/signatures/SignatureInbox';
import SignatureAsset from './pages/signatures/SignatureAsset';
import NotificationCenter from './pages/notifications/NotificationCenter';
import SalesPipeline from './pages/sales/SalesPipeline';
import SalesCustomers from './pages/sales/SalesCustomers';
import SalesCustomerDetail from './pages/sales/SalesCustomerDetail';
import SampleRequests from './pages/sales/SampleRequests';
import FieldBotChat from './pages/sales/FieldBotChat';
import WarehouseDashboard from './pages/warehouse/WarehouseDashboard';
import ItDashboard from './pages/it/ItDashboard';
import Devices from './pages/it/Devices';
import DeviceDetail from './pages/it/DeviceDetail';
import SoftwareSubscriptions from './pages/it/SoftwareSubscriptions';
import SubscriptionDetail from './pages/it/SubscriptionDetail';
import Meetings from './pages/meetings/Meetings';
import MeetingDetail from './pages/meetings/MeetingDetail';
import PaymentRequests from './pages/finance/PaymentRequests';
import PaymentRequestDetail from './pages/finance/PaymentRequestDetail';
import OnboardingBoard from './pages/hrga/OnboardingBoard';
import OffboardingBoard from './pages/hrga/OffboardingBoard';
import HrgaWorkflowDetail from './pages/hrga/HrgaWorkflowDetail';
import ChecklistTemplates from './pages/hrga/ChecklistTemplates';
import Workspaces from './pages/advanced/Workspaces';
import GlobalSearch from './pages/advanced/GlobalSearch';
import KnowledgeBase from './pages/advanced/KnowledgeBase';
import AutomationBuilder from './pages/advanced/AutomationBuilder';
import DecisionLog from './pages/advanced/DecisionLog';
import ManagementDashboard from './pages/advanced/ManagementDashboard';
import BriefView from './pages/advanced/BriefView';
import Timeline from './pages/advanced/Timeline';
import DataClassification from './pages/advanced/DataClassification';
import CrossDivisionWorkspace from './pages/advanced/CrossDivisionWorkspace';
import FormCatalog from './pages/forms/FormCatalog';
import FormRenderer from './pages/forms/FormRenderer';
import MySubmissions from './pages/forms/MySubmissions';
import SubmissionDetail from './pages/forms/SubmissionDetail';
import FormAdminList from './pages/admin/FormAdminList';
import FormBuilder from './pages/admin/FormBuilder';
import WorkflowDefinitions from './pages/admin/WorkflowDefinitions';
import WorkflowEditor from './pages/admin/WorkflowEditor';
import DocumentTypes from './pages/admin/DocumentTypes';
import SignatureRules from './pages/admin/SignatureRules';
import DashboardLayouts from './pages/admin/DashboardLayouts';
import IntegrationLogs from './pages/admin/IntegrationLogs';
import ApprovalMatrix from './pages/admin/ApprovalMatrix';
import ApprovalDelegations from './pages/admin/ApprovalDelegations';
import SignaturePrecheckLogs from './pages/admin/SignaturePrecheckLogs';
import SignatureDetail from './pages/signatures/SignatureDetail';
import VerifyDocument from './pages/public/VerifyDocument';
import AICommandCenter from './pages/ai/AICommandCenter';
import AIUsage from './pages/admin/AIUsage';

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
      <Route path="/verify/:code" element={<VerifyDocument />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="hub/:slug" element={<DivisionHub />} />
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
        <Route path="tasks/:id" element={<TaskDetail />} />
        <Route path="chat" element={<ChatRoom />} />
        <Route path="approvals" element={<ApprovalInbox />} />
        <Route path="signatures" element={<SignatureInbox />} />
        <Route path="signatures/asset" element={<SignatureAsset />} />
        <Route path="signatures/:id" element={<SignatureDetail />} />
        <Route path="notifications" element={<NotificationCenter />} />
        <Route path="sales/pipeline" element={<SalesPipeline />} />
        <Route path="sales/customers" element={<SalesCustomers />} />
        <Route path="sales/customers/:id" element={<SalesCustomerDetail />} />
        <Route path="sales/sample-requests" element={<SampleRequests />} />
        <Route path="sales/field-bot" element={<FieldBotChat />} />
        <Route path="warehouse" element={<WarehouseDashboard />} />
        <Route path="it/dashboard" element={<ItDashboard />} />
        <Route path="it/devices" element={<Devices />} />
        <Route path="it/devices/:id" element={<DeviceDetail />} />
        <Route path="it/subscriptions" element={<SoftwareSubscriptions />} />
        <Route path="it/subscriptions/:id" element={<SubscriptionDetail />} />
        <Route path="meetings" element={<Meetings />} />
        <Route path="meetings/:id" element={<MeetingDetail />} />
        <Route path="finance/payment-requests" element={<PaymentRequests />} />
        <Route path="finance/payment-requests/:id" element={<PaymentRequestDetail />} />
        <Route path="hrga/onboarding" element={<OnboardingBoard />} />
        <Route path="hrga/offboarding" element={<OffboardingBoard />} />
        <Route path="hrga/workflows/:id" element={<HrgaWorkflowDetail />} />
        <Route path="hrga/checklist-templates" element={<ChecklistTemplates />} />
        <Route path="workspaces" element={<Workspaces />} />
        <Route path="workspaces-cross" element={<CrossDivisionWorkspace />} />
        <Route path="search" element={<GlobalSearch />} />
        <Route path="kb" element={<KnowledgeBase />} />
        <Route path="automation" element={<AutomationBuilder />} />
        <Route path="decision-log" element={<DecisionLog />} />
        <Route path="management" element={<ManagementDashboard />} />
        <Route path="brief" element={<BriefView />} />
        <Route path="timeline" element={<Timeline />} />
        <Route path="data-classification" element={<DataClassification />} />
        <Route path="forms" element={<FormCatalog />} />
        <Route path="forms/submissions" element={<MySubmissions />} />
        <Route path="forms/submissions/:id" element={<SubmissionDetail />} />
        <Route path="forms/:slug" element={<FormRenderer />} />
        <Route path="admin/forms" element={<FormAdminList />} />
        <Route path="admin/forms/new" element={<FormBuilder />} />
        <Route path="admin/forms/:id" element={<FormBuilder />} />
        <Route path="admin/workflows" element={<WorkflowDefinitions />} />
        <Route path="admin/workflows/new" element={<WorkflowEditor />} />
        <Route path="admin/workflows/:id" element={<WorkflowEditor />} />
        <Route path="admin/document-types" element={<DocumentTypes />} />
        <Route path="admin/signature-rules" element={<SignatureRules />} />
        <Route path="admin/dashboard-layouts" element={<DashboardLayouts />} />
        <Route path="admin/integration-logs" element={<IntegrationLogs />} />
        <Route path="admin/approval-matrix" element={<ApprovalMatrix />} />
        <Route path="admin/approval-delegations" element={<ApprovalDelegations />} />
        <Route path="admin/signature-precheck" element={<SignaturePrecheckLogs />} />
        <Route path="ai-command" element={<AICommandCenter />} />
        <Route path="admin/ai-usage" element={<AIUsage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
