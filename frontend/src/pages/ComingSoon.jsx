import EmptyState from '../components/EmptyState';
import Page from '../components/Page';

// A module that is still being prepared: its page header (the menu label) and
// one empty state, like any other page without content yet.
export default function ComingSoon({ title, description }) {
  return (
    <Page title={title}>
      <EmptyState icon="hourglass_empty" title="Segera hadir" description={description} />
    </Page>
  );
}
