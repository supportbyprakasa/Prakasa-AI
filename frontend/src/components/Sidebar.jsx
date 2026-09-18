import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, Building2, Layers, Shield, KeyRound, Activity,
  FileText, LayoutTemplate, FolderTree, Kanban, MessageSquare, CheckSquare,
  PenTool, Bell, Users2, Package, Bot, Warehouse, MonitorSmartphone, AppWindow,
  CalendarDays, Wallet, UserPlus, UserMinus, Briefcase, Search, BookOpen, Zap,
  ScrollText, TrendingUp
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const link = ({ isActive }) => ({
  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
  color: isActive ? 'var(--color-primary)' : 'var(--color-text)',
  background: isActive ? 'rgba(31,78,216,.08)' : 'transparent',
  textDecoration: 'none', borderRadius: 8, margin: '2px 8px', fontSize: 14,
});

export default function Sidebar() {
  const { user } = useAuth();
  const has = (permission) => user?.permissions?.includes(permission);
  const hasAny = (...permissions) => permissions.some(has);

  return (
    <aside style={{ background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)', overflowY: 'auto' }}>
      <div style={{ padding: 20, fontWeight: 700, fontSize: 16 }}>Prakasa Work OS</div>
      <nav>
        <NavLink to="/" end style={link}><LayoutDashboard size={16} /> Dashboard</NavLink>

        {has('document.view') && <NavLink to="/documents" style={link}><FileText size={16} /> Documents</NavLink>}
        {has('template.view') && <NavLink to="/templates" style={link}><LayoutTemplate size={16} /> Template Center</NavLink>}
        {has('task.view') && <NavLink to="/tasks" style={link}><Kanban size={16} /> Task Board</NavLink>}
        {has('chat.view') && <NavLink to="/chat" style={link}><MessageSquare size={16} /> Chat</NavLink>}
        {has('approval.view') && <NavLink to="/approvals" style={link}><CheckSquare size={16} /> Approvals</NavLink>}
        {has('signature.view') && <NavLink to="/signatures" style={link}><PenTool size={16} /> Signatures</NavLink>}
        {has('notification.view') && <NavLink to="/notifications" style={link}><Bell size={16} /> Notifikasi</NavLink>}

        {has('sales.pipeline.view') && <NavLink to="/sales/pipeline" style={link}><Kanban size={16} /> Sales Pipeline</NavLink>}
        {has('sales.customer.view') && <NavLink to="/sales/customers" style={link}><Users2 size={16} /> Customers</NavLink>}
        {has('sales.sample.view') && <NavLink to="/sales/sample-requests" style={link}><Package size={16} /> Sample Requests</NavLink>}
        {has('sales.field_bot.use') && <NavLink to="/sales/field-bot" style={link}><Bot size={16} /> Field Sales Bot</NavLink>}
        {hasAny('warehouse.sample.view', 'warehouse.checklist.view', 'warehouse.incident.view') && (
          <NavLink to="/warehouse" style={link}><Warehouse size={16} /> Warehouse</NavLink>
        )}

        {has('it.dashboard.view') && <NavLink to="/it/dashboard" style={link}><LayoutDashboard size={16} /> IT Dashboard</NavLink>}
        {has('device.view') && <NavLink to="/it/devices" style={link}><MonitorSmartphone size={16} /> Devices</NavLink>}
        {has('subscription.view') && <NavLink to="/it/subscriptions" style={link}><AppWindow size={16} /> Subscriptions</NavLink>}
        {has('meeting.view') && <NavLink to="/meetings" style={link}><CalendarDays size={16} /> Meetings</NavLink>}
        {has('finance.view') && <NavLink to="/finance/payment-requests" style={link}><Wallet size={16} /> Finance</NavLink>}
        {has('hrga.view') && <NavLink to="/hrga/onboarding" style={link}><UserPlus size={16} /> Onboarding</NavLink>}
        {has('hrga.view') && <NavLink to="/hrga/offboarding" style={link}><UserMinus size={16} /> Offboarding</NavLink>}

        {has('search.global') && <NavLink to="/search" style={link}><Search size={16} /> Global Search</NavLink>}
        {hasAny('workspace.customer.view', 'workspace.cross_division.view') && (
          <NavLink to="/workspaces" style={link}><Briefcase size={16} /> Customer Workspace</NavLink>
        )}
        {has('kb.view') && <NavLink to="/kb" style={link}><BookOpen size={16} /> Knowledge Base</NavLink>}
        {has('automation.view') && <NavLink to="/automation" style={link}><Zap size={16} /> Automation</NavLink>}
        {has('decision_log.view') && <NavLink to="/decision-log" style={link}><ScrollText size={16} /> Decision Log</NavLink>}
        {has('brief.view') && <NavLink to="/brief" style={link}><TrendingUp size={16} /> AI Brief</NavLink>}
        {has('management_dashboard.view') && (
          <NavLink to="/management" style={link}><LayoutDashboard size={16} /> Management Dashboard</NavLink>
        )}

        {has('user.manage') && <NavLink to="/admin/users" style={link}><Users size={16} /> Users</NavLink>}
        {has('entity.manage') && <NavLink to="/admin/entities" style={link}><Building2 size={16} /> Entities</NavLink>}
        {has('department.manage') && <NavLink to="/admin/departments" style={link}><Layers size={16} /> Departments</NavLink>}
        {has('role.manage') && <NavLink to="/admin/roles" style={link}><Shield size={16} /> Roles</NavLink>}
        {has('permission.manage') && <NavLink to="/admin/permissions" style={link}><KeyRound size={16} /> Permissions</NavLink>}
        {has('folder_rule.manage') && <NavLink to="/admin/folder-rules" style={link}><FolderTree size={16} /> Folder Rules</NavLink>}
        {has('activity_log.view') && <NavLink to="/activity-logs" style={link}><Activity size={16} /> Activity Log</NavLink>}
      </nav>
    </aside>
  );
}
