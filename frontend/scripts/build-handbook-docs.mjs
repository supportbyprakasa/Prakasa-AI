// Writes the Panduan (in-app handbook) as Markdown, one file per role group,
// so the owner has printable copies: docs/handbook/<group>.md.
//
//   cd frontend && node scripts/build-handbook-docs.mjs
//
// The text comes from src/pages/handbook/handbookContent.js and is cut by the
// same rule as the page (handbookModel.visibleChapters). A role group is the
// union of the standard roles at that level (backend/src/config/
// standardOrganization.js), so e.g. karyawan.md holds every division's Member
// chapters, each marked with the divisions it is for.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import HANDBOOK from '../src/pages/handbook/handbookContent.js';
import { anchorFor, blockText, levelNote, visibleChapters } from '../src/pages/handbook/handbookModel.js';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { STANDARD_ROLES, SYSTEM_ADMIN_PERMISSIONS, DIVISIONS } = require('../../backend/src/config/standardOrganization.js');
const OUT = join(here, '../../docs/handbook');

const navSource = readFileSync(join(here, '../src/components/navigation.js'), 'utf8');
const ALL_PERMISSIONS = [...new Set([
  ...STANDARD_ROLES.flatMap((role) => role.permissions),
  ...SYSTEM_ADMIN_PERMISSIONS,
  ...[...navSource.matchAll(/'([a-z_]+(?:\.[a-z_]+)+)'/g)].map((m) => m[1]),
])];
const divisionName = Object.fromEntries(DIVISIONS.map((division) => [division.code, division.name]));

// A user that holds every standard role of the given level (Management
// Office left out: it has its own group).
const levelUser = (level) => {
  const roles = STANDARD_ROLES.filter((role) => role.level === level && role.departmentCode !== 'management_office');
  return {
    permissions: [...new Set(roles.flatMap((role) => role.permissions))],
    roles: roles.map((role) => ({ roleKey: role.key, roleLevel: role.level, name: role.name })),
    members: roles,
  };
};
const managementUser = () => {
  const roles = STANDARD_ROLES.filter((role) => role.departmentCode === 'management_office');
  const head = roles.find((role) => role.level === 'head');
  return { permissions: head.permissions, roles: [{ roleKey: head.key, roleLevel: 'head', name: head.name }], members: roles };
};

const GROUPS = [
  { file: 'karyawan', title: 'Karyawan (Member)', who: 'Member di semua divisi', user: levelUser('member') },
  { file: 'supervisor', title: 'Supervisor', who: 'Supervisor di semua divisi', user: levelUser('supervisor') },
  { file: 'head', title: 'Head divisi', who: 'Head di semua divisi', user: levelUser('head') },
  { file: 'management', title: 'Management Office', who: 'Management Office (Supervisor & Head)', user: managementUser() },
  {
    file: 'administrator-sistem', title: 'Administrator Sistem', who: 'Administrator Sistem (system.admin)',
    user: { permissions: SYSTEM_ADMIN_PERMISSIONS, roles: [{ roleKey: 'system.admin', name: 'Administrator Sistem' }], members: [] },
  },
  {
    file: 'super-admin', title: 'Super Admin', who: 'Super Admin (system.super_admin)',
    user: { permissions: ALL_PERMISSIONS, roles: [{ roleKey: 'system.super_admin', name: 'Super Admin' }], members: [] },
  },
];

// Which divisions of the group can read this chapter ('' when all of them).
function divisionsFor(chapter, group) {
  if (!group.user.members.length) return '';
  const readers = group.user.members.filter((role) => visibleChapters(
    { permissions: role.permissions, roles: [{ roleKey: role.key, roleLevel: role.level, name: role.name }] }, [chapter],
  ).length);
  if (!readers.length || readers.length === group.user.members.length) return '';
  return [...new Set(readers.map((role) => divisionName[role.departmentCode] || role.departmentCode))].join(', ');
}

const cell = (text) => String(text).replace(/\|/g, '\\|');

function blockMarkdown(block) {
  switch (block.type) {
    case 'p':
      return block.text;
    case 'warning':
      return `> **Perhatian:** ${block.text}`;
    case 'note':
      return `> **Catatan:** ${block.text}`;
    case 'steps':
      return [block.title ? `**${block.title}**\n` : '', block.items.map((item, i) => `${i + 1}. ${item}`).join('\n')].join('');
    case 'list':
      return [block.title ? `**${block.title}**\n` : '', block.items.map((item) => `- ${item}`).join('\n')].join('');
    case 'tips':
      return [`> **${block.title || 'Tips'}**`, '>', ...block.items.map((item) => `> - ${item}`)].join('\n');
    case 'table':
      return [
        block.title ? `**${block.title}**\n` : '',
        `| ${block.columns.map(cell).join(' | ')} |`,
        `| ${block.columns.map(() => '---').join(' | ')} |`,
        ...block.rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
      ].join('\n');
    case 'faq':
      return block.items.map((item) => `**${item.q}**\n${item.a}`).join('\n\n');
    default:
      return blockText(block);
  }
}

function groupMarkdown(group) {
  const chapters = visibleChapters(group.user, HANDBOOK);
  const lines = [
    `# Panduan Prakasa Workspace — ${group.title}`,
    '',
    `Untuk: ${group.who}. Dibuat otomatis dari panduan di aplikasi (menu **Panduan**, alamat \`/panduan\`); jangan diedit manual — ubah \`frontend/src/pages/handbook/handbookContent.js\` lalu jalankan \`node scripts/build-handbook-docs.mjs\` dari folder \`frontend\`.`,
    '',
    'Isi panduan mengikuti peran: setiap orang hanya membaca bab untuk menu yang bisa ia buka. Berkas ini menggabungkan semua divisi pada tingkat yang sama; bab yang hanya untuk sebagian divisi ditandai.',
    '',
    '## Daftar isi',
    '',
    ...chapters.map((chapter, index) => `${index + 1}. [${chapter.title}](#${anchorFor(chapter.id)})`),
    '',
  ];
  for (const chapter of chapters) {
    const only = divisionsFor(chapter, group);
    lines.push(`<a id="${anchorFor(chapter.id)}"></a>`, '', `## ${chapter.title}`, '');
    if (chapter.part) lines.push(`*Bagian: ${chapter.part}*`, '');
    lines.push(chapter.summary, '');
    if (chapter.who) lines.push(`**Siapa yang memakai:** ${chapter.who}`, '');
    if (only) lines.push(`**Hanya untuk divisi:** ${only}`, '');
    if (chapter.route) lines.push(`**Menu:** \`${chapter.route}\``, '');
    for (const section of chapter.sections) {
      const note = levelNote(section.audience);
      lines.push(`<a id="${anchorFor(chapter.id, section.id)}"></a>`, '', `### ${section.title}${note ? ` *(${note})*` : ''}`, '');
      for (const block of section.body) lines.push(blockMarkdown(block), '');
    }
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

mkdirSync(OUT, { recursive: true });
const index = ['# Panduan Prakasa Workspace per peran', '', 'Berkas di folder ini dibuat otomatis oleh `frontend/scripts/build-handbook-docs.mjs` dari isi menu **Panduan** di aplikasi.', ''];
for (const group of GROUPS) {
  const text = groupMarkdown(group);
  writeFileSync(join(OUT, `${group.file}.md`), text);
  const count = visibleChapters(group.user, HANDBOOK).length;
  index.push(`- [${group.title}](${group.file}.md) — ${group.who}, ${count} bab`);
  console.log(`docs/handbook/${group.file}.md  ${count} bab`);
}
writeFileSync(join(OUT, 'README.md'), `${index.join('\n')}\n`);
