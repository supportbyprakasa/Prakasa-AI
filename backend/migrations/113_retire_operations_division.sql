-- Operations is not a division of its own (owner, 1 Oct 2026: "Kalau di
-- perusahaan saya GA yang urus"). Office operations are General Affairs work,
-- run by People & Culture in Layanan GA. The Operations division never had a
-- module (only a "Segera hadir" card), a user or a role assignment, so it is
-- retired: the department and its three standard roles are soft-deleted
-- (deleted_at), which can be undone by clearing deleted_at. Guarded: nothing
-- happens while any account or role assignment still uses it. No other row is
-- touched — the Operations folder mapping rule and its Drive folder stay as
-- they are. The change is written to the activity log.
SET NAMES utf8mb4;

SET @ops := (SELECT id FROM departments WHERE code = 'operations' AND entity_id = 1 AND deleted_at IS NULL LIMIT 1);
SET @in_use := (
  SELECT (SELECT COUNT(*) FROM users WHERE department_id = @ops AND deleted_at IS NULL)
       + (SELECT COUNT(*) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.department_id = @ops)
);

UPDATE roles SET deleted_at = UTC_TIMESTAMP()
 WHERE @ops IS NOT NULL AND @in_use = 0
   AND department_id = @ops AND role_key IN ('operations.member', 'operations.supervisor', 'operations.head')
   AND deleted_at IS NULL;

INSERT INTO activity_logs (entity_id, user_id, action, subject_type, subject_id, metadata)
SELECT 1, NULL, 'department.retire', 'department', @ops,
       JSON_OBJECT('code', 'operations', 'reason', 'Pekerjaan operasional ditangani GA (People & Culture, Layanan GA)', 'migration', '113')
 WHERE @ops IS NOT NULL AND @in_use = 0;

UPDATE departments SET deleted_at = UTC_TIMESTAMP()
 WHERE @ops IS NOT NULL AND @in_use = 0 AND id = @ops;
