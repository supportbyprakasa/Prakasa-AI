import {
  LayoutDashboard, Users, Building2, Layers, Shield, KeyRound, Activity,
  FileText, LayoutTemplate, FolderTree, Kanban, MessageSquare, CheckSquare,
  PenTool, Bell, MonitorSmartphone, AppWindow, CalendarDays,
  Users2, Package, Bot, Warehouse, Wallet, UserPlus, UserMinus,
  Briefcase, Search, BookOpen, Zap, ScrollText, TrendingUp,
  ListChecks, CalendarRange, Network, ShieldCheck, LayoutGrid, UserCheck, Sparkles,
  Settings, HeartHandshake, LineChart, ClipboardList,
} from 'lucide-react';

// Menu modules grouped by the work they serve. Every item carries the permission its page
// needs; role templates decide who sees what, so no role gets a module it cannot use.
const NAV = [
  {
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/search', label: 'Search', icon: Search, permission: 'search.global' },
      { to: '/notifications', label: 'Notifikasi', icon: Bell, showUnreadBadge: true, permission: 'notification.view' },
    ],
  },
  {
    title: 'AI Workspace',
    items: [
      { to: '/ai-command', label: 'AI Command Center', icon: Sparkles, permission: 'ai_command.session.view' },
    ],
  },
  {
    title: 'Kerja Harian',
    items: [
      { to: '/tasks', label: 'Task Board', icon: Kanban, permission: 'task.view' },
      { to: '/chat', label: 'Chat', icon: MessageSquare, permission: 'chat.view' },
      { to: '/meetings', label: 'Meetings', icon: CalendarDays, permission: 'meeting.view' },
      { to: '/approvals', label: 'Approvals', icon: CheckSquare, permission: 'approval.view' },
      { to: '/admin/approval-delegations', label: 'Delegasi Approval', icon: UserCheck, permission: 'approval_delegation.view' },
      { to: '/signatures', label: 'Signatures', icon: PenTool, permission: 'signature.view' },
      { to: '/signatures/asset', label: 'Tanda Tangan Saya', icon: PenTool, permission: 'signature.manage_asset' },
      { to: '/documents', label: 'Documents', icon: FileText, permission: 'document.view' },
      { to: '/templates', label: 'Templates', icon: LayoutTemplate, permission: 'template.view' },
      { to: '/forms', label: 'Formulir', icon: ClipboardList, permission: 'form.view' },
      { to: '/forms/submissions', label: 'Submission Saya', icon: ListChecks, permission: 'form_submission.view' },
    ],
  },
  {
    title: 'Sales & Customer',
    items: [
      { to: '/sales/pipeline', label: 'Sales Pipeline', icon: Kanban, permission: 'sales.pipeline.view' },
      { to: '/sales/customers', label: 'Customers', icon: Users2, permission: 'sales.customer.view' },
      { to: '/sales/sample-requests', label: 'Sample Requests', icon: Package, permission: 'sales.sample.view' },
      { to: '/sales/field-bot', label: 'Field Sales Bot', icon: Bot, permission: 'sales.field_bot.use' },
      { to: '/workspaces', label: 'Customer Workspaces', icon: Briefcase, permission: 'workspace.customer.view' },
    ],
  },
  {
    title: 'Warehouse',
    items: [
      { to: '/warehouse', label: 'Warehouse', icon: Warehouse, permission: ['warehouse.movement.view', 'warehouse.sample.view'] },
    ],
  },
  {
    title: 'Operations & IT',
    items: [
      { to: '/it/dashboard', label: 'IT Dashboard', icon: LayoutDashboard, permission: 'it.dashboard.view' },
      { to: '/it/devices', label: 'Devices', icon: MonitorSmartphone, permission: 'device.view' },
      { to: '/it/subscriptions', label: 'Subscriptions', icon: AppWindow, permission: 'subscription.view' },
      { to: '/automation', label: 'Automation', icon: Zap, permission: 'automation.view' },
      { to: '/admin/workflows', label: 'Workflow Builder', icon: Network, permission: 'workflow_definition.manage' },
    ],
  },
  {
    title: 'Finance',
    items: [
      { to: '/finance/payment-requests', label: 'Payment Requests', icon: Wallet, permission: 'finance.view' },
    ],
  },
  {
    title: 'People & Culture',
    items: [
      { to: '/hrga/onboarding', label: 'Onboarding', icon: UserPlus, permission: 'hrga.view' },
      { to: '/hrga/offboarding', label: 'Offboarding', icon: UserMinus, permission: 'hrga.view' },
      { to: '/hrga/checklist-templates', label: 'Checklist Templates', icon: ListChecks, permission: 'hrga.checklist_template.manage' },
    ],
  },
  {
    title: 'Insight & Manajemen',
    items: [
      { to: '/management', label: 'Management Dashboard', icon: LayoutDashboard, permission: 'management_dashboard.view' },
      { to: '/brief', label: 'AI Brief', icon: TrendingUp, permission: 'brief.view' },
      { to: '/timeline', label: 'Timeline', icon: CalendarRange, permission: 'timeline.view' },
      { to: '/decision-log', label: 'Decision Log', icon: ScrollText, permission: 'decision_log.view' },
      { to: '/workspaces-cross', label: 'Kolaborasi Lintas Divisi', icon: Network, permission: 'workspace.cross_division.view' },
      { to: '/activity-logs', label: 'Activity Log', icon: Activity, permission: 'activity_log.view' },
    ],
  },
  {
    title: 'Pengetahuan & Kebijakan',
    items: [
      { to: '/kb', label: 'Knowledge Base', icon: BookOpen, permission: 'kb.view' },
      { to: '/data-classification', label: 'Data Classification', icon: ShieldCheck, permission: 'data_classification.view' },
    ],
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
      { to: '/admin/document-types', label: 'Document Types', icon: LayoutTemplate, permission: 'document_type.manage' },
      { to: '/admin/signature-rules', label: 'Signature Rules', icon: PenTool, permission: 'signature_rule.view' },
      { to: '/admin/dashboard-layouts', label: 'Dashboard Layouts', icon: LayoutDashboard, permission: 'dashboard_layout.manage' },
      { to: '/admin/integration-logs', label: 'Integration Logs', icon: Activity, permission: 'integration_log.view' },
      { to: '/admin/approval-matrix', label: 'Approval Matrix', icon: LayoutGrid, permission: 'approval_matrix.view' },
      { to: '/admin/signature-precheck', label: 'Signature Precheck', icon: ShieldCheck, permission: 'signature_precheck.view' },
      { to: '/admin/ai-usage', label: 'AI Usage', icon: Activity, permission: 'ai_command.usage.view' },
      { to: '/admin/ai-provider-settings', label: 'AI Provider Settings', icon: Sparkles, permission: 'ai.provider.manage' },
    ],
  },
];

