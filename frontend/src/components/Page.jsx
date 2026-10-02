import PageHeader from './PageHeader';
import './page.css';

// The page wrapper (docs/ui-guideline.md §2.3, §3): a stack that puts 24px
// between the header and the content and between sections, so pages never
// build their own root spacing. Pass the header props here, or render
// <PageHeader> as the first child yourself.
// `dataTitle`: see PageHeader (a record's own name as the page title).
export default function Page({ title, description, actions, eyebrow, dataTitle = false, className = '', children, ...props }) {
  return (
    <div className={['pw-page', className].filter(Boolean).join(' ')} {...props}>
      {title ? <PageHeader title={title} description={description} actions={actions} eyebrow={eyebrow} dataTitle={dataTitle} /> : null}
      {children}
    </div>
  );
}
