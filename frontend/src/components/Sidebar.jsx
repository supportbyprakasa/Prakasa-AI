import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, Building2, Layers, Shield, KeyRound, Activity,
  FileText, LayoutTemplate, FolderTree, Kanban, MessageSquare, CheckSquare,
  PenTool, Bell, MonitorSmartphone, AppWindow, CalendarDays,
  Users2, Package, Bot, Warehouse, Wallet, UserPlus, UserMinus,
  Briefcase, Search, BookOpen, Zap, ScrollText, TrendingUp,
  ListChecks, CalendarRange, Network, ShieldCheck, LayoutGrid, UserCheck, Sparkles,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNotificationCount } from '../context/NotificationContext';

export function useNavConfig() {
  const { user } = useAuth();
  const has = (p) => !p || user?.permissions?.includes(p);

  return [
    {
      items: [
        { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
        { to: '/search', label: 'Search', icon: Search, permission: 'search.global' },
        { to: '/notifications', label: 'Notifikasi', icon: Bell, showUnreadBadge: true },
      ].filter((i) => has(i.permission)),
    },
    {
      title: 'AI Workspace',
      items: [
        { to: '/ai-command', label: 'AI Command Center', icon: Sparkles, permission: 'ai_command.session.view' },
      ].filter((i) => has(i.permission)),
    },
    {
      title: 'Dokumen & Kolaborasi',
      items: [
        { to: '/documents', label: 'Documents', icon: FileText, permission: 'document.view' },
        { to: '/templates', label: 'Templates', icon: LayoutTemplate, permission: 'template.view' },
        { to: '/tasks', label: 'Task Board', icon: Kanban, permission: 'task.view' },
        { to: '/chat', label: 'Chat', icon: MessageSquare, permission: 'chat.view' },
        { to: '/approvals', label: 'Approvals', icon: CheckSquare, permission: 'approval.view' },
        { to: '/signatures', label: 'Signatures', icon: PenTool, permission: 'signature.view' },
        { to: '/signatures/asset', label: 'Tanda Tangan Saya', icon: PenTool, permission: 'signature.manage_asset' },
        { to: '/meetings', label: 'Meetings', icon: CalendarDays, permission: 'meeting.view' },
      ].filter((i) => has(i.permission)),
    },
    {
      title: 'Formulir & Workflow',
      items: [
        { to: '/forms', label: 'Formulir', icon: FileText },
        { to: '/forms/submissions', label: 'Submission Saya', icon: ListChecks },
      ],
    },
    {
      title: 'Sales & Warehouse',
      items: [
        { to: '/sales/pipeline', label: 'Sales Pipeline', icon: Kanban, permission: 'sales.pipeline.view' },
        { to: '/sales/customers', label: 'Customers', icon: Users2, permission: 'sales.customer.view' },
        { to: '/sales/sample-requests', label: 'Sample Requests', icon: Package, permission: 'sales.sample.view' },
        { to: '/sales/field-bot', label: 'Field Sales Bot', icon: Bot, permission: 'sales.field_bot.use' },
        { to: '/warehouse', label: 'Warehouse', icon: Warehouse, permission: 'warehouse.sample.view' },
      ].filter((i) => has(i.permission)),
    },
    {
      title: 'IT Governance',
      items: [
        { to: '/it/dashboard', label: 'IT Dashboard', icon: LayoutDashboard, permission: 'it.dashboard.view' },
        { to: '/it/devices', label: 'Devices', icon: MonitorSmartphone, permission: 'device.view' },
        { to: '/it/subscriptions', label: 'Subscriptions', icon: AppWindow, permission: 'subscription.view' },
      ].filter((i) => has(i.permission)),
    },
    {
      title: 'Finance & HRGA',
      items: [
        { to: '/finance/payment-requests', label: 'Finance', icon: Wallet, permission: 'finance.view' },
        { to: '/hrga/onboarding', label: 'Onboarding', icon: UserPlus, permission: 'hrga.view' },
        { to: '/hrga/offboarding', label: 'Offboarding', icon: UserMinus, permission: 'hrga.view' },
        { to: '/hrga/checklist-templates', label: 'Checklist Templates', icon: ListChecks, permission: 'hrga.checklist_template.manage' },
      ].filter((i) => has(i.permission)),
    },
    {
      title: 'Advanced',
      items: [
        { to: '/workspaces', label: 'Workspaces', icon: Briefcase, permission: 'workspace.customer.view' },
        { to: '/workspaces-cross', label: 'Cross Workspace', icon: Network, permission: 'workspace.cross_division.view' },
        { to: '/timeline', label: 'Timeline', icon: CalendarRange, permission: 'timeline.view' },
        { to: '/data-classification', label: 'Data Class', icon: ShieldCheck, permission: 'data_classification.view' },
        { to: '/kb', label: 'Knowledge Base', icon: BookOpen, permission: 'kb.view' },
        { to: '/automation', label: 'Automation', icon: Zap, permission: 'automation.view' },
        { to: '/decision-log', label: 'Decision Log', icon: ScrollText, permission: 'decision_log.view' },
        { to: '/brief', label: 'AI Brief', icon: TrendingUp, permission: 'brief.view' },
        { to: '/management', label: 'Management', icon: LayoutDashboard, permission: 'management_dashboard.view' },
      ].filter((i) => has(i.permission)),
    },
    {
      title: 'Administrasi',
      items: [
        { to: '/admin/users', label: 'Users', icon: Users, permission: 'user.manage' },
        { to: '/admin/entities', label: 'Entities', icon: Building2, permission: 'entity.manage' },
        { to: '/admin/departments', label: 'Departments', icon: Layers, permission: 'department.manage' },
        { to: '/admin/roles', label: 'Roles', icon: Shield, permission: 'role.manage' },
        { to: '/admin/permissions', label: 'Permissions', icon: KeyRound, permission: 'permission.manage' },
        { to: '/admin/folder-rules', label: 'Folder Rules', icon: FolderTree, permission: 'folder_rule.manage' },
        { to: '/admin/forms', label: 'Form Builder', icon: FileText, permission: 'form.manage' },
        { to: '/admin/workflows', label: 'Workflows', icon: Network, permission: 'workflow_definition.manage' },
        { to: '/admin/document-types', label: 'Document Types', icon: LayoutTemplate, permission: 'document_type.view' },
        { to: '/admin/signature-rules', label: 'Signature Rules', icon: PenTool, permission: 'signature_rule.view' },
        { to: '/admin/dashboard-layouts', label: 'Dashboard Layouts', icon: LayoutDashboard, permission: 'dashboard_layout.manage' },
        { to: '/admin/integration-logs', label: 'Integration Logs', icon: Activity, permission: 'integration_log.view' },
        { to: '/admin/approval-matrix', label: 'Approval Matrix', icon: LayoutGrid, permission: 'approval_matrix.view' },
        { to: '/admin/approval-delegations', label: 'Approval Delegations', icon: UserCheck, permission: 'approval_delegation.view' },
        { to: '/admin/signature-precheck', label: 'Signature Precheck', icon: ShieldCheck, permission: 'signature_precheck.view' },
        { to: '/admin/ai-usage', label: 'AI Usage', icon: Activity, permission: 'ai_command.usage.view' },
        { to: '/activity-logs', label: 'Activity Log', icon: Activity, permission: 'activity_log.view' },
      ].filter((i) => has(i.permission)),
    },
  ].filter((section) => section.items.length > 0);
}

export default function Sidebar({ collapsed, mobileOpen, onCloseMobile }) {
  const sections = useNavConfig();
  const { unreadCount } = useNotificationCount();

  return (
    <aside
      className={[
        'prakasa-sidebar',
        collapsed ? 'prakasa-sidebar--collapsed' : '',
        mobileOpen ? 'prakasa-sidebar--open-mobile' : '',
      ].join(' ')}
    >
      <nav className="prakasa-sidebar__nav" aria-label="Navigasi utama">
        {sections.map((section, si) => (
          <div className="prakasa-sidebar__section" key={si}>
            {section.title && (
              <h3 className="prakasa-sidebar__section-title">{section.title}</h3>
            )}
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  title={collapsed ? item.label : undefined}
                  onClick={() => onCloseMobile?.()}
                  className={({ isActive }) =>
                    `prakasa-sidebar__item ${isActive ? 'prakasa-sidebar__item--active' : ''}`
                  }
                >
                  <span className="prakasa-sidebar__item-icon" style={{ position: 'relative' }}>
                    <Icon size={24} strokeWidth={1.8} />
                    {item.showUnreadBadge && unreadCount > 0 && collapsed && (
                      <span
                        aria-label={`${unreadCount} notifikasi belum dibaca`}
                        style={{
                          position: 'absolute',
                          top: -4,
                          right: -4,
                          minWidth: 16,
                          height: 16,
                          padding: '0 4px',
                          borderRadius: 999,
                          background: 'var(--color-error, #dc2626)',
                          color: '#fff',
                          fontSize: 10,
                          fontWeight: 700,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxSizing: 'border-box',
                        }}
                      >
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </span>
                  <span className="prakasa-sidebar__item-label">
                    {item.label}
                    {item.showUnreadBadge && unreadCount > 0 && !collapsed && (
                      <span
                        style={{
                          marginLeft: 8,
                          padding: '1px 7px',
                          borderRadius: 999,
                          background: 'var(--color-error, #dc2626)',
                          color: '#fff',
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </span>
                </NavLink>
              );
            })}
          </div>
        ))}
        <div className="prakasa-sidebar__nav-spacer" aria-hidden="true" />
      </nav>
    </aside>
  );
}
