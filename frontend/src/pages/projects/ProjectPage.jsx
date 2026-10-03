import { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import Page from '../../components/Page';
import Button from '../../components/Button';
import { NoTranslate } from '../../i18n/NoTranslate';
import ProjectTracker from './ProjectTracker';

// /projects/:spaceId — the tracker of one Chat space, full page.
export default function ProjectPage() {
  const { spaceId } = useParams();
  const [info, setInfo] = useState(null);
  const onLoaded = useCallback((next) => setInfo(next), []);
  return (
    <Page
      eyebrow="Project"
      dataTitle={Boolean(info?.name)}
      title={info?.name || 'Project'}
      description={info?.key
        ? <><NoTranslate>{info.key}</NoTranslate>{' · '}Board, backlog, sprint, dan laporan untuk anggota space Google Chat ini.</>
        : 'Board, backlog, sprint, dan laporan untuk anggota space Google Chat ini.'}
      actions={(
        <Button variant="secondary" icon="chat" to={`/chat?space=${encodeURIComponent(spaceId || '')}`}>
          Buka di Chat
        </Button>
      )}
    >
      <ProjectTracker spaceId={spaceId} onLoaded={onLoaded} />
    </Page>
  );
}
