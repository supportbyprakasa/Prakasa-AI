function hasPerm(user, code) {
  return Boolean(user && (user.permissions || []).includes(code));
}

function ownsSessionRecord(user, session) {
  return Boolean(
    user &&
    session &&
    Number(session.owner_user_id) === Number(user.sub)
  );
}

function isOwner(user, session) {
  if (!ownsSessionRecord(user, session)) return false;

  // Session data remains owned by its entity. If a user is later moved to a
  // different entity, ownership alone must not bypass the entity boundary.
  if (
    user.entityId != null &&
    Number(session.entity_id) === Number(user.entityId)
  ) {
    return true;
  }

  return hasPerm(user, 'entity.cross_access');
}

function sameEntity(user, session) {
  return Boolean(
    user &&
    session &&
    user.entityId != null &&
    Number(session.entity_id) === Number(user.entityId)
  );
}

function sameDepartment(user, session) {
  return Boolean(
    user &&
    session &&
    user.departmentId != null &&
    session.department_id != null &&
    Number(session.department_id) === Number(user.departmentId)
  );
}

function canViewSession({ user, session }) {
  if (!user || !session || session.deleted_at) return false;
  if (isOwner(user, session)) return true;

  if (session.visibility === 'private') {
    // Private means private: only the session owner can read the conversation.
    // Administrators may inspect usage/audit metadata through dedicated endpoints,
    // but private prompt/response content is never exposed by session access.
    return false;
  }

  if (session.visibility === 'department') {
    return (
      sameEntity(user, session) &&
      sameDepartment(user, session) &&
      hasPerm(user, 'ai_command.department.view')
    );
  }

  if (session.visibility === 'entity') {
    if (sameEntity(user, session)) {
      return hasPerm(user, 'ai_command.entity.view');
    }
    return (
      hasPerm(user, 'entity.cross_access') &&
      hasPerm(user, 'ai_command.entity.view')
    );
  }

  return false;
}

// Division chats are shared workspaces: every member of that division who may use AI can
// continue the conversation. Private and entity-wide chats remain owner-written.
function canWriteSession({ user, session }) {
  if (!user || !session || session.deleted_at) return false;
  if (isOwner(user, session)) return true;
  return session.visibility === 'department'
    && canViewSession({ user, session })
    && hasPerm(user, 'ai_command.use');
}

function sessionAccessFlags(user, session) {
  const canView = canViewSession({ user, session });
  return {
    isOwner: isOwner(user, session),
    canView,
    canSend: canView && session?.status === 'active' && canWriteSession({ user, session }),
    canManage: canManageSession({ user, session }),
  };
}

function canManageSession({ user, session }) {
  if (!user || !session || session.deleted_at) return false;
  return isOwner(user, session);
}

function assertSessionAccess({ user, session, action }) {
  if (!user || !session || session.deleted_at) {
    const error = new Error('Akses ditolak');
    error.status = 403;
    error.code = 'FORBIDDEN';
    throw error;
  }

  const writeAction = new Set([
    'send_message',
    'attach_context',
    'propose_action',
  ]);

  if (writeAction.has(action) && session.status !== 'active') {
    const error = new Error('Session tidak aktif');
    error.status = 409;
    error.code = 'SESSION_NOT_ACTIVE';
    throw error;
  }

  if (action === 'view') {
    if (!canViewSession({ user, session })) {
      const error = new Error('Akses ditolak');
      error.status = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }
    return;
  }

  if (action === 'manage') {
    if (!canManageSession({ user, session })) {
      const error = new Error('Hanya pemilik session yang dapat mengelola session ini');
      error.status = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }
    return;
  }

  if (writeAction.has(action)) {
    if (!canWriteSession({ user, session })) {
      const error = new Error('Anda tidak dapat menulis ke percakapan ini');
      error.status = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }
    return;
  }

  if (action === 'confirm_action') {
    if (!canViewSession({ user, session })) {
      const error = new Error('Akses ditolak');
      error.status = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }
    if (session.visibility === 'private' && !isOwner(user, session)) {
      const error = new Error('Proposal pada session privat hanya dapat dikonfirmasi pemilik session');
      error.status = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }
    return;
  }

  const error = new Error('Aksi tidak dikenal');
  error.status = 400;
  error.code = 'VALIDATION_ERROR';
  throw error;
}

function buildVisibilityFilter(user, alias = 's') {
  if (!user) {
    return { sql: '1=0', args: [] };
  }

  const conditions = [];
  const args = [];

  if (user.entityId != null) {
    if (hasPerm(user, 'entity.cross_access')) {
      conditions.push(`${alias}.owner_user_id = ?`);
      args.push(user.sub);
    } else {
      conditions.push(
        `(${alias}.owner_user_id = ? AND ${alias}.entity_id = ?)`
      );
      args.push(user.sub, user.entityId);
    }
  }

  if (
    hasPerm(user, 'ai_command.department.view') &&
    user.entityId &&
    user.departmentId
  ) {
    conditions.push(
      `(${alias}.visibility='department' AND ${alias}.entity_id=? AND ${alias}.department_id=?)`
    );
    args.push(user.entityId, user.departmentId);
  }

  if (hasPerm(user, 'ai_command.entity.view') && user.entityId) {
    conditions.push(
      `(${alias}.visibility='entity' AND ${alias}.entity_id=?)`
    );
    args.push(user.entityId);

    if (hasPerm(user, 'entity.cross_access')) {
      conditions.push(`(${alias}.visibility='entity' AND ${alias}.entity_id<>?)`);
      args.push(user.entityId);
    }
  }

  if (!conditions.length) {
    return { sql: '1=0', args: [] };
  }

  return {
    sql: `(${conditions.join(' OR ')})`,
    args,
  };
}

module.exports = {
  hasPerm,
  isOwner,
  sameEntity,
  sameDepartment,
  canViewSession,
  canManageSession,
  assertSessionAccess,
  buildVisibilityFilter,
  canWriteSession,
  sessionAccessFlags,
};
