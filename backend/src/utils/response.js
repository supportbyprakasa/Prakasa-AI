const ok = (res, data = {}, meta = undefined, status = 200) => {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
};

const fail = (res, code, message, status = 400, details = undefined) => {
  return res.status(status).json({
    success: false,
    error: { code, message, ...(details ? { details } : {}) },
  });
};

module.exports = { ok, fail };