// A string needs that permission; an array needs any one of them.
export function hasNavPermission(permissions, required) {
  if (!required) return true;
  const granted = new Set(permissions || []);
  return Array.isArray(required) ? required.some((code) => granted.has(code)) : granted.has(required);
}

export function buildNavSections(permissions) {
  return NAV
    .map((section) => ({ ...section, items: section.items.filter((item) => hasNavPermission(permissions, item.permission)) }))
    .filter((section) => section.items.length > 0);
}

export const divisions = [
  { slug: 'ai', title: 'AI Workspace', icon: Sparkles, sections: ['AI Workspace'], to: '/ai-command',
    summary: 'Tanya, ringkas, dan susun draft bersama Prakasa AI.' },
  { slug: 'kerja', title: 'Kerja Harian', icon: FileText, sections: ['Kerja Harian'],
    summary: 'Task, chat, meeting, approval, tanda tangan, dokumen, dan formulir tim Anda.' },
  { slug: 'sales', title: 'Sales & Customer', icon: HeartHandshake, sections: ['Sales & Customer'],
    summary: 'Pipeline, customer, sample request, dan kunjungan lapangan.' },
  { slug: 'warehouse', title: 'Warehouse', icon: Warehouse, sections: ['Warehouse'],
    summary: 'Barang masuk dan keluar, approval Supervisor, serta operasional gudang.' },
  { slug: 'operations', title: 'Operations & IT', icon: MonitorSmartphone, sections: ['Operations & IT'],
    summary: 'Perangkat, langganan software, otomasi, dan alur kerja operasional.' },
  { slug: 'finance', title: 'Finance', icon: Wallet, sections: ['Finance'],
    summary: 'Permintaan pembayaran dan pemeriksaan dokumen keuangan.' },
  { slug: 'people', title: 'People & Culture', icon: UserPlus, sections: ['People & Culture'],
    summary: 'Onboarding, offboarding, dan checklist karyawan.' },
  { slug: 'insight', title: 'Insight & Manajemen', icon: LineChart, sections: ['Insight & Manajemen'],
    summary: 'Ringkasan, lini masa, keputusan, audit, dan kolaborasi lintas divisi.' },
  { slug: 'knowledge', title: 'Pengetahuan & Kebijakan', icon: BookOpen, sections: ['Pengetahuan & Kebijakan'],
    summary: 'SOP, artikel internal, dan klasifikasi data.' },
  { slug: 'admin', title: 'Administrasi', icon: Settings, sections: ['Administrasi'],
    summary: 'Pengguna, akses, aturan approval, dan konfigurasi sistem.' },
];

