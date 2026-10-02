// Tools every signed-in user has: their own profile and notifications.
// The only tool file that reads the database directly (the user's OWN rows,
// always bound to user.sub); module tools call their module's read service.
const pool = require('../../../../db/pool');

module.exports = [
  {
    name: 'profil_saya',
    module: ['general', 'account'],
    label: 'Membaca profil Anda',
    description: 'Profil pengguna yang sedang bertanya: nama, email, divisi dan peran. Pakai untuk menyesuaikan jawaban dengan peran dan divisinya. '
      + 'Hanya profil pengguna itu sendiri: tidak pernah data kepegawaian (gaji, rekening, NIK, NPWP, BPJS) atau profil orang lain.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    permission: null,
    public: true,
    async run(user) {
      const [[profile]] = await pool.query(
        `SELECT u.name, u.email, d.name AS divisi
           FROM users u LEFT JOIN departments d ON d.id = u.department_id
          WHERE u.id = ? LIMIT 1`,
        [user.sub],
      );
      const [roles] = await pool.query(
        `SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = ? AND r.deleted_at IS NULL ORDER BY r.name`,
        [user.sub],
      );
      return {
        nama: profile?.name || null,
        email: profile?.email || null,
        divisi: profile?.divisi || null,
        peran: roles.map((r) => r.name),
      };
    },
  },
  {
    name: 'notifikasi_saya',
    module: ['notifications', 'general'],
    label: 'Membaca notifikasi Anda',
    description: 'Notifikasi terbaru milik pengguna (judul, isi singkat, waktu, sudah dibaca atau belum). Bisa dibatasi hanya yang belum dibaca. '
      + 'Hanya notifikasi milik pengguna itu sendiri, tidak pernah notifikasi orang lain.',
    inputSchema: {
      type: 'object',
      properties: {
        hanya_belum_dibaca: { type: 'boolean', description: 'true = hanya notifikasi yang belum dibaca' },
        jumlah: { type: 'integer', minimum: 1, maximum: 20, description: 'Maksimal notifikasi yang diambil (default 10)' },
      },
      additionalProperties: false,
    },
    permission: 'notification.view',
    // Notifications are the user's own (approval notices can carry revenue
    // figures): never saved into a shared chat, exported, or next to web research.
    privateOnly: true,
    async run(user, input = {}) {
      const limit = Math.min(20, Math.max(1, Number(input.jumlah) || 10));
      const unreadOnly = input.hanya_belum_dibaca === true;
      const [rows] = await pool.query(
        `SELECT title, body, event, is_read, created_at
           FROM notifications
          WHERE user_id = ? AND entity_id = ? AND deleted_at IS NULL${unreadOnly ? ' AND is_read = 0' : ''}
          ORDER BY created_at DESC, id DESC
          LIMIT ?`,
        [user.sub, user.entityId, limit],
      );
      const [[count]] = await pool.query(
        'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND entity_id = ? AND deleted_at IS NULL AND is_read = 0',
        [user.sub, user.entityId],
      );
      return {
        jumlah_belum_dibaca: Number(count.n),
        notifikasi: rows.map((r) => ({
          judul: r.title, isi: r.body, jenis: r.event, sudah_dibaca: Boolean(r.is_read), waktu: r.created_at,
        })),
      };
    },
  },
];
