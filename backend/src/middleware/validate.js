const { fail } = require('../utils/response');

module.exports = function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return fail(
        res,
        'VALIDATION_ERROR',
        'Input tidak valid',
        400,
        result.error.flatten()
      );
    }
    req[source] = result.data;
    next();
  };
};
