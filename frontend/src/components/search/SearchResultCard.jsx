import { Link } from 'react-router-dom';
import Badge from '../Badge';
import Icon from '../Icon';
import StatusBadge from '../StatusBadge';
import { formatDate } from '../format';
import { safeInternalPath } from '../notifications/notificationModel';
import { resultEntity, resultMetaItems, resultSubtitle, searchTypeIcon, searchTypeLabel } from './searchResultModel';
import './search-result.css';

// One global-search result as a list row (docs/ui-guideline.md §4.9): the
// whole row is a real link to the record (keyboard and middle-click work), the
// record type is a neutral label, the status comes from StatusBadge, and meta
// values are read through the shared label maps and format.js. A result
// without an in-app path is shown as plain text.
export default function SearchResultCard({ result, currentEntityId }) {
  const target = safeInternalPath(result.actionUrl);
  const subtitle = resultSubtitle(result);
  const meta = resultMetaItems(result.meta);
  const entity = resultEntity(result.entityId, currentEntityId);

  const content = (
    <>
      <span className="pw-search-result__icon"><Icon name={searchTypeIcon(result.type)} /></span>
      <span className="pw-search-result__body">
        {/* A record's own title and second line are never translated; a second
            line the model turned into a label (a subject type, a kind) is. */}
        <span className="pw-search-result__title" data-no-translate={result.title ? '' : undefined}>{result.title || '(Tanpa judul)'}</span>
        {subtitle ? <span className="pw-search-result__subtitle" data-no-translate={subtitle === result.subtitle ? '' : undefined}>{subtitle}</span> : null}
        <span className="pw-search-result__meta">
          <Badge>{searchTypeLabel(result.type)}</Badge>
          {result.status ? <StatusBadge status={result.status} /> : null}
          {meta.map((item) => (
            <span key={item.key} className="pw-search-result__pair">{item.label}: <span data-no-translate={item.data ? '' : undefined}>{item.value}</span></span>
          ))}
          {result.createdAt ? <span className="pw-search-result__pair">Dibuat {formatDate(result.createdAt)}</span> : null}
          {entity ? <span className="pw-search-result__pair">{entity}</span> : null}
        </span>
      </span>
    </>
  );

  return (
    <li className="pw-search-result">
      {target ? (
        <Link to={target} className="pw-search-result__row pw-state-layer">{content}</Link>
      ) : (
        <div className="pw-search-result__row is-static">{content}</div>
      )}
    </li>
  );
}
