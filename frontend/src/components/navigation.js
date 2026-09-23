import { Sparkles, FileText, Warehouse, MonitorSmartphone, Wallet, BookOpen, Settings } from 'lucide-react';

export const divisions = [
  { slug: 'ai', title: 'AI Workspace', description: 'AI Command Center — sesi chat, context & action proposals.', icon: Sparkles, sections: ['AI Workspace'], to: '/ai-command' },
  { slug: 'documents', title: 'Dokumen & Kolaborasi', description: 'Documents, Templates, Tasks, Chat, Approvals, Signatures, Meetings.', icon: FileText, sections: ['Dokumen & Kolaborasi', 'Formulir & Workflow'] },
  { slug: 'sales', title: 'Sales & Warehouse', description: 'Pipeline, Customers, Sample Requests, Field Sales Bot, Warehouse.', icon: Warehouse, sections: ['Sales & Warehouse'] },
  { slug: 'it', title: 'IT Governance', description: 'IT Dashboard, Devices, Software Subscriptions.', icon: MonitorSmartphone, sections: ['IT Governance'] },
  { slug: 'finance', title: 'Finance & HRGA', description: 'Payment Requests, Onboarding, Offboarding, Checklist Templates.', icon: Wallet, sections: ['Finance & HRGA'] },
  { slug: 'advanced', title: 'Advanced', description: 'AI Brief, Workspaces, Timeline, Knowledge Base, Automation.', icon: BookOpen, sections: ['Advanced'] },
  { slug: 'admin', title: 'Administrasi', description: 'Users, Entities, Departments, Roles, Permissions.', icon: Settings, sections: ['Administrasi'] },
];

export const moduleDescriptions = {
  '/sales/pipeline': 'Kanban 9 stage — dari New Inquiry sampai Won/Lost.',
  '/sales/customers': 'Direktori customer & detail per akun.',
  '/sales/sample-requests': 'Permintaan sample dari sales, nyambung ke antrean Warehouse.',
  '/sales/field-bot': 'Chat AI buat sales di lapangan.',
  '/warehouse': 'Sample Queue, Delivery Proof, Checklist, Incidents (4 tab).',
  '/tasks': 'Board per tim, kanban, prioritas & due date.',
  '/chat': 'Room per topik, bisa convert pesan jadi Task.',
  '/meetings': 'Jadwal, agenda, link Google Meet otomatis, ringkasan AI.',
  '/approvals': 'Inbox persetujuan — pending, approved, rejected.',
  '/signatures': 'Signature request masuk — beda dari signer.',
  '/signatures/asset': 'Kelola aset tanda tangan digital pribadi.',
  '/documents': 'Upload & cari dokumen, dengan AI Assist per dokumen.',
  '/templates': 'Template dokumen siap pakai.',
  '/finance/payment-requests': 'Ajukan & lacak permintaan pembayaran ke vendor.',
  '/hrga/onboarding': 'Karyawan baru — checklist otomatis ke Task & IT.',
  '/hrga/offboarding': 'Karyawan keluar — serah terima aset & akses.',
  '/hrga/checklist-templates': 'Template checklist onboarding/offboarding.',
  '/it/dashboard': 'Ringkasan aset, lisensi, tiket.',
  '/it/devices': 'Aset perangkat, assignment, kondisi.',
  '/it/subscriptions': 'Software vendor, lisensi, invoice, pembayaran.',
  '/brief': 'Ringkasan harian/mingguan lintas divisi.',
  '/management': 'Dashboard eksekutif lintas divisi.',
  '/timeline': 'Lini masa aktivitas lintas modul.',
  '/kb': 'Artikel & SOP internal.',
  '/automation': 'Aturan otomatis antar modul.',
  '/decision-log': 'Catatan keputusan penting.',
  '/workspaces': 'Ruang kerja per customer/proyek.',
  '/workspaces-cross': 'Kolaborasi lintas divisi.',
  '/data-classification': 'Tingkat kerahasiaan dokumen.',
};

export function visibleSections(division, sections) {
  return sections.filter((section) => division.sections.includes(section.title)).map((section) => ({
    ...section,
    items: section.items.map((item) => ({ ...item, description: moduleDescriptions[item.to] })),
  }));
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
  return [
    ...(division && division.slug !== 'ai' ? [{ label: division.title, to: `/hub/${division.slug}` }] : []),
    { label: current.label, to: current.to },
    ...(pathname !== current.to ? [{ label: 'Detail', to: pathname }] : []),
  ];
}
