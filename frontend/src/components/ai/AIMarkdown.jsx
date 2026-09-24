import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Raw HTML is skipped, and images are shown as links instead of auto-loading, so
// AI output (which may echo untrusted document content) cannot beacon data out.
const components = {
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  img: ({ node, src, alt }) => (
    <a href={src} target="_blank" rel="noopener noreferrer">{alt || 'Gambar'}</a>
  ),
  table: ({ node, ...props }) => (
    <div className="ai-md-table"><table {...props} /></div>
  ),
};

export default function AIMarkdown({ children }) {
  return (
    <div className="ai-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {children || ''}
      </ReactMarkdown>
    </div>
  );
}