export const moduleDescriptions = {
  '/sales/pipeline': 'Kanban 9 stage — dari New Inquiry sampai Won/Lost.',
  '/sales/customers': 'Direktori customer & detail per akun.',
  '/sales/sample-requests': 'Permintaan sample dari sales, nyambung ke antrean Warehouse.',
  '/sales/field-bot': 'Chat AI buat sales di lapangan.',
  '/workspaces': 'Ruang kerja per customer atau proyek.',
  '/warehouse': 'Barang masuk & keluar dengan approval Supervisor, plus operasional gudang.',
  '/tasks': 'Board per tim, kanban, prioritas & due date.',
  '/chat': 'Room per topik, bisa convert pesan jadi Task.',
  '/meetings': 'Jadwal, agenda, link Google Meet otomatis, ringkasan AI.',
  '/approvals': 'Inbox persetujuan — pending, approved, rejected.',
  '/admin/approval-delegations': 'Alihkan approval ke rekan saat Anda berhalangan.',
  '/signatures': 'Signature request masuk — beda dari signer.',
  '/signatures/asset': 'Kelola aset tanda tangan digital pribadi.',
  '/documents': 'Upload & cari dokumen, dengan AI Assist per dokumen.',
  '/templates': 'Template dokumen siap pakai.',
  '/forms': 'Isi formulir dan pengajuan internal.',
  '/forms/submissions': 'Status formulir yang sudah Anda ajukan.',
  '/finance/payment-requests': 'Ajukan & lacak permintaan pembayaran ke vendor.',
  '/hrga/onboarding': 'Karyawan baru — checklist otomatis ke Task & IT.',
  '/hrga/offboarding': 'Karyawan keluar — serah terima aset & akses.',
  '/hrga/checklist-templates': 'Template checklist onboarding/offboarding.',
  '/it/dashboard': 'Ringkasan aset, lisensi, tiket.',
  '/it/devices': 'Aset perangkat, assignment, kondisi.',
  '/it/subscriptions': 'Software vendor, lisensi, invoice, pembayaran.',
  '/automation': 'Aturan otomatis antar modul.',
  '/admin/workflows': 'Rancang alur pengajuan dan persetujuan operasional.',
  '/brief': 'Ringkasan harian/mingguan lintas divisi.',
  '/management': 'Dashboard eksekutif lintas divisi.',
  '/timeline': 'Lini masa aktivitas lintas modul.',
  '/decision-log': 'Catatan keputusan penting.',
  '/workspaces-cross': 'Kolaborasi lintas divisi.',
  '/activity-logs': 'Jejak audit aktivitas pengguna dan sistem.',
  '/kb': 'Artikel & SOP internal.',
  '/data-classification': 'Tingkat kerahasiaan dokumen.',
};

export function visibleSections(division, sections) {
  return sections.filter((section) => division.sections.includes(section.title)).map((section) => ({
    ...section,
    items: section.items.map((item) => ({ ...item, description: moduleDescriptions[item.to] })),
  }));
}

// Home cards for this user: only hubs with at least one usable module. A hub with a
// single module opens it directly, and the description names only what the user can open.
export function hubCards(sections) {
  return divisions
    .map((division) => {
      const items = visibleSections(division, sections).flatMap((section) => section.items);
      if (!items.length) return null;
      const direct = division.to || (items.length === 1 ? items[0].to : `/hub/${division.slug}`);
      const labels = items.map((item) => item.label);
      return {
        ...division,
        items,
        count: items.length,
        to: direct,
        description: division.to
          ? division.summary
          : items.length === 1 && items[0].description ? items[0].description : `${labels.join(', ')}.`,
      };
    })
    .filter(Boolean);
}

export function pageTrail(pathname, sections) {
  if (pathname === '/') return [];
  if (pathname.startsWith('/hub/')) {
    const division = divisions.find((entry) => pathname === `/hub/${entry.slug}`);
    return division ? [{ label: division.title, to: `/hub/${division.slug}` }] : [];
  }
  if (pathname === '/ai-command') return [{ label: 'AI Workspace', to: '/ai-command' }];
  const items = sections.flatMap((section) => section.items.map((item) => ({ ...item, section: section.title })));
  const current = items.filter((item) => pathname === item.to || pathname.startsWith(`${item.to}/`))
    .sort((a, b) => b.to.length - a.to.length)[0];
  if (!current) return [{ label: pathname === '/notifications' ? 'Notifikasi' : 'Halaman', to: pathname }];
  const division = divisions.find((entry) => entry.sections.includes(current.section));
  const sectionItems = sections.find((section) => section.title === current.section)?.items || [];
  // A hub with one module has no hub page of its own; skip straight to the module.
  const showHub = division && division.slug !== 'ai' && sectionItems.length > 1;
  return [
    ...(showHub ? [{ label: division.title, to: `/hub/${division.slug}` }] : []),
    { label: current.label, to: current.to },
    ...(pathname !== current.to ? [{ label: 'Detail', to: pathname }] : []),
  ];
}
