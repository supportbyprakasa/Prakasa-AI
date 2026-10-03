// SQL fragments for "who holds this device, and have they resigned?" — shared
// by the device list, the IT dashboard and the management provider, so the
// three always agree (rules 10, 15, 22, 23).
//
// The holder is cached on the device row by the one code path that writes
// assignments (deviceLifecycle.service): current_assignee_id (an app account),
// holder_person_id (a directory person) or holder_label (a team). The joins
// below read it for alias `d` (devices):
//   hp    the holder's directory row — the person, or the account's row
//   hacc  the holder's app account, if any (directly, or through the person)

const HOLDER_JOINS = `
  LEFT JOIN people_directory hp
         ON hp.entity_id = d.entity_id
        AND ((d.holder_person_id IS NOT NULL AND hp.id = d.holder_person_id)
          OR (d.current_assignee_id IS NOT NULL AND hp.user_id = d.current_assignee_id))
  LEFT JOIN users hacc ON hacc.id = COALESCE(d.current_assignee_id, hp.user_id)`;

const HOLDER_NAME = 'COALESCE(hacc.name, hp.full_name, d.holder_label)';

const HOLDER_KIND = `(CASE WHEN d.current_assignee_id IS NOT NULL THEN 'user'
       WHEN d.holder_person_id IS NOT NULL THEN 'person'
       WHEN d.holder_label IS NOT NULL THEN 'label' ELSE NULL END)`;

// An active device whose holder is a person who resigned: a directory row
// marked resigned, or an app account deactivated/deleted (source 'account').
// Team labels never resign; excluded rows never escalate.
const HOLDER_RESIGNED = `(d.status = 'assigned'
  AND (d.current_assignee_id IS NOT NULL OR d.holder_person_id IS NOT NULL)
  AND (hp.kind IS NULL OR hp.kind <> 'excluded')
  AND (hp.status = 'resigned' OR hacc.status = 'inactive' OR hacc.deleted_at IS NOT NULL))`;

// The resign day, never NULL (rule 10): the entered/imported date, else the day
// the row was created, else the day the account last changed.
const RESIGN_DAY = `COALESCE(hp.resigned_on, DATE(hp.created_at + INTERVAL 7 HOUR),
  DATE(COALESCE(hacc.deleted_at, hacc.updated_at) + INTERVAL 7 HOUR))`;

module.exports = { HOLDER_JOINS, HOLDER_NAME, HOLDER_KIND, HOLDER_RESIGNED, RESIGN_DAY };
